// R27.36 — Expense slip module + expense ledger.
//
// Same shape as routes-payments.ts: every rule is a pure function taking the raw
// better-sqlite3 handle so the suite can drive it directly (the project still has no
// HTTP test harness), and the Express handlers below are thin wrappers adding auth
// and I/O.
//
// The approval rule is deliberately shared with R27.35 rather than re-implemented —
// same ₹5,000 threshold, same hardcoded approver — so there is one answer to "who can
// release money" regardless of which module spends it.
import type { Express, Request, Response, NextFunction } from "express";
import type { Database } from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import {
  APPROVAL_THRESHOLD, APPROVER_USERNAME, canApprovePayments,
  PaymentApprovalError, formatINR, formatGstPct,
  type ApprovalStatus, type Actor, type GstMode,
} from "./routes-payments";

import { nextSlipNumber, peekSlipCounter, yearMonthOf, SERIES_FOR_TYPE, type SlipSeries } from "./slip-counters";
import { recomputeAdvanceTotals } from "./migrations-r27-36a";

export { APPROVAL_THRESHOLD, APPROVER_USERNAME, canApprovePayments };
export { nextSlipNumber, peekSlipCounter, yearMonthOf, recomputeAdvanceTotals };

// R27.36a — direct spend, a cash advance handed to a person, or a bus trip. All three
// live in expense_slips and all three get a slip; only the series prefix differs.
export type ExpenseType = "direct" | "advance" | "bus";
export const EXPENSE_TYPES: ExpenseType[] = ["direct", "advance", "bus"];
export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "advance";
export const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "bank", "cheque", "advance"];

// R27.36b — payment source. Where the money actually came from.
// - cash_delhi / cash_patna: physical cash pool in the named office.
// - bank_transfer: online transfer, cheque, UPI, or any non-cash outflow — the
//   user records the transaction reference in reference_number.
// - against_advance: this direct/bus expense is booked against an already-issued
//   advance. advance_slip_id must also be set.
export type PaidFrom = "cash_delhi" | "cash_patna" | "bank_transfer" | "against_advance";
export const PAID_FROM_OPTIONS: PaidFrom[] = ["cash_delhi", "cash_patna", "bank_transfer", "against_advance"];
export const PAID_FROM_CASH: PaidFrom[] = ["cash_delhi", "cash_patna"];
export const PAID_FROM_FOR_ADVANCE: PaidFrom[] = ["cash_delhi", "cash_patna", "bank_transfer"];

// Branch label attached to cash-in-hand ledger rows. Matches the branch column
// already seeded by R27.6 (`Delhi`, `Patna`).
export function branchForCashPool(paidFrom: PaidFrom | null | undefined): "Delhi" | "Patna" | null {
  if (paidFrom === "cash_delhi") return "Delhi";
  if (paidFrom === "cash_patna") return "Patna";
  return null;
}
export type AdvanceStatus = "open" | "partial" | "reconciled" | "returned";

// Expenses are money going out, so the allowlist is tighter than PAYMENT_ROLES:
// procurement and data_team can raise payment slips but not book expenses.
export const EXPENSE_ROLES = ["admin", "finance"] as const;
export function hasExpenseAccess(role: string | undefined | null): boolean {
  return !!role && (EXPENSE_ROLES as readonly string[]).includes(String(role).trim().toLowerCase());
}

export class ExpenseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ExpenseError";
    this.status = status;
  }
}

export type RecurringFrequency = "monthly" | "quarterly" | "yearly";
const FREQUENCIES: RecurringFrequency[] = ["monthly", "quarterly", "yearly"];

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function epochToDay(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dayToEpoch(day: string, endOfDay = false): number | null {
  if (!day) return null;
  const t = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`).getTime();
  return isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// GST — identical math to R27.33a's per-vendor block in generateBatch().
// `amount` always stores exactly what the user typed; the mode decides whether that
// figure is the taxable base or already contains the tax.
// ---------------------------------------------------------------------------
export function computeExpenseGst(
  amount: number,
  gstPercent: number,
  gstMode: GstMode,
): { amount: number; gst_amount: number; total_amount: number; taxable_value: number } {
  const base = round2(amount);
  const pct = Number(gstPercent) || 0;
  if (gstMode === "inclusive") {
    const taxable = pct > 0 ? round2(base / (1 + pct / 100)) : base;
    return { amount: base, gst_amount: round2(base - taxable), total_amount: base, taxable_value: taxable };
  }
  const gst = round2(base * (pct / 100));
  return { amount: base, gst_amount: gst, total_amount: round2(base + gst), taxable_value: base };
}

export function approvalForTotal(total: number): ApprovalStatus {
  return round2(total) > APPROVAL_THRESHOLD ? "pending_approval" : "auto_approved";
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export function listCategories(db: Database, includeInactive = false): any[] {
  return db.prepare(
    `SELECT * FROM expense_categories ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name COLLATE NOCASE`,
  ).all() as any[];
}

export function createCategory(db: Database, input: { name?: string; description?: string }, actor: Actor): any {
  const name = String(input?.name || "").trim();
  if (!name) throw new ExpenseError("Category name is required", 400);
  // UNIQUE is case-sensitive in SQLite, but "Fuel" and "fuel" are the same category to
  // a human — reject the near-duplicate rather than creating a confusing second row.
  const clash: any = db.prepare(
    `SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE`,
  ).get(name);
  if (clash) throw new ExpenseError(`Category "${name}" already exists`, 409);
  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO expense_categories (name, description, created_by, created_at, is_active) VALUES (?,?,?,?,1)`,
  ).run(name, input?.description ? String(input.description).trim() : null, actor.userName, now);
  return db.prepare(`SELECT * FROM expense_categories WHERE id = ?`).get(Number(res.lastInsertRowid));
}

export function deactivateCategory(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_categories WHERE id = ?`).get(id);
  if (!row) throw new ExpenseError("Category not found", 404);
  db.prepare(`UPDATE expense_categories SET is_active = 0 WHERE id = ?`).run(id);
  return { ...row, is_active: 0 };
}

// ---------------------------------------------------------------------------
// Payees
// ---------------------------------------------------------------------------
const PAYEE_FIELDS = ["name", "phone", "email", "address", "gst_number", "pan_number", "bank_account", "ifsc", "bank_name"] as const;

export function listPayees(db: Database, q?: string, includeInactive = false): any[] {
  const where: string[] = [];
  const params: any[] = [];
  if (!includeInactive) where.push(`is_active = 1`);
  if (q && String(q).trim()) {
    const like = `%${String(q).trim().toLowerCase()}%`;
    where.push(`(LOWER(name) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ? OR LOWER(COALESCE(gst_number,'')) LIKE ?)`);
    params.push(like, like, like);
  }
  return db.prepare(
    `SELECT * FROM expense_payees ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name COLLATE NOCASE`,
  ).all(...params) as any[];
}

export function createPayee(db: Database, input: Record<string, any>, actor: Actor): any {
  const name = String(input?.name || "").trim();
  if (!name) throw new ExpenseError("Payee name is required", 400);
  const vals = PAYEE_FIELDS.map((f) => {
    const v = input?.[f];
    return v == null || String(v).trim() === "" ? null : String(v).trim();
  });
  vals[0] = name;
  const res = db.prepare(
    `INSERT INTO expense_payees (${PAYEE_FIELDS.join(",")}, created_by, created_at, is_active)
     VALUES (${PAYEE_FIELDS.map(() => "?").join(",")},?,?,1)`,
  ).run(...vals, actor.userName, Date.now());
  return db.prepare(`SELECT * FROM expense_payees WHERE id = ?`).get(Number(res.lastInsertRowid));
}

export function deactivatePayee(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_payees WHERE id = ?`).get(id);
  if (!row) throw new ExpenseError("Payee not found", 404);
  db.prepare(`UPDATE expense_payees SET is_active = 0 WHERE id = ?`).run(id);
  return { ...row, is_active: 0 };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export interface ExpenseInput {
  category_id?: number;
  payee_id?: number | null;
  payee_name_freetext?: string | null;
  amount?: number;
  gst_percent?: number;
  gst_mode?: GstMode;
  description?: string;
  expense_date?: string | number;
  is_recurring?: boolean | number;
  recurring_frequency?: RecurringFrequency;
  recurring_next_date?: string | number;
  // R27.36a
  expense_type?: ExpenseType;
  payment_mode?: PaymentMode;
  branch_id?: string | null;
  reference_number?: string | null;
  proof_url?: string | null;
  expected_return_date?: string | number | null;
  bus_number?: string | null;
  bus_name?: string | null;
  bus_contact?: string | null;
  bus_from?: string | null;
  // When a direct/bus expense is paid out of an existing advance, reconcile it in
  // the same call rather than making the user do a second step.
  advance_slip_id?: number | null;
  // R27.36b — payment source and (for advance issuance) the staff handler.
  paid_from?: PaidFrom | null;
  handled_by_staff_id?: number | null;
  handled_by_staff_name?: string | null;
}

function resolveDate(v: string | number | undefined | null, fallback: number): number {
  if (v == null || v === "") return fallback;
  if (typeof v === "number") return v;
  const parsed = dayToEpoch(String(v));
  return parsed ?? fallback;
}

// Advance a recurring template's next-fire date. Uses setMonth, so a 31st rolls into
// the following month for short months — acceptable and predictable, and it never
// silently skips a period.
export function nextRecurringDate(from: number, frequency: RecurringFrequency): number {
  const d = new Date(from);
  if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
  else if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function resolveExpenseType(v: any): ExpenseType {
  const t = String(v || "direct").trim().toLowerCase() as ExpenseType;
  if (!EXPENSE_TYPES.includes(t)) throw new ExpenseError(`expense_type must be one of ${EXPENSE_TYPES.join(", ")}`, 400);
  return t;
}

function resolvePaymentMode(v: any, fallback: PaymentMode): PaymentMode {
  if (v == null || String(v).trim() === "") return fallback;
  const m = String(v).trim().toLowerCase() as PaymentMode;
  if (!PAYMENT_MODES.includes(m)) throw new ExpenseError(`payment_mode must be one of ${PAYMENT_MODES.join(", ")}`, 400);
  return m;
}

// R27.36b — resolve paid_from from user input. Returns null if not supplied so
// legacy call sites (that don't yet pass paid_from) continue to work. When
// advance_slip_id is set the value is forced to "against_advance" no matter what
// the caller passed — the two must always agree.
function resolvePaidFrom(
  input: any,
  expenseType: ExpenseType,
  hasAdvanceSlip: boolean,
): PaidFrom | null {
  if (hasAdvanceSlip) return "against_advance";
  const raw = input?.paid_from;
  if (raw == null || raw === "") return null;
  const v = String(raw).trim().toLowerCase() as PaidFrom;
  if (!PAID_FROM_OPTIONS.includes(v)) {
    throw new ExpenseError(`paid_from must be one of ${PAID_FROM_OPTIONS.join(", ")}`, 400);
  }
  if (expenseType === "advance" && !PAID_FROM_FOR_ADVANCE.includes(v)) {
    throw new ExpenseError(
      `An advance issuance must be paid from one of ${PAID_FROM_FOR_ADVANCE.join(", ")} — got "${v}"`,
      400,
    );
  }
  if (v === "against_advance") {
    // Caller said "against_advance" but did not identify which advance. Reject.
    throw new ExpenseError("paid_from = against_advance requires advance_slip_id", 400);
  }
  return v;
}

// R27.36b — who physically handled the cash. Required for advance issuance so
// there is a name attached to the outflow. Accepts either an admin_users.id or
// a freetext name (the UI passes both, we store what we get).
function resolveHandledByStaff(
  db: Database,
  input: any,
  expenseType: ExpenseType,
  paidFrom: PaidFrom | null,
): { id: number | null; name: string | null } {
  const rawId = input?.handled_by_staff_id;
  const rawName = input?.handled_by_staff_name;
  const nameFromInput = rawName == null ? null : String(rawName).trim() || null;

  let id: number | null = null;
  let name: string | null = nameFromInput;

  if (rawId != null && rawId !== "") {
    const n = Number(rawId);
    if (!Number.isFinite(n) || n <= 0) throw new ExpenseError("handled_by_staff_id must be a positive integer", 400);
    try {
      const u: any = db.prepare(`SELECT id, display_name, username FROM admin_users WHERE id = ?`).get(n);
      if (!u) throw new ExpenseError(`Staff member ${n} not found`, 404);
      id = u.id;
      name = name || u.display_name || u.username || null;
    } catch (e: any) {
      if (String(e?.message || "").includes("no such table")) {
        id = n; // best-effort on tenants without admin_users
      } else {
        throw e;
      }
    }
  }

  // Only enforced when the caller has actually adopted the R27.36b payment model
  // for this row (i.e. supplied paid_from). Legacy callers that don't set
  // paid_from continue to work with NULL handler, matching existing behaviour.
  if (expenseType === "advance" && paidFrom && !id && !name) {
    throw new ExpenseError(
      "An advance issuance must record who handled the cash (handled_by_staff_id or handled_by_staff_name)",
      400,
    );
  }
  return { id, name };
}

// R27.36b — post the cash outflow to the cash_in_hand ledger for direct spends
// paid from a physical cash pool. Skipped for bank_transfer (already recorded in
// the bank feed) and against_advance (the advance issuance itself was the cash
// outflow — double-counting here would inflate expenses).
export function debitCashInHandForExpense(db: Database, expenseId: number): void {
  const row: any = db.prepare(
    `SELECT id, slip_number, total_amount, expense_date, paid_from, description
     FROM expense_slips WHERE id = ?`,
  ).get(expenseId);
  if (!row) return;
  const branch = branchForCashPool(row.paid_from as PaidFrom);
  if (!branch) return; // not a cash payment
  if (!row.slip_number) return; // wait until the slip is minted so the reference is stable

  // Idempotent: skip if we already booked this expense against the cash pool.
  const reference = `expense_slip:${row.slip_number}`;
  try {
    const existing: any = db.prepare(
      `SELECT id FROM cash_in_hand WHERE reference = ? AND source = 'expense'`,
    ).get(reference);
    if (existing) return;
  } catch { /* cash_in_hand may not exist on very old tenants; skip silently */ }

  const iso = new Date(Number(row.expense_date) || Date.now()).toISOString();
  try {
    db.prepare(
      `INSERT INTO cash_in_hand (source, amount, reference, date, notes, created_by, branch, direction)
       VALUES ('expense', ?, ?, ?, ?, NULL, ?, 'out')`,
    ).run(Number(row.total_amount) || 0, reference, iso, row.description || null, branch);
  } catch (e: any) {
    console.log(`[R27.36b] cash_in_hand debit skipped for ${reference}: ${String(e?.message || e)}`);
  }
}

// R27.36a-part-2b — auto-mint a slip number once the row is in a spendable state
// (auto-approved at creation, or manually approved later). Idempotent: does nothing
// if a slip is already assigned. Slip series comes from expense_type, month comes
// from expense_date so a backdated row lands in the correct counter.
export function mintSlipForExpense(db: Database, id: number): string | null {
  const row: any = db.prepare(
    `SELECT id, slip_number, expense_type, expense_date, approval_status, is_deleted FROM expense_slips WHERE id = ?`,
  ).get(id);
  if (!row) return null;
  if (row.is_deleted) return null;
  if (row.slip_number) return row.slip_number;
  const status = String(row.approval_status || "").trim();
  if (status !== "auto_approved" && status !== "approved") return null;
  const type = (row.expense_type || "direct") as ExpenseType;
  const slip = nextExpenseSlipNumber(db, type, Number(row.expense_date) || Date.now());
  db.prepare(
    `UPDATE expense_slips SET slip_number = ?, slip_generated_at = ? WHERE id = ? AND slip_number IS NULL`,
  ).run(slip, Date.now(), id);
  return slip;
}

export function createExpense(db: Database, input: ExpenseInput, actor: Actor): any {
  const categoryId = Number(input?.category_id);
  if (!categoryId) throw new ExpenseError("Category is required", 400);
  const cat: any = db.prepare(`SELECT * FROM expense_categories WHERE id = ?`).get(categoryId);
  if (!cat) throw new ExpenseError("Category not found", 404);

  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseError("Amount must be greater than zero", 400);

  // Exactly one of the two payee shapes. A saved payee wins if both arrive, and the
  // free-text column is nulled so the row never disagrees with itself.
  let payeeId: number | null = input?.payee_id != null && input.payee_id !== ("" as any) ? Number(input.payee_id) : null;
  let freetext: string | null = input?.payee_name_freetext ? String(input.payee_name_freetext).trim() : null;
  if (payeeId) {
    const p: any = db.prepare(`SELECT * FROM expense_payees WHERE id = ?`).get(payeeId);
    if (!p) throw new ExpenseError("Payee not found", 404);
    freetext = null;
  } else {
    payeeId = null;
    if (!freetext) throw new ExpenseError("A payee is required — pick a saved payee or type a name", 400);
  }

  const gstMode: GstMode = input?.gst_mode === "inclusive" ? "inclusive" : "exclusive";
  const gstPercent = Number(input?.gst_percent) || 0;
  if (gstPercent < 0) throw new ExpenseError("GST percent cannot be negative", 400);
  const gst = computeExpenseGst(amount, gstPercent, gstMode);

  const now = Date.now();
  const expenseDate = resolveDate(input?.expense_date, startOfDay(now));

  const isRecurring = input?.is_recurring ? 1 : 0;
  let frequency: RecurringFrequency | null = null;
  let nextDate: number | null = null;
  if (isRecurring) {
    frequency = String(input?.recurring_frequency || "").trim().toLowerCase() as RecurringFrequency;
    if (!FREQUENCIES.includes(frequency)) {
      throw new ExpenseError(`Recurring frequency must be one of ${FREQUENCIES.join(", ")}`, 400);
    }
    nextDate = resolveDate(input?.recurring_next_date, nextRecurringDate(expenseDate, frequency));
  }

  // Advances and bus trips carry the same ₹5,000 approval rule as a direct expense —
  // decision #10 of R27.36a is explicitly one queue, not a parallel flow.
  const approval = approvalForTotal(gst.total_amount);
  const autoApproved = approval === "auto_approved";

  const expenseType = resolveExpenseType(input?.expense_type);
  const paymentMode = resolvePaymentMode(input?.payment_mode, expenseType === "advance" ? "cash" : "cash");
  const str = (v: any) => (v == null || String(v).trim() === "" ? null : String(v).trim());

  let expectedReturn: number | null = null;
  let advanceStatus: AdvanceStatus | null = null;
  if (expenseType === "advance") {
    advanceStatus = "open";
    expectedReturn = input?.expected_return_date != null && input.expected_return_date !== ""
      ? resolveDate(input.expected_return_date, expenseDate) : null;
  }
  if (expenseType === "bus" && !str(input?.bus_number) && !str(input?.bus_name)) {
    throw new ExpenseError("A bus expense needs at least a bus number or bus name", 400);
  }

  // A direct/bus expense paid from an advance is only meaningful if the advance can
  // actually cover it — validate before spending the row, not after.
  let advanceSlip: any = null;
  const advanceSlipId = input?.advance_slip_id != null && input.advance_slip_id !== ("" as any)
    ? Number(input.advance_slip_id) : null;
  if (advanceSlipId) {
    if (expenseType === "advance") throw new ExpenseError("An advance cannot itself be paid from an advance", 400);
    advanceSlip = loadAdvanceSlip(db, advanceSlipId);
    assertAdvanceCapacity(advanceSlip, gst.total_amount);
  }

  // R27.36b — payment source + advance handler. paid_from is forced to
  // "against_advance" when advance_slip_id is set; handled_by_staff is mandatory
  // only for advance issuance.
  const paidFrom = resolvePaidFrom(input, expenseType, !!advanceSlipId);
  const handler = resolveHandledByStaff(db, input, expenseType, paidFrom);

  const res = db.prepare(
    `INSERT INTO expense_slips (
       category_id, payee_id, payee_name_freetext, amount, gst_percent, gst_mode, gst_amount,
       total_amount, description, expense_date, is_recurring, recurring_frequency, recurring_next_date,
       recurring_parent_id, approval_status, approved_by, approved_at, created_by, created_at, is_deleted,
       expense_type, payment_mode, branch_id, reference_number, proof_url,
       expected_return_date, advance_status, reconciled_amount, returned_amount,
       bus_number, bus_name, bus_contact, bus_from, is_legacy,
       paid_from, handled_by_staff_id, handled_by_staff_name
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,0,0,?,?,?,?,0,?,?,?)`,
  ).run(
    categoryId, payeeId, freetext, gst.amount, gstPercent, gstMode, gst.gst_amount,
    gst.total_amount, input?.description ? String(input.description).trim() : null, expenseDate,
    isRecurring, frequency, nextDate, null,
    approval, autoApproved ? "system" : null, autoApproved ? now : null,
    actor.userName, now,
    expenseType, advanceSlipId ? "advance" : paymentMode, str(input?.branch_id),
    str(input?.reference_number), str(input?.proof_url),
    expectedReturn, advanceStatus,
    str(input?.bus_number), str(input?.bus_name), str(input?.bus_contact), str(input?.bus_from),
    paidFrom, handler.id, handler.name,
  );
  const id = Number(res.lastInsertRowid);

  if (advanceSlip) {
    db.prepare(
      `INSERT INTO expense_reconciliations
         (advance_slip_id, expense_slip_id, amount, reconciled_at, reconciled_by, notes, is_legacy)
       VALUES (?,?,?,?,?,?,0)`,
    ).run(advanceSlip.id, id, gst.total_amount, now, actor.userName, "Booked against advance at entry");
    recomputeAdvanceTotals(db, advanceSlip.id);
  }

  // R27.36a-part-2b — auto-mint slip number for auto-approved rows so the ledger
  // never shows "–" for an already-spent expense. Rows over ₹5,000 stay NULL until
  // the approver flips them via approveExpense (which also mints).
  if (autoApproved) {
    mintSlipForExpense(db, id);
    // R27.36b — after the slip is minted the reference is stable, so book the
    // cash outflow into cash_in_hand. approveExpense() below repeats this call
    // for the pending-approval path.
    debitCashInHandForExpense(db, id);
  }

  return getExpense(db, id);
}

export function getExpense(db: Database, id: number): any {
  const row: any = db.prepare(
    `SELECT e.*, c.name AS category_name, p.name AS payee_saved_name
     FROM expense_slips e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     WHERE e.id = ?`,
  ).get(id);
  if (!row) return null;
  return { ...row, payee_name: row.payee_saved_name || row.payee_name_freetext || "—" };
}

export interface ExpenseFilters {
  category_id?: number;
  payee_id?: number;
  from?: string;
  to?: string;
  status?: string;
  q?: string;
  include_deleted?: boolean;
}

function buildExpenseWhere(filters: ExpenseFilters): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  if (!filters.include_deleted) where.push(`e.is_deleted = 0`);
  if (filters.category_id) { where.push(`e.category_id = ?`); params.push(Number(filters.category_id)); }
  if (filters.payee_id) { where.push(`e.payee_id = ?`); params.push(Number(filters.payee_id)); }
  const from = filters.from ? dayToEpoch(filters.from) : null;
  const to = filters.to ? dayToEpoch(filters.to, true) : null;
  if (from != null) { where.push(`e.expense_date >= ?`); params.push(from); }
  if (to != null) { where.push(`e.expense_date <= ?`); params.push(to); }
  if (filters.status && filters.status !== "all") { where.push(`e.approval_status = ?`); params.push(filters.status); }
  if (filters.q && String(filters.q).trim()) {
    const like = `%${String(filters.q).trim().toLowerCase()}%`;
    where.push(`(LOWER(COALESCE(e.description,'')) LIKE ?
              OR LOWER(COALESCE(e.slip_number,'')) LIKE ?
              OR LOWER(COALESCE(e.payee_name_freetext,'')) LIKE ?
              OR LOWER(COALESCE(p.name,'')) LIKE ?
              OR LOWER(COALESCE(c.name,'')) LIKE ?)`);
    params.push(like, like, like, like, like);
  }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

export function listExpenses(db: Database, filters: ExpenseFilters = {}): any[] {
  const { sql, params } = buildExpenseWhere(filters);
  const rows = db.prepare(
    `SELECT e.*, c.name AS category_name, p.name AS payee_saved_name
     FROM expense_slips e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     ${sql}
     ORDER BY e.expense_date DESC, e.id DESC`,
  ).all(...params) as any[];
  return rows.map((r) => ({
    ...r,
    payee_name: r.payee_saved_name || r.payee_name_freetext || "—",
    expense_date_display: epochToDay(r.expense_date),
  }));
}

// Editing is only allowed before a slip JPG exists — once the printed slip has
// been handed to a payee the numbers on it are the record, and silently changing
// the row behind it would make the slip a lie. R27.36a-part-2b relaxes this: a
// slip_number alone (auto-minted at creation) does not block edits, only a
// generated JPG (slip_image_path) does.
export function updateExpense(db: Database, id: number, input: ExpenseInput): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row || row.is_deleted) throw new ExpenseError("Expense not found", 404);
  if (row.slip_image_path) throw new ExpenseError("Slip already printed — this expense can no longer be edited", 409);

  const categoryId = input?.category_id != null ? Number(input.category_id) : row.category_id;
  if (input?.category_id != null && !db.prepare(`SELECT id FROM expense_categories WHERE id = ?`).get(categoryId)) {
    throw new ExpenseError("Category not found", 404);
  }
  const amount = input?.amount != null ? Number(input.amount) : Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseError("Amount must be greater than zero", 400);

  let payeeId: number | null = row.payee_id;
  let freetext: string | null = row.payee_name_freetext;
  if (input?.payee_id !== undefined || input?.payee_name_freetext !== undefined) {
    payeeId = input?.payee_id != null && input.payee_id !== ("" as any) ? Number(input.payee_id) : null;
    freetext = input?.payee_name_freetext ? String(input.payee_name_freetext).trim() : null;
    if (payeeId) {
      if (!db.prepare(`SELECT id FROM expense_payees WHERE id = ?`).get(payeeId)) throw new ExpenseError("Payee not found", 404);
      freetext = null;
    } else if (!freetext) {
      throw new ExpenseError("A payee is required — pick a saved payee or type a name", 400);
    }
  }

  const gstMode: GstMode = input?.gst_mode != null
    ? (input.gst_mode === "inclusive" ? "inclusive" : "exclusive")
    : (row.gst_mode === "inclusive" ? "inclusive" : "exclusive");
  const gstPercent = input?.gst_percent != null ? Number(input.gst_percent) || 0 : Number(row.gst_percent) || 0;
  const gst = computeExpenseGst(amount, gstPercent, gstMode);
  const expenseDate = input?.expense_date !== undefined ? resolveDate(input.expense_date, row.expense_date) : row.expense_date;

  let isRecurring = row.is_recurring ? 1 : 0;
  let frequency: RecurringFrequency | null = row.recurring_frequency || null;
  let nextDate: number | null = row.recurring_next_date ?? null;
  if (input?.is_recurring !== undefined) {
    isRecurring = input.is_recurring ? 1 : 0;
    if (isRecurring) {
      const f = String(input?.recurring_frequency || frequency || "").trim().toLowerCase() as RecurringFrequency;
      if (!FREQUENCIES.includes(f)) throw new ExpenseError(`Recurring frequency must be one of ${FREQUENCIES.join(", ")}`, 400);
      frequency = f;
      nextDate = resolveDate(input?.recurring_next_date, nextDate ?? nextRecurringDate(expenseDate, f));
    } else {
      frequency = null;
      nextDate = null;
    }
  }

  // Re-deciding on every edit is the point: an expense edited from ₹4,000 up to
  // ₹9,000 must land back in the approval queue rather than keep its auto-approval.
  const approval = approvalForTotal(gst.total_amount);
  const autoApproved = approval === "auto_approved";

  // R27.36a-part-2b — if the edit pushes the total above ₹5,000, revoke the
  // auto-minted slip so it can be re-minted on approval (and the series stays
  // internally consistent when expense_date or expense_type is what changed).
  const revokeSlip = !autoApproved && !!row.slip_number;

  // R27.36b — allow paid_from / handled_by_staff to be edited. Only overwrite
  // when the caller passed the field so a partial patch keeps the stored value.
  const expenseType = (row.expense_type as ExpenseType) || "direct";
  const paidFromChanged = input?.paid_from !== undefined;
  const nextPaidFrom = paidFromChanged
    ? resolvePaidFrom(input, expenseType, !!row.advance_slip_id || !!(input as any)?.advance_slip_id)
    : (row.paid_from as PaidFrom | null);
  const handlerChanged = input?.handled_by_staff_id !== undefined || input?.handled_by_staff_name !== undefined;
  const nextHandler = handlerChanged
    ? resolveHandledByStaff(db, input, expenseType, nextPaidFrom)
    : { id: row.handled_by_staff_id ?? null, name: row.handled_by_staff_name ?? null };

  db.prepare(
    `UPDATE expense_slips SET category_id=?, payee_id=?, payee_name_freetext=?, amount=?, gst_percent=?, gst_mode=?,
       gst_amount=?, total_amount=?, description=?, expense_date=?, is_recurring=?, recurring_frequency=?,
       recurring_next_date=?, approval_status=?, approved_by=?, approved_at=?, rejection_reason=NULL,
       paid_from=?, handled_by_staff_id=?, handled_by_staff_name=?,
       slip_number = CASE WHEN ? = 1 THEN NULL ELSE slip_number END,
       slip_generated_at = CASE WHEN ? = 1 THEN NULL ELSE slip_generated_at END
     WHERE id = ?`,
  ).run(
    categoryId, payeeId, freetext, gst.amount, gstPercent, gstMode, gst.gst_amount, gst.total_amount,
    input?.description !== undefined ? (input.description ? String(input.description).trim() : null) : row.description,
    expenseDate, isRecurring, frequency, nextDate,
    approval, autoApproved ? "system" : null, autoApproved ? Date.now() : null,
    nextPaidFrom, nextHandler.id, nextHandler.name,
    revokeSlip ? 1 : 0, revokeSlip ? 1 : 0,
    id,
  );
  // R27.36a-part-2b — an edit that drops total below ₹5,000 re-auto-approves the
  // row; mint the slip here so the ledger stops showing "–" without a separate
  // approval action. Guard at top of function blocks edits once the JPG is printed.
  if (autoApproved) {
    mintSlipForExpense(db, id);
    debitCashInHandForExpense(db, id);
  }
  return getExpense(db, id);
}

export function softDeleteExpense(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row) throw new ExpenseError("Expense not found", 404);
  db.prepare(`UPDATE expense_slips SET is_deleted = 1 WHERE id = ?`).run(id);
  return { ...row, is_deleted: 1 };
}

// ---------------------------------------------------------------------------
// R27.36a — advances
//
// An advance is cash handed to a person before the spend is known. It closes when
// receipts account for it (reconciliations) or the cash comes back (returned).
// `outstanding` is always amount − reconciled − returned; nothing else is trusted.
// ---------------------------------------------------------------------------
export function loadAdvanceSlip(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row || row.is_deleted) throw new ExpenseError("Advance not found", 404);
  if (row.expense_type !== "advance") throw new ExpenseError(`Expense ${id} is not an advance`, 400);
  return row;
}

export function advanceOutstanding(row: any): number {
  return round2((Number(row.amount) || 0) - (Number(row.reconciled_amount) || 0) - (Number(row.returned_amount) || 0));
}

function assertAdvanceCapacity(advance: any, amount: number): void {
  const outstanding = advanceOutstanding(advance);
  if (round2(amount) > outstanding + 0.01) {
    throw new ExpenseError(
      `Advance ${advance.slip_number || advance.id} has only ${formatINR(outstanding)} outstanding — cannot reconcile ${formatINR(amount)}`,
      400,
    );
  }
}

export interface AdvanceFilters {
  status?: string;
  payee?: string;
  branch_id?: string;
  from?: string;
  to?: string;
}

export function listAdvances(db: Database, filters: AdvanceFilters = {}): any[] {
  const where = [`e.expense_type = 'advance'`, `e.is_deleted = 0`];
  const params: any[] = [];
  const status = String(filters.status || "all").trim().toLowerCase();
  if (status && status !== "all") { where.push(`COALESCE(e.advance_status,'open') = ?`); params.push(status); }
  if (filters.payee && String(filters.payee).trim()) {
    where.push(`LOWER(COALESCE(p.name, e.payee_name_freetext, '')) LIKE ?`);
    params.push(`%${String(filters.payee).trim().toLowerCase()}%`);
  }
  if (filters.branch_id && String(filters.branch_id).trim()) {
    where.push(`e.branch_id = ?`); params.push(String(filters.branch_id).trim());
  }
  const from = filters.from ? dayToEpoch(filters.from) : null;
  const to = filters.to ? dayToEpoch(filters.to, true) : null;
  if (from != null) { where.push(`e.expense_date >= ?`); params.push(from); }
  if (to != null) { where.push(`e.expense_date <= ?`); params.push(to); }

  const rows = db.prepare(
    `SELECT e.*, c.name AS category_name, p.name AS payee_saved_name
     FROM expense_slips e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.expense_date DESC, e.id DESC`,
  ).all(...params) as any[];

  return rows.map((r) => ({
    ...r,
    payee_name: r.payee_saved_name || r.payee_name_freetext || "—",
    expense_date_display: epochToDay(r.expense_date),
    expected_return_date_display: epochToDay(r.expected_return_date),
    advance_status: r.advance_status || "open",
    reconciled_amount: round2(r.reconciled_amount),
    returned_amount: round2(r.returned_amount),
    outstanding: advanceOutstanding(r),
  }));
}

export function listAdvanceReconciliations(db: Database, advanceSlipId: number): any[] {
  return (db.prepare(
    `SELECT r.*, e.slip_number, e.description, e.expense_date
     FROM expense_reconciliations r
     LEFT JOIN expense_slips e ON e.id = r.expense_slip_id
     WHERE r.advance_slip_id = ?
     ORDER BY r.reconciled_at, r.id`,
  ).all(advanceSlipId) as any[]).map((r) => ({
    ...r,
    amount: round2(r.amount),
    reconciled_at_display: epochToDay(r.reconciled_at),
  }));
}

export function reconcileAdvance(
  db: Database,
  advanceSlipId: number,
  input: { expense_slip_ids?: any[]; amounts?: any[]; notes?: string },
  actor: Actor,
): { advance: any; reconciliations: any[]; warnings: string[] } {
  const advance = loadAdvanceSlip(db, advanceSlipId);
  if (advance.advance_status === "returned") {
    throw new ExpenseError("Advance was closed by a cash return — reopen it before reconciling", 409);
  }
  const ids = Array.isArray(input?.expense_slip_ids) ? input.expense_slip_ids.map((n) => Number(n)) : [];
  const amounts = Array.isArray(input?.amounts) ? input.amounts.map((n) => Number(n)) : [];
  if (!ids.length) throw new ExpenseError("expense_slip_ids is required", 400);
  if (ids.length !== amounts.length) throw new ExpenseError("expense_slip_ids and amounts must be the same length", 400);

  const warnings: string[] = [];
  const total = round2(amounts.reduce((a, b) => a + (Number(b) || 0), 0));
  if (total <= 0) throw new ExpenseError("Reconciliation amount must be greater than zero", 400);
  assertAdvanceCapacity(advance, total);

  const advancePayee = String(advance.payee_name_freetext || "").trim().toLowerCase();
  const prepared = ids.map((id, i) => {
    const amount = round2(amounts[i]);
    if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseError(`Amount for expense ${id} must be greater than zero`, 400);
    const e: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
    if (!e || e.is_deleted) throw new ExpenseError(`Expense ${id} not found`, 404);
    if (e.expense_type === "advance") throw new ExpenseError(`Expense ${id} is an advance — advances cannot reconcile each other`, 400);
    const already: any = db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS t FROM expense_reconciliations WHERE expense_slip_id = ?`,
    ).get(id);
    if (round2(Number(already.t) + amount) > round2(e.total_amount) + 0.01) {
      throw new ExpenseError(
        `Expense ${e.slip_number || id} is already reconciled for ${formatINR(already.t)} of ${formatINR(e.total_amount)}`,
        400,
      );
    }
    // Branch/payee mismatches are recorded, not blocked: real advances get spent on
    // behalf of someone else often enough that a hard stop would be wrong.
    if (advance.branch_id && e.branch_id && advance.branch_id !== e.branch_id) {
      warnings.push(`Expense ${e.slip_number || id} is branch ${e.branch_id}, advance is ${advance.branch_id}`);
    }
    const ePayee = String(e.payee_name_freetext || "").trim().toLowerCase();
    if (advancePayee && ePayee && advancePayee !== ePayee) {
      warnings.push(`Expense ${e.slip_number || id} payee "${e.payee_name_freetext}" differs from advance holder "${advance.payee_name_freetext}"`);
    }
    return { id, amount };
  });

  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO expense_reconciliations
       (advance_slip_id, expense_slip_id, amount, reconciled_at, reconciled_by, notes, is_legacy)
     VALUES (?,?,?,?,?,?,0)`,
  );
  db.transaction(() => {
    for (const p of prepared) insert.run(advanceSlipId, p.id, p.amount, now, actor.userName, input?.notes ? String(input.notes).trim() : null);
    db.prepare(`UPDATE expense_slips SET payment_mode = 'advance' WHERE id IN (${prepared.map(() => "?").join(",")})`)
      .run(...prepared.map((p) => p.id));
    recomputeAdvanceTotals(db, advanceSlipId);
  })();

  return {
    advance: listAdvances(db, {}).find((a) => a.id === advanceSlipId) || loadAdvanceSlip(db, advanceSlipId),
    reconciliations: listAdvanceReconciliations(db, advanceSlipId),
    warnings,
  };
}

export function markAdvanceReturned(
  db: Database,
  advanceSlipId: number,
  input: { return_amount?: any; notes?: string },
): any {
  const advance = loadAdvanceSlip(db, advanceSlipId);
  const amount = round2(Number(input?.return_amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseError("return_amount must be greater than zero", 400);
  const outstanding = advanceOutstanding(advance);
  if (amount > outstanding + 0.01) {
    throw new ExpenseError(`Only ${formatINR(outstanding)} is outstanding on this advance`, 400);
  }
  db.prepare(
    `UPDATE expense_slips SET returned_amount = COALESCE(returned_amount,0) + ?, advance_status = 'returned',
       description = COALESCE(description,'') || ? WHERE id = ?`,
  ).run(amount, input?.notes ? ` [return: ${String(input.notes).trim()}]` : "", advanceSlipId);
  return listAdvances(db, {}).find((a) => a.id === advanceSlipId);
}

// ---------------------------------------------------------------------------
// R27.36a — bus expenses
// ---------------------------------------------------------------------------
export function listBusExpenses(db: Database, filters: ExpenseFilters & { branch_id?: string } = {}): any[] {
  const rows = listExpenses(db, filters);
  const branch = filters.branch_id ? String(filters.branch_id).trim() : null;
  return rows.filter((r) => r.expense_type === "bus" && (!branch || r.branch_id === branch));
}

// ---------------------------------------------------------------------------
// R27.36a — cash in hand.
//
// Reads the pre-existing R27.6 `cash_in_hand` table rather than a new one, per
// decision #6. That table has no running-balance column, so the balance is derived
// from `direction` ('in'/'out'); rows written before the direction column existed
// are treated as inflows, which is what R27.6's own "add cash receipt" screen meant.
// ---------------------------------------------------------------------------
export type CashEntryType = "deposit" | "withdrawal";

function cashDirection(row: any): 1 | -1 {
  const d = String(row.direction || "").trim().toLowerCase();
  if (d === "out" || d === "withdrawal") return -1;
  return 1;
}

export function listCashEntries(db: Database, branchId?: string): any[] {
  const where: string[] = [];
  const params: any[] = [];
  if (branchId && String(branchId).trim()) { where.push(`branch = ?`); params.push(String(branchId).trim()); }
  const rows = db.prepare(
    `SELECT * FROM cash_in_hand ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date, id`,
  ).all(...params) as any[];
  const running = new Map<string, number>();
  return rows.map((r) => {
    const branch = r.branch || "Delhi";
    const signed = round2(cashDirection(r) * (Number(r.amount) || 0));
    const bal = round2((running.get(branch) || 0) + signed);
    running.set(branch, bal);
    return {
      id: r.id, branch, source: r.source, reference: r.reference, notes: r.notes, date: r.date,
      direction: cashDirection(r) > 0 ? "in" : "out",
      entry_type: cashDirection(r) > 0 ? "deposit" : "withdrawal",
      amount: round2(r.amount), signed_amount: signed, running_balance: bal,
    };
  });
}

export function getCashInHand(db: Database, branchId?: string): {
  branches: { branch_id: string; total_in: number; total_out: number; balance: number; entry_count: number }[];
  total_balance: number;
  entries: any[];
} {
  const entries = listCashEntries(db, branchId);
  const acc = new Map<string, { branch_id: string; total_in: number; total_out: number; balance: number; entry_count: number }>();
  for (const e of entries) {
    const cur = acc.get(e.branch) || { branch_id: e.branch, total_in: 0, total_out: 0, balance: 0, entry_count: 0 };
    if (e.signed_amount >= 0) cur.total_in = round2(cur.total_in + e.amount);
    else cur.total_out = round2(cur.total_out + e.amount);
    cur.balance = round2(cur.balance + e.signed_amount);
    cur.entry_count++;
    acc.set(e.branch, cur);
  }
  const branches = Array.from(acc.values()).sort((a, b) => a.branch_id.localeCompare(b.branch_id));
  return {
    branches,
    total_balance: round2(branches.reduce((s, b) => s + b.balance, 0)),
    entries: entries.slice().reverse(),
  };
}

export function addCashEntry(
  db: Database,
  input: { branch_id?: string; entry_type?: string; amount?: any; notes?: string; date?: string; reference?: string },
  actor: Actor,
): any {
  const branch = String(input?.branch_id || "").trim();
  if (!branch) throw new ExpenseError("branch_id is required", 400);
  const type = String(input?.entry_type || "").trim().toLowerCase();
  if (type !== "deposit" && type !== "withdrawal") throw new ExpenseError("entry_type must be deposit or withdrawal", 400);
  const amount = round2(Number(input?.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseError("Amount must be greater than zero", 400);
  if (type === "withdrawal") {
    const bal = getCashInHand(db, branch).branches.find((b) => b.branch_id === branch)?.balance || 0;
    if (amount > bal + 0.01) {
      throw new ExpenseError(`${branch} has only ${formatINR(bal)} in hand — cannot withdraw ${formatINR(amount)}`, 400);
    }
  }
  const date = String(input?.date || "").trim() || epochToDay(Date.now());
  const res = db.prepare(
    `INSERT INTO cash_in_hand (source, amount, reference, date, notes, created_by, branch, direction)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    type === "deposit" ? "cash_deposit" : "cash_withdrawal", amount,
    input?.reference ? String(input.reference).trim() : null, date,
    input?.notes ? String(input.notes).trim() : null, actor.userId ?? null, branch,
    type === "deposit" ? "in" : "out",
  );
  const id = Number(res.lastInsertRowid);
  return listCashEntries(db, branch).find((e) => e.id === id);
}

// ---------------------------------------------------------------------------
// R27.36a — person ledger.
//
// Grouped by payee name rather than payee_id: legacy rows and most advances only
// ever had a free-text name, so keying on the id would split one person in two.
// ---------------------------------------------------------------------------
export interface PersonLedgerRow {
  person: string;
  total_advances_given: number;
  total_expenses_adjusted: number;
  cash_returned: number;
  net_outstanding: number;
  advance_count: number;
  open_advance_count: number;
}

export function getPersonLedger(db: Database): { people: PersonLedgerRow[]; totals: Omit<PersonLedgerRow, "person"> } {
  const rows = db.prepare(
    `SELECT COALESCE(p.name, e.payee_name_freetext, '—') AS person,
            COALESCE(SUM(e.amount), 0)             AS given,
            COALESCE(SUM(e.reconciled_amount), 0)  AS adjusted,
            COALESCE(SUM(e.returned_amount), 0)    AS returned,
            COUNT(*)                               AS advance_count,
            SUM(CASE WHEN COALESCE(e.advance_status,'open') IN ('open','partial') THEN 1 ELSE 0 END) AS open_count
     FROM expense_slips e
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     WHERE e.expense_type = 'advance' AND e.is_deleted = 0
     GROUP BY person
     ORDER BY person COLLATE NOCASE`,
  ).all() as any[];

  const people: PersonLedgerRow[] = rows.map((r) => ({
    person: r.person,
    total_advances_given: round2(r.given),
    total_expenses_adjusted: round2(r.adjusted),
    cash_returned: round2(r.returned),
    net_outstanding: round2(Number(r.given) - Number(r.adjusted) - Number(r.returned)),
    advance_count: Number(r.advance_count) || 0,
    open_advance_count: Number(r.open_count) || 0,
  }));

  const totals = people.reduce(
    (a, p) => ({
      total_advances_given: round2(a.total_advances_given + p.total_advances_given),
      total_expenses_adjusted: round2(a.total_expenses_adjusted + p.total_expenses_adjusted),
      cash_returned: round2(a.cash_returned + p.cash_returned),
      net_outstanding: round2(a.net_outstanding + p.net_outstanding),
      advance_count: a.advance_count + p.advance_count,
      open_advance_count: a.open_advance_count + p.open_advance_count,
    }),
    { total_advances_given: 0, total_expenses_adjusted: 0, cash_returned: 0, net_outstanding: 0, advance_count: 0, open_advance_count: 0 },
  );
  return { people, totals };
}

// Chronological statement for one person: advances debit them, reconciled expenses
// and returned cash credit them back. The closing balance is what they still hold.
export function getPersonStatement(db: Database, personName: string): {
  person: string; entries: any[]; closing_balance: number; summary: PersonLedgerRow;
} {
  const name = String(personName || "").trim();
  if (!name) throw new ExpenseError("A person name is required", 400);
  const advances = db.prepare(
    `SELECT e.* FROM expense_slips e
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     WHERE e.expense_type = 'advance' AND e.is_deleted = 0
       AND LOWER(COALESCE(p.name, e.payee_name_freetext, '')) = LOWER(?)
     ORDER BY e.expense_date, e.id`,
  ).all(name) as any[];

  const events: { at: number; kind: string; label: string; slip_number: string | null; debit: number; credit: number }[] = [];
  for (const a of advances) {
    events.push({
      at: Number(a.expense_date), kind: "advance_issued",
      label: a.description || "Advance issued", slip_number: a.slip_number,
      debit: round2(a.amount), credit: 0,
    });
    for (const r of listAdvanceReconciliations(db, a.id)) {
      events.push({
        at: Number(r.reconciled_at), kind: "expense_adjusted",
        label: r.description || "Expense adjusted against advance", slip_number: r.slip_number ?? null,
        debit: 0, credit: round2(r.amount),
      });
    }
    if ((Number(a.returned_amount) || 0) > 0) {
      events.push({
        at: Number(a.expense_date), kind: "cash_returned", label: "Cash returned",
        slip_number: a.slip_number, debit: 0, credit: round2(a.returned_amount),
      });
    }
  }
  events.sort((x, y) => x.at - y.at || x.kind.localeCompare(y.kind));

  let balance = 0;
  const entries = events.map((e) => {
    balance = round2(balance + e.debit - e.credit);
    return { ...e, date_display: epochToDay(e.at), balance };
  });

  const summary = getPersonLedger(db).people.find((p) => p.person.toLowerCase() === name.toLowerCase())
    || { person: name, total_advances_given: 0, total_expenses_adjusted: 0, cash_returned: 0, net_outstanding: 0, advance_count: 0, open_advance_count: 0 };
  return { person: name, entries, closing_balance: balance, summary };
}

// ---------------------------------------------------------------------------
// Approvals — same enum, same threshold, same single approver as R27.35.
// ---------------------------------------------------------------------------
export function listExpenseApprovals(db: Database, status = "pending_approval"): any[] {
  const rows = listExpenses(db, { status });
  return rows.map((r) => ({
    id: r.id,
    expense_date: r.expense_date,
    expense_date_display: r.expense_date_display,
    category_name: r.category_name || "—",
    payee_name: r.payee_name,
    description: r.description,
    amount: Number(r.amount) || 0,
    gst_percent: Number(r.gst_percent) || 0,
    gst_mode: r.gst_mode === "inclusive" ? "inclusive" : "exclusive",
    gst_amount: Number(r.gst_amount) || 0,
    total_amount: Number(r.total_amount) || 0,
    approval_status: (r.approval_status || "auto_approved") as ApprovalStatus,
    approved_by: r.approved_by ?? null,
    approved_at: r.approved_at ?? null,
    rejection_reason: r.rejection_reason ?? null,
    created_by: r.created_by,
    slip_number: r.slip_number ?? null,
    is_recurring: !!r.is_recurring,
    recurring_frequency: r.recurring_frequency ?? null,
  }));
}

export function countPendingExpenseApprovals(db: Database): number {
  try {
    const r: any = db.prepare(
      `SELECT COUNT(*) AS c FROM expense_slips WHERE approval_status = 'pending_approval' AND is_deleted = 0`,
    ).get();
    return Number(r?.c) || 0;
  } catch { return 0; }
}

function loadExpenseForDecision(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row || row.is_deleted) throw new PaymentApprovalError("Expense not found", 404);
  const status = (row.approval_status || "auto_approved") as ApprovalStatus;
  if (status === "auto_approved") {
    throw new PaymentApprovalError("Expense is already auto approved — it never entered the queue", 409);
  }
  if (status !== "pending_approval") {
    throw new PaymentApprovalError(`Expense already ${status}`, 409);
  }
  return row;
}

function assertApprover(actor: Actor): void {
  if (!canApprovePayments(actor?.username)) {
    throw new PaymentApprovalError(`Only ${APPROVER_USERNAME} can approve or reject expenses`, 403);
  }
}

export function approveExpense(db: Database, id: number, actor: Actor): any {
  assertApprover(actor);
  loadExpenseForDecision(db, id);
  db.prepare(
    `UPDATE expense_slips SET approval_status='approved', approved_by=?, approved_at=?, rejection_reason=NULL WHERE id = ?`,
  ).run(APPROVER_USERNAME, Date.now(), id);
  // R27.36a-part-2b — mint slip on approval when it wasn't minted at creation
  // (i.e. the row was > ₹5,000 and went through the pending queue).
  mintSlipForExpense(db, id);
  // R27.36b — the slip reference is now stable; book the cash outflow.
  debitCashInHandForExpense(db, id);
  return getExpense(db, id);
}

export function rejectExpense(db: Database, id: number, reason: string, actor: Actor): any {
  assertApprover(actor);
  const clean = String(reason || "").trim();
  if (clean.length < 5) throw new PaymentApprovalError("Rejection reason must be at least 5 characters", 400);
  loadExpenseForDecision(db, id);
  db.prepare(
    `UPDATE expense_slips SET approval_status='rejected', approved_by=?, approved_at=?, rejection_reason=? WHERE id = ?`,
  ).run(APPROVER_USERNAME, Date.now(), clean, id);
  return getExpense(db, id);
}

// ---------------------------------------------------------------------------
// Ledger — derived, never materialised.
//
// Only settled money appears: an expense counts once it is auto-approved or approved
// AND has a slip. Pending, rejected and un-slipped rows are deliberately invisible
// here so the running balance always matches what was actually committed.
// ---------------------------------------------------------------------------
export interface LedgerFilters {
  category_id?: number;
  payee_id?: number;
  from?: string;
  to?: string;
}

export function getLedger(db: Database, filters: LedgerFilters = {}): {
  entries: any[];
  total_debit: number;
  entry_count: number;
  grouped_by_category: Record<string, number>;
  grouped_by_payee: Record<string, number>;
  grouped_by_month: Record<string, number>;
} {
  const where: string[] = [
    `e.is_deleted = 0`,
    `e.slip_number IS NOT NULL`,
    `e.approval_status IN ('auto_approved','approved')`,
  ];
  const params: any[] = [];
  if (filters.category_id) { where.push(`e.category_id = ?`); params.push(Number(filters.category_id)); }
  if (filters.payee_id) { where.push(`e.payee_id = ?`); params.push(Number(filters.payee_id)); }
  const from = filters.from ? dayToEpoch(filters.from) : null;
  const to = filters.to ? dayToEpoch(filters.to, true) : null;
  if (from != null) { where.push(`e.expense_date >= ?`); params.push(from); }
  if (to != null) { where.push(`e.expense_date <= ?`); params.push(to); }

  // Oldest first so the window function accumulates in the direction a ledger reads.
  // R27.36b-fix: also return expense_type + approval_status so the Unified frontend
  // can render the type/status badges without crashing on undefined.
  const rows = db.prepare(
    `SELECT e.id, e.expense_date, e.slip_number, e.description, e.amount, e.gst_amount, e.total_amount,
            e.expense_type, e.approval_status,
            COALESCE(c.name, '—') AS category_name,
            COALESCE(p.name, e.payee_name_freetext, '—') AS payee_name,
            SUM(e.total_amount) OVER (ORDER BY e.expense_date, e.id
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
     FROM expense_slips e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_payees p ON p.id = e.payee_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.expense_date, e.id`,
  ).all(...params) as any[];

  const entries = rows.map((r) => ({
    id: r.id,
    expense_date: r.expense_date,
    expense_date_display: epochToDay(r.expense_date),
    slip_number: r.slip_number,
    expense_type: r.expense_type || "direct",
    approval_status: r.approval_status || "auto_approved",
    category_name: r.category_name,
    payee_name: r.payee_name,
    description: r.description,
    amount: round2(r.amount),
    gst_amount: round2(r.gst_amount),
    total_amount: round2(r.total_amount),
    running_balance: round2(r.running_balance),
  }));

  const bump = (acc: Record<string, number>, key: string, n: number) => {
    acc[key] = round2((acc[key] || 0) + n);
    return acc;
  };
  const grouped_by_category: Record<string, number> = {};
  const grouped_by_payee: Record<string, number> = {};
  const grouped_by_month: Record<string, number> = {};
  for (const e of entries) {
    bump(grouped_by_category, e.category_name, e.total_amount);
    bump(grouped_by_payee, e.payee_name, e.total_amount);
    bump(grouped_by_month, e.expense_date_display.slice(0, 7), e.total_amount);
  }

  return {
    entries,
    total_debit: entries.length ? entries[entries.length - 1].running_balance : 0,
    entry_count: entries.length,
    grouped_by_category,
    grouped_by_payee,
    grouped_by_month,
  };
}

// ---------------------------------------------------------------------------
// Slip generation
// ---------------------------------------------------------------------------
// R27.36a — three interleaved series, each with its own monthly counter, replacing
// R27.36's single per-year EXP scan. The month comes from the expense date rather
// than today so a backdated entry sorts where it belongs.
export function nextExpenseSlipNumber(db: Database, expenseType: ExpenseType, expenseDate: number): string {
  return nextSlipNumber(db, SERIES_FOR_TYPE[expenseType] || "EXP", yearMonthOf(expenseDate));
}

export interface ExpenseSlipData {
  slip_number: string;
  date: string;
  generated_by: string;
  category_name: string;
  payee_name: string;
  payee_details: string[];
  description: string;
  taxable_value: number;
  gst_percent: number;
  gst_amount: number;
  gst_mode: GstMode;
  total_amount: number;
}

export function buildExpenseSlipData(db: Database, expenseId: number, slipNumber: string): ExpenseSlipData {
  const e = getExpense(db, expenseId);
  if (!e) throw new ExpenseError("Expense not found", 404);
  const gstMode: GstMode = e.gst_mode === "inclusive" ? "inclusive" : "exclusive";
  const gst = computeExpenseGst(Number(e.amount) || 0, Number(e.gst_percent) || 0, gstMode);
  const details: string[] = [];
  if (e.payee_id) {
    const p: any = db.prepare(`SELECT * FROM expense_payees WHERE id = ?`).get(e.payee_id);
    if (p) {
      if (p.gst_number) details.push(`GSTIN: ${p.gst_number}`);
      if (p.pan_number) details.push(`PAN: ${p.pan_number}`);
      if (p.bank_account) details.push(`A/C: ${p.bank_account}${p.ifsc ? ` · IFSC: ${p.ifsc}` : ""}`);
      if (p.bank_name) details.push(p.bank_name);
      if (p.phone) details.push(`Ph: ${p.phone}`);
    }
  }
  return {
    slip_number: slipNumber,
    date: epochToDay(e.expense_date),
    generated_by: e.created_by || "—",
    category_name: e.category_name || "—",
    payee_name: e.payee_name || "—",
    payee_details: details,
    description: e.description || "",
    taxable_value: gst.taxable_value,
    gst_percent: Number(e.gst_percent) || 0,
    gst_amount: gst.gst_amount,
    gst_mode: gstMode,
    total_amount: gst.total_amount,
  };
}

// Forked from renderSlipJpeg rather than parameterised: the payment slip is a
// per-vendor line-item table and this is a single-entry voucher, so sharing one
// renderer would mean a flag on every drawing call. The visual language (620px wide,
// dark green header band, right-aligned totals, grey footer) is kept identical.
export function renderExpenseSlipJpeg(data: ExpenseSlipData): Buffer {
  const W = 620;
  const padX = 24;
  const rowH = 24;

  const descLines = wrapText(data.description, 62);
  const showGst = (data.gst_amount || 0) > 0;
  const bodyRows = 4 + data.payee_details.length + descLines.length + (showGst ? 2 : 0);
  const H = Math.min(900, Math.max(340, Math.round(150 + bodyRows * rowH + 90)));

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0b3d2e";
  ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("NARMADA MOBILITY", padX, 26);
  ctx.font = "14px sans-serif";
  ctx.fillText("EXPENSE SLIP", padX, 48);
  ctx.textAlign = "right";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(data.slip_number, W - padX, 26);
  ctx.textAlign = "left";

  let y = 82;
  ctx.fillStyle = "#333333";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Date: ${data.date}`, padX, y);
  ctx.textAlign = "right";
  ctx.fillText(`Entered by: ${data.generated_by}`, W - padX, y);
  ctx.textAlign = "left";
  y += 28;

  ctx.fillStyle = "#000000";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(data.payee_name, padX, y);
  y += 20;

  ctx.fillStyle = "#0b3d2e";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(data.category_name.toUpperCase(), padX, y);
  y += rowH - 4;

  ctx.fillStyle = "#666666";
  ctx.font = "11px sans-serif";
  for (const line of data.payee_details) {
    ctx.fillText(line, padX, y);
    y += 16;
  }
  if (data.payee_details.length) y += 6;

  if (descLines.length) {
    ctx.fillStyle = "#333333";
    ctx.font = "12px sans-serif";
    for (const line of descLines) {
      ctx.fillText(line, padX, y);
      y += 18;
    }
    y += 6;
  }

  ctx.strokeStyle = "#0b3d2e";
  ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
  y += 22;

  const colAmt = W - padX;
  ctx.textAlign = "right";
  if (showGst) {
    const incl = data.gst_mode === "inclusive";
    ctx.fillStyle = "#333333";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${incl ? "Taxable value (excl. GST)" : "Amount"}: ${formatINR(data.taxable_value)}`, colAmt, y);
    y += rowH;
    ctx.fillText(`GST @ ${formatGstPct(data.gst_percent)}%${incl ? " (incl.)" : ""}: ${formatINR(data.gst_amount)}`, colAmt, y);
    y += rowH + 2;
  }
  ctx.fillStyle = "#000000";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText(`Total: ${formatINR(data.total_amount)}`, colAmt, y);
  ctx.textAlign = "left";

  ctx.fillStyle = "#888888";
  ctx.font = "10px sans-serif";
  ctx.fillText("Narmada Mobility · Internal Expense Voucher", padX, H - 14);

  return canvas.toBuffer("image/jpeg", { quality: 0.92 });
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = String(text || "").trim();
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
    if (lines.length >= 4) break;
  }
  if (cur && lines.length < 5) lines.push(cur);
  return lines.slice(0, 5);
}

export function slugifySlip(slip: string): string {
  return (slip || "expense").replace(/[^A-Za-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "expense";
}

export function generateExpenseSlip(
  db: Database,
  expenseId: number,
  uploadsDir: string,
): { expense: any; slip_number: string; file_name: string; path: string; jpeg: Buffer } {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(expenseId);
  if (!row || row.is_deleted) throw new ExpenseError("Expense not found", 404);
  const status = (row.approval_status || "auto_approved") as ApprovalStatus;
  if (status === "pending_approval") {
    throw new ExpenseError("Expense is pending approval — cannot generate a slip yet", 403);
  }
  if (status === "rejected") {
    throw new ExpenseError("Expense was rejected — cannot generate a slip", 403);
  }
  // R27.36a-part-2b — slip is now auto-minted at creation, so this endpoint
  // becomes idempotent: reuse the existing slip and just (re)render the JPG. The
  // old 409 was a UX trap now that every auto-approved row already has a number.
  const now = Date.now();
  const expenseType = (row.expense_type || "direct") as ExpenseType;
  const expenseDateMs = Number(row.expense_date) || now;
  const slip: string = row.slip_number || nextExpenseSlipNumber(db, expenseType, expenseDateMs);
  const data = buildExpenseSlipData(db, expenseId, slip);
  const jpeg = renderExpenseSlipJpeg(data);

  const fileName = `${slugifySlip(slip)}.jpg`;
  // Local disk, same as payment proof uploads — see the report note: there is no
  // object store in this deployment, so a Render disk wipe loses the images. The DB
  // row keeps every number needed to re-render.
  const dir = path.join(uploadsDir, "expense-slips");
  let stored: string | null = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), jpeg);
    stored = `/uploads/expense-slips/${fileName}`;
  } catch {
    // A read-only or missing uploads dir must not cost the user their slip number —
    // the JPG still streams back in the response, only the archived copy is lost.
    stored = null;
  }

  db.prepare(
    `UPDATE expense_slips SET slip_number = ?, slip_generated_at = ?, slip_image_path = ? WHERE id = ?`,
  ).run(slip, now, stored, expenseId);

  return { expense: getExpense(db, expenseId), slip_number: slip, file_name: fileName, path: stored || "", jpeg };
}

// ---------------------------------------------------------------------------
// Recurring templates
// ---------------------------------------------------------------------------
export function dueRecurringExpenses(db: Database, today: number = Date.now()): any[] {
  const cutoff = startOfDay(today) + 86399999; // inclusive of anything dated today
  return db.prepare(
    `SELECT * FROM expense_slips
     WHERE is_recurring = 1 AND is_deleted = 0
       AND recurring_next_date IS NOT NULL AND recurring_next_date <= ?
     ORDER BY recurring_next_date, id`,
  ).all(cutoff) as any[];
}

// Spawn one child from a template and advance the template's clock. The child is a
// plain expense — never itself recurring — so a template can't fork into a tree.
export function materialiseRecurringExpense(db: Database, template: any, today: number = Date.now()): any {
  const now = Date.now();
  const expenseDate = startOfDay(today);
  const gstMode: GstMode = template.gst_mode === "inclusive" ? "inclusive" : "exclusive";
  const gst = computeExpenseGst(Number(template.amount) || 0, Number(template.gst_percent) || 0, gstMode);
  const approval = approvalForTotal(gst.total_amount);
  const autoApproved = approval === "auto_approved";

  // R27.36b — inherit payment fields from the template so a recurring child
  // lands in the same cash pool / bank / advance as its parent. If the parent
  // paid "against_advance" but has no advance_slip_id on the template (edge
  // case), we clear paid_from rather than lose track.
  const inheritedPaidFrom = template.paid_from || null;
  const inheritedHandlerId = template.handled_by_staff_id ?? null;
  const inheritedHandlerName = template.handled_by_staff_name ?? null;

  const res = db.prepare(
    `INSERT INTO expense_slips (
       category_id, payee_id, payee_name_freetext, amount, gst_percent, gst_mode, gst_amount,
       total_amount, description, expense_date, is_recurring, recurring_frequency, recurring_next_date,
       recurring_parent_id, approval_status, approved_by, approved_at, created_by, created_at, is_deleted,
       expense_type, payment_mode, branch_id,
       paid_from, handled_by_staff_id, handled_by_staff_name
     ) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
  ).run(
    template.category_id, template.payee_id, template.payee_name_freetext,
    gst.amount, Number(template.gst_percent) || 0, gstMode, gst.gst_amount, gst.total_amount,
    template.description, expenseDate, template.id,
    approval, autoApproved ? "system" : null, autoApproved ? now : null,
    template.created_by || "recurring", now,
    template.expense_type || "direct", template.payment_mode || "cash", template.branch_id || null,
    inheritedPaidFrom, inheritedHandlerId, inheritedHandlerName,
  );

  const freq = (FREQUENCIES.includes(template.recurring_frequency) ? template.recurring_frequency : "monthly") as RecurringFrequency;
  // Advance from the scheduled date, not from today, so a cron that missed a few days
  // doesn't permanently shift the series later.
  let next = nextRecurringDate(Number(template.recurring_next_date) || expenseDate, freq);
  // If the process was down for longer than one period, roll forward until the next
  // fire is genuinely in the future rather than emitting a burst on the next tick.
  let guard = 0;
  while (next <= expenseDate && guard++ < 120) next = nextRecurringDate(next, freq);
  db.prepare(`UPDATE expense_slips SET recurring_next_date = ? WHERE id = ?`).run(next, template.id);

  const childId = Number(res.lastInsertRowid);
  // R27.36b — auto-approved recurring children need slip + cash-in-hand posted
  // right away so the ledger matches the non-recurring path.
  if (autoApproved) {
    mintSlipForExpense(db, childId);
    debitCashInHandForExpense(db, childId);
  }
  return getExpense(db, childId);
}

export function runRecurringExpenses(db: Database, today: number = Date.now()): { created: number; ids: number[] } {
  const due = dueRecurringExpenses(db, today);
  const ids: number[] = [];
  const tx = db.transaction(() => {
    for (const t of due) {
      const child = materialiseRecurringExpense(db, t, today);
      if (child) ids.push(child.id);
    }
  });
  tx();
  return { created: ids.length, ids };
}

// ---------------------------------------------------------------------------
// Express wiring
// ---------------------------------------------------------------------------
export interface ExpenseRoutesDeps {
  db: Database;
  uploadsDir: string;
  requireRole: (...roles: any[]) => (req: Request, res: Response, next: NextFunction) => void;
  resolveActor: (req: Request) => Actor;
}

export function registerExpenseRoutes(app: Express, deps: ExpenseRoutesDeps) {
  const { db, uploadsDir, requireRole, resolveActor } = deps;
  // admin auto-passes inside requireRole, so this is exactly admin + finance.
  const guard = requireRole("finance");
  // Empty allowlist = admin only, the same construction R27.35 uses for its queue.
  const adminOnly = requireRole();

  const fail = (res: Response, e: any) =>
    res.status(e?.status || 500).json({ error: e?.message || "Unexpected error" });

  // ---- categories ----
  app.get("/api/expenses/categories", guard, (req, res) => {
    try { res.json(listCategories(db, String((req.query as any).include_inactive || "") === "1")); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/expenses/categories", guard, (req, res) => {
    try { res.json(createCategory(db, req.body || {}, resolveActor(req))); }
    catch (e: any) { fail(res, e); }
  });
  app.patch("/api/expenses/categories/:id/deactivate", guard, (req, res) => {
    try { res.json(deactivateCategory(db, parseInt(String(req.params.id), 10))); }
    catch (e: any) { fail(res, e); }
  });

  // ---- payees ----
  app.get("/api/expenses/payees", guard, (req, res) => {
    try { res.json(listPayees(db, (req.query as any).q)); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/expenses/payees", guard, (req, res) => {
    try { res.json(createPayee(db, req.body || {}, resolveActor(req))); }
    catch (e: any) { fail(res, e); }
  });
  app.patch("/api/expenses/payees/:id/deactivate", guard, (req, res) => {
    try { res.json(deactivatePayee(db, parseInt(String(req.params.id), 10))); }
    catch (e: any) { fail(res, e); }
  });

  // ---- ledger (before /:id so "ledger" is never read as an id) ----
  app.get("/api/expenses/ledger", guard, (req, res) => {
    try {
      const q = req.query as any;
      res.json(getLedger(db, {
        category_id: q.category_id ? parseInt(q.category_id, 10) : undefined,
        payee_id: q.payee_id ? parseInt(q.payee_id, 10) : undefined,
        from: q.from || undefined,
        to: q.to || undefined,
      }));
    } catch (e: any) { fail(res, e); }
  });

  // ---- expenses ----
  app.get("/api/expenses", guard, (req, res) => {
    try {
      const q = req.query as any;
      res.json(listExpenses(db, {
        category_id: q.category_id ? parseInt(q.category_id, 10) : undefined,
        payee_id: q.payee_id ? parseInt(q.payee_id, 10) : undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        status: q.status || undefined,
        q: q.q || undefined,
      }));
    } catch (e: any) { fail(res, e); }
  });
  app.post("/api/expenses", guard, (req, res) => {
    try { res.json(createExpense(db, req.body || {}, resolveActor(req))); }
    catch (e: any) { fail(res, e); }
  });
  app.patch("/api/expenses/:id", guard, (req, res) => {
    try { res.json(updateExpense(db, parseInt(String(req.params.id), 10), req.body || {})); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/expenses/:id/soft-delete", guard, (req, res) => {
    try { res.json(softDeleteExpense(db, parseInt(String(req.params.id), 10))); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/expenses/:id/generate-slip", guard, (req, res) => {
    try {
      const out = generateExpenseSlip(db, parseInt(String(req.params.id), 10), uploadsDir);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${out.file_name}"`);
      res.setHeader("X-Slip-Number", out.slip_number);
      res.setHeader("X-Slip-Path", out.path);
      res.setHeader("Access-Control-Expose-Headers", "X-Slip-Number, X-Slip-Path");
      res.end(out.jpeg);
    } catch (e: any) { fail(res, e); }
  });

  // ---- approvals ----
  app.get("/api/admin/expense-approvals/pending", adminOnly, (req, res) => {
    try {
      const status = String((req.query as any).status || "pending_approval");
      const actor = resolveActor(req);
      res.json({
        expenses: listExpenseApprovals(db, status),
        pending_count: countPendingExpenseApprovals(db),
        can_approve: canApprovePayments(actor.username),
        approver_username: APPROVER_USERNAME,
      });
    } catch (e: any) { fail(res, e); }
  });
  app.post("/api/admin/expense-approvals/:id/approve", adminOnly, (req, res) => {
    try { res.json(approveExpense(db, parseInt(String(req.params.id), 10), resolveActor(req))); }
    catch (e: any) { fail(res, e); }
  });
  app.post("/api/admin/expense-approvals/:id/reject", adminOnly, (req, res) => {
    try { res.json(rejectExpense(db, parseInt(String(req.params.id), 10), req.body?.reason, resolveActor(req))); }
    catch (e: any) { fail(res, e); }
  });

  // ---- R27.36b: payment-model support endpoints ----

  // Outstanding advances for a payee, used by the "paid against advance" dropdown
  // in the New Expense modal. Filters by payee_id when the payee is saved, and by
  // payee_name_freetext when the user typed a freeform name. Returns the smallest
  // shape the UI needs — id, slip_number, amount, outstanding, expense_date, payee.
  app.get("/api/expenses/advances/outstanding", guard, (req, res) => {
    try {
      const q = req.query as any;
      const payeeId = q.payee_id != null && q.payee_id !== "" ? Number(q.payee_id) : undefined;
      const payeeName = q.payee_name ? String(q.payee_name).trim() : undefined;
      const branchId = q.branch_id ? String(q.branch_id).trim() : undefined;

      // listAdvances's payee filter is a LIKE against saved-name or freetext, so
      // a payee_id search happens post-fetch below. We fetch both open and partial
      // in two calls and merge — the volume is tiny (an active payee rarely has
      // more than a handful of open advances).
      const openRows = listAdvances(db, { status: "open", branch_id: branchId, payee: payeeName });
      const partialRows = listAdvances(db, { status: "partial", branch_id: branchId, payee: payeeName });
      let rows = [...openRows, ...partialRows];
      if (payeeId != null && Number.isFinite(payeeId)) {
        rows = rows.filter((r: any) => Number(r.payee_id) === payeeId);
      }
      const out = rows
        .map((r: any) => ({
          id: r.id,
          slip_number: r.slip_number,
          expense_date: r.expense_date,
          total_amount: Number(r.total_amount) || 0,
          outstanding: advanceOutstanding(r),
          reconciled_amount: Number(r.reconciled_amount) || 0,
          returned_amount: Number(r.returned_amount) || 0,
          advance_status: r.advance_status,
          payee_id: r.payee_id,
          payee_name: r.payee_saved_name || r.payee_name_freetext,
          handled_by_staff_name: r.handled_by_staff_name || null,
          branch_id: r.branch_id || null,
          expected_return_date: r.expected_return_date || null,
        }))
        .filter(r => r.outstanding > 0.005);
      res.json({ advances: out });
    } catch (e: any) { fail(res, e); }
  });

  // Staff picker for the "who handled the cash" field on advance issuance. Pulled
  // from admin_users so it stays in sync with logins; falls back to an empty list
  // when the table isn't present (fresh tenants). Frontend can still POST a name.
  app.get("/api/expenses/staff", guard, (req, res) => {
    try {
      let rows: any[] = [];
      try {
        rows = db.prepare(
          `SELECT id, username, display_name, role
           FROM admin_users
           WHERE COALESCE(active, 1) = 1
           ORDER BY COALESCE(display_name, username)`,
        ).all() as any[];
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message || ""))) throw e;
      }
      res.json({
        staff: rows.map(u => ({
          id: u.id,
          username: u.username,
          name: u.display_name || u.username,
          role: u.role,
        })),
      });
    } catch (e: any) { fail(res, e); }
  });

  // Expose the paid_from enum so the frontend doesn't have to hard-code it.
  app.get("/api/expenses/payment-options", guard, (req, res) => {
    try {
      res.json({
        paid_from: PAID_FROM_OPTIONS,
        paid_from_for_advance: PAID_FROM_FOR_ADVANCE,
        approval_threshold: 5000,
      });
    } catch (e: any) { fail(res, e); }
  });
}
