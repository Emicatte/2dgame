import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@scrapline/shared";
import { registerRoutes } from "./api/routes.ts";
import { ArenaRoom } from "./rooms/ArenaRoom.ts";
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
  return server;
}
