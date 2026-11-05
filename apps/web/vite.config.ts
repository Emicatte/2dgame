import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
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
