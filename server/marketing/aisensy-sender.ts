// R26.4b Marketing Hub — AiSensy WhatsApp sender for marketing campaigns.
//
// This is a thin marketing-specific adapter over the AiSensy v2 campaign API. It does NOT
// modify the existing transactional sender in server/whatsapp.ts (which is private + fire-and-
// forget and exposes no message_id). Marketing needs the returned AiSensy message id so the
// webhook hook (R26.4b) can correlate delivery/read receipts back to a send_job — so we call
// the same documented endpoint directly here and parse the id out of the 200 body.
//
// Endpoint + payload shape mirror server/whatsapp.ts exactly so behavior stays consistent with
// the proven transactional path. AiSensy returns HTTP 200 even on soft failures (success:false /
// warnings), so we classify the body rather than trusting the status code.
const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const AISENSY_API_KEY = process.env.AISENSY_API_KEY || "";

export interface AisensyMarketingSend {
  templateName: string; // AiSensy campaign name (1:1 with template by default)
  phone: string; // recipient phone (any format — normalized here)
  userName?: string | null;
  templateParams: string[]; // resolved {{1}}..{{n}} values, in order
  mediaUrl?: string | null; // PDF/image URL for document/image header templates
  mediaFilename?: string | null;
}

export interface AisensyMarketingResult {
  status: "sent" | "queued" | "failed";
  messageId: string | null;
  error?: string;
  raw?: string;
}

// Normalize to AiSensy's expected destination format (E.164 digits, no leading +).
// Mirrors normalizePhone() in server/whatsapp.ts so marketing + transactional agree.
function normalizePhone(phone: string): string {
  const stripped = String(phone || "").replace(/\D/g, "");
  if (stripped.startsWith("0")) return "91" + stripped.slice(1);
  if (stripped.length === 10) return "91" + stripped;
  return stripped;
}

// AiSensy returns HTTP 200 even when a message won't be delivered. Inspect the body and
// downgrade the reported status accordingly. Mirrors classifyAisensyResponse in whatsapp.ts.
function classify(raw: string): { status: "sent" | "queued" | "failed"; error?: string } {
  if (!raw) return { status: "sent" };
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* non-JSON body — fall through to text checks */
  }
  if (parsed && typeof parsed === "object") {
    if (parsed.success === false) {
      return { status: "failed", error: String(parsed.error || parsed.message || "AiSensy success:false") };
    }
    const warnings = parsed.warnings ?? parsed.data?.warnings;
    if (Array.isArray(warnings) && warnings.length) {
      return { status: "queued", error: `AiSensy warnings: ${JSON.stringify(warnings).slice(0, 500)}` };
    }
    if (parsed.error) return { status: "failed", error: String(parsed.error) };
  }
  if (/"?success"?\s*:\s*false/i.test(raw)) return { status: "failed", error: raw.slice(0, 500) };
  if (/warning/i.test(raw)) return { status: "queued", error: raw.slice(0, 500) };
  if (/\bqueued\b/i.test(raw)) return { status: "queued" };
  if (/\berror\b/i.test(raw)) return { status: "failed", error: raw.slice(0, 500) };
  return { status: "sent" };
}

// Best-effort extraction of the AiSensy message id from a 200 body. AiSensy is inconsistent
// across plans (messageId / message_id / data.id / messages[0].id), so try the common shapes.
function extractMessageId(raw: string): string | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return (
      p?.messageId ||
      p?.message_id ||
      p?.data?.messageId ||
      p?.data?.message_id ||
      p?.data?.id ||
      (Array.isArray(p?.messages) && p.messages[0]?.id) ||
      p?.id ||
      null
    );
  } catch {
    return null;
  }
}

// Send one marketing WhatsApp template message via AiSensy. Never throws — resolves to a
// status + (best-effort) message id so the runner can record the outcome on the send_job.
export async function sendAisensyMarketing(p: AisensyMarketingSend): Promise<AisensyMarketingResult> {
  const templateName = p.templateName;
  const destination = normalizePhone(p.phone);
  const params = (p.templateParams || []).map((v) => String(v ?? ""));

  if (!AISENSY_API_KEY || AISENSY_API_KEY === "skip") {
    console.error(`[R26.4b aisensy-mkt] FAILED template=${templateName} phone=${destination} reason=AISENSY_API_KEY not configured`);
    return { status: "failed", messageId: null, error: "AISENSY_API_KEY not configured" };
  }
  if (!destination) {
    return { status: "failed", messageId: null, error: "no phone number" };
  }

  const payload: Record<string, unknown> = {
    apiKey: AISENSY_API_KEY,
    campaignName: templateName,
    destination,
    userName: p.userName || "Narmada Mobility",
    templateParams: params,
    source: "narmada-marketing",
    buttons: [],
    carouselCards: [],
    location: {},
    attributes: {},
    paramsFallbackValue: { FirstName: p.userName || "Customer" },
  };
  // Document/image header templates require a media URL.
  if (p.mediaUrl) {
    payload.media = { url: p.mediaUrl, filename: p.mediaFilename || "attachment" };
  } else {
    payload.media = {};
  }

  console.log(`[R26.4b aisensy-mkt] sending template=${templateName} phone=${destination} params=${JSON.stringify(params)} media=${p.mediaUrl ? "yes" : "no"}`);

  try {
    const res = await fetch(AISENSY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      console.error(`[R26.4b aisensy-mkt] HTTP ${res.status} template=${templateName} phone=${destination} body=${raw.slice(0, 400)}`);
      return { status: "failed", messageId: null, error: raw.slice(0, 500) || `HTTP ${res.status}`, raw };
    }
    const c = classify(raw);
    const messageId = extractMessageId(raw);
    console.log(`[R26.4b aisensy-mkt] result template=${templateName} phone=${destination} status=${c.status} msgId=${messageId || "?"}`);
    return { status: c.status, messageId, error: c.error, raw };
  } catch (e: any) {
    console.error(`[R26.4b aisensy-mkt] threw template=${templateName} phone=${destination}: ${e?.message || e}`);
    return { status: "failed", messageId: null, error: e?.message || String(e) };
  }
}
