// R27.24a5 smoke — multi-part-list intent + synonym-expanded per-part search.
// Reproduces the production low-recall bug: a user locked to catalog #22
// (SFC407CNG) asked for ~12 common parts in one message and only 2 were found
// because searchParts ran one combined FTS soup. We now detect the list
// deterministically (extractMultiPartList), then run each part through a 5-tier
// synonym-expanded search so OEM-style descriptions (FILTER ASSY,LUB OIL /
// ELEMENT,AIR CLEANER) are matched.
// Run from repo root: npx tsx scripts/smoke-r27-24a5.ts
import * as fs from "node:fs";
const DATA_DIR = "/tmp/r27_24a5_smoke_data";
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

  const intent = await import("../server/services/partsetu/intent");
  const search = await import("../server/services/partsetu/search");
  const prompt = await import("../server/services/partsetu/prompt");
  const syn = await import("../server/services/partsetu/part-synonyms");

  // --- seed: catalog id=22 (SFC407CNG, EX/31WB BS-IV, chassis_type 505409) ---
  db.prepare(`INSERT INTO partsetu_catalogs (id, oem, model, variant, vc_no, chassis_type, status, uploaded_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(22, "TATA", "SFC407CNG", "EX/31WB BS-IV", "55320631000R", "505409", "active", Date.now());
  const CAT = 22;
  const insP = db.prepare(`INSERT INTO partsetu_parts (catalog_id, part_number, description, qty, created_at) VALUES (?,?,?,?,?)`);
  const seedParts: [string, string][] = [
    ["252609110102", "FILTER ASSY,LUB OIL"],
    ["252609220105", "CARTRIDGE,FUEL FILTER"],
    ["252751180103", "ELEMENT,AIR CLEANER"],
    ["252325108201", "CLUTCH HOUSING (LOWER PART)"],
    ["252750115823", "HOSE (THERMOSTAT TO RADIATOR)"],
    ["252609330107", "STARTER MOTOR ASSY"],
    ["253008440205", "BATTERY,12V 75AH"],
    ["252609550308", "SPARK PLUG,CNG"],
  ];
  for (const [pn, desc] of seedParts) insP.run(CAT, pn, desc, 1, Date.now());

  // --- 1. extractMultiPartList parses 8 distinct parts out of one message ---
  const msg = "OEM part numbers chahiye for: oil filter, fuel filter, air filter, clutch plate, radiator hose, starter motor, battery, spark plug";
  const list = intent.extractMultiPartList(msg);
  check("1 extractMultiPartList → 8 parts", !!list && list.length === 8, JSON.stringify(list?.map((l) => l.rawName)));

  // --- 2. classifyIntent short-circuits to multi_part_list (no LLM) ---
  const it = await intent.classifyIntent(msg, { lockedCatalogId: CAT, lockedVehicle: "SFC407CNG" });
  check("2 intent kind=multi_part_list", it.kind === "multi_part_list" && it.bypassLock === false && (it.partList?.length === 8), `kind=${it.kind}`);

  // --- 3. per-part search finds a hit for every requested part ---
  const res = await search.searchParts(it, { lockedCatalogId: CAT });
  const found = (res.perPart || []).filter((p) => p.parts.length).length;
  check("3 all 8 parts find a hit", found === 8, `found=${found}/${res.perPart?.length}`);

  const byName = (n: string) => (res.perPart || []).find((p) => p.rawName.toLowerCase().includes(n));
  const hitPN = (n: string) => byName(n)?.parts[0]?.part_number;
  const hitDesc = (n: string) => byName(n)?.parts[0]?.description;

  // --- 4. oil filter resolves to OEM "FILTER ASSY,LUB OIL" via synonym ---
  check("4 oil filter → FILTER ASSY,LUB OIL", /LUB OIL/i.test(hitDesc("oil filter") || ""), `${hitPN("oil filter")} ${hitDesc("oil filter")}`);

  // --- 5. air filter resolves to "ELEMENT,AIR CLEANER" via synonym ---
  check("5 air filter → ELEMENT,AIR CLEANER", /AIR CLEANER/i.test(hitDesc("air filter") || ""), `${hitPN("air filter")} ${hitDesc("air filter")}`);

  // --- 6. fuel filter resolves to "CARTRIDGE,FUEL FILTER" ---
  check("6 fuel filter → CARTRIDGE,FUEL FILTER", /FUEL FILTER/i.test(hitDesc("fuel filter") || ""), `${hitPN("fuel filter")} ${hitDesc("fuel filter")}`);

  // --- 7. union of per-part hits populates searchResult.hits (for citations) ---
  check("7 union hits ≥ 8", res.hits.length >= 8 && res.strategies.includes("multi_part_list"), `hits=${res.hits.length}`);

  // --- 8. non-existent part returns 0 hits cleanly (no fabrication) ---
  const snorkelList = {
    ...it,
    kind: "multi_part_list" as const,
    partList: [
      { rawName: "snorkel", tokens: ["snorkel"], expandedTokens: syn.expandPartName("snorkel") },
      { rawName: "oil filter", tokens: ["oil", "filter"], expandedTokens: syn.expandPartName("oil filter") },
      { rawName: "battery", tokens: ["battery"], expandedTokens: syn.expandPartName("battery") },
    ],
  };
  const snokRes = await search.searchParts(snorkelList, { lockedCatalogId: CAT });
  const snork = (snokRes.perPart || []).find((p) => p.rawName === "snorkel");
  check("8 non-existent 'snorkel' → 0 hits", !!snork && snork.parts.length === 0, JSON.stringify(snork?.parts.length));

  // --- bonus: buildPartLookupBlock renders numbers + NO MATCH honestly ---
  const block = prompt.buildPartLookupBlock(snokRes.perPart || [], `catalog #${CAT} — SFC407CNG EX/31WB BS-IV`);
  check("9 lookup block lists NO MATCH for snorkel", /snorkel — NO MATCH/i.test(block) && /PART LOOKUP RESULTS/.test(block), "");
  check("10 lookup block forbids invented numbers", /Quote ONLY the part numbers listed above/i.test(block), "");

  console.log(`\n=== R27.24a5 SMOKE: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2); });
