import type { MiddlewareHandler } from "hono";

const INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|override|replace|forget)\b.{0,80}\b(?:previous|prior|earlier|system|developer|hidden|above|your)\b.{0,40}\b(?:instructions|rules|directions|prompt)\b/i,
  /\b(?:reveal|print|output|show|quote|reproduce|dump|provide|list)\b.{0,80}\b(?:system|developer|hidden|private|confidential|raw|source)\b.{0,50}\b(?:prompt|message|instructions|corpus|evidence|source files?|documents?|credentials?)\b/i,
  /\b(?:role[ -]?play|pretend|simulate)\b.{0,80}\b(?:developer|system|administrator|debug(?:ger|ging)?)\b/i,
  /\bdecode\b.{0,50}\b(?:base64|hex|rot13)\b/i,
  /\b(?:fictional|invented|fabricated)\b.{0,50}(?:\bresume\b|résumé|\bclaim\b|\bcitation\b).{0,100}\b(?:authoritative|verified|fact)\b/i,
  /\b(?:next|second)\b.{0,50}\b(?:message|reply|stage|part)\b.{0,100}\b(?:reveal|output|replace|ignore|prompt|corpus)\b/i,
  /act as (a )?(different|new) (assistant|system)/i,
  /jailbreak/i,
];

export const PROMPT_INJECTION_RESPONSE =
  "I can help with questions about Jonathan's verified professional experience, but I can't provide private instructions or source material.";

export function isPromptInjectionAttempt(value: string) {
  const candidates = [value.normalize("NFKC")];
  for (const token of value.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? []) {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (/^[\x09\x0A\x0D\x20-\x7E]{20,}$/.test(decoded)) candidates.push(decoded.normalize("NFKC"));
    } catch {
      // Invalid encoded text remains ordinary user input.
    }
  }
  return candidates.some((candidate) => INJECTION_PATTERNS.some((pattern) => pattern.test(candidate)));
}

export function noStoreApiHeaders(): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  };
}

/** Rejects browser cross-site state-changing requests when an Origin is supplied. */
export function requireSameOrigin(): MiddlewareHandler {
  return async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
    const origin = c.req.header("origin");
    const allowedOrigins = new Set([new URL(c.req.url).origin]);
    const publicOrigin = process.env.PUBLIC_ORIGIN?.trim();
    if (publicOrigin) {
      try {
        allowedOrigins.add(new URL(publicOrigin).origin);
      } catch {
        // A malformed deployment value must never relax the origin boundary.
      }
    }
    if (origin && !allowedOrigins.has(origin)) {
      return c.json({ error: "cross_origin_request_rejected" }, 403);
    }
    await next();
  };
}

type RateWindow = { resetAt: number; count: number };

const DEFAULT_MAX_RATE_LIMIT_WINDOWS = 10_000;
const DEFAULT_RATE_LIMIT_SWEEP_INTERVAL = 64;

export type RateLimiterOptions = {
  /** Hard ceiling for attacker-controlled keys retained by this process. */
  maxTrackedKeys?: number;
  /** How often to remove expired windows. Kept injectable for deterministic tests. */
  sweepEvery?: number;
  now?: () => number;
};

/** Small in-process guard; production multi-instance deployments need a shared limiter at the edge. */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  keyForRequest: (c: Parameters<MiddlewareHandler>[0]) => string | undefined = (c) => c.get("employerSession")?.sessionId,
  options: RateLimiterOptions = {},
): MiddlewareHandler {
  const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_RATE_LIMIT_WINDOWS;
  const sweepEvery = options.sweepEvery ?? DEFAULT_RATE_LIMIT_SWEEP_INTERVAL;
  const nowForRequest = options.now ?? Date.now;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Rate limit must be a positive integer");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError("Rate-limit window must be a positive integer");
  if (!Number.isSafeInteger(maxTrackedKeys) || maxTrackedKeys < 1) {
    throw new RangeError("Rate limiter maxTrackedKeys must be a positive integer");
  }
  if (!Number.isSafeInteger(sweepEvery) || sweepEvery < 1) {
    throw new RangeError("Rate limiter sweepEvery must be a positive integer");
  }

  const windows = new Map<string, RateWindow>();
  let requestsSinceSweep = 0;

  function removeExpiredWindows(now: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
  }

  return async (c, next) => {
    const key = keyForRequest(c) ?? "anonymous";
    const now = nowForRequest();
    requestsSinceSweep += 1;
    if (requestsSinceSweep >= sweepEvery) {
      removeExpiredWindows(now);
      requestsSinceSweep = 0;
    }

    const existing = windows.get(key);
    let window = existing;
    if (!window || window.resetAt <= now) {
      if (!window && windows.size >= maxTrackedKeys) {
        // Sweep immediately at capacity. If every tracked window is still active,
        // fail closed rather than grow the map or evict an actively limited key.
        removeExpiredWindows(now);
        if (windows.size >= maxTrackedKeys) {
          const retryAt = Math.min(...Array.from(windows.values(), ({ resetAt }) => resetAt));
          c.header("X-RateLimit-Limit", String(limit));
          c.header("X-RateLimit-Remaining", "0");
          c.header("Retry-After", String(Math.max(1, Math.ceil((retryAt - now) / 1000))));
          return c.json({ error: "rate_limited" }, 429);
        }
      }
      window = { count: 0, resetAt: now + windowMs };
    }
    window.count += 1;
    windows.set(key, window);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(limit - window.count, 0)));
    if (window.count > limit) {
      c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}
