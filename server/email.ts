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
