import type { Readable } from "node:stream";
import { createHash } from "node:crypto";

export const CSV_MAX_BYTES = 64 * 1024 * 1024;
export const CSV_MAX_ROWS = 500000;
export const CSV_MAX_RECORD_CHARS = 32768;
export const CSV_ENCODINGS = ["utf-8", "windows-1252"] as const;
export type CsvEncoding = typeof CSV_ENCODINGS[number];
export class CsvImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// Strict incremental RFC4180-style CSV. No entire-file or unbounded-record buffer.
// CRLF/LF/CR, quoted newlines, escaped quotes and text identifiers are preserved.
export async function streamPriceCsv(
  source: Readable,
  encoding: CsvEncoding,
  onBatch: (rows: any[], progress: { bytes: number; rows: number }) => Promise<void>,
  limits = { bytes: CSV_MAX_BYTES, rows: CSV_MAX_ROWS },
  onBytes?: (bytes: number) => void,
) {
  if (!CSV_ENCODINGS.includes(encoding)) throw new CsvImportError("Choose utf-8 or windows-1252 explicitly; encoding is never guessed.");
  const decoder = new TextDecoder(encoding, { fatal: true });
  const hash = createHash("sha256");
  let bytes = 0, count = 0, record = 1, chars = 0;
  let field = "", fields: string[] = [], batch: any[] = [], headers: string[] | null = null;
  let state: "plain" | "quoted" | "closed" = "plain", skipLf = false, first = true;
  let utf8Remaining = 0, utf8Min = 0x80, utf8Max = 0xbf;
  const fail = (message: string): never => { throw new CsvImportError(`CSV record ${record}: ${message}`); };
  const fieldDone = () => {
    fields.push(field);field = "";state = "plain";
    if (fields.length > 16) fail("more than 16 columns");
  };
  const recordDone = async () => {
    fieldDone();const values = fields;fields = [];chars = 0;
    const currentRecord = record++;
    if (values.length === 1 && values[0] === "") return;
    if (!headers) {
      headers = values.map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
      const allowed = ["part_number","description","mrp","dealer_price","hsn_code","gst_percent","uom","currency"];
      if (new Set(headers).size !== headers.length || headers.some(h => !allowed.includes(h))) throw new CsvImportError(`CSV record ${currentRecord}: duplicate or unsupported column header`);
      if (!headers.includes("part_number") || !headers.includes("mrp")) throw new CsvImportError(`CSV record ${currentRecord}: required columns: part_number and mrp`);
      return;
    }
    if (values.length !== headers.length) throw new CsvImportError(`CSV record ${currentRecord}: column count differs from header at data row ${count + 1}`);
    if (++count > limits.rows) throw new CsvImportError(`CSV exceeds ${limits.rows} data rows`, 413);
    const get = (name: string) => values[headers!.indexOf(name)] || "";
    batch.push({ partNumber:get("part_number"),description:get("description"),mrp:get("mrp"),
      dealerPrice:get("dealer_price"),gstPercent:get("gst_percent"),hsnCode:get("hsn_code"),
      uom:get("uom"),sourceCurrency:get("currency") || "INR" });
    if (batch.length === 500) {
      await onBatch(batch,{bytes,rows:count});batch = [];
    }
  };
  const consume = async (text: string) => {
    for (const c of text) {
      if (first) { first = false;if (c === "\uFEFF") continue; }
      if (skipLf) { skipLf = false;if (c === "\n") continue; }
      if (++chars > CSV_MAX_RECORD_CHARS) fail(`record exceeds ${CSV_MAX_RECORD_CHARS} characters`);
      if (c === "\0") fail("NUL character is not permitted");
      if (state === "quoted") {
        if (c === '"') state = "closed";else field += c;
      } else if (state === "closed" && c === '"') { field += '"';state = "quoted"; }
      else if (c === ",") fieldDone();
      else if (c === "\n" || c === "\r") { await recordDone();skipLf = c === "\r"; }
      else if (state === "closed") fail("unexpected character after closing quote");
      else if (c === '"') { if (field) fail("quote inside an unquoted field");state = "quoted"; }
      else field += c;
    }
  };
  // Do not destroy an HTTP request on parser rejection before its error response.
  for await (const raw of source.iterator({ destroyOnReturn: false })) {
    if (!Buffer.isBuffer(raw)) throw new CsvImportError("CSV input must be raw bytes");
    const offset = bytes;bytes += raw.length;
    if (bytes > limits.bytes) throw new CsvImportError(`CSV exceeds ${limits.bytes} bytes`, 413);
    onBytes?.(bytes);
    hash.update(raw);
    let invalid = -1;
    if (encoding === "windows-1252") invalid = raw.findIndex((b: number) => [0x81,0x8d,0x8f,0x90,0x9d].includes(b));
    else {
      // Validate before decoding so an error can report the exact byte and the
      // record/column after consuming its valid prefix, including split sequences.
      for (let i=0;i<raw.length;i++) {
        const b = raw[i];
        if (utf8Remaining) {
          if (b<utf8Min || b>utf8Max) { invalid=i;break; }
          utf8Remaining--;utf8Min=0x80;utf8Max=0xbf;
        } else if (b<=0x7f) continue;
        else if (b>=0xc2 && b<=0xdf) utf8Remaining=1;
        else if (b>=0xe0 && b<=0xef) {
          utf8Remaining=2;utf8Min=b===0xe0?0xa0:0x80;utf8Max=b===0xed?0x9f:0xbf;
        } else if (b>=0xf0 && b<=0xf4) {
          utf8Remaining=3;utf8Min=b===0xf0?0x90:0x80;utf8Max=b===0xf4?0x8f:0xbf;
        } else { invalid=i;break; }
      }
    }
    if (invalid !== -1) {
      await consume(decoder.decode(raw.subarray(0,invalid),{stream:true}));
      const column = headers?.[fields.length] || String(fields.length+1);
      throw new CsvImportError(`Invalid ${encoding} byte at offset ${offset+invalid}, CSV record ${record}, column ${column}. Confirm the source encoding or obtain a clean UTF-8 export; no bytes were replaced.`);
    }
    let text: string;
    try { text = decoder.decode(raw,{stream:true}); }
    catch { throw new CsvImportError(`Invalid ${encoding} sequence in byte range ${offset}-${bytes - 1}. Confirm the source encoding; no bytes were replaced.`); }
    await consume(text);
  }
  try { await consume(decoder.decode()); }
  catch (e) { if (e instanceof CsvImportError) throw e;throw new CsvImportError(`Incomplete ${encoding} sequence at end of file, CSV record ${record}, column ${headers?.[fields.length] || fields.length+1}`); }
  const endState = state as string; // Mutated by the incremental consume callback.
  if (endState === "quoted") fail("unterminated quoted field");
  if (field || fields.length || endState === "closed") await recordDone();
  if (!headers || !count) throw new CsvImportError("CSV has no data rows");
  if (batch.length) await onBatch(batch,{bytes,rows:count});
  return { bytes,rows:count,sha256:hash.digest("hex") };
}
