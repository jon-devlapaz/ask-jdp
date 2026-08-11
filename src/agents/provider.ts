import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { setProvider } from "@flue/runtime";

export const SOCRATINK_PROVIDER_ID = "socratink";
export const DEFAULT_SOCRATINK_MODEL_ID = "auto";
export const SOCRATINK_MODEL_ID = process.env.SOCRATINK_MODEL_ID?.trim() || DEFAULT_SOCRATINK_MODEL_ID;
export const DEFAULT_SOCRATINK_BASE_URL = "http://127.0.0.1:3001/v1";

export type ProviderReadiness =
  | { ok: true }
  | { ok: false; reason: "configuration" | "model_unavailable" | "provider_unreachable" };

type ReadinessOptions = {
  cacheMs?: number;
  fetchImpl?: typeof fetch;
  force?: boolean;
  now?: () => number;
  timeoutMs?: number;
};

let readinessCache: { expiresAt: number; result: ProviderReadiness } | undefined;
let readinessInFlight: Promise<ProviderReadiness> | undefined;

let configured = false;

/** Registers the only model provider Ask JDP is allowed to use. */
export function configureSocratinkProvider() {
  if (configured) return;

  setProvider(
    createProvider({
      id: SOCRATINK_PROVIDER_ID,
      name: "Socratink Free LLM API",
      auth: {
        apiKey: envApiKeyAuth("Socratink API key", ["SOCRATINK_API_KEY"]),
      },
      models: [
        {
          id: SOCRATINK_MODEL_ID,
          name: `Socratink configured model (${SOCRATINK_MODEL_ID})`,
          api: "openai-completions",
          provider: SOCRATINK_PROVIDER_ID,
          baseUrl: process.env.SOCRATINK_BASE_URL ?? DEFAULT_SOCRATINK_BASE_URL,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          // Some routed models spend part of this budget on hidden reasoning. Keep
          // enough headroom to finish the short public answer and source line.
          maxTokens: 2048,
        },
      ],
      api: openAICompletionsApi(),
    }),
  );
  configured = true;
}

/**
 * Bounded readiness probe for the configured provider route.
 *
 * The public health endpoint receives only the boolean result. The short cache
 * prevents a health-check flood from becoming a provider request flood.
 */
export async function checkSocratinkReadiness(options: ReadinessOptions = {}): Promise<ProviderReadiness> {
  const now = options.now ?? Date.now;
  const checkedAt = now();
  if (!options.force && readinessCache && readinessCache.expiresAt > checkedAt) {
    return readinessCache.result;
  }
  if (!options.force && readinessInFlight) return readinessInFlight;

  const check = async (): Promise<ProviderReadiness> => {
    const apiKey = process.env.SOCRATINK_API_KEY?.trim();
    const rawBaseUrl = process.env.SOCRATINK_BASE_URL?.trim() || DEFAULT_SOCRATINK_BASE_URL;
    if (!apiKey) return { ok: false, reason: "configuration" };

    let completionsUrl: URL;
    try {
      completionsUrl = new URL(`${rawBaseUrl.replace(/\/$/, "")}/chat/completions`);
    } catch {
      return { ok: false, reason: "configuration" };
    }

    try {
      const response = await (options.fetchImpl ?? fetch)(completionsUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: SOCRATINK_MODEL_ID,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 1,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (!response.ok) return { ok: false, reason: "provider_unreachable" };
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const routeWorked =
        payload.choices?.some(
          (choice) => typeof choice.message?.content === "string" && choice.message.content.trim().length > 0,
        ) === true;
      return routeWorked ? { ok: true } : { ok: false, reason: "model_unavailable" };
    } catch {
      return { ok: false, reason: "provider_unreachable" };
    }
  };

  readinessInFlight = check();
  try {
    const result = await readinessInFlight;
    readinessCache = { expiresAt: checkedAt + (options.cacheMs ?? (result.ok ? 5 * 60_000 : 30_000)), result };
    return result;
  } finally {
    readinessInFlight = undefined;
  }
}
