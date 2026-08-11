import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { PersistenceAdapter } from "@flue/runtime/adapter";
import { sqlite } from "@flue/runtime/node";

export const flueDatabasePath = process.env.FLUE_DATABASE_PATH ?? "./data/ask-jdp-flue.db";
export const DEFAULT_TRANSCRIPT_RETENTION_HOURS = 24;
export const MIN_TRANSCRIPT_RETENTION_HOURS = 9;
export const MAX_TRANSCRIPT_RETENTION_HOURS = 24 * 7;
/** Launcher contract: restart at least this often so startup cleanup bounds retention drift. */
export const RETENTION_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

const FLUE_RETENTION_TABLES = [
  "flue_agent_submissions",
  "flue_attachment_chunks",
  "flue_attachments",
  "flue_conversation_fold_checkpoint_chunks",
  "flue_conversation_fold_checkpoints",
  "flue_conversation_stream_batch_chunks",
  "flue_conversation_stream_batches",
  "flue_conversation_streams",
  "flue_submission_chunks",
] as const;

export type FlueDatabaseReadiness =
  | { ok: true }
  | { ok: false; reason: "missing" | "unreadable" | "schema_missing" };

/** A shallow, read-only database probe suitable for a readiness endpoint. */
export function checkFlueDatabaseReadiness(databasePath = flueDatabasePath): FlueDatabaseReadiness {
  if (!databasePath.trim() || databasePath === ":memory:" || !existsSync(databasePath)) {
    return { ok: false, reason: "missing" };
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.prepare("SELECT 1").get();
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('flue_agent_submissions', 'flue_conversation_streams')")
        .all()
        .map((row) => String(row.name)),
    );
    if (!tables.has("flue_agent_submissions") || !tables.has("flue_conversation_streams")) {
      return { ok: false, reason: "schema_missing" };
    }
    database.prepare("SELECT 1 FROM flue_agent_submissions LIMIT 1").get();
    database.prepare("SELECT 1 FROM flue_conversation_streams LIMIT 1").get();
    return { ok: true };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    database?.close();
  }
}

export type FlueRetentionCleanupOptions = {
  /** Must name an existing file-backed Flue SQLite database. */
  databasePath: string;
  /** Retain data settled at or after `now - retentionMs`. */
  retentionMs: number;
  now?: number;
  /** Cleanup is a dry run unless the caller explicitly opts in. */
  apply?: boolean;
};

export type FlueRetentionCleanupResult = {
  applied: boolean;
  cutoff: number;
  conversationPaths: number;
  submissions: number;
  rows: {
    attachmentChunks: number;
    attachments: number;
    foldCheckpointChunks: number;
    foldCheckpoints: number;
    streamBatchChunks: number;
    streamBatches: number;
    streams: number;
    submissionChunks: number;
  };
};

export class FlueRetentionConfigurationError extends Error {}

export function resolveTranscriptRetentionMs(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.ASK_JDP_TRANSCRIPT_RETENTION_HOURS?.trim();
  const hours = configured ? Number(configured) : DEFAULT_TRANSCRIPT_RETENTION_HOURS;
  if (
    !Number.isSafeInteger(hours) ||
    hours < MIN_TRANSCRIPT_RETENTION_HOURS ||
    hours > MAX_TRANSCRIPT_RETENTION_HOURS
  ) {
    throw new FlueRetentionConfigurationError(
      `ASK_JDP_TRANSCRIPT_RETENTION_HOURS must be an integer from ${MIN_TRANSCRIPT_RETENTION_HOURS} to ${MAX_TRANSCRIPT_RETENTION_HOURS}`,
    );
  }
  return hours * 60 * 60 * 1_000;
}

function assertCleanupConfiguration(options: FlueRetentionCleanupOptions) {
  if (!options.databasePath.trim() || options.databasePath === ":memory:") {
    throw new FlueRetentionConfigurationError("Retention cleanup requires an existing file-backed database");
  }
  if (!existsSync(options.databasePath)) {
    throw new FlueRetentionConfigurationError("Retention cleanup database does not exist");
  }
  if (!Number.isSafeInteger(options.retentionMs) || options.retentionMs < 1) {
    throw new FlueRetentionConfigurationError("retentionMs must be a positive integer");
  }
  if (options.now !== undefined && (!Number.isSafeInteger(options.now) || options.now < 0)) {
    throw new FlueRetentionConfigurationError("now must be a non-negative integer timestamp");
  }
}

function assertRetentionSchema(database: DatabaseSync) {
  const available = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'flue_%'")
      .all()
      .map((row) => String(row.name)),
  );
  const missing = FLUE_RETENTION_TABLES.filter((table) => !available.has(table));
  if (missing.length > 0) {
    throw new FlueRetentionConfigurationError("Flue retention schema is incomplete");
  }
}

function count(database: DatabaseSync, table: "retention_paths" | "retention_submissions") {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
}

function countRowsForPaths(database: DatabaseSync, table: (typeof FLUE_RETENTION_TABLES)[number]) {
  const pathColumn = table === "flue_attachments" || table === "flue_attachment_chunks" ? "stream_path" : "path";
  return Number(
    database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${pathColumn} IN (SELECT path FROM retention_paths)`)
      .get()!.count,
  );
}

/**
 * Identifies and optionally removes settled Flue conversations older than a TTL.
 *
 * The caller must explicitly pass `apply: true`; merely importing the database
 * module or invoking this function with defaults never deletes durable data.
 * Run applied cleanup only while the Flue runtime is quiescent.
 */
export function cleanupExpiredFlueData(options: FlueRetentionCleanupOptions): FlueRetentionCleanupResult {
  assertCleanupConfiguration(options);
  const applied = options.apply === true;
  const now = options.now ?? Date.now();
  const cutoff = now - options.retentionMs;
  if (!Number.isSafeInteger(cutoff)) {
    throw new FlueRetentionConfigurationError("Retention cutoff is outside the supported timestamp range");
  }

  const database = new DatabaseSync(options.databasePath, { readOnly: !applied });
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    assertRetentionSchema(database);
    database.exec(applied ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      database.exec("CREATE TEMP TABLE retention_paths (path TEXT PRIMARY KEY)");
      database.exec("CREATE TEMP TABLE retention_submissions (submission_id TEXT PRIMARY KEY)");

      database
        .prepare(`INSERT INTO retention_paths (path)
          SELECT batches.path
          FROM flue_conversation_stream_batches AS batches
          JOIN flue_agent_submissions AS submissions
            ON submissions.submission_id = batches.submission_id
          GROUP BY batches.path
          HAVING MAX(COALESCE(submissions.settled_at, submissions.accepted_at)) < ?
            AND SUM(CASE WHEN submissions.settled_at IS NULL THEN 1 ELSE 0 END) = 0
            AND NOT EXISTS (
              SELECT 1
              FROM flue_conversation_stream_batches AS unknown_batches
              LEFT JOIN flue_agent_submissions AS known_submissions
                ON known_submissions.submission_id = unknown_batches.submission_id
              WHERE unknown_batches.path = batches.path
                AND unknown_batches.submission_id IS NOT NULL
                AND known_submissions.submission_id IS NULL
            )`)
        .run(cutoff);

      database
        .prepare(`INSERT INTO retention_submissions (submission_id)
          SELECT submissions.submission_id
          FROM flue_agent_submissions AS submissions
          WHERE submissions.settled_at IS NOT NULL
            AND submissions.settled_at < ?
            AND NOT EXISTS (
              SELECT 1
              FROM flue_conversation_stream_batches AS batches
              WHERE batches.submission_id = submissions.submission_id
                AND batches.path NOT IN (SELECT path FROM retention_paths)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM flue_agent_submissions AS dependent
              WHERE dependent.joined_into = submissions.submission_id
                AND (
                  dependent.settled_at IS NULL
                  OR dependent.settled_at >= ?
                  OR EXISTS (
                    SELECT 1
                    FROM flue_conversation_stream_batches AS dependent_batches
                    WHERE dependent_batches.submission_id = dependent.submission_id
                      AND dependent_batches.path NOT IN (SELECT path FROM retention_paths)
                  )
                )
            )`)
        .run(cutoff, cutoff);

      const result: FlueRetentionCleanupResult = {
        applied,
        cutoff,
        conversationPaths: count(database, "retention_paths"),
        submissions: count(database, "retention_submissions"),
        rows: {
          attachmentChunks: countRowsForPaths(database, "flue_attachment_chunks"),
          attachments: countRowsForPaths(database, "flue_attachments"),
          foldCheckpointChunks: countRowsForPaths(database, "flue_conversation_fold_checkpoint_chunks"),
          foldCheckpoints: countRowsForPaths(database, "flue_conversation_fold_checkpoints"),
          streamBatchChunks: countRowsForPaths(database, "flue_conversation_stream_batch_chunks"),
          streamBatches: countRowsForPaths(database, "flue_conversation_stream_batches"),
          streams: countRowsForPaths(database, "flue_conversation_streams"),
          submissionChunks: Number(
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM flue_submission_chunks WHERE submission_id IN (SELECT submission_id FROM retention_submissions)",
              )
              .get()!.count,
          ),
        },
      };

      if (applied) {
        database.exec(`DELETE FROM flue_attachment_chunks WHERE stream_path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_attachments WHERE stream_path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_conversation_fold_checkpoint_chunks WHERE path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_conversation_fold_checkpoints WHERE path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_conversation_stream_batch_chunks WHERE path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_conversation_stream_batches WHERE path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_conversation_streams WHERE path IN (SELECT path FROM retention_paths);
          DELETE FROM flue_submission_chunks WHERE submission_id IN (SELECT submission_id FROM retention_submissions);
          DELETE FROM flue_agent_submissions WHERE submission_id IN (SELECT submission_id FROM retention_submissions);`);
        if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
          throw new Error("Flue retention cleanup would violate database relationships");
        }
        database.exec("COMMIT");
      } else {
        database.exec("ROLLBACK");
      }
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original failure if SQLite already ended the transaction.
      }
      throw error;
    }
  } finally {
    database.close();
  }
}

/** Wraps Flue migration with quiescent production cleanup before the runtime connects. */
export function createRetentionManagedFluePersistence(
  databasePath: string,
  environment: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): PersistenceAdapter {
  const persistence = sqlite(databasePath);
  return {
    async migrate() {
      await persistence.migrate?.();
      if (environment.NODE_ENV === "production") {
        cleanupExpiredFlueData({
          databasePath,
          retentionMs: resolveTranscriptRetentionMs(environment),
          now: now(),
          apply: true,
        });
      }
    },
    connect() {
      return persistence.connect();
    },
    close() {
      return persistence.close?.();
    },
  };
}

// A file-backed adapter keeps anonymous conversations available after a process restart
// on a single Node host. Production replicas require a shared Flue persistence adapter.
export default createRetentionManagedFluePersistence(flueDatabasePath);
