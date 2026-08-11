import { createAgentRouter } from "@flue/runtime/routing";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { isIP } from "node:net";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { AskJdpAssistant } from "./agents/assistant";
import { checkSocratinkReadiness } from "./agents/provider";
import { checkFlueDatabaseReadiness } from "./db";
import { createRateLimiter, isPromptInjectionAttempt, noStoreApiHeaders, PROMPT_INJECTION_RESPONSE, requireSameOrigin } from "./security/request-guards";
import {
  getEmployerSession,
  getOrIssueConversation,
  issueConversation,
  ownsConversation,
  SessionConfigurationError,
} from "./security/session";

type AppVariables = {
  employerSession: Awaited<ReturnType<typeof getEmployerSession>>;
};

const app = new Hono<{ Variables: AppVariables }>();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      // border-beam injects one scoped style block for its generated animation.
      // Keep inline attributes and, critically, scripts under the stricter defaults.
      styleSrcElem: ["'self'", "'unsafe-inline'"],
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
  }),
);

export function trustedForwardedClient(
  peerAddress: string | undefined,
  forwardedFor: string | undefined,
  trustProxy = process.env.TRUST_PROXY === "true",
) {
  if (!trustProxy || !peerAddress || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peerAddress)) {
    return undefined;
  }
  const forwarded = forwardedFor?.split(",").at(-1)?.trim();
  return forwarded && isIP(forwarded) ? forwarded : undefined;
}

function sessionIssuanceKey(c: Parameters<ReturnType<typeof createRateLimiter>>[0]) {
  // Only the loopback Funnel proxy may supply client identity. Selecting the
  // final valid address prevents an attacker-provided prefix from winning.
  let peerAddress: string | undefined;
  try {
    peerAddress = getConnInfo(c).remote.address;
  } catch {
    // app.request() and non-Node test adapters do not attach Node socket info.
  }
  const forwarded = trustedForwardedClient(peerAddress, c.req.header("x-forwarded-for"));
  return forwarded ? `forwarded:${forwarded}` : `peer:${peerAddress ?? "unknown"}`;
}

app.use("/api/*", noStoreApiHeaders());
app.use("/api/*", requireSameOrigin());
app.use("/api/session", createRateLimiter(12, 60_000, sessionIssuanceKey));
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: "request_too_large" }, 413),
  }),
);
app.get("/api/live", (c) => c.json({ ok: true }));
app.use("/api/*", async (c, next) => {
  try {
    c.set("employerSession", await getEmployerSession(c));
    await next();
  } catch (error) {
    if (error instanceof SessionConfigurationError) {
      return c.json({ error: "service_unavailable" }, 503);
    }
    throw error;
  }
});
app.use("/api/*", createRateLimiter(90, 60_000));

app.get("/api/health", async (c) => {
  const [provider, database] = await Promise.all([
    checkSocratinkReadiness(),
    Promise.resolve(checkFlueDatabaseReadiness()),
  ]);
  return provider.ok && database.ok ? c.json({ ok: true }) : c.json({ ok: false }, 503);
});

// Same-origin UI bootstrap. A new browser tab asks for a fresh server-owned
// conversation, while reloads reuse the server-issued ID held by that tab.
app.get("/api/session", async (c) => {
  const session = c.get("employerSession");
  const { conversationId } =
    c.req.query("fresh") === "1"
      ? await issueConversation(c, session)
      : await getOrIssueConversation(c, session);
  return c.json({ conversationId });
});

app.use("/api/agents/assistant/*", async (c, next) => {
  const mount = "/api/agents/assistant/";
  const relativePath = c.req.path.slice(mount.length);
  const conversationId = relativePath.split("/")[0];
  if (!conversationId || !ownsConversation(c.get("employerSession"), conversationId)) {
    return c.json({ error: "conversation_not_found" }, 404);
  }

  if (c.req.method === "POST" && !relativePath.endsWith("/abort")) {
    const body = await c.req.raw.clone().json().catch(() => undefined);
    if (body?.kind !== "user" || typeof body.body !== "string") {
      return c.json({ error: "invalid_message" }, 400);
    }
    if (body.body.length === 0 || body.body.length > 4_000) {
      return c.json({ error: "invalid_message_length" }, 400);
    }
    if (isPromptInjectionAttempt(body.body)) {
      return c.json({ error: "unsafe_prompt", message: PROMPT_INJECTION_RESPONSE }, 400);
    }
  }

  await next();
});
app.use("/api/agents/assistant/*", createRateLimiter(40, 60_000));
app.route("/api/agents/assistant", createAgentRouter(AskJdpAssistant));

const serveClientAsset = serveStatic({ root: "./dist/client" });
const serveClientIndex = serveStatic({ root: "./dist/client", path: "index.html" });
app.use("/*", serveClientAsset);
app.get("/*", async (c, next) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
    return c.json({ error: "not_found" }, 404);
  }
  return serveClientIndex(c, next);
});

export default app;
