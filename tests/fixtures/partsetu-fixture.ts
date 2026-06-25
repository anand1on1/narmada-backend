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
  detectDisambiguationReply,
  detectPartDisambiguationReply,
  detectPartsAppend,
  isDisambiguationCancel,
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
  sessionId?: string | null;
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
  needsDisambiguation: boolean;
  disambiguationResolved: boolean;
  selectedCandidateIndex: number | null;
  replayedQuery: string | null;
  // R27.24a9
  vehicleRelocked: boolean;
  sameCatalogNoOp: boolean;
  relockArchivedItems: number;
  cartCount: number;
  isPartsAppend: boolean;
  partNeedsDisambiguation: boolean;
  partOptionsCount: number;
  partDisambiguationResolved: boolean;
  selectedPartIndex: number | null;
  selectedPartName: string | null;
  selectedPartOem: string | null;
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
  const sessionId = sessionState.sessionId ?? null;

  // 0) R27.24a8 — DB-backed disambiguation reply routing (mirrors routes-v2).
  // A pending candidate set from a prior turn + a short reply → lock chosen
  // vehicle and replay the original query. Expiry 10 min; cancel clears.
  let disambiguationResolved = false;
  let selectedCandidateIndex: number | null = null;
  let replayedQuery: string | null = null;
  let resolvedLock: number | null = null;
  if (sessionId) {
    const pending = partsetu.getPendingDisambiguation(sessionId);
    if (pending) {
      if (Date.now() > pending.expires_at) {
        partsetu.clearPendingDisambiguation(sessionId);
      } else {
        const picked = detectDisambiguationReply(message, pending.candidates);
        if (picked) {
          partsetu.clearPendingDisambiguation(sessionId);
          resolvedLock = picked.selectedUvi.catalog_id;
          selectedCandidateIndex = picked.selectedCandidateIndex;
          replayedQuery = pending.original_query || null;
          disambiguationResolved = true;
        } else if (isDisambiguationCancel(message)) {
          partsetu.clearPendingDisambiguation(sessionId);
        }
        // else keep pending, fall through.
      }
    }
  }
  // R27.24a9 gap 4 — PART-name disambiguation reply routing (mirrors routes-v2).
  let partDisambiguationResolved = false;
  let selectedPartIndex: number | null = null;
  let selectedPartName: string | null = null;
  let selectedPartOem: string | null = null;
  let partDisambiguationReplay: string | null = null;
  if (sessionId) {
    const pendingPart = partsetu.getPendingPartDisambiguation(sessionId);
    if (pendingPart) {
      if (Date.now() > pendingPart.expires_at) {
        partsetu.clearPendingPartDisambiguation(sessionId);
      } else {
        const picked = detectPartDisambiguationReply(message, pendingPart.candidates as any);
        if (picked) {
          partsetu.clearPendingPartDisambiguation(sessionId);
          partDisambiguationResolved = true;
          selectedPartIndex = picked.selectedCandidateIndex;
          selectedPartName = picked.selectedPart.part_name || null;
          selectedPartOem = picked.selectedPart.oem_number || null;
          partDisambiguationReplay = picked.selectedPart.part_name || pendingPart.original_query || null;
        } else if (isDisambiguationCancel(message)) {
          partsetu.clearPendingPartDisambiguation(sessionId);
        }
      }
    }
  }

  let activeMessage = replayedQuery ?? partDisambiguationReplay ?? message;
  const effectiveLock = resolvedLock ?? priorLock;

  // 1) UVI probe across every identifier candidate in the message.
  const uviCandidates = uvi.extractVehicleIdentifierCandidates(message);
  let bestUvi: uvi.UviResult | null = null;
  let matchedInput = "";
  let uviResults: uvi.UviResult[] = [];
  if (uviCandidates.length) {
    uviResults = await Promise.all(uviCandidates.map((c) => uvi.resolveVehicle(c)));
    bestUvi = uvi.pickBestUvi(uviResults);
    const bi = bestUvi ? uviResults.indexOf(bestUvi) : -1;
    matchedInput = bi >= 0 ? uviCandidates[bi] : (uviCandidates[0] || "");
  }

  // Mirror routes-v2 bug-3 disambiguation: ≥2 distinct auto-lock catalogs and
  // no prior lock → emit the disambiguation block and do NOT lock.
  const distinctLocks = new Map<number, { input: string; lock: uvi.UviCandidate }>();
  uviResults.forEach((r, idx) => {
    if (r.auto_lock && !distinctLocks.has(r.auto_lock.catalog_id)) {
      distinctLocks.set(r.auto_lock.catalog_id, { input: uviCandidates[idx], lock: r.auto_lock });
    }
  });

  let verifiedVehicleBlock = "";
  let uviLockedCatalogId: number | null = null;
  let needsDisambiguation = false;
  let vehicleRelocked = false;
  let sameCatalogNoOp = false;
  let relockArchivedItems = 0;
  if (distinctLocks.size >= 2 && !effectiveLock) {
    needsDisambiguation = true;
    const matches = Array.from(distinctLocks.values());
    verifiedVehicleBlock = prompt.buildDisambiguationBlock(matches);
    if (sessionId) partsetu.savePendingDisambiguation(sessionId, matches, message);
  } else if (bestUvi) {
    if (bestUvi.auto_lock) {
      const newCatalogId = bestUvi.auto_lock.catalog_id;
      if (!effectiveLock) {
        uviLockedCatalogId = newCatalogId;
        verifiedVehicleBlock = prompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
      } else if (effectiveLock === newCatalogId) {
        // gap 5 — same-catalog high-confidence UVI: deliberate no-op.
        sameCatalogNoOp = true;
      } else {
        // gap 1 + gap 5 — active vehicle changed: switch + purge prior state.
        vehicleRelocked = true;
        uviLockedCatalogId = newCatalogId;
        if (sessionId) {
          relockArchivedItems = partsetu.archivePartsCart(sessionId);
          partsetu.clearPendingPartDisambiguation(sessionId);
        }
        verifiedVehicleBlock =
          `ACTIVE VEHICLE CHANGED — switched to catalog #${newCatalogId}; ignore part numbers from catalog #${effectiveLock}.\n\n` +
          prompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
      }
    } else {
      verifiedVehicleBlock = prompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
    }
  }

  // 2) Catalog resolution. R27.24a9: a re-lock (uviLockedCatalogId) overrides the
  // prior lock; otherwise prior/resolved lock wins, then UVI auto-lock, then fuzzy.
  let catalogId: number | null = uviLockedCatalogId ?? effectiveLock ?? null;
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

  // R27.24a9 gap 3 — parts-append: "aur clutch bhi chahiye" with a non-empty
  // cart narrows the active query to that single part.
  const cartBefore = (sessionId && catalogId) ? partsetu.getCart(sessionId, catalogId) : [];
  const appendPart = detectPartsAppend(message);
  const isPartsAppend = !!appendPart && cartBefore.length > 0 && !replayedQuery && !partDisambiguationReplay;
  if (isPartsAppend) activeMessage = appendPart!;

  // 3) Deterministic intent + multi-strategy search.
  const lockedCatalog = catalogId ? partsetu.getCatalog(catalogId) : null;
  const lockedVehicle = lockedCatalog
    ? [lockedCatalog.model, lockedCatalog.variant].filter(Boolean).join(" ") || lockedCatalog.oem
    : null;
  const intent = classifyIntentDeterministic(activeMessage, { lockedCatalogId: catalogId, lockedVehicle });
  const searchResult = await search.searchParts(intent, { lockedCatalogId: catalogId });

  // R27.24a9 gap 4 — part-name disambiguation trigger (mirrors routes-v2): a
  // single bare part token resolving to >=2 distinct catalog parts → persist the
  // candidates + original query and flag for a follow-up choice.
  let partNeedsDisambiguation = false;
  let partOptionsCount = 0;
  if (
    sessionId && catalogId && !intent.bypassLock && intent.kind === "locked_vehicle_part" &&
    !replayedQuery && !partDisambiguationReplay && !isPartsAppend &&
    Object.keys(intent.specs).length === 0
  ) {
    const bareTokens = intent.partTokens.filter((t) => !/^\d+$/.test(t) && t.length >= 3);
    const distinct: Array<{ part_name: string; oem_number: string }> = [];
    const seenNums = new Set<string>();
    for (const h of searchResult.hits) {
      const num = String(h.part_number || "").trim();
      if (!num || seenNums.has(num)) continue;
      seenNums.add(num);
      distinct.push({ part_name: h.description || activeMessage, oem_number: num });
      if (distinct.length >= 5) break;
    }
    if (bareTokens.length === 1 && distinct.length >= 2) {
      partsetu.savePendingPartDisambiguation(sessionId, distinct, activeMessage);
      partNeedsDisambiguation = true;
      partOptionsCount = distinct.length;
    }
  }

  // R27.24a9 gap 3 — record found OEM numbers in the session cart.
  if (sessionId && catalogId && !partNeedsDisambiguation && searchResult.hits.length) {
    for (const h of searchResult.hits.slice(0, 12)) {
      if (h.part_number) partsetu.addToCart(sessionId, catalogId, h.description || activeMessage, String(h.part_number));
    }
  }
  const cartCount = (sessionId && catalogId) ? partsetu.getCart(sessionId, catalogId).length : 0;

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

  let contextBlock = await partsetu.buildContextBlock(activeMessage, catalogId, sessionState.chassisNo || null);
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
    needsDisambiguation, disambiguationResolved, selectedCandidateIndex, replayedQuery,
    vehicleRelocked, sameCatalogNoOp, relockArchivedItems, cartCount, isPartsAppend,
    partNeedsDisambiguation, partOptionsCount,
    partDisambiguationResolved, selectedPartIndex, selectedPartName, selectedPartOem,
  };
}

// Convenience re-exports for tests.
export { uvi, search, prompt, partsetu };
