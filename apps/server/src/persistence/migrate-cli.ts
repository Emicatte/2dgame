import pg from "pg";
import { loadConfig } from "../config.ts";
import { logger } from "../logger.ts";
import { runMigrations } from "./migrate.ts";
import { pgConnectionOptions } from "./pgSsl.ts";

const cfg = loadConfig();
if (!cfg.DATABASE_URL) {
  logger.error("DATABASE_URL is not set");
  process.exit(1);
}
const opts = pgConnectionOptions(cfg.DATABASE_URL, cfg.DATABASE_SSL, cfg.DATABASE_SSL_CA);
const pool = new pg.Pool({ connectionString: opts.connectionString, ssl: opts.ssl });
try {
  await runMigrations(pool);
  logger.info("migrations applied");
} finally {
  await pool.end();
}
