// R27.24c — vitest setupFile. Runs once per test file (before the test module
// and its transitive imports are evaluated), so this is the only safe place to
// pin DATA_DIR before server/storage.ts opens its better-sqlite3 handle. Each
// test file runs in its own fork, so each gets a unique on-disk SQLite DB that
// is torn down on process exit. We also strip every Claude API key: the harness
// must classify intent via the deterministic heuristic and never touch Haiku or
// Sonnet over the network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATA_DIR || !process.env.DATA_DIR.includes("narmada-vitest-")) {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "narmada-vitest-"));
}

// Force the offline/deterministic path everywhere.
delete process.env.CLAUDE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_API_KEY_HAIKU;
delete process.env.CLAUDE_API_KEY_SONNET;
process.env.NODE_ENV = "test";
