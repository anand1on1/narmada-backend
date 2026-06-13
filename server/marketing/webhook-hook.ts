// R26.4b Marketing Hub — AiSensy webhook → marketing_send_log bridge.
//
// The existing AiSensy webhook receiver (R26.2f, /api/aisensy/webhook) ignores delivery/read/
// status receipts (they were causing blank inbox rows). We do NOT change that behavior: this
// hook is a purely additive side-effect invoked from inside the receipt branch. When a receipt
// arrives carrying a message id that matches a marketing send_job's aisensy_message_id, we append
// a delivery/read/failed event to marketing_send_log so the campaign detail view can show it.
//
// Never throws — the webhook must always return 200 to AiSensy regardless of what we do here.
import { rawSqlite as sqlite } from "../storage";

// Map a raw AiSensy receipt topic/status to a normalized marketing_send_log event name.
// Returns null for topics we don't care about (so we don't log noise).
function mapReceiptEvent(topic: string): "delivered" | "read" | "failed" | null {
  const t = (topic || "").toLowerCase();
  if (t.includes("read")) return "read";
  if (t.includes("fail") || t.includes("reject")) return "failed";
  if (t.includes("deliver")) return "delivered";
  return null;
}

// Called from the AiSensy webhook receipt branch. Looks up the send_job by aisensy_message_id
// and, if found, appends an event row to marketing_send_log. Best-effort and silent on miss.
export function recordMarketingWhatsAppReceipt(messageId: string | null | undefined, topic: string): void {
  try {
    if (!messageId) return;
    const event = mapReceiptEvent(topic);
    if (!event) return;
    const job = sqlite
      .prepare(`SELECT id FROM marketing_send_jobs WHERE aisensy_message_id = ? LIMIT 1`)
      .get(String(messageId)) as { id: number } | undefined;
    if (!job) return; // not a marketing message — leave it to the existing handler
    sqlite
      .prepare(`INSERT INTO marketing_send_log (send_job_id, event, event_data, created_at) VALUES (?, ?, ?, ?)`)
      .run(job.id, event, JSON.stringify({ source: "aisensy_webhook", topic, message_id: String(messageId) }), Date.now());
    console.log(`[R26.4b mkt-receipt] logged ${event} for send_job=${job.id} msgId=${messageId}`);
  } catch (e: any) {
    console.error("[R26.4b mkt-receipt] failed:", e?.message || e);
  }
}
