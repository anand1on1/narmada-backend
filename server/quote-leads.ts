import { rawSqlite } from "./storage";
import { sendGenericSalesEmail } from "./email";
import { QUOTE_RECIPIENTS } from "./quote-delivery";

export type QuoteLeadContact = {
  company_name: string; contact_name: string; mobile: string;
  country_code: string; country: string; currency: string;
};

/** Old clients send email/code only. Preserve verification, but never invent missing details. */
export function parseQuoteLeadContact(value: unknown): QuoteLeadContact | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_contact_details");
  const input = value as Record<string, unknown>;
  const field = (key: string) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const contact = {
    company_name: field("company_name"), contact_name: field("contact_name"), mobile: field("mobile"),
    country_code: field("country_code"), country: field("country"), currency: field("currency"),
  };
  if (!contact.company_name || contact.company_name.length > 200 ||
      !contact.contact_name || contact.contact_name.length > 100 ||
      !/^\d{6,15}$/.test(contact.mobile) || !/^\+\d{1,4}$/.test(contact.country_code) ||
      !/^[A-Z]{2}$/.test(contact.country) || !/^[A-Z]{3}$/.test(contact.currency)) {
    throw Error("invalid_contact_details");
  }
  return contact;
}

/** Called inside the OTP-consumption transaction. No mail/network work in this transaction. */
export function saveVerifiedQuoteLead(otpId: number, email: string, contact: QuoteLeadContact | null, now: number) {
  rawSqlite.prepare(`INSERT INTO quote_lead(otp_id,email,contact_json,verified_at) VALUES(?,?,?,?)
    ON CONFLICT(otp_id) DO NOTHING`).run(otpId, email, contact ? JSON.stringify(contact) : null, now);
  const { id } = rawSqlite.prepare("SELECT id FROM quote_lead WHERE otp_id=?").get(otpId) as { id: number };
  for (const recipient of QUOTE_RECIPIENTS) {
    rawSqlite.prepare("INSERT OR IGNORE INTO quote_lead_delivery(lead_id,recipient,updated_at) VALUES(?,?,?)")
      .run(id, recipient, now);
  }
  return id;
}

export async function deliverQuoteLead(id: number) {
  const lead = rawSqlite.prepare("SELECT * FROM quote_lead WHERE id=?").get(id) as
    { id: number; email: string; contact_json: string | null; verified_at: number } | undefined;
  if (!lead) return;
  const c: QuoteLeadContact | null = lead.contact_json ? JSON.parse(lead.contact_json) : null;
  const text = [
    `Verified quotation lead NM-L-${id}`,
    "The customer verified their email on Get Quotation. This contact notification does not mean a quotation was submitted.",
    `Email: ${lead.email}`,
    `Company: ${c?.company_name || "Not supplied by this client version"}`,
    `Contact name: ${c?.contact_name || "Not supplied by this client version"}`,
    `Mobile: ${c ? `${c.country_code} ${c.mobile}` : "Not supplied by this client version"}`,
    `Country: ${c?.country || "Not supplied"}`, `Currency: ${c?.currency || "Not supplied"}`,
    `Verified at (UTC): ${new Date(lead.verified_at).toISOString()}`,
    "", "Please follow up on the parts requirement. A completed quotation, if submitted, is notified separately.",
  ].join("\n");
  await Promise.all(QUOTE_RECIPIENTS.map(async recipient => {
    const now = Date.now();
    const claim = rawSqlite.prepare(`UPDATE quote_lead_delivery SET state='sending',attempts=attempts+1,updated_at=?
      WHERE lead_id=? AND recipient=? AND attempts<3
      AND (state='pending' OR (state='failed' AND updated_at<?))`).run(now, id, recipient, now - 60000);
    if (!claim.changes) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: { ok: boolean; error?: string };
    try {
      result = await Promise.race([
        sendGenericSalesEmail({
          eventType: "quote_verified_lead", entityId: id, to: recipient,
          subject: `[Verified quotation lead NM-L-${id}] ${String(c?.company_name || lead.email).replace(/[\r\n]/g, " ")}`,
          text,
        }),
        new Promise<{ ok: false; error: string }>(resolve => {
          timer = setTimeout(() => resolve({ ok: false, error: "delivery_unknown" }), 25000);
        }),
      ]);
    } catch { result = { ok: false, error: "delivery_unknown" }; }
    finally { if (timer) clearTimeout(timer); }
    // SMTP timeout/disconnect may have happened after acceptance: never blindly resend.
    const state = result.ok ? "sent" :
      /^(notifications disabled|SMTP not configured)$/.test(result.error || "") ? "failed" : "unknown";
    rawSqlite.prepare(`UPDATE quote_lead_delivery SET state=?,updated_at=?
      WHERE lead_id=? AND recipient=? AND state='sending'`).run(state, Date.now(), id, recipient);
  }));
}

let draining = false;
export async function drainQuoteLeads() {
  if (draining) return;
  draining = true;
  try {
    rawSqlite.prepare("UPDATE quote_lead_delivery SET state='unknown' WHERE state='sending' AND updated_at<?")
      .run(Date.now() - 120000);
    const pending = rawSqlite.prepare(`SELECT DISTINCT lead_id FROM quote_lead_delivery
      WHERE attempts<3 AND (state='pending' OR (state='failed' AND updated_at<?))
      ORDER BY lead_id LIMIT 10`).all(Date.now() - 60000) as { lead_id: number }[];
    for (const row of pending) await deliverQuoteLead(row.lead_id);
  } finally { draining = false; }
}

let worker: ReturnType<typeof setInterval> | undefined;
export function startQuoteLeadWorker() {
  if (worker) return;
  const run = () => void drainQuoteLeads().catch(() => console.error("[quote-leads] delivery worker failed; persisted queue retained"));
  worker = setInterval(run, 60000);
  worker.unref();
  run(); // Recover unsent leads after restart without needing another customer request.
}
