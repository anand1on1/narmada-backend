// PartSetu v1.4 C1 — callable cross-reference (comparative sheet) ingestion.
// Lifted from scripts/ingest-xref.ts so the admin upload route can drive it.
// Parses a WABCO/WTIL/SCL-style comparative workbook into partsetu_xref, one
// sheet per customer OEM. Idempotent via INSERT OR IGNORE on the unique
// (source_part_no, customer_oem, customer_part_no) index.
//
// HARD RULE: this sheet carries NO prices and none are read. PartSetu prices come
// ONLY from partsetu_prices + Narmada price_master, NEVER from partsetu_xref.
import * as fs from "node:fs";
import * as XLSXns from "xlsx";
import { rawSqlite as db } from "../storage";

const XLSX: any = (XLSXns as any).read ? XLSXns : (XLSXns as any).default || XLSXns;

function normalizeOem(sheet: string): string {
  const s = sheet.trim().toLowerCase();
  const map: Record<string, string> = {
    "tml pune": "TATA", "tml": "TATA", "tata": "TATA",
    "al": "ASHOK_LEYLAND", "eml": "EICHER", "beml": "BEML", "sml": "SML",
    "caterpillar": "CATERPILLAR", "cat": "CATERPILLAR", "amw": "AMW",
    "man force": "MAN_FORCE", "manforce": "MAN_FORCE", "fml": "FORCE", "escorts": "ESCORTS",
  };
  if (map[s]) return map[s];
  return sheet.trim().toUpperCase().replace(/\s+/g, "_");
}

const KEYWORD = /\b(s\.?\s*no|sno|scl|wtil|material|description|status|part\s*no|part\s*number|customer|tml|pune)\b/i;
function looksLikeHeader(row: any[]): boolean {
  return row.some((c) => KEYWORD.test(String(c || "")));
}

interface Cols { source: number; desc: number; customer: number }

function detectColumns(header: any[]): Cols {
  const lc = header.map((h) => String(h || "").toLowerCase().trim());
  const ignore = new Set<number>();
  lc.forEach((h, i) => { if (/^s\.?\s*no$|^sno$|^s no$|status/.test(h)) ignore.add(i); });
  let desc = lc.findIndex((h) => h.includes("desc"));
  let source = lc.findIndex((h) => /\b(scl|wtil|material)\b/.test(h) || h === "part no");
  let customer = -1;
  for (let i = 0; i < lc.length; i++) {
    if (i === source || i === desc || ignore.has(i)) continue;
    customer = i; break;
  }
  if (source === -1) {
    for (let i = 0; i < lc.length; i++) {
      if (i === customer || i === desc || ignore.has(i)) continue;
      source = i; break;
    }
  }
  return { source, desc, customer };
}

function positionalColumns(ncols: number): Cols {
  if (ncols >= 3) return { source: 0, desc: 1, customer: 2 };
  return { source: 0, desc: -1, customer: 1 };
}

export interface XrefIngestResult { totalInserted: number; sheetsUsed: number; sourceFileId: number; }

// Ingest a comparative workbook. Registers a partsetu_xref_sources row, tags all
// inserted xref rows with its source_file_id, and returns counts.
export function ingestXrefWorkbook(opts: {
  xlsxPath: string;
  sourceName: string;
  sourceBrand?: string;
  uploadedBy: string;
}): XrefIngestResult {
  const { xlsxPath, sourceName, sourceBrand = "WABCO", uploadedBy } = opts;
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

  let totalInserted = 0, sheetsUsed = 0;

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.trim().toLowerCase();
    if (sn === "sheet1" || sn.startsWith("duplicate")) continue;
    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
    if (!rows.length) continue;

    const header = rows[0];
    const headerIsHeader = looksLikeHeader(header);
    const ncols = Math.max(...rows.slice(0, 5).map((r) => r.length));
    let cols = headerIsHeader ? detectColumns(header) : positionalColumns(ncols);
    if (cols.source === -1 || cols.customer === -1) cols = positionalColumns(ncols);

    const isInternal = (v: any) => /^\s*100\d{5,7}\s*$/.test(String(v ?? ""));
    const sample = rows.slice(headerIsHeader ? 1 : 0, (headerIsHeader ? 1 : 0) + 30);
    const srcHits = sample.filter((r) => isInternal(r[cols.source])).length;
    const custHits = sample.filter((r) => isInternal(r[cols.customer])).length;
    if (custHits > srcHits) { const t = cols.source; cols.source = cols.customer; cols.customer = t; }

    const oem = normalizeOem(sheetName);
    const startRow = headerIsHeader ? 1 : 0;
    let inserted = 0;

    const tx = db.transaction(() => {
      for (let i = startRow; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const sourcePn = String(r[cols.source] ?? "").trim();
        const customerPn = String(r[cols.customer] ?? "").trim();
        if (!sourcePn || !customerPn) continue;
        if (/^(part|material|scl|wtil|customer)/i.test(sourcePn) && isNaN(Number(sourcePn))) {
          if (KEYWORD.test(sourcePn)) continue;
        }
        const desc = cols.desc >= 0 ? String(r[cols.desc] ?? "").trim() : "";
        const res = insert.run(sourceBrand, sourcePn, desc || null, oem, customerPn, null, sheetName, sourceName, sourceFileId, ts);
        if (res.changes > 0) inserted++;
      }
    });
    tx();

    if (inserted > 0) sheetsUsed++;
    totalInserted += inserted;
  }

  db.prepare(`UPDATE partsetu_xref_sources SET row_count = ? WHERE id = ?`).run(totalInserted, sourceFileId);
  console.log(`[xref-ingester] source=${sourceName} inserted=${totalInserted} sheets=${sheetsUsed}`);
  return { totalInserted, sheetsUsed, sourceFileId };
}

// Delete a comparative source and all its xref rows (cascade-by-app).
export function deleteXrefSource(sourceFileId: number): { deletedRows: number } {
  const res = db.prepare(`DELETE FROM partsetu_xref WHERE source_file_id = ?`).run(sourceFileId);
  db.prepare(`DELETE FROM partsetu_xref_sources WHERE id = ?`).run(sourceFileId);
  return { deletedRows: res.changes };
}
