#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(root, "dist", "server.mjs");
const generatedCall = 'startFlueNodeServer({ port: Number.parseInt(process.env.PORT || "3000", 10) })';
const restrictedCall =
  'startFlueNodeServer({ port: Number.parseInt(process.env.PORT || "3000", 10), hostname: process.env.ASK_JDP_BIND_HOST || "127.0.0.1" })';

const source = await readFile(entryPath, "utf8");
if (!source.includes(generatedCall)) {
  throw new Error("Flue's generated Node entry changed; refusing to publish an unverified listener binding.");
}

await writeFile(entryPath, source.replace(generatedCall, restrictedCall));
console.log("Restricted the production Node listener to the configured bind host.");
