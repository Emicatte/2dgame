import { pino } from "pino";

/** Structured JSON logs (one object per line), ready for Render / Scaleway log drains. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "scrapline-server" },
  // Identity and reconnection tokens are bearer credentials: never write them to log drains, even
  // nested in framework errors (Colyseus attaches the join options to auth exceptions).
  redact: {
    paths: [
      "token",
      "*.token",
      "*.*.token",
      "*.*.*.token",
      "reconnectionToken",
      "*.reconnectionToken",
      "*.*.reconnectionToken",
      "req.headers.authorization",
      "*.headers.authorization",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
