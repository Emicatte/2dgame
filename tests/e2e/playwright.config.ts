import { defineConfig } from "@playwright/test";

export const SERVER_PORT = 2600;
export const PROXY_PORT = 2610;
const WEB_PORT = 5199;
/**
 * Browsers always connect through the network-conditions proxy so tests can inject stalls and
 * drops at runtime. E2E_LATENCY_MS / E2E_JITTER_MS / E2E_SPIKE_RATE set its base conditions
 * (default: none, i.e. localhost).
 */
const LATENCY = process.env.E2E_LATENCY_MS ?? "0";
const JITTER = process.env.E2E_JITTER_MS ?? "0";
const SPIKE_RATE = process.env.E2E_SPIKE_RATE ?? "0";

export default defineConfig({
  testDir: ".",
  timeout: 150_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @scrapline/server exec tsx src/index.ts",
      cwd: "../..",
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(SERVER_PORT),
        NODE_ENV: "test",
        ENABLE_DEBUG_ROUTES: "true",
        ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: "warn",
        ...(process.env.E2E_DATABASE_URL ? { DATABASE_URL: process.env.E2E_DATABASE_URL } : {}),
      },
    },
    {
      command: `node tests/tools/netem-proxy.mjs --listen ${PROXY_PORT} --target http://localhost:${SERVER_PORT} --latency ${LATENCY} --jitter ${JITTER} --spike-rate ${SPIKE_RATE} --spike 150 --seed 7`,
      cwd: "../..",
      port: PROXY_PORT,
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `pnpm --filter @scrapline/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: "../..",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_SERVER_URL: `http://localhost:${PROXY_PORT}`, VITE_E2E: "true" },
    },
  ],
});
