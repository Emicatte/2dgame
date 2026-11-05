import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { handleHttp, MemoryStore } from "./src/p2p/signalServer.ts";

/**
 * Host-mode signaling for `vite` and `vite preview`: the same handler as the Vercel Function
 * (src/p2p/signalServer.ts, deployed as api/p2p.js), with an in-memory store instead of Redis.
 */
function devSignaling(): Plugin {
  const store = new MemoryStore();
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request(`http://localhost${req.url ?? "/"}`, {
      method: req.method,
      headers,
      ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await handleHttp(request, { store, env: process.env });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => {
      res.setHeader(k, v);
    });
    res.end(await response.text());
  };
  const mount = (server: {
    middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void };
  }) => {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/p2p")) return next();
      handler(req, res).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
  };
  return { name: "scrapline-dev-signaling", configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [react(), devSignaling()],
  define: {
    // Host and guests must run the same build (see src/p2p/wire.ts).
    __BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? "dev"),
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // bench.html: offline client benchmark (src/bench), shipped alongside the game.
      input: { main: "index.html", bench: "bench.html" },
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/phaser")) return "phaser";
          if (id.includes("node_modules/@colyseus")) return "colyseus";
          return undefined;
        },
      },
    },
  },
});
