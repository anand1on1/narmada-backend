import { rawSqlite } from "./storage";
import { sendGenericSalesEmail } from "./email";

export const QUOTE_RECIPIENTS = ["anand@narmadamotors.in", "sales@narmadamobility.com"] as const;
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function quoteDeliveryStatus(id: number) {
  // An interrupted SMTP operation is ambiguous, not safe to send automatically again.
  rawSqlite.prepare("UPDATE quote_delivery SET state='unknown' WHERE request_id=? AND state='sending' AND updated_at<?")
    .run(id, Date.now() - 120000);
  const recipients = rawSqlite.prepare("SELECT recipient,state,attempts FROM quote_delivery WHERE request_id=? ORDER BY recipient").all(id) as any[];
  return { state: recipients.length === 2 && recipients.every(r => r.state === "sent") ? "sent" : "pending",
    recipients, retryable: recipients.some(r => ["pending", "failed"].includes(r.state) && r.attempts < 3) };
}
export async function deliverQuote(id: number) {
  const row = rawSqlite.prepare("SELECT * FROM quote_request WHERE id=?").get(id) as any;
  if (!row) throw Error("Quote not found");
  const items = JSON.parse(row.cart_json);
  const text = [`Quotation enquiry ${row.reference}`, `Company: ${row.company_name}`,
    `Contact: ${row.contact_name}`, `Email: ${row.email}`, `Mobile: ${row.country_code} ${row.mobile}`,
    `Country/currency: ${row.country} / ${row.currency}`, `Delivery: ${row.delivery_location || "Not specified"}`,
    `Timeframe: ${row.timeframe}`, "", ...items.map((p: any, i: number) =>
      `${i + 1}. ${p.part_number || "Part number not supplied"} | ${p.description} | Qty ${p.qty}`),
    "", `Notes: ${row.notes || "None"}`].join("\n");
  for (const recipient of QUOTE_RECIPIENTS) {
    rawSqlite.prepare("INSERT OR IGNORE INTO quote_delivery(request_id,recipient,updated_at) VALUES(?,?,?)").run(id, recipient, Date.now());
    const claimed = rawSqlite.prepare(`UPDATE quote_delivery SET state='sending',attempts=attempts+1,updated_at=?
      WHERE request_id=? AND recipient=? AND attempts<3 AND (state='pending' OR (state='failed' AND updated_at<?))`)
      .run(Date.now(), id, recipient, Date.now() - 60000);
    if (!claimed.changes) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: { ok: boolean; error?: string };
    try { result = await Promise.race([
      sendGenericSalesEmail({ eventType: "quote_submit", entityId: id, to: recipient,
        subject: `[RFQ ${row.reference}] ${row.company_name.replace(/[\r\n]/g, " ")}`,
        text, html: `<pre style="white-space:pre-wrap">${escape(text)}</pre>` }),
      new Promise<{ ok: false; error: string }>(resolve => { timer = setTimeout(() => resolve({ ok: false, error: "delivery_unknown" }), 25000); }),
    ]); } catch { result = { ok: false, error: "delivery_unknown" }; }
    finally { if (timer) clearTimeout(timer); }
    // Only a provably unstarted send is retried. Transport failures may already
    // have been accepted by SMTP, so preserve "unknown" for operator reconciliation.
    const state = result.ok ? "sent" : /^(notifications disabled|SMTP not configured)$/.test(result.error || "") ? "failed" : "unknown";
    rawSqlite.prepare("UPDATE quote_delivery SET state=?,updated_at=? WHERE request_id=? AND recipient=? AND state='sending'")
      .run(state, Date.now(), id, recipient);
  }
  return quoteDeliveryStatus(id);
}
