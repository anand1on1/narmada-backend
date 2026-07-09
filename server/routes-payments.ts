// R27.32 — Process Payment backend.
//
// Two flows over the payment_batches / payment_batch_items / payment_batch_vendors
// tables (see runR27_32Migrations):
//   1. "Process Vendors" — list POs, aggregate their line items by vendor (rates
//      default from R9 vendor quotes), then Generate: snapshot the locked rates into
//      a batch and return a ZIP of one combined JPG slip per vendor (items grouped by
//      PO # inside).
//   2. "Assign Payments" — the payment_batch_vendors rows auto-populated on Generate;
//      mark-paid / mark-skipped / bulk-mark-paid / regenerate slip.
//
// All business logic is expressed as pure functions taking the raw better-sqlite3
// handle so the test suite can exercise them directly (the project has no HTTP test
// harness). The Express handlers are thin wrappers that add auth + I/O.
import type { Express, Request, Response, NextFunction } from "express";
import type { Database } from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { createCanvas } from "canvas";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
export const PAYMENT_ROLES = ["admin", "procurement", "finance"] as const;
export type PaymentRole = (typeof PAYMENT_ROLES)[number];
export function hasPaymentAccess(role: string | undefined | null): boolean {
  return !!role && (PAYMENT_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PoListFilters {
  client_id?: number;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD (inclusive)
  status?: string;
}
export interface AggregateItem {
  po_item_id: number | null;
  item_name: string;
  qty: number;
  rate_default: number;
  amount: number;
}
export interface GenerateVendorInput {
  vendor_name: string;
  items: Array<{
    po_id: number;
    po_item_id?: number | null;
    item_name: string;
    qty: number;
    rate_locked: number;
    amount_locked?: number;
  }>;
}
export interface Actor { userId: number | null; userName: string; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Indian-grouped rupee formatting: ₹ 1,23,456.00
export function formatINR(n: number): string {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  let out: string;
  if (intPart.length <= 3) {
    out = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${neg ? "-" : ""}₹ ${out}.${decPart}`;
}

// YYYY-MM-DD (start or end of day) → ms epoch.
function dayToEpoch(day: string, endOfDay = false): number | null {
  if (!day) return null;
  const ts = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`).getTime();
  return isNaN(ts) ? null : ts;
}

function epochToDay(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function itemName(row: any): string {
  return (row.description || row.part_number || row.brand || "Item").toString();
}

// Resolve the vendor + default rate for a single po_items row, checking (first hit wins):
//   Vendor name:
//     1. R9 approved quote (approved_quote_id → po_item_vendor_quotes.vendor_name)
//     2. R9 latest quote for this po_item_id (same fallback query)
//     3. quote.vendor_id → vendors.name (when a quote has an id but no name)
//     4. R8 legacy — po_items.vendor_name on the item row
//     5. R8 legacy — po_items.vendor_id → vendors.name
//     6. approved_vendor_id → vendors.name
//     7. "Unassigned"
//   Rate:
//     1. R9 approved quote rate
//     2. R9 latest quote rate
//     3. R8 legacy — po_items.vendor_rate (when non-null and > 0)
//     4. po_items.purchase_cost
//     5. 0
function resolveItemVendorRate(db: Database, item: any): { vendor_name: string; rate_default: number } {
  let quote: any = null;
  if (item.approved_quote_id) {
    quote = db.prepare(`SELECT vendor_name, vendor_id, rate FROM po_item_vendor_quotes WHERE id = ?`).get(item.approved_quote_id);
  }
  if (!quote) {
    quote = db.prepare(
      `SELECT vendor_name, vendor_id, rate FROM po_item_vendor_quotes
       WHERE po_item_id = ?
       ORDER BY (approved_at IS NOT NULL) DESC, (received_at IS NOT NULL) DESC, received_at DESC, id DESC
       LIMIT 1`,
    ).get(item.po_item_id ?? item.id);
  }
  let vendor_name: string | null = quote?.vendor_name || null;
  if (!vendor_name && quote?.vendor_id) {
    const v: any = db.prepare(`SELECT name FROM vendors WHERE id = ?`).get(quote.vendor_id);
    vendor_name = v?.name || null;
  }
  // R8 legacy fallbacks
  if (!vendor_name && item.vendor_name) {
    vendor_name = String(item.vendor_name) || null;
  }
  if (!vendor_name && item.vendor_id) {
    const v: any = db.prepare(`SELECT name FROM vendors WHERE id = ?`).get(item.vendor_id);
    vendor_name = v?.name || null;
  }
  if (!vendor_name && item.approved_vendor_id) {
    const v: any = db.prepare(`SELECT name FROM vendors WHERE id = ?`).get(item.approved_vendor_id);
    vendor_name = v?.name || null;
  }
  if (!vendor_name) vendor_name = "Unassigned";
  let rate = quote?.rate;
  if (rate === undefined || rate === null) {
    const r8 = Number(item.vendor_rate);
    if (item.vendor_rate !== undefined && item.vendor_rate !== null && r8 > 0) rate = r8;
  }
  if (rate === undefined || rate === null) rate = item.purchase_cost;
  if (rate === undefined || rate === null) rate = 0;
  return { vendor_name, rate_default: Number(rate) || 0 };
}

// ---------------------------------------------------------------------------
// Query / mutation functions
// ---------------------------------------------------------------------------

export function listPaymentPos(db: Database, filters: PoListFilters = {}): any[] {
  const where: string[] = [];
  const params: any[] = [];
  if (filters.client_id != null) { where.push(`po.customer_id = ?`); params.push(filters.client_id); }
  if (filters.status) { where.push(`po.status = ?`); params.push(filters.status); }
  const from = filters.date_from ? dayToEpoch(filters.date_from, false) : null;
  const to = filters.date_to ? dayToEpoch(filters.date_to, true) : null;
  if (from != null) { where.push(`po.created_at >= ?`); params.push(from); }
  if (to != null) { where.push(`po.created_at <= ?`); params.push(to); }
  const sql = `
    SELECT po.id, po.po_number, po.customer_id, po.status, po.total, po.created_at,
           c.name AS client_name
    FROM purchase_orders_v2 po
    LEFT JOIN customers c ON c.id = po.customer_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY po.created_at DESC, po.id DESC`;
  const rows = db.prepare(sql).all(...params) as any[];

  const inBatch = db.prepare(`SELECT 1 FROM payment_batch_items WHERE po_id = ? LIMIT 1`);
  const lastSlip = db.prepare(
    `SELECT b.slip_number FROM payment_batch_items i
     JOIN payment_batches b ON b.id = i.batch_id
     WHERE i.po_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT 1`,
  );
  // Count DISTINCT real vendors, mirroring the resolver's chain (R9 quote → R8 vendor_name/
  // vendor_id → approved_vendor_id). COALESCE returns NULL when every source is NULL, and
  // COUNT(DISTINCT ...) ignores NULLs — so c = 0 means no item has a real vendor and the PO
  // is unpayable. "Unassigned" is never counted.
  const vendorCount = db.prepare(
    `SELECT COUNT(DISTINCT COALESCE(q.vendor_name, v_q.name, pi.vendor_name, v_pi.name, v_approved.name)) AS c
     FROM po_items pi
     LEFT JOIN po_item_vendor_quotes q ON q.po_item_id = pi.id
     LEFT JOIN vendors v_q ON v_q.id = q.vendor_id
     LEFT JOIN vendors v_pi ON v_pi.id = pi.vendor_id
     LEFT JOIN vendors v_approved ON v_approved.id = pi.approved_vendor_id
     WHERE pi.po_id = ?`,
  );

  return rows
    .map((r) => {
      const already = !!inBatch.get(r.id);
      const count = (vendorCount.get(r.id) as any)?.c || 0;
      return {
        id: r.id,
        po_number: r.po_number,
        client_id: r.customer_id,
        client_name: r.client_name || null,
        created_at: epochToDay(r.created_at),
        status: r.status,
        total_amount: Number(r.total) || 0,
        vendor_count: count,
        already_in_batch: already,
        last_batch_slip: already ? ((lastSlip.get(r.id) as any)?.slip_number || null) : null,
      };
    })
    .filter((r) => r.vendor_count > 0);
}

export function aggregateVendors(db: Database, poIds: number[]): { vendors: any[] } {
  const vendorMap = new Map<string, { pos: Map<number, any>; total: number }>();
  const getPoRow = db.prepare(`SELECT id, po_number FROM purchase_orders_v2 WHERE id = ?`);
  const getItems = db.prepare(
    `SELECT id, po_id, part_number, brand, description, qty, purchase_cost, approved_vendor_id, approved_quote_id,
            vendor_id, vendor_name, vendor_rate
     FROM po_items WHERE po_id = ?`,
  );

  for (const poId of poIds) {
    const po: any = getPoRow.get(poId);
    if (!po) continue;
    const items = getItems.all(poId) as any[];
    for (const it of items) {
      const { vendor_name, rate_default } = resolveItemVendorRate(db, { ...it, po_item_id: it.id });
      const qty = Number(it.qty) || 0;
      const amount = Math.round(qty * rate_default * 100) / 100;
      if (!vendorMap.has(vendor_name)) vendorMap.set(vendor_name, { pos: new Map(), total: 0 });
      const vEntry = vendorMap.get(vendor_name)!;
      if (!vEntry.pos.has(poId)) vEntry.pos.set(poId, { po_id: poId, po_number: po.po_number, items: [] });
      vEntry.pos.get(poId)!.items.push({
        po_item_id: it.id,
        item_name: itemName(it),
        qty,
        rate_default,
        amount,
      });
      vEntry.total += amount;
    }
  }

  const lastBatch = db.prepare(
    `SELECT b.slip_number, b.created_at FROM payment_batch_items i
     JOIN payment_batches b ON b.id = i.batch_id
     WHERE i.vendor_name = ? ORDER BY b.created_at DESC, b.id DESC LIMIT 1`,
  );

  const vendors = Array.from(vendorMap.entries()).map(([vendor_name, entry]) => {
    const pos = Array.from(entry.pos.values());
    const itemIds = pos.flatMap((p) => p.items.map((i: any) => i.po_item_id)).filter((x) => x != null);
    let already_processed = false;
    if (itemIds.length) {
      const placeholders = itemIds.map(() => "?").join(",");
      const hit = db.prepare(
        `SELECT 1 FROM payment_batch_items WHERE vendor_name = ? AND po_item_id IN (${placeholders}) LIMIT 1`,
      ).get(vendor_name, ...itemIds);
      already_processed = !!hit;
    }
    const last: any = lastBatch.get(vendor_name);
    return {
      vendor_name,
      already_processed,
      last_slip_number: last?.slip_number || null,
      last_batch_date: last ? epochToDay(last.created_at) : null,
      pos,
      vendor_total: Math.round(entry.total * 100) / 100,
    };
  });

  return { vendors };
}

// Next PMT/{year}/{NNNN} slip number. Caller should wrap in the same transaction as
// the batch insert to avoid a race.
export function nextSlipNumber(db: Database, year: number = new Date().getFullYear()): string {
  const prefix = `PMT/${year}/`;
  const rows = db.prepare(`SELECT slip_number FROM payment_batches WHERE slip_number LIKE ?`).all(`${prefix}%`) as any[];
  let max = 0;
  for (const r of rows) {
    const m = /\/(\d+)$/.exec(r.slip_number || "");
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export interface GeneratedBatch {
  batch_id: number;
  slip_number: string;
  created_at: number;
  vendors: Array<{ vendor_id: number; vendor_name: string; total_amount: number; po_numbers: string }>;
}

export function generateBatch(
  db: Database,
  input: { notes?: string; vendors: GenerateVendorInput[] },
  actor: Actor,
): GeneratedBatch {
  const vendors = input.vendors || [];
  if (!vendors.length) throw new Error("At least one vendor is required");

  const tx = db.transaction(() => {
    const now = Date.now();
    const slip = nextSlipNumber(db, new Date(now).getFullYear());

    const allItems = vendors.flatMap((v) => v.items || []);
    const poIds = new Set(allItems.map((i) => i.po_id));
    let total = 0;
    for (const it of allItems) {
      const amt = it.amount_locked != null ? it.amount_locked : (Number(it.qty) || 0) * (Number(it.rate_locked) || 0);
      total += amt;
    }
    total = Math.round(total * 100) / 100;

    const batchRes = db.prepare(
      `INSERT INTO payment_batches (slip_number, created_by, created_by_name, notes, created_at, vendor_count, po_count, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(slip, actor.userId, actor.userName, input.notes || null, now, vendors.length, poIds.size, total);
    const batchId = Number(batchRes.lastInsertRowid);

    const poNumberCache = new Map<number, string>();
    const poNumberOf = (poId: number): string => {
      if (poNumberCache.has(poId)) return poNumberCache.get(poId)!;
      const row: any = db.prepare(`SELECT po_number FROM purchase_orders_v2 WHERE id = ?`).get(poId);
      const num = row?.po_number || `PO#${poId}`;
      poNumberCache.set(poId, num);
      return num;
    };

    const insItem = db.prepare(
      `INSERT INTO payment_batch_items (batch_id, po_id, po_number, po_item_id, vendor_name, item_name, qty, rate_locked, amount_locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insVendor = db.prepare(
      `INSERT INTO payment_batch_vendors (batch_id, vendor_name, total_amount, status, po_numbers)
       VALUES (?, ?, ?, 'pending', ?)`,
    );

    const outVendors: GeneratedBatch["vendors"] = [];
    for (const v of vendors) {
      let vendorTotal = 0;
      const poNums = new Set<string>();
      for (const it of (v.items || [])) {
        const qty = Number(it.qty) || 0;
        const rate = Number(it.rate_locked) || 0;
        const amount = it.amount_locked != null ? it.amount_locked : Math.round(qty * rate * 100) / 100;
        const poNum = poNumberOf(it.po_id);
        poNums.add(poNum);
        insItem.run(batchId, it.po_id, poNum, it.po_item_id ?? null, v.vendor_name, it.item_name, qty, rate, amount);
        vendorTotal += amount;
      }
      vendorTotal = Math.round(vendorTotal * 100) / 100;
      const poNumbers = Array.from(poNums).join(", ");
      const vres = insVendor.run(batchId, v.vendor_name, vendorTotal, poNumbers);
      outVendors.push({
        vendor_id: Number(vres.lastInsertRowid),
        vendor_name: v.vendor_name,
        total_amount: vendorTotal,
        po_numbers: poNumbers,
      });
    }

    return { batch_id: batchId, slip_number: slip, created_at: now, vendors: outVendors };
  });

  return tx();
}

export interface BatchListFilters {
  status?: string; // all | pending | paid | skipped
  date_from?: string;
  date_to?: string;
  vendor_search?: string;
  limit?: number;
  offset?: number;
}

export function listBatchVendors(db: Database, filters: BatchListFilters = {}): any[] {
  const where: string[] = [];
  const params: any[] = [];
  if (filters.status && filters.status !== "all") { where.push(`bv.status = ?`); params.push(filters.status); }
  const from = filters.date_from ? dayToEpoch(filters.date_from, false) : null;
  const to = filters.date_to ? dayToEpoch(filters.date_to, true) : null;
  if (from != null) { where.push(`b.created_at >= ?`); params.push(from); }
  if (to != null) { where.push(`b.created_at <= ?`); params.push(to); }
  if (filters.vendor_search) { where.push(`bv.vendor_name LIKE ?`); params.push(`%${filters.vendor_search}%`); }
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 100;
  const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;
  const sql = `
    SELECT bv.*, b.slip_number, b.created_at AS batch_created_at, b.notes AS batch_notes
    FROM payment_batch_vendors bv
    JOIN payment_batches b ON b.id = bv.batch_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY b.created_at DESC, bv.id DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit, offset) as any[];
  return rows.map((r) => ({ ...r, batch_date: epochToDay(r.batch_created_at) }));
}

export function getBatchVendor(db: Database, vendorId: number): any {
  return db.prepare(
    `SELECT bv.*, b.slip_number, b.created_at AS batch_created_at, b.notes AS batch_notes, b.created_by_name
     FROM payment_batch_vendors bv JOIN payment_batches b ON b.id = bv.batch_id
     WHERE bv.id = ?`,
  ).get(vendorId);
}

export function markPaid(
  db: Database,
  vendorId: number,
  data: { paid_at?: string; proof_url?: string; notes?: string },
  actor: Actor,
): any {
  const row = getBatchVendor(db, vendorId);
  if (!row) throw new Error("Vendor payment row not found");
  const paidAt = data.paid_at ? dayToEpoch(data.paid_at, false) : Date.now();
  db.prepare(
    `UPDATE payment_batch_vendors
     SET status = 'paid', paid_at = ?, paid_by = ?, paid_by_name = ?, proof_url = ?, notes = ?
     WHERE id = ?`,
  ).run(paidAt, actor.userId, actor.userName, data.proof_url || null, data.notes ?? row.notes ?? null, vendorId);
  return getBatchVendor(db, vendorId);
}

export function markSkipped(db: Database, vendorId: number, skipReason: string): any {
  if (!skipReason || !String(skipReason).trim()) throw new Error("skip_reason is required");
  const row = getBatchVendor(db, vendorId);
  if (!row) throw new Error("Vendor payment row not found");
  db.prepare(`UPDATE payment_batch_vendors SET status = 'skipped', skip_reason = ? WHERE id = ?`)
    .run(String(skipReason).trim(), vendorId);
  return getBatchVendor(db, vendorId);
}

export function bulkMarkPaid(db: Database, vendorIds: number[], paidAt: string | undefined, actor: Actor): number {
  if (!vendorIds?.length) return 0;
  const ts = paidAt ? dayToEpoch(paidAt, false) : Date.now();
  const stmt = db.prepare(
    `UPDATE payment_batch_vendors SET status = 'paid', paid_at = ?, paid_by = ?, paid_by_name = ? WHERE id = ?`,
  );
  const tx = db.transaction((ids: number[]) => {
    let n = 0;
    for (const id of ids) { if (stmt.run(ts, actor.userId, actor.userName, id).changes > 0) n++; }
    return n;
  });
  return tx(vendorIds);
}

// ---------------------------------------------------------------------------
// JPG slip rendering (node-canvas)
// ---------------------------------------------------------------------------
export interface SlipData {
  slip_number: string;
  date: string;          // display date
  generated_by: string;
  vendor_name: string;
  pos: Array<{ po_number: string; items: Array<{ item_name: string; qty: number; rate: number; amount: number }> }>;
  grand_total: number;
}

// Assemble the slip payload for one vendor in an existing batch, reading the locked
// line-item snapshot.
export function buildSlipData(db: Database, vendorRow: any): SlipData {
  const items = db.prepare(
    `SELECT po_number, item_name, qty, rate_locked, amount_locked
     FROM payment_batch_items WHERE batch_id = ? AND vendor_name = ?
     ORDER BY po_number, id`,
  ).all(vendorRow.batch_id, vendorRow.vendor_name) as any[];
  const poMap = new Map<string, any>();
  let total = 0;
  for (const it of items) {
    const key = it.po_number || "—";
    if (!poMap.has(key)) poMap.set(key, { po_number: key, items: [] });
    poMap.get(key).items.push({
      item_name: it.item_name,
      qty: Number(it.qty) || 0,
      rate: Number(it.rate_locked) || 0,
      amount: Number(it.amount_locked) || 0,
    });
    total += Number(it.amount_locked) || 0;
  }
  return {
    slip_number: vendorRow.slip_number,
    date: epochToDay(vendorRow.batch_created_at) || epochToDay(Date.now()),
    generated_by: vendorRow.created_by_name || "—",
    vendor_name: vendorRow.vendor_name,
    pos: Array.from(poMap.values()),
    grand_total: Math.round(total * 100) / 100,
  };
}

// Render a compact combined payment slip JPG (< 800px tall for WhatsApp forwarding).
export function renderSlipJpeg(data: SlipData): Buffer {
  const W = 620;
  const rowH = 22;
  const padX = 24;
  // Measure required height first.
  let bodyRows = 0;
  for (const po of data.pos) bodyRows += 1 /*po head*/ + 1 /*col head*/ + po.items.length + 0.5;
  const H = Math.min(800, Math.max(360, Math.round(160 + bodyRows * rowH + 90)));

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header band
  ctx.fillStyle = "#0b3d2e";
  ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("NARMADA MOBILITY", padX, 26);
  ctx.font = "14px sans-serif";
  ctx.fillText("PAYMENT SLIP", padX, 48);
  ctx.textAlign = "right";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(data.slip_number, W - padX, 26);
  ctx.textAlign = "left";

  let y = 82;
  ctx.fillStyle = "#333333";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Date: ${data.date}`, padX, y);
  ctx.textAlign = "right";
  ctx.fillText(`Generated by: ${data.generated_by}`, W - padX, y);
  ctx.textAlign = "left";
  y += 26;

  // Vendor name (bold)
  ctx.fillStyle = "#000000";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(data.vendor_name, padX, y);
  y += 22;

  const colItem = padX;
  const colQty = 330;
  const colRate = 400;
  const colAmt = W - padX;

  for (const po of data.pos) {
    // PO subhead
    ctx.fillStyle = "#0b3d2e";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(po.po_number, padX, y);
    y += rowH - 4;
    // Column heads
    ctx.fillStyle = "#666666";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("Item", colItem, y);
    ctx.textAlign = "right";
    ctx.fillText("Qty", colQty, y);
    ctx.fillText("Rate", colRate + 40, y);
    ctx.fillText("Amount", colAmt, y);
    ctx.textAlign = "left";
    y += 6;
    ctx.strokeStyle = "#dddddd";
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
    y += rowH - 8;
    // Items
    ctx.fillStyle = "#000000";
    ctx.font = "12px sans-serif";
    for (const it of po.items) {
      const name = it.item_name.length > 40 ? it.item_name.slice(0, 39) + "…" : it.item_name;
      ctx.fillText(name, colItem, y);
      ctx.textAlign = "right";
      ctx.fillText(String(it.qty), colQty, y);
      ctx.fillText(formatINR(it.rate), colRate + 40, y);
      ctx.fillText(formatINR(it.amount), colAmt, y);
      ctx.textAlign = "left";
      y += rowH;
    }
    y += 6;
  }

  // Grand total
  ctx.strokeStyle = "#0b3d2e";
  ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
  y += 22;
  ctx.fillStyle = "#000000";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`Grand Total: ${formatINR(data.grand_total)}`, colAmt, y);
  ctx.textAlign = "left";

  // Footer
  ctx.fillStyle = "#888888";
  ctx.font = "10px sans-serif";
  ctx.fillText("Narmada Mobility · Internal Payment Request", padX, H - 14);

  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

export function slugifyVendor(name: string): string {
  return (name || "vendor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "vendor";
}

// ---------------------------------------------------------------------------
// ZIP (store / no-compression) builder — pure JS, no dependency.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0, 6);        // flags
    local.writeUInt16LE(8, 8);        // method: deflate
    local.writeUInt16LE(0, 10);       // mod time
    local.writeUInt16LE(0, 12);       // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);       // extra len
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);     // version made by
    central.writeUInt16LE(20, 6);     // version needed
    central.writeUInt16LE(0, 8);      // flags
    central.writeUInt16LE(8, 10);     // method
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);     // extra
    central.writeUInt16LE(0, 32);     // comment
    central.writeUInt16LE(0, 34);     // disk
    central.writeUInt16LE(0, 36);     // internal attrs
    central.writeUInt32LE(0, 38);     // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

// Build the ZIP of one JPG per vendor for a freshly generated batch.
export function buildBatchSlipZip(db: Database, batchId: number): { slip_number: string; files: Array<{ name: string; data: Buffer }>; zip: Buffer } {
  const batch: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(batchId);
  if (!batch) throw new Error("Batch not found");
  const vendors = db.prepare(`SELECT * FROM payment_batch_vendors WHERE batch_id = ? ORDER BY id`).all(batchId) as any[];
  const files: Array<{ name: string; data: Buffer }> = [];
  for (const v of vendors) {
    const slipData = buildSlipData(db, {
      ...v,
      slip_number: batch.slip_number,
      batch_created_at: batch.created_at,
      created_by_name: batch.created_by_name,
    });
    const jpg = renderSlipJpeg(slipData);
    files.push({ name: `${batch.slip_number.replace(/\//g, "-")}_${slugifyVendor(v.vendor_name)}.jpg`, data: jpg });
  }
  return { slip_number: batch.slip_number, files, zip: buildZip(files) };
}

// One-shot: generate the batch then produce the ZIP + file list. Used by the endpoint
// and exercised directly by the tests.
export function generateBatchWithSlips(
  db: Database,
  input: { notes?: string; vendors: GenerateVendorInput[] },
  actor: Actor,
): { batch: GeneratedBatch; files: Array<{ name: string; data: Buffer }>; zip: Buffer } {
  const batch = generateBatch(db, input, actor);
  const { files, zip } = buildBatchSlipZip(db, batch.batch_id);
  return { batch, files, zip };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export interface PaymentRoutesDeps {
  db: Database;
  uploadsDir: string;
  // requireRole(...roles) middleware factory from routes-v2 (admin always passes).
  requireRole: (...roles: any[]) => (req: Request, res: Response, next: NextFunction) => void;
  resolveActor: (req: Request) => Actor;
}

export function registerPaymentRoutes(app: Express, deps: PaymentRoutesDeps) {
  const { db, uploadsDir, requireRole, resolveActor } = deps;
  const guard = requireRole("procurement", "finance"); // admin auto-passes inside requireRole
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  app.get("/api/payments/pos", guard, (req, res) => {
    try {
      const q = req.query as any;
      const rows = listPaymentPos(db, {
        client_id: q.client_id != null && q.client_id !== "" ? parseInt(String(q.client_id), 10) : undefined,
        date_from: q.date_from || undefined,
        date_to: q.date_to || undefined,
        status: q.status || undefined,
      });
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/payments/aggregate", guard, (req, res) => {
    try {
      const poIds: number[] = (req.body?.po_ids || []).map((n: any) => parseInt(n, 10)).filter((n: number) => !isNaN(n));
      res.json(aggregateVendors(db, poIds));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/payments/generate", guard, (req, res) => {
    try {
      const actor = resolveActor(req);
      const { batch, files, zip } = generateBatchWithSlips(db, req.body || {}, actor);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${batch.slip_number.replace(/\//g, "-")}.zip"`);
      res.setHeader("X-Slip-Number", batch.slip_number);
      res.setHeader("X-Slip-Files", String(files.length));
      res.send(zip);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/payments/batches", guard, (req, res) => {
    try {
      const q = req.query as any;
      res.json(listBatchVendors(db, {
        status: q.status || undefined,
        date_from: q.date_from || undefined,
        date_to: q.date_to || undefined,
        vendor_search: q.vendor_search || undefined,
        limit: q.limit ? parseInt(String(q.limit), 10) : undefined,
        offset: q.offset ? parseInt(String(q.offset), 10) : undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/payments/batches/:vendor_id/slip", guard, (req, res) => {
    try {
      const row = getBatchVendor(db, parseInt(String(req.params.vendor_id), 10));
      if (!row) return res.status(404).json({ error: "Not found" });
      const jpg = renderSlipJpeg(buildSlipData(db, { ...row, batch_created_at: row.batch_created_at }));
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", `inline; filename="${row.slip_number.replace(/\//g, "-")}_${slugifyVendor(row.vendor_name)}.jpg"`);
      res.send(jpg);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/payments/batches/:vendor_id/mark-paid", guard, (req, res) => {
    try {
      const actor = resolveActor(req);
      res.json(markPaid(db, parseInt(String(req.params.vendor_id), 10), req.body || {}, actor));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/payments/batches/:vendor_id/mark-skipped", guard, (req, res) => {
    try {
      res.json(markSkipped(db, parseInt(String(req.params.vendor_id), 10), req.body?.skip_reason));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/payments/batches/bulk-mark-paid", guard, (req, res) => {
    try {
      const actor = resolveActor(req);
      const ids: number[] = (req.body?.vendor_ids || []).map((n: any) => parseInt(n, 10)).filter((n: number) => !isNaN(n));
      const updated = bulkMarkPaid(db, ids, req.body?.paid_at, actor);
      res.json({ updated });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/payments/proof-upload", guard, upload.single("proof"), (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "Missing proof file" });
      const extMap: Record<string, string> = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        "image/webp": "webp", "application/pdf": "pdf",
      };
      const ext = extMap[file.mimetype] || "bin";
      const name = `proof_${randomBytes(8).toString("hex")}.${ext}`;
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, name), file.buffer);
      res.json({ proof_url: `/uploads/${name}` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
