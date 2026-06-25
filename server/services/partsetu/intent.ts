// PartSetu AI R27.24a — intent classifier.
// One Haiku call classifies the user's latest chat message into one of 7
// intents and pulls out part tokens / part numbers / specs. A deterministic
// regex classifier backs it up so the chat path never hard-depends on the LLM
// (parse failure, no API key, timeout all fall through to the heuristic).
import { callClaudeHaiku } from "../claude";
import { expandPartName, PART_KEYWORDS } from "./part-synonyms";

export type IntentKind =
  | "locked_vehicle_part"
  | "exploratory_part_search"
  | "cross_reference_lookup"
  | "spec_query"
  | "small_talk"
  | "image_request"
  | "price_query"
  | "multi_part_list";

export interface PartListEntry {
  rawName: string;
  tokens: string[];
  expandedTokens: string[];
}

export interface Intent {
  kind: IntentKind;
  partTokens: string[];
  partNumbers: string[];
  specs: { dia_mm?: number; teeth?: number; voltage?: number; bore?: string };
  bypassLock: boolean;
  partList?: PartListEntry[];
}

export interface SessionState {
  lockedCatalogId?: number | null;
  lockedVehicle?: string | null;
}

const SYSTEM = `You classify a customer's spare-parts chat message for an Indian commercial-truck parts assistant (Tata, Ashok Leyland, Eicher, BharatBenz).

Return STRICT JSON only — no prose, no markdown — with this exact shape:
{"kind":"<intent>","partTokens":["..."],"partNumbers":["..."],"specs":{"dia_mm":0,"teeth":0,"voltage":0,"bore":""},"bypassLock":false}

kind is exactly one of:
- locked_vehicle_part: asking for a part for the vehicle already identified/locked. e.g. "clutch plate chahiye", "isme water pump ka number", "brake pads for this truck"
- exploratory_part_search: searching across catalogs / not tied to the locked vehicle. e.g. "does anyone have a 430 dia clutch?", "which catalog stocks this turbo?", "any model has this filter"
- cross_reference_lookup: has an OEM/competitor part number to cross-reference. e.g. "wabco number for 264742300101", "503943700105 ka equivalent", any 10-14 digit number
- spec_query: asking about a specification/dimension. e.g. "what diameter is this clutch", "kitne teeth ka gear", "24 volt ya 12 volt"
- small_talk: greeting / thanks / unrelated. e.g. "hello", "thank you", "ok"
- image_request: asking to see a picture/diagram. e.g. "show me the image", "diagram bhejo", "photo dikhao"
- price_query: asking price/rate/cost. e.g. "price kya hai", "rate batao", "kitne ka hai", "₹"

partTokens: lowercase generic part words from the message (e.g. ["clutch","430","dia"]). Omit stopwords.
partNumbers: any 10-14 digit part numbers, digits only.
specs: numeric specs if stated (diameter mm, teeth count, voltage, bore string). Omit keys you cannot fill.
bypassLock: true ONLY for exploratory_part_search and cross_reference_lookup; false otherwise.

Examples:
"clutch plate chahiye" -> {"kind":"locked_vehicle_part","partTokens":["clutch","plate"],"partNumbers":[],"specs":{},"bypassLock":false}
"does anyone have a 430 dia clutch" -> {"kind":"exploratory_part_search","partTokens":["clutch","430","dia"],"partNumbers":[],"specs":{"dia_mm":430},"bypassLock":true}
"wabco equivalent of 264742300101" -> {"kind":"cross_reference_lookup","partTokens":[],"partNumbers":["264742300101"],"specs":{},"bypassLock":true}
"is gear ke kitne teeth" -> {"kind":"spec_query","partTokens":["gear"],"partNumbers":[],"specs":{"teeth":0},"bypassLock":false}
"price batao" -> {"kind":"price_query","partTokens":[],"partNumbers":[],"specs":{},"bypassLock":false}
"thanks" -> {"kind":"small_talk","partTokens":[],"partNumbers":[],"specs":{},"bypassLock":false}
"diagram dikhao" -> {"kind":"image_request","partTokens":[],"partNumbers":[],"specs":{},"bypassLock":false}`;

// Robustly pull the first balanced {...} object out of an LLM response.
function extractJsonObject(raw: string): any | null {
  if (!raw) return null;
  const text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "of", "for", "this", "that", "me", "ka", "ki", "ke",
  "hai", "chahiye", "batao", "do", "dikhao", "kya", "kaun", "konsa", "mera", "meri",
  "and", "or", "with", "to", "i", "you", "please", "plz", "need", "want", "want",
]);

function tokenize(message: string): string[] {
  return Array.from(new Set(
    message.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  ));
}

function extractPartNumbers(message: string): string[] {
  return Array.from(new Set((message.match(/\d{10,14}/g) || [])));
}

function extractSpecs(message: string): Intent["specs"] {
  const specs: Intent["specs"] = {};
  // diameter can appear either side of the keyword: "dia 430", "430 dia",
  // "430 mm". Try each form.
  const dia = message.match(/dia[\.\s]*(\d{2,4})|(\d{2,4})\s*dia|(\d{2,4})\s*mm/i);
  if (dia) specs.dia_mm = Number(dia[1] || dia[2] || dia[3]);
  const teeth = message.match(/(\d{1,3})\s*t(?:eeth)?\b/i);
  if (teeth) specs.teeth = Number(teeth[1]);
  const volt = message.match(/(\d{1,3})\s*v(?:olt)?\b/i);
  if (volt) specs.voltage = Number(volt[1]);
  return specs;
}

// Tokenize a single part-name segment (keeps order, drops stopwords).
function tokenizeSegment(seg: string): string[] {
  return seg.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Does a free-text segment name a part? True if any of its tokens is a known
// part keyword, or expandPartName maps it to a synonym set (more than itself).
function segmentIsPart(seg: string): boolean {
  const toks = tokenizeSegment(seg);
  if (!toks.length) return false;
  if (toks.some((t) => PART_KEYWORDS.has(t))) return true;
  const expanded = expandPartName(seg);
  return expanded.length > 1;
}

// R27.24a5 — deterministic multi-part-list detector. Returns the parsed list of
// distinct part queries when the message asks for 3+ parts, else null. No LLM.
export function extractMultiPartList(message: string): PartListEntry[] | null {
  const raw = String(message || "");
  if (!raw.trim()) return null;

  // Strip a leading lead-in clause before the first colon (e.g.
  // "OEM part numbers chahiye for: oil filter, ...") so it doesn't pollute the
  // first segment. Only if the colon is reasonably early.
  let body = raw;
  const colonIdx = raw.indexOf(":");
  if (colonIdx >= 0 && colonIdx < 60) body = raw.slice(colonIdx + 1);

  // Normalize list separators into commas: numbered "1." / "1)", " and ",
  // newlines and semicolons.
  const flattened = body
    .replace(/\b\d+\s*[\.\)]\s*/g, ",")
    .replace(/\s+and\s+/gi, ",")
    .replace(/[\n;]+/g, ",");

  const segments = flattened
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const entries: PartListEntry[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (!segmentIsPart(seg)) continue;
    const key = seg.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ rawName: seg, tokens: tokenizeSegment(seg), expandedTokens: expandPartName(seg) });
  }

  return entries.length >= 3 ? entries : null;
}

// Deterministic classifier — also the fallback when the LLM is unavailable.
export function classifyIntentHeuristic(message: string, state: SessionState): Intent {
  const m = String(message || "");
  const lower = m.toLowerCase();
  const partNumbers = extractPartNumbers(m);
  const partTokens = tokenize(m);
  const specs = extractSpecs(m);

  let kind: IntentKind;
  let bypassLock = false;
  if (partNumbers.length > 0) {
    kind = "cross_reference_lookup";
    bypassLock = true;
  } else if (/\b(does anyone|which catalog|any model has|show me catalogs|kisi (?:bhi )?model|sabhi catalog)\b/i.test(lower)) {
    kind = "exploratory_part_search";
    bypassLock = true;
  } else if (/(₹|price|rate|cost|kitne ka|daam|keemat)/i.test(lower)) {
    kind = "price_query";
  } else if (/\b(diagram|image|photo|picture|tasveer|dikhao|bhejo)\b/i.test(lower)) {
    kind = "image_request";
  } else if (Object.keys(specs).length > 0 || /\b(diameter|teeth|voltage|bore|spec|dimension)\b/i.test(lower)) {
    kind = "spec_query";
  } else if (/^\s*(hi|hello|hey|namaste|thanks|thank you|ok|okay|dhanyawad)\b/i.test(lower)) {
    kind = "small_talk";
  } else if (state.lockedCatalogId) {
    kind = "locked_vehicle_part";
  } else {
    kind = "exploratory_part_search";
  }
  return { kind, partTokens, partNumbers, specs, bypassLock };
}

export async function classifyIntent(message: string, sessionState: SessionState): Promise<Intent> {
  // R27.24a5 — deterministic multi-part-list short-circuit (no LLM). When the
  // user asks for 3+ distinct parts at once we route to a per-part search so
  // recall doesn't collapse from one combined FTS soup. bypassLock stays false:
  // the list is answered within the locked catalog.
  const partList = extractMultiPartList(message);
  if (partList) {
    const intent: Intent = {
      kind: "multi_part_list",
      partTokens: Array.from(new Set(partList.flatMap((p) => p.tokens))),
      partNumbers: extractPartNumbers(message),
      specs: {},
      bypassLock: false,
      partList,
    };
    console.log(`[partsetu] intent=multi_part_list bypass_lock=false parts=${partList.length} (deterministic)`);
    return intent;
  }

  const heuristic = classifyIntentHeuristic(message, sessionState);
  try {
    const ctx = `Locked vehicle: ${sessionState.lockedVehicle || "none"} (catalog ${sessionState.lockedCatalogId ?? "none"}).\nMessage: ${message}`;
    const res = await callClaudeHaiku(SYSTEM, [{ role: "user", content: ctx }, { role: "assistant", content: "{" }], 300, 0);
    if (res.ok && res.text) {
      const parsed = extractJsonObject(res.text.trim().startsWith("{") ? res.text : "{" + res.text);
      if (parsed && typeof parsed.kind === "string") {
        const validKinds: IntentKind[] = [
          "locked_vehicle_part", "exploratory_part_search", "cross_reference_lookup",
          "spec_query", "small_talk", "image_request", "price_query",
        ];
        const kind = (validKinds.includes(parsed.kind) ? parsed.kind : heuristic.kind) as IntentKind;
        const partTokens = Array.isArray(parsed.partTokens) ? parsed.partTokens.map(String).filter(Boolean) : heuristic.partTokens;
        const partNumbers = Array.isArray(parsed.partNumbers)
          ? parsed.partNumbers.map((n: any) => String(n).replace(/\D/g, "")).filter((n: string) => n.length >= 8)
          : heuristic.partNumbers;
        const specs = parsed.specs && typeof parsed.specs === "object" ? parsed.specs : heuristic.specs;
        // Always enforce the bypassLock contract regardless of what the LLM said.
        const bypassLock = kind === "exploratory_part_search" || kind === "cross_reference_lookup";
        const intent: Intent = {
          kind,
          partTokens: partTokens.length ? partTokens : heuristic.partTokens,
          partNumbers: partNumbers.length ? partNumbers : heuristic.partNumbers,
          specs,
          bypassLock,
        };
        console.log(`[partsetu] intent=${intent.kind} bypass_lock=${intent.bypassLock} tokens=${intent.partTokens.length} nums=${intent.partNumbers.length}`);
        return intent;
      }
    }
  } catch (e: any) {
    console.warn(`[partsetu] intent classify LLM failed, using heuristic: ${e?.message || e}`);
  }
  console.log(`[partsetu] intent=${heuristic.kind} bypass_lock=${heuristic.bypassLock} tokens=${heuristic.partTokens.length} nums=${heuristic.partNumbers.length} (heuristic)`);
  return heuristic;
}
