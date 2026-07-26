// R27.36a-part-2b — slip auto-mint on creation/approval + backfill.
//
// Covers the bug where R27.36's createExpense inserted rows with slip_number = NULL
// and only the explicit "Generate Slip" button (which the Unified UI does not have)
// would fill it in, leaving the ledger showing "–" for spent money.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { APPROVER_USERNAME, type Actor } from "../../server/routes-payments";
import {
  createCategory, createExpense, updateExpense, approveExpense, rejectExpense,
  getExpense, mintSlipForExpense,
} from "../../server/routes-expenses";
import { backfillMissingSlips } from "../../server/migrations-r27-36a-part2b";

const APPROVER: Actor = { userId: null, userName: "Piyush Anand", username: APPROVER_USERNAME };
const FINANCE: Actor = { userId: 9, userName: "Finance User", username: "fin_meera" };

const day = (d: string) => new Date(`${d}T00:00:00.000`).getTime();

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
});

let CAT = 0;
beforeEach(() => {
  for (const t of [
    "expense_reconciliations", "expense_slips", "expense_payees", "expense_categories", "slip_counters",
  ]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  CAT = createCategory(db, { name: "Auto-mint Test Cat" }, FINANCE).id;
});

describe("R27.36a-part-2b auto-mint at creation", () => {
  it("(1) auto-approved direct expense gets an EXP slip number immediately", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Auto Mechanic", amount: 500,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    expect(e.approval_status).toBe("auto_approved");
    expect(e.slip_number).toMatch(/^EXP\/2026-07\/\d{5}$/);
    expect(e.slip_generated_at).toBeTruthy();
  });

  it("(2) auto-approved bus expense gets a BUS slip number immediately", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Bus Driver", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "bus",
      bus_number: "MH-01-1234", bus_name: "Route 42",
    }, FINANCE);
    expect(e.approval_status).toBe("auto_approved");
    expect(e.slip_number).toMatch(/^BUS\/2026-07\/\d{5}$/);
  });

  it("(3) auto-approved advance issuance gets an ADV slip number immediately", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Delivery Boy", amount: 1000,
      expense_date: day("2026-07-26"), expense_type: "advance",
    }, FINANCE);
    expect(e.approval_status).toBe("auto_approved");
    expect(e.slip_number).toMatch(/^ADV\/2026-07\/\d{5}$/);
  });

  it("(4) expense over ₹5,000 stays without a slip until approved", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Costly Vendor", amount: 6000,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    expect(e.approval_status).toBe("pending_approval");
    expect(e.slip_number).toBeFalsy();
  });

  it("(5) slip series uses the expense date month, not today", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Backdated", amount: 400,
      expense_date: day("2026-03-15"), expense_type: "direct",
    }, FINANCE);
    expect(e.slip_number).toMatch(/^EXP\/2026-03\/\d{5}$/);
  });

  it("(6) monthly counter increments per (series, month)", () => {
    const a = createExpense(db, { category_id: CAT, payee_name_freetext: "A", amount: 100,
      expense_date: day("2026-07-01"), expense_type: "direct" }, FINANCE);
    const b = createExpense(db, { category_id: CAT, payee_name_freetext: "B", amount: 100,
      expense_date: day("2026-07-15"), expense_type: "direct" }, FINANCE);
    const c = createExpense(db, { category_id: CAT, payee_name_freetext: "C", amount: 100,
      expense_date: day("2026-08-01"), expense_type: "direct" }, FINANCE);
    expect(a.slip_number).toBe("EXP/2026-07/00001");
    expect(b.slip_number).toBe("EXP/2026-07/00002");
    expect(c.slip_number).toBe("EXP/2026-08/00001");
  });
});

describe("R27.36a-part-2b auto-mint on approval", () => {
  it("(7) mints when the approver flips a pending row to approved", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Big Vendor", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    expect(e.slip_number).toBeFalsy();
    const approved = approveExpense(db, e.id, APPROVER);
    expect(approved.approval_status).toBe("approved");
    expect(approved.slip_number).toMatch(/^EXP\/2026-07\/\d{5}$/);
  });

  it("(8) rejection never mints a slip", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rejected Vendor", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    const rejected = rejectExpense(db, e.id, "not authorized", APPROVER);
    expect(rejected.approval_status).toBe("rejected");
    expect(rejected.slip_number).toBeFalsy();
  });

  it("(9) editing a pending row down to auto-approved mints the slip", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Adjustable", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    expect(e.slip_number).toBeFalsy();
    const updated = updateExpense(db, e.id, { amount: 400 });
    expect(updated.approval_status).toBe("auto_approved");
    expect(updated.slip_number).toMatch(/^EXP\/2026-07\/\d{5}$/);
  });
});

describe("R27.36a-part-2b mintSlipForExpense idempotency", () => {
  it("(10) calling mint twice on the same row returns the same slip", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Idempotent", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    const first = e.slip_number;
    const again = mintSlipForExpense(db, e.id);
    expect(again).toBe(first);
    // Row still shows the original number
    const now = getExpense(db, e.id);
    expect(now.slip_number).toBe(first);
  });

  it("(11) mint on a deleted row is a no-op", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Deleted", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    // Simulate a soft-deleted row without a slip
    db.prepare(`UPDATE expense_slips SET slip_number = NULL, is_deleted = 1 WHERE id = ?`).run(e.id);
    const out = mintSlipForExpense(db, e.id);
    expect(out).toBeNull();
  });

  it("(12) mint on a pending row is a no-op", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "PendingRow", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    const out = mintSlipForExpense(db, e.id);
    expect(out).toBeNull();
  });
});

describe("R27.36a-part-2b backfillMissingSlips", () => {
  it("(13) mints slips for auto-approved rows with slip_number NULL", () => {
    // Seed two rows and then simulate the pre-2b state by nulling their slips.
    const a = createExpense(db, { category_id: CAT, payee_name_freetext: "PreFix1", amount: 100,
      expense_date: day("2026-07-10"), expense_type: "direct" }, FINANCE);
    const b = createExpense(db, { category_id: CAT, payee_name_freetext: "PreFix2", amount: 100,
      expense_date: day("2026-07-11"), expense_type: "direct" }, FINANCE);
    db.prepare(`UPDATE expense_slips SET slip_number = NULL, slip_generated_at = NULL WHERE id IN (?, ?)`)
      .run(a.id, b.id);
    // Also nuke the counter row so the backfill starts a fresh sequence.
    db.exec(`DELETE FROM slip_counters`);

    const report = backfillMissingSlips(db);
    expect(report.scanned).toBe(2);
    expect(report.minted).toBe(2);
    expect(report.errors).toEqual([]);
    const filled = db.prepare(`SELECT id, slip_number FROM expense_slips ORDER BY id ASC`).all() as any[];
    expect(filled[0].slip_number).toMatch(/^EXP\/2026-07\/\d{5}$/);
    expect(filled[1].slip_number).toMatch(/^EXP\/2026-07\/\d{5}$/);
    expect(filled[0].slip_number).not.toBe(filled[1].slip_number);
  });

  it("(14) leaves already-numbered rows alone", () => {
    createExpense(db, { category_id: CAT, payee_name_freetext: "HasSlip", amount: 100,
      expense_date: day("2026-07-26"), expense_type: "direct" }, FINANCE);
    const report = backfillMissingSlips(db);
    expect(report.scanned).toBe(0);
    expect(report.minted).toBe(0);
  });

  it("(15) skips pending and rejected rows", () => {
    const big = createExpense(db, { category_id: CAT, payee_name_freetext: "Big", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct" }, FINANCE);
    expect(big.slip_number).toBeFalsy();
    const report = backfillMissingSlips(db);
    expect(report.scanned).toBe(1);
    expect(report.minted).toBe(0);
    expect(report.skipped_pending).toBe(1);
  });

  it("(16) is idempotent — a second run mints nothing new", () => {
    const a = createExpense(db, { category_id: CAT, payee_name_freetext: "A", amount: 100,
      expense_date: day("2026-07-10"), expense_type: "direct" }, FINANCE);
    db.prepare(`UPDATE expense_slips SET slip_number = NULL WHERE id = ?`).run(a.id);
    db.exec(`DELETE FROM slip_counters`);
    const first = backfillMissingSlips(db);
    expect(first.minted).toBe(1);
    const second = backfillMissingSlips(db);
    expect(second.minted).toBe(0);
    expect(second.scanned).toBe(0);
  });
});
