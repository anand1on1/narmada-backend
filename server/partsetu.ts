// PartSetu AI v1 — raw-sqlite storage + search helpers.
// Kept separate from storage-v2/storage-r27 so the chatbot feature is self-contained.
import { rawSqlite as db } from "./storage";

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

// Find catalog parts relevant to a free-text query: exact/partial part-number
// match first, then description keyword match. Returns up to `limit` rows.
export function searchParts(query: string, limit = 5): PartRow[] {
  const q = String(query || "").trim();
  if (!q) return [];
  const out: PartRow[] = [];
  const seen = new Set<number>();
  const push = (rows: any[]) => {
    for (const r of rows) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
      if (out.length >= limit) break;
    }
  };

  const pnNorm = normalizePN(q);
  if (pnNorm.length >= 4) {
    // Exact part-number match (ignoring punctuation/case).
    push(db.prepare(
      `SELECT * FROM partsetu_parts
       WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') = ?
       LIMIT ?`,
    ).all(pnNorm, limit));
    if (out.length < limit) {
      push(db.prepare(
        `SELECT * FROM partsetu_parts
         WHERE REPLACE(REPLACE(UPPER(part_number),'-',''),' ','') LIKE ?
         LIMIT ?`,
      ).all(`%${pnNorm}%`, limit));
    }
  }

  if (out.length < limit) {
    // Description keyword match — AND of the alpha tokens.
    const tokens = q.toUpperCase().split(/\s+/).filter((t) => t.length >= 3);
    if (tokens.length) {
      const where = tokens.map(() => `UPPER(description) LIKE ?`).join(" AND ");
      const params = tokens.map((t) => `%${t}%`);
      push(db.prepare(
        `SELECT * FROM partsetu_parts WHERE ${where} LIMIT ?`,
      ).all(...params, limit));
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
export function buildContextBlock(query: string): string {
  const parts = searchParts(query, 5);
  const xrefs = searchXref(query, 5);
  const lines: string[] = [];
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
  if (!lines.length) return "(no matching catalog or cross-reference data found for this query)";
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
