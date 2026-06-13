// Email delivery via Resend. Falls back to console-only if RESEND_API_KEY is unset.
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.MAIL_FROM || "Narmada Mobility <onboarding@resend.dev>";
const TO_EMAIL = process.env.SALES_EMAIL || "sales@Narmadamobility.com";

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
