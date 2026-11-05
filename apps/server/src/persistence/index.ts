import type { AppConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { MemoryRepository } from "./memoryRepository.ts";
import { runMigrations } from "./migrate.ts";
import { PgRepository } from "./pgRepository.ts";
import type { Repository } from "./repository.ts";

export async function createRepository(cfg: AppConfig, log: Logger): Promise<Repository> {
  if (!cfg.DATABASE_URL) {
    log.warn("DATABASE_URL not set: using the in-memory store (data is lost on restart)");
    return new MemoryRepository();
  }
  const repo = PgRepository.connect(cfg.DATABASE_URL, cfg.DATABASE_SSL);
  await runMigrations(repo.pool);
  log.info("postgres connected, migrations up to date");
  return repo;
}

export type { Repository } from "./repository.ts";
