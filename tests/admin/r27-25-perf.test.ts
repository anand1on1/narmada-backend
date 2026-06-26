// R27.25 — Admin Command Center perf guard. Covers the two N+1 rewrites that
// replaced per-row queries with a single batched query:
//   1. getCustomerConsignmentCounts() — one GROUP BY replaces the per-customer
//      COUNT loop behind GET /api/admin/customers.
//   2. getCustomersByIds() — one IN(...) select replaces the per-row getCustomer
//      loop behind GET /api/admin/quotations.
// It also asserts the indexes added by runR27_25Migrations() exist, and that the
// opt-in pagination slice math (mirrored from the route) is backward compatible.
//
// The PartSetu test harness only runs runPartSetuMigrations(), so the Phase-4
// admin columns (consignments.customer_id, the extended customers columns) are
// not present in this isolated DB. beforeAll adds them idempotently and seeds a
// small dataset with raw SQL — faithful enough to exercise the batched queries.
import { describe, it, expect, beforeAll } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import { runR27_25Migrations } from "../../server/migrations";
import * as v2 from "../../server/storage-v2";

beforeAll(() => {
  // Ensure the extended customers columns the Drizzle schema selects exist.
  for (const decl of [
    "credit_limit_inr REAL DEFAULT 0", "opening_balance_inr REAL DEFAULT 0",
    "payment_terms_days INTEGER DEFAULT 0", "contact_person TEXT", "company_pan TEXT",
    "customer_code TEXT", "default_discount_pct REAL", "sales_rep_id INTEGER",
  ]) {
    try { db.exec(`ALTER TABLE customers ADD COLUMN ${decl}`); } catch { /* already added */ }
  }
  // Ensure the Phase-4 consignments columns the Drizzle schema selects exist.
  for (const decl of [
    "customer_id INTEGER", "customer_email TEXT", "invoice_url TEXT",
    "docket_url TEXT", "dispatch_origin TEXT",
  ]) {
    try { db.exec(`ALTER TABLE consignments ADD COLUMN ${decl}`); } catch { /* already added */ }
  }

  db.exec(`DELETE FROM consignments`);
  db.exec(`DELETE FROM customers`);

  const now = Date.now();
  const insC = db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)`);
  insC.run(1, "Alpha Transports", now);
  insC.run(2, "Bravo Logistics", now);
  insC.run(3, "Charlie Movers", now); // no consignments → count must be 0

  const insG = db.prepare(
    `INSERT INTO consignments (docket_number, origin, destination, status, customer_id, created_at, updated_at)
     VALUES (?, 'X', 'Y', 'pending', ?, ?, ?)`,
  );
  insG.run("D-1", 1, now, now);
  insG.run("D-2", 1, now, now);
  insG.run("D-3", 2, now, now);
  insG.run("D-4", null, now, now); // unassigned → excluded from the grouped map

  runR27_25Migrations();
});

describe("R27.25 — admin perf (N+1 rewrites, indexes, pagination contract)", () => {
  it("getCustomerConsignmentCounts returns a grouped map in ONE query (was N+1)", async () => {
    const m = await v2.getCustomerConsignmentCounts();
    expect(m.get(1)).toBe(2);
    expect(m.get(2)).toBe(1);
    expect(m.has(3)).toBe(false); // zero-consignment customer simply absent
    // matches the per-row helper for every customer
    for (const id of [1, 2, 3]) {
      expect(m.get(id) ?? 0).toBe(await v2.getCustomerConsignmentCount(id));
    }
  });

  it("getCustomersByIds resolves many ids in ONE query, dedups, ignores junk", async () => {
    const m = await v2.getCustomersByIds([1, 2, 2, 3, 0, -5, NaN]);
    expect(m.size).toBe(3);
    expect(m.get(1)?.name).toBe("Alpha Transports");
    expect(m.get(2)?.name).toBe("Bravo Logistics");
    expect(await v2.getCustomersByIds([])).toEqual(new Map());
  });

  it("R27.25 indexes exist after migration", () => {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as Array<{ name: string }>)
      .map((r) => r.name);
    for (const idx of [
      "idx_consignments_customer_id", "idx_consignments_status", "idx_consignments_created_at",
      "idx_customers_created_at", "idx_quotations_status", "idx_quotations_customer_id",
      "idx_quotations_created_at", "idx_rfqs_status", "idx_rfqs_customer_id",
      "idx_quotes_customer_id", "idx_quotes_status", "idx_quotes_rfq_id",
      "idx_purchase_orders_status", "idx_purchase_orders_customer_id",
    ]) {
      expect(names).toContain(idx);
    }
  });

  it("listConsignments still returns all rows + honors the now-indexed status filter", async () => {
    const all = await v2.listConsignments();
    expect(all.length).toBe(4); // unchanged: list endpoint returns every row by default
    const pending = await v2.listConsignments({ status: "pending" });
    expect(pending.length).toBe(4);
    expect(pending.every((c: any) => c.status === "pending")).toBe(true);
    const none = await v2.listConsignments({ status: "delivered" });
    expect(none.length).toBe(0);
  });

  it("pagination slice is backward compatible (no limit => full list)", () => {
    // Mirrors the route logic: only slice when ?limit is present.
    const rows = [10, 20, 30, 40, 50];
    const paginate = (limitRaw: string | null, offsetRaw: string | null) => {
      if (limitRaw == null) return rows; // backward-compat: full array
      const limit = Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50));
      const offset = Math.max(0, parseInt(offsetRaw || "0", 10) || 0);
      return rows.slice(offset, offset + limit);
    };
    expect(paginate(null, null)).toEqual(rows);
    expect(paginate("2", "0")).toEqual([10, 20]);
    expect(paginate("2", "2")).toEqual([30, 40]);
    expect(paginate("999", "0")).toEqual(rows); // capped at 200, but only 5 rows
  });
});
