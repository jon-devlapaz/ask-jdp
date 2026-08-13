#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "1.0";
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ORIGIN = "http://127.0.0.1:3000";
const LOCAL_TIMEOUT_MS = 5_000;
const MAX_LOCAL_RESPONSE_BYTES = 16 * 1024;
const STATIC_TIMEOUT_MS = 10 * 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const WORKTREE_TIMEOUT_MS = 60_000;
const TERMINATION_GRACE_MS = 2_000;
const CHECK_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]);
const STATIC_ARTIFACTS = [
  "dist/client/index.html",
  "dist/server.mjs",
  "dist/server/index.js",
  "dist/.openai/hosting.json",
];
const OPTIONAL_CHECKS = [
  ["AJDP-MODEL-001", "Live model evaluation is excluded from this receipt's scope."],
  ["AJDP-INGRESS-001", "Public ingress inspection is excluded from this receipt's scope."],
  ["AJDP-PUBLIC-001", "Public HTTP probing is excluded from this receipt's scope."],
  ["AJDP-BROWSER-001", "Browser journey verification is excluded from this receipt's scope."],
  ["AJDP-ROLLBACK-001", "Rollback is a human-authorized operation and is excluded from this receipt's scope."],
];
let receivedSignal = null;
let interruptActiveWork = null;

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function durationSince(startedAt) {
  return Date.now() - startedAt;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: false,
    timeout: options.timeout,
    killSignal: "SIGTERM",
  });
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // A process may exit between the close check and the signal. The caller
    // still waits for the child close event before producing a receipt.
  }
}

function runBounded(command, args, options) {
  return new Promise((resolveRun) => {
    let child;
    let spawnError = null;
    let timedOut = false;
    let interruptedSignal = null;
    let forceTimer = null;
    let timeoutTimer = null;
    let settled = false;

    const beginTermination = (signal = null) => {
      if (settled) return;
      if (signal && !interruptedSignal) interruptedSignal = signal;
      signalProcessGroup(child, "SIGTERM");
      if (!forceTimer) {
        forceTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
      }
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        stdio: options.stdio ?? ["ignore", 2, 2],
        shell: false,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolveRun({ status: null, signal: null, error, timed_out: false, interrupted_signal: null });
      return;
    }

    interruptActiveWork = (signal) => beginTermination(signal);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      beginTermination();
    }, options.timeout);

    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (status, signal) => {
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
      if (timedOut || interruptedSignal) signalProcessGroup(child, "SIGKILL");
      if (interruptActiveWork) interruptActiveWork = null;
      resolveRun({
        status,
        signal,
        error: spawnError,
        timed_out: timedOut,
        interrupted_signal: interruptedSignal,
      });
    });
  });
}

function installSignalHandlers() {
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (!receivedSignal) receivedSignal = signal;
      interruptActiveWork?.(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

function parseGitStatus(output) {
  const records = output.split("\0").filter(Boolean);
  const dirtyPaths = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const path = record.slice(3);
    dirtyPaths.push(path);

    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[index + 1];
      if (originalPath) {
        dirtyPaths.push(originalPath);
        index += 1;
      }
    }
  }

  return dirtyPaths.sort();
}

export function aggregateVerdict(checks) {
  const required = checks.filter((check) => check.required);
  if (required.length === 0 || checks.some((check) => !CHECK_STATUSES.has(check.status))) return "BLOCKED";
  if (required.some((check) => check.status === "FAIL")) return "FAIL";
  if (required.some((check) => check.status === "BLOCKED")) return "BLOCKED";
  if (required.some((check) => check.status === "NOT_RUN")) return "INCOMPLETE";
  return "PASS";
}

function gitValue(repoRoot, args) {
  const result = run("git", args, { cwd: repoRoot });
  if (result.error || result.status !== 0) {
    const detail = result.error?.code ?? `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed (${detail})`);
  }
  return result.stdout.trim();
}

function collectSubject(cwd) {
  const rootResult = run("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (rootResult.error || rootResult.status !== 0) {
    const detail = rootResult.error?.code ?? `exit ${rootResult.status}`;
    throw new Error(`Unable to identify Git repository (${detail}).`);
  }

  const repoRoot = rootResult.stdout.trim();
  const head = gitValue(repoRoot, ["rev-parse", "HEAD"]);
  const branchResult = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: repoRoot,
  });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : null;
  const statusResult = run("git", ["status", "--porcelain=v1", "-z"], { cwd: repoRoot });

  if (statusResult.error || statusResult.status !== 0) {
    const detail = statusResult.error?.code ?? `exit ${statusResult.status}`;
    throw new Error(`Unable to inspect Git working tree (${detail}).`);
  }

  const dirtyPaths = parseGitStatus(statusResult.stdout);
  return {
    repoRoot,
    subject: {
      repo_root: repoRoot,
      head,
      ref: branch ? { kind: "branch", name: branch } : { kind: "detached", name: head },
      clean: dirtyPaths.length === 0,
      dirty_paths: dirtyPaths,
    },
  };
}

function unavailableSubject(repoRoot) {
  return {
    repo_root: repoRoot,
    head: null,
    ref: { kind: "unknown", name: null },
    clean: null,
    dirty_paths: [],
  };
}

function sameGitIdentity(before, after) {
  return before.head === after.head && before.ref.kind === after.ref.kind && before.ref.name === after.ref.name;
}

function receiptSubject(before, after, gitUnavailable = false) {
  const dirty_paths = [...new Set([...before.dirty_paths, ...after.dirty_paths])].sort();
  return {
    repo_root: before.repo_root,
    head: before.head,
    ref: before.ref,
    clean: gitUnavailable ? null : before.clean && after.clean && sameGitIdentity(before, after),
    identity_available: !gitUnavailable,
    dirty_paths,
    git_before: {
      head: before.head,
      ref: before.ref,
      clean: before.clean,
      dirty_paths: before.dirty_paths,
    },
    git_after: {
      head: after.head,
      ref: after.ref,
      clean: after.clean,
      dirty_paths: after.dirty_paths,
    },
  };
}

function revisionCheck(before, after, gitUnavailable = false) {
  const startedAt = Date.now();
  if (gitUnavailable) {
    return {
      id: "AJDP-REL-001",
      required: true,
      probe: "git rev-parse HEAD; git status --porcelain=v1 -z (before and after static verification)",
      status: "BLOCKED",
      observation: "Git repository identity or working-tree state could not be collected for the full verification run.",
      limitation: "Without Git identity and status, the receipt cannot establish one clean, stable candidate revision.",
      duration_ms: durationSince(startedAt),
    };
  }
  if (before.clean && after.clean && sameGitIdentity(before, after)) {
    return {
      id: "AJDP-REL-001",
      required: true,
      probe: "git status --porcelain=v1 -z",
      status: "PASS",
      observation: `Clean working tree before and after static verification at ${before.head}.`,
      limitation: null,
      duration_ms: durationSince(startedAt),
    };
  }

  const identityChanged = !sameGitIdentity(before, after);
  const observation = identityChanged
    ? "Git HEAD or ref changed during static verification."
    : `Working tree was not clean before and after static verification (${before.dirty_paths.length} path${before.dirty_paths.length === 1 ? "" : "s"} before; ${after.dirty_paths.length} path${after.dirty_paths.length === 1 ? "" : "s"} after).`;

  return {
    id: "AJDP-REL-001",
    required: true,
    probe: "git status --porcelain=v1 -z",
    status: "FAIL",
    observation,
    limitation: "The receipt does not establish one clean, stable Git revision for the full verification run.",
    duration_ms: durationSince(startedAt),
  };
}

function blockedStaticCheck(probe, observation, limitation, duration_ms, artifacts = []) {
  return {
    id: "AJDP-STATIC-001",
    required: true,
    probe,
    status: "BLOCKED",
    observation,
    limitation,
    duration_ms,
    artifacts,
  };
}

async function staticCheck(repoRoot, head) {
  const startedAt = Date.now();
  const probe = `isolated ${head ?? "unknown revision"}: npm ci; npm run verify (timeouts ${INSTALL_TIMEOUT_MS}ms/${STATIC_TIMEOUT_MS}ms)`;
  const artifacts = [];
  if (!head) {
    return blockedStaticCheck(
      probe,
      "Static verification could not start because the Git revision is unavailable.",
      "The verifier requires an immutable Git revision for its disposable worktree.",
      durationSince(startedAt),
    );
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "ask-jdp-receipt-"));
  const worktreeRoot = join(temporaryRoot, "candidate");
  let worktreeAdded = false;
  let result;

  try {
    const addResult = await runBounded("git", ["worktree", "add", "--detach", worktreeRoot, head], {
      cwd: repoRoot,
      stdio: ["ignore", 2, 2],
      timeout: WORKTREE_TIMEOUT_MS,
    });
    if (addResult.error || addResult.timed_out || addResult.interrupted_signal || addResult.signal || addResult.status !== 0) {
      return blockedStaticCheck(
        probe,
        "The disposable Git worktree could not be prepared.",
        "Static verification did not touch the active checkout.",
        durationSince(startedAt),
      );
    }
    worktreeAdded = true;

    const installResult = await runBounded("npm", ["ci"], {
      cwd: worktreeRoot,
      stdio: ["ignore", 2, 2],
      timeout: INSTALL_TIMEOUT_MS,
    });
    if (installResult.error || installResult.timed_out || installResult.interrupted_signal || installResult.signal) {
      return blockedStaticCheck(
        probe,
        "Dependencies could not be installed in the disposable worktree.",
        "The candidate verifier did not run; the active checkout was not modified.",
        durationSince(startedAt),
      );
    }
    if (installResult.status !== 0) {
      return {
        id: "AJDP-STATIC-001",
        required: true,
        probe,
        status: "FAIL",
        observation: `The isolated npm ci exited ${installResult.status}.`,
        limitation: "The committed dependency manifest and lockfile did not produce an installable candidate.",
        duration_ms: durationSince(startedAt),
        artifacts,
      };
    }

    result = await runBounded("npm", ["run", "verify"], {
      cwd: worktreeRoot,
      stdio: ["ignore", 2, 2],
      timeout: STATIC_TIMEOUT_MS,
    });

    for (const relativePath of STATIC_ARTIFACTS) {
      const path = resolve(worktreeRoot, relativePath);
      try {
        artifacts.push({ path: relativePath, sha256: sha256File(path) });
      } catch {
        artifacts.push({ path: relativePath, sha256: null, observation: "Missing or unreadable." });
      }
    }
  } finally {
    if (worktreeAdded) {
      await runBounded("git", ["worktree", "remove", "--force", worktreeRoot], {
        cwd: repoRoot,
        stdio: ["ignore", 2, 2],
        timeout: WORKTREE_TIMEOUT_MS,
      });
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const missingArtifacts = artifacts.filter((artifact) => artifact.sha256 === null);
  const duration_ms = durationSince(startedAt);
  if (result.interrupted_signal) {
    return blockedStaticCheck(probe, `npm run verify was interrupted by ${result.interrupted_signal}.`, "The isolated static verifier did not complete.", duration_ms, artifacts);
  }

  if (result.timed_out) {
    return blockedStaticCheck(probe, `npm run verify exceeded ${STATIC_TIMEOUT_MS}ms and its process group was terminated.`, "The isolated static verifier did not complete within its execution bound.", duration_ms, artifacts);
  }

  if (result.error) {
    return blockedStaticCheck(probe, `Unable to execute npm (${result.error.code ?? result.error.name}).`, "The isolated npm verifier could not execute in this environment.", duration_ms, artifacts);
  }

  if (result.signal) {
    return blockedStaticCheck(probe, `npm run verify was terminated by ${result.signal}.`, "The isolated static verifier did not complete.", duration_ms, artifacts);
  }

  if (result.status !== 0) {
    return {
      id: "AJDP-STATIC-001",
      required: true,
      probe,
      status: "FAIL",
      observation: `The isolated npm run verify exited ${result.status}.`,
      limitation: null,
      duration_ms,
      artifacts,
    };
  }

  if (missingArtifacts.length > 0) {
    return {
      id: "AJDP-STATIC-001",
      required: true,
      probe,
      status: "FAIL",
      observation: `The isolated npm run verify passed, but ${missingArtifacts.length} required artifact${missingArtifacts.length === 1 ? " is" : "s are"} missing or unreadable.`,
      limitation: null,
      duration_ms,
      artifacts,
    };
  }

  return {
    id: "AJDP-STATIC-001",
    required: true,
    probe,
    status: "PASS",
    observation: "The isolated npm run verify passed; required build artifacts were hashed.",
    limitation: "Verification ran in a disposable worktree at the recorded HEAD and did not rewrite the active checkout's production assets.",
    duration_ms,
    artifacts,
  };
}

export function isHealthyPayload(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.ok === true;
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOCAL_RESPONSE_BYTES) {
    await response.body?.cancel();
    return { ok: false, reason: "declared_too_large" };
  }
  if (!response.body) return { ok: false, reason: "missing_body" };

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOCAL_RESPONSE_BYTES) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

async function localJsonCheck({ id, path, label, limitation }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
  const url = `${LOCAL_ORIGIN}${path}`;
  const probe = `GET ${url} (timeout ${LOCAL_TIMEOUT_MS}ms; max body ${MAX_LOCAL_RESPONSE_BYTES} bytes)`;

  try {
    interruptActiveWork = () => controller.abort();
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (response.status !== 200) {
      await response.body?.cancel();
      return {
        id,
        required: true,
        probe,
        status: "FAIL",
        observation: `${label} returned HTTP ${response.status}.`,
        limitation,
        duration_ms: durationSince(startedAt),
      };
    }

    const body = await readBoundedResponse(response);
    if (!body.ok) {
      const explanation = body.reason === "declared_too_large" || body.reason === "too_large"
        ? `response body exceeded ${MAX_LOCAL_RESPONSE_BYTES} bytes`
        : "response had no readable body";
      return {
        id,
        required: true,
        probe,
        status: "FAIL",
        observation: `${label} returned HTTP ${response.status}, but ${explanation}.`,
        limitation,
        duration_ms: durationSince(startedAt),
      };
    }

    let payload;
    try {
      payload = JSON.parse(body.text);
    } catch {
      return {
        id,
        required: true,
        probe,
        status: "FAIL",
        observation: `${label} returned HTTP ${response.status}, but not valid JSON.`,
        limitation,
        duration_ms: durationSince(startedAt),
      };
    }

    if (!isHealthyPayload(payload)) {
      return {
        id,
        required: true,
        probe,
        status: "FAIL",
        observation: `${label} returned HTTP ${response.status}, but JSON did not contain ok: true.`,
        limitation,
        duration_ms: durationSince(startedAt),
      };
    }

    return {
      id,
      required: true,
      probe,
      status: "PASS",
      observation: `${label} returned HTTP ${response.status} with JSON ok: true.`,
      limitation,
      duration_ms: durationSince(startedAt),
    };
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return {
      id,
      required: true,
      probe,
      status: receivedSignal ? "BLOCKED" : "FAIL",
      observation: receivedSignal
        ? `${label} probe was interrupted by ${receivedSignal}.`
        : isTimeout
        ? `${label} did not respond within ${LOCAL_TIMEOUT_MS}ms.`
        : `${label} request failed (${error?.name ?? "unknown error"}).`,
      limitation: receivedSignal ? "The requested local probe did not complete." : limitation,
      duration_ms: durationSince(startedAt),
    };
  } finally {
    clearTimeout(timeout);
    interruptActiveWork = null;
  }
}

function interruptedLocalCheck(id, path, label) {
  return {
    id,
    required: true,
    probe: `GET ${LOCAL_ORIGIN}${path}`,
    status: "BLOCKED",
    observation: `${label} was not started because the receipt run was interrupted by ${receivedSignal}.`,
    limitation: "The requested local probe did not run.",
    duration_ms: 0,
  };
}

function interruptionCheck(signal) {
  return {
    id: "AJDP-EXEC-001",
    required: true,
    probe: "Receipt execution completed without SIGINT or SIGTERM",
    status: "BLOCKED",
    observation: `Receipt execution was interrupted by ${signal}.`,
    limitation: "An interrupted run cannot establish the scoped claim, even if individual probes completed.",
    duration_ms: 0,
  };
}

function localNotRunChecks() {
  return [
    ["AJDP-LOCAL-001", "Local liveness is outside the candidate-only claim; rerun with --include-local to require it."],
    ["AJDP-READY-001", "App-reported local readiness is outside the candidate-only claim; rerun with --include-local to require it."],
  ].map(([id, limitation]) => ({
    id,
    required: false,
    probe: "Not performed",
    status: "NOT_RUN",
    observation: "Not run.",
    limitation,
    duration_ms: 0,
  }));
}

function optionalChecks() {
  return OPTIONAL_CHECKS.map(([id, reason]) => ({
    id,
    required: false,
    probe: "Not performed",
    status: "NOT_RUN",
    observation: "Not run.",
    limitation: reason,
    duration_ms: 0,
  }));
}

function usage() {
  return `Usage:\n  npm run --silent verify:receipt [-- --include-local]\n  node scripts/verify-receipt.mjs [--include-local] [--self-test] [--help]\n\nUse npm's --silent flag for a machine-parseable stdout stream. The script writes one JSON verification receipt to stdout; progress and child-command logs go to stderr.`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runSelfTest() {
  const requiredPass = { required: true, status: "PASS" };
  assert(aggregateVerdict([requiredPass, { required: false, status: "NOT_RUN" }]) === "PASS", "optional checks must not lower PASS");
  assert(aggregateVerdict([{ required: true, status: "FAIL" }, { required: true, status: "BLOCKED" }]) === "FAIL", "FAIL must dominate");
  assert(aggregateVerdict([{ required: true, status: "BLOCKED" }, { required: true, status: "NOT_RUN" }]) === "BLOCKED", "BLOCKED must dominate NOT_RUN");
  assert(aggregateVerdict([{ required: true, status: "NOT_RUN" }]) === "INCOMPLETE", "required NOT_RUN must be incomplete");
  assert(aggregateVerdict([]) === "BLOCKED", "a receipt without required checks must not pass");
  assert(aggregateVerdict([{ required: true, status: "UNKNOWN" }]) === "BLOCKED", "an unknown check status must not pass");
  assert(isHealthyPayload({ ok: true }), "healthy JSON must be accepted");
  assert(!isHealthyPayload({ ok: false }), "unhealthy JSON must be rejected");
  assert(!isHealthyPayload([]), "arrays must be rejected");
  assert(sha256Text("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 helper must be deterministic");
  assert(JSON.stringify(parseGitStatus(" M alpha\0R  beta\0alpha\0?? new-file\0")) === JSON.stringify(["alpha", "alpha", "beta", "new-file"]), "Git status parser must preserve paths");
  const clean = { head: "abc", ref: { kind: "branch", name: "main" }, clean: true, dirty_paths: [] };
  const dirty = { ...clean, clean: false, dirty_paths: ["changed.ts"] };
  assert(revisionCheck(clean, clean).status === "PASS", "stable clean status must pass");
  assert(revisionCheck(clean, dirty).status === "FAIL", "working-tree drift must fail");
  assert(revisionCheck(clean, { ...clean, head: "def" }).status === "FAIL", "HEAD drift must fail");
  const boundedChild = await runBounded(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000)"],
    { cwd: SCRIPT_ROOT, stdio: ["ignore", "ignore", "ignore"], timeout: 25 },
  );
  assert(boundedChild.timed_out, "bounded subprocess must report a timeout");
  assert(boundedChild.status === null, "timed-out subprocess must not report a successful exit");
  process.stderr.write("verify-receipt self-test passed.\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const allowed = new Set(["--include-local", "--self-test"]);
  const unknown = [...args].filter((arg) => !allowed.has(arg));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument(s): ${unknown.join(", ")}\n${usage()}\n`);
    return 2;
  }
  if (args.has("--self-test")) {
    await runSelfTest();
    return 0;
  }

  receivedSignal = null;
  const removeSignalHandlers = installSignalHandlers();
  const started_at = new Date().toISOString();
  const includeLocal = args.has("--include-local");
  const claim = includeLocal
    ? {
        id: "AJDP-LOCAL-001",
        text: "The specified Ask JDP candidate is clean and passes static verification; independently, the fixed loopback liveness and app-reported readiness endpoints respond with JSON ok: true. This receipt does not bind that responder to the candidate revision.",
        required_check_ids: ["AJDP-REL-001", "AJDP-STATIC-001", "AJDP-LOCAL-001", "AJDP-READY-001"],
      }
    : {
        id: "AJDP-CANDIDATE-001",
        text: "The specified Ask JDP candidate is a clean Git revision that passes static verification and has the required build artifacts.",
        required_check_ids: ["AJDP-REL-001", "AJDP-STATIC-001"],
      };

  let repoRoot = SCRIPT_ROOT;
  let subjectBefore = unavailableSubject(SCRIPT_ROOT);
  let subjectAfter = unavailableSubject(SCRIPT_ROOT);
  let gitUnavailable = false;
  try {
    ({ repoRoot, subject: subjectBefore } = collectSubject(SCRIPT_ROOT));
  } catch {
    gitUnavailable = true;
  }

  process.stderr.write(`Verifying ${claim.id} at ${subjectBefore.head ?? "unknown Git revision"}.\n`);
  const staticResult = await staticCheck(repoRoot, subjectBefore.head);
  try {
    ({ subject: subjectAfter } = collectSubject(repoRoot));
  } catch {
    gitUnavailable = true;
  }
  const subject = receiptSubject(subjectBefore, subjectAfter, gitUnavailable);
  const checks = [revisionCheck(subjectBefore, subjectAfter, gitUnavailable), staticResult];
  if (includeLocal) {
    const localChecks = [
      {
        id: "AJDP-LOCAL-001",
        path: "/api/live",
        label: "Local liveness endpoint",
        limitation: "This proves a responder at the fixed loopback endpoint, not its process identity or Git revision.",
      },
      {
        id: "AJDP-READY-001",
        path: "/api/health",
        label: "Readiness endpoint",
        limitation: "This is app-reported readiness and may be cached; it is not a fresh model evaluation or process-revision proof.",
      },
    ];
    for (const localCheck of localChecks) {
      checks.push(receivedSignal
        ? interruptedLocalCheck(localCheck.id, localCheck.path, localCheck.label)
        : await localJsonCheck(localCheck));
    }
  } else {
    checks.push(...localNotRunChecks());
  }
  checks.push(...optionalChecks());

  if (receivedSignal) checks.push(interruptionCheck(receivedSignal));

  const receipt = {
    schema_version: SCHEMA_VERSION,
    invocation: {
      machine_command: `npm run --silent verify:receipt${includeLocal ? " -- --include-local" : ""}`,
      note: "npm run without --silent writes npm lifecycle text before the JSON receipt.",
    },
    claim,
    subject,
    environment: { node_version: process.version },
    started_at,
    finished_at: new Date().toISOString(),
    checks,
    verdict: receivedSignal ? "BLOCKED" : aggregateVerdict(checks),
  };

  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  removeSignalHandlers();
  if (receivedSignal === "SIGINT") return 130;
  if (receivedSignal === "SIGTERM") return 143;
  return receipt.verdict === "PASS" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`verify-receipt failed before a receipt could be created: ${error.message}\n`);
      process.exitCode = 2;
    });
}
