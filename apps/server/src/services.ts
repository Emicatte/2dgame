import type { AppConfig } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { Repository } from "./persistence/repository.ts";

/**
 * Process-wide dependencies handed to rooms. Colyseus instantiates rooms itself, so they read
 * their collaborators from here instead of through constructor injection.
 */
export interface Services {
  cfg: AppConfig;
  repo: Repository;
  log: Logger;
}

let services: Services | null = null;

export function setServices(s: Services): void {
  services = s;
}

export function getServices(): Services {
  if (!services) throw new Error("services not initialised");
  return services;
}
