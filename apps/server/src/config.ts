import { z } from "zod";

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
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** HMAC secret for guest identity tokens. Must be long and random in production. */
  TOKEN_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
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
  return {
    ...cfg,
    allowedOrigins: cfg.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    // Development fallback is deliberately obvious; production refuses to start without a real secret.
    tokenSecret: cfg.TOKEN_SECRET ?? "dev-only-insecure-token-secret-change-me",
  };
}
