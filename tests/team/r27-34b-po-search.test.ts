// R27.34b Feature 1 (PO half) — PO search already reached into po_items (R27.0), so
// this pins that behaviour down rather than reimplementing it, and covers the two
// things R27.34b added: brand in the haystack, and the unfiltered "of Y" denominator.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { listPurchaseOrdersV2WithTotals, countPurchaseOrdersV2 } from "../../server/storage-v2";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_34bMigrations();
});

const MARCH = new Date("2026-03-10T10:00:00Z").getTime();
const MAY = new Date("2026-05-20T10:00:00Z").getTime();

function insertPo(id: number, customerPoNumber: string, customerId: number | null, status: string, poDate: number) {
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_po_number, customer_id, status, po_date, total, created_at)
              VALUES (?,?,?,?,?,?,0,?)`).run(id, customerPoNumber, customerPoNumber, customerId, status, poDate, poDate);
}
function insertItem(poId: number, partNumber: string | null, description: string, brand?: string, vendorName?: string) {
  db.prepare(`INSERT INTO po_items (po_id, part_number, description, brand, vendor_name, qty, unit_price, discount_pct, tax_pct, line_total, fulfil_status)
              VALUES (?,?,?,?,?,1,100,0,18,100,'pending')`)
    .run(poId, partNumber, description, brand ?? null, vendorName ?? null);
}

beforeEach(() => {
  db.exec(`DELETE FROM po_items`);
  db.exec(`DELETE FROM purchase_orders_v2`);
  db.exec(`DELETE FROM customers`);
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(801, "PLR PROJECTS", Date.now());
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(802, "RITHWIK PROJECTS", Date.now());

  insertPo(6001, "NM/PO/26/0337", 801, "pending", MARCH);
  insertItem(6001, "TVS-BRK-9931", "Brake Shoe Assembly", "TVS", "Sharma Auto");

  insertPo(6002, "NM/PO/26/0412", 802, "fulfilled", MAY);
  insertItem(6002, "BOSCH-FLT-220", "Oil Filter Cartridge", "BOSCH", "Delhi Spares");
  insertItem(6002, "BOSCH-FLT-221", "Oil Filter Housing", "BOSCH", "Delhi Spares");

  insertPo(6003, "NM/PO/26/0500", 801, "pending", MAY);
  insertItem(6003, null, "Assorted fasteners", null);
});

describe("R27.34b — PO search", () => {
  it("matches on the PO number", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "26/0412" });
    expect(rows.map((r: any) => r.id)).toEqual([6002]);
  });

  it("matches on the customer name", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "rithwik" });
    expect(rows.map((r: any) => r.id)).toEqual([6002]);
  });

  it("matches on a line-item part number", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "TVS-BRK-9931" });
    expect(rows.map((r: any) => r.id)).toEqual([6001]);
  });

  it("matches on a line-item description", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "oil filter" });
    expect(rows.map((r: any) => r.id)).toEqual([6002]);
  });

  it("matches on a line-item brand without duplicating multi-line POs", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "BOSCH" });
    expect(rows.map((r: any) => r.id)).toEqual([6002]);
  });

  it("matches on a line-item vendor name", async () => {
    const rows = await listPurchaseOrdersV2WithTotals({ q: "sharma" });
    expect(rows.map((r: any) => r.id)).toEqual([6001]);
  });

  it("returns an empty array for a term nothing matches", async () => {
    expect(await listPurchaseOrdersV2WithTotals({ q: "zzz-no-such-part" })).toEqual([]);
  });

  it("combines text search with status, customer and date filters", async () => {
    expect((await listPurchaseOrdersV2WithTotals({ q: "projects", status: "pending" })).map((r: any) => r.id).sort())
      .toEqual([6001, 6003]);
    expect((await listPurchaseOrdersV2WithTotals({ q: "projects", customerId: 802 })).map((r: any) => r.id))
      .toEqual([6002]);
    expect((await listPurchaseOrdersV2WithTotals({ q: "projects", from: "2026-05-01", to: "2026-05-31" })).map((r: any) => r.id).sort())
      .toEqual([6002, 6003]);
    // Contradictory combination -> empty, not an error.
    expect(await listPurchaseOrdersV2WithTotals({ q: "sharma", status: "fulfilled" })).toEqual([]);
  });

  it("countPurchaseOrdersV2 is the unfiltered denominator for 'Showing X of Y'", async () => {
    expect(countPurchaseOrdersV2()).toBe(3);
    expect((await listPurchaseOrdersV2WithTotals({ q: "BOSCH" })).length).toBe(1);
    expect(countPurchaseOrdersV2()).toBe(3);
  });

  it("returns everything when no filters are supplied", async () => {
    expect((await listPurchaseOrdersV2WithTotals({})).length).toBe(3);
  });
});
