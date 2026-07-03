// R27.29a — client-level breakdown in sales digest emails (salesperson + admin).
//
// Seeds a rep + their customers/payments/POs for a fixed calendar month and asserts
// getSalespersonClientBreakdown rows/sorting, the email table HTML (rows, fallbacks,
// highlights, ₹ formatting), admin team-activity ordering + skipping, month/scope
// isolation, that WhatsApp param arrays are byte-identical to R27.29, and that the
// digest log + sales_target_digest_log schema are untouched.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  getSalespersonClientBreakdown, getAllSalespersonsBreakdown,
  getMonthlyTargetProgress, getTeamAggregateProgress, getAllSalespersonProgress,
  getDigestLog, fmtCurrency,
} from "../../server/sales-progress";
import {
  paymentsTableHtml, posTableHtml, salespersonEmailHtml, adminEmailHtml,
  teamClientActivityHtml, teamClientActivityAllHtml, fmtMoney,
} from "../../server/sales-digest";

const YEAR = 2026, MONTH = 6;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const monthStart = new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0));
const monthEnd = new Date(NOW);
const inMonthMs = (day: number) => Date.UTC(2026, 5, day, 10, 0, 0);
const lastMonthMs = (day: number) => Date.UTC(2026, 4, day, 10, 0, 0);

let repSeq = 0;
function seedRep(opts: { email?: string | null; phone?: string | null; active?: number } = {}): number {
  repSeq += 1;
  const id = 780000 + repSeq;
  const phone = "phone" in opts ? opts.phone : "+919000000000";
  const email = "email" in opts ? opts.email : `rep${id}@nm.test`;
  db.prepare(
    `INSERT INTO data_team_users (id, username, password_hash, name, email, phone, role, active, created_at)
     VALUES (?, ?, 'x', ?, ?, ?, 'sales', ?, ?)`,
  ).run(id, `r2729a_rep_${id}`, `Rep ${id}`, email, phone, opts.active ?? 1, NOW);
  return id;
}
function seedCustomer(repId: number | null, name: string, createdAtMs = inMonthMs(2)): number {
  repSeq += 1;
  const id = 781000 + repSeq;
  db.prepare(`INSERT INTO customers (id, name, sales_rep_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, name, repId, createdAtMs);
  return id;
}
function seedPayment(customerId: number, amount: number, dateMs = inMonthMs(5)) {
  db.prepare(
    `INSERT INTO payment_records (customer_id, amount_inr, payment_mode, payment_date, created_at) VALUES (?, ?, 'neft', ?, ?)`,
  ).run(customerId, amount, dateMs, dateMs);
}
function seedPo(customerId: number, total: number, status = "draft", dateMs = inMonthMs(6)) {
  repSeq += 1;
  const id = 782000 + repSeq;
  db.prepare(
    `INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, po_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `R2729A-PO-${id}`, customerId, status, total, dateMs, dateMs, dateMs);
  return id;
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
  db.exec(`DELETE FROM data_team_users WHERE id >= 780000`);
  db.exec(`DELETE FROM customers WHERE id >= 781000`);
  db.exec(`DELETE FROM purchase_orders_v2 WHERE id >= 782000`);
  db.exec(`DELETE FROM payment_records WHERE customer_id >= 781000`);
  db.exec(`DELETE FROM sales_targets WHERE sales_rep_user_id >= 780000`);
  db.exec(`DELETE FROM sales_target_digest_log`);
  repSeq = 0;
});

describe("R27.29a — getSalespersonClientBreakdown", () => {
  it("(1) 3 clients, mixed payments+POs → correct rows, sorting, values", () => {
    const rep = seedRep();
    const cA = seedCustomer(rep, "Alpha");   // open PO 50k + pending(=open) → outstanding 100k
    const cB = seedCustomer(rep, "Bravo");    // payment only, no open PO
    const cC = seedCustomer(rep, "Charlie");  // open PO 300k → outstanding 600k (top)
    seedPayment(cA, 20000);
    seedPo(cA, 50000, "draft");
    seedPayment(cB, 90000);
    seedPo(cC, 300000, "confirmed");

    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    expect(clients.length).toBe(3);
    // sorted by (openPosValue + paymentsPending) desc → Charlie, Alpha, Bravo
    expect(clients.map((c) => c.customerName)).toEqual(["Charlie", "Alpha", "Bravo"]);

    const alpha = clients.find((c) => c.customerName === "Alpha")!;
    expect(alpha.paymentsCollected).toBe(20000);
    expect(alpha.posThisMonthValue).toBe(50000);
    expect(alpha.posThisMonthCount).toBe(1);
    expect(alpha.openPosValue).toBe(50000);
    expect(alpha.openPosCount).toBe(1);
    expect(alpha.paymentsPending).toBe(50000); // proxy = openPosValue

    const bravo = clients.find((c) => c.customerName === "Bravo")!;
    expect(bravo.paymentsCollected).toBe(90000);
    expect(bravo.openPosValue).toBe(0);
    expect(bravo.paymentsPending).toBe(0);
  });

  it("(1b) delivered/completed/cancelled POs are counted in POsThisMonth but NOT open", () => {
    const rep = seedRep();
    const c = seedCustomer(rep, "Delta");
    seedPo(c, 10000, "delivered");
    seedPo(c, 20000, "completed");
    seedPo(c, 40000, "cancelled");
    seedPo(c, 5000, "draft");
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    const d = clients[0];
    expect(d.posThisMonthCount).toBe(4);
    expect(d.posThisMonthValue).toBe(75000);
    expect(d.openPosCount).toBe(1);
    expect(d.openPosValue).toBe(5000);
  });

  it("(6) a PO created last month must NOT appear in this month's window", () => {
    const rep = seedRep();
    const c = seedCustomer(rep, "Echo");
    seedPo(c, 99999, "draft", lastMonthMs(20));   // May — excluded
    seedPayment(c, 12345, lastMonthMs(21));         // May — excluded
    seedPo(c, 7000, "draft", inMonthMs(9));          // June — counted
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    expect(clients[0].posThisMonthValue).toBe(7000);
    expect(clients[0].openPosValue).toBe(7000);
    expect(clients[0].paymentsCollected).toBe(0);
  });

  it("(8) client scope: a customer owned by another rep does not appear", () => {
    const rep = seedRep();
    const other = seedRep();
    const mine = seedCustomer(rep, "Mine");
    const theirs = seedCustomer(other, "Theirs");
    seedPo(mine, 1000, "draft");
    seedPo(theirs, 5000, "draft");
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    expect(clients.map((c) => c.customerName)).toEqual(["Mine"]);
  });
});

describe("R27.29a — payment/PO table HTML", () => {
  it("(2) salesperson with 0 clients shows both fallback messages", () => {
    expect(paymentsTableHtml([])).toContain("No client payment activity this month");
    expect(posTableHtml([])).toContain("No client PO activity this month");
  });

  it("(3) 1 client, settled PO only no payment → payment fallback, PO table populated", () => {
    // pending == openPosValue (documented proxy), so use a DELIVERED PO: it has PO
    // activity this month but zero open value → no pending → payments table empty.
    const rep = seedRep();
    const c = seedCustomer(rep, "OnlyPO");
    seedPo(c, 25000, "delivered");
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    expect(clients[0].paymentsCollected).toBe(0);
    expect(clients[0].paymentsPending).toBe(0);
    expect(paymentsTableHtml(clients)).toContain("No client payment activity this month");
    const poHtml = posTableHtml(clients);
    expect(poHtml).toContain("OnlyPO");
    expect(poHtml).toContain("1 / ₹ 25,000");
  });

  it("(highlight) pending>0 → amber #fff8e1; paid-only → green #e8f5e9", () => {
    const rep = seedRep();
    const pend = seedCustomer(rep, "PendCo"); seedPo(pend, 10000, "draft");
    const paid = seedCustomer(rep, "PaidCo"); seedPayment(paid, 8000);
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    const html = paymentsTableHtml(clients);
    const pendRow = html.split("<tr").find((s) => s.includes("PendCo"))!;
    const paidRow = html.split("<tr").find((s) => s.includes("PaidCo"))!;
    expect(pendRow).toContain("#fff8e1");
    expect(paidRow).toContain("#e8f5e9");
    // PO table: open PO row amber
    expect(posTableHtml(clients).split("<tr").find((s) => s.includes("PendCo"))!).toContain("#fff8e1");
  });

  it("(7) money formatted as ₹ 1,00,000 (Indian grouping), not $ or ungrouped", () => {
    expect(fmtMoney(100000)).toBe("₹ 1,00,000");
    const rep = seedRep();
    const c = seedCustomer(rep, "MoneyCo"); seedPayment(c, 100000);
    const html = paymentsTableHtml(getSalespersonClientBreakdown(rep, monthStart, monthEnd).clients);
    expect(html).toContain("₹ 1,00,000");
    expect(html).not.toContain("$");
    expect(html).not.toContain("₹100000");
  });
});

describe("R27.29a — admin team client activity", () => {
  it("(4) aggregates 2 salespeople and orders them by outstanding desc", () => {
    const r1 = seedRep(); const c1 = seedCustomer(r1, "R1Cust"); seedPo(c1, 100000, "draft");
    const r2 = seedRep(); const c2 = seedCustomer(r2, "R2Cust"); seedPo(c2, 500000, "draft");
    const breakdowns = getAllSalespersonsBreakdown(monthStart, monthEnd)
      .filter((b) => b.salespersonId >= 780000);
    const html = teamClientActivityHtml(breakdowns, "June 2026");
    expect(html).toContain("Team Client Activity — June 2026");
    // r2 has larger outstanding → appears before r1
    expect(html.indexOf(`Rep ${r2}`)).toBeLessThan(html.indexOf(`Rep ${r1}`));
    expect(html.indexOf(`Rep ${r2}`)).toBeGreaterThanOrEqual(0);
  });

  it("(5) skips reps with zero client activity entirely", () => {
    const active = seedRep(); const c = seedCustomer(active, "ActiveCust"); seedPo(c, 5000, "draft");
    const idle = seedRep(); // no customers/activity
    const breakdowns = getAllSalespersonsBreakdown(monthStart, monthEnd)
      .filter((b) => b.salespersonId >= 780000);
    const html = teamClientActivityHtml(breakdowns, "June 2026");
    expect(html).toContain(`Rep ${active}`);
    expect(html).not.toContain(`Rep ${idle}`);
  });

  it("(5b) all reps idle → whole section is empty string", () => {
    seedRep(); seedRep();
    const breakdowns = getAllSalespersonsBreakdown(monthStart, monthEnd)
      .filter((b) => b.salespersonId >= 780000);
    expect(teamClientActivityHtml(breakdowns, "June 2026")).toBe("");
  });
});

describe("R27.29a — WhatsApp payloads unchanged + digest log", () => {
  it("(9,10) salesperson + admin WhatsApp params identical to R27.29 format", async () => {
    process.env.DIGEST_MODE = "simulate";
    const salesCalls: string[][] = [];
    const adminCalls: string[][] = [];
    vi.doMock("../../server/whatsapp", () => ({
      sendSalesDigestWhatsApp: async (_m: string, params: string[]) => { salesCalls.push(params); return { status: "simulated" }; },
      sendAdminDigestWhatsApp: async (_m: string, params: string[]) => { adminCalls.push(params); return { status: "simulated" }; },
    }));
    vi.doMock("../../server/notifications", () => ({
      sendGenericEmail: async () => ({ ok: true }),
    }));
    vi.resetModules();

    const rep = seedRep({ phone: "+919111111111", email: "sim@nm.test" });
    const cust = seedCustomer(rep, "WaCo");
    seedPayment(cust, 40000);
    seedPo(cust, 50000, "draft");

    const { runSalesDigest } = await import("../../server/sales-digest");
    const prog = getAllSalespersonProgress(YEAR, MONTH, NOW).find((p) => p.salesperson.id === rep)!;
    const agg = getTeamAggregateProgress(YEAR, MONTH, NOW);
    await runSalesDigest({ year: YEAR, month: MONTH, now: NOW });

    // Expected salesperson params — exactly the 14-field R27.29 array.
    const expectedSales = [
      prog.salesperson.name, "June 2026", expect.any(String),
      fmtCurrency(prog.payments.target), fmtCurrency(prog.payments.achieved), fmtCurrency(prog.payments.remaining),
      fmtCurrency(prog.purchase_orders.target), fmtCurrency(prog.purchase_orders.achieved), fmtCurrency(prog.purchase_orders.remaining),
      String(prog.onboarding.target), String(prog.onboarding.achieved), String(prog.onboarding.remaining),
      String(prog.days_left), prog.status === "on_track" ? "On track" : "Behind",
    ];
    const mine = salesCalls.find((p) => p[0] === prog.salesperson.name)!;
    expect(mine).toBeTruthy();
    expect(mine.length).toBe(14);
    // field-by-field (skip the human date at idx 2)
    mine.forEach((v, i) => { if (i !== 2) expect(v).toBe(expectedSales[i]); });

    // Admin params — the 10-field R27.29 array (idx 1 is the date).
    expect(adminCalls.length).toBeGreaterThanOrEqual(1);
    const adm = adminCalls[0];
    expect(adm.length).toBe(10);
    expect(adm[0]).toBe("June 2026");
    expect(adm[3]).toBe(fmtCurrency(agg.payments.achieved));
    expect(adm[4]).toBe(fmtCurrency(agg.payments.target));

    vi.doUnmock("../../server/whatsapp");
    vi.doUnmock("../../server/notifications");
    vi.resetModules();
  });

  it("(11) digest log row still created per (recipient × channel)", async () => {
    process.env.DIGEST_MODE = "simulate";
    vi.doMock("../../server/whatsapp", () => ({
      sendSalesDigestWhatsApp: async () => ({ status: "simulated" }),
      sendAdminDigestWhatsApp: async () => ({ status: "simulated" }),
    }));
    vi.doMock("../../server/notifications", () => ({ sendGenericEmail: async () => ({ ok: true }) }));
    vi.resetModules();

    const rep = seedRep({ phone: "+919222222222", email: "log@nm.test" });
    const { runSalesDigest } = await import("../../server/sales-digest");
    const summary = await runSalesDigest({ year: YEAR, month: MONTH, now: NOW });
    const logs = getDigestLog(summary.digest_date) as any[];
    const mine = logs.filter((r) => r.recipient_user_id === rep);
    // this rep gets one whatsapp + one email row
    expect(mine.some((r) => r.channel === "whatsapp")).toBe(true);
    expect(mine.some((r) => r.channel === "email")).toBe(true);
    // admin gets its own whatsapp + email rows
    expect(logs.some((r) => r.recipient_type === "admin" && r.channel === "whatsapp")).toBe(true);
    expect(logs.some((r) => r.recipient_type === "admin" && r.channel === "email")).toBe(true);

    vi.doUnmock("../../server/whatsapp");
    vi.doUnmock("../../server/notifications");
    vi.resetModules();
  });

  it("(12) sales_target_digest_log schema untouched — original columns still SELECTable", () => {
    const row = db.prepare(
      `SELECT id, digest_date, recipient_type, recipient_user_id, recipient_email,
              recipient_mobile, channel, status, error, payload_summary, sent_at
         FROM sales_target_digest_log LIMIT 1`,
    ).all();
    expect(Array.isArray(row)).toBe(true); // query compiles = schema intact
  });
});

describe("R27.29a — full email HTML smoke", () => {
  it("salesperson email embeds both breakdown tables; admin email embeds team section", () => {
    const rep = seedRep();
    const c = seedCustomer(rep, "SmokeCo");
    seedPayment(c, 10000); seedPo(c, 20000, "draft");
    const prog = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);
    const spHtml = salespersonEmailHtml(prog, clients, "June 2026", "15 Jun 2026");
    expect(spHtml).toContain("Payments — Client Breakdown");
    expect(spHtml).toContain("Purchase Orders — Client Breakdown");
    expect(spHtml).toContain("SmokeCo");

    const agg = getTeamAggregateProgress(YEAR, MONTH, NOW);
    const rows = getAllSalespersonProgress(YEAR, MONTH, NOW);
    const breakdowns = rows.map((p) => ({
      salespersonId: p.salesperson.id, salespersonName: p.salesperson.name,
      clients: getSalespersonClientBreakdown(p.salesperson.id, monthStart, monthEnd).clients,
    }));
    const admHtml = adminEmailHtml(agg, rows, breakdowns, "June 2026", "15 Jun 2026");
    expect(admHtml).toContain("Team Client Activity — June 2026");
    expect(admHtml).toContain("SmokeCo");
  });
});

// R27.29b — client section is ALWAYS rendered; empty state lives INSIDE the tbody
// (single colspan row) rather than hiding the table, so a zero-activity rep still
// gets visible proof the new rendering shipped.
describe("R27.29b — always-render client section", () => {
  it("(b1) salesperson with zero clients renders BOTH tables with headers + empty-state row inside tbody", () => {
    const rep = seedRep();
    const prog = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    const html = salespersonEmailHtml(prog, [], "June 2026", "15 Jun 2026");
    // Both section headers present
    expect(html).toContain("Payments — Client Breakdown");
    expect(html).toContain("Purchase Orders — Client Breakdown");
    // Both tables still rendered (structure not replaced by a bare <p>)
    expect(html).toContain(`<th style="padding:8px;text-align:right">Collected (₹)</th>`);
    expect(html).toContain(`<th style="padding:8px;text-align:right">Open POs (# / ₹)</th>`);
    // Empty-state is a colspan=3 row sitting INSIDE the tbody, for both tables
    expect(html).toContain(
      `<tbody><tr><td colspan="3" style="text-align:center; color:#666; padding:16px;">No client payment activity this month</td></tr></tbody>`,
    );
    expect(html).toContain(
      `<tbody><tr><td colspan="3" style="text-align:center; color:#666; padding:16px;">No client PO activity this month</td></tr></tbody>`,
    );
  });

  it("(b2) 1 client with payments only → payments table has data, POs table shows empty-state row", () => {
    const rep = seedRep();
    const c = seedCustomer(rep, "PayOnlyCo");
    seedPayment(c, 40000); // collected>0, no PO → no open/this-month PO activity
    const { clients } = getSalespersonClientBreakdown(rep, monthStart, monthEnd);

    const payHtml = paymentsTableHtml(clients);
    expect(payHtml).toContain("PayOnlyCo");
    expect(payHtml).toContain("₹ 40,000");
    expect(payHtml).not.toContain("No client payment activity this month");

    const poHtml = posTableHtml(clients);
    expect(poHtml).toContain(
      `<tbody><tr><td colspan="3" style="text-align:center; color:#666; padding:16px;">No client PO activity this month</td></tr></tbody>`,
    );
    expect(poHtml).not.toContain("PayOnlyCo");
  });

  it("(b3) admin email ALWAYS renders the 'Team Client Activity' section header", () => {
    const rep = seedRep();
    const prog = getMonthlyTargetProgress(rep, YEAR, MONTH, NOW);
    const agg = getTeamAggregateProgress(YEAR, MONTH, NOW);
    // Even with an empty breakdowns list the header (and a team-level fallback) render.
    const html = adminEmailHtml(agg, [prog], [], "June 2026", "15 Jun 2026");
    expect(html).toContain("Team Client Activity — June 2026");
    expect(html).toContain("No client activity across the team yet this month");
    // Direct helper contract
    expect(teamClientActivityAllHtml([], "June 2026")).toContain("Team Client Activity — June 2026");
  });

  it("(b4) admin email with all reps idle renders one block per rep, each with two empty-state tables", () => {
    const r1 = seedRep(); const r2 = seedRep(); const r3 = seedRep();
    const reps = [r1, r2, r3];
    const rows = reps.map((id) => getMonthlyTargetProgress(id, YEAR, MONTH, NOW));
    const breakdowns = reps.map((id) => ({
      salespersonId: id,
      salespersonName: `Rep ${id}`,
      clients: getSalespersonClientBreakdown(id, monthStart, monthEnd).clients, // all empty
    }));
    const agg = getTeamAggregateProgress(YEAR, MONTH, NOW);
    const html = adminEmailHtml(agg, rows, breakdowns, "June 2026", "15 Jun 2026");

    // One block header per rep
    for (const id of reps) expect(html).toContain(`Rep ${id}`);
    // Two empty-state tables per rep → 3 of each message
    const count = (h: string, needle: string) => h.split(needle).length - 1;
    expect(count(html, "No client payment activity this month")).toBe(3);
    expect(count(html, "No client PO activity this month")).toBe(3);
  });
});
