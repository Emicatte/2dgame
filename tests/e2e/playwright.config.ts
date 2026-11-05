import { defineConfig } from "@playwright/test";

const SERVER_PORT = 2600;
const WEB_PORT = 5199;

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
        ...(process.env.E2E_LATENCY_MS ? { SIMULATED_LATENCY_MS: process.env.E2E_LATENCY_MS } : {}),
      },
    },
    {
      command: `pnpm --filter @scrapline/web exec vite --port ${WEB_PORT} --strictPort`,
      cwd: "../..",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_SERVER_URL: `http://localhost:${SERVER_PORT}`, VITE_E2E: "true" },
    },
  ],
});
