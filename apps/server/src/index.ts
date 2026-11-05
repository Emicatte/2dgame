import { matchMaker } from "@colyseus/core";
import { ROOM_NAME, S2C } from "@scrapline/shared";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { createRepository } from "./persistence/index.ts";

const cfg = loadConfig();
const repo = await createRepository(cfg, logger);
const server = createGameServer({ cfg, repo, log: logger });

await server.listen(cfg.PORT, cfg.HOST);
logger.info({ port: cfg.PORT, env: cfg.NODE_ENV, db: repo.kind }, "game server listening");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, drainSec: cfg.SHUTDOWN_DRAIN_SEC }, "shutting down");
  const force = setTimeout(
    () => {
      logger.error("forced exit after shutdown timeout");
      process.exit(1);
    },
    (cfg.SHUTDOWN_DRAIN_SEC + 25) * 1000,
  );
  force.unref();
  try {
    await drainRooms(cfg.SHUTDOWN_DRAIN_SEC);
    await server.gracefullyShutdown(false);
    await repo.close();
  } catch (err) {
    logger.error({ err }, "error during shutdown");
  }
  process.exit(0);
}

/**
 * Lets running matches finish before the process exits (platforms route new players to the new
 * instance during a deploy, so this instance only serves the matches already in progress).
 */
async function drainRooms(seconds: number) {
  if (seconds <= 0) return;
  const deadline = Date.now() + seconds * 1000;
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  for (const r of rooms) {
    const room = matchMaker.getLocalRoomById(r.roomId);
    room?.broadcast(S2C.NOTICE, {
      text: "Server update pending: this room closes after the current match",
      tone: "warn",
    });
    await room?.lock();
  }
  while (Date.now() < deadline) {
    const left = await matchMaker.query({ name: ROOM_NAME });
    const clients = left.reduce((n, r) => n + r.clients, 0);
    if (clients === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void shutdown(sig));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
