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

// Return the original query plus semantically-expanded catalogue phrasings.
export async function expandPartQuery(query: string): Promise<string[]> {
  const key = String(query || "").trim().toLowerCase();
  if (!key) return [];
  if (memCache.has(key)) return memCache.get(key)!;

  const persisted = readPersistent(key);
  if (persisted) { memCache.set(key, persisted); return persisted; }

  try {
    const result = await callClaudeHaiku(SYSTEM, [{ role: "user", content: query }], 300);
    if (!result.ok) throw new Error(result.error || "claude unavailable");
    const cleaned = result.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const arr = JSON.parse(cleaned);
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
