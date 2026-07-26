// R27.36 — expense slip module + expense ledger.
//
// Same shape as the R27.35 suite: business logic is pure and takes the raw sqlite
// handle, so these drive it directly rather than through HTTP (the project has no
// HTTP test harness).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { APPROVER_USERNAME, type Actor } from "../../server/routes-payments";
import {
  hasExpenseAccess, EXPENSE_ROLES, computeExpenseGst, approvalForTotal,
  createCategory, listCategories, deactivateCategory,
  createPayee, listPayees,
  createExpense, getExpense, listExpenses, updateExpense, softDeleteExpense,
  listExpenseApprovals, countPendingExpenseApprovals, approveExpense, rejectExpense,
  getLedger, nextExpenseSlipNumber, generateExpenseSlip,
  nextRecurringDate, dueRecurringExpenses, runRecurringExpenses,
} from "../../server/routes-expenses";
import { msUntilNextRecurringRun, runRecurringExpenseJob } from "../../server/expense-recurring-cron";

const OWNER: Actor = { userId: null, userName: "Piyush Anand", username: APPROVER_USERNAME };
const OTHER_ADMIN: Actor = { userId: null, userName: "Second Admin", username: "admin2" };
const FINANCE: Actor = { userId: 9, userName: "Finance User", username: "fin_meera" };

const day = (d: string) => new Date(`${d}T00:00:00.000`).getTime();
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "r2736-uploads-"));

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_35Migrations();
  migrations.runR27_36Migrations();
});

afterAll(() => {
  try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

let CAT = 0;
beforeEach(() => {
  for (const t of ["expense_slips", "expense_payees", "expense_categories"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  CAT = createCategory(db, { name: "Office Rent" }, FINANCE).id;
});

// ---------------------------------------------------------------------------
describe("R27.36 roles", () => {
  it("(1) only admin and finance may book expenses", () => {
    expect(EXPENSE_ROLES).toEqual(["admin", "finance"]);
    expect(hasExpenseAccess("admin")).toBe(true);
    expect(hasExpenseAccess("finance")).toBe(true);
    // Roles that can raise a payment slip still cannot book an expense.
    expect(hasExpenseAccess("procurement")).toBe(false);
    expect(hasExpenseAccess("data_team")).toBe(false);
    expect(hasExpenseAccess("sales")).toBe(false);
    expect(hasExpenseAccess(undefined)).toBe(false);
  });

  it("(1b) role check is trim- and case-tolerant", () => {
    expect(hasExpenseAccess("  Finance ")).toBe(true);
    expect(hasExpenseAccess("ADMIN")).toBe(true);
  });
});

describe("R27.36 categories", () => {
  it("(2) creates a category", () => {
    const c = createCategory(db, { name: "Electricity", description: "Monthly bill" }, FINANCE);
    expect(c.name).toBe("Electricity");
    expect(c.is_active).toBe(1);
    expect(listCategories(db).map((x) => x.name)).toContain("Electricity");
  });

  it("(3) rejects a duplicate category name, case-insensitively", () => {
    createCategory(db, { name: "Electricity" }, FINANCE);
    expect(() => createCategory(db, { name: "electricity" }, FINANCE)).toThrow(/already exists/i);
  });

  it("(3b) a deactivated category drops out of the default list", () => {
    const c = createCategory(db, { name: "Old Line" }, FINANCE);
    deactivateCategory(db, c.id);
    expect(listCategories(db).map((x) => x.id)).not.toContain(c.id);
    expect(listCategories(db, true).map((x) => x.id)).toContain(c.id);
  });
});

describe("R27.36 payees", () => {
  it("(4) creates a payee with full GST/PAN/bank details", () => {
    const p = createPayee(db, {
      name: "Sharma Properties", phone: "9811122233", email: "a@b.com",
      address: "Karol Bagh, Delhi", gst_number: "07AABCU9603R1ZM", pan_number: "AABCU9603R",
      bank_account: "50100234567890", ifsc: "HDFC0001234", bank_name: "HDFC Bank",
    }, FINANCE);
    expect(p.id).toBeGreaterThan(0);
    expect(p.gst_number).toBe("07AABCU9603R1ZM");
    expect(p.ifsc).toBe("HDFC0001234");
    expect(p.bank_account).toBe("50100234567890");
  });

  it("(4b) payee search matches name, phone and GSTIN", () => {
    createPayee(db, { name: "Sharma Properties", phone: "9811122233", gst_number: "07AABCU9603R1ZM" }, FINANCE);
    createPayee(db, { name: "Delhi Power Ltd" }, FINANCE);
    expect(listPayees(db, "sharma").length).toBe(1);
    expect(listPayees(db, "98111").length).toBe(1);
    expect(listPayees(db, "07AABC").length).toBe(1);
    expect(listPayees(db).length).toBe(2);
  });
});

describe("R27.36 expense creation", () => {
  it("(5) free-text payee stores the text and leaves payee_id null", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Local Chaiwala", amount: 250,
      description: "Office tea", expense_date: "2026-07-01",
    }, FINANCE);
    expect(e.payee_id).toBeNull();
    expect(e.payee_name_freetext).toBe("Local Chaiwala");
    expect(e.payee_name).toBe("Local Chaiwala");
  });

  it("(6) saved payee stores payee_id and nulls the free-text column", () => {
    const p = createPayee(db, { name: "Sharma Properties" }, FINANCE);
    const e = createExpense(db, {
      category_id: CAT, payee_id: p.id, payee_name_freetext: "typed by mistake",
      amount: 1000, expense_date: "2026-07-01",
    }, FINANCE);
    expect(e.payee_id).toBe(p.id);
    expect(e.payee_name_freetext).toBeNull();
    expect(e.payee_name).toBe("Sharma Properties");
  });

  it("(6b) an expense with neither payee shape is rejected", () => {
    expect(() => createExpense(db, { category_id: CAT, amount: 100 }, FINANCE)).toThrow(/payee is required/i);
  });

  it("(6c) a missing category is rejected", () => {
    expect(() => createExpense(db, { category_id: 99999, payee_name_freetext: "X", amount: 100 }, FINANCE))
      .toThrow(/Category not found/i);
  });
});

describe("R27.36 GST math (mirrors R27.33a)", () => {
  it("(7) exclusive adds GST on top", () => {
    const g = computeExpenseGst(1000, 18, "exclusive");
    expect(g.amount).toBe(1000);
    expect(g.gst_amount).toBe(180);
    expect(g.total_amount).toBe(1180);
  });

  it("(7b) inclusive back-computes GST out of the amount", () => {
    const g = computeExpenseGst(1180, 18, "inclusive");
    expect(g.amount).toBe(1180);
    expect(g.total_amount).toBe(1180);
    expect(g.taxable_value).toBe(1000);
    expect(g.gst_amount).toBe(180);
  });

  it("(7c) zero GST is a pass-through in both modes", () => {
    expect(computeExpenseGst(500, 0, "exclusive").total_amount).toBe(500);
    expect(computeExpenseGst(500, 0, "inclusive").gst_amount).toBe(0);
  });

  it("(7d) the stored row carries the same numbers", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "V", amount: 1000, gst_percent: 18, gst_mode: "exclusive",
    }, FINANCE);
    expect(e.amount).toBe(1000);
    expect(e.gst_amount).toBe(180);
    expect(e.total_amount).toBe(1180);
    expect(e.gst_mode).toBe("exclusive");
  });
});

describe("R27.36 approval threshold (reuses R27.35)", () => {
  it("(8) at or under ₹5,000 auto-approves", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 4000 }, FINANCE);
    expect(e.approval_status).toBe("auto_approved");
    expect(e.approved_by).toBe("system");
    expect(e.approved_at).toBeTruthy();
    // Exactly ₹5,000 is still auto — the gate is strictly greater-than.
    expect(approvalForTotal(5000)).toBe("auto_approved");
    expect(approvalForTotal(5000.01)).toBe("pending_approval");
  });

  it("(9) over ₹5,000 lands in the queue", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 8000 }, FINANCE);
    expect(e.approval_status).toBe("pending_approval");
    expect(e.approved_by).toBeNull();
    expect(countPendingExpenseApprovals(db)).toBe(1);
    expect(listExpenseApprovals(db).map((x) => x.id)).toContain(e.id);
  });

  it("(9b) the threshold is measured post-GST", () => {
    // ₹4,500 + 18% exclusive = ₹5,310 — under the line before tax, over it after.
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "V", amount: 4500, gst_percent: 18, gst_mode: "exclusive",
    }, FINANCE);
    expect(e.total_amount).toBe(5310);
    expect(e.approval_status).toBe("pending_approval");
  });

  it("(10) only narmadamobility123 can approve; another admin gets 403", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    expect(() => approveExpense(db, e.id, OTHER_ADMIN)).toThrow(/Only narmadamobility123/i);
    try { approveExpense(db, e.id, OTHER_ADMIN); } catch (err: any) { expect(err.status).toBe(403); }
    const ok = approveExpense(db, e.id, OWNER);
    expect(ok.approval_status).toBe("approved");
    expect(ok.approved_by).toBe(APPROVER_USERNAME);
    expect(countPendingExpenseApprovals(db)).toBe(0);
  });

  it("(11) a rejection reason under 5 characters is refused", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    expect(() => rejectExpense(db, e.id, "no", OWNER)).toThrow(/at least 5 characters/i);
    expect(getExpense(db, e.id).approval_status).toBe("pending_approval");
    const r = rejectExpense(db, e.id, "Duplicate of last month", OWNER);
    expect(r.approval_status).toBe("rejected");
    expect(r.rejection_reason).toBe("Duplicate of last month");
  });

  it("(11b) deciding twice returns 409, and an auto-approved row was never in the queue", () => {
    const big = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    approveExpense(db, big.id, OWNER);
    expect(() => approveExpense(db, big.id, OWNER)).toThrow(/already approved/i);
    const small = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 100 }, FINANCE);
    expect(() => approveExpense(db, small.id, OWNER)).toThrow(/already auto approved/i);
  });

  it("(11c) editing an expense re-decides its approval", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 4000 }, FINANCE);
    expect(e.approval_status).toBe("auto_approved");
    const up = updateExpense(db, e.id, { amount: 9000 });
    expect(up.approval_status).toBe("pending_approval");
  });
});

describe("R27.36 slips", () => {
  function approvedExpense(amount = 2500, date = "2026-07-01") {
    return createExpense(db, {
      category_id: CAT, payee_name_freetext: "Sharma Properties", amount,
      gst_percent: 18, gst_mode: "exclusive", description: "July office rent", expense_date: date,
    }, FINANCE);
  }

  it("(12) slip number is EXP/YYYY/NNNN and increments", () => {
    expect(nextExpenseSlipNumber(db, 2026)).toBe("EXP/2026/0001");
    const a = generateExpenseSlip(db, approvedExpense().id, uploadsDir);
    expect(a.slip_number).toBe("EXP/2026/0001");
    const b = generateExpenseSlip(db, approvedExpense().id, uploadsDir);
    expect(b.slip_number).toBe("EXP/2026/0002");
  });

  it("(12b) the rendered JPG lands on disk and is a real image over 10 KB", () => {
    const out = generateExpenseSlip(db, approvedExpense().id, uploadsDir);
    expect(out.jpeg.length).toBeGreaterThan(10 * 1024);
    // JPEG SOI marker.
    expect(out.jpeg[0]).toBe(0xff);
    expect(out.jpeg[1]).toBe(0xd8);
    const onDisk = path.join(uploadsDir, "expense-slips", out.file_name);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.statSync(onDisk).size).toBeGreaterThan(10 * 1024);
    expect(out.path).toBe(`/uploads/expense-slips/${out.file_name}`);
    expect(getExpense(db, out.expense.id).slip_number).toBe(out.slip_number);
  });

  it("(13) cannot generate a slip while pending approval", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    expect(() => generateExpenseSlip(db, e.id, uploadsDir)).toThrow(/pending approval/i);
    // Once released it works.
    approveExpense(db, e.id, OWNER);
    expect(generateExpenseSlip(db, e.id, uploadsDir).slip_number).toMatch(/^EXP\/\d{4}\/\d{4}$/);
  });

  it("(14) cannot generate a slip for a rejected expense", () => {
    const e = createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    rejectExpense(db, e.id, "Not an approved vendor", OWNER);
    expect(() => generateExpenseSlip(db, e.id, uploadsDir)).toThrow(/rejected/i);
  });

  it("(14b) a slipped expense can no longer be edited", () => {
    const e = approvedExpense();
    generateExpenseSlip(db, e.id, uploadsDir);
    expect(() => updateExpense(db, e.id, { amount: 999 })).toThrow(/slip/i);
  });
});

describe("R27.36 ledger", () => {
  function slipped(amount: number, date: string, categoryId = CAT, payeeId: number | null = null) {
    const e = createExpense(db, {
      category_id: categoryId, payee_id: payeeId ?? undefined,
      payee_name_freetext: payeeId ? undefined : "Cash Payee",
      amount, expense_date: date,
    }, FINANCE);
    generateExpenseSlip(db, e.id, uploadsDir);
    return e;
  }

  it("(15) running balance accumulates oldest-first", () => {
    slipped(1000, "2026-07-01");
    slipped(2000, "2026-07-05");
    slipped(500, "2026-07-09");
    const l = getLedger(db);
    expect(l.entries.map((e) => e.total_amount)).toEqual([1000, 2000, 500]);
    expect(l.entries.map((e) => e.running_balance)).toEqual([1000, 3000, 3500]);
    expect(l.total_debit).toBe(3500);
    expect(l.entry_count).toBe(3);
  });

  it("(15b) only slipped + approved rows reach the ledger", () => {
    slipped(1000, "2026-07-01");
    // Un-slipped auto-approved row.
    createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 400, expense_date: "2026-07-02" }, FINANCE);
    // Pending row.
    createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000, expense_date: "2026-07-03" }, FINANCE);
    const l = getLedger(db);
    expect(l.entry_count).toBe(1);
    expect(l.total_debit).toBe(1000);
  });

  it("(16) ledger filters by category, payee and date range", () => {
    const other = createCategory(db, { name: "Fuel" }, FINANCE).id;
    const payee = createPayee(db, { name: "Sharma Properties" }, FINANCE).id;
    slipped(1000, "2026-06-10");
    slipped(2000, "2026-07-05", other);
    slipped(3000, "2026-07-20", CAT, payee);

    expect(getLedger(db, { category_id: other }).total_debit).toBe(2000);
    expect(getLedger(db, { payee_id: payee }).total_debit).toBe(3000);
    expect(getLedger(db, { from: "2026-07-01" }).total_debit).toBe(5000);
    expect(getLedger(db, { from: "2026-07-01", to: "2026-07-10" }).total_debit).toBe(2000);
  });

  it("(16b) grouping buckets by category, payee and month", () => {
    const fuel = createCategory(db, { name: "Fuel" }, FINANCE).id;
    slipped(1000, "2026-06-10");
    slipped(2000, "2026-07-05", fuel);
    slipped(500, "2026-07-06", fuel);
    const l = getLedger(db);
    expect(l.grouped_by_category["Office Rent"]).toBe(1000);
    expect(l.grouped_by_category["Fuel"]).toBe(2500);
    expect(l.grouped_by_payee["Cash Payee"]).toBe(3500);
    expect(l.grouped_by_month["2026-06"]).toBe(1000);
    expect(l.grouped_by_month["2026-07"]).toBe(2500);
  });

  it("(17) a soft-deleted expense disappears from the ledger and the list", () => {
    const e = slipped(1000, "2026-07-01");
    slipped(2000, "2026-07-02");
    expect(getLedger(db).total_debit).toBe(3000);
    softDeleteExpense(db, e.id);
    const l = getLedger(db);
    expect(l.entry_count).toBe(1);
    expect(l.total_debit).toBe(2000);
    expect(listExpenses(db).map((x) => x.id)).not.toContain(e.id);
  });

  it("(17b) list filters by status and free-text search", () => {
    createExpense(db, { category_id: CAT, payee_name_freetext: "Chaiwala", amount: 200, description: "Office tea" }, FINANCE);
    createExpense(db, { category_id: CAT, payee_name_freetext: "Landlord", amount: 9000, description: "Rent" }, FINANCE);
    expect(listExpenses(db, { status: "pending_approval" }).length).toBe(1);
    expect(listExpenses(db, { status: "auto_approved" }).length).toBe(1);
    expect(listExpenses(db, { q: "chai" }).length).toBe(1);
    expect(listExpenses(db, { q: "office tea" }).length).toBe(1);
    expect(listExpenses(db, { q: "office rent" }).length).toBe(2); // category name matches both
  });
});

describe("R27.36 recurring", () => {
  it("(18) frequency math steps by month, quarter and year", () => {
    const base = day("2026-01-15");
    expect(new Date(nextRecurringDate(base, "monthly")).toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(new Date(nextRecurringDate(base, "quarterly")).toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(new Date(nextRecurringDate(base, "yearly")).toISOString().slice(0, 10)).toBe("2027-01-15");
  });

  it("(19) the cron creates a child and advances the parent's next date", () => {
    const parent = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Landlord", amount: 3000,
      description: "Monthly rent", expense_date: "2026-07-01",
      is_recurring: true, recurring_frequency: "monthly", recurring_next_date: "2026-07-01",
    }, FINANCE);
    expect(parent.is_recurring).toBe(1);

    const today = day("2026-07-01");
    expect(dueRecurringExpenses(db, today).map((r) => r.id)).toContain(parent.id);

    const out = runRecurringExpenses(db, today);
    expect(out.created).toBe(1);

    const child = getExpense(db, out.ids[0]);
    expect(child.recurring_parent_id).toBe(parent.id);
    expect(child.amount).toBe(3000);
    expect(child.category_id).toBe(CAT);
    // A child is never itself a template — templates must not fork into a tree.
    expect(child.is_recurring).toBe(0);
    expect(child.approval_status).toBe("auto_approved");

    const after = getExpense(db, parent.id);
    expect(new Date(after.recurring_next_date).toISOString().slice(0, 10)).toBe("2026-08-01");
    // Nothing is due any more on the same day.
    expect(runRecurringExpenses(db, today).created).toBe(0);
  });

  it("(19b) a recurring child over the threshold still enters the approval queue", () => {
    createExpense(db, {
      category_id: CAT, payee_name_freetext: "Landlord", amount: 40000,
      is_recurring: true, recurring_frequency: "monthly",
      expense_date: "2026-07-01", recurring_next_date: "2026-07-01",
    }, FINANCE);
    const out = runRecurringExpenses(db, day("2026-07-01"));
    expect(out.created).toBe(1);
    expect(getExpense(db, out.ids[0]).approval_status).toBe("pending_approval");
  });

  it("(19c) after downtime the series rolls forward instead of bursting", () => {
    const parent = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Landlord", amount: 1000,
      is_recurring: true, recurring_frequency: "monthly",
      expense_date: "2026-01-01", recurring_next_date: "2026-01-01",
    }, FINANCE);
    // Cron did not run for five months.
    const out = runRecurringExpenses(db, day("2026-06-10"));
    expect(out.created).toBe(1);
    const next = new Date(getExpense(db, parent.id).recurring_next_date);
    expect(next.getTime()).toBeGreaterThan(day("2026-06-10"));
  });

  it("(19d) a soft-deleted template stops firing", () => {
    const parent = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Landlord", amount: 1000,
      is_recurring: true, recurring_frequency: "monthly",
      expense_date: "2026-07-01", recurring_next_date: "2026-07-01",
    }, FINANCE);
    softDeleteExpense(db, parent.id);
    expect(runRecurringExpenses(db, day("2026-07-01")).created).toBe(0);
  });

  it("(20) the cron wrapper schedules for 02:00 IST and reports what it created", () => {
    const ms = msUntilNextRecurringRun(Date.parse("2026-07-01T00:00:00.000Z"));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    // 00:00 UTC is 05:30 IST, so the next 02:00 IST is 20h30m away.
    expect(Math.round(ms / 60000)).toBe(20 * 60 + 30);
    expect(runRecurringExpenseJob(db).created).toBe(0);
  });
});

describe("R27.36 does not disturb R27.35", () => {
  it("(21) payment approval threshold and approver are shared, not forked", async () => {
    const pay = await import("../../server/routes-payments");
    expect(pay.APPROVAL_THRESHOLD).toBe(5000);
    expect(pay.APPROVER_USERNAME).toBe("narmadamobility123");
    expect(pay.PAYMENT_ROLES).toContain("data_team");
    // The expense queue counts expenses only; payment batches are untouched.
    createExpense(db, { category_id: CAT, payee_name_freetext: "V", amount: 9000 }, FINANCE);
    expect(countPendingExpenseApprovals(db)).toBe(1);
    expect(pay.countPendingApprovals(db)).toBe(0);
  });
});
