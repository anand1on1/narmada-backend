// PartSetu AI v1.2 — LLM-driven part-keyword expander.
// Users ask for generic part names ("clutch plate") that never appear verbatim
// in OEM catalogues ("CLUTCH DISC ASSY", "PLATE,CLUTCH", "DRIVEN PLATE"). Before
// searching the DB we ask Haiku for the alternative phrases an OEM catalogue
// would actually use, then OR-match all of them against descriptions.
//
// Three-layer cache: in-memory Map → partsetu_query_expansions table → Claude.
// Fails open (returns tokenized query) so search never hard-depends on the LLM.
import { callClaudeHaiku } from "./claude";
import { rawSqlite as db } from "../storage";

const memCache = new Map<string, string[]>();

const SYSTEM = `You are an automotive spare-parts terminology expander for Indian commercial trucks (Tata, Ashok Leyland, Eicher, BharatBenz, etc.). Given a user's generic part name, return a JSON array of 5-12 alternative phrases that would appear in OEM spare-parts catalogue descriptions. Include the original term, common synonyms, OEM naming patterns (often comma-separated like "PLATE,CLUTCH" or suffixed like "DISC ASSY"), and abbreviations. Same-family parts only — do not drift to unrelated components. Return ONLY a valid JSON array of strings — no prose, no markdown.`;

// Tolerant JSON-array extractor: strips markdown fences and any prose around
// the array, then parses the first balanced [...] block. Returns null on
// failure so callers fall open to tokenization instead of throwing.
function parseJsonArray(raw: string): string[] | null {
  if (!raw) return null;
  const text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch { return null; }
      }
    }
  }
  return null;
}

function tokenizeFallback(query: string): string[] {
  const toks = query.split(/[\s,;/\-]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  const out = [query.trim(), ...toks];
  return Array.from(new Set(out.filter(Boolean)));
}

function readPersistent(key: string): string[] | null {
  try {
    const row = db.prepare(`SELECT expansions_json FROM partsetu_query_expansions WHERE query_text = ?`).get(key) as any;
    if (row?.expansions_json) {
      const arr = JSON.parse(row.expansions_json);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* table may not exist on older DBs — fail open */ }
  return null;
}

function writePersistent(key: string, terms: string[]): void {
  try {
    db.prepare(
      `INSERT OR IGNORE INTO partsetu_query_expansions (query_text, expansions_json, created_at) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(terms), Date.now());
  } catch { /* non-fatal */ }
}

// PartSetu v1.4 D3 — admin-taught synonyms override Claude expansion.
// catalog-scoped entry (matching catalogId) wins over a global (NULL) one. When
// a taught synonym exists we use it directly and skip the Claude call entirely
// (the in-memory cache still applies on the next identical query).
function readTaughtSynonym(key: string, catalogId?: number | null): string[] | null {
  try {
    const rows = db.prepare(
      `SELECT expanded_terms_json, catalog_id FROM partsetu_synonyms WHERE LOWER(query_term) = ?`,
    ).all(key) as Array<{ expanded_terms_json: string; catalog_id: number | null }>;
    if (!rows.length) return null;
    // Prefer the catalog-scoped match if a catalogId was supplied.
    const scoped = catalogId != null ? rows.find((r) => r.catalog_id === catalogId) : undefined;
    const chosen = scoped || rows.find((r) => r.catalog_id == null) || rows[0];
    const arr = JSON.parse(chosen.expanded_terms_json);
    if (Array.isArray(arr) && arr.length) {
      return arr.filter((s: any) => typeof s === "string" && s.trim().length >= 1).map((s: string) => s.trim());
    }
  } catch { /* table may not exist on older DBs — fail open */ }
  return null;
}

// Return the original query plus semantically-expanded catalogue phrasings.
// catalogId (optional) lets catalog-scoped admin synonyms take precedence.
export async function expandPartQuery(query: string, catalogId?: number | null): Promise<string[]> {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return [];

  // Admin-taught synonyms take highest precedence (catalog-scoped first).
  const taught = readTaughtSynonym(key, catalogId);
  if (taught) {
    let terms = taught.slice();
    if (!terms.some((t) => t.toLowerCase() === key)) terms.unshift(query.trim());
    terms = Array.from(new Set(terms)).slice(0, 20);
    return terms;
  }

  if (memCache.has(key)) return memCache.get(key)!;

  const persisted = readPersistent(key);
  if (persisted) { memCache.set(key, persisted); return persisted; }

  try {
    const result = await callClaudeHaiku(SYSTEM, [{ role: "user", content: query }], 300);
    if (!result.ok) throw new Error(result.error || "claude unavailable");
    // R27.24a — robust JSON-array extraction. Haiku occasionally appends prose
    // after the array ("...] These are common phrasings."), which broke
    // JSON.parse with "Unexpected non-whitespace character after JSON". Strip
    // code fences, then slice from the first '[' to its matching ']'.
    const arr = parseJsonArray(result.text);
    if (!Array.isArray(arr)) throw new Error("not an array");
    let terms = arr.filter((s: any) => typeof s === "string" && s.trim().length >= 2).map((s: string) => s.trim());
    if (!terms.some((t) => t.toLowerCase() === key)) terms.unshift(query.trim());
    terms = Array.from(new Set(terms)).slice(0, 15);
    if (!terms.length) throw new Error("empty expansion");
    memCache.set(key, terms);
    writePersistent(key, terms);
    return terms;
  } catch (err) {
    console.warn("[partsetu] keyword expansion failed:", (err as Error).message);
    const fallback = tokenizeFallback(query);
    memCache.set(key, fallback);
    return fallback;
  }
}
