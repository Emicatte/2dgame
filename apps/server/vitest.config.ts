import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests run real sockets and full match timers.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
