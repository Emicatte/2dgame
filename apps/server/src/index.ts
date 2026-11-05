import { applySimulatedLatency } from "@colyseus/core";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { createRepository } from "./persistence/index.ts";

const cfg = loadConfig();
const repo = await createRepository(cfg, logger);
const server = createGameServer({ cfg, repo, log: logger });

if (cfg.SIMULATED_LATENCY_MS > 0) {
  applySimulatedLatency(server.transport, cfg.SIMULATED_LATENCY_MS);
  logger.warn({ ms: cfg.SIMULATED_LATENCY_MS }, "simulated latency enabled");
}

await server.listen(cfg.PORT, cfg.HOST);
logger.info({ port: cfg.PORT, env: cfg.NODE_ENV, db: repo.kind }, "game server listening");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down: notifying rooms and closing connections");
  const force = setTimeout(() => {
    logger.error("forced exit after shutdown timeout");
    process.exit(1);
  }, 25_000);
  force.unref();
  try {
    await server.gracefullyShutdown(false);
    await repo.close();
  } catch (err) {
    logger.error({ err }, "error during shutdown");
  }
  process.exit(0);
}

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void shutdown(sig));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
