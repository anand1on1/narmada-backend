// PartSetu AI v1 — raw-sqlite storage + search helpers.
// Kept separate from storage-v2/storage-r27 so the chatbot feature is self-contained.
import { rawSqlite as db } from "./storage";
import { expandPartQuery } from "./services/keyword-expander";
import { lookupVahanByRegistration } from "./services/vahan";

export interface PartRow {
  id: number;
  catalog_id: number;
  group_code: string | null;
  table_code: string | null;
  assembly_name: string | null;
  fig_no: string | null;
  part_number: string | null;
  description: string | null;
  qty: number | null;
  remarks: string | null;
  is_kit_parent: number;
  parent_part_id: number | null;
  is_serviceable: number;
  page_no: number | null;
  diagram_path: string | null;
}

export interface XrefRow {
  id: number;
  source_brand: string | null;
  source_part_no: string | null;
  source_description: string | null;
  customer_oem: string | null;
  customer_part_no: string | null;
  status: string | null;
}

const now = () => Date.now();

// ---- Conversations & messages ---------------------------------------------

export function createConversation(opts: {
  customerId?: number | null;
  guestSessionId?: string | null;
  chassisNo?: string | null;
  registrationNo?: string | null;
}): number {
  const ts = now();
  const r = db.prepare(
    `INSERT INTO partsetu_conversations (customer_id, guest_session_id, chassis_no, registration_no, started_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(opts.customerId ?? null, opts.guestSessionId ?? null, opts.chassisNo ?? null, opts.registrationNo ?? null, ts, ts);
  return Number(r.lastInsertRowid);
}

export function getConversation(id: number): any {
  return db.prepare(`SELECT * FROM partsetu_conversations WHERE id = ?`).get(id);
}

// Attach a guest conversation to a customer after they log in (Pattern B).
export function linkConversationToCustomer(conversationId: number, customerId: number) {
  db.prepare(`UPDATE partsetu_conversations SET customer_id = ? WHERE id = ?`).run(customerId, conversationId);
}

// ---- Catalog context resolution (v1.2) ------------------------------------
// The chatbot must lock onto a single vehicle catalogue before searching parts,
// otherwise a generic query like "clutch plate" matches noise across every OEM.
// We resolve the catalogue from (a) the model name in the user's text, or
// (b) the chassis/VC number, then persist it on the conversation row.

export function getCatalog(id: number): any {
  if (!id) return null;
  return db.prepare(`SELECT * FROM partsetu_catalogs WHERE id = ?`).get(id);
}

// R27.24a10 bug 1 — given a free-text model query ("signa 2821 bs6"), return the
// REAL catalog rows whose model/variant contains the model number, optionally
// filtered by emission stage. The handler uses this to offer genuine variants
// (or honestly say the model is not in our DB) instead of letting Sonnet invent
// variant names from training data.
export function findCatalogsByModelName(query: string): Array<{
  id: number; model: string | null; variant: string | null;
  chassis_type: string | null; vc_no: string | null;
}> {
  const raw = String(query || "");
  const numM = raw.match(/\b(\d{3,4})\b/);
  const modelNum = numM ? numM[1] : null;
  if (!modelNum) return [];
  const emM = raw.match(/\bbs\s*-?\s*([3456])\b/i);
  const bs = emM ? emM[1] : null;
  let sql = `SELECT id, model, variant, chassis_type, vc_no FROM partsetu_catalogs WHERE (model LIKE ? OR variant LIKE ?)`;
  const params: any[] = [`%${modelNum}%`, `%${modelNum}%`];
  if (bs) {
    sql += ` AND REPLACE(REPLACE(UPPER(IFNULL(model,'')||IFNULL(variant,'')||IFNULL(emission_stage,'')),' ',''),'-','') LIKE ?`;
    params.push(`%BS${bs}%`);
  }
  sql += ` ORDER BY id ASC LIMIT 10`;
  try { return db.prepare(sql).all(...params) as any[]; } catch { return []; }
}

export function setCatalogContext(conversationId: number, catalogId: number): void {
  db.prepare(`UPDATE partsetu_conversations SET catalog_context_id = ? WHERE id = ?`).run(catalogId, conversationId);
}

export function setConversationChassis(conversationId: number, chassisNo: string): void {
  db.prepare(`UPDATE partsetu_conversations SET chassis_no = ? WHERE id = ?`).run(chassisNo, conversationId);
}

// ---- Pending disambiguation state (R27.24a8) ------------------------------
// When a message resolves to >=2 distinct vehicles we persist the candidate
// set + the customer's original query so the next short reply ("1"/"2") can
// lock the chosen vehicle and replay the query. Keyed by session_id (the
// conversation id rendered as text). TTL is 10 minutes by default.

export interface PendingDisambiguation {
  candidates: any[];
  original_query: string;
  created_at: number;
  expires_at: number;
}

export function savePendingDisambiguation(
  sessionId: string,
  candidates: any[],
  originalQuery: string,
  ttlMs = 600000,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO partsetu_pending_disambiguation (session_id, candidates_json, original_query, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       candidates_json = excluded.candidates_json,
       original_query = excluded.original_query,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
  ).run(sessionId, JSON.stringify(candidates ?? []), originalQuery ?? "", ts, ts + ttlMs);
}

export function getPendingDisambiguation(sessionId: string): PendingDisambiguation | null {
  const row = db.prepare(
    `SELECT candidates_json, original_query, created_at, expires_at
       FROM partsetu_pending_disambiguation WHERE session_id = ?`,
  ).get(sessionId) as any;
  if (!row) return null;
  let candidates: any[] = [];
  try { candidates = JSON.parse(row.candidates_json || "[]"); } catch { candidates = []; }
  return {
    candidates,
    original_query: row.original_query || "",
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
  };
}

export function clearPendingDisambiguation(sessionId: string): void {
  db.prepare(`DELETE FROM partsetu_pending_disambiguation WHERE session_id = ?`).run(sessionId);
}

// ---- Parts cart (R27.24a9 gap 3) ------------------------------------------
// Session-scoped running list of parts the customer has collected for the
// LOCKED catalog. Lets "aur clutch bhi chahiye" append without re-searching the
// prior parts. TTL 60 min (added_at). Purged when the vehicle re-locks to a
// different catalog (see archivePartsCart).

export interface CartItem { part_name: string; oem_number: string; added_at: number; }

export function addToCart(sessionId: string, catalogId: number | null, partName: string, oemNumber: string): void {
  if (!sessionId || !oemNumber) return;
  db.prepare(
    `INSERT INTO partsetu_parts_cart (session_id, catalog_id, part_name, oem_number, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, catalog_id, oem_number) DO UPDATE SET
       part_name = excluded.part_name, added_at = excluded.added_at`,
  ).run(sessionId, catalogId ?? null, String(partName || ""), String(oemNumber), now());
}

export function getCart(sessionId: string, catalogId: number | null, ttlMs = 3600000): CartItem[] {
  if (!sessionId) return [];
  const cutoff = now() - ttlMs;
  const rows = db.prepare(
    `SELECT part_name, oem_number, added_at FROM partsetu_parts_cart
     WHERE session_id = ? AND catalog_id IS ? AND added_at >= ?
     ORDER BY added_at ASC`,
  ).all(sessionId, catalogId ?? null, cutoff) as any[];
  return rows.map((r) => ({ part_name: r.part_name || "", oem_number: r.oem_number || "", added_at: Number(r.added_at) }));
}

// Purge the whole session's cart (used on re-lock). Returns rows removed.
export function archivePartsCart(sessionId: string): number {
  if (!sessionId) return 0;
  return db.prepare(`DELETE FROM partsetu_parts_cart WHERE session_id = ?`).run(sessionId).changes;
}

// ---- Pending PART-name disambiguation (R27.24a9 gap 4) --------------------
// Mirrors the a8 vehicle table for part choices. When "clutch" matches several
// distinct parts we persist the candidate parts + original query so the next
// short reply ("2" / "clutch cover") resolves to one. TTL 10 min.

export function savePendingPartDisambiguation(
  sessionId: string,
  candidates: any[],
  originalQuery: string,
  ttlMs = 600000,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO partsetu_pending_part_disambiguation (session_id, candidates_json, original_query, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       candidates_json = excluded.candidates_json,
       original_query = excluded.original_query,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
  ).run(sessionId, JSON.stringify(candidates ?? []), originalQuery ?? "", ts, ts + ttlMs);
}

export function getPendingPartDisambiguation(sessionId: string): PendingDisambiguation | null {
  const row = db.prepare(
    `SELECT candidates_json, original_query, created_at, expires_at
       FROM partsetu_pending_part_disambiguation WHERE session_id = ?`,
  ).get(sessionId) as any;
  if (!row) return null;
  let candidates: any[] = [];
  try { candidates = JSON.parse(row.candidates_json || "[]"); } catch { candidates = []; }
  return {
    candidates,
    original_query: row.original_query || "",
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
  };
}

export function clearPendingPartDisambiguation(sessionId: string): void {
  db.prepare(`DELETE FROM partsetu_pending_part_disambiguation WHERE session_id = ?`).run(sessionId);
}

// Pull a chassis / VC number out of free text, e.g. "chassis no 862011" or
// "VC: 51610568000R". Returns the captured token (uppercased) or null.
export function extractChassisNo(text: string): string | null {
  const m = String(text || "").match(/\b(?:chassis|vc)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9]{4,})/i);
  if (m) return m[1].toUpperCase();
  // Tata: 'MAT' + 6+ alphanumeric. Leyland: 'MB' + digits.
  const t = String(text || "").toUpperCase();
  const tata = t.match(/\bMAT[A-Z0-9]{6,}\b/);
  if (tata) return tata[0];
  const ley = t.match(/\bMB\d{6,}\b/);
  if (ley) return ley[0];
  return null;
}

// Resolve a catalogue from a model name mentioned in the user's text. We count
// how many query tokens appear in the catalogue's model/variant/oem strings and
// return the best match. A token is "strong" if it is a model code (contains a
// digit, e.g. "4232") — a single strong token is enough to lock a catalogue.
export function findCatalogByQuery(text: string): any {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const tokens = raw
    .toUpperCase()
    .split(/[\s,;/\-]+/)
    .map((t) => t.replace(/[^A-Z0-9.]/g, "").trim())
    .filter((t) => t.length >= 3 || /\d/.test(t));
  if (!tokens.length) return null;

  const catalogs = db.prepare(`SELECT * FROM partsetu_catalogs`).all() as any[];
  let best: any = null;
  let bestScore = 0;
  for (const c of catalogs) {
    const hay = `${c.model || ""} ${c.variant || ""} ${c.oem || ""}`.toUpperCase();
    let score = 0;
    let strong = false;
    for (const t of tokens) {
      if (hay.includes(t)) {
        score += 1;
        if (/\d/.test(t)) strong = true;
      }
    }
    // Accept on count>=2, or a single strong (model-code/numeric) token.
    const ok = score >= 2 || (score >= 1 && strong);
    if (ok && score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Resolve a catalogue from a chassis / VC number: exact vc_no first, then a
// LIKE substring across vc_no / model / variant. NOTE the chassis number a user
// gives (e.g. 862011) is usually NOT the catalogue's VC No (51610568000R), so
// most lookups fail — callers must fall back to asking the user for the model.
export function resolveCatalogFromChassis(chassisNo: string): any {
  const c = String(chassisNo || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length < 4) return null;

  // 1) Exact vc_no match.
  const exactVc = db.prepare(
    `SELECT * FROM partsetu_catalogs WHERE REPLACE(REPLACE(UPPER(vc_no),'-',''),' ','') = ?`,
  ).get(c);
  if (exactVc) return exactVc;

  // 2) Exact chassis_no match (admin-provided during catalog upload).
  const exactCh = db.prepare(
    `SELECT * FROM partsetu_catalogs WHERE REPLACE(REPLACE(UPPER(chassis_no),'-',''),' ','') = ?`,
  ).get(c);
  if (exactCh) return exactCh;

  // 3) Substring match: the user's chassis often CONTAINS the catalog's
  // chassis_no as a suffix/middle (e.g. "MAT862011..." contains "862011"),
  // OR the catalog's chassis_no contains the user's input.
  const userInLike = `%${c}%`;
  const subUserContainsCat = db.prepare(
    `SELECT * FROM partsetu_catalogs
     WHERE chassis_no IS NOT NULL
       AND LENGTH(REPLACE(REPLACE(UPPER(chassis_no),'-',''),' ','')) >= 4
       AND ? LIKE '%' || REPLACE(REPLACE(UPPER(chassis_no),'-',''),' ','') || '%'
     LIMIT 1`,
  ).get(c);
  if (subUserContainsCat) return subUserContainsCat;

  const subCatContainsUser = db.prepare(
    `SELECT * FROM partsetu_catalogs
     WHERE REPLACE(REPLACE(UPPER(chassis_no),'-',''),' ','') LIKE ?
     LIMIT 1`,
  ).get(userInLike);
  if (subCatContainsUser) return subCatContainsUser;

  // 4) Last resort: LIKE across vc_no / model / variant (current behavior).
  return db.prepare(
    `SELECT * FROM partsetu_catalogs
     WHERE REPLACE(REPLACE(UPPER(vc_no),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(model),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(variant),'-',''),' ','') LIKE ?
     LIMIT 1`,
  ).get(userInLike, userInLike, userInLike) || null;
}

// ---- R27.23: chat-side resolver hierarchy ---------------------------------
// The customer chat path must identify the vehicle through a strict ordered
// hierarchy — chassis (strongest) → registration (VAHAN, deferred) → model
// fuzzy match (weakest). VC-number matching from free text is REMOVED here:
// VC numbers are an internal catalogue key, not something a customer types, and
// matching on them produced false locks. (Admin endpoints may still use
// resolveCatalogFromChassis / vc_no — this is the chat-only resolver.)

export interface CatalogCandidate {
  catalog_id: number;
  model: string | null;
  variant: string | null;
  vc_no: string | null;
  score: number;
}
export type ResolveResult =
  | { kind: "exact"; catalog_id: number }
  | { kind: "suggest"; candidates: CatalogCandidate[] }
  | { kind: "none" };

// Step 1 helper — pull chassis/VIN-like tokens (15-17 alphanumerics) out of the
// text. Recognises Indian OEM prefixes plus any 17-char VIN.
export function extractChassisTokens(text: string): string[] {
  const up = String(text || "").toUpperCase();
  const out = new Set<string>();
  // OEM-prefixed chassis numbers (15-17 alphanumerics).
  const prefixed = up.match(/\b(?:MAT|MB1|MB7|MA1|MEC)[A-Z0-9]{12,14}\b/g) || [];
  for (const t of prefixed) out.add(t);
  // Any 17-char VIN (excludes I, O, Q per ISO 3779).
  const vins = up.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [];
  for (const t of vins) out.add(t);
  return Array.from(out);
}

// Step 2 helper — pull an Indian registration number out of the text.
export function extractRegistrationNo(text: string): string | null {
  const m = String(text || "").toUpperCase().match(/\b[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{1,4}\b/);
  return m ? m[0].replace(/\s+/g, "") : null;
}

// Step 3 helper — pull a model-spec phrase out of the text (model code + optional
// emission / drive / suffix). Returns a normalised query string or null.
const MODEL_CODE_RE = /\b(LPK|LPS|LPT|SIGNA|PRIMA|ULTRA|INTRA|XENON|MAGIC|ACE|YODHA)\s*\d+(?:\.\d+)?(?:\.[A-Z]+)?/i;
const EMISSION_TOKEN_RE = /\b(BS6-PH2|BS6-PH1|BS6|BS4|CNG|LNG|EV)\b/i;
const DRIVE_TOKEN_RE = /\b\d+x\d+\b/i;
const SUFFIX_TOKEN_RE = /\.(K|S|TK|HD)\b/i;

export function extractModelQuery(text: string): string | null {
  const raw = String(text || "");
  const code = raw.match(MODEL_CODE_RE);
  if (!code) return null;
  const parts: string[] = [code[0]];
  const emission = raw.match(EMISSION_TOKEN_RE);
  if (emission) parts.push(emission[1]);
  const drive = raw.match(DRIVE_TOKEN_RE);
  if (drive) parts.push(drive[0]);
  const suffix = raw.match(SUFFIX_TOKEN_RE);
  if (suffix && !code[0].toUpperCase().includes(`.${suffix[1].toUpperCase()}`)) parts.push(`.${suffix[1]}`);
  return parts.join(" ").replace(/\s+/g, " ").trim().toUpperCase();
}

function tokenizeModel(s: string): string[] {
  return String(s || "")
    .toUpperCase()
    .split(/[\s,;/]+/)
    .map((t) => t.replace(/[^A-Z0-9.]/g, "").trim())
    .filter((t) => t.length >= 2 || /\d/.test(t));
}

// Score a model query against a catalog row: token-overlap (Jaccard-ish) plus
// small bonuses when emission/drive tokens from the query appear in the catalog.
function scoreModelMatch(queryTokens: string[], catalog: any): number {
  const hay = `${catalog.model || ""} ${catalog.variant || ""} ${catalog.emission_stage || ""} ${catalog.drive_type || ""}`.toUpperCase();
  if (!queryTokens.length) return 0;
  let hits = 0;
  for (const t of queryTokens) if (hay.includes(t)) hits += 1;
  let score = hits / queryTokens.length;
  // Emission / drive confirmation bonuses (capped at 1.0).
  const em = queryTokens.find((t) => /^BS|CNG|LNG|EV/.test(t));
  if (em && (catalog.emission_stage || "").toUpperCase().replace(/\s+/g, "").includes(em)) score += 0.1;
  const dr = queryTokens.find((t) => /^\d+X\d+$/.test(t));
  if (dr && (catalog.drive_type || "").toUpperCase().replace(/\s+/g, "").includes(dr)) score += 0.1;
  return Math.min(score, 1);
}

// The chat-side resolver. Identifies the vehicle through the ordered hierarchy
// and returns a discriminated union. `extra` lets the caller inject chassis/reg
// values already extracted elsewhere (e.g. from an RC-book image).
export async function resolveCatalog(
  text: string,
  extra?: { chassisNo?: string | null; registrationNo?: string | null },
): Promise<ResolveResult> {
  // Step 1 — chassis.
  const chassisTokens = extractChassisTokens(text);
  if (extra?.chassisNo) {
    const c = String(extra.chassisNo).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length >= 6 && !chassisTokens.includes(c)) chassisTokens.unshift(c);
  }
  for (const tok of chassisTokens) {
    const row = db.prepare(
      `SELECT * FROM partsetu_catalogs
       WHERE chassis_no = ? OR chassis_no LIKE ? || '%'
       LIMIT 1`,
    ).get(tok, tok) as any;
    if (row) {
      console.log(`[partsetu] resolve_chassis=${tok} → catalog_id=${row.id}`);
      return { kind: "exact", catalog_id: row.id };
    }
    console.log(`[partsetu] resolve_chassis=${tok} → NO_MATCH`);
  }

  // Step 2 — registration (VAHAN, deferred stub).
  const regNo = extra?.registrationNo
    ? String(extra.registrationNo).toUpperCase().replace(/[^A-Z0-9]/g, "")
    : extractRegistrationNo(text);
  if (regNo) {
    const vahan = await lookupVahanByRegistration(regNo);
    if (vahan) {
      // VAHAN resolved → try to lock the catalogue by its returned chassis or model.
      if (vahan.chassis_no) {
        const c = String(vahan.chassis_no).toUpperCase().replace(/[^A-Z0-9]/g, "");
        const row = db.prepare(
          `SELECT * FROM partsetu_catalogs WHERE chassis_no = ? OR chassis_no LIKE ? || '%' LIMIT 1`,
        ).get(c, c) as any;
        if (row) {
          console.log(`[partsetu] resolve_registration=${regNo} → vahan chassis=${c} → catalog_id=${row.id}`);
          return { kind: "exact", catalog_id: row.id };
        }
      }
      if (vahan.model) {
        const modelResult = resolveByModel(`${vahan.model} ${vahan.variant || ""}`.trim());
        if (modelResult) return modelResult;
      }
    }
    // Stub returns null today; vahan.ts already logs the DEFERRED line.
  }

  // Step 3 + 4 — model fuzzy match.
  const modelQuery = extractModelQuery(text);
  if (modelQuery) {
    const result = resolveByModel(modelQuery);
    if (result) return result;
  }

  return { kind: "none" };
}

// Shared model-resolution used by Step 3 (and by the VAHAN model fallback).
// Scores all catalogs by token overlap and applies the Step-4 ambiguity rule.
function resolveByModel(modelQuery: string): ResolveResult | null {
  const q = String(modelQuery || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  const tokens = tokenizeModel(q);
  if (!tokens.length) return null;

  // Pre-filter with a LIKE on the first (model-code) token to keep scoring cheap.
  const codeTok = tokens[0];
  const rows = db.prepare(
    `SELECT * FROM partsetu_catalogs WHERE LOWER(model) LIKE LOWER('%' || ? || '%')`,
  ).all(codeTok) as any[];
  const pool = rows.length ? rows : (db.prepare(`SELECT * FROM partsetu_catalogs`).all() as any[]);

  const scored = pool
    .map((c) => ({ c, score: scoreModelMatch(tokens, c) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    console.log(`[partsetu] resolve_model="${q}" candidates=0 top=NO_MATCH`);
    return null;
  }

  const top = scored[0];
  console.log(`[partsetu] resolve_model="${q}" candidates=${scored.length} top=catalog_id=${top.c.id} score=${top.score.toFixed(3)}`);

  // Step 4 — ambiguity: multiple near-equal scores OR a weak top score → suggest.
  const runnerUp = scored[1];
  const ambiguous = runnerUp != null && top.score - runnerUp.score < 0.1;
  if (top.score < 0.65 || ambiguous) {
    const candidates: CatalogCandidate[] = scored.slice(0, 5).map((x) => ({
      catalog_id: x.c.id,
      model: x.c.model ?? null,
      variant: x.c.variant ?? null,
      vc_no: x.c.vc_no ?? null,
      score: Number(x.score.toFixed(3)),
    }));
    return { kind: "suggest", candidates };
  }
  return { kind: "exact", catalog_id: top.c.id };
}

// Ensure a conversation is locked to a catalogue before we search. Order:
// (1) keep an already-locked context; (2) try model-name match in the text;
// (3) extract+persist a chassis number and try chassis resolution. Returns the
// resolved catalog_context_id (or null when nothing matched).
export function ensureCatalogContext(conversationId: number, latestText: string): number | null {
  const conv = getConversation(conversationId);
  if (!conv) return null;
  if (conv.catalog_context_id) return conv.catalog_context_id;

  const byModel = findCatalogByQuery(latestText);
  if (byModel) { setCatalogContext(conversationId, byModel.id); return byModel.id; }

  let chassis: string | null = conv.chassis_no || null;
  const fromText = extractChassisNo(latestText);
  if (fromText && fromText !== chassis) { setConversationChassis(conversationId, fromText); chassis = fromText; }
  if (chassis) {
    const byChassis = resolveCatalogFromChassis(chassis);
    if (byChassis) { setCatalogContext(conversationId, byChassis.id); return byChassis.id; }
  }
  return null;
}

export function addMessage(opts: {
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
  aiModel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}): number {
  const ts = now();
  const r = db.prepare(
    `INSERT INTO partsetu_messages (conversation_id, role, content, image_url, ai_model, input_tokens, output_tokens, cost_usd, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.conversationId, opts.role, opts.content, opts.imageUrl ?? null, opts.aiModel ?? null,
    opts.inputTokens ?? 0, opts.outputTokens ?? 0, opts.costUsd ?? 0, opts.latencyMs ?? 0, ts,
  );
  db.prepare(`UPDATE partsetu_conversations SET last_message_at = ? WHERE id = ?`).run(ts, opts.conversationId);
  return Number(r.lastInsertRowid);
}

export function listMessages(conversationId: number): any[] {
  return db.prepare(`SELECT * FROM partsetu_messages WHERE conversation_id = ? ORDER BY id ASC`).all(conversationId);
}

// Count of user-role messages — used by the auth gate (free first message).
export function countUserMessages(conversationId: number): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM partsetu_messages WHERE conversation_id = ? AND role = 'user'`).get(conversationId) as any;
  return Number(r?.n || 0);
}

// ---- Search (injected into the Claude prompt) -----------------------------

function normalizePN(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Find catalog parts relevant to a free-text query. v1.2 strategy: instead of
// AND-ing the user's literal tokens (which misses "clutch plate" when the OEM
// calls it "CLUTCH DISC ASSY"), we ask the LLM for catalogue phrasings of the
// generic term and OR-match all of them, scoring rows by how many variant terms
// they hit. Exact/partial part-number match still wins first. When `catalogId`
// is set the search is scoped to that vehicle's catalogue.
export async function searchParts(query: string, limit = 5, catalogId?: number | null): Promise<PartRow[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const out: PartRow[] = [];
  const seen = new Set<number>();
  const scope = catalogId ? ` AND catalog_id = ${Number(catalogId)}` : "";
  const push = (rows: any[]) => {
    for (const r of rows) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
      if (out.length >= limit) break;
    }
  };

  // 1) Part-number match (ignoring punctuation/case).
  const pnNorm = normalizePN(q);
  if (pnNorm.length >= 4) {
    push(db.prepare(
      `SELECT * FROM partsetu_parts
       WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') = ?${scope}
       LIMIT ?`,
    ).all(pnNorm, limit));
    if (out.length < limit) {
      push(db.prepare(
        `SELECT * FROM partsetu_parts
         WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') LIKE ?${scope}
         LIMIT ?`,
      ).all(`%${pnNorm}%`, limit));
    }
  }

  // 2) Semantic description match via LLM-expanded catalogue phrasings.
  if (out.length < limit) {
    const terms = await expandPartQuery(q, catalogId ?? null);
    const likeTerms = Array.from(new Set(
      terms.map((t) => t.toUpperCase().trim()).filter((t) => t.length >= 2),
    ));
    if (likeTerms.length) {
      // match_score = number of expansion terms whose text appears in the
      // description; rank by score, then prefer the shortest (most specific)
      // description so "CLUTCH DISC ASSY" beats "...DISC...BRACKET...".
      const scoreExpr = likeTerms
        .map(() => `(CASE WHEN UPPER(description) LIKE ? THEN 1 ELSE 0 END)`)
        .join(" + ");
      const whereExpr = likeTerms.map(() => `UPPER(description) LIKE ?`).join(" OR ");
      const scoreParams = likeTerms.map((t) => `%${t}%`);
      const whereParams = likeTerms.map((t) => `%${t}%`);
      const rows = db.prepare(
        `SELECT *, (${scoreExpr}) AS match_score
         FROM partsetu_parts
         WHERE (${whereExpr})${scope}
         ORDER BY match_score DESC, LENGTH(description) ASC
         LIMIT 20`,
      ).all(...scoreParams, ...whereParams);
      push(rows);
    }
  }

  return out.slice(0, limit);
}

// Cross-reference lookup by either a source or a customer part number.
// R27.20 — previously the entire user query (e.g. "264742300101 ka wabco number
// kya hai") was normalized into one giant token and never matched. Now we
// extract part-number-like tokens (≥6 alphanumeric chars) from the query and
// look up each one. The whole-query normalize is kept as a final fallback.
export function searchXref(query: string, limit = 5): XrefRow[] {
  const raw = String(query || "");
  // Pull out part-number candidates: runs of alphanumerics ≥6 chars long.
  // Tata/Leyland part numbers are typically 9-13 digits; Wabco is 9 digits.
  const candidates = Array.from(
    new Set(
      (raw.toUpperCase().match(/[A-Z0-9][A-Z0-9\-]{5,}/g) || [])
        .map((t) => t.replace(/[^A-Z0-9]/g, ""))
        .filter((t) => t.length >= 6 && /\d/.test(t)),
    ),
  );
  // Also include the fully-normalized whole-query (legacy behavior) as a
  // last-resort match for short part numbers users may type bare.
  const fullNorm = normalizePN(raw);
  if (fullNorm.length >= 4 && fullNorm.length <= 20 && !candidates.includes(fullNorm)) {
    candidates.push(fullNorm);
  }
  if (!candidates.length) return [];

  const out: XrefRow[] = [];
  const seenIds = new Set<number>();
  const stmt = db.prepare(
    `SELECT * FROM partsetu_xref
     WHERE REPLACE(REPLACE(UPPER(source_part_no),'-',''),' ','') = ?
        OR REPLACE(REPLACE(UPPER(customer_part_no),'-',''),' ','') = ?
        OR REPLACE(REPLACE(UPPER(source_part_no),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(customer_part_no),'-',''),' ','') LIKE ?
     LIMIT ?`,
  );
  for (const cand of candidates) {
    const rows = stmt.all(cand, cand, `%${cand}%`, `%${cand}%`, limit) as XrefRow[];
    for (const r of rows) {
      const id = (r as any).id as number;
      if (id !== undefined && !seenIds.has(id)) {
        seenIds.add(id);
        out.push(r);
        if (out.length >= limit) return out;
      }
    }
  }
  if (out.length) {
    console.log(`[partsetu] xref_hits=${out.length} from candidates=[${candidates.join(",")}]`);
  }
  return out;
}

// ---- v1.4 D3: teaching integration (rules / answers) ----------------------

// Load active teaching rules that apply to the current context, highest priority
// first. Matches scope='global' OR oem=current OR catalog_id=current OR
// category=current. Returns rule_text strings ready to inject into the prompt.
export function getActiveRules(opts: { catalogId?: number | null; oem?: string | null; category?: string | null }): string[] {
  try {
    const rows = db.prepare(
      `SELECT rule_text, priority FROM partsetu_rules
       WHERE active = 1 AND (
         scope = 'global'
         OR (oem IS NOT NULL AND ? IS NOT NULL AND LOWER(oem) = LOWER(?))
         OR (catalog_id IS NOT NULL AND catalog_id = ?)
         OR (category IS NOT NULL AND ? IS NOT NULL AND LOWER(category) = LOWER(?))
       )
       ORDER BY priority DESC, id ASC`,
    ).all(opts.oem ?? null, opts.oem ?? null, opts.catalogId ?? null, opts.category ?? null, opts.category ?? null) as Array<{ rule_text: string }>;
    return rows.map((r) => r.rule_text);
  } catch { return []; }
}

// D3 Answers — before full RAG, check partsetu_answers for a query_pattern that
// appears in the user's message AND matches the locked catalog (or is global).
// Returns the taught answer when matched (admin-verified), else null.
export function findTaughtAnswer(query: string, catalogContextId?: number | null): { partNumbers: string[]; notes: string | null } | null {
  try {
    const q = String(query || "").toLowerCase();
    if (!q.trim()) return null;
    const rows = db.prepare(
      `SELECT query_pattern, part_numbers_json, notes, catalog_id FROM partsetu_answers`,
    ).all() as Array<{ query_pattern: string; part_numbers_json: string | null; notes: string | null; catalog_id: number | null }>;
    // catalog-scoped match wins over global; pattern must be a substring of the message.
    const candidates = rows.filter((r) => r.query_pattern && q.includes(r.query_pattern.toLowerCase().trim()));
    if (!candidates.length) return null;
    const scoped = catalogContextId != null ? candidates.find((r) => r.catalog_id === catalogContextId) : undefined;
    const chosen = scoped || candidates.find((r) => r.catalog_id == null) || candidates[0];
    let partNumbers: string[] = [];
    try { const arr = JSON.parse(chosen.part_numbers_json || "[]"); if (Array.isArray(arr)) partNumbers = arr.map(String); } catch { /* ignore */ }
    return { partNumbers, notes: chosen.notes };
  } catch { return null; }
}

// ---- v1.4 E1: cross-fitment ------------------------------------------------

// Reverse-lookup: which vehicles (catalogs) does this part number appear in?
export function findVehiclesForPart(partNumber: string): Array<{ catalog_id: number; oem: string; model: string; variant: string }> {
  const pn = normalizePN(partNumber);
  if (pn.length < 4) return [];
  try {
    return db.prepare(
      `SELECT DISTINCT c.id AS catalog_id, c.oem AS oem, c.model AS model, c.variant AS variant
       FROM partsetu_parts p JOIN partsetu_catalogs c ON c.id = p.catalog_id
       WHERE REPLACE(REPLACE(UPPER(p.part_number),'-',''),' ','') = ?
          OR REPLACE(REPLACE(UPPER(p.part_number),'-',''),' ','') LIKE ?
       LIMIT 25`,
    ).all(pn, `%${pn}%`) as any[];
  } catch { return []; }
}

// ---- v1.4 E2: spec queries -------------------------------------------------

const SPEC_QUERY_RE = /\b(spec|specs|specification|dimension|dimensions|thread|length|diameter|width|height|size|measurement|mm|inch|bore|stroke|pitch|torque)\b/i;
export function isSpecQuery(text: string): boolean {
  return SPEC_QUERY_RE.test(String(text || ""));
}

// Look up extracted specs for parts matching a query within the locked catalog.
export function findSpecsForQuery(query: string, catalogContextId?: number | null): Array<{ part_number: string; spec_name: string; spec_value: string; unit: string | null; source: string }> {
  try {
    const pn = normalizePN(query);
    const scope = catalogContextId ? ` AND p.catalog_id = ${Number(catalogContextId)}` : "";
    if (pn.length >= 4) {
      return db.prepare(
        `SELECT p.part_number AS part_number, s.spec_name, s.spec_value, s.unit, s.source
         FROM partsetu_part_specs s JOIN partsetu_parts p ON p.id = s.part_id
         WHERE (REPLACE(REPLACE(UPPER(p.part_number),'-',''),' ','') = ?
            OR REPLACE(REPLACE(UPPER(p.part_number),'-',''),' ','') LIKE ?)${scope}
         LIMIT 40`,
      ).all(pn, `%${pn}%`) as any[];
    }
    return [];
  } catch { return []; }
}

// ---- v1.4 E3: vague-query narrowing ----------------------------------------

// Pull a tyre count mentioned in the text ("10 tyre", "10 tyer", "10-tyre").
export function extractTyreCount(text: string): number | null {
  const m = String(text || "").match(/\b(\d{1,2})\s*(?:tyre|tyer|tire|wheel)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

const EMISSION_RE = /\b(BS\s?-?\s?[3456](?:\s?PH\s?2)?)\b/i;
export function extractEmissionStage(text: string): string | null {
  const m = String(text || "").match(EMISSION_RE);
  return m ? m[1].toUpperCase().replace(/\s+/g, "") : null;
}

// Narrow catalogs by attributes detected in the user's text (tyre count,
// emission stage). Returns a short candidate list to inject when no catalog
// is locked yet.
export function narrowCatalogs(text: string): Array<{ id: number; oem: string; model: string; variant: string; tyre_count: number | null; emission_stage: string | null }> {
  try {
    const tyre = extractTyreCount(text);
    const emission = extractEmissionStage(text);
    if (tyre == null && !emission) return [];
    const where: string[] = [];
    const params: any[] = [];
    if (tyre != null) { where.push("tyre_count = ?"); params.push(tyre); }
    if (emission) { where.push("UPPER(REPLACE(emission_stage,' ','')) = ?"); params.push(emission); }
    return db.prepare(
      `SELECT id, oem, model, variant, tyre_count, emission_stage FROM partsetu_catalogs
       WHERE ${where.join(" AND ")} LIMIT 15`,
    ).all(...params) as any[];
  } catch { return []; }
}

// ---- v1.4 E4: per-message language detection -------------------------------

// Lightweight heuristic: Devanagari → Hindi; Arabic block → Urdu; a small
// Hinglish wordlist → Hinglish; else English. Per-message, not per-session.
const HINGLISH_WORDS = ["kaun", "kaunsa", "konsa", "lgega", "lagega", "chahiye", "hai", "kya", "kitna", "kitne", "me", "mein", "gaadi", "gadi", "wala", "wali", "batao", "bta", "kar", "krna", "nahi", "nahin", "haan"];
export function detectLanguage(text: string): "Hindi" | "Urdu" | "Hinglish" | "English" {
  const t = String(text || "");
  if (/[ऀ-ॿ]/.test(t)) return "Hindi";
  if (/[؀-ۿ]/.test(t)) return "Urdu";
  const lc = t.toLowerCase();
  const hits = HINGLISH_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(lc)).length;
  if (hits >= 1) return "Hinglish";
  return "English";
}

// ---- R27.23: last-mile banned-phrase guard ---------------------------------
// Bandage over the model occasionally ignoring the no-pleasantries prompt rule:
// strip canned opener/closer phrases at the very start or end of the reply.
// Applied after Sonnet, before the reply is sent.
const BANNED_LEADING = [
  /^thank you for your query[!.]?\s*/i,
  /^aapke sawal ke liye dhanyawad[!.]?\s*/i,
  /^i'?d be happy to help[!.]?\s*/i,
  /^of course[!.]?\s*/i,
  /^sure[!.]?\s*/i,
  /^absolutely[!.]?\s*/i,
];
const BANNED_TRAILING = [
  /\s*let me know if you need[^.\n]*[.!]?\s*$/i,
  /\s*feel free to ask[^.\n]*[.!]?\s*$/i,
  /\s*would you like me to[^.\n]*[?.!]?\s*$/i,
];
export function stripBannedPhrases(reply: string): string {
  let out = String(reply || "");
  let count = 0;
  // Leading openers — strip repeatedly in case several are stacked.
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of BANNED_LEADING) {
      const next = out.replace(re, "");
      if (next !== out) { out = next.replace(/^\s+/, ""); count += 1; changed = true; }
    }
  }
  // Trailing closers.
  changed = true;
  while (changed) {
    changed = false;
    for (const re of BANNED_TRAILING) {
      const next = out.replace(re, "");
      if (next !== out) { out = next.replace(/\s+$/, ""); count += 1; changed = true; }
    }
  }
  if (count > 0) console.log(`[partsetu] stripped_banned_phrases=${count}`);
  return out.trim();
}

// Build the context block injected into the Claude system prompt. Note: this
// NEVER contains prices — only catalog identification + cross-reference data.
// v1.2: scoped to a locked catalogue when one is resolved; prepends a vehicle
// context header (or an unresolved-chassis note) so the model knows whether it
// can answer or must first confirm the vehicle model.
export async function buildContextBlock(
  query: string,
  catalogContextId?: number | null,
  chassisNo?: string | null,
): Promise<string> {
  const lines: string[] = [];

  const catalog = catalogContextId ? getCatalog(catalogContextId) : null;

  console.log(
    `[partsetu] catalog_resolved=${catalogContextId ?? "null"} chassis=${chassisNo ?? "-"} query="${query}"`,
  );

  // v1.4 D3 — inject active teaching rules (highest authority) first.
  const rules = getActiveRules({ catalogId: catalogContextId ?? null, oem: catalog?.oem ?? null, category: null });
  if (rules.length) {
    lines.push("TEACHING RULES (admin-taught — these have the highest authority, follow them strictly):");
    rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    lines.push("");
  }

  // v1.4 E4 — instruct reply language for this message.
  const lang = detectLanguage(query);
  lines.push(`REPLY LANGUAGE: respond in ${lang} (detected from the customer's latest message). If they switch language next time, switch with them.`, "");

  // v1.4 D3 — taught direct answer takes precedence over RAG.
  const taught = findTaughtAnswer(query, catalogContextId);
  if (taught) {
    lines.push(
      "ADMIN-VERIFIED ANSWER (use this; it was taught by our team and is authoritative):",
      `Part numbers: ${taught.partNumbers.length ? taught.partNumbers.join(", ") : "(none listed)"}` +
      `${taught.notes ? ` | Notes: ${taught.notes}` : ""}`,
      "Present this as the verified answer. You may still add helpful context, but do not contradict it.",
      "",
    );
  }

  if (catalog) {
    lines.push(
      `VEHICLE CONTEXT LOCKED: ${catalog.model || catalog.oem || "vehicle"}, VC No ${catalog.vc_no || "-"}.`,
      "Only suggest parts from this catalog. If the user asks about a different vehicle, explicitly confirm the switch before searching.",
      "",
    );
  } else if (chassisNo) {
    lines.push(
      `CHASSIS PROVIDED BUT UNRESOLVED: chassis/VC "${chassisNo}" did not match any catalogue on file.`,
      "Ask the user to confirm the vehicle model (e.g. 'SIGNA 4232.TK') before searching for parts.",
      "",
    );
  }

  const parts = await searchParts(query, 5, catalogContextId);
  const xrefs = searchXref(query, 5);
  if (parts.length) {
    lines.push("CATALOG MATCHES (from official spare-parts catalogues):");
    for (const p of parts) {
      lines.push(
        `- Part ${p.part_number || "(no number — not serviced)"}: ${p.description || ""}` +
        ` | assembly: ${p.assembly_name || "-"} | group: ${p.group_code || "-"}` +
        ` | qty/assembly: ${p.qty ?? "-"}${p.remarks ? ` | remarks: ${p.remarks}` : ""}` +
        `${p.is_serviceable ? "" : " | NOT SERVICED"}`,
      );
    }
    if (!catalogContextId) {
      lines.push(
        "NOTE: No vehicle is locked yet. The matches above are from across all catalogs. Present them and ASK the user to confirm the vehicle (chassis like 'MAT862011' / model like 'SIGNA 4232.TK') so we can narrow.",
      );
    }
  }
  if (xrefs.length) {
    lines.push("", "CROSS-REFERENCE MATCHES:");
    for (const x of xrefs) {
      lines.push(`- ${x.source_brand || "SRC"} ${x.source_part_no || "?"} (${x.source_description || ""}) = ${x.customer_oem || "OEM"} ${x.customer_part_no || "?"}`);
    }
  }
  if (!parts.length && !xrefs.length) {
    lines.push("(no matching catalog or cross-reference data found for this query)");
  }

  // v1.4 E1 — cross-fitment: when the user asks where a part fits / which
  // vehicles use it, reverse-lookup the part across all catalogs.
  if (/\b(where|which vehicle|which truck|kis|kaun|fit|fits|fitment|used in|lagega|lgega)\b/i.test(query)) {
    const pnTok = (query.match(/\b([A-Za-z0-9]{6,})\b/g) || []).find((t) => /\d/.test(t));
    if (pnTok) {
      const vehicles = findVehiclesForPart(pnTok);
      if (vehicles.length) {
        lines.push("", `CROSS-FITMENT — part ${pnTok} appears in these catalogs:`);
        for (const v of vehicles) lines.push(`- ${v.oem || "?"} ${v.model || ""} ${v.variant || ""}`.trim());
      }
    }
  }

  // v1.4 E2 — spec query: surface extracted specs (always show ALL known specs).
  if (isSpecQuery(query)) {
    const specs = findSpecsForQuery(query, catalogContextId);
    if (specs.length) {
      lines.push("", "EXTRACTED SPECS (show ALL of these in a clean table, with the source column):");
      for (const s of specs) lines.push(`- ${s.part_number}: ${s.spec_name} = ${s.spec_value}${s.unit ? " " + s.unit : ""} [source: ${s.source}]`);
    }
  }

  // v1.4 E3 — vague-query narrowing when no catalog is locked yet.
  if (!catalog) {
    const candidates = narrowCatalogs(query);
    if (candidates.length) {
      lines.push("", "NARROWED CANDIDATES (matched on vehicle attributes in the query — ask the user to pick variant/OEM to lock one):");
      for (const c of candidates) {
        lines.push(`- [#${c.id}] ${c.oem || "?"} ${c.model || ""} ${c.variant || ""}${c.tyre_count != null ? ` | ${c.tyre_count} tyre` : ""}${c.emission_stage ? ` | ${c.emission_stage}` : ""}`.trim());
      }
    }
  }

  lines.push(
    "",
    "The DB search results above were retrieved using semantically-expanded keyword variants. If results look irrelevant, ask the user about the part's location/function on the vehicle to narrow down.",
  );
  return lines.join("\n");
}

// ---- Catalog requests ------------------------------------------------------

export function createCatalogRequest(opts: {
  customerId?: number | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  year?: string | null;
  chassisNo?: string | null;
  engineModel?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
}): number {
  const ts = now();
  const r = db.prepare(
    `INSERT INTO partsetu_catalog_requests
       (customer_id, make, model, variant, year, chassis_no, engine_model, notes, photo_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    opts.customerId ?? null, opts.make ?? null, opts.model ?? null, opts.variant ?? null, opts.year ?? null,
    opts.chassisNo ?? null, opts.engineModel ?? null, opts.notes ?? null, opts.photoUrl ?? null, ts, ts,
  );
  return Number(r.lastInsertRowid);
}

export function listCatalogRequests(status?: string): any[] {
  if (status && status !== "all") {
    return db.prepare(`SELECT * FROM partsetu_catalog_requests WHERE status = ? ORDER BY id DESC`).all(status);
  }
  return db.prepare(`SELECT * FROM partsetu_catalog_requests ORDER BY id DESC`).all();
}

export function updateCatalogRequest(id: number, fields: { status?: string; adminNotes?: string }): void {
  const sets: string[] = [];
  const params: any[] = [];
  if (fields.status !== undefined) { sets.push("status = ?"); params.push(fields.status); }
  if (fields.adminNotes !== undefined) { sets.push("admin_notes = ?"); params.push(fields.adminNotes); }
  if (!sets.length) return;
  sets.push("updated_at = ?"); params.push(now());
  params.push(id);
  db.prepare(`UPDATE partsetu_catalog_requests SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

// ---- Admin: conversations + usage -----------------------------------------

export function listConversationsAdmin(limit = 100): any[] {
  return db.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM partsetu_messages m WHERE m.conversation_id = c.id) AS message_count
     FROM partsetu_conversations c
     ORDER BY c.last_message_at DESC
     LIMIT ?`,
  ).all(limit);
}

export function usageSummary(): any {
  const totals = db.prepare(
    `SELECT COUNT(*) AS messages,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
     FROM partsetu_messages`,
  ).get() as any;
  const byModel = db.prepare(
    `SELECT ai_model, COUNT(*) AS messages,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
     FROM partsetu_messages WHERE ai_model IS NOT NULL
     GROUP BY ai_model`,
  ).all();
  const conversations = (db.prepare(`SELECT COUNT(*) AS n FROM partsetu_conversations`).get() as any).n;
  return { conversations, ...totals, by_model: byModel };
}
