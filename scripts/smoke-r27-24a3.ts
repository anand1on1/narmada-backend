// R27.24a3 smoke — Universal Vehicle Identifier resolver.
// Fresh temp DB; runs the real migrations (incl. R27.24a3 auto-seed), seeds two
// catalogs, then exercises the 8 documented resolve cases.
// Run from the repo root: npx tsx scripts/smoke-r27-24a3.ts
import * as fs from "node:fs";
const DATA_DIR = "/tmp/r27_24a3_smoke_data";
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
delete process.env.CLAUDE_API_KEY; delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
const check = (n: string, c: boolean, x = "") => { c ? (pass++, console.log(`PASS ${n} ${x}`)) : (fail++, console.log(`FAIL ${n} ${x}`)); };

async function main() {
  const { rawSqlite: db } = await import("../server/storage");
  const mig = await import("../server/migrations");
  mig.runPartSetuMigrations();

  // seed: cat1 = SIGNA (id 1), cat2 = SFC407CNG (id 2)
  const insC = db.prepare(`INSERT INTO partsetu_catalogs (oem, model, variant, vc_no, status, uploaded_at) VALUES (?,?,?,?,?,?)`);
  insC.run("TATA", "SIGNA 2823.K", "TC ISBE5.6 BS6-PH2", "52102339000R", "active", Date.now());
  insC.run("TATA", "SFC407CNG", "EX/31WB", "55320631000R", "active", Date.now());
  const cat2 = (db.prepare(`SELECT id FROM partsetu_catalogs WHERE vc_no = ?`).get("55320631000R") as any).id;
  check("seed cat2 id is 2", cat2 === 2, `id=${cat2}`);

  const uvi = await import("../server/services/partsetu/uvi-resolver");

  // case 2: exact VC No → auto_lock, score >= 95
  const r1 = await uvi.resolveVehicle("55320631000R");
  check("exact vc_no auto_lock", !!r1.auto_lock && r1.auto_lock.catalog_id === cat2, JSON.stringify(r1.auto_lock));
  check("exact vc_no score >= 95", (r1.candidates[0]?.score || 0) >= 95, `${r1.candidates[0]?.score}`);

  // case 3: partial VC No substring → candidate match, medium confidence, no auto_lock
  const r2 = await uvi.resolveVehicle("5532063");
  const top2 = r2.candidates.find((c) => c.catalog_id === cat2);
  check("substring finds cat2", !!top2, JSON.stringify(r2.candidates.map((c) => [c.catalog_id, c.score])));
  check("substring no auto_lock + medium", !r2.auto_lock && (top2?.confidence === "medium" || top2?.confidence === "high"), `${top2?.confidence} lock=${!!r2.auto_lock}`);

  // case 4: 17-char MAT VIN, no VDS seeded → VDS extraction attempt, empty/low
  const r3 = await uvi.resolveVehicle("MAT12345678901234");
  check("MAT VIN no seeded VDS → empty candidates", r3.candidates.length === 0, JSON.stringify(r3.candidates));

  // case 5: model name → model FTS hit
  const r4 = await uvi.resolveVehicle("SFC407");
  const m4 = r4.candidates.find((c) => c.catalog_id === cat2);
  check("model FTS finds cat2", !!m4 && m4.matched_strategies.includes("model_fts"), JSON.stringify(r4.candidates.map((c) => [c.catalog_id, c.matched_strategies])));

  // case 6: variant name → variant FTS hit
  const r5 = await uvi.resolveVehicle("EX/31WB");
  const m5 = r5.candidates.find((c) => c.catalog_id === cat2);
  check("variant FTS finds cat2", !!m5 && m5.matched_strategies.includes("variant_fts"), JSON.stringify(r5.candidates.map((c) => [c.catalog_id, c.matched_strategies])));

  // case 7: teach chassis_prefix '505409' → cat2, then resolve '505409'
  db.prepare(
    `INSERT OR IGNORE INTO partsetu_vehicle_identifiers (catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at)
     VALUES (?, 'chassis_prefix', ?, ?, 1.0, 'user_confirmed', ?)`,
  ).run(cat2, "505409", "505409", Date.now());
  const r6 = await uvi.resolveVehicle("505409");
  check("chassis_prefix '505409' high-conf cat2", (r6.candidates[0]?.catalog_id === cat2) && (r6.candidates[0]?.confidence === "high"), JSON.stringify(r6.candidates[0]));

  // case 8: MAT-prefixed form resolves the same after stripping MAT
  const r7 = await uvi.resolveVehicle("MAT505409");
  check("MAT505409 high-conf cat2", (r7.candidates[0]?.catalog_id === cat2) && (r7.candidates[0]?.confidence === "high"), JSON.stringify(r7.candidates[0]));

  console.log(`\n=== R27.24a3 SMOKE: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2); });
