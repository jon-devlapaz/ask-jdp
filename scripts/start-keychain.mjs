#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { secureRuntimePaths } from "./runtime-permissions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "dist", "server.mjs");
const maintenanceIntervalMs = 6 * 60 * 60 * 1_000;
const defaultDatabasePath = path.join(root, "data", "ask-jdp-production.db");
const databasePath = process.env.FLUE_DATABASE_PATH || defaultDatabasePath;
const logDirectory = process.env.ASK_JDP_LOG_DIRECTORY || path.join(root, "data", "logs");
const apiKeychainService = process.env.ASK_JDP_API_KEYCHAIN_SERVICE?.trim() || "ask-jdp-api-key";
const sessionKeychainService =
  process.env.ASK_JDP_SESSION_KEYCHAIN_SERVICE?.trim() || "ask-jdp-session-secret";
const publicOrigin = process.env.PUBLIC_ORIGIN?.trim();

if (!publicOrigin) {
  throw new Error("PUBLIC_ORIGIN is required for the production Keychain launcher.");
}

process.umask(0o077);
secureRuntimePaths({ databasePath, defaultDatabasePath, logDirectory });

function readKeychainSecret(service) {
  try {
    const value = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
    if (value) return value;
  } catch {
    // The actionable error below deliberately avoids exposing secret output.
  }
  throw new Error(`Unable to read the macOS Keychain service ${service}.`);
}

if (!existsSync(server)) {
  throw new Error("Missing dist/server.mjs. Run npm run build:node before starting production.");
}
if (!readFileSync(server, "utf8").includes("ASK_JDP_BIND_HOST")) {
  throw new Error("Production entry is missing the verified listener restriction. Run npm run build:node.");
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: process.env.PORT || "3000",
  ASK_JDP_BIND_HOST: process.env.ASK_JDP_BIND_HOST || "127.0.0.1",
  // An 18-hour cutoff plus a graceful restart at least every 6 hours deletes
  // completed conversations within 24 hours while remaining above the 8-hour session TTL.
  ASK_JDP_TRANSCRIPT_RETENTION_HOURS:
    process.env.ASK_JDP_TRANSCRIPT_RETENTION_HOURS || "18",
  FLUE_DATABASE_PATH: databasePath,
  SESSION_SECRET: readKeychainSecret(sessionKeychainService),
  SOCRATINK_API_KEY: readKeychainSecret(apiKeychainService),
  SOCRATINK_BASE_URL:
    process.env.SOCRATINK_BASE_URL || "http://127.0.0.1:3001/v1",
  SOCRATINK_MODEL_ID: process.env.SOCRATINK_MODEL_ID || "auto",
  PUBLIC_ORIGIN: publicOrigin,
  TRUST_PROXY: process.env.TRUST_PROXY || "true",
};

const child = spawn(process.execPath, [server], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: false,
});

let maintenanceRequested = false;
const maintenanceRestart = setTimeout(() => {
  maintenanceRequested = true;
  child.kill("SIGTERM");
}, maintenanceIntervalMs);

child.once("error", (error) => {
  clearTimeout(maintenanceRestart);
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  clearTimeout(maintenanceRestart);
  if (signal && !maintenanceRequested) console.error(`Ask JDP stopped after ${signal}.`);
  process.exit(maintenanceRequested ? 0 : (code ?? 1));
});
