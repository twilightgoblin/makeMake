import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run each test file in its own worker process — avoids port conflicts
    // and keeps the in-memory connection manager isolated between files.
    pool: "forks",
    // Sequential within a file to avoid race conditions on shared DB state.
    sequence: { concurrent: false },
    // Generous timeout for async WS operations + DB round-trips.
    testTimeout: 15000,
    hookTimeout: 15000,
    // Load .env before any test module
    env: {},
    // TypeScript handled natively by Vitest / esbuild
    include: ["tests/**/*.test.ts"],
  },
});
