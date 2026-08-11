import { describe, expect, it } from "vitest";

process.env.SESSION_SECRET ??= "test-session-secret-that-is-at-least-thirty-two-bytes";

const { trustedForwardedClient } = await import("../src/app");

describe("trusted proxy identity", () => {
  it("accepts the final valid address only from the loopback proxy", () => {
    expect(trustedForwardedClient("127.0.0.1", "198.51.100.9", true)).toBe("198.51.100.9");
    expect(trustedForwardedClient("::1", "spoofed, 2001:db8::5", true)).toBe("2001:db8::5");
  });

  it("ignores forwarded identity from direct peers or when proxy trust is disabled", () => {
    expect(trustedForwardedClient("100.64.0.2", "198.51.100.9", true)).toBeUndefined();
    expect(trustedForwardedClient("127.0.0.1", "198.51.100.9", false)).toBeUndefined();
    expect(trustedForwardedClient("127.0.0.1", "not-an-ip", true)).toBeUndefined();
  });
});
