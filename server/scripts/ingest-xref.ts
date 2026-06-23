// PartSetu AI v1 — cross-reference ingestion.
// Parses the WABCO comparative master workbook (wabco-master.xlsx) into
// partsetu_xref. Each sheet maps WABCO/WTIL/SCL internal part numbers (source)
// to a customer OEM's part numbers. Idempotent via INSERT OR IGNORE on the
// unique (source_part_no, customer_oem, customer_part_no) index.
//
// IMPORTANT: This sheet carries NO prices and none are read. Prices in PartSetu
// only ever come from price_master / existing Narmada product prices.
//
// Usage:  npx tsx server/scripts/ingest-xref.ts <xlsx> [--brand WABCO]
import * as fs from "node:fs";
import * as XLSXns from "xlsx";
import { rawSqlite as db } from "../storage";

// Under tsx/ESM the `xlsx` namespace can lack readFile; use read(buffer) instead,
// and unwrap a possible default export.
const XLSX: any = (XLSXns as any).read ? XLSXns : (XLSXns as any).default || XLSXns;

const xlsxPath = process.argv[2];
if (!xlsxPath || xlsxPath.startsWith("--")) {
  console.error("Usage: npx tsx server/scripts/ingest-xref.ts <xlsx> [--brand WABCO]");
  process.exit(1);
}
if (!fs.existsSync(xlsxPath)) {
  console.error(`[ingest-xref] file not found: ${xlsxPath}`);
  process.exit(1);
}
const brandArgIdx = process.argv.indexOf("--brand");
const SOURCE_BRAND = brandArgIdx >= 0 ? process.argv[brandArgIdx + 1] : "WABCO";

// Normalize a raw sheet name to a customer OEM code.
function normalizeOem(sheet: string): string {
  const s = sheet.trim().toLowerCase();
  const map: Record<string, string> = {
    "tml pune": "TATA",
    "tml": "TATA",
    "tata": "TATA",
    "al": "ASHOK_LEYLAND",
    "eml": "EICHER",
    "beml": "BEML",
    "sml": "SML",
    "caterpillar": "CATERPILLAR",
    "cat": "CATERPILLAR",
    "amw": "AMW",
    "man force": "MAN_FORCE",
    "manforce": "MAN_FORCE",
    "fml": "FORCE",
    "escorts": "ESCORTS",
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
  // Customer = first remaining part-ish column not ignored / not source / not desc.
  let customer = -1;
  for (let i = 0; i < lc.length; i++) {
    if (i === source || i === desc || ignore.has(i)) continue;
    customer = i; break;
  }
  if (source === -1) {
    // Header keywords missing for source — pick the first remaining column.
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

function main() {
  console.log(`[ingest-xref] reading ${xlsxPath}`);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const insert = db.prepare(
    `INSERT OR IGNORE INTO partsetu_xref
       (source_brand, source_part_no, source_description, customer_oem, customer_part_no, status, source_sheet, source_file, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let totalInserted = 0, sheetsUsed = 0;
  const fileName = xlsxPath.split("/").pop() || xlsxPath;

  for (const sheetName of wb.SheetNames) {
    const sn = sheetName.trim().toLowerCase();
    if (sn === "sheet1" || sn.startsWith("duplicate")) {
      console.log(`[ingest-xref] skip sheet "${sheetName}"`);
      continue;
    }
    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
    if (!rows.length) { console.log(`[ingest-xref] empty sheet "${sheetName}"`); continue; }

    const header = rows[0];
    const headerIsHeader = looksLikeHeader(header);
    const ncols = Math.max(...rows.slice(0, 5).map((r) => r.length));
    let cols = headerIsHeader ? detectColumns(header) : positionalColumns(ncols);
    if (cols.source === -1 || cols.customer === -1) cols = positionalColumns(ncols);

    // The WABCO/WTIL/SCL internal part is a ~9-digit code starting with "100".
    // If the detected customer column looks more like that than the source column
    // (happens when a sheet's header row is actually data, e.g. "AL"), swap them.
    const isInternal = (v: any) => /^\s*100\d{5,7}\s*$/.test(String(v ?? ""));
    const sample = rows.slice(headerIsHeader ? 1 : 0, (headerIsHeader ? 1 : 0) + 30);
    const srcHits = sample.filter((r) => isInternal(r[cols.source])).length;
    const custHits = sample.filter((r) => isInternal(r[cols.customer])).length;
    if (custHits > srcHits) { const t = cols.source; cols.source = cols.customer; cols.customer = t; }

    const oem = normalizeOem(sheetName);
    const startRow = headerIsHeader ? 1 : 0;
    let inserted = 0;
    const ts = Date.now();

    const tx = db.transaction(() => {
      for (let i = startRow; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const sourcePn = String(r[cols.source] ?? "").trim();
        const customerPn = String(r[cols.customer] ?? "").trim();
        if (!sourcePn || !customerPn) continue;
        // Skip rows that are clearly headers repeated mid-sheet.
        if (/^(part|material|scl|wtil|customer)/i.test(sourcePn) && isNaN(Number(sourcePn))) {
          if (KEYWORD.test(sourcePn)) continue;
        }
        const desc = cols.desc >= 0 ? String(r[cols.desc] ?? "").trim() : "";
        const res = insert.run(SOURCE_BRAND, sourcePn, desc || null, oem, customerPn, null, sheetName, fileName, ts);
        if (res.changes > 0) inserted++;
      }
    });
    tx();

    if (inserted > 0) sheetsUsed++;
    totalInserted += inserted;
    console.log(`[ingest-xref] sheet "${sheetName}" -> oem=${oem} cols(src=${cols.source},desc=${cols.desc},cust=${cols.customer}) inserted=${inserted}`);
  }

  console.log(`[ingest-xref] done. inserted ${totalInserted} rows across ${sheetsUsed} sheet(s).`);
}

main();
