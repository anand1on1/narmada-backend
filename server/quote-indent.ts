import type { Express } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { extractQuoteIndent } from "./claude-service";

export const INDENT_BYTES = 4 * 1024 * 1024;
export const INDENT_ROWS = 500;
type Item = { part_number: string; description: string; qty: number | null; needs_review: boolean };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: INDENT_BYTES, files: 1, fields: 1, parts: 3, fieldSize: 16 } }).single("file");
const windows = new Map<string, number[]>();
const busy = new Set<string>();
export function __resetIndentLimits() { windows.clear(); busy.clear(); }
function allow(key: string, limit: number) {
  const now = Date.now();
  for (const [k, list] of Array.from(windows)) if (!list.some(t => t > now - 3600000)) windows.delete(k);
  if (windows.size > 10000 && !windows.has(key)) return false;
  const list = (windows.get(key) || []).filter(t => t > now - 3600000);
  if (list.length >= limit) return false;
  windows.set(key, [...list, now]); return true;
}
export function normalizeIndent(rows: unknown[]): Item[] {
  if (!rows.length) throw Error("No readable items found. Please use manual entry.");
  if (rows.length > INDENT_ROWS) throw Error("Maximum 500 items per enquiry. Split the file.");
  return rows.map((v: any) => {
    const rawPn = typeof v?.part_number === "string" ? v.part_number.trim() : "";
    // Scientific notation may already have lost significant digits. Never expand
    // or present it as an exact identifier; require review against the source.
    const pn = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(rawPn) ? "" : rawPn;
    const name = typeof v?.name === "string" ? v.name.trim() : "";
    const raw = v?.qty;
    const qty = raw !== null && raw !== undefined && String(raw).trim() !== "" &&
      /^\d+$/.test(String(raw).trim()) && Number(raw) >= 1 && Number(raw) <= 9999 ? Number(raw) : null;
    if (pn.length > 100 || name.length > 500) throw Error("An extracted field is too long. Shorten the source text or use manual entry.");
    return { part_number: pn, description: name, qty, needs_review: !pn || !name || qty === null };
  });
}
/** Inspect ZIP central directory before XLSX inflation. Reject ZIP64/encryption,
 * excessive entries/expanded bytes/ratios rather than trusting extension alone. */
export function checkWorkbookZip(b: Buffer) {
  if (b.readUInt32LE(0) !== 0x04034b50) throw Error("The file is not an XLSX workbook.");
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error("Invalid XLSX archive.");
  const count = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16), total = 0;
  if (count > 300 || !count || p >= end) throw Error("Workbook is too complex.");
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) throw Error("Invalid XLSX archive.");
    const compressed = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24);
    if ((b.readUInt16LE(p + 8) & 1) || size === 0xffffffff || size > 8 * 1024 * 1024 ||
      size > Math.max(compressed, 1) * 200) throw Error("Workbook expansion exceeds the safety limit.");
    total += size;
    if (total > 16 * 1024 * 1024) throw Error("Workbook expansion exceeds 16 MiB.");
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
}
export function parseIndentSheet(b: Buffer, extension: string): Item[] {
  let rows: unknown[][];
  if (extension === "csv") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); }
    catch { throw Error("CSV must be clean UTF-8. Re-export it without changing part numbers."); }
    rows = [];
    let problem = "";
    Papa.parse<unknown[]>(text, { skipEmptyLines: "greedy", step(result, parser) {
      if (result.errors.length) { problem = "CSV quoting is invalid."; parser.abort(); return; }
      rows.push(result.data);
      if (rows.length > INDENT_ROWS + 1) { problem = "Maximum 500 items per enquiry."; parser.abort(); }
    } });
    if (problem) throw Error(problem);
  } else {
    if (b.length < 22) throw Error("Invalid XLSX archive.");
    checkWorkbookZip(b);
    const wb = XLSX.read(b, { type: "buffer", sheetRows: INDENT_ROWS + 2, cellText: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw Error("The workbook has no first worksheet.");
    const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (range.e.r > INDENT_ROWS || range.e.c > 29) throw Error("First worksheet must contain at most 500 items and 30 columns.");
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  }
  if (rows.length < 2 || rows.some(r => r.length > 30)) throw Error("Include a header and item rows, with at most 30 columns.");
  const header = rows[0].map(v => String(v).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const pn = header.findIndex(v => ["partnumber", "partno", "itemno", "itemnumber", "partcode"].includes(v));
  const name = header.findIndex(v => ["name", "description", "partname", "itemdescription", "itemname"].includes(v));
  const qty = header.findIndex(v => ["qty", "quantity", "count", "nos", "pcs"].includes(v));
  if (pn < 0 && name < 0) throw Error("Use headers part_number, description and quantity.");
  return normalizeIndent(rows.slice(1).map(r => ({ part_number: pn >= 0 ? String(r[pn] ?? "") : "",
    name: name >= 0 ? String(r[name] ?? "") : "", qty: qty >= 0 ? r[qty] : null })));
}
function imagePixels(b: Buffer, ext: string) {
  if (ext === "png" && b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return b.readUInt32BE(16) * b.readUInt32BE(20);
  if (["jpg", "jpeg"].includes(ext) && b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 255) break;
      const marker = b[p + 1], len = b.readUInt16BE(p + 2);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return b.readUInt16BE(p + 5) * b.readUInt16BE(p + 7);
      if (len < 2) break;
      p += 2 + len;
    }
  }
  throw Error("File contents do not match a supported PNG or JPEG image.");
}
export function registerQuoteIndentRoute(app: Express, verify: (token: string) => { email: string } | null) {
  app.post("/api/quote/indent/parse", async (req, res) => {
    const payload = verify(String(req.headers["x-quote-token"] || ""));
    if (!payload) return res.status(401).json({ error: "Verify your email before uploading an indent." });
    const key = createHash("sha256").update(payload.email).digest("hex");
    if (busy.size >= 2 || busy.has(key)) return res.status(429).json({ error: "A document is being processed. Please wait and try again." });
    if (!allow(`email:${key}`, 5) || !allow(`ip:${req.ip}`, 10)) return res.status(429).json({ error: "Document limit reached. Try again in an hour or enter parts manually." });
    busy.add(key);
    try {
      await new Promise<void>((resolve, reject) => upload(req, res, err => err ? reject(err) : resolve()));
      if (req.body?.consent !== "true") return res.status(400).json({ error: "Confirm document-processing consent first." });
      const file = req.file;
      if (!file?.size) return res.status(400).json({ error: "Choose a nonempty file." });
      const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
      let items: Item[];
      if (["csv", "xlsx"].includes(ext)) items = parseIndentSheet(file.buffer, ext);
      else if (ext === "pdf") {
        if (file.buffer.subarray(0, 5).toString() !== "%PDF-") throw Error("File contents do not match PDF.");
        let pdf: PDFDocument;
        try { pdf = await PDFDocument.load(file.buffer, { updateMetadata: false, throwOnInvalidObject: true }); }
        catch { throw Error("PDF is unreadable or password-protected. Use a clean export."); }
        if (pdf.getPageCount() > 5 || pdf.getPageCount() < 1) throw Error("PDF must contain 1 to 5 pages.");
        items = normalizeIndent(await extractQuoteIndent(file.buffer, "application/pdf"));
      } else if (["jpg", "jpeg", "png"].includes(ext)) {
        const pixels = imagePixels(file.buffer, ext);
        if (!pixels || pixels > 20000000) throw Error("Image must contain at most 20 megapixels.");
        items = normalizeIndent(await extractQuoteIndent(file.buffer, ext === "png" ? "image/png" : "image/jpeg"));
      } else return res.status(415).json({ error: "Use CSV, XLSX, PDF, JPG or PNG." });
      if (req.aborted) return;
      res.json({ items, review_required: true, message: "Review every field before submission. Missing values have not been guessed." });
    } catch (e: any) {
      const known = e?.code === "LIMIT_FILE_SIZE" ? "Maximum file size is 4 MiB." :
        typeof e?.message === "string" && !/api[_ -]?key|authorization|anthropic|https?:/i.test(e.message) ? e.message :
        "Document reading failed. Try CSV/XLSX or manual entry.";
      res.status(e?.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: known.slice(0, 300) });
    } finally {
      if (req.file) req.file.buffer = Buffer.alloc(0);
      busy.delete(key);
    }
  });
}
