// PartSetu v1.4 C1 — callable cross-reference (comparative sheet) ingestion.
// R27.19 — rewritten for real-world Wabco master files: multi-sheet workbooks
// where each sheet = one brand (brand→Wabco mapping), and wide multi-column
// verification sheets with several [customer, Wabco] column pairs on one row.
//
// Mapping into partsetu_xref (schema columns confirmed in migrations.ts):
//   source_brand      = the OEM that built the truck (TML / AL / EML / ...)
//   source_part_no    = that OEM's part number (e.g. 264742300101)
//   customer_oem      = 'WABCO' (the cross-reference brand being looked up)
//   customer_part_no  = the Wabco internal part number (e.g. 100251260)
//   source_description= optional description column
//
// HARD RULE: this sheet carries NO prices and none are read. PartSetu prices come
// ONLY from partsetu_prices + Narmada price_master, NEVER from partsetu_xref.
import * as fs from "node:fs";
import * as XLSXns from "xlsx";
import { rawSqlite as db } from "../storage";

const XLSX: any = (XLSXns as any).read ? XLSXns : (XLSXns as any).default || XLSXns;

// Sheet-name → OEM brand. Lowercased keys; covers the duplicate sheets too.
const BRAND_BY_SHEET: Record<string, string> = {
  "eml": "EML",
  "duplicate eml": "EML",
  "tml pune": "TML",
  "tml": "TML",
  "al": "AL",
  "duplicate al": "AL",
  "beml": "BEML",
  "sml": "SML",
  "caterpillar": "Caterpillar",
  "amw": "AMW",
  "man force": "ManForce",
  "manforce": "ManForce",
  "fml": "FML",
  "escorts": "Escorts",
};

const WABCO = "WABCO";

// A Wabco internal part number reliably looks like 100xxxxxxx (8-9 digits).
const INTERNAL = /^\s*100\d{4,7}\s*$/;
// Label words that mark a row as a header rather than data.
const HEADER_WORD = /\b(s\.?\s*no|sno|scl|wtil|material|description|desc|status|part\s*no|part\s*number|customer|wabco|pune)\b/i;
// Columns we never treat as a part column.
const IGNORE_HEADER = /^(s\.?\s*no|sno|s\s*no|status)$/i;

function clean(v: any): string {
  return String(v ?? "").replace(/\.0$/, "").trim();
}

function looksLikeHeader(row: any[]): boolean {
  return row.some((c) => HEADER_WORD.test(String(c || "")));
}

// Does a value look like a stray header label (no digits) rather than a part?
function isHeaderToken(v: string): boolean {
  return /\b(part|material|customer|description|status|wabco|no)\b/i.test(v) && !/\d/.test(v);
}

interface Cols { wabco: number; brand: number; desc: number }

// Detect the Wabco / brand / description columns for a single-layout sheet.
function detectColumns(headerRow: any[] | null, sample: any[][], ncols: number): Cols {
  const lc = (headerRow || []).map((h) => String(h || "").toLowerCase().trim());

  // Fraction of sampled cells in a column matching a predicate.
  const frac = (col: number, pred: (s: string) => boolean) => {
    let hit = 0, tot = 0;
    for (const r of sample) {
      const v = clean(r[col]);
      if (!v) continue;
      tot++;
      if (pred(v)) hit++;
    }
    return tot ? hit / tot : 0;
  };
  const isText = (s: string) => /[A-Za-z]/.test(s) && /\s/.test(s) && !INTERNAL.test(s);
  const isPart = (s: string) => /^[A-Za-z0-9.\- ]{4,}$/.test(s) && /[0-9]/.test(s);

  const ignore = new Set<number>();
  lc.forEach((h, i) => { if (IGNORE_HEADER.test(h)) ignore.add(i); });

  // --- description column ---
  let desc = lc.findIndex((h) => /desc/.test(h));
  if (desc === -1) {
    let best = -1, bestFrac = 0.5;
    for (let i = 0; i < ncols; i++) {
      const f = frac(i, isText);
      if (f > bestFrac) { bestFrac = f; best = i; }
    }
    desc = best;
  }

  // --- wabco column: header keyword first, else data (100xxxx pattern) ---
  let wabco = lc.findIndex((h) => /\b(wabco|scl\s*part|wtil)\b/.test(h) || /^material$/.test(h) || /^part\s*no$/.test(h));
  if (wabco === -1) {
    let best = -1, bestFrac = 0.4;
    for (let i = 0; i < ncols; i++) {
      if (i === desc) continue;
      const f = frac(i, (s) => INTERNAL.test(s));
      if (f > bestFrac) { bestFrac = f; best = i; }
    }
    wabco = best;
  }

  // --- brand column: first remaining part-like column ---
  let brand = -1, brandFrac = 0;
  for (let i = 0; i < ncols; i++) {
    if (i === wabco || i === desc || ignore.has(i)) continue;
    const f = frac(i, isPart);
    if (f > brandFrac) { brandFrac = f; brand = i; }
  }
  if (brand === -1) {
    for (let i = 0; i < ncols; i++) {
      if (i === wabco || i === desc || ignore.has(i)) continue;
      brand = i; break;
    }
  }

  return { wabco, brand, desc };
}

// Detect a wide multi-pair layout: the header row carries 2+ "WABCO" labels.
// Returns the list of [customerCol, wabcoCol] pairs, or null if not wide.
function detectWidePairs(headerRow: any[]): Array<[number, number]> | null {
  const wabcoCols: number[] = [];
  headerRow.forEach((h, i) => { if (/wabco/i.test(String(h || ""))) wabcoCols.push(i); });
  if (wabcoCols.length < 2) return null;
  // Each Wabco column is the 2nd of a [customer, wabco] adjacent pair.
  return wabcoCols.map((w) => [w - 1, w] as [number, number]).filter(([c]) => c >= 0);
}

export interface XrefIngestResult {
  // Back-compat fields (callers/UI may read these).
  totalInserted: number;
  sheetsUsed: number;
  sourceFileId: number;
  // R27.19 — richer per-upload summary for the admin UI.
  sheetsProcessed: number;
  sheetsSkipped: string[];
  rowsRead: number;
  rowsInserted: number;
  rowsSkipped: number;
  perSheet: Array<{ sheet: string; brand: string; cols: string; rowsIn: number; inserted: number; skipped: number }>;
  errors: string[];
}

// Ingest a comparative workbook. Registers a partsetu_xref_sources row, tags all
// inserted xref rows with its source_file_id, and returns a per-sheet summary.
export function ingestXrefWorkbook(opts: {
  xlsxPath: string;
  sourceName: string;
  sourceBrand?: string;
  uploadedBy: string;
}): XrefIngestResult {
  const { xlsxPath, sourceName, sourceBrand = WABCO, uploadedBy } = opts;
  if (!fs.existsSync(xlsxPath)) throw new Error(`xlsx not found: ${xlsxPath}`);

  const ts = Date.now();
  const srcRes = db.prepare(
    `INSERT INTO partsetu_xref_sources (source_name, file_path, row_count, source_brand, uploaded_by, uploaded_at, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
  ).run(sourceName, xlsxPath, sourceBrand, uploadedBy, ts, ts);
  const sourceFileId = Number(srcRes.lastInsertRowid);

  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const insert = db.prepare(
    `INSERT OR IGNORE INTO partsetu_xref
       (source_brand, source_part_no, source_description, customer_oem, customer_part_no, status, source_sheet, source_file, source_file_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const result: XrefIngestResult = {
    totalInserted: 0, sheetsUsed: 0, sourceFileId,
    sheetsProcessed: 0, sheetsSkipped: [], rowsRead: 0, rowsInserted: 0, rowsSkipped: 0,
    perSheet: [], errors: [],
  };

  // Insert one (oemPart, wabcoPart) pair. Returns 'inserted' | 'skipped'.
  const tryInsert = (brand: string, oemPart: any, wabcoPart: any, desc: any, sheetName: string): "inserted" | "skipped" => {
    const sourcePn = clean(oemPart);
    const wabcoPn = clean(wabcoPart);
    if (!sourcePn || !wabcoPn) return "skipped";
    if (isHeaderToken(sourcePn) || isHeaderToken(wabcoPn)) return "skipped";
    const d = clean(desc);
    const res = insert.run(brand, sourcePn, d || null, WABCO, wabcoPn, null, sheetName, sourceName, sourceFileId, ts);
    return res.changes > 0 ? "inserted" : "skipped";
  };

  for (const sheetName of wb.SheetNames) {
    try {
      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
      if (!rows.length) { result.sheetsSkipped.push(`${sheetName} (empty)`); continue; }

      const header0 = rows[0] || [];
      const widePairs = detectWidePairs(header0);

      // --- Wide multi-pair verification layout (single sheet, many WABCO cols) ---
      if (widePairs) {
        const brand = opts.sourceBrand && opts.sourceBrand !== WABCO ? opts.sourceBrand : "TML";
        let rowsIn = 0, inserted = 0, skipped = 0;
        const tx = db.transaction(() => {
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;
            for (const [custCol, wabcoCol] of widePairs) {
              const cust = r[custCol], wab = r[wabcoCol];
              if (!clean(cust) && !clean(wab)) continue;
              rowsIn++;
              try {
                const out = tryInsert(brand, cust, wab, "", sheetName);
                if (out === "inserted") inserted++; else skipped++;
              } catch (e: any) { skipped++; result.errors.push(`${sheetName} row ${i}: ${e?.message}`); }
            }
          }
        });
        tx();
        result.sheetsProcessed++;
        if (inserted > 0) result.sheetsUsed++;
        result.rowsRead += rowsIn; result.rowsInserted += inserted; result.rowsSkipped += skipped;
        result.perSheet.push({ sheet: sheetName, brand, cols: `wide:${widePairs.length} pairs`, rowsIn, inserted, skipped });
        console.log(`[xref-ingester] sheet="${sheetName}" brand=${brand} cols=wide(${widePairs.length}) rows_in=${rowsIn} inserted=${inserted} skipped=${skipped}`);
        continue;
      }

      // --- Single-layout per-brand sheet ---
      const brand = BRAND_BY_SHEET[sheetName.trim().toLowerCase()];
      if (!brand) { result.sheetsSkipped.push(`${sheetName} (unrecognized brand)`); console.log(`[xref-ingester] sheet="${sheetName}" SKIPPED (unrecognized)`); continue; }

      const headerIsHeader = looksLikeHeader(header0);
      const startRow = headerIsHeader ? 1 : 0;
      const ncols = Math.max(...rows.slice(0, 6).map((r) => r.length), 0);
      const sample = rows.slice(startRow, startRow + 40);
      const cols = detectColumns(headerIsHeader ? header0 : null, sample, ncols);

      if (cols.wabco === -1 || cols.brand === -1 || cols.wabco === cols.brand) {
        result.sheetsSkipped.push(`${sheetName} (column detection failed)`);
        console.log(`[xref-ingester] sheet="${sheetName}" brand=${brand} SKIPPED (cols wabco=${cols.wabco} brand=${cols.brand})`);
        continue;
      }

      let rowsIn = 0, inserted = 0, skipped = 0;
      const tx = db.transaction(() => {
        for (let i = startRow; i < rows.length; i++) {
          const r = rows[i];
          if (!r) continue;
          rowsIn++;
          try {
            const out = tryInsert(brand, r[cols.brand], r[cols.wabco], cols.desc >= 0 ? r[cols.desc] : "", sheetName);
            if (out === "inserted") inserted++; else skipped++;
          } catch (e: any) { skipped++; result.errors.push(`${sheetName} row ${i}: ${e?.message}`); }
        }
      });
      tx();

      result.sheetsProcessed++;
      if (inserted > 0) result.sheetsUsed++;
      result.rowsRead += rowsIn; result.rowsInserted += inserted; result.rowsSkipped += skipped;
      result.perSheet.push({ sheet: sheetName, brand, cols: `wabco=${cols.wabco} brand=${cols.brand} desc=${cols.desc}`, rowsIn, inserted, skipped });
      console.log(`[xref-ingester] sheet="${sheetName}" brand=${brand} cols=[wabco=${cols.wabco} brand=${cols.brand} desc=${cols.desc}] rows_in=${rowsIn} inserted=${inserted} skipped=${skipped}`);
    } catch (e: any) {
      result.errors.push(`${sheetName}: ${e?.message}`);
      console.log(`[xref-ingester] sheet="${sheetName}" ERROR ${e?.message}`);
    }
  }

  result.totalInserted = result.rowsInserted;
  db.prepare(`UPDATE partsetu_xref_sources SET row_count = ? WHERE id = ?`).run(result.totalInserted, sourceFileId);
  console.log(`[xref-ingester] source="${sourceName}" sheetsProcessed=${result.sheetsProcessed} skipped=${result.sheetsSkipped.length} rowsRead=${result.rowsRead} inserted=${result.rowsInserted} skipped=${result.rowsSkipped}`);
  return result;
}

// Delete a comparative source and all its xref rows (cascade-by-app).
export function deleteXrefSource(sourceFileId: number): { deletedRows: number } {
  const res = db.prepare(`DELETE FROM partsetu_xref WHERE source_file_id = ?`).run(sourceFileId);
  db.prepare(`DELETE FROM partsetu_xref_sources WHERE id = ?`).run(sourceFileId);
  return { deletedRows: res.changes };
}
