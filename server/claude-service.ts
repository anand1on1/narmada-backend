/**
 * Claude Vision service — Session C
 * Extracts parts from images, PDFs, and Excel files.
 * Also provides chat reply for customer assistant.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || "";
const MODEL = "claude-sonnet-4-5"; // claude-sonnet-4 maps to this

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: CLAUDE_API_KEY });
  }
  return _client;
}

export interface ParsedPart {
  part_number: string | null;
  name: string;
  qty: number;
}

const PARTS_EXTRACTION_SYSTEM = `You are a parts extraction assistant for an automotive parts company.
Extract all parts/products from the provided document or image.
Return ONLY valid JSON array — no explanations, no markdown fences.
Each item: {"part_number": "string or null", "name": "string", "qty": number}
If part number is not visible, set it to null.
If quantity is not visible, default to 1.`;

/**
 * Extract parts from an image file (JPG/PNG/etc)
 */
export async function extractPartsFromImage(imagePath: string): Promise<ParsedPart[]> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") {
    console.warn("[claude] API key not set — skipping image extraction");
    return [];
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mediaTypeMap: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const mediaType = mediaTypeMap[ext] || "image/jpeg";

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: PARTS_EXTRACTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: "Extract all parts and quantities from this image. Return JSON array only.",
            },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parsePartsJSON(text);
  } catch (e: any) {
    console.error("[claude] extractPartsFromImage error:", e?.message);
    return [];
  }
}

/**
 * Extract parts from a PDF file using Claude Vision
 * Reads PDF as binary and sends as base64
 */
export async function extractPartsFromPdf(pdfPath: string): Promise<ParsedPart[]> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") {
    console.warn("[claude] API key not set — skipping PDF extraction");
    return [];
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const base64 = pdfBuffer.toString("base64");

  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: PARTS_EXTRACTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            } as any,
            {
              type: "text",
              text: "Extract all parts and quantities from this PDF. Return JSON array only.",
            },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    return parsePartsJSON(text);
  } catch (e: any) {
    console.error("[claude] extractPartsFromPdf error:", e?.message);
    return [];
  }
}

/**
 * Extract parts from an Excel file (.xlsx / .xls / .csv)
 * Uses xlsx library directly — no Claude needed.
 * Heuristically finds columns for part number, name, qty.
 */
export async function extractPartsFromExcel(xlsxPath: string): Promise<ParsedPart[]> {
  try {
    const workbook = XLSX.readFile(xlsxPath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    }) as string[][];

    if (rows.length < 2) return [];

    // Find header row (first row with content)
    const headerRow = rows[0].map((h) => String(h).toLowerCase().trim());

    // Map columns
    const partNumCol = headerRow.findIndex((h) =>
      /part.?num|part.?no|partno|part_number|item.?no/i.test(h),
    );
    const nameCol = headerRow.findIndex((h) =>
      /name|description|desc|product|item/i.test(h),
    );
    const qtyCol = headerRow.findIndex((h) =>
      /qty|quantity|count|nos|pcs/i.test(h),
    );

    const results: ParsedPart[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = nameCol >= 0 ? String(row[nameCol] || "").trim() : "";
      if (!name) continue;

      const partNumber =
        partNumCol >= 0 ? String(row[partNumCol] || "").trim() || null : null;
      const qtyRaw = qtyCol >= 0 ? row[qtyCol] : null;
      const qty = qtyRaw ? parseFloat(String(qtyRaw)) || 1 : 1;

      results.push({ part_number: partNumber, name, qty });
    }

    return results;
  } catch (e: any) {
    console.error("[claude] extractPartsFromExcel error:", e?.message);
    return [];
  }
}

/**
 * Chat reply using Claude — returns text response
 * history: array of {role: "user"|"assistant", content: string}
 * customerContext: structured account data block injected into the system prompt so
 *   Claude can only answer about this customer's own data (Bug 5 scope restriction).
 */
export async function chatReply(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
  customerContext?: string,
): Promise<string> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") {
    return "I'm here to help! Our customer support team will be in touch shortly.";
  }

  const systemPrompt = `You are a customer support assistant for Narmada Mobility's B2B spare parts portal. You answer ONLY about the customer's own account data shown below.

Rules:
- If the question is about balance, invoices, ledger, consignments, RFQs, or quotes → answer using the data block below.
- If the question is about anything else (general knowledge, other customers, pricing of products they haven't ordered, recommendations, opinions, off-topic chat) → reply EXACTLY: 'I can only help with questions about your account — balance, invoices, ledger, consignments, RFQs, and quotes. For other queries please contact our team at sales@narmadamobility.com'
- Never invent numbers or facts. If the answer isn't in the data block, say you don't have that information.
- Keep responses under 3 sentences when possible.

CUSTOMER DATA:
${customerContext || "(no account data available)"}`.trim();

  try {
    const client = getClient();
    const messages = [
      ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: message },
    ];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.2, // low temperature for predictable scope adherence
      system: systemPrompt,
      messages,
    });

    return response.content[0].type === "text" ? response.content[0].text : "";
  } catch (e: any) {
    console.error("[claude] chatReply error:", e?.message);
    return "I'm sorry, I'm having trouble responding right now. Please try again or contact our support team.";
  }
}

// ============================================================
// R10 — Full customer-PO extraction (header + per-item rate/brand)
// The legacy extractPartsFromPdf/Image return only {part_number,name,qty}.
// This richer extractor also pulls customer_po_number, po_date and per-line
// customer_rate (a.k.a. Rate / Unit Price / MRP / Net Rate / Per Unit on Indian POs).
// ============================================================
export interface ParsedCustomerPO {
  customer_name: string | null;
  customer_po_number: string | null;
  po_date: string | null;
  items: Array<{
    part_number: string | null;
    brand: string | null;
    description: string | null;
    qty: number;
    customer_rate: number | null;
  }>;
}

const CUSTOMER_PO_SYSTEM = `You extract a customer Purchase Order from an automotive (truck/bus) spare-parts document or image (often Indian POs).
Return ONLY valid JSON — no explanations, no markdown fences. Use this exact shape:
{"customer_name": string|null, "customer_po_number": string|null, "po_date": string|null,
 "items": [{"part_number": string|null, "brand": string|null, "description": string|null, "qty": number, "customer_rate": number|null}]}

Rules:
- customer_po_number: the buyer's PO number / order number printed on the document (labels like "PO No", "Purchase Order No", "Order No", "P.O. #").
- po_date: the PO date if shown; return as ISO yyyy-mm-dd when possible, else the raw string.
- For each line, customer_rate is the PER-UNIT price the customer is paying. It may be labelled "Rate", "Unit Price", "Net Rate", "Per Unit", "MRP", or "Price". Pick the per-unit rate (not the line total/amount). If only a line total and qty are shown, divide to get the per-unit rate.
- Strip currency symbols and thousands separators from numbers (₹, Rs, commas). customer_rate and qty must be plain numbers. If a value is not visible, use null (qty defaults to 1).
- brand: the part brand/make if shown (e.g. TATA, Bosch, Lucas), else null.
- Output JSON ONLY.`;

function parseRateNumber(raw: any): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[₹$]|rs\.?/gi, "").replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  const parsed = isFinite(n) ? n : null;
  console.log(`[po-parse] rate raw=${JSON.stringify(raw)} parsed=${parsed}`);
  return parsed;
}

function normalizeParsedCustomerPO(obj: any): ParsedCustomerPO {
  const itemsRaw = Array.isArray(obj?.items) ? obj.items : [];
  return {
    customer_name: obj?.customer_name ? String(obj.customer_name) : null,
    customer_po_number: obj?.customer_po_number ? String(obj.customer_po_number) : null,
    po_date: obj?.po_date ? String(obj.po_date) : null,
    items: itemsRaw.map((it: any) => ({
      part_number: it?.part_number ?? it?.partNumber ?? null,
      brand: it?.brand ?? null,
      description: it?.description ?? it?.name ?? null,
      qty: Number(it?.qty ?? it?.quantity ?? 1) || 1,
      customer_rate: parseRateNumber(it?.customer_rate ?? it?.rate ?? it?.unit_price ?? it?.mrp),
    })),
  };
}

export async function extractCustomerPOFromImage(imagePath: string): Promise<ParsedCustomerPO | null> {
  if (!isClaudeConfigured()) return null;
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mediaTypeMap: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
  };
  const mediaType = mediaTypeMap[ext] || "image/jpeg";
  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: CUSTOMER_PO_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Extract the purchase order header and line items (with per-unit customer rate and brand). Return JSON object only." },
        ],
      }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    return normalizeParsedCustomerPO(JSON.parse(cleaned));
  } catch (e: any) {
    console.error("[claude] extractCustomerPOFromImage error:", e?.message);
    return null;
  }
}

export async function extractCustomerPOFromPdf(pdfPath: string): Promise<ParsedCustomerPO | null> {
  if (!isClaudeConfigured()) return null;
  const pdfBuffer = fs.readFileSync(pdfPath);
  const base64 = pdfBuffer.toString("base64");
  try {
    const client = getClient();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: CUSTOMER_PO_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as any,
          { type: "text", text: "Extract the purchase order header and line items (with per-unit customer rate and brand). Return JSON object only." },
        ],
      }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    return normalizeParsedCustomerPO(JSON.parse(cleaned));
  } catch (e: any) {
    console.error("[claude] extractCustomerPOFromPdf error:", e?.message);
    return null;
  }
}

// Helper: parse JSON array from Claude response text
function parsePartsJSON(text: string): ParsedPart[] {
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      part_number: item.part_number || item.partNumber || null,
      name: String(item.name || item.description || ""),
      qty: Number(item.qty || item.quantity || 1),
    }));
  } catch (e: any) {
    console.error("[claude] JSON parse error:", e?.message, "raw:", text.slice(0, 200));
    return [];
  }
}

export interface GeneratedPost {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  metaTitle: string;
  metaDescription: string;
}

/**
 * Generate a blog/spotlight draft from a short topic prompt.
 * Returns null when the API key is not configured so the caller can surface a clear message.
 */
export async function generateBlogPost(
  topic: string,
  type: "blog" | "spotlight" = "blog",
): Promise<GeneratedPost | null> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") return null;
  const system = `You are an SEO content writer for Narmada Mobility, an automotive (commercial vehicle / truck & bus) spare-parts supplier in India.
Write a ${type === "spotlight" ? "product spotlight" : "blog article"} for the given topic.
Return ONLY valid JSON (no markdown fences) with keys:
{"title": string, "slug": string (lowercase-hyphenated), "excerpt": string (<=160 chars),
 "content": string (clean HTML using <h2>/<p>/<ul> — 400-700 words), "metaTitle": string (<=60 chars),
 "metaDescription": string (<=155 chars)}`;
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: `Topic: ${topic}` }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    const p = JSON.parse(cleaned);
    const slugify = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return {
      title: String(p.title || topic),
      slug: slugify(p.slug || p.title || topic),
      excerpt: String(p.excerpt || ""),
      content: String(p.content || ""),
      metaTitle: String(p.metaTitle || p.title || topic),
      metaDescription: String(p.metaDescription || p.excerpt || ""),
    };
  } catch (e: any) {
    console.error("[claude] generateBlogPost error:", e?.message);
    return null;
  }
}

// ============================================================
// Round 3: AI-driven natural-language editor for quotation line items
// ============================================================
export interface AiQuoteItem {
  lineNo?: number;
  partNumber?: string | null;
  productName: string;
  hsn?: string | null;
  brand?: string | null;
  qty?: number;
  mrp?: number;
  discount?: number;
  gstPct?: number;
}

const QUOTE_EDIT_SYSTEM = `You are a quotation editor for Narmada Mobility, an automotive truck/bus spare-parts supplier in India.
The user will give you a natural-language instruction and the CURRENT line items array of a quotation.
Apply the instruction and return ONLY a JSON object with this exact shape:
{"items": [<modified items in the same schema>], "explanation": "one short sentence describing what you changed"}

Schema for each item: {"lineNo": number, "partNumber": string|null, "productName": string,
  "hsn": string|null, "brand": string|null, "qty": number, "mrp": number, "discount": number, "gstPct": number}

Rules:
- Preserve any field the user did not change.
- The "rate"/"price"/"unit rate"/"selling rate" of a line IS the "mrp" field. When the user asks to "fill the rates", "fill missing rates", "add rates", "quote rates", or "price the items", you MUST write the numeric price into the "mrp" field of EACH line. Never invent a separate "rate"/"price" key — always use "mrp".
- For "fill the/missing rates": estimate a reasonable Indian-market rate (INR) for each line from the productName/brand/partNumber and put it in "mrp". Only fill lines whose mrp is missing/0 unless told to overwrite all. Never leave a line at mrp=0 when the user asked to fill rates.
- Discount and gstPct are PERCENTAGES (0-100), not multipliers.
- For "decrease/increase rates by X%": adjust mrp (not discount).
- For "fill missing HSN codes": apply common Indian automotive HSN codes (87089900 = motor-vehicle parts general, 40169990 = rubber, 84212300 = filters, 73181500 = bolts, 85114000 = starters/alternators, 84099991 = engine parts, 87083000 = brakes).
- For "set GST to 18%" or similar: change gstPct only.
- Renumber lineNo sequentially 1..N at the end.
- If the instruction is unclear or unsafe (e.g. "delete all"), return items unchanged with explanation describing why.
- Output JSON ONLY — no markdown fences, no commentary.`;

export async function editQuotationItems(
  instruction: string,
  items: AiQuoteItem[],
  context?: { customerName?: string; companyName?: string; currency?: string },
): Promise<{ items: AiQuoteItem[]; explanation: string; ok: boolean; error?: string }> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") {
    return { items, explanation: "", ok: false, error: "Claude API key not configured (set CLAUDE_API_KEY)" };
  }
  if (!instruction || !instruction.trim()) {
    return { items, explanation: "", ok: false, error: "Empty instruction" };
  }
  const userMsg = `Instruction: ${instruction.trim()}
Customer: ${context?.customerName || "—"}
Currency: ${context?.currency || "INR"}

Current items (JSON):
${JSON.stringify(items, null, 2)}`;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: QUOTE_EDIT_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    console.log(`[R26.2d ai-quote] raw AI text (first 600 chars):`, text.slice(0, 600));
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.items)) {
      console.warn(`[R26.2d ai-quote] AI did not return an items array. parsed=`, JSON.stringify(parsed).slice(0, 300));
      return { items, explanation: "", ok: false, error: "Claude did not return a valid items array" };
    }
    // Coerce/validate numeric fields and trim strings.
    // R26.2d: the AI sometimes emits the price under a synonym key ("rate", "price",
    // "unitRate", "unitPrice", "sellingRate") instead of "mrp" — especially for
    // "fill the rates" prompts. Accept any of those as the mrp value so the rate
    // actually lands in the field the frontend reads, instead of silently becoming 0.
    const pickRate = (it: any): number => {
      const candidates = [it.mrp, it.rate, it.price, it.unitRate, it.unit_rate, it.unitPrice, it.unit_price, it.sellingRate, it.selling_rate];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return Number(it.mrp ?? 0) || 0;
    };
    const cleanItems: AiQuoteItem[] = parsed.items.map((it: any, idx: number) => ({
      lineNo: Number(it.lineNo ?? idx + 1),
      partNumber: it.partNumber == null ? null : String(it.partNumber),
      productName: String(it.productName || ""),
      hsn: it.hsn == null ? null : String(it.hsn),
      brand: it.brand == null ? null : String(it.brand),
      qty: Number(it.qty ?? 1),
      mrp: pickRate(it),
      discount: Number(it.discount ?? 0),
      gstPct: Number(it.gstPct ?? 18),
    }));
    // Renumber to be safe
    cleanItems.forEach((it, i) => { it.lineNo = i + 1; });
    const filledCount = cleanItems.filter((it) => (it.mrp ?? 0) > 0).length;
    console.log(`[R26.2d ai-quote] parsed ${cleanItems.length} items, ${filledCount} with mrp>0. rates=`,
      JSON.stringify(cleanItems.map((it) => ({ lineNo: it.lineNo, mrp: it.mrp }))));
    return {
      items: cleanItems,
      explanation: String(parsed.explanation || ""),
      ok: true,
    };
  } catch (e: any) {
    console.error("[R26.2d ai-quote] editQuotationItems error:", e?.message, e?.stack?.split("\n").slice(0, 3).join(" | "));
    return { items, explanation: "", ok: false, error: e?.message || "Claude call failed" };
  }
}

// =====================================================================
// R4.4 / R5.4 / R7.2 — generic Claude helpers
// =====================================================================

export function isClaudeConfigured(): boolean {
  return !!(CLAUDE_API_KEY && CLAUDE_API_KEY !== "skip");
}

// Generic completion that returns parsed JSON (or null). Strips markdown fences.
export async function claudeJSON<T = any>(system: string, userMsg: string, maxTokens = 2048): Promise<T | null> {
  if (!isClaudeConfigured()) return null;
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL, max_tokens: maxTokens, temperature: 0.1,
      system, messages: [{ role: "user", content: userMsg }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```(?:json)?\n?/gi, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (e: any) {
    console.error("[claude] claudeJSON error:", e?.message);
    return null;
  }
}

// Generic plain-text completion (for outreach drafting).
export async function claudeText(system: string, userMsg: string, maxTokens = 1024): Promise<string | null> {
  if (!isClaudeConfigured()) return null;
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL, max_tokens: maxTokens, temperature: 0.4,
      system, messages: [{ role: "user", content: userMsg }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text.trim() : null;
  } catch (e: any) {
    console.error("[claude] claudeText error:", e?.message);
    return null;
  }
}

// R4.4 — translate NL question to a SELECT-only SQL against known tables.
const LEDGER_NL_SYSTEM = `You translate a natural-language business question into a single SQLite SELECT query.
You may ONLY query these tables and columns:
- customers(id, name, phone, email, city, state, gst_number, credit_limit_inr, payment_terms_days)
- ledger_entries(id, customer_id, entry_date, voucher_type, voucher_no, description, debit_inr, credit_inr, balance_inr)
- payment_records(id, customer_id, amount_inr, payment_mode, payment_date, reference_no, notes)
- quotations(id, quote_no, customer_id, status, grand_total, created_at)
Rules:
- Output ONLY valid JSON: {"sql": "SELECT ...", "params": [], "explanation": "..."}
- The SQL MUST start with SELECT. Never INSERT/UPDATE/DELETE/DROP/ALTER/PRAGMA/ATTACH.
- Use ? placeholders for any user values and list them in params in order.
- entry_date / paid_at / created_at are unix epoch milliseconds integers.
- Keep results bounded (add LIMIT 200 if not aggregating).`;

export async function ledgerNlToSql(question: string): Promise<{ sql: string; params: any[]; explanation: string } | null> {
  const r = await claudeJSON<{ sql: string; params: any[]; explanation: string }>(LEDGER_NL_SYSTEM, `Question: ${question}`);
  if (!r || !r.sql) return null;
  return { sql: r.sql, params: Array.isArray(r.params) ? r.params : [], explanation: r.explanation || "" };
}

// R5.4 / R5.5 / R22.1 — extract a vendor price quote from a free-text WhatsApp reply.
// R22.1: vendors now reply against a numbered outbound parts list ("1) <part> | <brand> | Qty: <qty>"),
// so a single reply may carry several rates. Recognize, in priority order:
//   - Numbered: "1) 450", "2. 320", "Line 1: 450"  → rate keyed by line number
//   - Named:    "Brake Pad 450, Clutch Plate 320"   → fuzzy-match part name
//   - Positional: bare numbers in reply order        → same order as the outbound numbered list
// `rate` stays the single best/first rate (back-compat with the existing R18 webhook schema);
// `rates_by_line` is an additive map {lineNumber(1-based as string): rate} for batch replies.
const VENDOR_EXTRACT_SYSTEM = `You extract a vendor price quote from a WhatsApp message (English or Hindi).
Return ONLY JSON: {"part_number": string|null, "brand": string|null, "rate": number|null, "moq": number|null, "lead_time_days": number|null, "notes": string|null, "confidence": number, "rates_by_line": {"<n>": number}|null}
confidence is 0..1. If a field is absent, use null. rate/moq/rates are numbers (strip currency symbols like ₹/Rs and commas).
The vendor was sent a NUMBERED parts list ("1) <part> | <brand> | Qty: <qty>"). Their reply may quote several lines at once.
Extract per-line rates into rates_by_line (keys are the 1-based line numbers as strings), recognizing in priority order:
1) Numbered: "1) 450", "2. 320", "1. 450 2. 320", "Line 1: 450".
2) Named: "Brake Pad 450, Clutch Plate 320" — match the part name to the line it refers to.
3) Positional: bare numbers in reply order map to lines 1,2,3,... in the outbound order.
Set "rate" to the first/primary line rate for back-compat. If only one rate is present, rates_by_line may be {"1": <rate>}. If no rate is present, rate=null and rates_by_line=null.`;

export async function extractVendorQuote(rawText: string, productContext?: string): Promise<{ part_number: string | null; brand: string | null; rate: number | null; moq: number | null; lead_time_days: number | null; notes: string | null; confidence: number; rates_by_line?: Record<string, number> | null } | null> {
  return claudeJSON(VENDOR_EXTRACT_SYSTEM, `Product context: ${productContext || "(none)"}\n\nVendor message:\n${rawText}`);
}
