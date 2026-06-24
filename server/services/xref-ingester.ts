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

// A value that is not a usable part number (empty, placeholder, or a label).
function isBadPart(v: string): boolean {
  if (!v) return true;
  if (/^(-+|n\/?a|na|tbd|nil)$/i.test(v)) return true;
  if (/\b(part|number|application|description|configuration)\b/i.test(v) && !/\d/.test(v)) return true;
  return false;
}

// R27.21 — file-level brand tokens for catalogs whose SHEETS are not named after
// the brand (e.g. MEI catalog with sheets "Table 4".."Table 75"). Order matters:
// the more specific multi-word tokens come first.
const FILE_BRAND_TOKENS: Array<[RegExp, string]> = [
  [/knorr[\s_-]*bremse|\bbremse\b/i, "Knorr-Bremse"],
  [/\bknorr\b/i, "Knorr"],
  [/\bmei\b/i, "MEI"],
  [/\bbosch\b/i, "Bosch"],
  [/\bdelphi\b/i, "Delphi"],
  [/\blucas\b/i, "Lucas"],
  [/turbo[\s_-]*energy/i, "Turbo Energy"],
  [/\bdenso\b/i, "Denso"],
  [/\bendurance\b/i, "Endurance"],
  [/\bvarroc\b/i, "Varroc"],
  [/\bwabco\b/i, "WABCO"],
];

function detectFileBrand(...names: string[]): string | null {
  const hay = names.filter(Boolean).join(" ");
  for (const [re, brand] of FILE_BRAND_TOKENS) if (re.test(hay)) return brand;
  return null;
}

// Best-effort: map a "Vehicle Application" string to the OEM that built the truck.
function inferOemFromApplication(text: string): string {
  const t = String(text || "").toUpperCase();
  if (/\bTATA\b|M\/HCV|M\/LCV|\bLCV\b|\bHCV\b|SIGNA|PRIMA|\bLPT\b|JNNURM/.test(t)) return "TML";
  if (/LEYLAND|ASHOK|\bAL\b/.test(t)) return "AL";
  if (/EICHER/.test(t)) return "Eicher";
  if (/BHARAT\s*BENZ/.test(t)) return "BharatBenz";
  if (/VOLVO/.test(t)) return "Volvo";
  return "OEM";
}

// First-cell keywords that mark a sheet as notes / contacts rather than parts.
const NON_PARTS_FIRST_CELL = /\b(superseded|notes?|contact|team|executive|manager|e-?mail|representatives?)\b/i;
const SUBHEADER_TOKENS = /\b(front|rear|lh|rh|left|right)\b/i;

interface MeiCols { oe: number; customer: number; desc: number; dataStart: number }

// R27.21 — detect the OE-part / brand-part / description columns for a MEI-style
// sheet by scanning the first 5 rows for `OE Part No` + `<brand> Part No` headers.
// Returns null when the sheet has no such header pair (caller skips it).
function detectMeiColumns(rows: any[][], brand: string): MeiCols | null {
  const brandLc = brand.toLowerCase();
  const brandRe = new RegExp(`${brandLc.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*part\\s*(no|number)`);
  const norm = (v: any) => String(v ?? "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = (rows[i] || []).map(norm);
    const oe = r.findIndex((c) => /\boe(m)?\s*part\s*(no|number)\b/.test(c));
    const customer = r.findIndex((c) => brandRe.test(c) || /\bmei\s*part\s*(no|number)\b/.test(c));
    if (oe >= 0 && customer >= 0 && oe !== customer) {
      const desc = r.findIndex((c, idx) => idx !== oe && idx !== customer && /(desc|vehicle|application|product)/.test(c));
      let dataStart = i + 1;
      // Skip a sub-header row (e.g. Front / Rear / LH / RH) if present.
      const next = (rows[dataStart] || []).map(norm);
      const nextHasParts = clean((rows[dataStart] || [])[oe]) || clean((rows[dataStart] || [])[customer]);
      if (!nextHasParts && next.some((c) => SUBHEADER_TOKENS.test(c))) dataStart++;
      return { oe, customer, desc, dataStart };
    }
  }
  return null;
}

interface SupersededLayout { brand: string; pairs: Array<[number, number]>; dataStart: number }

// R27.21 — "S-ASA Superseded Part Numbers" sheets are NOT notes: they are real
// OE<->brand cross-reference tables with an OEM-name row, then a "MEI"/"OE"
// sub-header giving one or more (brand, OE) column pairs (Old + New part). We
// ingest each pair as a genuine OE->brand mapping. Returns null if not this shape.
function detectSupersededLayout(rows: any[][]): SupersededLayout | null {
  const up = (v: any) => String(v ?? "").trim().toUpperCase();
  let hdr = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = (rows[i] || []).map(up);
    if (r.includes("MEI") && r.includes("OE")) { hdr = i; break; }
  }
  if (hdr < 0) return null;
  const r = (rows[hdr] || []).map(up);
  const pairs: Array<[number, number]> = [];
  for (let i = 1; i < r.length; i++) {
    if (r[i] === "OE" && r[i - 1] === "MEI") pairs.push([i - 1, i]); // [brandCol, oeCol]
  }
  if (!pairs.length) return null;
  let brand = "OEM";
  for (let i = 0; i < hdr; i++) {
    const b = inferOemFromApplication(String((rows[i] || [])[0] ?? ""));
    if (b !== "OEM") { brand = b; break; }
  }
  return { brand, pairs, dataStart: hdr + 1 };
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

  // Insert one (sourcePart, customerPart) pair. customerOem defaults to WABCO
  // (the brand-by-sheet / wide layouts); MEI-style files pass the file brand.
  // Returns 'inserted' | 'skipped'.
  const tryInsert = (
    srcBrand: string, sourcePart: any, customerPart: any, desc: any, sheetName: string, customerOem: string = WABCO,
  ): "inserted" | "skipped" => {
    const sourcePn = clean(sourcePart);
    const customerPn = clean(customerPart);
    if (isBadPart(sourcePn) || isBadPart(customerPn)) return "skipped";
    const d = clean(desc);
    const res = insert.run(srcBrand, sourcePn, d || null, customerOem, customerPn, null, sheetName, sourceName, sourceFileId, ts);
    return res.changes > 0 ? "inserted" : "skipped";
  };

  // R27.21 — brand-by-sheet first (existing behavior). If NO sheet name matches a
  // known brand, fall back to a single file-level brand inferred from the filename
  // (MEI-PARTS-CATALOGUE.xlsx → MEI) and treat every sheet as that brand.
  const anySheetBrand = wb.SheetNames.some((sn: string) => BRAND_BY_SHEET[sn.trim().toLowerCase()]);
  const fileBrand = anySheetBrand ? null : detectFileBrand(sourceName, xlsxPath.split(/[\\/]/).pop() || "");
  if (fileBrand) console.log(`[xref-ingester] file_brand=${fileBrand} (no brand-named sheets; using filename)`);

  for (const sheetName of wb.SheetNames) {
    try {
      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
      if (!rows.length) { result.sheetsSkipped.push(`${sheetName} (empty)`); continue; }

      const header0 = rows[0] || [];
      const widePairs = detectWidePairs(header0);

      // --- R27.21: MEI-style file-level brand (sheets named "Table N") ---
      if (fileBrand && !widePairs) {
        const firstCell = clean(header0[0]);

        // Superseded part tables ARE valid OE<->brand xref data (Old + New pairs),
        // so handle them before the non-parts skip below.
        if (/superseded/i.test(firstCell)) {
          const sl = detectSupersededLayout(rows);
          if (sl) {
            let rowsIn = 0, inserted = 0, skipped = 0;
            const tx = db.transaction(() => {
              for (let i = sl.dataStart; i < rows.length; i++) {
                const r = rows[i];
                if (!r) continue;
                for (const [brandCol, oeCol] of sl.pairs) {
                  if (!clean(r[oeCol]) && !clean(r[brandCol])) continue;
                  rowsIn++;
                  try {
                    const out = tryInsert(sl.brand, r[oeCol], r[brandCol], "", sheetName, fileBrand);
                    if (out === "inserted") inserted++; else skipped++;
                  } catch (e: any) { skipped++; result.errors.push(`${sheetName} row ${i}: ${e?.message}`); }
                }
              }
            });
            tx();
            result.sheetsProcessed++;
            if (inserted > 0) result.sheetsUsed++;
            result.rowsRead += rowsIn; result.rowsInserted += inserted; result.rowsSkipped += skipped;
            result.perSheet.push({ sheet: sheetName, brand: fileBrand, cols: `superseded:${sl.pairs.length} pairs src=${sl.brand}`, rowsIn, inserted, skipped });
            console.log(`[xref-ingester] sheet="${sheetName}" brand=${fileBrand} cols=superseded(${sl.pairs.length}) src=${sl.brand} rows_in=${rowsIn} inserted=${inserted} skipped=${skipped}`);
            continue;
          }
        }

        if (NON_PARTS_FIRST_CELL.test(firstCell)) {
          result.sheetsSkipped.push(`${sheetName} (non-parts sheet)`);
          console.log(`[xref-ingester] sheet="${sheetName}" SKIPPED (non-parts sheet)`);
          continue;
        }
        const mc = detectMeiColumns(rows, fileBrand);
        if (!mc) {
          result.sheetsSkipped.push(`${sheetName} (no OE/${fileBrand} headers)`);
          console.log(`[xref-ingester] sheet="${sheetName}" SKIPPED (no OE/${fileBrand} headers)`);
          continue;
        }
        let rowsIn = 0, inserted = 0, skipped = 0;
        const tx = db.transaction(() => {
          for (let i = mc.dataStart; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;
            rowsIn++;
            try {
              const appn = mc.desc >= 0 ? clean(r[mc.desc]) : "";
              const srcBrand = inferOemFromApplication(appn);
              const out = tryInsert(srcBrand, r[mc.oe], r[mc.customer], appn, sheetName, fileBrand);
              if (out === "inserted") inserted++; else skipped++;
            } catch (e: any) { skipped++; result.errors.push(`${sheetName} row ${i}: ${e?.message}`); }
          }
        });
        tx();
        if (inserted < 3 && rowsIn - skipped < 3) {
          // Few/no usable data rows — treat as a non-parts sheet for clarity.
          if (inserted === 0) {
            result.sheetsSkipped.push(`${sheetName} (no usable data)`);
            console.log(`[xref-ingester] sheet="${sheetName}" SKIPPED (no usable data)`);
            continue;
          }
        }
        result.sheetsProcessed++;
        if (inserted > 0) result.sheetsUsed++;
        result.rowsRead += rowsIn; result.rowsInserted += inserted; result.rowsSkipped += skipped;
        result.perSheet.push({ sheet: sheetName, brand: fileBrand, cols: `oe=${mc.oe} brand=${mc.customer} desc=${mc.desc}`, rowsIn, inserted, skipped });
        console.log(`[xref-ingester] sheet="${sheetName}" brand=${fileBrand} cols=[oe=${mc.oe} brand=${mc.customer} desc=${mc.desc}] rows_in=${rowsIn} inserted=${inserted} skipped=${skipped}`);
        continue;
      }

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
  console.log(`[xref-ingester] source="${sourceName}" file_brand=${fileBrand ?? "(per-sheet)"} sheetsProcessed=${result.sheetsProcessed} skipped=${result.sheetsSkipped.length} rowsRead=${result.rowsRead} inserted=${result.rowsInserted} skipped=${result.rowsSkipped}`);
  return result;
}

// Delete a comparative source and all its xref rows (cascade-by-app).
export function deleteXrefSource(sourceFileId: number): { deletedRows: number } {
  const res = db.prepare(`DELETE FROM partsetu_xref WHERE source_file_id = ?`).run(sourceFileId);
  db.prepare(`DELETE FROM partsetu_xref_sources WHERE id = ?`).run(sourceFileId);
  return { deletedRows: res.changes };
}
