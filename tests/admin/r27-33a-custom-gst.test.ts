// R27.33a — Custom GST percent persistence.
//
// Fix 1: the frontend "Custom GST" input must let a user type an arbitrary GST %
// (e.g. 13.5) and have it stored verbatim on the vendor row — not clamped to a
// preset, not truncated to an integer. This exercises the backend contract that
// the fixed input relies on.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { generateBatch, type GenerateVendorInput, type Actor } from "../../server/routes-payments";

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

const bosch = (gst?: number): GenerateVendorInput => ({
  vendor_name: "Bosch India",
  gst_percent: gst,
  items: [{ po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 }], // raw 1700
});

function vendorRow(batchId: number, name: string): any {
  return db.prepare(`SELECT * FROM payment_batch_vendors WHERE batch_id = ? AND vendor_name = ?`).get(batchId, name);
}

describe("R27.33a — custom GST percent", () => {
  it("stores a fractional custom % (13.5) verbatim — not clamped or truncated", () => {
    const res = generateBatch(db, { vendors: [bosch(13.5)] }, ACTOR);
    const row = vendorRow(res.batch_id, "Bosch India");
    expect(row.gst_percent).toBe(13.5);
    expect(row.subtotal).toBe(1700);
    expect(row.gst_amount).toBe(229.5);        // 1700 * 0.135
    expect(row.total_with_gst).toBe(1929.5);
    expect(res.vendors[0].gst_percent).toBe(13.5);
  });

  it("accepts a custom % above the preset list (e.g. 22)", () => {
    const res = generateBatch(db, { vendors: [bosch(22)] }, ACTOR);
    expect(res.vendors[0].gst_percent).toBe(22);
    expect(res.vendors[0].gst_amount).toBe(374); // 1700 * 0.22
  });

  it("keeps two-decimal custom precision (12.75)", () => {
    const res = generateBatch(db, { vendors: [bosch(12.75)] }, ACTOR);
    const row = vendorRow(res.batch_id, "Bosch India");
    expect(row.gst_percent).toBe(12.75);
    expect(row.gst_amount).toBe(216.75); // 1700 * 0.1275
  });
});
