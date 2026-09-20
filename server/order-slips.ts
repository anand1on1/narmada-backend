import type { Database } from "better-sqlite3";
import type { Express, RequestHandler } from "express";
import { createCanvas } from "canvas";
import { buildZip, slugifyVendor } from "./routes-payments";

export const MAX_SLIP_POS = 100;
const MAX_LINES = 1000;
export interface OrderSlipRow { productName: string; poLastFour: string; quantity: number }
export interface OrderSlipVendor { vendorName: string; rows: OrderSlipRow[] }
export interface OrderSlipPayload { vendors: OrderSlipVendor[]; warnings: string[] }

export class OrderSlipError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validateOrderSlipIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SLIP_POS ||
      value.some(id => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
    throw new OrderSlipError(`Select between 1 and ${MAX_SLIP_POS} valid purchase orders.`);
  }
  return Array.from(new Set(value));
}

// Intentionally NOT a PO detail serializer: only allowlisted columns are read
// and only vendor identity + product name + four digits + quantity leave here.
export function collectOrderSlips(db: Database, value: unknown): OrderSlipPayload {
  const ids = validateOrderSlipIds(value);
  const placeholders = ids.map(() => "?").join(",");
  const found = db.prepare(`SELECT id FROM purchase_orders_v2 WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...ids);
  if (found.length !== ids.length) throw new OrderSlipError("One or more selected purchase orders no longer exist. Refresh the list.", 404);
  const rows = db.prepare(`
    SELECT pi.description, pi.part_number, pi.qty, po.po_number,
           COALESCE(pi.approved_vendor_id, pi.vendor_id, q.vendor_id) AS vendor_id,
           COALESCE(NULLIF(v.name, ''), NULLIF(q.vendor_name, ''), NULLIF(pi.vendor_name, '')) AS vendor_name
    FROM po_items pi JOIN purchase_orders_v2 po ON po.id = pi.po_id
    LEFT JOIN po_item_vendor_quotes q ON q.id = pi.approved_quote_id AND q.po_item_id = pi.id
    LEFT JOIN vendors v ON v.id = COALESCE(pi.approved_vendor_id, pi.vendor_id, q.vendor_id)
    WHERE pi.po_id IN (${placeholders}) AND pi.deleted_at IS NULL
    ORDER BY po.id, pi.id LIMIT ?
  `).all(...ids, MAX_LINES + 1) as Array<{
    description: string | null; part_number: string | null; qty: number;
    po_number: string; vendor_id: number | null; vendor_name: string | null;
  }>;
  if (rows.length > MAX_LINES) throw new OrderSlipError(`This batch exceeds ${MAX_LINES} lines. Select fewer purchase orders.`);
  const vendors = new Map<string, OrderSlipVendor>();
  const warnings: string[] = [];
  let missing = 0, invalid = 0;
  for (const row of rows) {
    const name = row.vendor_name?.trim();
    if (!name) { missing++; continue; }
    if (!Number.isFinite(row.qty) || row.qty <= 0) { invalid++; continue; }
    // The schema has one assigned/approved vendor per PO line; quotes have no
    // allocated quantity. qty is the current vendor-order quantity (not
    // original_qty, stock, payment overrides, or the number of quoted vendors).
    const key = row.vendor_id ? `id:${row.vendor_id}` : `name:${name.toLowerCase()}`;
    if (!vendors.has(key)) vendors.set(key, { vendorName: name, rows: [] });
    vendors.get(key)!.rows.push({
      productName: row.description?.trim() || row.part_number?.trim() || "Unnamed product",
      poLastFour: String(row.po_number).replace(/\D/g, "").slice(-4),
      quantity: row.qty,
    });
  }
  if (missing) warnings.push(`${missing} line(s) excluded: no identifiable assigned vendor. Assign a vendor and try again.`);
  if (invalid) warnings.push(`${invalid} line(s) excluded: quantity must be finite and greater than zero.`);
  if (!rows.length) warnings.push("The selected purchase orders have no active line items.");
  if (vendors.size > 100) throw new OrderSlipError("This batch exceeds 100 vendors. Select fewer purchase orders.");
  return { vendors: Array.from(vendors.values()), warnings };
}

// Same payment-slip palette, canvas/JPEG stack and ZIP writer; deliberately
// separate renderer so adding order slips cannot change the payment document.
export function renderOrderSlipImages(vendor: OrderSlipVendor): Buffer[] {
  const W = 900, maxHeight = 1600, pad = 28, lineH = 25;
  const measure = createCanvas(W, 1).getContext("2d");
  measure.font = "18px sans-serif";
  function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const char of text.replace(/[\r\n\t]/g, " ")) {
      if (line && measure.measureText(line + char).width > width) { lines.push(line); line = ""; }
      line += char;
    }
    lines.push(line);
    return lines;
  }
  const vendorLines = wrap(vendor.vendorName, W - pad * 2);
  if (vendorLines.length > 12) throw new OrderSlipError("A vendor name is too long to render safely. Shorten it before exporting.");
  const top = 105 + vendorLines.length * lineH + 45;
  const pages: Array<Array<{ row: OrderSlipRow; lines: string[]; height: number }>> = [[]];
  let height = top;
  for (const row of vendor.rows) {
    const lines = wrap(row.productName, 540);
    const rowHeight = Math.max(48, lines.length * lineH + 18);
    if (top + rowHeight > maxHeight) throw new OrderSlipError("A product name is too long to render safely. Shorten it before exporting.");
    if (height + rowHeight > maxHeight - 35) { pages.push([]); height = top; }
    if (pages.length > 100) throw new OrderSlipError("This vendor needs more than 100 images. Select fewer purchase orders.");
    pages[pages.length - 1].push({ row, lines, height: rowHeight });
    height += rowHeight;
  }
  return pages.map((page, index) => {
    const H = top + page.reduce((sum, row) => sum + row.height, 0) + 35;
    const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#0b3d2e"; ctx.fillRect(0, 0, W, 78);
    ctx.fillStyle = "#fff"; ctx.font = "bold 24px sans-serif";
    ctx.fillText("NARMADA MOBILITY", pad, 32);
    ctx.font = "18px sans-serif"; ctx.fillText(`ORDER SLIP · ${index + 1}/${pages.length}`, pad, 61);
    ctx.fillStyle = "#222"; ctx.font = "18px sans-serif";
    vendorLines.forEach((line, i) => ctx.fillText(line, pad, 105 + i * lineH));
    let y = top - 32;
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("Product name", pad, y); ctx.fillText("PO last 4", 610, y); ctx.fillText("Quantity", 758, y);
    y = top;
    page.forEach(({ row, lines, height }, i) => {
      ctx.fillStyle = i % 2 ? "#f1f5f3" : "#fff"; ctx.fillRect(pad - 8, y - 20, W - 2 * pad + 16, height);
      ctx.fillStyle = "#222"; ctx.font = "18px sans-serif";
      lines.forEach((line, j) => ctx.fillText(line, pad, y + j * lineH));
      ctx.fillText(row.poLastFour || "—", 610, y);
      ctx.fillText(String(row.quantity), 758, y, 110);
      y += height;
    });
    return canvas.toBuffer("image/jpeg", { quality: 0.92 });
  });
}

export function buildOrderSlipZip(payload: OrderSlipPayload) {
  const files: Array<{ name: string; data: Buffer }> = [];
  payload.vendors.forEach((vendor, i) => {
    renderOrderSlipImages(vendor).forEach((data, page) => files.push({
      name: `${String(i + 1).padStart(3, "0")}-${slugifyVendor(vendor.vendorName).slice(0, 60)}-${page + 1}.jpg`, data,
    }));
    if (files.length > 100) throw new OrderSlipError("This batch exceeds 100 images. Select fewer purchase orders.");
  });
  if (payload.warnings.length) files.push({ name: "excluded-lines.txt", data: Buffer.from(payload.warnings.join("\n")) });
  return { files, zip: buildZip(files) };
}

export function registerOrderSlipRoutes(app: Express, db: Database, guard: RequestHandler) {
  app.post("/api/team/purchase-orders/order-slips", guard, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const payload = collectOrderSlips(db, req.body?.poIds);
      if (req.body?.format !== "zip") return res.json(payload);
      if (!payload.vendors.length) throw new OrderSlipError(payload.warnings.join(" ") || "No eligible vendor lines found.");
      const { zip } = buildOrderSlipZip(payload);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="order-slips.zip"');
      return res.send(zip);
    } catch (e) {
      if (e instanceof OrderSlipError) return res.status(e.status).json({ error: e.message });
      console.error("[order-slips] export failed", e);
      return res.status(500).json({ error: "Unable to generate order slips. Please try a smaller selection or retry." });
    }
  });
}
