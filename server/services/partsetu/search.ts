// PartSetu AI R27.24a — multi-strategy parallel part search.
// Replaces the single LIKE/keyword path with five strategies run in parallel
// (FTS5 description, FTS5 catalog metadata, exact part-number, bidirectional
// cross-reference walk, spec filter), merged and scored. Every result carries
// its source catalog_id + label so the chat layer can enforce citations.
//
// All rows come from partsetu_parts joined to partsetu_catalogs (or the xref
// table for cross-reference) — never from the comparative/price sheets.
import { rawSqlite as db } from "../../storage";
import type { Intent, PartListEntry } from "./intent";

export interface SearchHit {
  id: number;
  part_number: string;
  description: string;
  catalog_id: number;
  catalog_label: string;
  score: number;
  strategies_matched: string[];
}

export interface PerPartResult {
  rawName: string;
  parts: SearchHit[];
  strategiesMatched: string[];
  tier: string;
}

export interface SearchResult {
  hits: SearchHit[];
  strategies: string[];
  perPart?: PerPartResult[];
}

export interface SearchCtx {
  lockedCatalogId?: number | null;
}

// ---- FTS5 availability (memoized) -----------------------------------------
let _fts5: boolean | null = null;
export function fts5Available(): boolean {
  if (_fts5 !== null) return _fts5;
  try {
    const parts = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partsetu_parts_fts'`).get();
    const cats = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partsetu_catalogs_fts'`).get();
    _fts5 = !!parts && !!cats;
  } catch { _fts5 = false; }
  return _fts5;
}

// ---- helpers ---------------------------------------------------------------
const labelCache = new Map<number, string>();
function catalogLabel(catalogId: number): string {
  if (labelCache.has(catalogId)) return labelCache.get(catalogId)!;
  let label = `catalog #${catalogId}`;
  try {
    const c = db.prepare(`SELECT id, oem, model, variant FROM partsetu_catalogs WHERE id = ?`).get(catalogId) as any;
    if (c) {
      const name = [c.model, c.variant].filter(Boolean).join(" ").trim() || c.oem || "";
      label = name ? `catalog #${catalogId} — ${name}` : `catalog #${catalogId}`;
    }
  } catch { /* fall through to default */ }
  labelCache.set(catalogId, label);
  return label;
}

// Sanitize tokens for an FTS5 MATCH expression: keep [A-Za-z0-9], lowercase,
// append a prefix wildcard to each. Returns "" when nothing usable remains.
function buildMatchExpr(tokens: string[]): string {
  const clean = Array.from(new Set(
    tokens
      .map((t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim())
      .flatMap((t) => t.split(/\s+/))
      .filter((t) => t.length >= 2),
  ));
  return clean.map((t) => `${t}*`).join(" OR ");
}

function normPN(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---- strategy 1: FTS5 description match ------------------------------------
function ftsDescription(intent: Intent, restrictCatalog: number | null): SearchHit[] {
  const expr = buildMatchExpr(intent.partTokens);
  if (!expr) return [];
  try {
    const scopeSql = restrictCatalog ? ` AND p.catalog_id = ${Number(restrictCatalog)}` : "";
    const rows = db.prepare(
      `SELECT p.id, p.part_number, p.description, p.catalog_id, bm25(partsetu_parts_fts) AS rank
       FROM partsetu_parts_fts
       JOIN partsetu_parts p ON p.id = partsetu_parts_fts.rowid
       WHERE partsetu_parts_fts MATCH ?${scopeSql}
       ORDER BY rank ASC
       LIMIT 50`,
    ).all(expr) as any[];
    // bm25 is negative-ish (lower is better). Normalize to 0..40 descending.
    return rows.map((r, i) => ({
      id: r.id,
      part_number: r.part_number || "",
      description: r.description || "",
      catalog_id: r.catalog_id,
      catalog_label: catalogLabel(r.catalog_id),
      score: Math.max(1, 40 - i),
      strategies_matched: ["fts_desc"],
    }));
  } catch (e: any) {
    console.warn(`[partsetu] fts_desc error: ${e?.message || e}`);
    return [];
  }
}

// ---- strategy 2: FTS5 catalog metadata (model/variant) ---------------------
function ftsCatalog(intent: Intent, restrictCatalog: number | null): SearchHit[] {
  const expr = buildMatchExpr(intent.partTokens);
  if (!expr) return [];
  try {
    const catRows = db.prepare(
      `SELECT rowid AS catalog_id, bm25(partsetu_catalogs_fts) AS rank
       FROM partsetu_catalogs_fts WHERE partsetu_catalogs_fts MATCH ?
       ORDER BY rank ASC LIMIT 20`,
    ).all(expr) as any[];
    const out: SearchHit[] = [];
    const partExpr = buildMatchExpr(intent.partTokens);
    for (const c of catRows) {
      if (restrictCatalog && c.catalog_id !== restrictCatalog) continue;
      // expand to top parts in this catalog by keyword overlap with the tokens
      let parts: any[] = [];
      try {
        if (partExpr) {
          parts = db.prepare(
            `SELECT p.id, p.part_number, p.description, p.catalog_id
             FROM partsetu_parts_fts
             JOIN partsetu_parts p ON p.id = partsetu_parts_fts.rowid
             WHERE partsetu_parts_fts MATCH ? AND p.catalog_id = ?
             ORDER BY bm25(partsetu_parts_fts) ASC LIMIT 20`,
          ).all(partExpr, c.catalog_id) as any[];
        }
      } catch { parts = []; }
      if (!parts.length) {
        parts = db.prepare(
          `SELECT id, part_number, description, catalog_id FROM partsetu_parts WHERE catalog_id = ? LIMIT 20`,
        ).all(c.catalog_id) as any[];
      }
      for (const p of parts) {
        out.push({
          id: p.id,
          part_number: p.part_number || "",
          description: p.description || "",
          catalog_id: p.catalog_id,
          catalog_label: catalogLabel(p.catalog_id),
          score: 25,
          strategies_matched: ["fts_cat"],
        });
      }
    }
    return out;
  } catch (e: any) {
    console.warn(`[partsetu] fts_cat error: ${e?.message || e}`);
    return [];
  }
}

// ---- strategy 3: exact part-number match -----------------------------------
function exactPartNumber(intent: Intent, restrictCatalog: number | null): SearchHit[] {
  if (!intent.partNumbers.length) return [];
  const out: SearchHit[] = [];
  const scopeSql = restrictCatalog ? ` AND catalog_id = ${Number(restrictCatalog)}` : "";
  const stmt = db.prepare(
    `SELECT id, part_number, description, catalog_id FROM partsetu_parts
     WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') = ?${scopeSql} LIMIT 20`,
  );
  for (const pn of intent.partNumbers) {
    const norm = normPN(pn);
    if (norm.length < 4) continue;
    const rows = stmt.all(norm) as any[];
    for (const r of rows) {
      out.push({
        id: r.id,
        part_number: r.part_number || "",
        description: r.description || "",
        catalog_id: r.catalog_id,
        catalog_label: catalogLabel(r.catalog_id),
        score: 100,
        strategies_matched: ["exact"],
      });
    }
  }
  return out;
}

// ---- strategy 4: bidirectional cross-reference walk ------------------------
// BFS over partsetu_xref (source_part_no <-> customer_part_no), depth <= 3,
// stop at 200 nodes. Returns resolved part numbers with their hop depth.
export function resolveXref(
  partNumber: string,
  maxDepth = 3,
): Array<{ partNumber: string; depth: number; viaCatalogId?: number }> {
  const seed = normPN(partNumber);
  if (seed.length < 4) return [];
  const visited = new Map<string, number>([[seed, 0]]);
  const queue: Array<{ pn: string; depth: number }> = [{ pn: seed, depth: 0 }];
  const stmt = db.prepare(
    `SELECT source_part_no, customer_part_no FROM partsetu_xref
     WHERE REPLACE(REPLACE(UPPER(source_part_no),'-',''),' ','') = ?
        OR REPLACE(REPLACE(UPPER(customer_part_no),'-',''),' ','') = ?`,
  );
  while (queue.length && visited.size < 200) {
    const node = queue.shift()!;
    if (node.depth >= maxDepth) continue;
    let rows: any[] = [];
    try { rows = stmt.all(node.pn, node.pn) as any[]; } catch { rows = []; }
    for (const r of rows) {
      for (const cand of [normPN(r.source_part_no), normPN(r.customer_part_no)]) {
        if (cand.length >= 4 && !visited.has(cand)) {
          visited.set(cand, node.depth + 1);
          queue.push({ pn: cand, depth: node.depth + 1 });
          if (visited.size >= 200) break;
        }
      }
    }
  }
  const out: Array<{ partNumber: string; depth: number }> = [];
  for (const [pn, depth] of Array.from(visited.entries())) {
    if (pn === seed) continue;
    out.push({ partNumber: pn, depth });
  }
  return out;
}

function xrefWalk(intent: Intent): SearchHit[] {
  if (!intent.partNumbers.length) return [];
  const out: SearchHit[] = [];
  const lookup = db.prepare(
    `SELECT id, part_number, description, catalog_id FROM partsetu_parts
     WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') = ? LIMIT 5`,
  );
  for (const seed of intent.partNumbers) {
    const resolved = resolveXref(seed, 3);
    for (const r of resolved) {
      const rows = lookup.all(r.partNumber) as any[];
      for (const p of rows) {
        out.push({
          id: p.id,
          part_number: p.part_number || "",
          description: p.description || "",
          catalog_id: p.catalog_id,
          catalog_label: catalogLabel(p.catalog_id),
          score: Math.max(10, 50 - r.depth * 10),
          strategies_matched: ["xref"],
        });
      }
    }
  }
  return out;
}

// ---- strategy 5: spec filter -----------------------------------------------
function specFilter(intent: Intent, base: SearchHit[]): SearchHit[] {
  const specs = intent.specs || {};
  if (!Object.keys(specs).length || !base.length) return [];
  const out: SearchHit[] = [];
  for (const hit of base) {
    const desc = (hit.description || "").toLowerCase();
    let matched = false;
    if (specs.dia_mm) {
      const m = desc.match(/dia[\.\s]*(\d{2,4})|(\d{2,4})\s*mm/);
      if (m && Number(m[1] || m[2]) === specs.dia_mm) matched = true;
    }
    if (specs.teeth) {
      const m = desc.match(/(\d{1,3})\s*t(?!\w)/);
      if (m && Number(m[1]) === specs.teeth) matched = true;
    }
    if (specs.voltage) {
      const m = desc.match(/(\d{1,3})\s*v(?!\w)/);
      if (m && Number(m[1]) === specs.voltage) matched = true;
    }
    if (specs.bore && desc.includes(String(specs.bore).toLowerCase())) matched = true;
    if (matched) out.push({ ...hit, score: hit.score + 30, strategies_matched: [...hit.strategies_matched, "spec"] });
  }
  return out;
}

// ---- LIKE fallback when FTS5 is unavailable --------------------------------
function likeFallback(intent: Intent, restrictCatalog: number | null): SearchHit[] {
  const toks = Array.from(new Set(intent.partTokens.map((t) => t.toUpperCase().trim()).filter((t) => t.length >= 2)));
  if (!toks.length) return [];
  const scoreExpr = toks.map(() => `(CASE WHEN UPPER(description) LIKE ? THEN 1 ELSE 0 END)`).join(" + ");
  const whereExpr = toks.map(() => `UPPER(description) LIKE ?`).join(" OR ");
  const scopeSql = restrictCatalog ? ` AND catalog_id = ${Number(restrictCatalog)}` : "";
  const params = toks.map((t) => `%${t}%`);
  try {
    const rows = db.prepare(
      `SELECT id, part_number, description, catalog_id, (${scoreExpr}) AS hits
       FROM partsetu_parts WHERE (${whereExpr})${scopeSql}
       ORDER BY hits DESC, LENGTH(description) ASC LIMIT 50`,
    ).all(...params, ...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      part_number: r.part_number || "",
      description: r.description || "",
      catalog_id: r.catalog_id,
      catalog_label: catalogLabel(r.catalog_id),
      score: Math.min(40, Number(r.hits) * 8),
      strategies_matched: ["like_fallback"],
    }));
  } catch (e: any) {
    console.warn(`[partsetu] like_fallback error: ${e?.message || e}`);
    return [];
  }
}

// ---- R27.24a5 per-part search (5-tier fallback) ----------------------------
// Common words that don't discriminate between parts — dropped when picking a
// single most-distinctive token (tier 3).
const COMMON_PART_WORDS = new Set([
  "filter", "assembly", "assy", "kit", "set", "part", "parts", "oil", "air",
  "element", "cartridge", "spare", "spares", "no", "number", "oem",
]);

// Clean a phrase into FTS5-safe quoted phrase ("" if empty after cleaning).
function ftsPhrase(phrase: string): string {
  const toks = phrase.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  return toks.length ? `"${toks.join(" ")}"` : "";
}

function rowsToHits(rows: any[], strategy: string, baseScore: number): SearchHit[] {
  return rows.map((r, i) => ({
    id: r.id,
    part_number: r.part_number || "",
    description: r.description || "",
    catalog_id: r.catalog_id,
    catalog_label: catalogLabel(r.catalog_id),
    score: Math.max(1, baseScore - i),
    strategies_matched: [strategy],
  }));
}

// Run the 5-tier fallback for one part name. `restrict` scopes to the locked
// catalog (multi_part_list never bypasses the lock). Stops at the first tier
// that yields hits and logs which tier matched.
function searchSinglePart(entry: PartListEntry, restrict: number | null): PerPartResult {
  const scopeSql = restrict ? ` AND p.catalog_id = ${Number(restrict)}` : "";
  const scopeSqlPlain = restrict ? ` AND catalog_id = ${Number(restrict)}` : "";
  const rawTokens = Array.from(new Set(entry.tokens.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2)));
  const synonyms = entry.expandedTokens;
  const hasFts = fts5Available();

  const runFts = (expr: string, strategy: string, baseScore: number): SearchHit[] => {
    if (!expr) return [];
    try {
      const rows = db.prepare(
        `SELECT p.id, p.part_number, p.description, p.catalog_id, bm25(partsetu_parts_fts) AS rank
         FROM partsetu_parts_fts JOIN partsetu_parts p ON p.id = partsetu_parts_fts.rowid
         WHERE partsetu_parts_fts MATCH ?${scopeSql} ORDER BY rank ASC LIMIT 10`,
      ).all(expr) as any[];
      return rowsToHits(rows, strategy, baseScore);
    } catch (e: any) {
      console.warn(`[partsetu] subsearch fts (${strategy}) error: ${e?.message || e}`);
      return [];
    }
  };

  let hits: SearchHit[] = [];
  let tier = "0_none";

  // Tier 1 — FTS phrase match over all synonym phrases (OR-joined).
  if (hasFts) {
    const expr = Array.from(new Set(synonyms.map(ftsPhrase).filter(Boolean))).join(" OR ");
    hits = runFts(expr, "fts_phrase", 45);
    if (hits.length) tier = "1_fts";
  }

  // Tier 2 — prefix wildcards from the raw tokens (AND of prefixes).
  if (!hits.length && hasFts && rawTokens.length) {
    const expr = rawTokens.map((t) => `${t}*`).join(" ");
    hits = runFts(expr, "fts_prefix", 40);
    if (hits.length) tier = "2_prefix";
  }

  // Tier 3 — single most-distinctive token (drop common words), prefix match.
  if (!hits.length && hasFts && rawTokens.length) {
    const distinctive = rawTokens
      .filter((t) => !COMMON_PART_WORDS.has(t))
      .sort((a, b) => b.length - a.length)[0] || rawTokens.sort((a, b) => b.length - a.length)[0];
    if (distinctive) {
      hits = runFts(`${distinctive}*`, "fts_token", 35);
      if (hits.length) tier = "3_token";
    }
  }

  // Tier 4 — LIKE fallback: AND of %token% within the catalog.
  if (!hits.length && rawTokens.length) {
    const whereExpr = rawTokens.map(() => `UPPER(description) LIKE ?`).join(" AND ");
    const params = rawTokens.map((t) => `%${t.toUpperCase()}%`);
    try {
      const rows = db.prepare(
        `SELECT id, part_number, description, catalog_id FROM partsetu_parts
         WHERE (${whereExpr})${scopeSqlPlain} ORDER BY LENGTH(description) ASC LIMIT 10`,
      ).all(...params) as any[];
      hits = rowsToHits(rows, "like", 30);
      if (hits.length) tier = "4_like";
    } catch (e: any) {
      console.warn(`[partsetu] subsearch like error: ${e?.message || e}`);
    }
  }

  // Tier 5 — JS token-overlap scoring over the whole catalog (cap 5000).
  if (!hits.length) {
    try {
      const synTokens = Array.from(new Set(
        synonyms.flatMap((s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)).filter((t) => t.length >= 2),
      ));
      if (synTokens.length) {
        const rows = db.prepare(
          `SELECT id, part_number, description, catalog_id FROM partsetu_parts
           WHERE 1=1${scopeSqlPlain} LIMIT 5000`,
        ).all() as any[];
        const scored: SearchHit[] = [];
        for (const r of rows) {
          const desc = String(r.description || "").toLowerCase();
          const present = synTokens.filter((t) => desc.includes(t)).length;
          const pct = present / synTokens.length;
          if (pct >= 0.3) {
            scored.push({
              id: r.id,
              part_number: r.part_number || "",
              description: r.description || "",
              catalog_id: r.catalog_id,
              catalog_label: catalogLabel(r.catalog_id),
              score: Math.round(pct * 30),
              strategies_matched: ["overlap"],
            });
          }
        }
        hits = scored.sort((a, b) => b.score - a.score).slice(0, 5);
        if (hits.length) tier = "5_overlap";
      }
    } catch (e: any) {
      console.warn(`[partsetu] subsearch overlap error: ${e?.message || e}`);
    }
  }

  const strategiesMatched = Array.from(new Set(hits.flatMap((h) => h.strategies_matched)));
  console.log(`[partsetu] subsearch part="${entry.rawName}" tokens=[${rawTokens.join(",")}] synonyms=${synonyms.length} tier=${tier} results=${hits.length}`);
  return { rawName: entry.rawName, parts: hits, strategiesMatched, tier };
}

export async function searchParts(intent: Intent, ctx: SearchCtx): Promise<SearchResult> {
  const locked = ctx.lockedCatalogId ?? null;

  // R27.24a5 — multi-part list: run each requested part through its own 5-tier
  // search in parallel. bypassLock is false, so each search is scoped to the
  // locked catalog. Returns the union of per-part hits (deduped) so the citation
  // guard permits every found part number, plus a structured per-part breakdown.
  if (intent.kind === "multi_part_list" && intent.partList?.length) {
    const restrict = intent.bypassLock ? null : locked;
    const perPart = await Promise.all(intent.partList.map((e) => Promise.resolve().then(() => searchSinglePart(e, restrict))));
    const merged = new Map<number, SearchHit>();
    for (const pp of perPart) {
      for (const h of pp.parts) {
        const existing = merged.get(h.id);
        if (existing) { if (h.score > existing.score) existing.score = h.score; }
        else merged.set(h.id, { ...h, strategies_matched: [...h.strategies_matched] });
      }
    }
    const found = perPart.filter((p) => p.parts.length).length;
    console.log(`[partsetu] multi_part_list parts_requested=${perPart.length} parts_found=${found} parts_missing=${perPart.length - found}`);
    const hits = Array.from(merged.values()).sort((a, b) => b.score - a.score);
    return { hits, strategies: ["multi_part_list"], perPart };
  }

  // strategies 1,2,3 honor the lock unless the intent explicitly bypasses it;
  // strategy 4 (xref) is NEVER restricted — it walks across catalogs.
  const restrict = intent.bypassLock ? null : locked;
  const hasFts = fts5Available();

  const tasks: Array<Promise<{ name: string; hits: SearchHit[] }>> = [];
  const wrap = (name: string, fn: () => SearchHit[]) =>
    tasks.push(Promise.resolve().then(() => ({ name, hits: fn() })).catch((e) => {
      console.warn(`[partsetu] strategy ${name} crashed: ${e?.message || e}`);
      return { name, hits: [] as SearchHit[] };
    }));

  if (hasFts) {
    wrap("fts_desc", () => ftsDescription(intent, restrict));
    wrap("fts_cat", () => ftsCatalog(intent, restrict));
  } else {
    wrap("like_fallback", () => likeFallback(intent, restrict));
  }
  wrap("exact", () => exactPartNumber(intent, restrict));
  if (intent.kind === "cross_reference_lookup" || intent.partNumbers.length > 0) {
    wrap("xref", () => xrefWalk(intent));
  }

  const settled = await Promise.allSettled(tasks);
  const merged = new Map<number, SearchHit>();
  const strategiesRun: string[] = [];
  let baseForSpec: SearchHit[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const { name, hits } = s.value;
    if (hits.length) strategiesRun.push(name);
    baseForSpec = baseForSpec.concat(hits);
    for (const h of hits) {
      const existing = merged.get(h.id);
      if (existing) {
        existing.score += h.score;
        for (const st of h.strategies_matched) {
          if (!existing.strategies_matched.includes(st)) existing.strategies_matched.push(st);
        }
      } else {
        merged.set(h.id, { ...h, strategies_matched: [...h.strategies_matched] });
      }
    }
  }

  // strategy 5: spec filter boosts matching rows from the merged base set.
  const specHits = specFilter(intent, Array.from(merged.values()));
  if (specHits.length) strategiesRun.push("spec");
  for (const h of specHits) {
    const existing = merged.get(h.id);
    if (existing) {
      existing.score += 30;
      if (!existing.strategies_matched.includes("spec")) existing.strategies_matched.push("spec");
    }
  }

  const hits = Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 20);
  console.log(`[partsetu] search intent=${intent.kind} strategies=[${strategiesRun.join(",")}] results=${hits.length} locked=${locked ?? "null"} bypass=${intent.bypassLock}`);
  return { hits, strategies: strategiesRun };
}
