// R27.36 — daily job that materialises recurring expenses.
//
// Scheduling copies the R27.29 sales-digest pattern in server/index.ts: there is no
// node-cron in this repo, so we compute the ms until the next 02:00 IST, fire once,
// then repeat every 24h. 02:00 was chosen so a day's drafts exist before anyone
// opens the panel in the morning.
//
// The work itself lives in runRecurringExpenses() (server/routes-expenses.ts) and is
// transactional, so a crash mid-run cannot leave half a day's children written.
import { runRecurringExpenses } from "./routes-expenses";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const RUN_HOUR_IST = 2;

export function msUntilNextRecurringRun(now: number = Date.now()): number {
  const nowIst = now + IST_OFFSET_MS;
  const target = new Date(nowIst);
  target.setUTCHours(RUN_HOUR_IST, 0, 0, 0);
  if (target.getTime() <= nowIst) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - nowIst;
}

export function runRecurringExpenseJob(db: any): { created: number; ids: number[] } {
  try {
    const out = runRecurringExpenses(db);
    console.log(`[cron] R27.36: created ${out.created} recurring expenses`);
    return out;
  } catch (e: any) {
    console.log(`[cron] R27.36: recurring run failed — ${String(e?.message || e)}`);
    return { created: 0, ids: [] };
  }
}

export function startExpenseRecurringCron(db: any): void {
  const first = msUntilNextRecurringRun();
  console.log(`[cron] R27.36: expense recurring job armed — first run in ~${Math.round(first / 60000)} min (02:00 IST), then every 24h`);
  setTimeout(() => {
    runRecurringExpenseJob(db);
    setInterval(() => runRecurringExpenseJob(db), DAY_MS);
  }, first);
}
