import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSocratinkReadiness,
  DEFAULT_SOCRATINK_MODEL_ID,
  SOCRATINK_MODEL_ID,
} from "../src/agents/provider";

const originalApiKey = process.env.SOCRATINK_API_KEY;
const originalBaseUrl = process.env.SOCRATINK_BASE_URL;

afterEach(() => {
  vi.useRealTimers();
  if (originalApiKey === undefined) delete process.env.SOCRATINK_API_KEY;
  else process.env.SOCRATINK_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.SOCRATINK_BASE_URL;
  else process.env.SOCRATINK_BASE_URL = originalBaseUrl;
});

describe("provider readiness", () => {
  it("defaults to automatic gateway routing", () => {
    expect(DEFAULT_SOCRATINK_MODEL_ID).toBe("auto");
  });

  it("fails closed when the provider credential is absent", async () => {
    delete process.env.SOCRATINK_API_KEY;
    await expect(checkSocratinkReadiness({ force: true })).resolves.toEqual({
      ok: false,
      reason: "configuration",
    });
  });

  it("fails when the configured completion route returns no usable choice", async () => {
    process.env.SOCRATINK_API_KEY = "test-only-key";
    process.env.SOCRATINK_BASE_URL = "https://provider.example/v1";
    const fetchImpl = async () => Response.json({ choices: [] });

    await expect(checkSocratinkReadiness({ fetchImpl, force: true })).resolves.toEqual({
      ok: false,
      reason: "model_unavailable",
    });
  });

  it("fails closed for a malformed successful completion response", async () => {
    process.env.SOCRATINK_API_KEY = "test-only-key";
    process.env.SOCRATINK_BASE_URL = "https://provider.example/v1";
    const fetchImpl = async () => Response.json({ choices: [{}] });

    await expect(checkSocratinkReadiness({ fetchImpl, force: true })).resolves.toEqual({
      ok: false,
      reason: "model_unavailable",
    });
  });

  it("fails closed when the readiness probe timeout aborts the request", async () => {
    vi.useFakeTimers();
    process.env.SOCRATINK_API_KEY = "test-only-key";
    process.env.SOCRATINK_BASE_URL = "https://provider.example/v1";
    let signal: AbortSignal | undefined;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const requestSignal = init?.signal;
        if (!requestSignal) throw new Error("Expected the readiness probe to supply an abort signal.");
        signal = requestSignal;
        requestSignal.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
      });

    const readiness = checkSocratinkReadiness({ fetchImpl, force: true, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(readiness).resolves.toEqual({ ok: false, reason: "provider_unreachable" });
    expect(signal?.aborted).toBe(true);
  });

  it("reports ready only when the configured route is available", async () => {
    process.env.SOCRATINK_API_KEY = "test-only-key";
    process.env.SOCRATINK_BASE_URL = "https://provider.example/v1";
    let authorization = "";
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    };

    await expect(checkSocratinkReadiness({ fetchImpl, force: true })).resolves.toEqual({ ok: true });
    expect(authorization).toBe("Bearer test-only-key");
    expect(requestUrl).toBe("https://provider.example/v1/chat/completions");
    expect(requestBody).toMatchObject({ model: SOCRATINK_MODEL_ID, max_tokens: 1, stream: false });
  });
});
