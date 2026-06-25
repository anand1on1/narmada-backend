// R27.24a4 smoke — UVI resolver forced into the chat flow.
// Reproduces the production bug ("tata ka chassis no hai 505409" → bot
// hallucinated "Tata 407 discontinued") by exercising the exact functions the
// chat handler now calls: extractVehicleIdentifierCandidates → resolveVehicle →
// pickBestUvi → buildVerifiedVehicleBlock → buildPartsetuSystemPrompt, and
// asserting the verified-vehicle block reaches the Sonnet system prompt.
// Run from repo root: npx tsx scripts/smoke-r27-24a4.ts
import * as fs from "node:fs";
const DATA_DIR = "/tmp/r27_24a4_smoke_data";
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

  const uvi = await import("../server/services/partsetu/uvi-resolver");
  const prompt = await import("../server/services/partsetu/prompt");

  // --- seed: cat1 chassis_type 505409 (SFC407CNG), cat2 612345 (SIGNA) ---
  const insC = db.prepare(`INSERT INTO partsetu_catalogs (oem, model, variant, vc_no, chassis_type, status, uploaded_at) VALUES (?,?,?,?,?,?,?)`);
  insC.run("TATA", "SFC407CNG", "EX/31WB", "55320631000R", "505409", "active", Date.now());
  insC.run("TATA", "SIGNA 2823.K", "TC ISBE5.6", "52102339000R", "612345", "active", Date.now());
  const id = (vc: string) => (db.prepare(`SELECT id FROM partsetu_catalogs WHERE vc_no = ?`).get(vc) as any).id as number;
  const cat1 = id("55320631000R"), cat2 = id("52102339000R");
  const insI = db.prepare(
    `INSERT OR IGNORE INTO partsetu_vehicle_identifiers (catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at)
     VALUES (?, ?, ?, ?, 1.0, 'pdf_extract', ?)`,
  );
  for (const [cid, v] of [[cat1, "505409"], [cat2, "612345"]] as [number, string][]) {
    insI.run(cid, "chassis_type", v, v, Date.now());
    insI.run(cid, "vds", v, v, Date.now());
  }

  // --- 1. extraction pulls the embedded chassis number out of prose ---
  const c1 = uvi.extractVehicleIdentifierCandidates("tata ka chassis no hai 505409");
  check("1 extract embedded '505409'", c1.includes("505409"), JSON.stringify(c1));

  const c2 = uvi.extractVehicleIdentifierCandidates("hello how are you");
  check("2 no identifier → empty", c2.length === 0, JSON.stringify(c2));

  const c3 = uvi.extractVehicleIdentifierCandidates("my vin is MAT505409ABCDEFGHJ please help");
  check("3 extract full VIN candidate", c3.some((x) => /^MAT/i.test(x)), JSON.stringify(c3));

  // --- 2/3. resolve + pickBest for the bug message → auto_lock cat1 ---
  const results = await Promise.all(c1.map((c) => uvi.resolveVehicle(c)));
  const best = uvi.pickBestUvi(results);
  check("4 pickBestUvi auto_lock cat1", !!best?.auto_lock && best.auto_lock.catalog_id === cat1, JSON.stringify(best?.auto_lock));

  // --- 4. verified-vehicle block + system prompt injection ---
  const vblock = prompt.buildVerifiedVehicleBlock("505409", best!.auto_lock, best!.candidates);
  check("5 block has VERIFIED VEHICLE CONTEXT", vblock.includes("VERIFIED VEHICLE CONTEXT"), "");
  check("6 block has Catalog ID", vblock.includes(`Catalog ID: ${cat1}`), "");
  check("7 block has model SFC407CNG", vblock.includes("SFC407CNG"), "");
  check("8 block forbids 'discontinued' hallucination", /discontinued/i.test(vblock) && /Do NOT/i.test(vblock), "");
  check("9 block says NOT a model number", /NOT a model number/i.test(vblock), "");

  const sys = prompt.buildPartsetuSystemPrompt("(no matching catalog or cross-reference data found for this query)", vblock);
  check("10 system prompt STARTS with verified block", sys.startsWith("=== VERIFIED VEHICLE CONTEXT"), sys.slice(0, 40));
  check("11 system prompt has anti-hallucination rules", sys.includes("RULES FOR VEHICLE IDENTIFIERS") && sys.includes('"Tata 407" does NOT exist'), "");
  check("12 system prompt still has CONTEXT block", sys.includes("CONTEXT (catalogue") && sys.includes("no matching catalog"), "");

  // --- multi-candidate disambiguation block ---
  const ambBlock = prompt.buildVerifiedVehicleBlock("5054", null, results[0].candidates.length ? [results[0].candidates[0]] : []);
  // craft a real two-candidate set: '5054' prefix matches cat1 only here, so
  // assert the no-auto_lock path produces a POSSIBLE MATCHES block when given candidates.
  const fakeCands = [
    { catalog_id: cat1, model: "SFC407CNG", variant: "EX/31WB", vc_no: "55320631000R", matched_strategies: ["chassis_type_prefix"], score: 75, confidence: "medium" as const, matched_value: "x" },
    { catalog_id: cat2, model: "SIGNA 2823.K", variant: "TC ISBE5.6", vc_no: "52102339000R", matched_strategies: ["chassis_type_prefix"], score: 72, confidence: "medium" as const, matched_value: "y" },
  ];
  const disBlock = prompt.buildVerifiedVehicleBlock("5054", null, fakeCands);
  check("13 multi-candidate → POSSIBLE VEHICLE MATCHES", disBlock.includes("POSSIBLE VEHICLE MATCHES") && disBlock.includes(`catalog_id=${cat2}`), "");

  // --- no-match: empty block, prompt still valid (no false ground truth) ---
  const emptyBlock = prompt.buildVerifiedVehicleBlock("hello", null, []);
  check("14 no match → empty verified block", emptyBlock === "", JSON.stringify(emptyBlock));
  const sys2 = prompt.buildPartsetuSystemPrompt("RESOLVER: NONE", emptyBlock);
  check("15 prompt w/o block does NOT start with verified header", !sys2.startsWith("=== VERIFIED"), sys2.slice(0, 30));

  void ambBlock;
  console.log(`\n=== R27.24a4 SMOKE: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2); });
