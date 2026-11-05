import { defineConfig } from "@playwright/test";

export const WEB_PORT = 5299;
/** E2E_P2P_PREVIEW=1: test the production build (vite preview) instead of the dev server. */
const PREVIEW = process.env.E2E_P2P_PREVIEW === "1";

/**
 * Host mode: no game server. The Vite dev server serves the client and the signaling endpoint
 * (src/p2p/signalServer.ts with an in-memory store); the two browsers connect to each other over WebRTC.
 */
export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  webServer: [
    PREVIEW
      ? {
          // Production build with no server configured: host mode must be the default there.
          command: `pnpm --filter @scrapline/web build && pnpm --filter @scrapline/web exec vite preview --port ${WEB_PORT} --strictPort`,
          cwd: "../..",
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: { VITE_E2E: "true", BUILD_ID: "e2e-preview" },
        }
      : {
          command: `pnpm --filter @scrapline/web exec vite --port ${WEB_PORT} --strictPort`,
          cwd: "../..",
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: { VITE_NET_MODE: "p2p", VITE_E2E: "true" },
        },
  ],
});
