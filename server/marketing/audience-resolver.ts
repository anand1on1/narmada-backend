// R26.4 Marketing Hub — audience resolver.
// Given a marketing_audiences.filter_json shape, resolve to a concrete recipient list.
// "seller" in the UI maps to this codebase's `vendors` table. Leads are not yet a real
// table here, so 'leads' resolves to an empty set (and 'all' = customers + sellers).
// Hard cap of 50 recipients per the R26.4 audience-size constraint (keeps the simple
// sequential send loop manageable — no queue infrastructure needed).
import { rawSqlite as sqlite } from "../storage";

export const MAX_AUDIENCE = 50;

export type RecipientType = "customer" | "seller" | "lead";

export interface Recipient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: RecipientType;
}

export interface AudienceFilter {
  audience_type?: "customers" | "sellers" | "leads" | "all";
  filters?: {
    state?: string;
    last_order_after?: number; // epoch ms — customers only
    min_spend?: number; // INR — customers only
  };
  // R26.6b — explicit include/exclude overrides on top of the filter-matched set.
  // IDs are "<type>:<id>" so they stay unambiguous when audience_type is 'all'.
  include_ids?: string[];
  exclude_ids?: string[];
}

export function parseFilter(filterJson: string | null | undefined): AudienceFilter {
  if (!filterJson) return { audience_type: "all" };
  try {
    const parsed = JSON.parse(filterJson) as AudienceFilter;
    return parsed && typeof parsed === "object" ? parsed : { audience_type: "all" };
  } catch {
    return { audience_type: "all" };
  }
}

function resolveCustomers(f: AudienceFilter["filters"]): Recipient[] {
  // Spend + last-order derive from ledger_entries (debit = invoiced value, entry_date = order time).
  const rows = sqlite
    .prepare(
      `SELECT c.id AS id, c.name AS name, c.email AS email, c.phone AS phone, c.state AS state,
              COALESCE((SELECT SUM(le.debit_inr) FROM ledger_entries le WHERE le.customer_id = c.id), 0) AS spend,
              (SELECT MAX(le2.entry_date) FROM ledger_entries le2 WHERE le2.customer_id = c.id) AS last_order
       FROM customers c`,
    )
    .all() as Array<{ id: number; name: string; email: string | null; phone: string | null; state: string | null; spend: number; last_order: number | null }>;

  return rows
    .filter((r) => {
      if (f?.state && (r.state || "").toLowerCase() !== f.state.toLowerCase()) return false;
      if (f?.last_order_after != null && !(r.last_order != null && r.last_order >= f.last_order_after)) return false;
      if (f?.min_spend != null && !(r.spend >= f.min_spend)) return false;
      return true;
    })
    .map((r) => ({ id: String(r.id), name: r.name, email: r.email, phone: r.phone, type: "customer" as const }));
}

function resolveSellers(f: AudienceFilter["filters"]): Recipient[] {
  // "sellers" = vendors table. Only active vendors. State filter applies; spend/last_order do not.
  const rows = sqlite
    .prepare(`SELECT id, name, email, phone, whatsapp, state FROM vendors WHERE is_active = 1`)
    .all() as Array<{ id: number; name: string; email: string | null; phone: string | null; whatsapp: string | null; state: string | null }>;

  return rows
    .filter((r) => {
      if (f?.state && (r.state || "").toLowerCase() !== f.state.toLowerCase()) return false;
      return true;
    })
    .map((r) => ({ id: String(r.id), name: r.name, email: r.email, phone: r.phone || r.whatsapp, type: "seller" as const }));
}

// R26.6b — leads source. The leads table exists in this codebase (id/name/phone/email/state).
function resolveLeads(f: AudienceFilter["filters"]): Recipient[] {
  const rows = sqlite
    .prepare(`SELECT id, name, email, phone, state FROM leads`)
    .all() as Array<{ id: number; name: string; email: string | null; phone: string | null; state: string | null }>;
  return rows
    .filter((r) => {
      if (f?.state && (r.state || "").toLowerCase() !== f.state.toLowerCase()) return false;
      return true;
    })
    .map((r) => ({ id: String(r.id), name: r.name, email: r.email, phone: r.phone, type: "lead" as const }));
}

function recipientByTypedId(typedId: string): Recipient | null {
  const [t, rawId] = typedId.split(":");
  const id = parseInt(rawId, 10);
  if (!id) return null;
  if (t === "customer") {
    const r = sqlite.prepare(`SELECT id, name, email, phone FROM customers WHERE id = ?`).get(id) as any;
    return r ? { id: String(r.id), name: r.name, email: r.email, phone: r.phone, type: "customer" } : null;
  }
  if (t === "seller") {
    const r = sqlite.prepare(`SELECT id, name, email, phone, whatsapp FROM vendors WHERE id = ?`).get(id) as any;
    return r ? { id: String(r.id), name: r.name, email: r.email, phone: r.phone || r.whatsapp, type: "seller" } : null;
  }
  if (t === "lead") {
    const r = sqlite.prepare(`SELECT id, name, email, phone FROM leads WHERE id = ?`).get(id) as any;
    return r ? { id: String(r.id), name: r.name, email: r.email, phone: r.phone, type: "lead" } : null;
  }
  return null;
}

const typedKey = (r: Recipient) => `${r.type}:${r.id}`;

// Resolve a filter to recipients, capped at MAX_AUDIENCE. Returns the (uncapped) total too.
export function resolveAudience(filter: AudienceFilter): { recipients: Recipient[]; total: number } {
  const type = filter.audience_type || "all";
  const f = filter.filters;
  let recipients: Recipient[] = [];

  if (type === "customers") {
    recipients = resolveCustomers(f);
  } else if (type === "sellers") {
    recipients = resolveSellers(f);
  } else if (type === "leads") {
    recipients = resolveLeads(f);
  } else {
    // 'all' — customers + sellers + leads
    recipients = [...resolveCustomers(f), ...resolveSellers(f), ...resolveLeads(f)];
  }

  // R26.6b — apply explicit include/exclude overrides (typed "<type>:<id>" keys).
  const exclude = new Set(filter.exclude_ids || []);
  if (exclude.size) recipients = recipients.filter((r) => !exclude.has(typedKey(r)));
  if (filter.include_ids?.length) {
    const present = new Set(recipients.map(typedKey));
    for (const tid of filter.include_ids) {
      if (present.has(tid) || exclude.has(tid)) continue;
      const extra = recipientByTypedId(tid);
      if (extra) { recipients.push(extra); present.add(tid); }
    }
  }

  const total = recipients.length;
  return { recipients: recipients.slice(0, MAX_AUDIENCE), total };
}

export function resolveAudienceByJson(filterJson: string | null | undefined): { recipients: Recipient[]; total: number } {
  return resolveAudience(parseFilter(filterJson));
}
