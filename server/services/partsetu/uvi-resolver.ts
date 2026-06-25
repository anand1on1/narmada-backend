// PartSetu AI R27.24a3 — Universal Vehicle Identifier (UVI) resolver.
//
// The old resolver classified the input format BEFORE searching: a fragment
// that didn't match a known regex (full 17-char MAT VIN, exact VC No, exact
// model) returned nothing. Real users paste partial VC Nos, 6-char chassis
// prefixes, model/variant names, OEM short codes, or bare digits and still
// expect a hit.
//
// This resolver never gives up at classification. It probes the input against
// every identifier field in parallel (exact + fuzzy VC No, the
// partsetu_vehicle_identifiers table, VDS extraction, chassis prefix, model/
// variant FTS5, OEM, digits-only), scores each catalog candidate, and returns
// a ranked list with an auto-lock decision and a disambiguation flag.
import { rawSqlite as db } from "../../storage";

export interface UviCandidate {
  catalog_id: number;
  model: string;
  variant: string;
  vc_no: string | null;
  matched_strategies: string[];
  score: number; // 0..100
  confidence: "high" | "medium" | "low";
  matched_value: string;
}

export interface UviResult {
  input: string;
  normalized: string;
  candidates: UviCandidate[]; // ranked desc by score, max 10
  auto_lock: UviCandidate | null;
  needs_disambiguation: boolean;
}

// ---- normalization helpers -------------------------------------------------
export function normalize(s: string): string {
  return String(s || "").toUpperCase().replace(/[\s\-._]/g, "");
}
export function digitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "");
}
export function alphanumOnly(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Auto-lock is only granted when the top hit came from a strategy that is an
// exact, unambiguous identifier match.
const EXACT_STRATEGIES = new Set(["exact_vc_no", "exact_vds", "identifier_table_exact"]);

interface CatRow {
  id: number;
  oem: string | null;
  model: string | null;
  variant: string | null;
  vc_no: string | null;
  chassis_no: string | null;
  chassis_prefix: string | null;
  vds_codes: string | null;
}

interface RawHit {
  catalog_id: number;
  strategy: string;
  score: number;
  matched_value: string;
}

// catalogs is a small table (dozens of rows in production); pulling it once and
// running the textual strategies in JS keeps the logic obvious. The two FTS5
// strategies and the identifier-table strategies stay in SQL.
function loadCatalogs(): CatRow[] {
  // chassis_prefix / vds_codes are R27.24a3 additive columns — they may be
  // absent on an un-migrated DB, so select defensively.
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(partsetu_catalogs)`).all() as any[]).map((c) => c.name),
  );
  const hasPrefix = cols.has("chassis_prefix");
  const hasVds = cols.has("vds_codes");
  const sel = [
    "id", "oem", "model", "variant", "vc_no",
    cols.has("chassis_no") ? "chassis_no" : "NULL AS chassis_no",
    hasPrefix ? "chassis_prefix" : "NULL AS chassis_prefix",
    hasVds ? "vds_codes" : "NULL AS vds_codes",
  ].join(", ");
  try { return db.prepare(`SELECT ${sel} FROM partsetu_catalogs`).all() as CatRow[]; }
  catch { return []; }
}

function ftsCatalogsAvailable(): boolean {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partsetu_catalogs_fts'`).get();
  } catch { return false; }
}

function identifierTableAvailable(): boolean {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partsetu_vehicle_identifiers'`).get();
  } catch { return false; }
}

// FTS5 MATCH expression from free text: alnum tokens, lowercased, prefix-wild.
function buildMatchExpr(input: string): string {
  const toks = Array.from(new Set(
    input.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 2),
  ));
  return toks.map((t) => `${t}*`).join(" OR ");
}

// ---- strategies ------------------------------------------------------------
function sExactVcNo(input: string, cats: CatRow[]): RawHit[] {
  const n = alphanumOnly(input);
  if (n.length < 3) return [];
  const out: RawHit[] = [];
  for (const c of cats) {
    if (c.vc_no && alphanumOnly(c.vc_no) === n) {
      out.push({ catalog_id: c.id, strategy: "exact_vc_no", score: 100, matched_value: c.vc_no });
    }
  }
  return out;
}

function sVcNoSubstring(input: string, cats: CatRow[]): RawHit[] {
  const n = alphanumOnly(input);
  const d = digitsOnly(input);
  if (n.length < 4 && d.length < 4) return [];
  const out: RawHit[] = [];
  for (const c of cats) {
    if (!c.vc_no) continue;
    const nvc = alphanumOnly(c.vc_no);
    const dvc = digitsOnly(c.vc_no);
    if (nvc === n) continue; // exact handled by strategy 1
    let hit = false;
    if (n.length >= 4 && (nvc.includes(n) || n.includes(nvc))) hit = true;
    else if (d.length >= 4 && (dvc.includes(d) || d.includes(dvc))) hit = true;
    if (hit) {
      const lenDiff = Math.abs(nvc.length - n.length);
      const score = Math.max(15, 70 - lenDiff * 2);
      out.push({ catalog_id: c.id, strategy: "vc_no_substring", score, matched_value: c.vc_no });
    }
  }
  return out;
}

function sIdentifierExact(input: string): RawHit[] {
  if (!identifierTableAvailable()) return [];
  const n = normalize(input);
  if (n.length < 3) return [];
  try {
    const rows = db.prepare(
      `SELECT catalog_id, identifier_type, identifier_value FROM partsetu_vehicle_identifiers WHERE normalized_value = ?`,
    ).all(n) as any[];
    return rows.map((r) => ({
      catalog_id: r.catalog_id, strategy: "identifier_table_exact", score: 95,
      matched_value: `${r.identifier_type}:${r.identifier_value}`,
    }));
  } catch { return []; }
}

function sIdentifierPrefix(input: string): RawHit[] {
  if (!identifierTableAvailable()) return [];
  const n = normalize(input);
  if (n.length < 3) return [];
  try {
    const rows = db.prepare(
      `SELECT catalog_id, identifier_type, identifier_value, normalized_value FROM partsetu_vehicle_identifiers
       WHERE normalized_value LIKE ? || '%' AND LENGTH(normalized_value) >= LENGTH(?)`,
    ).all(n, n) as any[];
    return rows
      .filter((r) => r.normalized_value !== n) // exact handled elsewhere
      .map((r) => ({
        catalog_id: r.catalog_id, strategy: "identifier_table_prefix", score: 75,
        matched_value: `${r.identifier_type}:${r.identifier_value}`,
      }));
  } catch { return []; }
}

function sVdsExtraction(input: string): RawHit[] {
  if (!identifierTableAvailable()) return [];
  const raw = String(input || "").trim();
  if (!/^MAT[A-Z0-9]{14}$/i.test(raw)) return [];
  const vds = raw.slice(3, 9).toUpperCase(); // chars 4-9
  try {
    const rows = db.prepare(
      `SELECT catalog_id, identifier_value FROM partsetu_vehicle_identifiers
       WHERE identifier_type = 'vds' AND normalized_value = ?`,
    ).all(normalize(vds)) as any[];
    return rows.map((r) => ({ catalog_id: r.catalog_id, strategy: "exact_vds", score: 90, matched_value: `vds:${vds}` }));
  } catch { return []; }
}

function sChassisPrefix(input: string, cats: CatRow[]): RawHit[] {
  const raw = String(input || "").trim();
  const core = normalize(raw).replace(/^MAT/, "");
  // input is 5-7 alphanumeric chars (optionally MAT-prefixed)
  if (core.length < 3 || core.length > 7) return [];
  const out: RawHit[] = [];
  // catalogs.chassis_prefix
  for (const c of cats) {
    if (c.chassis_prefix && normalize(c.chassis_prefix).startsWith(core)) {
      out.push({ catalog_id: c.id, strategy: "chassis_prefix", score: 80, matched_value: c.chassis_prefix });
    }
  }
  // identifier table chassis_prefix rows
  if (identifierTableAvailable()) {
    try {
      const rows = db.prepare(
        `SELECT catalog_id, identifier_value FROM partsetu_vehicle_identifiers
         WHERE identifier_type = 'chassis_prefix' AND normalized_value LIKE ? || '%'`,
      ).all(core) as any[];
      for (const r of rows) out.push({ catalog_id: r.catalog_id, strategy: "chassis_prefix", score: 80, matched_value: `chassis_prefix:${r.identifier_value}` });
    } catch { /* ignore */ }
  }
  return out;
}

function sFtsColumn(input: string, column: "model" | "variant", baseScore: number): RawHit[] {
  if (!ftsCatalogsAvailable()) return [];
  const expr = buildMatchExpr(input);
  if (!expr) return [];
  const colExpr = `${column} : (${expr})`;
  try {
    const rows = db.prepare(
      `SELECT rowid AS catalog_id, bm25(partsetu_catalogs_fts) AS rank
       FROM partsetu_catalogs_fts WHERE partsetu_catalogs_fts MATCH ?
       ORDER BY rank ASC LIMIT 5`,
    ).all(colExpr) as any[];
    // rank is more-negative = better; convert position to a 0..1 factor.
    return rows.map((r, i) => ({
      catalog_id: r.catalog_id,
      strategy: column === "model" ? "model_fts" : "variant_fts",
      score: Math.max(10, Math.round(baseScore * (1 - i * 0.18))),
      matched_value: input,
    }));
  } catch { return []; }
}

function sOemProbe(input: string, cats: CatRow[]): RawHit[] {
  const q = input.trim().toUpperCase();
  if (q.length < 2) return [];
  const out: RawHit[] = [];
  for (const c of cats) {
    if (c.oem && c.oem.toUpperCase().includes(q)) {
      out.push({ catalog_id: c.id, strategy: "oem", score: 40, matched_value: c.oem });
    }
  }
  return out;
}

function sDigitsFallback(input: string, cats: CatRow[]): RawHit[] {
  const d = digitsOnly(input);
  if (d.length < 4) return [];
  const out: RawHit[] = [];
  for (const c of cats) {
    if (c.vc_no && digitsOnly(c.vc_no).includes(d)) {
      out.push({ catalog_id: c.id, strategy: "digits_fallback", score: 30, matched_value: c.vc_no });
    }
  }
  return out;
}

// ---- main resolver ---------------------------------------------------------
export async function resolveVehicle(input: string): Promise<UviResult> {
  const raw = String(input || "");
  const normalized = normalize(raw);
  const cats = loadCatalogs();
  const catById = new Map<number, CatRow>(cats.map((c) => [c.id, c]));

  const tasks: Array<Promise<RawHit[]>> = [
    Promise.resolve().then(() => sExactVcNo(raw, cats)),
    Promise.resolve().then(() => sVcNoSubstring(raw, cats)),
    Promise.resolve().then(() => sIdentifierExact(raw)),
    Promise.resolve().then(() => sIdentifierPrefix(raw)),
    Promise.resolve().then(() => sVdsExtraction(raw)),
    Promise.resolve().then(() => sChassisPrefix(raw, cats)),
    Promise.resolve().then(() => sFtsColumn(raw, "model", 60)),
    Promise.resolve().then(() => sFtsColumn(raw, "variant", 50)),
    Promise.resolve().then(() => sOemProbe(raw, cats)),
    Promise.resolve().then(() => sDigitsFallback(raw, cats)),
  ];

  const settled = await Promise.allSettled(tasks);
  const merged = new Map<number, { score: number; strategies: string[]; matched_value: string }>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const hit of s.value) {
      if (!catById.has(hit.catalog_id)) continue; // ignore stale identifier rows
      const ex = merged.get(hit.catalog_id);
      if (ex) {
        ex.score += hit.score;
        if (!ex.strategies.includes(hit.strategy)) ex.strategies.push(hit.strategy);
        // prefer a matched_value from the highest-priority (exact) strategy
        if (EXACT_STRATEGIES.has(hit.strategy)) ex.matched_value = hit.matched_value;
      } else {
        merged.set(hit.catalog_id, { score: hit.score, strategies: [hit.strategy], matched_value: hit.matched_value });
      }
    }
  }

  let candidates: UviCandidate[] = Array.from(merged.entries()).map(([catalog_id, m]) => {
    const c = catById.get(catalog_id)!;
    const score = Math.min(100, Math.round(m.score));
    const confidence: UviCandidate["confidence"] = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
    return {
      catalog_id,
      model: c.model || "",
      variant: c.variant || "",
      vc_no: c.vc_no || null,
      matched_strategies: m.strategies,
      score,
      confidence,
      matched_value: m.matched_value,
    };
  });
  candidates.sort((a, b) => b.score - a.score);
  candidates = candidates.slice(0, 10);

  const top = candidates[0] || null;
  const second = candidates[1] || null;
  const auto_lock =
    top && top.score >= 80 &&
    (candidates.length === 1 || !second || second.score < 60) &&
    top.matched_strategies.some((s) => EXACT_STRATEGIES.has(s))
      ? top : null;
  const needs_disambiguation =
    candidates.length > 0 &&
    (top!.score < 50 || (!!second && top!.score - second.score < 15));

  console.log(
    `[partsetu] uvi input="${raw}" normalized="${normalized}" candidates=${candidates.length} ` +
    `top_score=${top ? top.score : 0} auto_lock=${auto_lock ? auto_lock.catalog_id : "null"} ` +
    `strategies=[${top ? top.matched_strategies.join(",") : ""}]`,
  );

  return { input: raw, normalized, candidates, auto_lock, needs_disambiguation };
}
