// Email delivery via Resend. Falls back to console-only if RESEND_API_KEY is unset.
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.MAIL_FROM || "Narmada Mobility <onboarding@resend.dev>";
// R27.34a: disabled per user request — contact-form enquiries used to be emailed to
// sales@. They are still persisted and visible in the admin panel (Contacts); only the
// automated mail is gone. Set SALES_EMAIL to a different address to route them elsewhere.
const SALES_INBOX = "sales@narmadamobility.com";
const TO_EMAIL = process.env.SALES_EMAIL || "";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface ContactPayload {
  name: string;
  email: string;
  phone?: string | null;
  country?: string | null;
  subject?: string | null;
  productInterest?: string | null;
  message: string;
}

export async function sendContactEmail(c: ContactPayload): Promise<{ ok: boolean; via: string; error?: string }> {
  if (!TO_EMAIL || TO_EMAIL.trim().toLowerCase() === SALES_INBOX) {
    console.log("[email] R27.34a: contact-form email to sales@ disabled — contact saved in admin panel only");
    return { ok: false, via: "disabled" };
  }
  if (!resend) {
    console.log("[email] RESEND_API_KEY not set — skipping SMTP, contact only saved in admin panel");
    return { ok: false, via: "skipped" };
  }
  const subject = `New enquiry: ${c.subject || "Spare parts quote"} — ${c.name}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
      <div style="background: #001a4d; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">New Enquiry — Narmada Mobility</h2>
        <p style="margin: 4px 0 0; opacity: 0.85; font-size: 13px;">From narmadamobility.com contact form</p>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${escape(c.name)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Email</td><td style="padding: 8px 0;"><a href="mailto:${escape(c.email)}">${escape(c.email)}</a></td></tr>
          ${c.phone ? `<tr><td style="padding: 8px 0; color: #6b7280;">Phone</td><td style="padding: 8px 0;"><a href="tel:${escape(c.phone)}">${escape(c.phone)}</a></td></tr>` : ""}
          ${c.country ? `<tr><td style="padding: 8px 0; color: #6b7280;">Country</td><td style="padding: 8px 0;">${escape(c.country)}</td></tr>` : ""}
          ${c.subject ? `<tr><td style="padding: 8px 0; color: #6b7280;">Subject</td><td style="padding: 8px 0;">${escape(c.subject)}</td></tr>` : ""}
          ${c.productInterest ? `<tr><td style="padding: 8px 0; color: #6b7280;">Part / OEM</td><td style="padding: 8px 0;">${escape(c.productInterest)}</td></tr>` : ""}
        </table>
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <div style="color: #6b7280; font-size: 13px; margin-bottom: 6px;">Message</div>
          <div style="white-space: pre-wrap; line-height: 1.5;">${escape(c.message)}</div>
        </div>
        <div style="margin-top: 24px; padding: 12px; background: #f9fafb; border-radius: 6px; font-size: 12px; color: #6b7280;">
          Reply directly to this email to respond to ${escape(c.name)}.
        </div>
      </div>
    </div>`;
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      replyTo: c.email,
      subject,
      html,
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false, via: "resend", error: String((error as any).message || error) };
    }
    console.log("[email] Sent via Resend:", data?.id);
    return { ok: true, via: "resend" };
  } catch (e: any) {
    console.error("[email] Resend exception:", e);
    return { ok: false, via: "resend", error: e.message };
  }
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// Round 3: Quotation email via SMTP (nodemailer) with PDF attachment
// ============================================================
import nodemailer from "nodemailer";
import fs from "fs";

export interface QuotationEmailPayload {
  to: string;                  // customer email
  customerName: string;
  quoteNo: string;
  pdfPath: string;             // absolute path to generated PDF
  currency?: string;
  grandTotal?: number;
  cc?: string | null;
  ccSelf?: boolean;             // also CC quotes@... so the team has a record
}

let _smtpTransport: nodemailer.Transporter | null = null;
function getSmtpTransport(): nodemailer.Transporter | null {
  if (_smtpTransport) return _smtpTransport;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  _smtpTransport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return _smtpTransport;
}

export async function sendQuotationEmail(
  p: QuotationEmailPayload,
): Promise<{ ok: boolean; via: string; error?: string; messageId?: string }> {
  const transport = getSmtpTransport();
  if (!transport) {
    return {
      ok: false,
      via: "smtp_unconfigured",
      error: "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS on Render (and SMTP_PORT, SMTP_SECURE if not 465/true).",
    };
  }
  if (!p.to) return { ok: false, via: "skipped", error: "customer email is empty" };
  if (!fs.existsSync(p.pdfPath)) return { ok: false, via: "smtp", error: `PDF not found at ${p.pdfPath}` };

  const fromName = process.env.SMTP_FROM_NAME || "Narmada Mobility";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER!;
  const ccList: string[] = [];
  if (p.cc) ccList.push(p.cc);
  if (p.ccSelf !== false) ccList.push(fromEmail);

  const totalLine = (p.grandTotal && p.grandTotal > 0)
    ? `<p style="margin:8px 0;">Grand Total: <strong>${escape(p.currency || "INR")} ${escape(String(p.grandTotal.toLocaleString("en-IN")))}</strong></p>`
    : "";

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="background:#0a2540;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">Quotation ${escape(p.quoteNo)}</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">From Narmada Mobility</p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p>Dear ${escape(p.customerName)},</p>
        <p>Please find attached our quotation <strong>${escape(p.quoteNo)}</strong> for your reference.</p>
        ${totalLine}
        <p>If you have any questions or need clarification on any item, please reply to this email.</p>
        <p style="margin-top:24px;">Best regards,<br/><strong>Narmada Mobility</strong><br/>Patna, India</p>
        <div style="margin-top:24px;padding:12px;background:#f9fafb;border-radius:6px;font-size:12px;color:#6b7280;">
          This is an automated message. Reply directly to reach our sales team.
        </div>
      </div>
    </div>`;

  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: p.to,
      cc: ccList.length ? ccList : undefined,
      subject: `Quotation ${p.quoteNo} from Narmada Mobility`,
      html,
      attachments: [
        { filename: `${p.quoteNo}.pdf`, path: p.pdfPath, contentType: "application/pdf" },
      ],
    });
    console.log(`[email] Quotation ${p.quoteNo} sent to ${p.to} via SMTP (id=${info.messageId})`);
    return { ok: true, via: "smtp", messageId: info.messageId };
  } catch (e: any) {
    console.error("[email] SMTP send failed:", e);
    return { ok: false, via: "smtp", error: e.message || String(e) };
  }
}

// R25a — generic marketing email to a lead via the existing SMTP transport. Body is plain text
// (newlines preserved as <br>); subject + body come from the caller. Reuses getSmtpTransport().
export async function sendMarketingEmail(
  p: { to: string; subject: string; body: string },
): Promise<{ ok: boolean; via: string; error?: string; messageId?: string }> {
  const transport = getSmtpTransport();
  if (!transport) {
    return { ok: false, via: "smtp_unconfigured", error: "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS." };
  }
  if (!p.to) return { ok: false, via: "skipped", error: "recipient email is empty" };
  const fromName = process.env.SMTP_FROM_NAME || "Narmada Mobility";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER!;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="background:#0a2540;color:white;padding:18px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">Narmada Mobility</h2>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;line-height:1.6;">
        ${escape(p.body).replace(/\n/g, "<br>")}
      </div>
    </div>`;
  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: p.to,
      subject: p.subject || "A message from Narmada Mobility",
      html,
      text: p.body,
    });
    console.log(`[email] Marketing email sent to ${p.to} via SMTP (id=${info.messageId})`);
    return { ok: true, via: "smtp", messageId: info.messageId };
  } catch (e: any) {
    console.error("[email] marketing SMTP send failed:", e);
    return { ok: false, via: "smtp", error: e.message || String(e) };
  }
}

// ============================================================
// R28 Session 1 — Sales-team email notifications
// (sales@narmadamobility.com receives one email per RFQ create,
//  quote request, and order placed). Fire-and-forget; never throws.
// ============================================================
import { rawSqlite } from "./storage";
import * as v2 from "./storage-v2";

type SalesEventType = "rfq_created" | "quote_requested" | "order_placed" | "test";

interface SalesEmailEnv {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  to: string;
  replyTo: string;
  siteUrl: string;
  enabled: boolean;
}

function loadSalesEnv(): SalesEmailEnv {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secureRaw = process.env.SMTP_SECURE;
  const secure = secureRaw === undefined ? port === 465 : String(secureRaw).toLowerCase() !== "false";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "";
  const fromName = process.env.SMTP_FROM_NAME || "Narmada Mobility";
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;
  const to = process.env.SALES_NOTIFY_EMAIL || process.env.SALES_EMAIL || "sales@narmadamobility.com";
  const siteUrl = process.env.SITE_URL || "https://narmadamobility.com";
  const enabled = String(process.env.EMAIL_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
  return { host, port, secure, user, pass, fromName, fromEmail, to, replyTo: "sales@narmadamobility.com", siteUrl, enabled };
}

let _salesTransport: nodemailer.Transporter | null = null;
function getSalesTransport(env: SalesEmailEnv): nodemailer.Transporter | null {
  if (_salesTransport) return _salesTransport;
  if (!env.host || !env.user || !env.pass) return null;
  _salesTransport = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.secure,
    auth: { user: env.user, pass: env.pass },
  });
  return _salesTransport;
}

// ---- In-memory sliding-window rate limiter: max 100 sends/hour per event_type.
// Single-instance Render deploy => memory is fine. Reset on process restart is OK
// because the DB already stores the log and rate-limits are a soft cap.
const RATE_LIMIT_PER_HOUR = 100;
const _rateBuckets = new Map<SalesEventType, number[]>();
function checkRate(eventType: SalesEventType): boolean {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const bucket = _rateBuckets.get(eventType) || [];
  const pruned = bucket.filter((t) => t > cutoff);
  if (pruned.length >= RATE_LIMIT_PER_HOUR) {
    _rateBuckets.set(eventType, pruned);
    return false;
  }
  pruned.push(now);
  _rateBuckets.set(eventType, pruned);
  return true;
}

// ---- email_log helpers (raw sqlite for simplicity + robustness)
interface EmailLogRow {
  id: number;
  event_type: string;
  entity_id: number | null;
  recipient: string;
  cc: string | null;
  reply_to: string | null;
  subject: string;
  body_preview: string | null;
  status: string;
  error_message: string | null;
  provider_message_id: string | null;
  attempts: number;
  created_at: number;
  sent_at: number | null;
}

function insertEmailLog(row: Omit<EmailLogRow, "id" | "created_at" | "sent_at"> & { created_at?: number }): number {
  const stmt = rawSqlite.prepare(`
    INSERT INTO email_log (event_type, entity_id, recipient, cc, reply_to, subject, body_preview,
                           status, error_message, provider_message_id, attempts, created_at, sent_at)
    VALUES (@event_type, @entity_id, @recipient, @cc, @reply_to, @subject, @body_preview,
            @status, @error_message, @provider_message_id, @attempts, @created_at, NULL)
  `);
  const info = stmt.run({
    event_type: row.event_type,
    entity_id: row.entity_id ?? null,
    recipient: row.recipient,
    cc: row.cc ?? null,
    reply_to: row.reply_to ?? null,
    subject: row.subject,
    body_preview: row.body_preview ?? null,
    status: row.status,
    error_message: row.error_message ?? null,
    provider_message_id: row.provider_message_id ?? null,
    attempts: row.attempts ?? 0,
    created_at: row.created_at ?? Date.now(),
  });
  return Number(info.lastInsertRowid);
}

function updateEmailLog(id: number, patch: Partial<EmailLogRow>): void {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return;
  values.push(id);
  try {
    rawSqlite.prepare(`UPDATE email_log SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  } catch (e: any) {
    console.error("[email] updateEmailLog failed:", e?.message || e);
  }
}

function getEmailLog(id: number): EmailLogRow | undefined {
  return rawSqlite.prepare(`SELECT * FROM email_log WHERE id = ?`).get(id) as EmailLogRow | undefined;
}

export function listEmailLogs(opts: { limit?: number; eventType?: string; status?: string } = {}): EmailLogRow[] {
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.eventType) { conds.push("event_type = ?"); params.push(opts.eventType); }
  if (opts.status) { conds.push("status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit || 50, 1), 500);
  const stmt = rawSqlite.prepare(`SELECT * FROM email_log ${where} ORDER BY created_at DESC LIMIT ?`);
  return stmt.all(...params, limit) as EmailLogRow[];
}

// ---- rendering helpers
function fmtInr(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n as number)) return "—";
  try { return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); } catch { return `₹${n}`; }
}
function fmtDateIst(ts: number | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
  } catch { return String(ts); }
}
function trim500(s: string): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > 500 ? t.slice(0, 497) + "..." : t;
}

function shellHtml(inner: string, siteUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="background:#001a4d;color:#ffffff;padding:16px 20px;">
          <div style="font-size:16px;font-weight:700;letter-spacing:0.3px;">Narmada Mobility</div>
          <div style="opacity:0.8;font-size:12px;margin-top:2px;">Automated sales notification</div>
        </td></tr>
        <tr><td style="padding:20px;font-size:14px;line-height:1.55;">${inner}</td></tr>
        <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:12px 20px;color:#6b7280;font-size:12px;">
          This is an automated notification from Narmada Mobility. Reply directly to reach the customer.<br/>
          <a href="${escape(siteUrl)}" style="color:#6b7280;text-decoration:underline;">${escape(siteUrl)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function kv(k: string, v: string | null | undefined): string {
  return `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;width:150px;vertical-align:top;">${escape(k)}</td><td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${v ? escape(String(v)) : "—"}</td></tr>`;
}

function partsTableHtml(items: Array<{ partNo?: string | null; description?: string | null; qty?: number | string | null; unitPrice?: number | null; lineTotal?: number | null }>): string {
  const rows = items.map((it, i) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${i + 1}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escape(String(it.partNo || "—"))}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(String(it.description || "—"))}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(String(it.qty ?? "—"))}</td>
    ${it.unitPrice !== undefined ? `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${it.unitPrice != null ? escape(fmtInr(it.unitPrice)) : "—"}</td>` : ""}
    ${it.lineTotal !== undefined ? `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${it.lineTotal != null ? escape(fmtInr(it.lineTotal)) : "—"}</td>` : ""}
  </tr>`).join("");
  const hasPrice = items.some((it) => it.unitPrice !== undefined);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 16px;">
    <thead><tr style="background:#f9fafb;">
      <th align="left" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">#</th>
      <th align="left" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">Part No</th>
      <th align="left" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">Description</th>
      <th align="right" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">Qty</th>
      ${hasPrice ? `<th align="right" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">Unit</th>
      <th align="right" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">Line</th>` : ""}
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function buttonLink(label: string, href: string): string {
  return `<div style="margin:16px 0;"><a href="${escape(href)}" style="display:inline-block;background:#001a4d;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${escape(label)} →</a></div>`;
}

function parseItemsJson(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try { const j = JSON.parse(String(raw)); return Array.isArray(j) ? j : []; } catch { return []; }
}

// ---- core sender with logging + rate-limit + skip-when-disabled
async function performSend(
  eventType: SalesEventType,
  entityId: number | null,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: string; logId: number }> {
  const env = loadSalesEnv();
  const bodyPreview = trim500(text);

  // Log row is inserted BEFORE the send so we can always trace attempts.
  const logId = insertEmailLog({
    event_type: eventType,
    entity_id: entityId,
    recipient: env.to,
    cc: null,
    reply_to: env.replyTo,
    subject,
    body_preview: bodyPreview,
    status: "pending",
    error_message: null,
    provider_message_id: null,
    attempts: 0,
  });

  if (!env.enabled) {
    updateEmailLog(logId, { status: "skipped", error_message: "email_notifications_disabled" });
    return { ok: false, error: "notifications disabled", logId };
  }
  if (!checkRate(eventType)) {
    updateEmailLog(logId, { status: "skipped", error_message: "rate_limited" });
    return { ok: false, error: "rate limited", logId };
  }

  const transport = getSalesTransport(env);
  if (!transport) {
    updateEmailLog(logId, { status: "failed", error_message: "smtp_unconfigured", attempts: 1 });
    return { ok: false, error: "SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing)", logId };
  }

  try {
    const info = await transport.sendMail({
      from: `"${env.fromName}" <${env.fromEmail}>`,
      to: env.to,
      replyTo: env.replyTo,
      subject,
      html,
      text,
    });
    updateEmailLog(logId, {
      status: "sent",
      provider_message_id: info.messageId || null,
      attempts: 1,
      sent_at: Date.now(),
      error_message: null,
    });
    console.log(`[email:${eventType}] sent to ${env.to} (id=${info.messageId})`);
    return { ok: true, messageId: info.messageId, logId };
  } catch (e: any) {
    const msg = e?.message || String(e);
    updateEmailLog(logId, { status: "failed", error_message: msg, attempts: 1 });
    console.error(`[email:${eventType}] send failed:`, msg);
    return { ok: false, error: msg, logId };
  }
}

// ---------- RFQ email ----------
async function renderRfqEmail(rfqId: number): Promise<{ subject: string; html: string; text: string } | null> {
  const env = loadSalesEnv();
  const rfq = await v2.getRfq(rfqId);
  if (!rfq) return null;
  const customer = rfq.customerId ? await v2.getCustomer(rfq.customerId) : undefined;
  const items = parseItemsJson(rfq.items);
  const contactName = rfq.contactName || customer?.contactPerson || customer?.name || "Customer";
  const city = (customer as any)?.city || (customer as any)?.billingCity || "—";
  const rfqCode = (rfq as any).rfqNumber || `RFQ-${rfq.id}`;
  const partsCount = items.length;

  const subject = `[Narmada Enquiry] ${rfqCode} · ${partsCount} part${partsCount === 1 ? "" : "s"} · ${contactName} (${city})`;
  const adminLink = `${env.siteUrl.replace(/\/$/, "")}/admin/rfqs/${encodeURIComponent(rfqCode)}`;

  const partsForTable = items.map((it: any) => ({
    partNo: it.partNo || it.part_no || it.partNumber || it.part_number || null,
    description: it.description || it.desc || it.name || null,
    qty: it.qty ?? it.quantity ?? null,
  }));

  const html = shellHtml(`
    <p style="margin:0 0 12px;">Hi Sales Team,</p>
    <p style="margin:0 0 12px;">A new enquiry just came in.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin:0 0 12px;">
      ${kv("Tracking Code", rfqCode)}
      ${kv("Submitted", fmtDateIst(rfq.createdAt))}
      ${kv("Customer", contactName)}
      ${kv("Mobile", rfq.phone || (customer as any)?.phone)}
      ${kv("Email", rfq.email || (customer as any)?.email)}
      ${kv("City", city)}
      ${kv("GSTIN", (customer as any)?.gstin)}
    </table>
    ${partsCount ? `<div style="margin:12px 0 4px;font-weight:600;">Parts Requested (${partsCount})</div>
    ${partsTableHtml(partsForTable)}` : ""}
    ${rfq.notes ? `<div style="margin:12px 0 4px;font-weight:600;">Customer Message</div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:10px 12px;border-radius:6px;white-space:pre-wrap;">${escape(String(rfq.notes))}</div>` : ""}
    ${buttonLink("Open in admin", adminLink)}
    <div style="color:#6b7280;font-size:12px;">Respond within 4 business hours per SLA.</div>
  `, env.siteUrl);

  const textLines: string[] = [];
  textLines.push("Hi Sales Team,", "", "A new enquiry just came in.", "");
  textLines.push(`Tracking Code: ${rfqCode}`);
  textLines.push(`Submitted:     ${fmtDateIst(rfq.createdAt)}`);
  textLines.push(`Customer:      ${contactName}`);
  textLines.push(`Mobile:        ${rfq.phone || (customer as any)?.phone || "—"}`);
  textLines.push(`Email:         ${rfq.email || (customer as any)?.email || "—"}`);
  textLines.push(`City:          ${city}`);
  textLines.push(`GSTIN:         ${(customer as any)?.gstin || "—"}`);
  if (partsCount) {
    textLines.push("", `Parts Requested (${partsCount}):`);
    partsForTable.forEach((it, i) => {
      textLines.push(`  ${i + 1}. ${it.partNo || "—"}  ${it.description || "—"}  x ${it.qty ?? "—"}`);
    });
  }
  if (rfq.notes) textLines.push("", "Customer Message:", `  ${String(rfq.notes)}`);
  textLines.push("", `Open in admin: ${adminLink}`);
  return { subject, html, text: textLines.join("\n") };
}

export async function sendRfqEmail(rfqId: number): Promise<void> {
  try {
    const rendered = await renderRfqEmail(rfqId);
    if (!rendered) {
      insertEmailLog({
        event_type: "rfq_created",
        entity_id: rfqId,
        recipient: loadSalesEnv().to,
        cc: null,
        reply_to: loadSalesEnv().replyTo,
        subject: `[Narmada Enquiry] rfq ${rfqId} not found`,
        body_preview: null,
        status: "failed",
        error_message: "entity_not_found",
        provider_message_id: null,
        attempts: 0,
      });
      return;
    }
    await performSend("rfq_created", rfqId, rendered.subject, rendered.html, rendered.text);
  } catch (e: any) {
    console.error("[email] sendRfqEmail unexpected:", e?.message || e);
  }
}

// ---------- Quote request email (product-page enquiry) ----------
// A "quote request" is a contact submission tied to a single product. We support
// two identifier shapes so future callers can pass a product id OR a contact id:
//   - if a row exists in contact_submissions with that id, use it
//   - otherwise, fall back to product-only rendering (id = product id)
async function renderQuoteRequestEmail(requestId: number): Promise<{ subject: string; html: string; text: string } | null> {
  const env = loadSalesEnv();
  const contact = rawSqlite.prepare(`SELECT * FROM contact_submissions WHERE id = ?`).get(requestId) as any | undefined;
  let product: any | undefined;
  if (contact?.product_interest) {
    // product_interest may be part_number or slug — best effort.
    product = rawSqlite.prepare(`SELECT * FROM products WHERE part_number = ? OR slug = ? LIMIT 1`).get(contact.product_interest, contact.product_interest) as any;
  }
  if (!contact && !product) return null;

  const partNo = product?.part_number || contact?.product_interest || "—";
  const custName = contact?.name || "Customer";
  const subject = `[Narmada Quote Request] ${partNo} · ${custName}`;
  const adminLink = `${env.siteUrl.replace(/\/$/, "")}/admin/quote-requests/${requestId}`;
  const productLink = product?.slug ? `${env.siteUrl.replace(/\/$/, "")}/parts/${product.slug}` : null;

  const html = shellHtml(`
    <p style="margin:0 0 12px;">A visitor requested a quote for a single product.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin:0 0 12px;">
      ${kv("Submitted", fmtDateIst(contact?.created_at))}
      ${kv("Customer", `${custName}${contact?.phone ? " / " + contact.phone : ""}${contact?.email ? " / " + contact.email : ""}`)}
      ${kv("Part No", partNo)}
      ${kv("Product", product?.name || contact?.product_interest || "—")}
      ${kv("Listed Price", product?.price_inr != null ? fmtInr(product.price_inr) : "—")}
      ${kv("Stock", product?.stock_qty != null ? (product.stock_qty > 0 ? `Ready to ship (${product.stock_qty})` : "Out of stock") : "—")}
      ${productLink ? kv("Source Page", productLink) : ""}
    </table>
    ${contact?.message ? `<div style="margin:12px 0 4px;font-weight:600;">Message</div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:10px 12px;border-radius:6px;white-space:pre-wrap;">${escape(String(contact.message))}</div>` : ""}
    ${buttonLink("Open in admin", adminLink)}
  `, env.siteUrl);

  const text = [
    "A visitor requested a quote for a single product.",
    "",
    `Submitted:     ${fmtDateIst(contact?.created_at)}`,
    `Customer:      ${custName}${contact?.phone ? " / " + contact.phone : ""}${contact?.email ? " / " + contact.email : ""}`,
    `Product:       ${product?.name || contact?.product_interest || "—"} (Part #${partNo})`,
    `Listed Price:  ${product?.price_inr != null ? fmtInr(product.price_inr) : "—"}`,
    `Stock Status:  ${product?.stock_qty != null ? (product.stock_qty > 0 ? `Ready to ship (${product.stock_qty})` : "Out of stock") : "—"}`,
    productLink ? `Source Page:   ${productLink}` : "",
    contact?.message ? `\nMessage:\n  ${contact.message}` : "",
    "",
    `Open in admin: ${adminLink}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

export async function sendQuoteRequestEmail(requestId: number): Promise<void> {
  try {
    const rendered = await renderQuoteRequestEmail(requestId);
    if (!rendered) {
      insertEmailLog({
        event_type: "quote_requested",
        entity_id: requestId,
        recipient: loadSalesEnv().to,
        cc: null,
        reply_to: loadSalesEnv().replyTo,
        subject: `[Narmada Quote Request] request ${requestId} not found`,
        body_preview: null,
        status: "failed",
        error_message: "entity_not_found",
        provider_message_id: null,
        attempts: 0,
      });
      return;
    }
    await performSend("quote_requested", requestId, rendered.subject, rendered.html, rendered.text);
  } catch (e: any) {
    console.error("[email] sendQuoteRequestEmail unexpected:", e?.message || e);
  }
}

// ---------- Order placed email ----------
// "Order" == a purchase_orders row (customer PO). This is where orders originate
// today; when a dedicated /api/orders endpoint lands later, it can call this too.
async function renderOrderEmail(orderId: number): Promise<{ subject: string; html: string; text: string } | null> {
  const env = loadSalesEnv();
  const po = await v2.getPurchaseOrder(orderId);
  if (!po) return null;
  const customer = po.customerId ? await v2.getCustomer(po.customerId) : undefined;
  const items = parseItemsJson(po.items);
  const custName = (customer as any)?.contactPerson || (customer as any)?.name || "Customer";
  const orderRef = po.customerPoNumber || `ORD-${po.id}`;
  const total = Number(po.totalInr || 0);

  const subject = `[Narmada Order] #${orderRef} · ${fmtInr(total)} · ${custName}`;
  const adminLink = `${env.siteUrl.replace(/\/$/, "")}/admin/orders/${orderRef}`;

  const partsForTable = items.map((it: any) => {
    const qty = Number(it.qty ?? it.quantity ?? 0);
    const unit = Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0);
    const line = it.lineTotal ?? it.line_total ?? (qty && unit ? qty * unit : null);
    return {
      partNo: it.partNo || it.part_no || it.partNumber || it.part_number || null,
      description: it.description || it.desc || it.name || null,
      qty,
      unitPrice: isNaN(unit) ? null : unit,
      lineTotal: line != null ? Number(line) : null,
    };
  });

  const subtotal = Number(po.subtotalInr || 0);
  const gst = Number(po.gstInr || 0);
  const shippingAddress = [(customer as any)?.billingAddress, (customer as any)?.billingCity, (customer as any)?.billingState, (customer as any)?.billingPincode]
    .filter(Boolean).join(", ") || "—";

  const html = shellHtml(`
    <p style="margin:0 0 12px;">An order was placed on the website.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin:0 0 12px;">
      ${kv("Order ID", orderRef)}
      ${kv("Placed", fmtDateIst(po.createdAt))}
      ${kv("Customer", `${custName}${(customer as any)?.phone ? " / " + (customer as any).phone : ""}${(customer as any)?.email ? " / " + (customer as any).email : ""}`)}
      ${kv("Billing GSTIN", (customer as any)?.gstin)}
      ${kv("Shipping To", shippingAddress)}
    </table>
    <div style="margin:8px 0 4px;font-weight:600;">Items (${partsForTable.length})</div>
    ${partsTableHtml(partsForTable)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin:8px 0 0;">
      <tr><td style="padding:4px 8px;text-align:right;color:#6b7280;">Subtotal:</td><td style="padding:4px 0;text-align:right;width:120px;">${escape(fmtInr(subtotal))}</td></tr>
      <tr><td style="padding:4px 8px;text-align:right;color:#6b7280;">GST:</td><td style="padding:4px 0;text-align:right;">${escape(fmtInr(gst))}</td></tr>
      <tr><td style="padding:4px 8px;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">Total:</td><td style="padding:4px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${escape(fmtInr(total))}</td></tr>
    </table>
    ${kv("Payment Status", po.status || "pending")}
    ${buttonLink("Open in admin", adminLink)}
  `, env.siteUrl);

  const text = [
    "An order was placed on the website.",
    "",
    `Order ID:      ${orderRef}`,
    `Placed:        ${fmtDateIst(po.createdAt)}`,
    `Customer:      ${custName}${(customer as any)?.phone ? " / " + (customer as any).phone : ""}${(customer as any)?.email ? " / " + (customer as any).email : ""}`,
    `Billing GSTIN: ${(customer as any)?.gstin || "—"}`,
    `Shipping To:   ${shippingAddress}`,
    "",
    `Items (${partsForTable.length}):`,
    ...partsForTable.map((it, i) => `  ${i + 1}. ${it.partNo || "—"}  ${it.description || "—"}  × ${it.qty}${it.unitPrice != null ? `  @ ${fmtInr(it.unitPrice)}` : ""}${it.lineTotal != null ? `  = ${fmtInr(it.lineTotal)}` : ""}`),
    `  ${"-".repeat(60)}`,
    `  Subtotal:  ${fmtInr(subtotal)}`,
    `  GST:       ${fmtInr(gst)}`,
    `  Total:     ${fmtInr(total)}`,
    "",
    `Payment Status: ${po.status || "pending"}`,
    "",
    `Open in admin: ${adminLink}`,
  ].join("\n");

  return { subject, html, text };
}

export async function sendOrderEmail(orderId: number): Promise<void> {
  try {
    const rendered = await renderOrderEmail(orderId);
    if (!rendered) {
      insertEmailLog({
        event_type: "order_placed",
        entity_id: orderId,
        recipient: loadSalesEnv().to,
        cc: null,
        reply_to: loadSalesEnv().replyTo,
        subject: `[Narmada Order] order ${orderId} not found`,
        body_preview: null,
        status: "failed",
        error_message: "entity_not_found",
        provider_message_id: null,
        attempts: 0,
      });
      return;
    }
    await performSend("order_placed", orderId, rendered.subject, rendered.html, rendered.text);
  } catch (e: any) {
    console.error("[email] sendOrderEmail unexpected:", e?.message || e);
  }
}

// ---------- Test email ----------
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const env = loadSalesEnv();
  if (!to) return { ok: false, error: "recipient required" };
  const subject = `[Narmada Test] SMTP sanity check — ${new Date().toISOString()}`;
  const html = shellHtml(`
    <p>This is a test email from the Narmada sales notification pipeline.</p>
    <p>If you received this, SMTP is wired correctly.</p>
    <p style="color:#6b7280;font-size:12px;">Sent at ${escape(fmtDateIst(Date.now()))}</p>
  `, env.siteUrl);
  const text = `Narmada Mobility — SMTP test at ${fmtDateIst(Date.now())}. If you received this, SMTP is wired correctly.`;

  // Override recipient to the requested address for this one call.
  const bodyPreview = trim500(text);
  const logId = insertEmailLog({
    event_type: "test",
    entity_id: null,
    recipient: to,
    cc: null,
    reply_to: env.replyTo,
    subject,
    body_preview: bodyPreview,
    status: "pending",
    error_message: null,
    provider_message_id: null,
    attempts: 0,
  });
  if (!env.enabled) {
    updateEmailLog(logId, { status: "skipped", error_message: "email_notifications_disabled" });
    return { ok: false, error: "notifications disabled" };
  }
  const transport = getSalesTransport(env);
  if (!transport) {
    updateEmailLog(logId, { status: "failed", error_message: "smtp_unconfigured", attempts: 1 });
    return { ok: false, error: "SMTP not configured" };
  }
  try {
    const info = await transport.sendMail({
      from: `"${env.fromName}" <${env.fromEmail}>`,
      to,
      replyTo: env.replyTo,
      subject,
      html,
      text,
    });
    updateEmailLog(logId, { status: "sent", provider_message_id: info.messageId || null, attempts: 1, sent_at: Date.now() });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    const msg = e?.message || String(e);
    updateEmailLog(logId, { status: "failed", error_message: msg, attempts: 1 });
    return { ok: false, error: msg };
  }
}

// ---------- Resend from a prior email_log row ----------
export async function resendFromLog(logId: number): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const row = getEmailLog(logId);
  if (!row) return { ok: false, error: "log_not_found" };

  // Re-render from the entity so any data corrections since the original send are picked up.
  let rendered: { subject: string; html: string; text: string } | null = null;
  const et = row.event_type as SalesEventType;
  if (et === "rfq_created" && row.entity_id) rendered = await renderRfqEmail(row.entity_id);
  else if (et === "quote_requested" && row.entity_id) rendered = await renderQuoteRequestEmail(row.entity_id);
  else if (et === "order_placed" && row.entity_id) rendered = await renderOrderEmail(row.entity_id);

  if (!rendered) {
    // fall back to the original subject/body preview so we can still resend "test" or missing-entity logs.
    rendered = {
      subject: row.subject,
      html: shellHtml(`<pre style="white-space:pre-wrap;font-family:inherit;">${escape(row.body_preview || "(no body captured)")}</pre>`, loadSalesEnv().siteUrl),
      text: row.body_preview || "(no body captured)",
    };
  }

  const env = loadSalesEnv();
  if (!env.enabled) {
    updateEmailLog(logId, { status: "skipped", error_message: "email_notifications_disabled" });
    return { ok: false, error: "notifications disabled" };
  }
  const transport = getSalesTransport(env);
  if (!transport) {
    updateEmailLog(logId, { attempts: (row.attempts || 0) + 1, status: "failed", error_message: "smtp_unconfigured" });
    return { ok: false, error: "SMTP not configured" };
  }
  try {
    const info = await transport.sendMail({
      from: `"${env.fromName}" <${env.fromEmail}>`,
      to: row.recipient,
      replyTo: row.reply_to || env.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    updateEmailLog(logId, {
      status: "sent",
      provider_message_id: info.messageId || null,
      attempts: (row.attempts || 0) + 1,
      sent_at: Date.now(),
      error_message: null,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    const msg = e?.message || String(e);
    updateEmailLog(logId, { attempts: (row.attempts || 0) + 1, status: "failed", error_message: msg });
    return { ok: false, error: msg };
  }
}

// =====================================================================
// R28 Session 3 — sendGenericSalesEmail
// Small, generic email helper used by auto-publish (and any future feature
// that wants to notify sales@narmadamobility.com without owning its own SMTP
// setup). Uses the same SMTP env + rate-limit bucket as the typed helpers.
// Never throws. Respects EMAIL_NOTIFICATIONS_ENABLED. Fire-and-forget from
// callers — do NOT `await`.
// =====================================================================
export interface GenericSalesEmailPayload {
  eventType: string;              // event_type column value (stored as-is)
  entityId?: number | null;       // optional entity id for cross-reference
  subject: string;
  text: string;
  html?: string;                  // optional; auto-wrapped from `text` if omitted
  to?: string;                    // override recipient; defaults to SALES_NOTIFY_EMAIL
}

export async function sendGenericSalesEmail(
  payload: GenericSalesEmailPayload,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  try {
    const env = loadSalesEnv();
    const to = payload.to || env.to;
    const subject = payload.subject;
    const text = payload.text;
    const html = payload.html || shellHtml(
      `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;color:#111827;">${escape(text)}</pre>`,
      env.siteUrl,
    );
    const bodyPreview = trim500(text);
    const logId = insertEmailLog({
      event_type: payload.eventType,
      entity_id: payload.entityId ?? null,
      recipient: to,
      cc: null,
      reply_to: env.replyTo,
      subject,
      body_preview: bodyPreview,
      status: "pending",
      error_message: null,
      provider_message_id: null,
      attempts: 0,
    });
    if (!env.enabled) {
      updateEmailLog(logId, { status: "skipped", error_message: "email_notifications_disabled" });
      return { ok: false, error: "notifications disabled" };
    }
    const transport = getSalesTransport(env);
    if (!transport) {
      updateEmailLog(logId, { status: "failed", error_message: "smtp_unconfigured", attempts: 1 });
      return { ok: false, error: "SMTP not configured" };
    }
    try {
      const info = await transport.sendMail({
        from: `"${env.fromName}" <${env.fromEmail}>`,
        to,
        replyTo: env.replyTo,
        subject,
        html,
        text,
      });
      updateEmailLog(logId, { status: "sent", provider_message_id: info.messageId || null, attempts: 1, sent_at: Date.now() });
      return { ok: true, messageId: info.messageId };
    } catch (e: any) {
      const msg = e?.message || String(e);
      updateEmailLog(logId, { status: "failed", error_message: msg, attempts: 1 });
      return { ok: false, error: msg };
    }
  } catch (e: any) {
    console.error("[email] sendGenericSalesEmail unexpected:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
