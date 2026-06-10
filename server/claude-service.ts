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
 */
export async function chatReply(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
): Promise<string> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY === "skip") {
    return "I'm here to help! Our customer support team will be in touch shortly.";
  }

  try {
    const client = getClient();
    const messages = [
      ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: message },
    ];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `You are a helpful customer support assistant for Narmada Mobility, 
an automotive parts supplier in India. Help customers with their inquiries about 
parts, orders, deliveries, and account status. Be concise and professional.
If you don't know something specific about an order, ask the customer for their 
order number or direct them to contact the sales team.`,
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
