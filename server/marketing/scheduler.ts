// R26.4 Marketing Hub — scheduler.
// Every 60s, pick up campaigns with status='scheduled' and scheduled_at <= now() and run them.
// Each campaign runs asynchronously; runCampaign flips status to 'sending' immediately so a
// slow run can't be double-picked on the next tick. Failures are isolated per campaign.
import { rawSqlite as sqlite } from "../storage";
import { runCampaign } from "./campaign-runner";

const TICK_MS = 60_000;
let started = false;

async function tick(): Promise<void> {
  let due: Array<{ id: number }> = [];
  try {
    due = sqlite
      .prepare(`SELECT id FROM marketing_campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`)
      .all(Date.now()) as Array<{ id: number }>;
  } catch (e: any) {
    console.error("[marketing/scheduler] query failed:", e?.message || e);
    return;
  }
  if (due.length === 0) return;
  console.log(`[marketing/scheduler] ${due.length} scheduled campaign(s) due`);
  for (const { id } of due) {
    runCampaign(id).catch((e: any) => console.error(`[marketing/scheduler] campaign #${id} failed:`, e?.message || e));
  }
}

export function startMarketingScheduler(): void {
  if (started) return;
  started = true;
  // First tick shortly after boot, then every TICK_MS.
  setTimeout(() => { tick().catch(() => {}); }, 15_000);
  setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  console.log("[marketing/scheduler] started (60s tick)");
}
