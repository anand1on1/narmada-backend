// R27.33a — GST inclusive / exclusive mode per vendor.
//
// Fix 2: each vendor picks a GST mode. "exclusive" (default, = R27.33) treats the
// entered rate as pre-tax and adds GST on top; "inclusive" treats the entered rate
// as GST-inclusive and extracts the taxable value back out. Verifies the math both
// ways, the default, DB persistence, per-vendor variance in one batch, and slip
// rendering.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  generateBatch, buildSlipData, renderSlipJpeg,
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
  migrations.runR27_33aMigrations();
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

function vendorRow(batchId: number, name: string): any {
  return db.prepare(
    `SELECT bv.*, b.slip_number, b.created_at AS batch_created_at, b.created_by_name
     FROM payment_batch_vendors bv JOIN payment_batches b ON b.id = bv.batch_id
     WHERE bv.batch_id = ? AND bv.vendor_name = ?`,
  ).get(batchId, name);
}

describe("R27.33a — GST mode math", () => {
  it("exclusive: rate 100 × qty 10 × 18% → subtotal 1000, gst 180, total 1180", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "exclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 100 }],
    }] }, ACTOR);
    const v = res.vendors[0];
    expect(v.gst_mode).toBe("exclusive");
    expect(v.subtotal).toBe(1000);
    expect(v.gst_amount).toBe(180);
    expect(v.total_with_gst).toBe(1180);
  });

  it("inclusive: rate 118 × qty 10 @18% incl → total 1180, subtotal 1000, gst 180", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "inclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 118 }],
    }] }, ACTOR);
    const v = res.vendors[0];
    expect(v.gst_mode).toBe("inclusive");
    expect(v.total_with_gst).toBe(1180);
    expect(v.subtotal).toBe(1000);
    expect(v.gst_amount).toBe(180);
  });

  it("defaults to exclusive when gst_mode is not specified (backward compat)", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18,
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 100 }],
    }] }, ACTOR);
    expect(res.vendors[0].gst_mode).toBe("exclusive");
    expect(res.vendors[0].total_with_gst).toBe(1180);
  });

  it("persists gst_mode per vendor in the DB", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "inclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 118 }],
    }] }, ACTOR);
    const row = vendorRow(res.batch_id, "Bosch India");
    expect(row.gst_mode).toBe("inclusive");
    expect(row.subtotal).toBe(1000);
    expect(row.gst_amount).toBe(180);
    expect(row.total_with_gst).toBe(1180);
  });

  it("one batch can mix an exclusive vendor and an inclusive vendor", () => {
    const res = generateBatch(db, { vendors: [
      { vendor_name: "Bosch India", gst_percent: 18, gst_mode: "exclusive",
        items: [{ po_id: 184, po_item_id: 601, item_name: "Part A", qty: 10, rate_locked: 100 }] },
      { vendor_name: "Delphi", gst_percent: 18, gst_mode: "inclusive",
        items: [{ po_id: 184, po_item_id: 602, item_name: "Part B", qty: 10, rate_locked: 118 }] },
    ] }, ACTOR);
    const b = res.vendors.find((v) => v.vendor_name === "Bosch India")!;
    const d = res.vendors.find((v) => v.vendor_name === "Delphi")!;
    expect(b.subtotal).toBe(1000); expect(b.gst_amount).toBe(180); expect(b.total_with_gst).toBe(1180);
    expect(d.subtotal).toBe(1000); expect(d.gst_amount).toBe(180); expect(d.total_with_gst).toBe(1180);
    // Both taxable+gst identical here; batch total is the sum of GST-inclusive totals.
    const batch: any = db.prepare(`SELECT total_amount, gst_default_mode FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(batch.total_amount).toBe(2360);
  });

  it("batch gst_default_mode is stored and inherited by vendors that omit a mode", () => {
    const res = generateBatch(db, { gst_default_mode: "inclusive", vendors: [{
      vendor_name: "Bosch India", gst_percent: 18,
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 118 }],
    }] }, ACTOR);
    const batch: any = db.prepare(`SELECT gst_default_mode FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(batch.gst_default_mode).toBe("inclusive");
    expect(res.vendors[0].gst_mode).toBe("inclusive");
    expect(res.vendors[0].subtotal).toBe(1000);
  });
});

describe("R27.33a — slip rendering by mode", () => {
  it("inclusive slip: grand_total == entered total, taxable value extracted", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "inclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 118 }],
    }] }, ACTOR);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.gst_mode).toBe("inclusive");
    expect(data.grand_total).toBe(1180); // entered total, not 1180 + gst
    expect(data.subtotal).toBe(1000);
    expect(data.gst_amount).toBe(180);
    expect(renderSlipJpeg(data).slice(0, 2).toString("hex")).toBe("ffd8");
  });

  it("exclusive slip renders as before: grand_total == subtotal + gst", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "exclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 100 }],
    }] }, ACTOR);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.gst_mode).toBe("exclusive");
    expect(data.subtotal).toBe(1000);
    expect(data.grand_total).toBe(1180);
    expect(renderSlipJpeg(data).slice(0, 2).toString("hex")).toBe("ffd8");
  });

  it("old (pre-R27.33a) rows read as exclusive when gst_mode is NULL", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Bosch India", gst_percent: 18, gst_mode: "exclusive",
      items: [{ po_id: 184, po_item_id: 601, item_name: "Part", qty: 10, rate_locked: 100 }],
    }] }, ACTOR);
    db.prepare(`UPDATE payment_batch_vendors SET gst_mode = NULL WHERE batch_id = ?`).run(res.batch_id);
    const data = buildSlipData(db, vendorRow(res.batch_id, "Bosch India"));
    expect(data.gst_mode).toBe("exclusive");
    expect(data.grand_total).toBe(1180);
  });
});
