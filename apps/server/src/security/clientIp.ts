import type { IncomingMessage } from "node:http";

/**
 * Client address for rate limiting. `trustedHops` is the number of reverse proxies in front of
 * the server (TRUST_PROXY). Each proxy appends the address it received the request from to
 * X-Forwarded-For, so the trustworthy entry is the one `trustedHops` positions from the right;
 * everything to its left was written by the client and can be forged. With 0 the socket address
 * is used and the header is ignored (same rule as Express's numeric `trust proxy`).
 */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trustedHops: number): string {
  const socketAddr = req.socket.remoteAddress ?? "unknown";
  if (trustedHops <= 0) return socketAddr;
  const header = req.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Nearest hop first: the socket peer, then the X-Forwarded-For entries right to left.
  const chain = [socketAddr, ...forwarded.reverse()];
  return chain[Math.min(trustedHops, chain.length - 1)]!;
}
