// R27.36a — monthly slip counters, shared by the expense routes and the R27.6 data
// migration. Kept in its own module so the migration does not have to import the
// route file (and drag the canvas dependency into a boot-time code path).
import type { Database } from "better-sqlite3";

export type SlipSeries = "EXP" | "ADV" | "BUS";

export const SERIES_FOR_TYPE: Record<string, SlipSeries> = {
  direct: "EXP",
  advance: "ADV",
  bus: "BUS",
};

export function yearMonthOf(epochMs: number): string {
  const d = new Date(Number(epochMs) || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Reserve the next number in a (series, month) sequence. The UPSERT is the whole
// point: two concurrent bookings in the same month cannot land on the same number,
// which a `SELECT MAX(...)` scan of slip_number could not guarantee.
export function nextSlipNumber(db: Database, series: SlipSeries, yearMonth: string): string {
  const row: any = db.prepare(
    `INSERT INTO slip_counters (series, year_month, counter) VALUES (?,?,1)
     ON CONFLICT(series, year_month) DO UPDATE SET counter = counter + 1
     RETURNING counter`,
  ).get(series, yearMonth);
  return `${series}/${yearMonth}/${String(Number(row.counter)).padStart(5, "0")}`;
}

export function peekSlipCounter(db: Database, series: SlipSeries, yearMonth: string): number {
  const row: any = db.prepare(
    `SELECT counter FROM slip_counters WHERE series = ? AND year_month = ?`,
  ).get(series, yearMonth);
  return Number(row?.counter) || 0;
}
