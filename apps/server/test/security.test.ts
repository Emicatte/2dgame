import { describe, expect, it } from "vitest";
import { clientIp } from "../src/security/clientIp.ts";
import { RateLimiter } from "../src/security/rateLimit.ts";
import { issueToken, verifyToken } from "../src/security/tokens.ts";

const req = (remote: string, xff?: string) =>
  ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as never;

describe("clientIp", () => {
  it("ignores X-Forwarded-For unless proxies are trusted", () => {
    expect(clientIp(req("198.51.100.7", "1.2.3.4"), 0)).toBe("198.51.100.7");
  });

  it("takes the address appended by the trusted proxy, not one written by the client", () => {
    // Client forged "1.2.3.4"; the platform proxy (socket peer 10.0.0.1) appended the real address.
    expect(clientIp(req("10.0.0.1", "1.2.3.4, 198.51.100.7"), 1)).toBe("198.51.100.7");
    expect(clientIp(req("10.0.0.1", "1.2.3.4, 198.51.100.7, 10.0.0.2"), 2)).toBe("198.51.100.7");
  });

  it("falls back to the farthest known hop when the header is shorter than the trust depth", () => {
    expect(clientIp(req("10.0.0.1"), 1)).toBe("10.0.0.1");
    expect(clientIp(req("10.0.0.1", "198.51.100.7"), 3)).toBe("198.51.100.7");
  });
});

describe("RateLimiter", () => {
  it("refills over time and keeps memory bounded under many distinct keys", () => {
    const rl = new RateLimiter(2, 1);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 0)).toBe(false);
    expect(rl.take("a", 1000)).toBe(true);
    for (let i = 0; i < 25_000; i++) rl.take(`k${i}`, 2000);
    expect(rl.size).toBeLessThanOrEqual(10_001);
  });
});

describe("guest tokens", () => {
  const secret = "s".repeat(40);
  const id = "00000000-0000-4000-8000-000000000001";

  it("rejects tampering, other secrets, expiry and malformed input", () => {
    const t = issueToken(id, secret, 1000);
    expect(verifyToken(t, secret, 1001)?.sub).toBe(id);
    const [body, sig] = t.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: id.replace("1", "2"), iat: 1, exp: 9e9, v: 1, kind: "guest" }),
    ).toString("base64url");
    expect(verifyToken(`${forgedBody}.${sig}`, secret, 1001)).toBeNull();
    expect(verifyToken(`${body}.${sig}x`, secret, 1001)).toBeNull();
    expect(verifyToken(t, "o".repeat(40), 1001)).toBeNull();
    expect(verifyToken(t, secret, 1000 + 366 * 86400)).toBeNull();
    for (const bad of [undefined, 42, "", "a.b.c", "x".repeat(2000), `${body}.`]) {
      expect(verifyToken(bad, secret, 1001)).toBeNull();
    }
  });
});

describe("production configuration guard", () => {
  const prod = {
    NODE_ENV: "production",
    TOKEN_SECRET: "x".repeat(48),
    DATABASE_URL: "postgres://u:p@db/x",
  } as NodeJS.ProcessEnv;

  it("starts with a complete production configuration", async () => {
    const { loadConfig } = await import("../src/config.ts");
    expect(loadConfig(prod).NODE_ENV).toBe("production");
    expect(loadConfig(prod).TRUST_PROXY).toBe(0);
  });

  it("refuses weak secrets, a missing database and debug routes", async () => {
    const { loadConfig } = await import("../src/config.ts");
    expect(() => loadConfig({ ...prod, TOKEN_SECRET: undefined })).toThrow(/TOKEN_SECRET/);
    expect(() => loadConfig({ ...prod, TOKEN_SECRET: "short" })).toThrow(/TOKEN_SECRET/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...prod, ENABLE_DEBUG_ROUTES: "true" })).toThrow(/DEBUG/);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: "9" })).toThrow();
  });
});
