import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Tighten only service-owned paths; never chmod an existing override parent. */
export function secureRuntimePaths({ databasePath, defaultDatabasePath, logDirectory }) {
  const databaseDirectory = path.dirname(databasePath);
  const databaseDirectoryExisted = existsSync(databaseDirectory);
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  if (!databaseDirectoryExisted || databasePath === defaultDatabasePath) {
    chmodSync(databaseDirectory, 0o700);
  }
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }

  if (logDirectory) {
    mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
    chmodSync(logDirectory, 0o700);
    for (const logName of ["service.log", "service-error.log"]) {
      const logPath = path.join(logDirectory, logName);
      if (existsSync(logPath)) chmodSync(logPath, 0o600);
    }
  }
}
