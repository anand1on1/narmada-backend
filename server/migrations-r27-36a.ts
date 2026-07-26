// R27.36a — one-time data migration from the R27.6 Accounts tables into the unified
// R27.36 `expense_slips` ledger.
//
// The R27.6 tables are NOT dropped or emptied. They remain the audit trail; part 2
// only removes their UI. Every migrated row carries
// (legacy_source_table, legacy_source_id) so re-running this is a no-op — which
// matters because it runs on every boot.
//
// Pure function taking the raw better-sqlite3 handle, same as the rest of the
// expense module, so the suite can drive it against a seeded fixture DB.
import type { Database } from "better-sqlite3";
import { nextSlipNumber, yearMonthOf, type SlipSeries } from "./slip-counters";

export interface LegacyMigrationReport {
  categories_seeded: number;
  headers_migrated: number;
  headers_skipped: number;
  direct_migrated: number;
  direct_skipped: number;
  advances_from_expense_advances: number;
  advances_from_advance_expenses: number;
  advances_deduped: number;
  advances_skipped: number;
  consumptions_migrated: number;
  consumptions_skipped: number;
  reconciliations_created: number;
  legacy_reconciliations_migrated: number;
  legacy_reconciliations_skipped: number;
  current_expenses_migrated: number;
  current_expenses_skipped: number;
  errors: string[];
  notes: string[];
}

export const SYSTEM_CATEGORIES = ["Bus Expense", "Legacy Advance"] as const;
const LEGACY_ACTOR = "legacy-migration";

// R27.6 stored dates as TEXT in a few shapes: 'YYYY-MM-DD',
// 'YYYY-MM-DD HH:MM:SS' (SQLite CURRENT_TIMESTAMP, which is UTC) and full ISO.
export function parseLegacyDate(v: any, fallback: number): number {
  if (v == null || v === "") return fallback;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  const direct = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s.replace(" ", "T")).getTime();
  if (!isNaN(direct)) return direct;
  const loose = new Date(s).getTime();
  return isNaN(loose) ? fallback : loose;
}

// A description is only usable as a payee when it reads like a name. Anything with
// digits, currency or sentence length is a note about the spend, not who got paid.
export function payeeFromDescription(description: any): string | null {
  const s = String(description ?? "").trim();
  if (!s || s.length > 40) return null;
  if (/[\d₹@\/]|\b(paid|for|bill|invoice|charges?|expense)\b/i.test(s)) return null;
  return s;
}

function tableExists(db: Database, name: string): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch { return false; }
}

function safeRows(db: Database, sql: string, report: LegacyMigrationReport): any[] {
  try { return db.prepare(sql).all() as any[]; }
  catch (e: any) { report.errors.push(`query failed: ${String(e?.message || e)}`); return []; }
}

export function migrateLegacyExpenses(db: Database): LegacyMigrationReport {
  const report: LegacyMigrationReport = {
    categories_seeded: 0, headers_migrated: 0, headers_skipped: 0,
    direct_migrated: 0, direct_skipped: 0,
    advances_from_expense_advances: 0, advances_from_advance_expenses: 0,
    advances_deduped: 0, advances_skipped: 0,
    consumptions_migrated: 0, consumptions_skipped: 0,
    reconciliations_created: 0,
    legacy_reconciliations_migrated: 0, legacy_reconciliations_skipped: 0,
    current_expenses_migrated: 0, current_expenses_skipped: 0,
    errors: [], notes: [],
  };
  if (!tableExists(db, "expense_slips") || !tableExists(db, "expense_categories")) {
    report.errors.push("expense_slips/expense_categories missing — run runR27_36Migrations first");
    return report;
  }

  const now = Date.now();
  const findLegacy = db.prepare(
    `SELECT id FROM expense_slips WHERE legacy_source_table = ? AND legacy_source_id = ?`,
  );
  const alreadyMigrated = (table: string, id: number): number | null => {
    const r: any = findLegacy.get(table, id);
    return r ? Number(r.id) : null;
  };

  // ---- usernames for the integer created_by columns ----
  const userNames = new Map<number, string>();
  for (const u of safeRows(db, `SELECT id, username FROM data_team_users`, report)) {
    userNames.set(Number(u.id), String(u.username));
  }
  const actorFor = (id: any) => userNames.get(Number(id)) || "legacy-user";

  const employeeNames = new Map<number, string>();
  if (tableExists(db, "employees")) {
    for (const e of safeRows(db, `SELECT id, name FROM employees`, report)) {
      employeeNames.set(Number(e.id), String(e.name));
    }
  }
  const employeeName = (id: any) =>
    employeeNames.get(Number(id)) || (id == null ? "Unknown Employee" : `Employee #${id}`);

  // ---------------------------------------------------------------------
  // 1. system categories
  // ---------------------------------------------------------------------
  const catByLowerName = new Map<string, number>();
  const loadCategories = () => {
    catByLowerName.clear();
    for (const c of safeRows(db, `SELECT id, name FROM expense_categories`, report)) {
      catByLowerName.set(String(c.name).trim().toLowerCase(), Number(c.id));
    }
  };
  loadCategories();

  const insertCategory = db.prepare(
    `INSERT INTO expense_categories (name, description, created_by, created_at, is_active, is_system)
     VALUES (?,?,?,?,1,?)`,
  );
  const ensureCategory = (name: string, isSystem: boolean): number | null => {
    const key = String(name).trim().toLowerCase();
    const existing = catByLowerName.get(key);
    if (existing) return existing;
    try {
      const res = insertCategory.run(
        String(name).trim(), isSystem ? "R27.36a system category" : "Migrated from R27.6 expense header",
        LEGACY_ACTOR, now, isSystem ? 1 : 0,
      );
      const id = Number(res.lastInsertRowid);
      catByLowerName.set(key, id);
      return id;
    } catch (e: any) {
      report.errors.push(`category "${name}": ${String(e?.message || e)}`);
      return null;
    }
  };

  for (const name of SYSTEM_CATEGORIES) {
    const before = catByLowerName.size;
    ensureCategory(name, true);
    if (catByLowerName.size > before) report.categories_seeded++;
  }
  const busCategoryId = catByLowerName.get("bus expense") ?? null;
  const legacyAdvanceCategoryId = catByLowerName.get("legacy advance") ?? null;

  // ---------------------------------------------------------------------
  // 2. expense_headers -> expense_categories
  // ---------------------------------------------------------------------
  const headerToCategory = new Map<number, number>();
  if (tableExists(db, "expense_headers")) {
    for (const h of safeRows(db, `SELECT id, name FROM expense_headers ORDER BY id`, report)) {
      const key = String(h.name || "").trim().toLowerCase();
      if (!key) { report.headers_skipped++; continue; }
      const existed = catByLowerName.has(key);
      const catId = ensureCategory(String(h.name), false);
      if (catId == null) continue;
      headerToCategory.set(Number(h.id), catId);
      if (existed) report.headers_skipped++; else report.headers_migrated++;
    }
  }
  const categoryForHeader = (headerId: any, fallback: number | null): number | null =>
    headerToCategory.get(Number(headerId)) ?? fallback;

  // ---------------------------------------------------------------------
  // shared insert
  // ---------------------------------------------------------------------
  const insertSlip = db.prepare(
    `INSERT INTO expense_slips (
       category_id, payee_id, payee_name_freetext, amount, gst_percent, gst_mode, gst_amount,
       total_amount, description, expense_date, is_recurring, approval_status, approved_by, approved_at,
       created_by, created_at, slip_number, slip_generated_at, slip_image_path, is_deleted,
       expense_type, payment_mode, branch_id, reference_number, proof_url,
       expected_return_date, advance_status, reconciled_amount, returned_amount,
       bus_number, bus_name, bus_contact, bus_from,
       is_legacy, legacy_source_table, legacy_source_id
     ) VALUES (?,?,?,?,0,'exclusive',0,?,?,?,0,'auto_approved','legacy-migration',?,?,?,?,NULL,NULL,0,
               ?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  );

  interface SlipDraft {
    categoryId: number;
    payee: string;
    amount: number;
    description: string | null;
    expenseDate: number;
    createdBy: string;
    expenseType: "direct" | "advance" | "bus";
    paymentMode: string | null;
    branchId: string | null;
    referenceNumber?: string | null;
    proofUrl?: string | null;
    expectedReturnDate?: number | null;
    advanceStatus?: string | null;
    bus?: { number?: any; name?: any; contact?: any; from?: any };
    sourceTable: string;
    sourceId: number;
  }

  // Slip numbers are minted from the ORIGINAL expense date, so the migrated ledger
  // reads chronologically instead of all landing in the month the migration ran.
  // Legacy rows get no JPG (slip_image_path stays NULL) — 32 canvas renders on boot
  // is not worth it, and the ledger offers a regenerate action instead.
  const seriesFor: Record<string, SlipSeries> = { direct: "EXP", advance: "ADV", bus: "BUS" };
  const insertDraft = (d: SlipDraft): number | null => {
    try {
      const slip = nextSlipNumber(db, seriesFor[d.expenseType], yearMonthOf(d.expenseDate));
      const res = insertSlip.run(
        d.categoryId, null, d.payee, d.amount, d.amount, d.description, d.expenseDate,
        now, d.createdBy, now, slip,
        d.expenseType, d.paymentMode, d.branchId, d.referenceNumber ?? null, d.proofUrl ?? null,
        d.expectedReturnDate ?? null, d.advanceStatus ?? null, 0, 0,
        d.bus?.number ?? null, d.bus?.name ?? null, d.bus?.contact ?? null, d.bus?.from ?? null,
        d.sourceTable, d.sourceId,
      );
      return Number(res.lastInsertRowid);
    } catch (e: any) {
      report.errors.push(`${d.sourceTable}#${d.sourceId}: ${String(e?.message || e)}`);
      return null;
    }
  };

  const hasExpenses = tableExists(db, "expenses");

  // ---------------------------------------------------------------------
  // 3. direct expenses
  // ---------------------------------------------------------------------
  if (hasExpenses) {
    const rows = safeRows(
      db,
      `SELECT * FROM expenses WHERE COALESCE(expense_type,'direct') = 'direct' ORDER BY expense_date, id`,
      report,
    );
    for (const r of rows) {
      if (alreadyMigrated("expenses", Number(r.id))) { report.direct_skipped++; continue; }
      const isBus = !!(r.bus_number || r.bus_name || r.bus_from);
      const fallbackCat = isBus ? busCategoryId : (legacyAdvanceCategoryId ?? busCategoryId);
      const categoryId = categoryForHeader(r.expense_header_id, fallbackCat);
      if (categoryId == null) {
        report.errors.push(`expenses#${r.id}: no category could be resolved`);
        continue;
      }
      const id = insertDraft({
        categoryId,
        payee: payeeFromDescription(r.description) || "Legacy Import",
        amount: Number(r.amount) || 0,
        description: r.description ? String(r.description) : null,
        expenseDate: parseLegacyDate(r.expense_date, now),
        createdBy: actorFor(r.created_by),
        expenseType: isBus ? "bus" : "direct",
        paymentMode: r.payment_mode ? String(r.payment_mode) : "cash",
        branchId: r.branch_id ? String(r.branch_id) : null,
        referenceNumber: r.reference_number ?? null,
        proofUrl: r.proof_url ?? r.attachment_url ?? null,
        bus: isBus ? { number: r.bus_number, name: r.bus_name, contact: r.bus_contact, from: r.bus_from } : undefined,
        sourceTable: "expenses",
        sourceId: Number(r.id),
      });
      if (id) report.direct_migrated++;
    }
  }

  // ---------------------------------------------------------------------
  // 4. advance issuances — expense_advances is authoritative, advance_expenses is
  //    the older shape of the same idea and is only migrated where it has no match.
  // ---------------------------------------------------------------------
  const advanceCat = legacyAdvanceCategoryId ?? busCategoryId;
  const issuedAdvances: { staffId: number | null; amount: number; at: number }[] = [];

  if (tableExists(db, "expense_advances") && advanceCat != null) {
    for (const r of safeRows(db, `SELECT * FROM expense_advances ORDER BY issued_at, id`, report)) {
      const at = parseLegacyDate(r.issued_at, now);
      issuedAdvances.push({ staffId: r.staff_id == null ? null : Number(r.staff_id), amount: Number(r.amount) || 0, at });
      if (alreadyMigrated("expense_advances", Number(r.id))) { report.advances_skipped++; continue; }
      const status = String(r.status || "open").trim().toLowerCase();
      const id = insertDraft({
        categoryId: advanceCat,
        payee: employeeName(r.staff_id),
        amount: Number(r.amount) || 0,
        description: r.purpose ? String(r.purpose) : null,
        expenseDate: at,
        createdBy: actorFor(r.created_by),
        expenseType: "advance",
        paymentMode: "cash",
        branchId: r.branch_id ? String(r.branch_id) : null,
        advanceStatus: status === "closed" || status === "settled" ? "reconciled" : "open",
        sourceTable: "expense_advances",
        sourceId: Number(r.id),
      });
      if (id) report.advances_from_expense_advances++;
    }
  }

  if (tableExists(db, "advance_expenses") && advanceCat != null) {
    const HOUR = 60 * 60 * 1000;
    for (const r of safeRows(db, `SELECT * FROM advance_expenses ORDER BY given_at, id`, report)) {
      if (alreadyMigrated("advance_expenses", Number(r.id))) { report.advances_skipped++; continue; }
      const at = parseLegacyDate(r.given_at, now);
      const amount = Number(r.amount_given) || 0;
      const staffId = r.employee_id == null ? null : Number(r.employee_id);
      const dup = issuedAdvances.find((a) =>
        a.staffId === staffId && Math.abs(a.amount - amount) < 0.01 && Math.abs(a.at - at) <= HOUR);
      if (dup) {
        report.advances_deduped++;
        report.notes.push(`advance_expenses#${r.id} SKIP — matches an expense_advances row (staff ${staffId}, ₹${amount}, within 60min)`);
        continue;
      }
      report.notes.push(`advance_expenses#${r.id} MIGRATE — no expense_advances match (staff ${staffId}, ₹${amount})`);
      const status = String(r.status || "open").trim().toLowerCase();
      const id = insertDraft({
        categoryId: advanceCat,
        payee: employeeName(r.employee_id),
        amount,
        description: r.purpose ? String(r.purpose) : null,
        expenseDate: at,
        createdBy: actorFor(r.given_by),
        expenseType: "advance",
        paymentMode: "cash",
        branchId: null,
        advanceStatus: status === "closed" || status === "settled" || status === "reconciled" ? "reconciled" : "open",
        sourceTable: "advance_expenses",
        sourceId: Number(r.id),
      });
      if (id) report.advances_from_advance_expenses++;
    }
  }

  // ---------------------------------------------------------------------
  // 5. advance consumptions — spending FROM an advance is a direct expense whose
  //    payment_mode is 'advance', plus a reconciliation row against the advance.
  // ---------------------------------------------------------------------
  const insertRecon = db.prepare(
    `INSERT INTO expense_reconciliations
       (advance_slip_id, expense_slip_id, amount, reconciled_at, reconciled_by, notes,
        is_legacy, legacy_source_table, legacy_source_id)
     VALUES (?,?,?,?,?,?,1,?,?)`,
  );
  const reconExists = db.prepare(
    `SELECT id FROM expense_reconciliations WHERE legacy_source_table = ? AND legacy_source_id = ?`,
  );

  if (hasExpenses) {
    const rows = safeRows(
      db, `SELECT * FROM expenses WHERE expense_type = 'advance' ORDER BY expense_date, id`, report,
    );
    for (const r of rows) {
      if (alreadyMigrated("expenses", Number(r.id))) { report.consumptions_skipped++; continue; }
      const categoryId = categoryForHeader(r.expense_header_id, advanceCat);
      if (categoryId == null) { report.errors.push(`expenses#${r.id}: no category could be resolved`); continue; }
      const at = parseLegacyDate(r.expense_date, now);
      const slipId = insertDraft({
        categoryId,
        payee: payeeFromDescription(r.description) || employeeName(r.staff_id),
        amount: Number(r.amount) || 0,
        description: r.description ? String(r.description) : null,
        expenseDate: at,
        createdBy: actorFor(r.created_by),
        expenseType: "direct",
        paymentMode: "advance",
        branchId: r.branch_id ? String(r.branch_id) : null,
        referenceNumber: r.reference_number ?? null,
        proofUrl: r.proof_url ?? r.attachment_url ?? null,
        sourceTable: "expenses",
        sourceId: Number(r.id),
      });
      if (!slipId) continue;
      report.consumptions_migrated++;

      const advanceSlipId = r.advance_id == null ? null : alreadyMigrated("expense_advances", Number(r.advance_id));
      if (!advanceSlipId) {
        report.notes.push(`expenses#${r.id}: advance_id ${r.advance_id} has no migrated advance slip — expense kept, reconciliation skipped`);
        continue;
      }
      try {
        insertRecon.run(advanceSlipId, slipId, Number(r.amount) || 0, at, LEGACY_ACTOR, null, "expenses", Number(r.id));
        report.reconciliations_created++;
      } catch (e: any) {
        report.errors.push(`reconciliation for expenses#${r.id}: ${String(e?.message || e)}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 7. R27.6 advance_reconciliations — these recorded a reconciliation against an
  //    expense HEADER, not a specific expense row, so there is no slip to point at
  //    unless one happens to line up. Match on the same advance within 24h.
  // ---------------------------------------------------------------------
  if (tableExists(db, "advance_reconciliations")) {
    const DAY = 24 * 60 * 60 * 1000;
    for (const r of safeRows(db, `SELECT * FROM advance_reconciliations ORDER BY id`, report)) {
      if (reconExists.get("advance_reconciliations", Number(r.id))) { report.legacy_reconciliations_skipped++; continue; }
      const advanceSlipId = r.advance_id == null ? null : alreadyMigrated("expense_advances", Number(r.advance_id));
      if (!advanceSlipId) {
        report.legacy_reconciliations_skipped++;
        report.notes.push(`advance_reconciliations#${r.id} SKIP — advance_id ${r.advance_id} has no migrated advance slip`);
        continue;
      }
      const at = parseLegacyDate(r.recorded_at, now);
      const match: any = db.prepare(
        `SELECT es.id FROM expense_slips es
         JOIN expense_reconciliations er ON er.expense_slip_id = es.id
         WHERE er.advance_slip_id = ? AND ABS(es.expense_date - ?) <= ?
         ORDER BY ABS(es.expense_date - ?) LIMIT 1`,
      ).get(advanceSlipId, at, DAY, at);
      if (!match) {
        report.legacy_reconciliations_skipped++;
        report.notes.push(`advance_reconciliations#${r.id} SKIP — no expense slip within 24h of ${r.recorded_at}`);
        continue;
      }
      try {
        insertRecon.run(advanceSlipId, Number(match.id), Number(r.amount) || 0, at, LEGACY_ACTOR,
          r.description ? String(r.description) : null, "advance_reconciliations", Number(r.id));
        report.legacy_reconciliations_migrated++;
      } catch (e: any) {
        report.errors.push(`advance_reconciliations#${r.id}: ${String(e?.message || e)}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 8. current_expenses — auto_approved regardless of their original state, so a
  //    two-year-old row cannot appear in today's approval queue.
  // ---------------------------------------------------------------------
  if (tableExists(db, "current_expenses")) {
    for (const r of safeRows(db, `SELECT * FROM current_expenses ORDER BY expense_date, id`, report)) {
      if (alreadyMigrated("current_expenses", Number(r.id))) { report.current_expenses_skipped++; continue; }
      const categoryId = categoryForHeader(r.expense_header_id, legacyAdvanceCategoryId ?? busCategoryId);
      if (categoryId == null) { report.errors.push(`current_expenses#${r.id}: no category could be resolved`); continue; }
      const id = insertDraft({
        categoryId,
        payee: "Legacy Import",
        amount: Number(r.amount) || 0,
        description: r.fields_data_json ? String(r.fields_data_json).slice(0, 500) : null,
        expenseDate: parseLegacyDate(r.expense_date, now),
        createdBy: actorFor(r.created_by),
        expenseType: "direct",
        paymentMode: "cash",
        branchId: r.branch ? String(r.branch) : null,
        proofUrl: r.proof_url ?? null,
        sourceTable: "current_expenses",
        sourceId: Number(r.id),
      });
      if (id) report.current_expenses_migrated++;
    }
  }

  // ---------------------------------------------------------------------
  // 6. roll reconciliation totals up onto the advance slips (runs last so it also
  //    picks up the rows created in step 7).
  // ---------------------------------------------------------------------
  try {
    recomputeAdvanceTotals(db);
  } catch (e: any) {
    report.errors.push(`advance rollup: ${String(e?.message || e)}`);
  }

  return report;
}

// A reconciled advance is one whose receipts (or returned cash) account for the full
// amount. `returned` is sticky: cash handed back is a deliberate close-out and must
// not be downgraded to 'partial' by a later rollup.
export function recomputeAdvanceTotals(db: Database, advanceSlipId?: number): void {
  const where = advanceSlipId ? `AND id = ${Number(advanceSlipId)}` : "";
  const advances = db.prepare(
    `SELECT id, amount, advance_status, returned_amount FROM expense_slips
     WHERE expense_type = 'advance' AND is_deleted = 0 ${where}`,
  ).all() as any[];
  const sumFor = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expense_reconciliations WHERE advance_slip_id = ?`,
  );
  const update = db.prepare(`UPDATE expense_slips SET reconciled_amount = ?, advance_status = ? WHERE id = ?`);
  for (const a of advances) {
    const reconciled = Math.round((Number((sumFor.get(a.id) as any).total) || 0) * 100) / 100;
    const amount = Number(a.amount) || 0;
    const returned = Number(a.returned_amount) || 0;
    let status: string = a.advance_status || "open";
    if (status !== "returned") {
      if (reconciled + returned >= amount - 0.01 && amount > 0) status = "reconciled";
      else if (reconciled > 0) status = "partial";
    }
    update.run(reconciled, status, a.id);
  }
}

export function logLegacyMigrationReport(r: LegacyMigrationReport): void {
  console.log("[migrations] R27.36a-migrate: complete");
  console.log(`  categories seeded: ${r.categories_seeded}`);
  console.log(`  headers migrated: ${r.headers_migrated} (skipped ${r.headers_skipped} existing)`);
  console.log(`  direct expenses migrated: ${r.direct_migrated} (skipped ${r.direct_skipped})`);
  console.log(`  advance issuances migrated: ${r.advances_from_expense_advances} (from expense_advances) + ${r.advances_from_advance_expenses} (from advance_expenses, deduped: ${r.advances_deduped})`);
  console.log(`  advance consumptions migrated: ${r.consumptions_migrated}`);
  console.log(`  reconciliations created: ${r.reconciliations_created} (+${r.legacy_reconciliations_migrated} from advance_reconciliations, skipped ${r.legacy_reconciliations_skipped})`);
  console.log(`  current_expenses migrated: ${r.current_expenses_migrated}`);
  console.log(`  errors: [${r.errors.join(" | ")}]`);
  for (const n of r.notes) console.log(`  [migrations] R27.36a-migrate: ${n}`);
}
