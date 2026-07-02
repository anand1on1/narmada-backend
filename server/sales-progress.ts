// R27.29 — Sales target progress computation + digest logging.
//
// Reuses the existing sales_targets rows (per-metric: 'payment' | 'po' | 'onboarding').
// Achieved is computed LIVE for the calendar month:
//   - payments: SUM(payment_records.amount_inr) for the rep's customers this month
//   - purchase_orders: SUM(purchase_orders_v2.total) for the rep's customers this month
//   - onboarding: COUNT(customers created this month) attributed to the rep
// Targets per category = SUM(sales_targets.target_amount) for that metric whose
// period_start falls in the requested month (monthly targets). Salespeople are
// data_team_users with role='sales'. All timestamp columns are unix-ms.
//
// DEVIATION (documented): the spec described PO/onboarding "achieved" as a raw
// COUNT. The reused sales_targets rows carry MONETARY amounts for 'po', so PO is
// kept amount-based (SUM po.total) to yield a meaningful pct; only onboarding —
// whose target is inherently a count of dealers — is count-based.
import { rawSqlite as sqlite } from "./storage";

const nowIso = () => new Date().toISOString();

export interface CategoryProgress { target: number; achieved: number; remaining: number; pct: number; }
export interface SalespersonProgress {
  salesperson: { id: number; name: string; email: string | null; mobile: string | null };
  payments: CategoryProgress;
  purchase_orders: CategoryProgress;
  onboarding: CategoryProgress;
  days_left: number;
  status: "on_track" | "behind";
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function monthBoundsMs(year: number, month: number): { startMs: number; endMs: number } {
  const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year, month - 1, daysInMonth(year, month), 23, 59, 59, 999);
  return { startMs, endMs };
}
// days_left = days from tomorrow to the last day of the month inclusive.
// Uses "now" when the requested month is the current month; a fully-future month
// returns the whole month, a fully-past month returns 0.
function computeDaysLeft(year: number, month: number, now = Date.now()): number {
  const total = daysInMonth(year, month);
  const { startMs, endMs } = monthBoundsMs(year, month);
  if (now < startMs) return total;
  if (now > endMs) return 0;
  const today = new Date(now).getUTCDate();
  return Math.max(0, total - today);
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pct(achieved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((achieved / target) * 1000) / 10; // one decimal
}

function targetForMetric(repId: number, metric: string, ym: string): number {
  try {
    const row = sqlite.prepare(
      `SELECT COALESCE(SUM(target_amount), 0) AS s
         FROM sales_targets
        WHERE sales_rep_user_id = ? AND metric = ?
          AND period_start IS NOT NULL AND substr(period_start, 1, 7) = ?`,
    ).get(repId, metric, ym) as any;
    return num(row?.s);
  } catch { return 0; }
}

function paymentsAchieved(repId: number, startMs: number, endMs: number): number {
  try {
    const row = sqlite.prepare(
      `SELECT COALESCE(SUM(pr.amount_inr), 0) AS s
         FROM payment_records pr JOIN customers c ON c.id = pr.customer_id
        WHERE c.sales_rep_id = ? AND pr.payment_date BETWEEN ? AND ?`,
    ).get(repId, startMs, endMs) as any;
    return num(row?.s);
  } catch { return 0; }
}
function poAchieved(repId: number, startMs: number, endMs: number): number {
  try {
    const row = sqlite.prepare(
      `SELECT COALESCE(SUM(po.total), 0) AS s
         FROM purchase_orders_v2 po JOIN customers c ON c.id = po.customer_id
        WHERE c.sales_rep_id = ? AND po.deleted_at IS NULL
          AND COALESCE(po.po_date, po.created_at) BETWEEN ? AND ?`,
    ).get(repId, startMs, endMs) as any;
    return num(row?.s);
  } catch { return 0; }
}
function onboardingAchieved(repId: number, startMs: number, endMs: number): number {
  try {
    // customers.created_at is unix-ms; guard against a stray epoch-seconds value.
    const row = sqlite.prepare(
      `SELECT COUNT(*) AS c FROM customers
        WHERE sales_rep_id = ?
          AND (CASE WHEN created_at < 1000000000000 THEN created_at * 1000 ELSE created_at END) BETWEEN ? AND ?`,
    ).get(repId, startMs, endMs) as any;
    return num(row?.c);
  } catch { return 0; }
}

function cat(target: number, achieved: number): CategoryProgress {
  return { target, achieved, remaining: Math.max(0, target - achieved), pct: pct(achieved, target) };
}

export function getMonthlyTargetProgress(repId: number, year: number, month: number, now = Date.now()): SalespersonProgress {
  const sp = sqlite.prepare(
    `SELECT id, name, email, phone FROM data_team_users WHERE id = ?`,
  ).get(repId) as any;
  const ym = monthKey(year, month);
  const { startMs, endMs } = monthBoundsMs(year, month);
  const cappedEnd = Math.min(endMs, now);

  const payments = cat(targetForMetric(repId, "payment", ym), paymentsAchieved(repId, startMs, cappedEnd));
  const purchase_orders = cat(targetForMetric(repId, "po", ym), poAchieved(repId, startMs, cappedEnd));
  const onboarding = cat(targetForMetric(repId, "onboarding", ym), onboardingAchieved(repId, startMs, cappedEnd));

  const days_left = computeDaysLeft(year, month, now);
  const total = daysInMonth(year, month);
  const elapsedFrac = Math.min(1, Math.max(0, (total - days_left) / total));

  // on_track only if every category that HAS a target is keeping pace (>= 90% of
  // the fraction of the month elapsed). Categories without a target don't drag.
  const cats = [payments, purchase_orders, onboarding];
  const withTarget = cats.filter((c) => c.target > 0);
  const behind = withTarget.some((c) => c.achieved / c.target < 0.9 * elapsedFrac);
  const status: "on_track" | "behind" = behind ? "behind" : "on_track";

  return {
    salesperson: { id: repId, name: sp?.name || `Rep #${repId}`, email: sp?.email ?? null, mobile: sp?.phone ?? null },
    payments, purchase_orders, onboarding, days_left, status,
  };
}

export function getActiveSalespeople(): Array<{ id: number; name: string; email: string | null; mobile: string | null }> {
  try {
    const rows = sqlite.prepare(
      `SELECT id, name, email, phone FROM data_team_users
        WHERE role = 'sales' AND active = 1 AND deleted_at IS NULL`,
    ).all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name || `Rep #${r.id}`, email: r.email ?? null, mobile: r.phone ?? null }));
  } catch { return []; }
}

export function getAllSalespersonProgress(year: number, month: number, now = Date.now()): SalespersonProgress[] {
  return getActiveSalespeople().map((s) => getMonthlyTargetProgress(s.id, year, month, now));
}

export interface TeamAggregate {
  payments: CategoryProgress; purchase_orders: CategoryProgress; onboarding: CategoryProgress;
  days_left: number; behind: Array<{ id: number; name: string }>; count: number;
}
export function getTeamAggregateProgress(year: number, month: number, now = Date.now()): TeamAggregate {
  const all = getAllSalespersonProgress(year, month, now);
  const sum = (key: "payments" | "purchase_orders" | "onboarding") => {
    const target = all.reduce((a, p) => a + p[key].target, 0);
    const achieved = all.reduce((a, p) => a + p[key].achieved, 0);
    return cat(target, achieved);
  };
  return {
    payments: sum("payments"),
    purchase_orders: sum("purchase_orders"),
    onboarding: sum("onboarding"),
    days_left: computeDaysLeft(year, month, now),
    behind: all.filter((p) => p.status === "behind").map((p) => ({ id: p.salesperson.id, name: p.salesperson.name })),
    count: all.length,
  };
}

// ---- Digest log ----
export interface DigestLogEntry {
  digest_date: string; recipient_type: string; recipient_user_id?: number | null;
  recipient_email?: string | null; recipient_mobile?: string | null;
  channel: string; status: string; error?: string | null; payload_summary?: string | null;
}
export function logDigest(e: DigestLogEntry): { id: number } {
  const info = sqlite.prepare(
    `INSERT INTO sales_target_digest_log
       (digest_date, recipient_type, recipient_user_id, recipient_email, recipient_mobile, channel, status, error, payload_summary, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.digest_date, e.recipient_type, e.recipient_user_id ?? null, e.recipient_email ?? null,
    e.recipient_mobile ?? null, e.channel, e.status, e.error ?? null, e.payload_summary ?? null, nowIso(),
  );
  return { id: Number(info.lastInsertRowid) };
}
export function getDigestLog(date: string) {
  return sqlite.prepare(
    `SELECT * FROM sales_target_digest_log WHERE digest_date = ? ORDER BY sent_at DESC`,
  ).all(date);
}
export function digestAlreadySentToday(date: string): boolean {
  try {
    const row = sqlite.prepare(
      `SELECT COUNT(*) AS c FROM sales_target_digest_log WHERE digest_date = ?`,
    ).get(date) as any;
    return num(row?.c) > 0;
  } catch { return false; }
}

// ---- formatting helpers ----
export function fmtCurrency(n: number): string { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
export function fmtMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
export function fmtDate(d: Date | number): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
