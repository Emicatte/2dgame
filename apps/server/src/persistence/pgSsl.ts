import type { ConnectionOptions } from "node:tls";

/**
 * TLS policy for PostgreSQL connections.
 *
 * - `disable`: plain TCP. Only for a private network the database is not reachable from outside
 *   (Render's internal connection string, docker-compose, local development).
 * - `verify-full`: TLS, certificate chain verified against `DATABASE_SSL_CA` (or the system CA
 *   store when unset) and the server hostname checked against the certificate.
 * - `verify-ca`: TLS with the chain verified against `DATABASE_SSL_CA` (required) but without the
 *   hostname check, for providers whose certificates do not carry the endpoint name.
 *
 * There is intentionally no mode that encrypts without verifying (`rejectUnauthorized: false`):
 * it protects against passive sniffing only and gives a false sense of security.
 */
export type DbSslMode = "disable" | "verify-ca" | "verify-full";

/** Connection-string parameters that would override the TLS policy inside `pg`. */
const SSL_URL_PARAMS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat",
];

export interface PgConnectionOptions {
  connectionString: string;
  ssl: false | ConnectionOptions;
  /** TLS-related parameters removed from the URL (reported as a warning at boot). */
  ignoredUrlParams: string[];
}

/** Accepts a PEM bundle as-is or with `\n` escapes (single-line environment variables). */
export function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

export function isPemCertificate(pem: string): boolean {
  return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(normalizePem(pem));
}

export function pgConnectionOptions(url: string, mode: DbSslMode, caPem?: string): PgConnectionOptions {
  // `pg` merges the parsed connection string *over* the config object, so a `?sslmode=no-verify`
  // in DATABASE_URL would silently replace the verified TLS options below. The policy is owned by
  // DATABASE_SSL alone: strip every TLS parameter from the URL.
  const parsed = new URL(url);
  const ignoredUrlParams = SSL_URL_PARAMS.filter((p) => parsed.searchParams.has(p));
  for (const p of ignoredUrlParams) parsed.searchParams.delete(p);
  const connectionString = parsed.toString();

  if (mode === "disable") return { connectionString, ssl: false, ignoredUrlParams };
  const ca = caPem ? normalizePem(caPem) : undefined;
  if (mode === "verify-ca") {
    if (!ca) throw new Error("DATABASE_SSL=verify-ca requires DATABASE_SSL_CA");
    return {
      connectionString,
      ssl: { rejectUnauthorized: true, ca, checkServerIdentity: () => undefined },
      ignoredUrlParams,
    };
  }
  return { connectionString, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, ignoredUrlParams };
}
