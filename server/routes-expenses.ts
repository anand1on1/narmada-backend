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

export { APPROVAL_THRESHOLD, APPROVER_USERNAME, canApprovePayments };

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

  const approval = approvalForTotal(gst.total_amount);
  const autoApproved = approval === "auto_approved";

  const res = db.prepare(
    `INSERT INTO expense_slips (
       category_id, payee_id, payee_name_freetext, amount, gst_percent, gst_mode, gst_amount,
       total_amount, description, expense_date, is_recurring, recurring_frequency, recurring_next_date,
       recurring_parent_id, approval_status, approved_by, approved_at, created_by, created_at, is_deleted
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
  ).run(
    categoryId, payeeId, freetext, gst.amount, gstPercent, gstMode, gst.gst_amount,
    gst.total_amount, input?.description ? String(input.description).trim() : null, expenseDate,
    isRecurring, frequency, nextDate, null,
    approval, autoApproved ? "system" : null, autoApproved ? now : null,
    actor.userName, now,
  );
  return getExpense(db, Number(res.lastInsertRowid));
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

// Editing is only allowed before a slip exists — once a JPG has been handed to a
// payee the numbers on it are the record, and silently changing the row behind it
// would make the slip a lie.
export function updateExpense(db: Database, id: number, input: ExpenseInput): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row || row.is_deleted) throw new ExpenseError("Expense not found", 404);
  if (row.slip_number) throw new ExpenseError("Slip already generated — this expense can no longer be edited", 409);

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

  db.prepare(
    `UPDATE expense_slips SET category_id=?, payee_id=?, payee_name_freetext=?, amount=?, gst_percent=?, gst_mode=?,
       gst_amount=?, total_amount=?, description=?, expense_date=?, is_recurring=?, recurring_frequency=?,
       recurring_next_date=?, approval_status=?, approved_by=?, approved_at=?, rejection_reason=NULL
     WHERE id = ?`,
  ).run(
    categoryId, payeeId, freetext, gst.amount, gstPercent, gstMode, gst.gst_amount, gst.total_amount,
    input?.description !== undefined ? (input.description ? String(input.description).trim() : null) : row.description,
    expenseDate, isRecurring, frequency, nextDate,
    approval, autoApproved ? "system" : null, autoApproved ? Date.now() : null,
    id,
  );
  return getExpense(db, id);
}

export function softDeleteExpense(db: Database, id: number): any {
  const row: any = db.prepare(`SELECT * FROM expense_slips WHERE id = ?`).get(id);
  if (!row) throw new ExpenseError("Expense not found", 404);
  db.prepare(`UPDATE expense_slips SET is_deleted = 1 WHERE id = ?`).run(id);
  return { ...row, is_deleted: 1 };
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
  const rows = db.prepare(
    `SELECT e.id, e.expense_date, e.slip_number, e.description, e.amount, e.gst_amount, e.total_amount,
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
export function nextExpenseSlipNumber(db: Database, year: number = new Date().getFullYear()): string {
  const prefix = `EXP/${year}/`;
  const rows = db.prepare(`SELECT slip_number FROM expense_slips WHERE slip_number LIKE ?`).all(`${prefix}%`) as any[];
  let max = 0;
  for (const r of rows) {
    const m = /\/(\d+)$/.exec(r.slip_number || "");
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
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
  if (row.slip_number) throw new ExpenseError(`Slip ${row.slip_number} already generated for this expense`, 409);

  const now = Date.now();
  const slip = nextExpenseSlipNumber(db, new Date(row.expense_date || now).getFullYear());
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

  const res = db.prepare(
    `INSERT INTO expense_slips (
       category_id, payee_id, payee_name_freetext, amount, gst_percent, gst_mode, gst_amount,
       total_amount, description, expense_date, is_recurring, recurring_frequency, recurring_next_date,
       recurring_parent_id, approval_status, approved_by, approved_at, created_by, created_at, is_deleted
     ) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,?,?,?,?,?,?,0)`,
  ).run(
    template.category_id, template.payee_id, template.payee_name_freetext,
    gst.amount, Number(template.gst_percent) || 0, gstMode, gst.gst_amount, gst.total_amount,
    template.description, expenseDate, template.id,
    approval, autoApproved ? "system" : null, autoApproved ? now : null,
    template.created_by || "recurring", now,
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

  return getExpense(db, Number(res.lastInsertRowid));
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
}
