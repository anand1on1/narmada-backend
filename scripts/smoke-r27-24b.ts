// R27.24a6 + R27.24b smoke — citation-guard false-positive fix + system-prompt
// rewrite. Reproduces the production bug (SIGNA 4232.TK clutch reply had its
// part number stripped even though it was correctly cited) and verifies the
// unified allow-list, citation-trust, length floor, and new prompt body.
// Run from repo root: npx tsx scripts/smoke-r27-24b.ts
import * as fs from "node:fs";
const DATA_DIR = "/tmp/r27_24b_smoke_data";
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
delete process.env.CLAUDE_API_KEY; delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
const check = (n: string, c: boolean, x = "") => { c ? (pass++, console.log(`PASS ${n} ${x}`)) : (fail++, console.log(`FAIL ${n} ${x}`)); };

async function main() {
  const search = await import("../server/services/partsetu/search");
  const prompt = await import("../server/services/partsetu/prompt");
  const hit = (pn: string, label = "catalog #2 — SIGNA 4232.TK BS6-PH2") => ({
    id: Math.floor(Math.random() * 1e6), part_number: pn, description: "x", catalog_id: 2,
    catalog_label: label, score: 10, strategies_matched: ["fts_desc"],
  });

  // --- 1. collectPermittedPartNumbers across all 3 result shapes ---
  const legacy = { hits: [hit("252325108201"), hit("264742300101")], strategies: ["fts_desc"] };
  const s1 = search.collectPermittedPartNumbers(legacy as any);
  check("1 legacy hits → permitted set", s1.has("252325108201") && s1.has("264742300101") && s1.size === 2, `size=${s1.size}`);

  const multi = { hits: [], strategies: ["multi_part_list"], perPart: [
    { rawName: "clutch plate", parts: [hit("252325108201")], strategiesMatched: ["fts_token"], tier: "3_token" },
    { rawName: "oil filter", parts: [hit("252609110102")], strategiesMatched: ["fts_phrase"], tier: "1_fts" },
    { rawName: "snorkel", parts: [], strategiesMatched: [], tier: "0_none" },
  ] };
  const s2 = search.collectPermittedPartNumbers(multi as any);
  check("2 perPart results → permitted set", s2.has("252325108201") && s2.has("252609110102") && s2.size === 2, `size=${s2.size}`);

  // normalization: spaces/dashes stripped, uppercased
  const s3 = search.collectPermittedPartNumbers({ hits: [hit("2523-2510 8201")], strategies: [] } as any);
  check("3 normalization strips space/dash", s3.has("252325108201"), JSON.stringify(Array.from(s3)));

  // --- citation guard behaviors ---
  const permitted = new Set<string>(["252325108201"]);

  // 4. number properly cited (Catalog: ...) → keep even if NOT in allow-list
  const r4 = search.enforcePartCitations("CLUTCH DISC 430 DIA — 264742300101\n(Catalog: SIGNA 4232.TK BS6-PH2)", [], "", new Set());
  check("4 cited number kept (no allow-list)", r4.includes("264742300101") && !/withheld/.test(r4), r4.replace(/\n/g, " "));

  // 5. unlisted number, no citation → stripped
  const r5 = search.enforcePartCitations("Clutch part hai 999988887777 le lo", [], "", new Set());
  check("5 unlisted+uncited stripped", !r5.includes("999988887777") && /withheld/.test(r5), r5.replace(/\n/g, " "));

  // 6. 3-digit dimension "380 dia" → keep (length < 8)
  const r6 = search.enforcePartCitations("Clutch 380 dia chahiye", [], "", new Set());
  check("6 3-digit dim kept", r6.includes("380") && !/withheld/.test(r6), r6);

  // 7. 6-digit chassis 505409 → keep (length 6 < 8)
  const r7 = search.enforcePartCitations("Aapka chassis 505409 mila", [], "", new Set());
  check("7 6-digit chassis kept", r7.includes("505409") && !/withheld/.test(r7), r7);

  // 8. 12-digit part in allow-list → keep
  const r8 = search.enforcePartCitations("Clutch Plate 252325108201", [], "", permitted);
  check("8 permitted part kept", r8.includes("252325108201") && !/withheld/.test(r8), r8.replace(/\n/g, " "));

  // 9. 12-digit part NOT in allow-list, no citation → stripped
  const r9 = search.enforcePartCitations("Random number 123456789012", [], "", permitted);
  check("9 unlisted part stripped", !r9.includes("123456789012") && /withheld/.test(r9), r9.replace(/\n/g, " "));

  // 10. number permitted via the unified set built from perPart → kept (the
  //     exact production regression: multi-part result number must survive).
  const permittedMulti = search.collectPermittedPartNumbers(multi as any);
  const r10 = search.enforcePartCitations("Clutch Plate 252325108201 mil gaya", [], "", permittedMulti);
  check("10 multi-part number survives guard", r10.includes("252325108201") && !/withheld/.test(r10), r10.replace(/\n/g, " "));

  // --- new system prompt ---
  const sysEmpty = prompt.buildPartsetuSystemPrompt("", "");
  check("11 prompt: 5-8 digit = chassis rule", /5-8 digit number .* is a CHASSIS TYPE CODE/i.test(sysEmpty), "");
  check("12 prompt: never invent part numbers", /NEVER invent.*part number/i.test(sysEmpty), "");
  check("13 prompt: chassis few-shot example", sysEmpty.includes("EXAMPLES") && /chassis number MAT/i.test(sysEmpty), "");
  check("14 prompt static body < 8000 chars", sysEmpty.length < 8000, `len=${sysEmpty.length}`);

  // a4 contract still honored (regression-critical tokens)
  const vblock = prompt.buildVerifiedVehicleBlock("505409", {
    catalog_id: 2, model: "SFC407CNG", variant: "EX/31WB", vc_no: "x", matched_strategies: ["chassis_type"], score: 98, confidence: "high" as const, matched_value: "505409",
  }, []);
  const sysV = prompt.buildPartsetuSystemPrompt("(no matching catalog or cross-reference data found for this query)", vblock);
  check("15 verified block still pinned to top", sysV.startsWith("=== VERIFIED VEHICLE CONTEXT") && sysV.includes('"Tata 407" does NOT exist') && sysV.includes("CONTEXT (catalogue"), "");

  console.log(`\n=== R27.24b SMOKE: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(2); });
