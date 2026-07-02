// R27.29 — Sales target progress computation + daily digest orchestration.
//
// Seeds a salesperson (data_team_users role='sales') plus their attributed
// payments / POs / onboarded customers for a fixed calendar month, then asserts
// the computed target/achieved/remaining/pct, days-left math, team aggregation,
// and that the digest orchestrator logs every channel in DIGEST_MODE=simulate
// without throwing (email may fail with no Brevo key — that must be logged, not
// raised).
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  getMonthlyTargetProgress, getActiveSalespeople, getAllSalespersonProgress,
  getTeamAggregateProgress, logDigest, getDigestLog, digestAlreadySentToday,
} from "../../server/sales-progress";

// Fixed test month: June 2026 (30 days). now = 15 June 2026 12:00 UTC (mid-month).
const YEAR = 2026, MONTH = 6;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const YM = "2026-06";
const inMonthMs = (day: number) => Date.UTC(2026, 5, day, 10, 0, 0);

let repSeq = 0;
function seedRep(opts: { email?: string | null; phone?: string | null; active?: number } = {}): number {
  repSeq += 1;
  const id = 770000 + repSeq;
  // NB: use `in` checks so an explicit `null` is honoured (null ?? default would
  // silently fall back to the default and hide the skipped_no_* paths).
  const phone = "phone" in opts ? opts.phone : "+919000000000";
  const email = "email" in opts ? opts.email : `rep${id}@nm.test`;
  db.prepare(
    `INSERT INTO data_team_users (id, username, password_hash, name, email, phone, role, active, created_at)
     VALUES (?, ?, 'x', ?, ?, ?, 'sales', ?, ?)`,
  ).run(id, `r2729_rep_${id}`, `Rep ${id}`, email, phone, opts.active ?? 1, NOW);
  return id;
}
function seedCustomer(repId: number, createdAtMs = inMonthMs(2)): number {
  repSeq += 1;
  const id = 771000 + repSeq;
  db.prepare(`INSERT INTO customers (id, name, sales_rep_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, `Cust ${id}`, repId, createdAtMs);
  return id;
}
function seedTarget(repId: number, metric: string, amount: number) {
  db.prepare(
    `INSERT INTO sales_targets (sales_rep_user_id, target_type, metric, period_start, period_end, target_amount, created_at)
     VALUES (?, 'monthly', ?, ?, ?, ?, ?)`,
  ).run(repId, metric, `${YM}-01T00:00:00.000Z`, `${YM}-30T23:59:59.999Z`, amount, NOW);
}
function seedPayment(customerId: number, amount: number, dateMs = inMonthMs(5)) {
  db.prepare(
    `INSERT INTO payment_records (customer_id, amount_inr, payment_mode, payment_date, created_at) VALUES (?, ?, 'neft', ?, ?)`,
  ).run(customerId, amount, dateMs, dateMs);
}
function seedPo(customerId: number, total: number, dateMs = inMonthMs(6)) {
  repSeq += 1;
  const id = 772000 + repSeq;
  db.prepare(
    `INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, po_date, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(id, `R2729-PO-${id}`, customerId, total, dateMs, dateMs, dateMs);
}

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_29Migrations();
});

beforeEach(() => {
  db.exec(`DELETE FROM data_team_users WHERE id >= 770000`);
  db.exec(`DELETE FROM customers WHERE id >= 771000`);
  db.exec(`DELETE FROM purchase_orders_v2 WHERE id >= 772000`);
  db.exec(`DELETE FROM payment_records WHERE customer_id >= 771000`);
  db.exec(`DELETE FROM sales_targets WHERE sales_rep_user_id >= 770000`);
  db.exec(`DELETE FROM sales_target_digest_log`);
  repSeq = 0;
});

describe("R27.29 — getMonthlyTargetProgress", () => {
  it("(1) computes achieved/remaining/pct across payments, POs, onboarding", () => {
    const rep = seedRep();
    const cust = seedCustomer(rep);
    seedTarget(rep, "payment", 100000);
    seedTarget(rep, "po", 200000);
    seedTarget(rep, "onboarding", 4);
    seedPayment(cust, 40000);
    seedPayment(cust, 20000);
    seedPo(cust, 50000);
    // one more onboarded customer this month (total 2)
    seedCustomer(rep, inMonthMs(3));

    const p = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    expect(p.payments.target).toBe(100000);
    expect(p.payments.achieved).toBe(60000);
    expect(p.payments.remaining).toBe(40000);
    expect(p.payments.pct).toBe(60);

    expect(p.purchase_orders.target).toBe(200000);
    expect(p.purchase_orders.achieved).toBe(50000);
    expect(p.purchase_orders.pct).toBe(25);

    expect(p.onboarding.target).toBe(4);
    expect(p.onboarding.achieved).toBe(2);
    expect(p.onboarding.remaining).toBe(2);
    expect(p.onboarding.pct).toBe(50);
  });

  it("(2) sums multiple monthly targets for the same metric", () => {
    const rep = seedRep();
    seedTarget(rep, "payment", 30000);
    seedTarget(rep, "payment", 20000);
    const p = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    expect(p.payments.target).toBe(50000);
  });

  it("(3) excludes payments/POs outside the month and soft-deleted POs", () => {
    const rep = seedRep();
    const cust = seedCustomer(rep, inMonthMs(1));
    seedTarget(rep, "payment", 100000);
    seedTarget(rep, "po", 100000);
    seedPayment(cust, 10000, Date.UTC(2026, 4, 20, 10, 0, 0)); // May — excluded
    seedPayment(cust, 5000, inMonthMs(7));                     // June — counted
    seedPo(cust, 70000, inMonthMs(8));
    // soft-deleted PO must not count
    db.prepare(
      `INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, po_date, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    ).run(779999, "R2729-PO-DEL", cust, 999999, inMonthMs(9), inMonthMs(9), inMonthMs(9), inMonthMs(10));

    const p = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    expect(p.payments.achieved).toBe(5000);
    expect(p.purchase_orders.achieved).toBe(70000);
  });

  it("(4) pct is 0 (not NaN) when a category has no target", () => {
    const rep = seedRep();
    const p = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    expect(p.payments.pct).toBe(0);
    expect(p.payments.remaining).toBe(0);
  });
});

describe("R27.29 — days_left", () => {
  it("(5) 0 on the last day of the month", () => {
    const lastDay = Date.UTC(2026, 5, 30, 12, 0, 0);
    expect(getMonthlyTargetProgress(seedRep(), YEAR, MONTH, lastDay).days_left).toBe(0);
  });
  it("(6) 30 on the 1st of a 31-day month (July)", () => {
    const firstJuly = Date.UTC(2026, 6, 1, 12, 0, 0);
    expect(getMonthlyTargetProgress(seedRep(), 2026, 7, firstJuly).days_left).toBe(30);
  });
});

describe("R27.29 — status", () => {
  it("(7) 'behind' when a targeted category lags the elapsed-month pace", () => {
    const rep = seedRep();
    seedTarget(rep, "payment", 100000);
    // mid-month (~47% elapsed): 0 collected → behind
    const p = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    expect(p.status).toBe("behind");
  });
  it("(8) 'on_track' when there are no targets to fall behind on", () => {
    const p = getMonthlyTargetProgress(seedRep(), YEAR, MONTH, NOW);
    expect(p.status).toBe("on_track");
  });
});

describe("R27.29 — roster + aggregate", () => {
  it("(9) getActiveSalespeople excludes inactive/deleted reps", () => {
    const active = seedRep({ active: 1 });
    const inactive = seedRep({ active: 0 });
    const del = seedRep({ active: 1 });
    db.prepare(`UPDATE data_team_users SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), del);
    const ids = getActiveSalespeople().map((s) => s.id);
    expect(ids).toContain(active);
    expect(ids).not.toContain(inactive);
    expect(ids).not.toContain(del);
  });

  it("(10) getTeamAggregateProgress sums per-category targets/achieved across reps", () => {
    const r1 = seedRep(); const c1 = seedCustomer(r1);
    const r2 = seedRep(); const c2 = seedCustomer(r2);
    seedTarget(r1, "payment", 100000); seedPayment(c1, 30000);
    seedTarget(r2, "payment", 50000);  seedPayment(c2, 10000);
    const agg = getTeamAggregateProgress(YEAR, MONTH, NOW);
    // other reps may exist from seed data, so assert our contribution is included
    expect(agg.payments.target).toBeGreaterThanOrEqual(150000);
    expect(agg.payments.achieved).toBeGreaterThanOrEqual(40000);
    expect(agg.count).toBeGreaterThanOrEqual(2);
  });
});

describe("R27.29 — digest log helpers", () => {
  it("(11) logDigest persists and getDigestLog / digestAlreadySentToday read it back", () => {
    const date = "2026-06-15";
    expect(digestAlreadySentToday(date)).toBe(false);
    logDigest({ digest_date: date, recipient_type: "salesperson", channel: "whatsapp", status: "simulated" });
    expect(digestAlreadySentToday(date)).toBe(true);
    const log = getDigestLog(date) as any[];
    expect(log.length).toBe(1);
    expect(log[0].channel).toBe("whatsapp");
    expect(log[0].status).toBe("simulated");
  });
});

describe("R27.29 — runSalesDigest orchestration (DIGEST_MODE=simulate)", () => {
  it("(12) simulate WhatsApp → 'simulated' and logs every recipient without throwing", async () => {
    process.env.DIGEST_MODE = "simulate";
    const rep = seedRep({ phone: "+919111111111", email: "sim@nm.test" });
    seedTarget(rep, "payment", 100000);
    const { runSalesDigest } = await import("../../server/sales-digest");
    const summary = await runSalesDigest({ year: YEAR, month: MONTH, now: NOW });
    expect(summary.salespeople).toBeGreaterThanOrEqual(1);
    // at least the salesperson WA + the admin WA were simulated
    expect(summary.simulated).toBeGreaterThanOrEqual(2);
    const waLogs = (getDigestLog(summary.digest_date) as any[]).filter((r) => r.channel === "whatsapp");
    expect(waLogs.some((r) => r.status === "simulated")).toBe(true);
  });

  it("(13) a salesperson with no mobile is logged skipped_no_mobile, no crash", async () => {
    process.env.DIGEST_MODE = "simulate";
    const rep = seedRep({ phone: null, email: "noemobile@nm.test" });
    seedTarget(rep, "payment", 100000);
    const { runSalesDigest } = await import("../../server/sales-digest");
    const summary = await runSalesDigest({ year: YEAR, month: MONTH, now: NOW });
    const waSkipped = (getDigestLog(summary.digest_date) as any[])
      .filter((r) => r.recipient_user_id === rep && r.channel === "whatsapp");
    expect(waSkipped.some((r) => r.status === "skipped_no_mobile")).toBe(true);
  });

  it("(14) a salesperson with no email is logged skipped_no_email, no crash", async () => {
    process.env.DIGEST_MODE = "simulate";
    const rep = seedRep({ phone: "+919222222222", email: null });
    seedTarget(rep, "payment", 100000);
    const { runSalesDigest } = await import("../../server/sales-digest");
    const summary = await runSalesDigest({ year: YEAR, month: MONTH, now: NOW });
    const emailLogs = (getDigestLog(summary.digest_date) as any[])
      .filter((r) => r.recipient_user_id === rep && r.channel === "email");
    expect(emailLogs.some((r) => r.status === "skipped_no_email")).toBe(true);
  });
});
