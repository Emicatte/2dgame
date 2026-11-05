import { defineConfig } from "@playwright/test";

const SERVER_PORT = 2600;
const PROXY_PORT = 2610;
const WEB_PORT = 5199;
/** E2E_LATENCY_MS / E2E_JITTER_MS route the clients through the network-conditions proxy. */
const LATENCY = process.env.E2E_LATENCY_MS;
const JITTER = process.env.E2E_JITTER_MS ?? "0";
const CLIENT_PORT = LATENCY ? PROXY_PORT : SERVER_PORT;

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
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
      command: `pnpm --filter @scrapline/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: "../..",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_SERVER_URL: `http://localhost:${CLIENT_PORT}`, VITE_E2E: "true" },
    },
    ...(LATENCY
      ? [
          {
            command: `node tests/tools/netem-proxy.mjs --listen ${PROXY_PORT} --target http://localhost:${SERVER_PORT} --latency ${LATENCY} --jitter ${JITTER} --spike-rate 0.01 --spike 150`,
            cwd: "../..",
            port: PROXY_PORT,
            reuseExistingServer: false,
            timeout: 20_000,
          },
        ]
      : []),
  ],
});
