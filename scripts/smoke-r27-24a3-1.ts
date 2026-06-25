// R27.24a3.1 smoke — Chassis Type extraction + VDS-activated UVI resolution.
// Fresh temp DB; runs real migrations, seeds 3 catalogs + identifiers, then
// exercises the resolver happy path and the extractor unit cases.
// Run from repo root: npx tsx scripts/smoke-r27-24a3-1.ts
import * as fs from "node:fs";
const DATA_DIR = "/tmp/r27_24a3_1_smoke_data";
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

  const { extractChassisType } = await import("../server/services/partsetu/chassis-extractor");
  const uvi = await import("../server/services/partsetu/uvi-resolver");

  // --- seed catalogs: cat1 chassis_type 505409, cat2 612345, cat3 NULL ---
  const insC = db.prepare(`INSERT INTO partsetu_catalogs (oem, model, variant, vc_no, chassis_type, status, uploaded_at) VALUES (?,?,?,?,?,?,?)`);
  insC.run("TATA", "SFC407CNG", "EX/31WB", "55320631000R", "505409", "active", Date.now());
  insC.run("TATA", "SIGNA 2823.K", "TC ISBE5.6", "52102339000R", "612345", "active", Date.now());
  insC.run("TATA", "LPK 2821", "5L BS6-PH2", "52180138000R", null, "active", Date.now());
  const id = (vc: string) => (db.prepare(`SELECT id FROM partsetu_catalogs WHERE vc_no = ?`).get(vc) as any).id as number;
  const cat1 = id("55320631000R"), cat2 = id("52102339000R");

  // seed chassis_type + vds identifier rows for cat1 and cat2
  const insI = db.prepare(
    `INSERT OR IGNORE INTO partsetu_vehicle_identifiers (catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at)
     VALUES (?, ?, ?, ?, 1.0, 'pdf_extract', ?)`,
  );
  for (const [cid, v] of [[cat1, "505409"], [cat2, "612345"]] as [number, string][]) {
    insI.run(cid, "chassis_type", v, v, Date.now());
    insI.run(cid, "vds", v, v, Date.now());
  }

  // --- resolver cases ---
  const r1 = await uvi.resolveVehicle("505409");
  check("1 '505409' → cat1 auto_lock ≥98", !!r1.auto_lock && r1.auto_lock.catalog_id === cat1 && r1.candidates[0].score >= 98, JSON.stringify(r1.auto_lock));

  const r2 = await uvi.resolveVehicle("MAT505409");
  check("2 'MAT505409' → cat1 auto_lock", !!r2.auto_lock && r2.auto_lock.catalog_id === cat1, JSON.stringify(r2.auto_lock));

  const r3 = await uvi.resolveVehicle("mat505409");
  check("3 'mat505409' (lower) → cat1 auto_lock", !!r3.auto_lock && r3.auto_lock.catalog_id === cat1, JSON.stringify(r3.auto_lock));

  const r4 = await uvi.resolveVehicle("MAT505409ABCDEFGHJ");
  check("4 full VIN → cat1 auto_lock via vds_from_full_vin",
    !!r4.auto_lock && r4.auto_lock.catalog_id === cat1 && r4.candidates[0].matched_strategies.includes("vds_from_full_vin"),
    JSON.stringify(r4.candidates[0]));

  const r5 = await uvi.resolveVehicle("612345");
  check("5 '612345' → cat2 auto_lock", !!r5.auto_lock && r5.auto_lock.catalog_id === cat2, JSON.stringify(r5.auto_lock));

  const r6 = await uvi.resolveVehicle("5054");
  const top6 = r6.candidates.find((c) => c.catalog_id === cat1);
  check("6 '5054' prefix → cat1 medium, no auto_lock", !r6.auto_lock && !!top6 && top6.confidence === "medium" && top6.matched_strategies.includes("chassis_type_prefix"), JSON.stringify(r6.candidates.map((c) => [c.catalog_id, c.score, c.matched_strategies])));

  const r7 = await uvi.resolveVehicle("999999");
  check("7 '999999' → 0 candidates", r7.candidates.length === 0, JSON.stringify(r7.candidates));

  // --- extractor unit cases (B spec, all 9) ---
  check("8 inline label", extractChassisType("Model X\nChassis Type 505409\nFuel CNG").value === "505409");
  check("9 misspelled 'Chasis Type' double space", extractChassisType("Chasis Type   612345").value === "612345");
  check("10 false-positive word 'ENGINE'", extractChassisType("Engine TYPE DIESEL").value === null);
  check("e1 colon form", extractChassisType("Chassis Type : 504423").value === "504423");
  check("e2 label on own line", extractChassisType("Chassis Type\n505409").value === "505409");
  check("e3 lowercase", extractChassisType("chassis type 505409").value === "505409");
  check("e4 no info → null", extractChassisType("Engine Type DIESEL\nNo chassis info here").value === null);
  check("e5 all zeros → null", extractChassisType("Chassis Type 0000000").value === null);
  check("e6 multiple → first", extractChassisType("Model X\nChassis Type 505409\nChassis Type 999999").value === "505409");
  check("e7 full cover block", extractChassisType("Model SFC407CNG\nVC No 55320631000R\nChassis Type 505409\nEngine TATA 3.8").value === "505409");

  console.log(`\n=== R27.24a3.1 SMOKE: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2); });
