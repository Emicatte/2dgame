import { z } from "zod";
import { isPemCertificate } from "./persistence/pgSsl.ts";

/**
 * Environment configuration, validated once at boot. A missing secret in production stops the
 * process instead of silently running with an insecure default.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  HOST: z.string().default("0.0.0.0"),
  /** Comma separated list of allowed browser origins for CORS (the Vercel domain in production). */
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"),
  /** PostgreSQL connection string. Optional in development (in-memory store is used instead). */
  DATABASE_URL: z.string().optional(),
  /**
   * TLS to PostgreSQL: disable | verify-ca | verify-full (see persistence/pgSsl.ts). The legacy
   * values "true"/"false" map to verify-full/disable. There is no unverified-TLS mode.
   */
  DATABASE_SSL: z
    .enum(["disable", "verify-ca", "verify-full", "true", "false"])
    .default("disable")
    .transform((v) => (v === "true" ? "verify-full" : v === "false" ? "disable" : v)),
  /** PEM CA bundle for DATABASE_SSL (literal newlines or "\n" escapes). Unset = system CA store. */
  DATABASE_SSL_CA: z.string().optional(),
  /**
   * Reverse proxies in front of the server whose X-Forwarded-For entries are trusted for the client
   * address (rate limits). 0 = use the socket address; Render and most PaaS: 1. Setting it higher
   * than the real number of proxies lets clients spoof their address.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** HMAC secret for guest identity tokens. Must be long and random in production. */
  TOKEN_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /**
   * On SIGTERM keep running matches alive this long (until rooms are empty) before shutting down.
   * Must be shorter than the platform's kill timeout (Render: maxShutdownDelaySeconds).
   */
  SHUTDOWN_DRAIN_SEC: z.coerce.number().int().min(0).max(600).default(0),
  /** Exposes /api/debug/* endpoints and verbose metrics. Never enable in production. */
  ENABLE_DEBUG_ROUTES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type AppConfig = z.infer<typeof envSchema> & { allowedOrigins: string[]; tokenSecret: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (!cfg.TOKEN_SECRET || cfg.TOKEN_SECRET.length < 32) {
      throw new Error("TOKEN_SECRET (32+ chars) is required in production");
    }
    if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
    if (cfg.ENABLE_DEBUG_ROUTES) throw new Error("ENABLE_DEBUG_ROUTES must be false in production");
  }
  if (cfg.DATABASE_SSL_CA && !isPemCertificate(cfg.DATABASE_SSL_CA)) {
    throw new Error("DATABASE_SSL_CA must be a PEM certificate bundle");
  }
  if (cfg.DATABASE_SSL === "verify-ca" && !cfg.DATABASE_SSL_CA) {
    throw new Error("DATABASE_SSL=verify-ca requires DATABASE_SSL_CA");
  }
  return {
    ...cfg,
    allowedOrigins: cfg.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    // Development fallback is deliberately obvious; production refuses to start without a real secret.
    tokenSecret: cfg.TOKEN_SECRET ?? "dev-only-insecure-token-secret-change-me",
  };
}
