import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqlite } from "@flue/runtime/node";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkFlueDatabaseReadiness,
  cleanupExpiredFlueData,
  createRetentionManagedFluePersistence,
  DEFAULT_TRANSCRIPT_RETENTION_HOURS,
  FlueRetentionConfigurationError,
  resolveTranscriptRetentionMs,
} from "../src/db.ts";
import { createRateLimiter } from "../src/security/request-guards.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "ask-jdp-retention-"));
  temporaryDirectories.push(directory);
  return join(directory, "flue.db");
}

function createMigratedDatabase(path: string) {
  const adapter = sqlite(path);
  adapter.migrate?.();
  adapter.close?.();
}

function seedConversation(database: DatabaseSync, input: { path: string; submissionId?: string; acceptedAt: number; settledAt?: number }) {
  database
    .prepare(`INSERT INTO flue_conversation_streams
      (path, identity_json, next_offset, producer_epoch, next_producer_sequence, incarnation)
      VALUES (?, '{}', 1, 0, 0, 'incarnation')`)
    .run(input.path);

  if (input.submissionId) {
    database
      .prepare(`INSERT INTO flue_agent_submissions
        (submission_id, session_key, kind, payload, status, accepted_at, settled_at)
        VALUES (?, ?, 'direct', '{}', ?, ?, ?)`)
      .run(
        input.submissionId,
        `session:${input.path}`,
        input.settledAt === undefined ? "running" : "completed",
        input.acceptedAt,
        input.settledAt ?? null,
      );
  }

  database
    .prepare(`INSERT INTO flue_conversation_stream_batches
      (path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id)
      VALUES (?, 0, 'producer', 0, 0, '[]', ?)`)
    .run(input.path, input.submissionId ?? "missing-submission");
}

function countRows(database: DatabaseSync, table: string) {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
}

describe("Flue transcript retention", () => {
  it("dry-runs by default, then deletes only expired settled conversation data", () => {
    const path = temporaryDatabasePath();
    createMigratedDatabase(path);
    const database = new DatabaseSync(path);
    seedConversation(database, { path: "old-path", submissionId: "old-submission", acceptedAt: 1_000, settledAt: 1_500 });
    seedConversation(database, { path: "recent-path", submissionId: "recent-submission", acceptedAt: 8_500, settledAt: 9_000 });
    seedConversation(database, { path: "active-path", submissionId: "active-submission", acceptedAt: 1_000 });
    seedConversation(database, { path: "unknown-path", acceptedAt: 1_000 });
    database
      .prepare(`INSERT INTO flue_conversation_stream_batch_chunks
        (path, seq, chunk_index, chunk_count, data) VALUES ('old-path', 0, 0, 1, 'chunk')`)
      .run();
    database
      .prepare(`INSERT INTO flue_conversation_fold_checkpoints
        (path, head_offset, incarnation, format_version, data) VALUES ('old-path', '1', 'incarnation', 1, '{}')`)
      .run();
    database
      .prepare(`INSERT INTO flue_conversation_fold_checkpoint_chunks
        (path, chunk_index, data) VALUES ('old-path', 0, 'chunk')`)
      .run();
    database
      .prepare(`INSERT INTO flue_attachments
        (stream_path, attachment_id, mime_type, byte_size, digest, conversation_id, chunk_count, created_at)
        VALUES ('old-path', 'attachment', 'text/plain', 1, 'digest', 'conversation', 1, 1000)`)
      .run();
    database
      .prepare(`INSERT INTO flue_attachment_chunks
        (stream_path, attachment_id, chunk_index, bytes) VALUES ('old-path', 'attachment', 0, ?)`)
      .run(new Uint8Array([1]));
    database
      .prepare(`INSERT INTO flue_submission_chunks
        (submission_id, item_id, chunk_index, chunk_count, data)
        VALUES ('old-submission', 'item', 0, 1, 'chunk')`)
      .run();
    database.close();

    const dryRun = cleanupExpiredFlueData({ databasePath: path, retentionMs: 2_000, now: 10_000 });
    expect(dryRun).toEqual({
      applied: false,
      cutoff: 8_000,
      conversationPaths: 1,
      submissions: 1,
      rows: {
        attachmentChunks: 1,
        attachments: 1,
        foldCheckpointChunks: 1,
        foldCheckpoints: 1,
        streamBatchChunks: 1,
        streamBatches: 1,
        streams: 1,
        submissionChunks: 1,
      },
    });

    const beforeApply = new DatabaseSync(path, { readOnly: true });
    expect(countRows(beforeApply, "flue_conversation_streams")).toBe(4);
    expect(countRows(beforeApply, "flue_agent_submissions")).toBe(3);
    beforeApply.close();

    const applied = cleanupExpiredFlueData({ databasePath: path, retentionMs: 2_000, now: 10_000, apply: true });
    expect(applied).toEqual({ ...dryRun, applied: true });

    const afterApply = new DatabaseSync(path, { readOnly: true });
    expect(afterApply.prepare("SELECT path FROM flue_conversation_streams ORDER BY path").all()).toEqual([
      { path: "active-path" },
      { path: "recent-path" },
      { path: "unknown-path" },
    ]);
    expect(afterApply.prepare("SELECT submission_id FROM flue_agent_submissions ORDER BY submission_id").all()).toEqual([
      { submission_id: "active-submission" },
      { submission_id: "recent-submission" },
    ]);
    expect(countRows(afterApply, "flue_attachment_chunks")).toBe(0);
    expect(countRows(afterApply, "flue_attachments")).toBe(0);
    expect(countRows(afterApply, "flue_submission_chunks")).toBe(0);
    afterApply.close();
  });

  it("rolls back the entire cleanup if any ordered delete fails", () => {
    const path = temporaryDatabasePath();
    createMigratedDatabase(path);
    const database = new DatabaseSync(path);
    seedConversation(database, { path: "old-path", submissionId: "old-submission", acceptedAt: 1_000, settledAt: 1_500 });
    database.exec(`CREATE TRIGGER prevent_stream_delete
      BEFORE DELETE ON flue_conversation_streams
      BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    database.close();

    expect(() =>
      cleanupExpiredFlueData({ databasePath: path, retentionMs: 2_000, now: 10_000, apply: true }),
    ).toThrow("test rollback");

    const afterFailure = new DatabaseSync(path, { readOnly: true });
    expect(countRows(afterFailure, "flue_conversation_streams")).toBe(1);
    expect(countRows(afterFailure, "flue_conversation_stream_batches")).toBe(1);
    expect(countRows(afterFailure, "flue_agent_submissions")).toBe(1);
    afterFailure.close();
  });

  it("fails closed for missing or unmigrated databases and exposes a read-only readiness probe", () => {
    const missing = join(tmpdir(), `ask-jdp-does-not-exist-${process.pid}.db`);
    expect(checkFlueDatabaseReadiness(missing)).toEqual({ ok: false, reason: "missing" });
    expect(() => cleanupExpiredFlueData({ databasePath: missing, retentionMs: 1_000, apply: true })).toThrow(
      FlueRetentionConfigurationError,
    );

    const empty = temporaryDatabasePath();
    new DatabaseSync(empty).close();
    expect(checkFlueDatabaseReadiness(empty)).toEqual({ ok: false, reason: "schema_missing" });
    expect(() => cleanupExpiredFlueData({ databasePath: empty, retentionMs: 1_000, apply: true })).toThrow(
      FlueRetentionConfigurationError,
    );

    createMigratedDatabase(empty);
    expect(checkFlueDatabaseReadiness(empty)).toEqual({ ok: true });

    const writer = new DatabaseSync(empty);
    writer.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE");
    expect(checkFlueDatabaseReadiness(empty)).toEqual({ ok: true });
    writer.exec("ROLLBACK");
    writer.close();
  });

  it("enforces a bounded production TTL during quiescent adapter startup", async () => {
    const path = temporaryDatabasePath();
    createMigratedDatabase(path);
    const now = 100 * 60 * 60 * 1_000;
    const database = new DatabaseSync(path);
    seedConversation(database, {
      path: "expired-path",
      submissionId: "expired-submission",
      acceptedAt: now - 11 * 60 * 60 * 1_000,
      settledAt: now - 10 * 60 * 60 * 1_000,
    });
    seedConversation(database, {
      path: "retained-path",
      submissionId: "retained-submission",
      acceptedAt: now - 8 * 60 * 60 * 1_000,
      settledAt: now - 7 * 60 * 60 * 1_000,
    });
    database.close();

    const managed = createRetentionManagedFluePersistence(
      path,
      { NODE_ENV: "production", ASK_JDP_TRANSCRIPT_RETENTION_HOURS: "9" },
      () => now,
    );
    await managed.migrate?.();
    await managed.close?.();

    const afterStartup = new DatabaseSync(path, { readOnly: true });
    expect(afterStartup.prepare("SELECT path FROM flue_conversation_streams").all()).toEqual([{ path: "retained-path" }]);
    afterStartup.close();
  });

  it("uses a short bounded retention policy that remains longer than an employer session", () => {
    expect(resolveTranscriptRetentionMs({})).toBe(DEFAULT_TRANSCRIPT_RETENTION_HOURS * 60 * 60 * 1_000);
    expect(resolveTranscriptRetentionMs({ ASK_JDP_TRANSCRIPT_RETENTION_HOURS: "9" })).toBe(9 * 60 * 60 * 1_000);
    expect(() => resolveTranscriptRetentionMs({ ASK_JDP_TRANSCRIPT_RETENTION_HOURS: "8" })).toThrow(
      FlueRetentionConfigurationError,
    );
    expect(() => resolveTranscriptRetentionMs({ ASK_JDP_TRANSCRIPT_RETENTION_HOURS: "169" })).toThrow(
      FlueRetentionConfigurationError,
    );
  });
});

describe("bounded in-process rate limiting", () => {
  it("fails closed at the key ceiling and admits a new key after expired windows are swept", async () => {
    let now = 1_000;
    const app = new Hono();
    app.use(
      "/limited",
      createRateLimiter(1, 1_000, (context) => context.req.header("x-test-key"), {
        maxTrackedKeys: 2,
        sweepEvery: 100,
        now: () => now,
      }),
    );
    app.get("/limited", (context) => context.text("ok"));

    expect((await app.request("/limited", { headers: { "x-test-key": "a" } })).status).toBe(200);
    expect((await app.request("/limited", { headers: { "x-test-key": "b" } })).status).toBe(200);

    const atCapacity = await app.request("/limited", { headers: { "x-test-key": "c" } });
    expect(atCapacity.status).toBe(429);
    expect(atCapacity.headers.get("retry-after")).toBe("1");

    now = 2_000;
    expect((await app.request("/limited", { headers: { "x-test-key": "c" } })).status).toBe(200);
  });

  it("rejects configurations that cannot provide a finite bound", () => {
    expect(() => createRateLimiter(1, 1_000, undefined, { maxTrackedKeys: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter(1, 1_000, undefined, { sweepEvery: 0 })).toThrow(RangeError);
  });
});
