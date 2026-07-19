// R27.33 — Item edit in Process Payment.
//
// Exercises the generateBatch override path added in R27.33: qty edits, deletions,
// manually-added custom items, and the per-item scope toggle that optionally writes
// the change back to po_items. Same pure-logic-against-real-SQLite approach as the
// R27.32 suite (no HTTP harness).
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  aggregateVendors, generateBatch,
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
  db.prepare(`INSERT INTO vendors (id, code, name, created_at) VALUES (?,?,?,?)`).run(1, "V-BOSCH", "Bosch India", 0);
  db.prepare(`INSERT INTO vendors (id, code, name, created_at) VALUES (?,?,?,?)`).run(2, "V-DELPHI", "Delphi", 0);
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(184, "NM/PO/26/0099", 42, "approved", 45000, day("2026-06-21"));
  const insItem = db.prepare(`INSERT INTO po_items (id, po_id, description, qty, purchase_cost) VALUES (?,?,?,?,?)`);
  insItem.run(601, 184, "Brake pad set", 2, 0);
  insItem.run(602, 184, "Oil filter", 1, 0);
  const insQuote = db.prepare(
    `INSERT INTO po_item_vendor_quotes (po_item_id, vendor_id, vendor_name, rate, status, received_at, approved_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  insQuote.run(601, 1, "Bosch India", 850, "approved", 1, 2);
  insQuote.run(602, 2, "Delphi", 300, "approved", 1, 2);
}
beforeEach(seedBase);

const boschBrake = (over: Partial<GenerateVendorInput["items"][number]> = {}): GenerateVendorInput => ({
  vendor_name: "Bosch India",
  items: [{ po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850, ...over }],
});

describe("R27.33 — qty edit", () => {
  it("snapshots the edited qty + original_qty and recomputes amount", () => {
    const res = generateBatch(db, {
      vendors: [boschBrake({ qty: 5, override_source: "qty_modified", original_qty: 2 })],
    }, ACTOR);
    const item: any = db.prepare(`SELECT * FROM payment_batch_items WHERE batch_id = ?`).get(res.batch_id);
    expect(item.qty).toBe(5);
    expect(item.original_qty).toBe(2);
    expect(item.override_source).toBe("qty_modified");
    expect(item.amount_locked).toBe(4250); // 5 * 850
    expect(res.vendors[0].subtotal).toBe(4250);
  });

  it("scope 'slip_only' (default) leaves po_items untouched", () => {
    generateBatch(db, {
      vendors: [boschBrake({ qty: 9, override_source: "qty_modified", original_qty: 2, scope: "slip_only" })],
    }, ACTOR);
    const po: any = db.prepare(`SELECT qty FROM po_items WHERE id = 601`).get();
    expect(po.qty).toBe(2); // unchanged
  });

  it("scope 'update_po' writes the new qty back to po_items", () => {
    generateBatch(db, {
      vendors: [boschBrake({ qty: 9, override_source: "qty_modified", original_qty: 2, scope: "update_po" })],
    }, ACTOR);
    const po: any = db.prepare(`SELECT qty FROM po_items WHERE id = 601`).get();
    expect(po.qty).toBe(9);
  });
});

describe("R27.33 — delete item", () => {
  it("a 'removed' item is never snapshotted and drops from the subtotal", () => {
    const res = generateBatch(db, {
      vendors: [{
        vendor_name: "Bosch India",
        items: [
          { po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 },
          { po_id: 184, po_item_id: 602, item_name: "Oil filter", qty: 1, rate_locked: 300, override_source: "removed" },
        ],
      }],
    }, ACTOR);
    const items = db.prepare(`SELECT * FROM payment_batch_items WHERE batch_id = ?`).all(res.batch_id) as any[];
    expect(items.length).toBe(1);
    expect(items[0].item_name).toBe("Brake pad set");
    expect(res.vendors[0].subtotal).toBe(1700);
  });

  it("scope 'slip_only' removal keeps the po_item alive (deleted_at NULL)", () => {
    generateBatch(db, {
      vendors: [{ vendor_name: "Bosch India", items: [
        { po_id: 184, po_item_id: 602, item_name: "Oil filter", qty: 1, rate_locked: 300, override_source: "removed", scope: "slip_only" },
        { po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 },
      ] }],
    }, ACTOR);
    const po: any = db.prepare(`SELECT deleted_at FROM po_items WHERE id = 602`).get();
    expect(po.deleted_at).toBeNull();
  });

  it("scope 'update_po' removal soft-deletes the po_item and hides it from aggregation", () => {
    generateBatch(db, {
      vendors: [{ vendor_name: "Bosch India", items: [
        { po_id: 184, po_item_id: 602, item_name: "Oil filter", qty: 1, rate_locked: 300, override_source: "removed", scope: "update_po" },
        { po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 },
      ] }],
    }, ACTOR);
    const po: any = db.prepare(`SELECT deleted_at FROM po_items WHERE id = 602`).get();
    expect(po.deleted_at).not.toBeNull();
    // Oil filter (Delphi) no longer surfaces in a fresh aggregation.
    const { vendors } = aggregateVendors(db, [184]);
    expect(vendors.find((v) => v.vendor_name === "Delphi")).toBeUndefined();
  });
});

describe("R27.33 — add custom item", () => {
  it("stores a manually-added item flagged as such", () => {
    const res = generateBatch(db, {
      vendors: [{ vendor_name: "Bosch India", items: [
        { po_id: 184, po_item_id: 601, item_name: "Brake pad set", qty: 2, rate_locked: 850 },
        { po_id: 184, po_item_id: null, item_name: "Courier charge", qty: 1, rate_locked: 150, override_source: "manually_added" },
      ] }],
    }, ACTOR);
    const custom: any = db.prepare(
      `SELECT * FROM payment_batch_items WHERE batch_id = ? AND override_source = 'manually_added'`,
    ).get(res.batch_id);
    expect(custom.item_name).toBe("Courier charge");
    expect(custom.po_item_id).toBeNull();
    expect(custom.amount_locked).toBe(150);
    expect(res.vendors[0].subtotal).toBe(1850); // 1700 + 150
  });

  it("defaults override_source to 'original' for unflagged items", () => {
    const res = generateBatch(db, { vendors: [boschBrake()] }, ACTOR);
    const item: any = db.prepare(`SELECT override_source FROM payment_batch_items WHERE batch_id = ?`).get(res.batch_id);
    expect(item.override_source).toBe("original");
  });
});
