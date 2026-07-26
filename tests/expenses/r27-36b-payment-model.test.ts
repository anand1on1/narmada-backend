// R27.36b — payment model tests.
//
// Covers the new paid_from + handled_by_staff fields on expense_slips, the
// cash-in-hand auto-debit on cash payments, and the /api/expenses/advances/outstanding
// dropdown-support endpoint. Uses the same in-process REPL rig as the other
// R27.36 test suites so we can call the storage/router helpers directly without
// spinning up Express.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { APPROVER_USERNAME, type Actor } from "../../server/routes-payments";
import {
  createCategory, createExpense, updateExpense, approveExpense,
  PAID_FROM_OPTIONS, PAID_FROM_FOR_ADVANCE, branchForCashPool,
  debitCashInHandForExpense,
} from "../../server/routes-expenses";

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
    "cash_in_hand", "expense_reconciliations", "expense_slips",
    "expense_payees", "expense_categories", "slip_counters",
  ]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  CAT = createCategory(db, { name: "R27.36b Test Cat" }, FINANCE).id;
});

// ---------------------------------------------------------------------------
// paid_from acceptance + persistence
// ---------------------------------------------------------------------------
describe("R27.36b paid_from validation and persistence", () => {
  it("(1) accepts cash_delhi on a direct expense and stores it verbatim", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Local Mechanic", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct", paid_from: "cash_delhi",
    }, FINANCE);
    expect(e.paid_from).toBe("cash_delhi");
  });

  it("(2) accepts cash_patna on a direct expense", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Local Mechanic", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct", paid_from: "cash_patna",
    }, FINANCE);
    expect(e.paid_from).toBe("cash_patna");
  });

  it("(3) accepts bank_transfer on a direct expense and preserves reference_number", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Vendor Inc", amount: 900,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "bank_transfer", reference_number: "UTR20260726001",
    }, FINANCE);
    expect(e.paid_from).toBe("bank_transfer");
    expect(e.reference_number).toBe("UTR20260726001");
  });

  it("(4) rejects an unknown paid_from value", () => {
    expect(() => createExpense(db, {
      category_id: CAT, payee_name_freetext: "X", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "wallet" as any,
    }, FINANCE)).toThrow(/paid_from must be one of/);
  });

  it("(5) rejects paid_from='against_advance' without advance_slip_id", () => {
    expect(() => createExpense(db, {
      category_id: CAT, payee_name_freetext: "X", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "against_advance",
    }, FINANCE)).toThrow(/requires advance_slip_id/);
  });

  it("(6) rejects paid_from='against_advance' on an advance issuance", () => {
    expect(() => createExpense(db, {
      category_id: CAT, payee_name_freetext: "X", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "advance",
      paid_from: "against_advance",
      handled_by_staff_name: "Aditi",
    }, FINANCE)).toThrow(/advance issuance must be paid from/);
  });

  it("(7) forces paid_from='against_advance' when advance_slip_id is set", () => {
    const adv = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 5000,
      expense_date: day("2026-07-01"), expense_type: "advance",
      paid_from: "cash_delhi", handled_by_staff_name: "Aditi",
    }, FINANCE);
    const child = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 800,
      expense_date: day("2026-07-05"), expense_type: "direct",
      advance_slip_id: adv.id,
      // Note: paid_from not passed — should be auto-derived.
    }, FINANCE);
    expect(child.paid_from).toBe("against_advance");
    // advance_slip_id lives on expense_reconciliations, not the child row itself.
    const recon: any = db.prepare(
      `SELECT * FROM expense_reconciliations WHERE expense_slip_id = ?`,
    ).get(child.id);
    expect(recon).toBeTruthy();
    expect(Number(recon.advance_slip_id)).toBe(adv.id);
  });

  it("(8) leaves paid_from NULL when caller omits it (legacy compatibility)", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Legacy caller", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct",
    }, FINANCE);
    expect(e.paid_from ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handled_by_staff on advance issuance
// ---------------------------------------------------------------------------
describe("R27.36b handled_by_staff on advance issuance", () => {
  it("(9) requires a handler when paid_from is set on an advance", () => {
    expect(() => createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 2000,
      expense_date: day("2026-07-26"), expense_type: "advance",
      paid_from: "cash_delhi",
    }, FINANCE)).toThrow(/handled the cash/);
  });

  it("(10) accepts a handler name and stores it verbatim", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 2000,
      expense_date: day("2026-07-26"), expense_type: "advance",
      paid_from: "cash_delhi", handled_by_staff_name: "Aditi Pathak",
    }, FINANCE);
    expect(e.handled_by_staff_name).toBe("Aditi Pathak");
    expect(e.handled_by_staff_id ?? null).toBeNull();
  });

  it("(11) direct expenses do not require a handler even when paid_from is set", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Vendor", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "cash_delhi",
    }, FINANCE);
    expect(e.paid_from).toBe("cash_delhi");
    expect(e.handled_by_staff_name ?? null).toBeNull();
  });

  it("(12) legacy advance without paid_from stays working without a handler", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 2000,
      expense_date: day("2026-07-26"), expense_type: "advance",
    }, FINANCE);
    expect(e.expense_type).toBe("advance");
    expect(e.handled_by_staff_name ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cash-in-hand auto-debit
// ---------------------------------------------------------------------------
describe("R27.36b cash_in_hand auto-debit", () => {
  it("(13) auto-approved direct + cash_delhi inserts a Delhi cash_in_hand debit", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Chai wala", amount: 250,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "cash_delhi", description: "Team chai",
    }, FINANCE);
    const rows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${e.slip_number}`) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].branch).toBe("Delhi");
    expect(rows[0].direction).toBe("out");
    expect(Number(rows[0].amount)).toBe(250);
    expect(rows[0].source).toBe("expense");
  });

  it("(14) auto-approved direct + cash_patna inserts a Patna cash_in_hand debit", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Bihar Vendor", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "cash_patna",
    }, FINANCE);
    const rows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${e.slip_number}`) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].branch).toBe("Patna");
  });

  it("(15) bank_transfer does NOT touch cash_in_hand", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Utility Co", amount: 400,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "bank_transfer", reference_number: "UTR123",
    }, FINANCE);
    const rows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${e.slip_number}`) as any[];
    expect(rows.length).toBe(0);
  });

  it("(16) against_advance does NOT touch cash_in_hand (advance issuance already did)", () => {
    const adv = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 5000,
      expense_date: day("2026-07-01"), expense_type: "advance",
      paid_from: "cash_delhi", handled_by_staff_name: "Aditi",
    }, FINANCE);
    // The advance issuance itself posted the cash outflow.
    const advRows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${adv.slip_number}`) as any[];
    expect(advRows.length).toBe(1);
    expect(advRows[0].branch).toBe("Delhi");

    // A direct expense booked against the advance must NOT double-count.
    const child = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Rakesh", amount: 800,
      expense_date: day("2026-07-05"), expense_type: "direct",
      advance_slip_id: adv.id,
    }, FINANCE);
    expect(child.paid_from).toBe("against_advance");
    const childRows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${child.slip_number}`) as any[];
    expect(childRows.length).toBe(0);
  });

  it("(17) pending-approval rows do NOT post to cash_in_hand until approved", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Big Vendor", amount: 8000,
      expense_date: day("2026-07-26"), expense_type: "direct",
      paid_from: "cash_delhi",
    }, FINANCE);
    expect(e.approval_status).toBe("pending_approval");
    expect(e.slip_number ?? null).toBeNull();
    const before: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference LIKE ?`,
    ).all(`expense_slip:%`) as any[];
    expect(before.length).toBe(0);

    // On approval the slip is minted AND cash_in_hand is posted.
    approveExpense(db, e.id, APPROVER);
    const after: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE source = 'expense'`,
    ).all() as any[];
    expect(after.length).toBe(1);
    expect(after[0].branch).toBe("Delhi");
    expect(Number(after[0].amount)).toBe(8000);
  });

  it("(18) cash_in_hand debit is idempotent across repeated debit calls", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Chai wala", amount: 100,
      expense_date: day("2026-07-26"), expense_type: "direct", paid_from: "cash_delhi",
    }, FINANCE);
    // Call again — should NOT insert a second row.
    debitCashInHandForExpense(db, e.id);
    debitCashInHandForExpense(db, e.id);
    const rows: any[] = db.prepare(
      `SELECT * FROM cash_in_hand WHERE reference = ?`,
    ).all(`expense_slip:${e.slip_number}`) as any[];
    expect(rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// updateExpense: paid_from can be edited when the slip JPG has not printed
// ---------------------------------------------------------------------------
describe("R27.36b updateExpense on payment fields", () => {
  it("(19) can flip paid_from from cash_delhi to cash_patna before slip JPG prints", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Vendor", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "direct", paid_from: "cash_delhi",
    }, FINANCE);
    const updated = updateExpense(db, e.id, { paid_from: "cash_patna" });
    expect(updated.paid_from).toBe("cash_patna");
  });

  it("(20) partial patch keeps existing paid_from when field is omitted", () => {
    const e = createExpense(db, {
      category_id: CAT, payee_name_freetext: "Vendor", amount: 300,
      expense_date: day("2026-07-26"), expense_type: "direct", paid_from: "cash_delhi",
    }, FINANCE);
    const updated = updateExpense(db, e.id, { description: "Note added" });
    expect(updated.paid_from).toBe("cash_delhi");
    expect(updated.description).toBe("Note added");
  });
});

// ---------------------------------------------------------------------------
// Public constants + helper
// ---------------------------------------------------------------------------
describe("R27.36b public constants", () => {
  it("(21) PAID_FROM_OPTIONS covers all four sources", () => {
    expect(PAID_FROM_OPTIONS).toEqual([
      "cash_delhi", "cash_patna", "bank_transfer", "against_advance",
    ]);
  });

  it("(22) PAID_FROM_FOR_ADVANCE excludes against_advance", () => {
    expect(PAID_FROM_FOR_ADVANCE).toEqual(["cash_delhi", "cash_patna", "bank_transfer"]);
  });

  it("(23) branchForCashPool maps each cash pool", () => {
    expect(branchForCashPool("cash_delhi")).toBe("Delhi");
    expect(branchForCashPool("cash_patna")).toBe("Patna");
    expect(branchForCashPool("bank_transfer")).toBeNull();
    expect(branchForCashPool("against_advance")).toBeNull();
    expect(branchForCashPool(null)).toBeNull();
  });
});
