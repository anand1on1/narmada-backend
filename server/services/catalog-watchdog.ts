// PartSetu R27.23 — catalog ingest watchdog.
// A periodic sweep that reconciles catalog rows whose status drifted from
// reality (ingest crashed mid-way, finalize never ran, or a row claims active
// with zero parts). Runs in-process every 5 minutes. All work is idempotent and
// wrapped so a transient DB error never kills the interval.
import { rawSqlite as db } from "../storage";

const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

function partsCount(catalogId: number): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM partsetu_parts WHERE catalog_id = ?`).get(catalogId) as any;
  return Number(r?.n || 0);
}

export function runWatchdogSweep(): void {
  const now = Date.now();
  try {
    const rows = db.prepare(
      `SELECT id, status, uploaded_at FROM partsetu_catalogs WHERE status IN ('ingesting', 'active')`,
    ).all() as Array<{ id: number; status: string | null; uploaded_at: number | null }>;

    for (const row of rows) {
      const uploadedAt = Number(row.uploaded_at || 0);
      const age = now - uploadedAt;
      const pc = partsCount(row.id);

      // (a) ingesting, has parts, but never finalized (>10 min) → force active.
      if (row.status === "ingesting" && uploadedAt > 0 && age > TEN_MIN && pc > 0) {
        db.prepare(`UPDATE partsetu_catalogs SET status = 'active', ingest_error = NULL WHERE id = ?`).run(row.id);
        console.log(`[catalog-watchdog] FORCE_ACTIVE catalog_id=${row.id} reason="parts present but ingest never finalized"`);
        continue;
      }

      // (b) active but zero parts after a grace period → mark failed.
      if (row.status === "active" && pc === 0 && uploadedAt > 0 && age > FIVE_MIN) {
        db.prepare(`UPDATE partsetu_catalogs SET status = 'failed', ingest_error = 'ZERO_PARTS_AFTER_INGEST' WHERE id = ?`).run(row.id);
        console.log(`[catalog-watchdog] FORCE_FAILED catalog_id=${row.id} reason="active but zero parts"`);
        continue;
      }

      // (c) stuck ingesting for over two hours → mark failed (timeout).
      if (row.status === "ingesting" && uploadedAt > 0 && age > TWO_HOURS) {
        db.prepare(`UPDATE partsetu_catalogs SET status = 'failed', ingest_error = 'STUCK_INGESTING_TIMEOUT' WHERE id = ?`).run(row.id);
        console.log(`[catalog-watchdog] FORCE_FAILED catalog_id=${row.id} reason="stuck ingesting > 2h"`);
        continue;
      }
    }
  } catch (e: any) {
    console.warn(`[catalog-watchdog] sweep error: ${e?.message || e}`);
  }
}

let started = false;
export function startCatalogWatchdog(): void {
  if (started) return;
  started = true;
  console.log("[catalog-watchdog] started (sweep every 5 min)");
  setInterval(runWatchdogSweep, FIVE_MIN).unref?.();
}
