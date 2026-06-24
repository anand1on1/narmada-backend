// PartSetu v1.4 C2/C3 — flexible-mapping sheet ingestion for Price Lists and
// Consumption Reports. Both share the same UX: upload → backend returns detected
// columns + sample rows → admin maps each schema field to a column → ingest with
// that mapping (saved per source for re-ingest).
//
// HARD RULE (C2): PartSetu prices come ONLY from partsetu_prices (this loader) +
// Narmada price_master. NEVER from partsetu_xref.
import * as fs from "node:fs";
import * as XLSXns from "xlsx";
import { rawSqlite as db } from "../storage";

const XLSX: any = (XLSXns as any).read ? XLSXns : (XLSXns as any).default || XLSXns;

export interface SheetPreview { columns: string[]; sampleRows: string[][]; totalRows: number; }

// column_map_json shape: { [schemaField: string]: number }  (column index, -1 = unmapped)
export type ColumnMap = Record<string, number>;

function readRows(filePath: string): string[][] {
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][])
    .map((r) => r.map((c: any) => (c == null ? "" : String(c))));
}

// First non-empty row is treated as the header.
export function parseSheetPreview(filePath: string): SheetPreview {
  const rows = readRows(filePath);
  if (!rows.length) return { columns: [], sampleRows: [], totalRows: 0 };
  const header = rows[0].map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`));
  const sampleRows = rows.slice(1, 6);
  return { columns: header, sampleRows, totalRows: Math.max(0, rows.length - 1) };
}

function toEpoch(v: string): number | null {
  const s = (v || "").trim();
  if (!s) return null;
  // Excel serial date (days since 1899-12-30).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 90000) return Math.round((n - 25569) * 86400 * 1000);
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

function toNumber(v: string): number | null {
  const s = (v || "").replace(/[, ₹$]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

const PRICE_FIELDS = ["part_number", "oem", "mrp", "dealer_price", "currency", "effective_from", "effective_to"];
const CONSUMPTION_FIELDS = [
  "customer_name", "customer_id", "vehicle_chassis", "vehicle_reg", "vehicle_oem",
  "vehicle_model", "vehicle_variant", "part_number", "part_description", "qty", "consumed_date",
];

export const PRICE_SCHEMA_FIELDS = PRICE_FIELDS;
export const CONSUMPTION_SCHEMA_FIELDS = CONSUMPTION_FIELDS;

function cell(row: string[], map: ColumnMap, field: string): string {
  const idx = map[field];
  if (idx == null || idx < 0) return "";
  return (row[idx] ?? "").trim();
}

export interface SheetIngestResult { rowsInserted: number; sourceFileId: number; }

export function ingestPrices(opts: {
  filePath: string; sourceName: string; columnMap: ColumnMap; uploadedBy: string;
}): SheetIngestResult {
  const { filePath, sourceName, columnMap, uploadedBy } = opts;
  const rows = readRows(filePath);
  const ts = Date.now();
  const srcRes = db.prepare(
    `INSERT INTO partsetu_price_sources (source_name, file_path, row_count, column_map_json, uploaded_by, uploaded_at, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
  ).run(sourceName, filePath, JSON.stringify(columnMap), uploadedBy, ts, ts);
  const sourceFileId = Number(srcRes.lastInsertRowid);

  const insert = db.prepare(
    `INSERT INTO partsetu_prices (part_number, oem, mrp, dealer_price, currency, effective_from, effective_to, source_file_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let rowsInserted = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const partNumber = cell(r, columnMap, "part_number");
      if (!partNumber) continue;
      insert.run(
        partNumber,
        cell(r, columnMap, "oem") || null,
        toNumber(cell(r, columnMap, "mrp")),
        toNumber(cell(r, columnMap, "dealer_price")),
        cell(r, columnMap, "currency") || "INR",
        toEpoch(cell(r, columnMap, "effective_from")),
        toEpoch(cell(r, columnMap, "effective_to")),
        sourceFileId, ts,
      );
      rowsInserted++;
    }
  });
  tx();
  db.prepare(`UPDATE partsetu_price_sources SET row_count = ? WHERE id = ?`).run(rowsInserted, sourceFileId);
  console.log(`[sheet-ingester] prices source=${sourceName} inserted=${rowsInserted}`);
  return { rowsInserted, sourceFileId };
}

export function ingestConsumption(opts: {
  filePath: string; sourceName: string; columnMap: ColumnMap; uploadedBy: string;
}): SheetIngestResult {
  const { filePath, sourceName, columnMap, uploadedBy } = opts;
  const rows = readRows(filePath);
  const ts = Date.now();
  const srcRes = db.prepare(
    `INSERT INTO partsetu_consumption_sources (source_name, file_path, row_count, column_map_json, uploaded_by, uploaded_at, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
  ).run(sourceName, filePath, JSON.stringify(columnMap), uploadedBy, ts, ts);
  const sourceFileId = Number(srcRes.lastInsertRowid);

  const insert = db.prepare(
    `INSERT INTO partsetu_consumption
       (customer_name, customer_id, vehicle_chassis, vehicle_reg, vehicle_oem, vehicle_model, vehicle_variant,
        part_number, part_description, qty, consumed_date, source_file_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let rowsInserted = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const partNumber = cell(r, columnMap, "part_number");
      const desc = cell(r, columnMap, "part_description");
      if (!partNumber && !desc) continue;
      insert.run(
        cell(r, columnMap, "customer_name") || null,
        toNumber(cell(r, columnMap, "customer_id")),
        cell(r, columnMap, "vehicle_chassis") || null,
        cell(r, columnMap, "vehicle_reg") || null,
        cell(r, columnMap, "vehicle_oem") || null,
        cell(r, columnMap, "vehicle_model") || null,
        cell(r, columnMap, "vehicle_variant") || null,
        partNumber || null,
        desc || null,
        toNumber(cell(r, columnMap, "qty")),
        toEpoch(cell(r, columnMap, "consumed_date")),
        sourceFileId, ts,
      );
      rowsInserted++;
    }
  });
  tx();
  db.prepare(`UPDATE partsetu_consumption_sources SET row_count = ? WHERE id = ?`).run(rowsInserted, sourceFileId);
  console.log(`[sheet-ingester] consumption source=${sourceName} inserted=${rowsInserted}`);
  return { rowsInserted, sourceFileId };
}

export function deletePriceSource(sourceFileId: number): { deletedRows: number } {
  const res = db.prepare(`DELETE FROM partsetu_prices WHERE source_file_id = ?`).run(sourceFileId);
  db.prepare(`DELETE FROM partsetu_price_sources WHERE id = ?`).run(sourceFileId);
  return { deletedRows: res.changes };
}

export function deleteConsumptionSource(sourceFileId: number): { deletedRows: number } {
  const res = db.prepare(`DELETE FROM partsetu_consumption WHERE source_file_id = ?`).run(sourceFileId);
  db.prepare(`DELETE FROM partsetu_consumption_sources WHERE id = ?`).run(sourceFileId);
  return { deletedRows: res.changes };
}
