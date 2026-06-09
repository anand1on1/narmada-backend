// Phase 4 — Email notification service using Brevo SMTP via nodemailer.
// If BREVO_SMTP_KEY is not set, all sends are silently skipped (logged as 'skipped').
import nodemailer from "nodemailer";
import * as v2 from "./storage-v2";

const SMTP_HOST = process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com";
const SMTP_PORT = parseInt(process.env.BREVO_SMTP_PORT || "587", 10);
const SMTP_USER = process.env.BREVO_SMTP_LOGIN || "";
const SMTP_PASS = process.env.BREVO_SMTP_KEY || "";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "sales@Narmadamobility.com";
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "Narmada Mobility";
const SITE_URL = process.env.SITE_URL || "https://narmadamobility.com";

if (!SMTP_PASS) {
  console.warn("[notifications] BREVO_SMTP_KEY not set — email sends will be skipped. Set it in Render env vars.");
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export interface NotificationContext {
  consignmentId?: number;
  customerId?: number;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  docket: string;
  origin: string;
  destination: string;
  status: string;
  dispatchDate?: string;
  etaDate?: string;
  deliveredDate?: string;
  trackingLink: string;
  invoiceNumber?: string;
  invoiceAmount?: string | number;
  bundlesCount?: number;
  carrier?: string;
}

export function buildTrackingLink(docket: string): string {
  return `${SITE_URL}/#/track-consignment/${docket}`;
}

export async function sendNotification(eventKey: string, ctx: NotificationContext): Promise<void> {
  let templates: any[] = [];
  try {
    templates = await v2.getTemplatesByEvent(eventKey);
  } catch (e: any) {
    console.error("[notifications] Failed to load templates:", e.message);
    return;
  }

  const vars: Record<string, string> = {
    customerName: ctx.customerName || "Customer",
    docket: ctx.docket,
    docketNumber: ctx.docket,
    origin: ctx.origin || "",
    destination: ctx.destination || "",
    status: ctx.status || "",
    dispatchDate: ctx.dispatchDate || "",
    etaDate: ctx.etaDate || "",
    deliveredDate: ctx.deliveredDate || "",
    trackingLink: ctx.trackingLink,
    invoiceNumber: ctx.invoiceNumber || "",
    invoiceAmount: ctx.invoiceAmount != null && ctx.invoiceAmount !== "" ? String(ctx.invoiceAmount) : "",
    bundlesCount: ctx.bundlesCount != null ? String(ctx.bundlesCount) : "",
    carrier: ctx.carrier || "",
  };

  for (const t of templates) {
    if (!t.enabled) continue;

    if (t.channel === "email") {
      if (!ctx.customerEmail) {
        await v2.logNotification({
          consignmentId: ctx.consignmentId ?? null,
          customerId: ctx.customerId ?? null,
          eventKey,
          channel: "email",
          recipient: "",
          subject: t.subject || "",
          body: "",
          status: "skipped",
          errorMsg: "no email on customer",
        });
        continue;
      }
      const subject = renderTemplate(t.subject || "Narmada Mobility Update", vars);
      const body = renderTemplate(t.body, vars);
      const tx = getTransporter();
      if (!tx) {
        await v2.logNotification({
          consignmentId: ctx.consignmentId ?? null,
          customerId: ctx.customerId ?? null,
          eventKey,
          channel: "email",
          recipient: ctx.customerEmail,
          subject,
          body,
          status: "skipped",
          errorMsg: "BREVO_SMTP_KEY not configured",
        });
        continue;
      }
      try {
        await tx.sendMail({
          from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
          to: ctx.customerEmail,
          subject,
          text: body,
          html: body.replace(/\n/g, "<br>"),
        });
        await v2.logNotification({
          consignmentId: ctx.consignmentId ?? null,
          customerId: ctx.customerId ?? null,
          eventKey,
          channel: "email",
          recipient: ctx.customerEmail,
          subject,
          body,
          status: "sent",
          errorMsg: null,
        });
      } catch (e: any) {
        console.error("[notifications] Email send failed:", e.message);
        await v2.logNotification({
          consignmentId: ctx.consignmentId ?? null,
          customerId: ctx.customerId ?? null,
          eventKey,
          channel: "email",
          recipient: ctx.customerEmail,
          subject,
          body,
          status: "failed",
          errorMsg: e.message,
        });
      }
    } else if (t.channel === "whatsapp") {
      // WhatsApp API not configured yet (Phase 5). Log as skipped.
      const body = renderTemplate(t.body, vars);
      await v2.logNotification({
        consignmentId: ctx.consignmentId ?? null,
        customerId: ctx.customerId ?? null,
        eventKey,
        channel: "whatsapp",
        recipient: ctx.customerPhone || "",
        subject: null,
        body,
        status: "skipped",
        errorMsg: ctx.customerPhone
          ? "WhatsApp API not configured (use Send via WhatsApp button)"
          : "no phone on customer",
      });
    }
  }
}
