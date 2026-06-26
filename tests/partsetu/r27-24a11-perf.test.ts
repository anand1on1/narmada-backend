// R27.24a11 — perf guard. After the prompt-body caching (build once at module
// load) and the uvi-resolver metadata memoization (sqlite_master / PRAGMA probes
// no longer re-run per strategy per candidate), each non-LLM stage of a chat
// turn must stay well under a sane budget. Budgets are deliberately GENEROUS
// (10-50x typical) so the assertions guard against an order-of-magnitude
// regression, not against CI jitter. The external Sonnet call is excluded.
//
// Each stage is warmed once (to pay JIT + first-call memo cost) and then the
// SECOND call is measured — that mirrors steady-state production where the memos
// are already populated.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, uvi, search, prompt } from "../fixtures/partsetu-fixture";
import { classifyIntentHeuristic } from "../../server/services/partsetu/intent";

beforeAll(() => { setupTestDb(); });

function timed(fn: () => void): number {
  const t0 = Date.now();
  fn();
  return Date.now() - t0;
}
async function timedAsync(fn: () => Promise<unknown>): Promise<number> {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
}

describe("R27.24a11 — per-stage latency budgets (non-LLM)", () => {
  it("intent classification (heuristic) is well under 50ms", () => {
    classifyIntentHeuristic("signa 2821 bs6 ka knowledge hai", {}); // warm
    const ms = timed(() => classifyIntentHeuristic("clutch plate aur oil filter dono chahiye", {}));
    expect(ms).toBeLessThan(50);
  });

  it("uvi resolveVehicle is well under 200ms (metadata probes memoized)", async () => {
    await uvi.resolveVehicle("505409"); // warm: populates schema/availability memos
    const ms = await timedAsync(() => uvi.resolveVehicle("802502"));
    expect(ms).toBeLessThan(200);
  });

  it("part search is well under 200ms", async () => {
    const intent = classifyIntentHeuristic("clutch plate", { lockedCatalogId: 1 });
    await search.searchParts(intent, { lockedCatalogId: 1 }); // warm
    const ms = await timedAsync(() => search.searchParts(intent, { lockedCatalogId: 1 }));
    expect(ms).toBeLessThan(200);
  });

  it("system-prompt build is well under 50ms (static body cached at module load)", () => {
    const ctx = "VERIFIED CATALOG SEARCH\n" + Array.from({ length: 40 }, (_, i) => `- 2647423001${i.toString().padStart(2, "0")}: CLUTCH DISC ASSY`).join("\n");
    prompt.buildPartsetuSystemPrompt(ctx, ""); // warm
    const ms = timed(() => { for (let i = 0; i < 100; i++) prompt.buildPartsetuSystemPrompt(ctx, ""); });
    // 100 builds under 50ms => a single build is sub-millisecond.
    expect(ms).toBeLessThan(50);
  });

  it("caching is byte-identical: buildPartsetuSystemPrompt('','') is stable across calls", () => {
    const a = prompt.buildPartsetuSystemPrompt("", "");
    const b = prompt.buildPartsetuSystemPrompt("", "");
    expect(a).toBe(b);
    expect(a.startsWith("You are PartSetu AI")).toBe(true);
  });
});
