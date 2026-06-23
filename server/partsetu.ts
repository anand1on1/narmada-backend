// PartSetu AI v1 — raw-sqlite storage + search helpers.
// Kept separate from storage-v2/storage-r27 so the chatbot feature is self-contained.
import { rawSqlite as db } from "./storage";
import { expandPartQuery } from "./services/keyword-expander";

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

export function setCatalogContext(conversationId: number, catalogId: number): void {
  db.prepare(`UPDATE partsetu_conversations SET catalog_context_id = ? WHERE id = ?`).run(catalogId, conversationId);
}

export function setConversationChassis(conversationId: number, chassisNo: string): void {
  db.prepare(`UPDATE partsetu_conversations SET chassis_no = ? WHERE id = ?`).run(chassisNo, conversationId);
}

// Pull a chassis / VC number out of free text, e.g. "chassis no 862011" or
// "VC: 51610568000R". Returns the captured token (uppercased) or null.
export function extractChassisNo(text: string): string | null {
  const m = String(text || "").match(/\b(?:chassis|vc)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9]{4,})/i);
  return m ? m[1].toUpperCase() : null;
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
  const exact = db.prepare(
    `SELECT * FROM partsetu_catalogs WHERE REPLACE(REPLACE(UPPER(vc_no),'-',''),' ','') = ?`,
  ).get(c);
  if (exact) return exact;
  const like = `%${c}%`;
  return db.prepare(
    `SELECT * FROM partsetu_catalogs
     WHERE REPLACE(REPLACE(UPPER(vc_no),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(model),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(variant),'-',''),' ','') LIKE ?
     LIMIT 1`,
  ).get(like, like, like) || null;
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
    const terms = await expandPartQuery(q);
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
export function searchXref(query: string, limit = 5): XrefRow[] {
  const pn = normalizePN(query);
  if (pn.length < 4) return [];
  return db.prepare(
    `SELECT * FROM partsetu_xref
     WHERE REPLACE(REPLACE(UPPER(source_part_no),'-',''),' ','') = ?
        OR REPLACE(REPLACE(UPPER(customer_part_no),'-',''),' ','') = ?
        OR REPLACE(REPLACE(UPPER(source_part_no),'-',''),' ','') LIKE ?
        OR REPLACE(REPLACE(UPPER(customer_part_no),'-',''),' ','') LIKE ?
     LIMIT ?`,
  ).all(pn, pn, `%${pn}%`, `%${pn}%`, limit) as XrefRow[];
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
