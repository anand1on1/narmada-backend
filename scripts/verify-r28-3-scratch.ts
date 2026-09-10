// Scratch verification for R28 Session 3. Run: npx tsx scripts/verify-r28-3-scratch.ts
// Not part of the vitest suite — smoke test for migration idempotency + module wiring.
import * as fs from "node:fs";
process.env.DATABASE_PATH = "/tmp/narmada-verify.db";
process.env.AUTO_PUBLISH_IMAGE_GEN_ENABLED = "false";
process.env.AUTO_PUBLISH_ENABLED = "false";
try { fs.unlinkSync("/tmp/narmada-verify.db"); } catch {}

const { rawSqlite } = await import("../server/storage");
const { runR28_3Migrations } = await import("../server/migrations");

runR28_3Migrations();
runR28_3Migrations();

const tables = rawSqlite
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auto_publish_log','part_image_cache')")
  .all() as Array<{ name: string }>;
console.log("tables:", tables.map((t) => t.name));

const idx = rawSqlite
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_autopub_%' OR name LIKE 'idx_partimg_%'")
  .all() as Array<{ name: string }>;
console.log("indexes:", idx.map((r) => r.name));

const { normaliseCacheKey, getRepresentationalImage } = await import("../server/part-image-gen");
console.log("cache-key 'UJ Cross':", normaliseCacheKey("UJ Cross"));
console.log("cache-key 'U-Joint Cross':", normaliseCacheKey("U-Joint Cross"));
console.log("cache-key 'Clutch Plate 380mm':", normaliseCacheKey("Clutch Plate 380mm"));
console.log("cache-key 'Brake Shoe Set for TATA':", normaliseCacheKey("Brake Shoe Set for TATA"));

const img = await getRepresentationalImage("UJC-123", "UJ Cross Joint", "transmission");
console.log("with gen off:", img);

const { autoPublishFromPO } = await import("../server/auto-publish");
const disabled = await autoPublishFromPO(999999, undefined, "manual-admin");
console.log("with AUTO_PUBLISH_ENABLED=false:", JSON.stringify(disabled));

// Flip enabled + call with a bogus po id -> expect po_not_found error path.
process.env.AUTO_PUBLISH_ENABLED = "true";
const missing = await autoPublishFromPO(9999999, undefined, "manual-admin");
console.log("with AUTO_PUBLISH_ENABLED=true, missing PO:", JSON.stringify(missing));

console.log("SANITY OK");
process.exit(0);
