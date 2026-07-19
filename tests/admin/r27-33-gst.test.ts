// R27.33 — Per-vendor GST in Process Payment.
//
// Verifies the GST math locked at generation time (subtotal / gst_amount /
// total_with_gst per vendor), the 0% path, per-vendor variance within one batch,
// slip rendering that only shows GST rows when GST applies, and backward
// compatibility for pre-R27.33 vendor rows.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  generateBatch, buildSlipData, renderSlipJpeg, formatGstPct,
  type GenerateVendorInput, type Actor,
} from "../../server/routes-payments";

const ACTOR: Actor = { userId: null, userName: "Test Admin" };
const day = (d: string) => new Date(`${d}T09:00:00.000`).getTime();

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_32Migrations();
  migrations.runR27_33Migrations();
});

function seedBase() {
  for (const t of ["payment_batch_items", "payment_batch_vendors", "payment_batches",
                   "po_item_vendor_quotes", "po_items", "purchase_orders_v2", "customers", "vendors"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(42, "SRSC INFRA", day("2026-06-21"));
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(184, "NM/PO/26/0099", 42, "approved", 45000, day("2026-06-21"));
}
beforeEach(seedBase);

const bosch = (gst?: number): GenerateVendorInput => ({
  vendor_name: "Bosch India",
  gst_percent: gst,
  items: [{ po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 }], // subtotal 1700
});

function vendorRow(batchId: number, name: string): any {
  return db.prepare(
    `SELECT bv.*, b.slip_number, b.created_at AS batch_created_at, b.created_by_name
     FROM payment_batch_vendors bv JOIN payment_batches b ON b.id = bv.batch_id
     WHERE bv.batch_id = ? AND bv.vendor_name = ?`,
  ).get(batchId, name);
}

describe("R27.33 — GST math", () => {
  it("computes subtotal / gst_amount / total_with_gst at 18%", () => {
    const res = generateBatch(db, { vendors: [bosch(18)] }, ACTOR);
    const v = res.vendors[0];
    expect(v.subtotal).toBe(1700);
    expect(v.gst_percent).toBe(18);
    expect(v.gst_amount).toBe(306);        // 1700 * 0.18
    expect(v.total_with_gst).toBe(2006);
    expect(v.total_amount).toBe(2006);     // payable figure includes GST
  });

  it("persists the locked GST columns on the vendor row", () => {
    const res = generateBatch(db, { vendors: [bosch(12)] }, ACTOR);
    const row = vendorRow(res.batch_id, "Bosch India");
    expect(row.gst_percent).toBe(12);
    expect(row.subtotal).toBe(1700);
    expect(row.gst_amount).toBe(204);
    expect(row.total_with_gst).toBe(1904);
  });

  it("stores gst_default_percent on the batch", () => {
    const res = generateBatch(db, { gst_default_percent: 18, vendors: [bosch()] }, ACTOR);
    const batch: any = db.prepare(`SELECT gst_default_percent FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(batch.gst_default_percent).toBe(18);
    // Vendor with no explicit gst inherits the batch default.
    expect(res.vendors[0].gst_percent).toBe(18);
    expect(res.vendors[0].gst_amount).toBe(306);
  });

  it("0% GST computes zero tax but keeps the subtotal", () => {
    const res = generateBatch(db, { vendors: [bosch(0)] }, ACTOR);
    const v = res.vendors[0];
    expect(v.gst_amount).toBe(0);
    expect(v.total_with_gst).toBe(1700);
  });

  it("GST omitted entirely behaves like R27.32 (no tax)", () => {
    const res = generateBatch(db, { vendors: [bosch()] }, ACTOR);
    expect(res.vendors[0].gst_amount).toBe(0);
    expect(res.vendors[0].total_with_gst).toBe(1700);
  });

  it("supports per-vendor GST variance in one batch", () => {
    const res = generateBatch(db, { vendors: [
      { vendor_name: "Bosch India", gst_percent: 18, items: [{ po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 }] },
      { vendor_name: "Delphi", gst_percent: 5, items: [{ po_id: 184, po_item_id: 602, item_name: "Oil filter", qty: 1, rate_locked: 300 }] },
    ] }, ACTOR);
    const b = res.vendors.find((v) => v.vendor_name === "Bosch India")!;
    const d = res.vendors.find((v) => v.vendor_name === "Delphi")!;
    expect(b.total_with_gst).toBe(2006); // 1700 + 18%
    expect(d.total_with_gst).toBe(315);  // 300 + 5%
    // Batch total is the sum of GST-inclusive vendor totals.
    const batch: any = db.prepare(`SELECT total_amount FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(batch.total_amount).toBe(2321);
  });
});

describe("R27.33 — slip rendering", () => {
  it("renders a JPEG (SOI marker) with GST applied", () => {
    const res = generateBatch(db, { vendors: [bosch(18)] }, ACTOR);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.subtotal).toBe(1700);
    expect(data.gst_amount).toBe(306);
    expect(data.grand_total).toBe(2006);
    const jpg = renderSlipJpeg(data);
    expect(jpg.slice(0, 2).toString("hex")).toBe("ffd8");
  });

  it("a 0% GST slip has grand_total == subtotal and still renders", () => {
    const res = generateBatch(db, { vendors: [bosch(0)] }, ACTOR);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.gst_amount).toBe(0);
    expect(data.grand_total).toBe(data.subtotal);
    expect(renderSlipJpeg(data).slice(0, 2).toString("hex")).toBe("ffd8");
  });

  it("old (pre-R27.33) vendor rows render with no GST", () => {
    // Simulate an R27.32-era row: gst columns backfilled to the DEFAULT 18 percent
    // but with a zero gst_amount (buildSlipData must key off gst_amount, not percent).
    const res = generateBatch(db, { vendors: [bosch()] }, ACTOR);
    db.prepare(`UPDATE payment_batch_vendors SET gst_percent = 18, gst_amount = 0, total_with_gst = 0 WHERE batch_id = ?`)
      .run(res.batch_id);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.gst_amount).toBe(0);
    expect(data.grand_total).toBe(1700); // subtotal only
  });
});

describe("R27.33 — formatGstPct", () => {
  it("drops decimals for whole percents and trims trailing zeros", () => {
    expect(formatGstPct(18)).toBe("18");
    expect(formatGstPct(0)).toBe("0");
    expect(formatGstPct(12.5)).toBe("12.5");
  });
});
