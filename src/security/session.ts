import { randomBytes } from "node:crypto";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

const COOKIE_NAME = "ask_jdp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const MAX_CONVERSATIONS = 4;

export type EmployerSession = {
  version: 1;
  sessionId: string;
  conversationIds: string[];
  expiresAt: number;
};

type CookieContext = Parameters<typeof getSignedCookie>[0];

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

function opaqueId(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function encode(session: EmployerSession) {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decode(value: string): EmployerSession | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.version !== 1 ||
      typeof parsed.sessionId !== "string" ||
      !Array.isArray(parsed.conversationIds) ||
      !parsed.conversationIds.every((id: unknown) => typeof id === "string") ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return undefined;
    }
    return parsed as EmployerSession;
  } catch {
    return undefined;
  }
}

function makeSession(): EmployerSession {
  return {
    version: 1,
    sessionId: opaqueId("s"),
    conversationIds: [],
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export class SessionConfigurationError extends Error {}

/** Reads a tamper-evident anonymous session, creating one when absent or expired. */
export async function getEmployerSession(c: CookieContext): Promise<EmployerSession> {
  const secret = getSessionSecret();
  if (!secret) throw new SessionConfigurationError("SESSION_SECRET is missing or too short");

  const raw = await getSignedCookie(c, secret, COOKIE_NAME);
  const session = typeof raw === "string" ? decode(raw) : undefined;
  if (session) return session;
  return makeSession();
}

/** Persists the only server-issued conversation IDs this anonymous session may access. */
export async function issueConversation(c: CookieContext, session: EmployerSession) {
  const secret = getSessionSecret();
  if (!secret) throw new SessionConfigurationError("SESSION_SECRET is missing or too short");

  const conversationId = opaqueId("c");
  const updated: EmployerSession = {
    ...session,
    conversationIds: [...session.conversationIds.slice(-(MAX_CONVERSATIONS - 1)), conversationId],
  };
  await setSignedCookie(c, COOKIE_NAME, encode(updated), secret, cookieOptions());
  return { session: updated, conversationId };
}

/** Returns the active server-issued conversation, creating it only once per session. */
export async function getOrIssueConversation(c: CookieContext, session: EmployerSession) {
  const conversationId = session.conversationIds.at(-1);
  if (conversationId) return { session, conversationId };
  return issueConversation(c, session);
}

export function ownsConversation(session: EmployerSession, conversationId: string) {
  return session.conversationIds.includes(conversationId);
}
