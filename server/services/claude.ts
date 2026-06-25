// PartSetu AI v1 — Claude integration.
// Haiku 3.5 for text Q&A, Sonnet 3.5 for image part identification (vision).
// Reads CLAUDE_API_KEY (falls back to ANTHROPIC_API_KEY). When unconfigured the
// callers degrade gracefully ("AI temporarily unavailable") instead of throwing.
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";

// Safe, currently-available model ids. Overridable via env without a redeploy.
// Accept both PARTSETU_* and CLAUDE_* naming for operator convenience.
const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || process.env.PARTSETU_HAIKU_MODEL || "claude-haiku-4-5";
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || process.env.PARTSETU_SONNET_MODEL || "claude-sonnet-4-5";
console.log(`[PartSetu Claude] init haiku=${HAIKU_MODEL} sonnet=${SONNET_MODEL} key=${process.env.CLAUDE_API_KEY ? "set" : "missing"}`);

// Approx public list prices (USD / 1M tokens) for usage cost accounting only.
const PRICE: Record<string, { in: number; out: number }> = {
  [HAIKU_MODEL]: { in: 0.8, out: 4 },
  [SONNET_MODEL]: { in: 3, out: 15 },
};

console.log(`[PartSetu Claude] mode: ${CLAUDE_API_KEY && CLAUDE_API_KEY !== "skip" ? "LIVE" : "DISABLED (no CLAUDE_API_KEY)"}`);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: CLAUDE_API_KEY });
  return _client;
}

export function isPartSetuClaudeConfigured(): boolean {
  return !!(CLAUDE_API_KEY && CLAUDE_API_KEY !== "skip");
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function costFor(model: string, inTok: number, outTok: number): number {
  const p = PRICE[model] || { in: 1, out: 5 };
  return +(((inTok * p.in) + (outTok * p.out)) / 1_000_000).toFixed(6);
}

const UNAVAILABLE = "PartSetu AI is temporarily unavailable. Please try again shortly, or contact our team at sales@Narmadamobility.com.";

type Msg = { role: "user" | "assistant"; content: any };

// Single retry on 429 / 5xx with linear backoff — never an infinite loop.
async function callWithRetry(model: string, system: string, messages: Msg[], maxTokens: number, temperature = 0.2): Promise<ClaudeResult> {
  const base: Omit<ClaudeResult, "ok" | "text"> = {
    model, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0,
  };
  if (!isPartSetuClaudeConfigured()) {
    return { ...base, ok: false, text: UNAVAILABLE, error: "CLAUDE_API_KEY not configured" };
  }
  const started = Date.now();
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(800);
    try {
      const resp = await getClient().messages.create({
        model, max_tokens: maxTokens, temperature, system, messages: messages as any,
      });
      const text = resp.content?.[0]?.type === "text" ? (resp.content[0] as any).text : "";
      const inTok = resp.usage?.input_tokens ?? 0;
      const outTok = resp.usage?.output_tokens ?? 0;
      return {
        ok: true, text: String(text || ""), model,
        inputTokens: inTok, outputTokens: outTok,
        costUsd: costFor(model, inTok, outTok),
        latencyMs: Date.now() - started,
      };
    } catch (e: any) {
      lastErr = e;
      const status = e?.status || e?.statusCode || 0;
      const retryable = status === 429 || (status >= 500 && status < 600);
      console.error(`[PartSetu Claude] ${model} error (attempt ${attempt + 1}, status ${status}):`, e?.message || e);
      if (!retryable) break;
    }
  }
  return { ...base, ok: false, text: UNAVAILABLE, latencyMs: Date.now() - started, error: lastErr?.message || "Claude call failed" };
}

export async function callClaudeHaiku(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 1024,
  temperature = 0.2,
): Promise<ClaudeResult> {
  return callWithRetry(HAIKU_MODEL, systemPrompt, messages as Msg[], maxTokens, temperature);
}

// PartSetu v1.4 — text-only Sonnet caller for ingest enrichment (profile/category/spec
// extraction), lessons parsing, and chat-side classification where Haiku is too weak.
export async function callClaudeSonnet(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens = 2048,
): Promise<ClaudeResult> {
  return callWithRetry(SONNET_MODEL, systemPrompt, messages as Msg[], maxTokens);
}

export async function callClaudeSonnetVision(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  maxTokens = 1024,
): Promise<ClaudeResult> {
  const messages: Msg[] = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      { type: "text", text: userText },
    ],
  }];
  return callWithRetry(SONNET_MODEL, systemPrompt, messages, maxTokens);
}

// R27.23 — cheap Haiku vision caller for RC-book / owner's-manual extraction
// (structured JSON only). Uses the env-configured Haiku model.
export async function callClaudeHaikuVision(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  maxTokens = 512,
): Promise<ClaudeResult> {
  const messages: Msg[] = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      { type: "text", text: userText },
    ],
  }];
  return callWithRetry(HAIKU_MODEL, systemPrompt, messages, maxTokens);
}
