import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { secureRuntimePaths } from "../scripts/runtime-permissions.mjs";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test("restricts the production Node listener to loopback by default", async () => {
  const entry = await readFile(new URL("../dist/server.mjs", import.meta.url), "utf8");
  assert.match(entry, /ASK_JDP_BIND_HOST/);
  assert.match(entry, /127\.0\.0\.1/);
});

test("keeps the container listener reachable without weakening the Mac default", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ASK_JDP_BIND_HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /ASK_JDP_TRANSCRIPT_RETENTION_HOURS=18/);
  assert.match(dockerfile, /CMD \["node", "scripts\/start-container\.mjs"\]/);
});

test("keeps isolated live evaluation out of the shared production client build", async () => {
  const harness = await readFile(new URL("../scripts/live-eval-keychain.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(harness, /vite\.config\.ui|build:ui|build --config/);
});

test("does not chmod an existing custom database parent directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ask-jdp-permissions-"));
  try {
    const sharedDirectory = path.join(root, "shared");
    const logDirectory = path.join(root, "logs");
    const databasePath = path.join(sharedDirectory, "ask-jdp.db");
    await mkdir(sharedDirectory, { mode: 0o755 });
    await chmod(sharedDirectory, 0o755);
    await writeFile(databasePath, "database-placeholder", { mode: 0o644 });

    secureRuntimePaths({
      databasePath,
      defaultDatabasePath: path.join(root, "owned", "ask-jdp.db"),
      logDirectory,
    });

    assert.equal((await stat(sharedDirectory)).mode & 0o777, 0o755);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    assert.equal((await stat(logDirectory)).mode & 0o777, 0o700);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
