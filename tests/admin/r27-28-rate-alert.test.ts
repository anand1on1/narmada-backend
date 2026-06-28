// R27.28 — Procurement Rate Alert + Admin Irregularity Feed.
//
// Baseline = lowest-ever historical vendor rate for the same part_number across
// po_items (vendor_rate, falling back to purchase_cost). The check fires when a
// new rate exceeds that minimum by more than ₹1. A 'proceeded' decision lands in
// the admin feed (admin_seen=0); 'modified' is logged too but never surfaces as a
// proceeded irregularity. Marking an alert seen removes it from the unseen feed.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  checkRateAgainstHistory, logRateAlertDecision,
  getUnseenRateIrregularities, markRateIrregularitySeen, getAllRateIrregularities,
} from "../../server/storage-r27";

let poSeq = 0;
// Insert a historical purchase: one PO header (for the date) + one line item.
function seedPurchase(partNumber: string, rate: number, opts: { vendor?: string; brand?: string; createdAt?: number } = {}) {
  poSeq += 1;
  const id = 90000 + poSeq;
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)`)
    .run(id, `R27_28-PO-${id}`, opts.createdAt ?? Date.now(), opts.createdAt ?? Date.now());
  db.prepare(`INSERT INTO po_items (po_id, part_number, brand, qty, unit_price, vendor_rate, vendor_name) VALUES (?, ?, ?, 1, 0, ?, ?)`)
    .run(id, partNumber, opts.brand ?? null, rate, opts.vendor ?? null);
  return id;
}

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  // Defensively ensure the columns these tests use exist.
  for (const decl of ["vendor_rate REAL", "vendor_name TEXT", "purchase_cost REAL", "brand TEXT"]) {
    try { db.exec(`ALTER TABLE po_items ADD COLUMN ${decl}`); } catch { /* already present */ }
  }
  migrations.runR27_28Migrations();
});

beforeEach(() => {
  db.exec(`DELETE FROM po_items WHERE po_id >= 90000`);
  db.exec(`DELETE FROM purchase_orders_v2 WHERE id >= 90000`);
  db.exec(`DELETE FROM procurement_rate_alerts`);
});

describe("R27.28 — checkRateAgainstHistory", () => {
  it("(1) no prior purchase → {alert:false}", () => {
    expect(checkRateAgainstHistory("BRAND-NEW-PART", 500)).toEqual({ alert: false });
  });

  it("(2) prior ₹100 + new ₹100 → no alert (equal)", () => {
    seedPurchase("P-100", 100);
    expect(checkRateAgainstHistory("P-100", 100).alert).toBe(false);
  });

  it("(3) prior ₹100 + new ₹100.50 → no alert (within ₹1 tolerance)", () => {
    seedPurchase("P-TOL", 100);
    expect(checkRateAgainstHistory("P-TOL", 100.5).alert).toBe(false);
  });

  it("(4) prior ₹100 + new ₹120 → alert, previous.rate=100, deviation≈20%", () => {
    seedPurchase("P-DEV", 100, { vendor: "Alpha" });
    const r = checkRateAgainstHistory("P-DEV", 120);
    expect(r.alert).toBe(true);
    expect(r.previous?.rate).toBe(100);
    expect(r.previous?.vendor).toBe("Alpha");
    expect(r.deviation_pct).toBeCloseTo(20, 1);
  });

  it("(5) priors ₹150,₹100,₹130 + new ₹110 → alert, previous.rate=100 (min not most-recent), last_3 populated", () => {
    seedPurchase("P-MIN", 150, { vendor: "V1", createdAt: 1000 });
    seedPurchase("P-MIN", 100, { vendor: "V2", createdAt: 2000 }); // the historical low
    seedPurchase("P-MIN", 130, { vendor: "V3", createdAt: 3000 }); // most recent, but not lowest
    const r = checkRateAgainstHistory("P-MIN", 110);
    expect(r.alert).toBe(true);
    expect(r.previous?.rate).toBe(100);
    expect(r.last_3_purchases?.length).toBe(3);
    // last_3 ordered most-recent first
    expect(r.last_3_purchases?.[0].rate).toBe(130);
  });
});

describe("R27.28 — logRateAlertDecision + admin feed", () => {
  const payload = (decision: "proceeded" | "modified", poId: number | null = 42) => ({
    part_number: "P-LOG", part_name: "Brake Pad", new_rate: 120, new_vendor: "Alpha", new_brand: "Bosch",
    previous_min_rate: 100, previous_vendor: "Beta", previous_date: new Date(2000).toISOString(), previous_po_id: 7,
    deviation_pct: 20, decision, po_id: poId,
  });

  it("(6) log 'proceeded' → row persisted with admin_seen=0", () => {
    const { id } = logRateAlertDecision(payload("proceeded"), "buyer1");
    const row = db.prepare(`SELECT * FROM procurement_rate_alerts WHERE id = ?`).get(id) as any;
    expect(row.decision).toBe("proceeded");
    expect(row.admin_seen).toBe(0);
    expect(row.decided_by).toBe("buyer1");
    expect(row.po_id).toBe(42);
  });

  it("(7) log 'modified' → row persisted with admin_seen=0", () => {
    const { id } = logRateAlertDecision(payload("modified", null), "buyer1");
    const row = db.prepare(`SELECT * FROM procurement_rate_alerts WHERE id = ?`).get(id) as any;
    expect(row.decision).toBe("modified");
    expect(row.admin_seen).toBe(0);
  });

  it("(8) getUnseenRateIrregularities returns only proceeded + unseen", () => {
    logRateAlertDecision(payload("proceeded"), "buyer1");
    logRateAlertDecision(payload("modified", null), "buyer1");
    const unseen = getUnseenRateIrregularities() as any[];
    expect(unseen.length).toBe(1);
    expect(unseen[0].decision).toBe("proceeded");
  });

  it("(9) markRateIrregularitySeen(id) excludes it from the unseen feed afterward", () => {
    const { id } = logRateAlertDecision(payload("proceeded"), "buyer1");
    expect((getUnseenRateIrregularities() as any[]).length).toBe(1);
    const ok = markRateIrregularitySeen(id, "admin");
    expect(ok).toBe(true);
    expect((getUnseenRateIrregularities() as any[]).length).toBe(0);
    const row = db.prepare(`SELECT * FROM procurement_rate_alerts WHERE id = ?`).get(id) as any;
    expect(row.admin_seen).toBe(1);
    expect(row.admin_seen_by).toBe("admin");
    expect(row.admin_seen_at).toBeTruthy();
  });

  it("(10) getAllRateIrregularities returns every alert (seen + unseen) newest-first with paging", () => {
    const a = logRateAlertDecision(payload("proceeded"), "buyer1");
    logRateAlertDecision(payload("modified", null), "buyer1");
    markRateIrregularitySeen(a.id, "admin"); // even a seen row appears in /all
    const all = getAllRateIrregularities(50, 0) as any[];
    expect(all.length).toBe(2);
    const firstPage = getAllRateIrregularities(1, 0) as any[];
    expect(firstPage.length).toBe(1);
    const secondPage = getAllRateIrregularities(1, 1) as any[];
    expect(secondPage.length).toBe(1);
    expect(firstPage[0].id).not.toBe(secondPage[0].id);
  });

  it("rejects an invalid decision value", () => {
    expect(() => logRateAlertDecision({ ...payload("proceeded"), decision: "bogus" } as any, "buyer1"))
      .toThrow(/decision must be/);
  });
});
