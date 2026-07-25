// R27.34a Bug 1 — Store Portal "Incoming Transfers".
//
// Symptom A: every Delhi dispatch opened a branch_transfers row, so customer-bound
// consignments (MONTE CARLO, KALINGA, ...) leaked into the store's incoming list.
// listTransfers({ internalOnly, toBranch }) is the fix; the store route opts in.
//
// Symptom B: consignment rows have no parent PO, so receiveTransfer() could never
// apply and no action was offered. receiveConsignment() is the fix.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  createBranchTransfer, listTransfers, receiveConsignment, getConsignmentReceiptDetail,
} from "../../server/storage-r27";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_34aMigrations();
});

const INTERNAL_PO = 9101;   // Delhi -> Patna stock move, no customer
const CUSTOMER_PO = 9102;   // Delhi -> MONTE CARLO, a real customer dispatch

function seed() {
  for (const t of ["branch_transfers", "consignments", "po_items", "purchase_orders_v2", "customers"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(77, "MONTE CARLO", Date.now());
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(INTERNAL_PO, "NM/PO/26/INT1", null, "approved", 1000, Date.now());
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(CUSTOMER_PO, "NM/PO/26/CUST1", 77, "approved", 2000, Date.now());
}
beforeEach(seed);

describe("R27.34a Bug 1A — store list shows internal transfers only", () => {
  it("includes an internal Delhi→Patna transfer", () => {
    createBranchTransfer({ poId: INTERNAL_PO, isInternal: true, notes: "Inter-branch transfer" });
    const rows = listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "branch_transfer");
    expect(rows).toHaveLength(1);
    expect(rows[0].po_id).toBe(INTERNAL_PO);
    expect(rows[0].is_internal).toBe(1);
  });

  it("excludes a customer-bound Delhi dispatch", () => {
    createBranchTransfer({ poId: CUSTOMER_PO, isInternal: false, notes: "Delhi dispatch via VRL" });
    const rows = listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "branch_transfer");
    expect(rows).toHaveLength(0);
    // ...but the unscoped list (Delhi / dispatch views) still sees it.
    const all = listTransfers().filter((r: any) => r.source === "branch_transfer");
    expect(all).toHaveLength(1);
    expect(all[0].clientName).toBe("MONTE CARLO");
  });

  it("keeps both apart in one mixed list", () => {
    createBranchTransfer({ poId: INTERNAL_PO, isInternal: true });
    createBranchTransfer({ poId: CUSTOMER_PO, isInternal: false });
    const scoped = listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "branch_transfer");
    expect(scoped.map((r: any) => r.po_id)).toEqual([INTERNAL_PO]);
    expect(listTransfers().filter((r: any) => r.source === "branch_transfer")).toHaveLength(2);
  });

  it("legacy rows with NULL is_internal fall back to 'parent PO has no customer'", () => {
    createBranchTransfer({ poId: INTERNAL_PO });   // no flag -> NULL
    createBranchTransfer({ poId: CUSTOMER_PO });   // no flag -> NULL
    const scoped = listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "branch_transfer");
    expect(scoped.map((r: any) => r.po_id)).toEqual([INTERNAL_PO]);
  });

  it("excludes transfers bound for another branch", () => {
    createBranchTransfer({ poId: INTERNAL_PO, isInternal: true, toBranch: "Delhi", fromBranch: "Patna" });
    expect(listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "branch_transfer")).toHaveLength(0);
    expect(listTransfers({ internalOnly: true, toBranch: "Delhi" })
      .filter((r: any) => r.source === "branch_transfer")).toHaveLength(1);
  });
});

describe("R27.34a Bug 1B — Mark Received for consignments", () => {
  function seedConsignment(over: Record<string, any> = {}) {
    const row = {
      docket_number: "DKT-5501", carrier: "Own Vehicle", origin: "Delhi", destination: "Patna",
      customer_id: null, customer_name: null, bundles_count: 4, invoice_number: "INV-77",
      dispatch_date: Date.now(), status: "in_transit", inter_branch_transfer: 1, ...over,
    };
    const info = db.prepare(
      `INSERT INTO consignments (docket_number, carrier, origin, destination, customer_id, customer_name,
        bundles_count, invoice_number, dispatch_date, status, inter_branch_transfer, created_at, updated_at)
       VALUES (@docket_number, @carrier, @origin, @destination, @customer_id, @customer_name,
        @bundles_count, @invoice_number, @dispatch_date, @status, @inter_branch_transfer, ${Date.now()}, ${Date.now()})`,
    ).run(row);
    return Number(info.lastInsertRowid);
  }

  it("surfaces an inter-branch consignment as a receivable row", () => {
    const id = seedConsignment();
    const rows = listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "consignment");
    expect(rows).toHaveLength(1);
    expect(rows[0].consignment_id).toBe(id);
    expect(rows[0].received_at).toBeNull();
  });

  it("receiving sets status, received_at and received_by", () => {
    const id = seedConsignment();
    const out = receiveConsignment(id, { received_bundles: 4, notes: "All bundles intact" }, 31);
    expect(out.status).toBe("received");
    expect(out.received_at).toBeTruthy();
    expect(out.received_by).toBe(31);
    expect(out.received_bundles).toBe(4);
    expect(out.received_notes).toBe("All bundles intact");
  });

  it("defaults received bundles to the dispatched count", () => {
    const id = seedConsignment({ bundles_count: 7 });
    expect(receiveConsignment(id).received_bundles).toBe(7);
  });

  it("records a short receipt without changing the dispatched count", () => {
    const id = seedConsignment({ bundles_count: 5 });
    const out = receiveConsignment(id, { received_bundles: 3, notes: "2 bundles missing" }, 31);
    expect(out.bundles_count).toBe(5);
    expect(out.received_bundles).toBe(3);
  });

  it("is idempotent — a second receive is rejected", () => {
    const id = seedConsignment();
    receiveConsignment(id, {}, 31);
    expect(() => receiveConsignment(id, {}, 31)).toThrow(/already received/i);
  });

  it("rejects an unknown consignment", () => {
    expect(() => receiveConsignment(999999, {}, 31)).toThrow(/not found/i);
  });

  it("drops out of the incoming list once received", () => {
    const id = seedConsignment();
    receiveConsignment(id, {}, 31);
    expect(listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "consignment")).toHaveLength(0);
    expect(getConsignmentReceiptDetail(id).status).toBe("received");
  });

  it("never surfaces a customer-bound consignment", () => {
    seedConsignment({ customer_id: 77, customer_name: "MONTE CARLO", inter_branch_transfer: 0 });
    expect(listTransfers({ internalOnly: true, toBranch: "Patna" })
      .filter((r: any) => r.source === "consignment")).toHaveLength(0);
  });
});
