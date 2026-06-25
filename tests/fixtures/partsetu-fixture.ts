// R27.24c — PartSetu AI test fixture. Seeds an isolated SQLite DB (5 catalogs,
// ~50 OEM-style parts each drawn from the synonym map, vehicle identifiers, and
// 50+ bidirectional xref rows) and exposes simulateChatMessage(), which runs the
// production chat pipeline (intent → UVI → search → context/prompt assembly →
// citation guard) MINUS the live Sonnet call. Intent uses the deterministic
// path only (multi-part short-circuit, else heuristic) so no Haiku call is made.
//
// DATA_DIR is pinned by tests/fixtures/setup-env.ts before any of these modules
// load, so `rawSqlite` already points at this file's private temp DB.
import { rawSqlite as db } from "../../server/storage";
import { runPartSetuMigrations } from "../../server/migrations";
import * as partsetu from "../../server/partsetu";
import * as uvi from "../../server/services/partsetu/uvi-resolver";
import * as search from "../../server/services/partsetu/search";
import * as prompt from "../../server/services/partsetu/prompt";
import {
  classifyIntentHeuristic,
  extractMultiPartList,
  type Intent,
  type SessionState,
} from "../../server/services/partsetu/intent";
import { PART_SYNONYMS } from "../../server/services/partsetu/part-synonyms";

export interface SeedCatalog {
  id: number;
  oem: string;
  model: string;
  variant: string;
  vc_no: string;
  chassis_type: string;
  emission_stage: string;
}

// The 5 seed catalogs. chassis_type values are the ones the spec pins; vc_no
// values are distinct and deliberately NOT "55320631000R" (CONV.5's
// known-absent number) so the hallucination-guard test stays honest.
export const SEED_CATALOGS: SeedCatalog[] = [
  { id: 1, oem: "Tata", model: "SIGNA 2818.K", variant: "BS6 Tipper", vc_no: "51610568000R", chassis_type: "505409", emission_stage: "BS6" },
  { id: 2, oem: "Tata", model: "LPK 2518", variant: "BS4 Cowl", vc_no: "51820431000R", chassis_type: "802502", emission_stage: "BS4" },
  { id: 3, oem: "Tata", model: "SFC 407CNG", variant: "EX 31WB", vc_no: "40712309000R", chassis_type: "835401", emission_stage: "BS6" },
  { id: 4, oem: "Tata", model: "YODHA 1700", variant: "4x2 Pickup", vc_no: "46477912000R", chassis_type: "464779", emission_stage: "BS6" },
  { id: 5, oem: "Eicher", model: "PRO 2049", variant: "BS6 Cargo", vc_no: "56705934000R", chassis_type: "567059", emission_stage: "BS6" },
];

// Known parts pinned with the realistic OEM numbers from the reference docs so
// exact-number and spec assertions are stable. Keyed by catalog id.
const KNOWN_PARTS: Record<number, Array<{ pn: string; desc: string; assembly: string }>> = {
  1: [
    { pn: "264742300101", desc: "CLUTCH DISC ASSY DIA.430 MM", assembly: "CLUTCH" },
    { pn: "277842300182", desc: "PRESSURE PLATE ASSY,CLUTCH 430 MM", assembly: "CLUTCH" },
    { pn: "252609110102", desc: "FILTER ASSY,LUB OIL", assembly: "LUBRICATION" },
    { pn: "252325108201", desc: "ELEMENT ASSY,AIR CLEANER", assembly: "INTAKE" },
  ],
  2: [
    { pn: "264742300202", desc: "CLUTCH DISC ASSY DIA.352 MM", assembly: "CLUTCH" },
    { pn: "253618140145", desc: "FILTER ASSY,FUEL WATER SEPARATOR", assembly: "FUEL" },
  ],
  3: [
    { pn: "407231100501", desc: "SPARK PLUG,CNG", assembly: "IGNITION" },
    { pn: "407231200502", desc: "FILTER ASSY,LUB OIL", assembly: "LUBRICATION" },
  ],
  4: [
    { pn: "464779100701", desc: "SHOCK ABSORBER ASSY,FRONT", assembly: "SUSPENSION" },
  ],
  5: [
    { pn: "567059100901", desc: "STARTER MOTOR ASSY 24V", assembly: "ELECTRICAL" },
  ],
};

let _seeded = false;
let _pnCounter = 0;

function nextGeneratedPn(catalogId: number): string {
  // 12-digit, unique across catalogs, never colliding with the KNOWN set.
  _pnCounter += 1;
  const tail = String(_pnCounter).padStart(6, "0");
  return `90${String(catalogId).padStart(2, "0")}${tail}00`.slice(0, 12);
}

function nowTs(): number { return Date.now(); }

function clearPartsetuData(): void {
  for (const t of [
    "partsetu_parts", "partsetu_catalogs", "partsetu_xref",
    "partsetu_vehicle_identifiers", "partsetu_conversations", "partsetu_messages",
  ]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist */ }
  }
  try { db.exec(`DELETE FROM sqlite_sequence WHERE name LIKE 'partsetu_%'`); } catch { /* ignore */ }
}

// Seed ~50 OEM-style parts for one catalog: every canonical name in the synonym
// map gets a part whose description uses an OEM-style phrasing (not the
// customer's words) so synonym-expanded search is genuinely exercised. KNOWN
// parts for the catalog are inserted verbatim first.
export function seedRealisticParts(catalogId: number): Array<{ part_number: string; description: string; canonical: string }> {
  const out: Array<{ part_number: string; description: string; canonical: string }> = [];
  const ins = db.prepare(
    `INSERT INTO partsetu_parts
       (catalog_id, group_code, table_code, assembly_name, fig_no, part_number, description, qty, remarks, is_serviceable, page_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );

  for (const k of KNOWN_PARTS[catalogId] || []) {
    ins.run(catalogId, "GRP", "TBL", k.assembly, "1", k.pn, k.desc, 1, "", 1, nowTs());
    out.push({ part_number: k.pn, description: k.desc, canonical: k.assembly.toLowerCase() });
  }

  const canonicalNames = Object.keys(PART_SYNONYMS);
  for (const canonical of canonicalNames) {
    const syns = PART_SYNONYMS[canonical];
    // Prefer an OEM-style phrasing that differs from the customer's words.
    const oem = (syns.find((s) => s !== canonical) || canonical).toUpperCase();
    const desc = `${oem} ASSY`;
    const pn = nextGeneratedPn(catalogId);
    ins.run(catalogId, "GRP", "TBL", canonical.toUpperCase(), "1", pn, desc, 1, "", 1, nowTs());
    out.push({ part_number: pn, description: desc, canonical });
  }
  return out;
}

function seedCatalogs(): void {
  const ins = db.prepare(
    `INSERT INTO partsetu_catalogs
       (id, oem, model, variant, vc_no, chassis_type, emission_stage, status, ingested_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  );
  for (const c of SEED_CATALOGS) {
    ins.run(c.id, c.oem, c.model, c.variant, c.vc_no, c.chassis_type, c.emission_stage, nowTs(), nowTs());
  }
}

function seedVehicleIdentifiers(): void {
  let stmt: any;
  try {
    stmt = db.prepare(
      `INSERT OR IGNORE INTO partsetu_vehicle_identifiers
         (catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at)
       VALUES (?, ?, ?, ?, 1.0, 'test_seed', ?)`,
    );
  } catch { return; }
  const norm = (s: string) => uvi.normalize(s);
  for (const c of SEED_CATALOGS) {
    stmt.run(c.id, "vc_no", c.vc_no, norm(c.vc_no), nowTs());
    stmt.run(c.id, "chassis_type", c.chassis_type, norm(c.chassis_type), nowTs());
  }
}

// 50+ bidirectional cross-reference rows. The walk in search.resolveXref is
// bidirectional, so one row per equivalence is enough; we pair seeded OEM
// numbers with synthetic aftermarket numbers across several brands.
export function seedXref(oemNumbers: string[]): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO partsetu_xref
       (source_brand, source_part_no, source_description, customer_oem, customer_part_no, status, created_at)
     VALUES (?, ?, ?, 'Tata', ?, 'active', ?)`,
  );
  const brands = ["Wabco", "Bosch", "Knorr", "MEI", "Valeo"];
  // Pin the documented equivalence first.
  const pinned: Array<[string, string, string]> = [
    ["Wabco", "100251260", "264742300101"],
    ["Bosch", "0445120123", "252609110102"],
    ["Knorr", "0486202005", "277842300182"],
    ["MEI", "S2120", "264742300202"],
  ];
  let n = 0;
  for (const [brand, src, cust] of pinned) {
    n += ins.run(brand, src, `${brand} equivalent`, cust, nowTs()).changes;
  }
  let i = 0;
  for (const oem of oemNumbers) {
    if (i >= 60) break;
    const brand = brands[i % brands.length];
    const synthetic = `${brand.slice(0, 2).toUpperCase()}${String(100000 + i)}`;
    n += ins.run(brand, synthetic, `${brand} aftermarket`, oem, nowTs()).changes;
    i += 1;
  }
  return n;
}

export interface TestDb {
  db: typeof db;
  catalogs: SeedCatalog[];
  cleanup: () => void;
}

// Idempotent: seeds once per process (per test file fork) and reuses thereafter.
export function setupTestDb(): TestDb {
  if (!_seeded) {
    runPartSetuMigrations();
    clearPartsetuData();
    seedCatalogs();
    const allOem: string[] = [];
    for (const c of SEED_CATALOGS) {
      const parts = seedRealisticParts(c.id);
      for (const p of parts) allOem.push(p.part_number);
    }
    seedVehicleIdentifiers();
    seedXref(allOem);
    // Rebuild FTS in case the build's triggers didn't fire on bulk insert.
    try { db.exec(`INSERT INTO partsetu_parts_fts(partsetu_parts_fts) VALUES('rebuild')`); } catch { /* no fts5 */ }
    try { db.exec(`INSERT INTO partsetu_catalogs_fts(partsetu_catalogs_fts) VALUES('rebuild')`); } catch { /* no fts5 */ }
    _seeded = true;
  }
  return { db, catalogs: SEED_CATALOGS, cleanup: () => { /* temp dir removed on process exit */ } };
}

// Deterministic intent: multi-part short-circuit (no LLM), else the heuristic.
// Mirrors classifyIntent() minus the Haiku call.
export function classifyIntentDeterministic(message: string, state: SessionState): Intent {
  const partList = extractMultiPartList(message);
  if (partList) {
    return {
      kind: "multi_part_list",
      partTokens: Array.from(new Set(partList.flatMap((p) => p.tokens))),
      partNumbers: (message.match(/\d{10,14}/g) || []),
      specs: {},
      bypassLock: false,
      partList,
    };
  }
  return classifyIntentHeuristic(message, state);
}

export interface SimSessionState {
  lockedCatalogId?: number | null;
  chassisNo?: string | null;
}

export interface SimResult {
  intent: Intent;
  uviResult: uvi.UviResult | null;
  uviCandidates: string[];
  catalogId: number | null;
  searchResult: search.SearchResult;
  verifiedVehicleBlock: string;
  contextBlock: string;
  systemPrompt: string;
  allowList: Set<string>;
  resolverNote: string;
}

// Run the production chat pipeline minus the Sonnet network call. Faithful to
// routes-v2.ts: UVI probe → auto-lock/verified block → catalog resolution →
// deterministic intent → multi-strategy search → context+prompt assembly →
// allow-list. `sessionState.lockedCatalogId` stands in for a prior turn's
// conv.catalog_context_id (production persists this in the DB).
export async function simulateChatMessage(
  message: string,
  sessionState: SimSessionState = {},
): Promise<SimResult> {
  const priorLock = sessionState.lockedCatalogId ?? null;

  // 1) UVI probe across every identifier candidate in the message.
  const uviCandidates = uvi.extractVehicleIdentifierCandidates(message);
  let bestUvi: uvi.UviResult | null = null;
  let matchedInput = "";
  if (uviCandidates.length) {
    const results = await Promise.all(uviCandidates.map((c) => uvi.resolveVehicle(c)));
    bestUvi = uvi.pickBestUvi(results);
    const bi = bestUvi ? results.indexOf(bestUvi) : -1;
    matchedInput = bi >= 0 ? uviCandidates[bi] : (uviCandidates[0] || "");
  }

  let verifiedVehicleBlock = "";
  let uviLockedCatalogId: number | null = null;
  if (bestUvi) {
    if (bestUvi.auto_lock && !priorLock) uviLockedCatalogId = bestUvi.auto_lock.catalog_id;
    verifiedVehicleBlock = prompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
  }

  // 2) Catalog resolution (prior lock wins, then UVI auto-lock, then fuzzy).
  let catalogId: number | null = priorLock || uviLockedCatalogId || null;
  let resolverNote = "";
  if (!catalogId) {
    const resolved = await partsetu.resolveCatalog(message);
    if (resolved.kind === "exact") {
      catalogId = resolved.catalog_id;
    } else if (resolved.kind === "suggest") {
      const lines = resolved.candidates.map((c: any, i: number) =>
        `${i + 1}. ${[c.model, c.variant].filter(Boolean).join(" ") || "(unnamed)"} — vc ${c.vc_no || "-"} (score ${c.score})`);
      resolverNote = `RESOLVER: SUGGEST — closest catalogue matches (present these numbered, max 5, ask the customer to pick; invent nothing):\n${lines.join("\n")}\n`;
    } else {
      resolverNote = "RESOLVER: NONE — no vehicle identified yet. Do NOT answer the part query; ask the customer for a chassis or registration number (per HARD RULE A).\n";
    }
  }

  // 3) Deterministic intent + multi-strategy search.
  const lockedCatalog = catalogId ? partsetu.getCatalog(catalogId) : null;
  const lockedVehicle = lockedCatalog
    ? [lockedCatalog.model, lockedCatalog.variant].filter(Boolean).join(" ") || lockedCatalog.oem
    : null;
  const intent = classifyIntentDeterministic(message, { lockedCatalogId: catalogId, lockedVehicle });
  const searchResult = await search.searchParts(intent, { lockedCatalogId: catalogId });

  // 4) Context + prompt assembly (mirrors routes-v2).
  let verifiedBlock = "";
  if (searchResult.hits.length) {
    const lines = searchResult.hits.slice(0, 12).map((h) =>
      `- ${h.part_number || "(no number)"}: ${h.description || ""} (from ${h.catalog_label}) [${h.strategies_matched.join("+")}]`);
    verifiedBlock =
      "VERIFIED CATALOG SEARCH (R27.24a — these rows come from partsetu_parts joined to partsetu_catalogs; you MUST cite the '(from catalog #X ...)' source for every part number you quote, and NEVER state a part number that is not in this list or the context below):\n" +
      lines.join("\n") + "\n";
  }
  if (intent.bypassLock && catalogId) {
    verifiedBlock = `NOTE: This is an exploratory / cross-reference query — you MAY suggest matching parts from OTHER catalogs (not just the locked vehicle), as long as you clearly state which catalog each part comes from.\n${verifiedBlock}`;
  }

  let contextBlock = await partsetu.buildContextBlock(message, catalogId, sessionState.chassisNo || null);
  if (verifiedBlock) contextBlock = `${verifiedBlock}\n${contextBlock}`;
  if (intent.kind === "multi_part_list" && searchResult.perPart?.length) {
    const lc = catalogId ? partsetu.getCatalog(catalogId) : null;
    const label = lc
      ? `catalog #${catalogId} — ${[lc.model, lc.variant].filter(Boolean).join(" ") || lc.oem || ""}`.trim()
      : "the locked catalog";
    const lookupBlock = prompt.buildPartLookupBlock(searchResult.perPart, label);
    if (lookupBlock) contextBlock = `${lookupBlock}\n\n${contextBlock}`;
  }
  if (resolverNote) contextBlock = `${resolverNote}\n${contextBlock}`;

  const systemPrompt = prompt.buildPartsetuSystemPrompt(contextBlock, verifiedVehicleBlock);
  const allowList = search.collectPermittedPartNumbers(searchResult);

  return {
    intent, uviResult: bestUvi, uviCandidates, catalogId, searchResult,
    verifiedVehicleBlock, contextBlock, systemPrompt, allowList, resolverNote,
  };
}

// Convenience re-exports for tests.
export { uvi, search, prompt, partsetu };
