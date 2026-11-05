import pg from "pg";
import { loadConfig } from "../config.ts";
import { logger } from "../logger.ts";
import { runMigrations } from "./migrate.ts";

const cfg = loadConfig();
if (!cfg.DATABASE_URL) {
  logger.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, ssl: cfg.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
try {
  await runMigrations(pool);
  logger.info("migrations applied");
} finally {
  await pool.end();
}
