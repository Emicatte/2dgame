import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@scrapline/shared";
import { registerRoutes } from "./api/routes.ts";
import { ArenaRoom } from "./rooms/ArenaRoom.ts";
import { clientIp } from "./security/clientIp.ts";
import { RateLimiter } from "./security/rateLimit.ts";
import { type Services, setServices } from "./services.ts";

/**
 * Builds the Colyseus server with HTTP routes. Kept separate from index.ts so integration tests
 * can boot the real server on a random port.
 */
export function createGameServer(services: Services) {
  setServices(services);
  const { cfg } = services;

  // Colyseus adds its default CORS headers (origin "*") to every HTTP response. Replace them so only
  // the configured origins (the Vercel domain) are allowed. The SDK sends matchmaking requests with
  // credentials mode "include", so allowed origins also get Allow-Credentials (never with "*").
  const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  delete defaults["Access-Control-Allow-Origin"];
  delete defaults["Access-Control-Allow-Credentials"];
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get("origin");
    return origin && cfg.allowedOrigins.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
      : ({} as { "Access-Control-Allow-Origin": string });
  };

  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 });

  const server = defineServer({
    transport,
    gracefullyShutdown: false,
    rooms: {
      [ROOM_NAME]: defineRoom(ArenaRoom).filterBy(["kind"]).sortBy({ clients: -1 }),
    },
    express: (app) => registerRoutes(app, services),
  });

  // Colyseus routes /matchmake/* before Express middleware runs, so the matchmaking rate limit
  // wraps the HTTP server's request listeners once they are bound (after listen).
  const listen = server.listen.bind(server);
  server.listen = (async (...args: Parameters<typeof listen>) => {
    const result = await listen(...args);
    if (transport.server) guardMatchmaking(transport.server, cfg);
    return result;
  }) as typeof server.listen;
  return server;
}

/**
 * Per-address limit on matchmaking requests (create / join / joinOrCreate / joinById / reconnect).
 * A normal client makes a handful per minute (quick match, rematch, reconnect with backoff).
 */
export const MATCHMAKING_LIMIT = { burst: 20, perMinute: 30 };

function guardMatchmaking(httpServer: Server, cfg: Services["cfg"]) {
  const limiter = new RateLimiter(MATCHMAKING_LIMIT.burst, MATCHMAKING_LIMIT.perMinute / 60);
  const listeners = httpServer.listeners("request") as ((
    req: IncomingMessage,
    res: ServerResponse,
  ) => void)[];
  httpServer.removeAllListeners("request");
  httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    if (
      req.method === "POST" &&
      req.url?.startsWith("/matchmake/") &&
      !limiter.take(clientIp(req, cfg.TRUST_PROXY))
    ) {
      const origin = req.headers.origin;
      res.writeHead(429, {
        "content-type": "application/json",
        ...(origin && cfg.allowedOrigins.includes(origin)
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              Vary: "Origin",
            }
          : {}),
      });
      res.end(JSON.stringify({ code: 429, error: "Too many matchmaking requests, try again in a minute" }));
      return;
    }
    for (const l of listeners) l.call(httpServer, req, res);
  });
}
