#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { secureRuntimePaths } from "./runtime-permissions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "dist", "server.mjs");
const defaultDatabasePath = path.join(root, "data", "ask-jdp-production.db");
const databasePath = process.env.FLUE_DATABASE_PATH || defaultDatabasePath;
const maintenanceIntervalMs = 6 * 60 * 60 * 1_000;

process.umask(0o077);
secureRuntimePaths({ databasePath, defaultDatabasePath });

if (!existsSync(server) || !readFileSync(server, "utf8").includes("ASK_JDP_BIND_HOST")) {
  throw new Error("Container production entry is missing the verified listener restriction.");
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  ASK_JDP_BIND_HOST: process.env.ASK_JDP_BIND_HOST || "0.0.0.0",
  ASK_JDP_TRANSCRIPT_RETENTION_HOURS:
    process.env.ASK_JDP_TRANSCRIPT_RETENTION_HOURS || "18",
  FLUE_DATABASE_PATH: databasePath,
};

let activeChild;
let stopSignal;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopSignal = signal;
    activeChild?.kill(signal);
  });
}

while (!stopSignal) {
  let maintenanceRequested = false;
  activeChild = spawn(process.execPath, [server], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  const maintenanceRestart = setTimeout(() => {
    maintenanceRequested = true;
    activeChild?.kill("SIGTERM");
  }, maintenanceIntervalMs);

  const outcome = await new Promise((resolve) => {
    activeChild.once("error", (error) => resolve({ error }));
    activeChild.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(maintenanceRestart);
  activeChild = undefined;

  if (stopSignal) break;
  if (outcome.error) throw outcome.error;
  if (!maintenanceRequested) {
    if (outcome.signal) throw new Error(`Ask JDP stopped after ${outcome.signal}.`);
    process.exit(outcome.code ?? 1);
  }
}
