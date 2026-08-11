#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keychainService = process.env.ASK_JDP_API_KEYCHAIN_SERVICE?.trim() || 'ask-jdp-api-key';

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} exited after ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

let apiKey;
try {
  apiKey = execFileSync(
    '/usr/bin/security',
    ['find-generic-password', '-s', keychainService, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
} catch {
  console.error(`Unable to read the macOS Keychain service ${keychainService}.`);
  process.exit(1);
}

if (!apiKey) {
  console.error(`The macOS Keychain service ${keychainService} is empty.`);
  process.exit(1);
}

const env = {
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  SOCRATINK_API_KEY: apiKey,
  SOCRATINK_BASE_URL: process.env.SOCRATINK_BASE_URL || 'http://127.0.0.1:3001/v1',
};

const buildCode = await run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.config.ui.ts'], env);
if (buildCode !== 0) process.exit(buildCode);

const devCode = await run(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'dev', ...process.argv.slice(2)],
  env,
);
process.exit(devCode);
