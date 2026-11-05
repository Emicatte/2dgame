import { pino } from "pino";

/** Structured JSON logs (one object per line), ready for Render / Scaleway log drains. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "scrapline-server" },
  redact: { paths: ["token", "*.token", "req.headers.authorization"], censor: "[redacted]" },
});

export type Logger = typeof logger;
