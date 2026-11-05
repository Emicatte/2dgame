import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Guest identity tokens: `base64url(payload).base64url(hmacSha256(payload))`.
 *
 * The browser stores the token, but cannot forge or alter it: the player id inside is only trusted
 * after the signature checks out with the server secret. This is what lets stats and XP be
 * credited to a guest without a password, and the same `sub` can later be linked to a registered
 * account.
 */
export interface TokenPayload {
  /** Player id (UUID). */
  sub: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Token version, to allow future invalidation of old formats. */
  v: 1;
  kind: "guest";
}

const TOKEN_TTL_SEC = 60 * 60 * 24 * 365;

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueToken(playerId: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const payload: TokenPayload = {
    sub: playerId,
    iat: nowSec,
    exp: nowSec + TOKEN_TTL_SEC,
    v: 1,
    kind: "guest",
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(
  token: unknown,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): TokenPayload | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (payload.v !== 1 || payload.kind !== "guest" || typeof payload.sub !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
    if (!/^[0-9a-f-]{36}$/.test(payload.sub)) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
