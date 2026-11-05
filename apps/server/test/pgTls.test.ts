import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { createRepository } from "../src/persistence/index.ts";
import { type DbSslMode, normalizePem, pgConnectionOptions } from "../src/persistence/pgSsl.ts";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("PostgreSQL TLS options", () => {
  it("never produces an unverified TLS configuration", () => {
    for (const mode of ["verify-full", "verify-ca"] as const) {
      const o = pgConnectionOptions("postgres://u:p@db.example.com/x", mode, PEM);
      expect(o.ssl).not.toBe(false);
      expect((o.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
    }
    expect(pgConnectionOptions("postgres://u:p@db/x", "disable").ssl).toBe(false);
  });

  it("strips TLS parameters from the URL so they cannot override the policy", () => {
    const o = pgConnectionOptions(
      "postgres://u:p@db.example.com:5432/x?sslmode=no-verify&sslrootcert=/tmp/a&application_name=game",
      "verify-full",
    );
    expect(o.connectionString).not.toMatch(/ssl/);
    expect(o.connectionString).toContain("application_name=game");
    expect(o.ignoredUrlParams).toEqual(["sslmode", "sslrootcert"]);
  });

  it("checks the hostname only in verify-full", () => {
    const full = pgConnectionOptions("postgres://u:p@db/x", "verify-full", PEM).ssl as {
      checkServerIdentity?: unknown;
    };
    const ca = pgConnectionOptions("postgres://u:p@db/x", "verify-ca", PEM).ssl as {
      checkServerIdentity?: unknown;
    };
    expect(full.checkServerIdentity).toBeUndefined();
    expect(typeof ca.checkServerIdentity).toBe("function");
    expect(() => pgConnectionOptions("postgres://u:p@db/x", "verify-ca")).toThrow(/DATABASE_SSL_CA/);
  });

  it("accepts single-line PEM with \\n escapes", () => {
    expect(normalizePem("-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----")).toContain(
      "\nMIIB\n",
    );
  });

  it("validates the TLS configuration at boot", () => {
    const base = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(loadConfig({ ...base, DATABASE_SSL: "true" }).DATABASE_SSL).toBe("verify-full");
    expect(loadConfig({ ...base, DATABASE_SSL: "false" }).DATABASE_SSL).toBe("disable");
    expect(loadConfig(base).DATABASE_SSL).toBe("disable");
    expect(() => loadConfig({ ...base, DATABASE_SSL: "no-verify" })).toThrow();
    expect(() => loadConfig({ ...base, DATABASE_SSL: "require" })).toThrow();
    expect(() => loadConfig({ ...base, DATABASE_SSL: "verify-ca" })).toThrow(/DATABASE_SSL_CA/);
    expect(() => loadConfig({ ...base, DATABASE_SSL: "verify-full", DATABASE_SSL_CA: "not a pem" })).toThrow(
      /PEM/,
    );
  });
});

/**
 * Against a real TLS-only PostgreSQL with a private CA (tests/tools/pg-tls-setup.sh): the server
 * certificate is valid for "localhost" only and the server refuses plain TCP.
 */
const TLS_URL = process.env.TEST_PG_TLS_URL;
const CA = process.env.TEST_PG_TLS_CA_FILE
  ? readFileSync(process.env.TEST_PG_TLS_CA_FILE, "utf8")
  : undefined;
const WRONG_CA = process.env.TEST_PG_TLS_WRONG_CA_FILE
  ? readFileSync(process.env.TEST_PG_TLS_WRONG_CA_FILE, "utf8")
  : undefined;

async function tryConnect(url: string, mode: DbSslMode, ca?: string) {
  const o = pgConnectionOptions(url, mode, ca);
  const client = new pg.Client({
    connectionString: o.connectionString,
    ssl: o.ssl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const r = await client.query<{ ssl: boolean; version: string }>(
      "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    );
    return { ok: true as const, ...r.rows[0]! };
  } catch (err) {
    return { ok: false as const, error: String((err as Error).message) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

describe.skipIf(!TLS_URL || !CA || !WRONG_CA)("PostgreSQL TLS against a real server", () => {
  // The describe body is still evaluated when skipped (collection): no non-null assertion here.
  const url = TLS_URL ?? "";
  const byIp = url.replace("localhost", "127.0.0.1");

  it("connects with verify-full and the right CA, over TLS 1.2+", async () => {
    const r = await tryConnect(url, "verify-full", CA);
    expect(r).toMatchObject({ ok: true, ssl: true });
    expect(r.ok && r.version).toMatch(/TLSv1\.[23]/);
  });

  it("refuses a server whose CA is not trusted (system store only)", async () => {
    const r = await tryConnect(url, "verify-full");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/self[- ]signed|unable to verify|certificate/i);
  });

  it("refuses a server certificate signed by a different CA", async () => {
    const r = await tryConnect(url, "verify-full", WRONG_CA);
    expect(r.ok).toBe(false);
  });

  it("refuses a hostname the certificate does not cover in verify-full, accepts it in verify-ca", async () => {
    const full = await tryConnect(byIp, "verify-full", CA);
    expect(full.ok).toBe(false);
    expect(!full.ok && full.error).toMatch(/altnames|hostname|IP/i);
    expect(await tryConnect(byIp, "verify-ca", CA)).toMatchObject({ ok: true, ssl: true });
  });

  it("cannot be downgraded by sslmode=no-verify in the URL", async () => {
    const r = await tryConnect(`${url}?sslmode=no-verify`, "verify-full");
    expect(r.ok).toBe(false);
  });

  it("is refused by a TLS-only server when TLS is disabled", async () => {
    expect((await tryConnect(url, "disable")).ok).toBe(false);
  });

  it("boots the repository (migrations included) over verified TLS", async () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: url,
      DATABASE_SSL: "verify-full",
      DATABASE_SSL_CA: CA,
    } as NodeJS.ProcessEnv);
    const repo = await createRepository(cfg, logger);
    expect(await repo.ping()).toBe(true);
    await repo.close();
  });
});
