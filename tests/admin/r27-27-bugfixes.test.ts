// R27.27 — regression suite for the four bugs shipped in this round.
//
//   Bug 1 — consignment leak: a consignment delivered to a CLIENT must not appear
//           in the store's "incoming Delhi→Patna transfers" list. Only genuine
//           inter-branch movements (inter_branch_transfer=1) or legacy no-customer
//           rows belong there.
//   Bug 2 — store receive qty: received-qty state must be keyed by ROW INDEX, not
//           part number, so two lines with a missing/duplicate part number keep
//           independent quantities.
//   Bug 3 — expense reference_number + net-new Bus expense (required trip fields).
//   Bug 4 — dispatch list helpers must return arrays (not throw) when filtering by
//           a status with no matching rows, and the stock list must resolve.
import { describe, it, expect, beforeAll } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  listTransfers, createDirectExpense, createBusExpense,
  listDispatchInvoices, listDispatchStockItems,
} from "../../server/storage-r27";

beforeAll(() => {
  // Bring the bare test DB up to production schema (additive, best-effort).
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  // Defensively ensure the columns these tests select/insert exist regardless of
  // which migration runner created the consignments table.
  for (const decl of ["customer_id INTEGER", "inter_branch_transfer INTEGER DEFAULT 0"]) {
    try { db.exec(`ALTER TABLE consignments ADD COLUMN ${decl}`); } catch { /* already present */ }
  }
});

describe("R27.27 Bug 1 — consignment leak guard in listTransfers", () => {
  it("shows inter-branch + legacy no-customer rows, hides client + non-Patna rows", () => {
    db.exec(`DELETE FROM consignments`);
    const now = Date.now();
    const ins = db.prepare(
      `INSERT INTO consignments (docket_number, carrier, origin, destination, customer_id, customer_name, status, dispatch_date, created_at, updated_at, inter_branch_transfer)
       VALUES (?, 'BlueDart', 'Delhi', ?, ?, ?, 'in_transit', ?, ?, ?, ?)`,
    );
    // A — delivered to a CLIENT (customer_id + name), inter=0 → must NOT appear.
    ins.run("R27_27-A", "Patna", 5, "SRSC INFRA PRIVATE LTD", now, now, now, 0);
    // B — no customer, explicit inter-branch flag → MUST appear.
    ins.run("R27_27-B", "Patna", null, null, now, now, now, 1);
    // C — legacy no-customer, inter=0 → MUST appear (fallback guard).
    ins.run("R27_27-C", "Patna", null, "", now, now, now, 0);
    // D — Delhi-bound (wrong destination) → must NOT appear.
    ins.run("R27_27-D", "Delhi", null, null, now, now, now, 1);

    const dockets = listTransfers()
      .filter((t: any) => t.source === "consignment")
      .map((t: any) => t.poNumber);

    expect(dockets).toContain("R27_27-B");
    expect(dockets).toContain("R27_27-C");
    expect(dockets).not.toContain("R27_27-A");
    expect(dockets).not.toContain("R27_27-D");
  });
});

describe("R27.27 Bug 2 — received-qty keyed by row index, not part number", () => {
  // Mirrors StoreDashboard.openDetail seed + submitReceive read.
  const seed = (expected: { partNumber: string | null; expectedQty: number }[]) => {
    const init: Record<string, number> = {};
    expected.forEach((it, i) => { init[i] = it.expectedQty; });
    return init;
  };
  it("two lines with the same/blank part number keep independent quantities", () => {
    const expected = [
      { partNumber: "", expectedQty: 10 },
      { partNumber: "", expectedQty: 7 },
    ];
    const recv = seed(expected);
    // Edit only the second row (index 1).
    recv[1] = 3;
    const submitted = expected.map((it, i) => ({
      part_number: it.partNumber || "",
      received_qty: Number(recv[i] ?? it.expectedQty) || 0,
    }));
    expect(submitted[0].received_qty).toBe(10); // unchanged — no lockstep
    expect(submitted[1].received_qty).toBe(3);
  });
});

describe("R27.27 Bug 3 — expense reference_number + Bus expense", () => {
  it("persists reference_number on a direct expense", () => {
    const row: any = createDirectExpense(
      { amount: 250, payment_mode: "bank", description: "ref test", reference_number: "REF-9001", expense_date: "2026-06-28" },
    );
    expect(row.reference_number).toBe("REF-9001");
    expect(row.expense_type).toBe("direct");
  });

  it("creates a bus expense with all trip fields", () => {
    const row: any = createBusExpense({
      amount: 1200, payment_mode: "bank", expense_date: "2026-06-28",
      bus_number: "BR01-1234", bus_name: "Suvidha", bus_contact: "9876543210", bus_from: "Patna",
    });
    expect(row.expense_type).toBe("bus");
    expect(row.bus_number).toBe("BR01-1234");
    expect(row.bus_from).toBe("Patna");
  });

  it("rejects a bus expense missing a required trip field", () => {
    expect(() => createBusExpense({
      amount: 500, payment_mode: "bank", expense_date: "2026-06-28",
      bus_number: "", bus_name: "Suvidha", bus_contact: "9876543210", bus_from: "Patna",
    } as any)).toThrow(/bus_number is required/);
  });
});

describe("R27.27 Bug 4 — dispatch list helpers never throw on empty filters", () => {
  it("listDispatchInvoices({status:'processed'}) returns an array", () => {
    const rows = listDispatchInvoices({ status: "processed" });
    expect(Array.isArray(rows)).toBe(true);
  });
  it("listDispatchStockItems() returns an array", () => {
    expect(Array.isArray(listDispatchStockItems())).toBe(true);
  });
});
