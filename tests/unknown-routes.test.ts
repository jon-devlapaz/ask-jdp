import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.SESSION_SECRET ??= "test-session-secret-that-is-at-least-thirty-two-bytes";
const { default: app } = await import("../src/app.ts");

const index = '<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';
const asset = 'console.log("routing fixture");';
const originalCwd = process.cwd();
let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(originalCwd, "tests/.routing-fixture-"));
  await mkdir(join(fixtureRoot, "dist/client/assets"), { recursive: true });
  await writeFile(join(fixtureRoot, "dist/client/index.html"), index);
  await writeFile(join(fixtureRoot, "dist/client/assets/app.js"), asset);
  process.chdir(fixtureRoot);
});

afterAll(async () => {
  process.chdir(originalCwd);
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe("Node document routing with isolated client fixtures", () => {
  it.each(["/foo", "/chat", "/ask/xyz"])("returns an explicit unknown-route document at %s", async (path) => {
    const response = await app.request(`http://ask-jdp.local${path}?source=share`, {
      headers: { accept: "text/html" },
    });
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toMatch(/unknown route|page not found/i);
    expect(body).toMatch(/<a\b[^>]*\bhref=["']\/["'][^>]*>/i);
  });

  it("preserves the root client document and a supported asset", async () => {
    const root = await app.request("http://ask-jdp.local/");
    expect(root.status).toBe(200);
    expect(await root.text()).toBe(index);
    const response = await app.request("http://ask-jdp.local/assets/app.js");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(asset);
  });

  it("preserves API liveness and JSON misses", async () => {
    const live = await app.request("http://ask-jdp.local/api/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });
    const missing = await app.request("http://ask-jdp.local/api/not-real");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });
});
