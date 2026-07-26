// R27.36a-part-2b — one-shot backfill.
//
// Rows created by R27.36's `createExpense` before this release never received a
// slip_number: the code path allocated one only when the user explicitly hit
// "Generate Slip". The Unified UI (R27.36a-part-2) does not have that button,
// so auto-approved rows landed in the ledger with slip_number = NULL and displayed
// as "–". This backfill walks every such row and mints a slip number using the
// same monthly counter the migration and createExpense now use.
//
// Idempotent — a row already carrying a slip_number is skipped, and the outer
// migration runner can call this as often as it likes.
import type { Database } from "better-sqlite3";
import { nextSlipNumber, SERIES_FOR_TYPE, yearMonthOf, type SlipSeries } from "./slip-counters";

export interface BackfillReport {
  scanned: number;
  minted: number;
  skipped_has_slip: number;
  skipped_pending: number;
  skipped_rejected: number;
  skipped_deleted: number;
  errors: string[];
}

export function backfillMissingSlips(db: Database): BackfillReport {
  const report: BackfillReport = {
    scanned: 0,
    minted: 0,
    skipped_has_slip: 0,
    skipped_pending: 0,
    skipped_rejected: 0,
    skipped_deleted: 0,
    errors: [],
  };

  let rows: any[];
  try {
    rows = db.prepare(
      `SELECT id, slip_number, expense_type, expense_date, approval_status, is_deleted
       FROM expense_slips
       WHERE slip_number IS NULL
       ORDER BY expense_date ASC, id ASC`,
    ).all() as any[];
  } catch (e: any) {
    report.errors.push(`select failed: ${String(e?.message || e)}`);
    return report;
  }

  const update = db.prepare(
    `UPDATE expense_slips SET slip_number = ?, slip_generated_at = ? WHERE id = ? AND slip_number IS NULL`,
  );
  const now = Date.now();

  for (const r of rows) {
    report.scanned++;
    if (r.is_deleted) { report.skipped_deleted++; continue; }
    if (r.slip_number) { report.skipped_has_slip++; continue; } // safety
    const status = String(r.approval_status || "").trim();
    if (status === "pending_approval") { report.skipped_pending++; continue; }
    if (status === "rejected") { report.skipped_rejected++; continue; }

    const type = String(r.expense_type || "direct");
    const series: SlipSeries = SERIES_FOR_TYPE[type] || "EXP";
    const ym = yearMonthOf(Number(r.expense_date) || now);
    try {
      const slip = nextSlipNumber(db, series, ym);
      const res = update.run(slip, now, r.id);
      if (res.changes) report.minted++;
    } catch (e: any) {
      report.errors.push(`row ${r.id}: ${String(e?.message || e)}`);
    }
  }
  return report;
}

export function logBackfillReport(r: BackfillReport): void {
  const summary =
    `scanned=${r.scanned} minted=${r.minted} ` +
    `skipped_has_slip=${r.skipped_has_slip} skipped_pending=${r.skipped_pending} ` +
    `skipped_rejected=${r.skipped_rejected} skipped_deleted=${r.skipped_deleted} ` +
    `errors=${r.errors.length}`;
  console.log(`[migrations] R27.36a-part-2b backfill: ${summary}`);
  for (const err of r.errors.slice(0, 20)) {
    console.log(`[migrations] R27.36a-part-2b backfill error: ${err}`);
  }
}
