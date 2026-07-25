// R27.34a Bug 1C — the Dispatch Portal audited clean (every action it renders has a
// matching backend route). The only thing R27.34a changed underneath it is
// listTransfers(), which now accepts an opt-in scope. Dispatch is the Delhi-side "sent"
// view and must keep seeing everything, so this locks in the unscoped default.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { createBranchTransfer, listTransfers } from "../../server/storage-r27";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_34aMigrations();
});

const INTERNAL_PO = 9201;
const CUSTOMER_PO = 9202;

beforeEach(() => {
  for (const t of ["branch_transfers", "consignments", "po_items", "purchase_orders_v2", "customers"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(88, "KALINGA COMMERCIAL CORPORATION", Date.now());
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(INTERNAL_PO, "NM/PO/26/INT2", null, "approved", 1000, Date.now());
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(CUSTOMER_PO, "NM/PO/26/CUST2", 88, "approved", 2000, Date.now());
});

describe("R27.34a — dispatch 'sent' view stays unscoped", () => {
  it("sees both internal transfers and customer dispatches by default", () => {
    createBranchTransfer({ poId: INTERNAL_PO, isInternal: true });
    createBranchTransfer({ poId: CUSTOMER_PO, isInternal: false });
    const rows = listTransfers().filter((r: any) => r.source === "branch_transfer");
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.clientName).sort())
      .toEqual(["KALINGA COMMERCIAL CORPORATION", "—"]);
  });

  it("still honours the status filter without a scope", () => {
    createBranchTransfer({ poId: CUSTOMER_PO, isInternal: false });
    expect(listTransfers({ status: "in_transit" }).filter((r: any) => r.source === "branch_transfer")).toHaveLength(1);
    expect(listTransfers({ status: "received" }).filter((r: any) => r.source === "branch_transfer")).toHaveLength(0);
  });

  it("the idempotency lookup used by the dispatch hooks still finds customer transfers", () => {
    createBranchTransfer({ poId: CUSTOMER_PO, isInternal: false });
    const existing = (listTransfers() as any[]).find((t) => t.po_id === CUSTOMER_PO && t.status === "in_transit");
    expect(existing).toBeTruthy();
  });
});
