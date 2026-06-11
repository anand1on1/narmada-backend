/**
 * AiSensy WhatsApp service — Session C
 * All 9 live templates. Fire-and-forget: log errors, never throw to caller.
 * Uses AiSensy v2 API: POST https://backend.aisensy.com/campaign/t1/api/v2
 */
import { db } from "./storage";
import { notificationLog } from "@shared/schema";

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const AISENSY_API_KEY = process.env.AISENSY_API_KEY || "";

// Structured log so Render logs show whether a WhatsApp send was attempted and its outcome.
function logWa(template: string, phone: string, status: string) {
  console.log(`[whatsapp] template=${template} to=${phone} status=${status}`);
}

// Translate an AiSensy error body into an actionable message and emit an operator-facing
// console.warn. Returns the original body text if no special case matched.
function interpretAisensyError(body: string, campaignName: string): string {
  if (/No Plan active/i.test(body)) {
    console.warn("[whatsapp] PLAN INACTIVE — AiSensy refusing sends. Upgrade plan at app.aisensy.com");
    return "AISENSY_PLAN_INACTIVE: Upgrade plan at app.aisensy.com";
  }
  if (/Campaign does not exist/i.test(body)) {
    console.warn(`[whatsapp] CAMPAIGN MISSING: ${campaignName} — create it at app.aisensy.com → Campaigns → New`);
    return `AISENSY_CAMPAIGN_MISSING: Create campaign '${campaignName}' in AiSensy dashboard`;
  }
  return body;
}

// Retry helper — 3 attempts with exponential backoff. On non-2xx, the thrown message is
// already interpreted (plan/campaign) so callers and the notification log get an actionable string.
// On HTTP 200 returns the raw response body text — AiSensy can still report a soft failure
// (success:false / warnings / queued) inside a 200, so callers must inspect it.
async function postAisensy(payload: Record<string, unknown>, retries = 3): Promise<string> {
  const campaignName = String((payload as any).campaignName ?? "");
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(AISENSY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, apiKey: AISENSY_API_KEY }),
      });
      const body = await res.text().catch(() => "");
      if (!res.ok) {
        const interpreted = interpretAisensyError(body, campaignName);
        throw new Error(interpreted);
      }
      return body; // success (may still contain a soft-failure payload)
    } catch (e: any) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr!;
}

// AiSensy returns HTTP 200 even when the message won't actually be delivered (template not
// approved for the destination, destination not on the test-recipient list, plan/quota issues).
// Inspect the 200 body and downgrade the logged status so the Notification Log reflects reality.
function classifyAisensyResponse(raw: string): { status: "sent" | "queued" | "failed"; errorMsg?: string } {
  if (!raw) return { status: "sent" };
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* non-JSON body — fall through to text checks */ }

  if (parsed && typeof parsed === "object") {
    if (parsed.success === false) {
      return { status: "failed", errorMsg: String(parsed.error || parsed.message || "AiSensy success:false") };
    }
    const warnings = parsed.warnings ?? parsed.data?.warnings;
    if (Array.isArray(warnings) && warnings.length) {
      return { status: "queued", errorMsg: `AiSensy warnings: ${JSON.stringify(warnings).slice(0, 500)}` };
    }
    if (parsed.error) {
      return { status: "failed", errorMsg: String(parsed.error) };
    }
  }
  // Fall back to scanning the raw text for soft-failure signals.
  if (/"?success"?\s*:\s*false/i.test(raw)) return { status: "failed", errorMsg: raw.slice(0, 500) };
  if (/warning/i.test(raw)) return { status: "queued", errorMsg: raw.slice(0, 500) };
  if (/\bqueued\b/i.test(raw)) return { status: "queued" };
  if (/\berror\b/i.test(raw)) return { status: "failed", errorMsg: raw.slice(0, 500) };
  return { status: "sent" };
}

// Log to notification_log table. metaJson always carries the raw provider response (truncated
// to 4000 chars) for whatsapp rows so operators can see exactly what AiSensy returned.
function logNotification(
  channel: "whatsapp",
  recipient: string,
  eventKey: string,
  body: string,
  status: "sent" | "failed" | "queued",
  errorMsg?: string,
  metaJson?: string,
) {
  try {
    db.insert(notificationLog)
      .values({
        consignmentId: null,
        customerId: null,
        eventKey,
        channel,
        recipient,
        body,
        status,
        errorMsg: errorMsg || null,
        metaJson: metaJson ? metaJson.slice(0, 4000) : null,
        sentAt: Date.now(),
      } as any)
      .run();
  } catch (e: any) {
    console.error("[whatsapp] log error:", e?.message);
  }
}

// Shared success-path finalizer: classify the AiSensy 200 body, then log with the real status
// and the raw response in metaJson. Used by every send* function so behavior stays consistent.
function logAisensyResult(recipient: string, templateName: string, body: string, raw: string) {
  const { status, errorMsg } = classifyAisensyResponse(raw);
  logNotification("whatsapp", recipient, templateName, body, status, errorMsg, raw);
  return status;
}

// Normalize phone — ensure it is E.164 without leading +
function normalizePhone(phone: string): string {
  const stripped = phone.replace(/\D/g, "");
  // If starts with 0 (Indian local), replace with 91
  if (stripped.startsWith("0")) return "91" + stripped.slice(1);
  // If 10 digits, prepend 91
  if (stripped.length === 10) return "91" + stripped;
  return stripped;
}

// ============================================================
// 1. OTP (Authentication) — narmada_otp_customer
//    vars: {{1}} = otp code
// ============================================================
export async function sendOTP(phone: string, otp: string): Promise<void> {
  const templateName = "narmada_otp_customer";
  const normalized = normalizePhone(phone);
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [otp],
      source: "narmada-backend",
      media: {},
      // NOTE: Do NOT send a `buttons` array for OTP templates. AiSensy auto-infers
      // the Copy Code button from the approved template definition and uses
      // templateParams[0] as the code. An explicit buttons array causes silent
      // delivery failure on Meta's side even when AiSensy returns success:true.
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: "Customer" },
    });
    logAisensyResult(normalized, templateName, `OTP: ${otp}`, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendOTP failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, `OTP: ${otp}`, "failed", e?.message);
  }
}

// ============================================================
// 2. New RFQ Admin — narmada_new_rfq_admin_v2
//    vars: customerName, partsCount, rfqId
// ============================================================
export async function sendNewRFQAdmin(
  adminPhone: string,
  customerName: string,
  partsCount: number,
  rfqId: number,
): Promise<void> {
  const templateName = "narmada_new_rfq_admin_v2";
  const normalized = normalizePhone(adminPhone);
  const body = `New RFQ from ${customerName}, parts: ${partsCount}, ID: ${rfqId}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, String(partsCount), String(rfqId)],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: "Admin" },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendNewRFQAdmin failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 3. Quote Sent — narmada_quote_sent_customer
//    vars: customerName, quoteNo, pdfUrl
// ============================================================
export async function sendQuoteSent(
  phone: string,
  customerName: string,
  quoteNo: string,
  pdfUrl: string,
): Promise<void> {
  const templateName = "narmada_quote_sent_customer";
  const normalized = normalizePhone(phone);
  const body = `Quotation ${quoteNo} sent to ${customerName}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, quoteNo, pdfUrl],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendQuoteSent failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 4. PO Approved — narmada_po_approved_customer
//    vars: customerName, poNo
// ============================================================
export async function sendPOApproved(
  phone: string,
  customerName: string,
  poNo: string,
): Promise<void> {
  const templateName = "narmada_po_approved_customer";
  const normalized = normalizePhone(phone);
  const body = `PO ${poNo} approved for ${customerName}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, poNo],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendPOApproved failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 5. Payment Received — narmada_payment_received_customer
//    vars: customerName, amount, mode, date, ref, balance (6 vars)
// ============================================================
export async function sendPaymentReceived(
  phone: string,
  customerName: string,
  amount: string,
  mode: string,
  date: string,
  ref: string,
  balance: string,
): Promise<void> {
  const templateName = "narmada_payment_received_customer";
  const normalized = normalizePhone(phone);
  const body = `Payment ₹${amount} via ${mode} on ${date} received from ${customerName}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, amount, mode, date, ref, balance],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendPaymentReceived failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 6. Consignment Created — consignment_created_v2
//    vars: customerName, orderNo, items, dispatchDate (4 vars)
//    Buttons: Track Order
// ============================================================
export async function sendConsignmentCreated(
  phone: string,
  customerName: string,
  orderNo: string,
  items: string,
  dispatchDate: string,
): Promise<void> {
  const templateName = "consignment_created_v2";
  const normalized = normalizePhone(phone);
  const body = `Consignment ${orderNo} created for ${customerName}, dispatching ${dispatchDate}`;
  if (!normalized) { logWa(templateName, phone || "", "skipped-no-phone"); return; }
  if (!AISENSY_API_KEY || AISENSY_API_KEY === "skip") {
    logWa(templateName, normalized, "skipped-no-api-key");
    logNotification("whatsapp", normalized, templateName, body, "failed", "AISENSY_API_KEY not configured");
    return;
  }
  logWa(templateName, normalized, "attempt");
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, orderNo, items, dispatchDate],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    const finalStatus = logAisensyResult(normalized, templateName, body, raw);
    logWa(templateName, normalized, finalStatus);
  } catch (e: any) {
    console.error(`[whatsapp] sendConsignmentCreated failed for ${normalized}:`, e?.message);
    logWa(templateName, normalized, "failed");
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 7. Consignment In Transit — consignment_in_transit_v2
//    vars: customerName, orderNo, vehicle, docket, etaDate (5 vars)
//    Buttons: Track Shipment, Need Help
// ============================================================
export async function sendConsignmentInTransit(
  phone: string,
  customerName: string,
  orderNo: string,
  vehicle: string,
  docket: string,
  etaDate: string,
): Promise<void> {
  const templateName = "consignment_in_transit_v2";
  const normalized = normalizePhone(phone);
  const body = `Consignment ${orderNo} in transit via ${vehicle}, ETA ${etaDate}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, orderNo, vehicle, docket, etaDate],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendConsignmentInTransit failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 8. Out For Delivery — consignment_out_for_delivery_v2
//    vars: customerName, orderNo, driver, driverPhone (4 vars)
//    Buttons: Call Driver, Track Live
// ============================================================
export async function sendConsignmentOutForDelivery(
  phone: string,
  customerName: string,
  orderNo: string,
  driver: string,
  driverPhone: string,
): Promise<void> {
  const templateName = "consignment_out_for_delivery_v2";
  const normalized = normalizePhone(phone);
  const body = `Consignment ${orderNo} out for delivery to ${customerName}, driver: ${driver}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, orderNo, driver, driverPhone],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendConsignmentOutForDelivery failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}

// ============================================================
// 9. Consignment Delivered — consignment_delivered_v2
//    vars: customerName, orderNo, deliveredAt, receivedBy (4 vars)
//    Buttons: Confirm Receipt, Rate Service
// ============================================================
export async function sendConsignmentDelivered(
  phone: string,
  customerName: string,
  orderNo: string,
  deliveredAt: string,
  receivedBy: string,
): Promise<void> {
  const templateName = "consignment_delivered_v2";
  const normalized = normalizePhone(phone);
  const body = `Consignment ${orderNo} delivered to ${customerName}, received by ${receivedBy}`;
  try {
    const raw = await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [customerName, orderNo, deliveredAt, receivedBy],
      source: "narmada-backend",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: customerName },
    });
    logAisensyResult(normalized, templateName, body, raw);
  } catch (e: any) {
    console.error(`[whatsapp] sendConsignmentDelivered failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}
