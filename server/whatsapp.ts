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

// Retry helper — 3 attempts with exponential backoff
async function postAisensy(payload: Record<string, unknown>, retries = 3): Promise<void> {
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
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`AiSensy HTTP ${res.status}: ${body}`);
      }
      return; // success
    } catch (e: any) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastErr!;
}

// Log to notification_log table
function logNotification(
  channel: "whatsapp",
  recipient: string,
  eventKey: string,
  body: string,
  status: "sent" | "failed",
  errorMsg?: string,
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
        sentAt: Date.now(),
      })
      .run();
  } catch (e: any) {
    console.error("[whatsapp] log error:", e?.message);
  }
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
    await postAisensy({
      campaignName: templateName,
      destination: normalized,
      userName: "Narmada Mobility",
      templateParams: [otp],
      source: "narmada-backend",
      media: {},
      buttons: [{ type: "COPY_CODE", index: 0, copy_code: otp }],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: "Customer" },
    });
    logNotification("whatsapp", normalized, templateName, `OTP: ${otp}`, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logWa(templateName, normalized, "sent");
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
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
    await postAisensy({
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
    logNotification("whatsapp", normalized, templateName, body, "sent");
  } catch (e: any) {
    console.error(`[whatsapp] sendConsignmentDelivered failed for ${normalized}:`, e?.message);
    logNotification("whatsapp", normalized, templateName, body, "failed", e?.message);
  }
}
