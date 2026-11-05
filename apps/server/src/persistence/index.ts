import type { AppConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { MemoryRepository } from "./memoryRepository.ts";
import { runMigrations } from "./migrate.ts";
import { PgRepository } from "./pgRepository.ts";
import { pgConnectionOptions } from "./pgSsl.ts";
import type { Repository } from "./repository.ts";

export async function createRepository(cfg: AppConfig, log: Logger): Promise<Repository> {
  if (!cfg.DATABASE_URL) {
    log.warn("DATABASE_URL not set: using the in-memory store (data is lost on restart)");
    return new MemoryRepository();
  }
  const opts = pgConnectionOptions(cfg.DATABASE_URL, cfg.DATABASE_SSL, cfg.DATABASE_SSL_CA);
  if (opts.ignoredUrlParams.length > 0) {
    log.warn(
      { ignored: opts.ignoredUrlParams, mode: cfg.DATABASE_SSL },
      "TLS parameters in DATABASE_URL are ignored: DATABASE_SSL controls TLS",
    );
  }
  if (cfg.DATABASE_SSL === "disable" && cfg.NODE_ENV === "production") {
    log.warn("PostgreSQL connection is not encrypted: only acceptable on a private network");
  }
  const repo = PgRepository.connect(opts);
  await runMigrations(repo.pool);
  log.info({ ssl: cfg.DATABASE_SSL }, "postgres connected, migrations up to date");
  return repo;
}

export type { Repository } from "./repository.ts";
