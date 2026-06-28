// R27.26 — PartSetu removal guard.
//
// PartSetu was cut out of Narmada Mobility (backend services/routes + client
// widget/pages). This suite asserts two things stay true after the cut:
//
//   1. REGRESSION — the data layers behind the Admin / Sales / Quote / Dispatch
//      dashboards still execute and return valid shapes. PartSetu shared nothing
//      with these (it only ever read partsetu_* tables), so their storage helpers
//      must be unaffected.
//
//   2. REMOVAL — the PartSetu store module and the entire server/services dir are
//      gone, and routes-v2.ts registers ZERO "/api/partsetu" or
//      "/api/admin/partsetu" handlers. Express has no fall-through for an
//      unregistered path, so every former PartSetu endpoint now 404s at runtime.
//      (The repo has no HTTP test harness — partsetu tests drove the search layer
//      directly — so the 404 contract is verified here by route-table absence in
//      source rather than a live request.)
//
//   3. PRESERVATION — runPartSetuMigrations() is still exported and still creates
//      the partsetu_* tables. Hard Rule #2: the data stays for a future restore.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { runPartSetuMigrations } from "../../server/migrations";
import * as v2 from "../../server/storage-v2";

beforeAll(() => {
  // Bring the bare test DB up to the production schema by running every migration
  // runner best-effort (additive CREATE/ALTER IF NOT EXISTS; backfills that need
  // absent rows simply no-op). This mirrors the boot sequence so the Admin /
  // Sales / Quote / Dispatch list helpers select against fully-migrated tables.
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* best-effort; later runners fill gaps */ }
    }
  }
});

describe("R27.26 — PartSetu removal (regression + 404 guard + table preservation)", () => {
  it("Admin/Sales/Quote/Dispatch storage layers still return valid shapes", async () => {
    const [consignments, customers, rfqs, quotes, pos, quotations] = await Promise.all([
      v2.listConsignments(),
      v2.getCustomers(),
      v2.listRfqs(),
      v2.listQuotes(),
      v2.listPurchaseOrders(),
      v2.listQuotations(),
    ]);
    for (const rows of [consignments, customers, rfqs, quotes, pos]) {
      expect(Array.isArray(rows)).toBe(true);
    }
    // listQuotations is the paginated sales/quote feed: { rows, total }.
    expect(Array.isArray((quotations as any).rows)).toBe(true);
    expect(typeof (quotations as any).total).toBe("number");

    // Dashboard KPIs (Session B counts) still compute without PartSetu.
    const counts = await v2.getSessionBCounts();
    expect(counts && typeof counts === "object").toBe(true);
  });

  it("PartSetu store module is deleted (require throws)", () => {
    expect(() => require("../../server/partsetu")).toThrow();
  });

  it("server/services directory is deleted", () => {
    expect(existsSync(join(__dirname, "..", "..", "server", "services"))).toBe(false);
  });

  it("routes-v2 registers ZERO PartSetu endpoints (=> 404 at runtime)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(__dirname, "..", "..", "server", "routes-v2.ts"), "utf8");
    // No app.<verb>("/api/partsetu...) or "/api/admin/partsetu...) registrations.
    const routeReg = /app\.(get|post|put|patch|delete)\(\s*["'`]\/api\/(admin\/)?partsetu/g;
    expect(src.match(routeReg)).toBeNull();
  });

  it("partsetu_* tables are PRESERVED (migration still exported + creates tables)", () => {
    expect(typeof runPartSetuMigrations).toBe("function");
    runPartSetuMigrations(); // idempotent
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partsetu_catalogs'`)
      .get() as { name: string } | undefined;
    expect(t?.name).toBe("partsetu_catalogs");
  });
});
