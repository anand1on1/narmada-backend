import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// R27.24c — PartSetu AI test harness. The pipeline modules (storage / search /
// uvi-resolver) open a better-sqlite3 handle at `${DATA_DIR}/data.db` on first
// import, so DATA_DIR MUST be set before any of them load. tests/fixtures/
// setup-env.ts (a setupFile, imported before each test module) points DATA_DIR
// at a per-process temp dir and strips Claude API keys so no live call is ever
// made. Each test file runs in its own fork → its own isolated SQLite DB.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(root, "shared"),
      "@": resolve(root, "client/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/fixtures/setup-env.ts"],
    pool: "forks",
    isolate: true,
    testTimeout: 10000,
    hookTimeout: 30000,
    reporters: ["default"],
  },
});
