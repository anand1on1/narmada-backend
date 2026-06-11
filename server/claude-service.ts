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
