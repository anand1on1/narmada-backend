// R27.24c — Multi-turn conversation suite (400 interactions = 100 conversations
// × 4 turns), distilled from PARTSETU-360-TEST-QUERIES.md conversation flows.
// Each conversation walks the canonical lifecycle and threads the locked
// catalog forward exactly as production does (conv.catalog_context_id persists
// across turns):
//   T1 — identify the vehicle by chassis type → auto-lock.
//   T2 — ask for a part; the locked catalog scopes the search (lock holds).
//   T3 — change topic to an exploratory cross-catalog query → bypassLock, but
//        the catalog lock still persists (a prior lock always wins resolution).
//   T4 — return to a part for the locked vehicle → lock still holds, parts found.
// Catalogs are cycled 1..5 across the 100 conversations. All deterministic.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage } from "../fixtures/partsetu-fixture";

beforeAll(() => { setupTestDb(); });

const CHASSIS: Record<number, string> = {
  1: "505409", 2: "802502", 3: "835401", 4: "464779", 5: "567059",
};
// Part names whose tokens overlap a seeded OEM-style description in EVERY
// catalog (seedRealisticParts seeds one row per canonical synonym per catalog).
const PART_T2 = ["oil filter", "brake shoe", "clutch plate", "water pump", "battery"];
const PART_T4 = ["air filter", "brake drum", "clutch disc", "fuel pump", "starter motor"];

describe("100 multi-turn conversations (4 turns each = 400)", () => {
  for (let i = 0; i < 100; i++) {
    const cat = (i % 5) + 1;
    const chassis = CHASSIS[cat];
    const t2 = PART_T2[i % 5];
    const t4 = PART_T4[i % 5];

    describe(`conversation #${i + 1} (catalog ${cat})`, () => {
      let locked: number | null = null;

      it("T1 identify by chassis type → auto-lock", async () => {
        const r = await simulateChatMessage(`mera chassis ${chassis} hai`, {});
        expect(r.uviResult?.auto_lock?.catalog_id).toBe(cat);
        expect(r.catalogId).toBe(cat);
        locked = r.catalogId;
      });

      it("T2 part for locked vehicle → lock holds, parts found", async () => {
        const r = await simulateChatMessage(`${t2} chahiye`, { lockedCatalogId: locked });
        expect(r.catalogId).toBe(cat);
        expect(r.searchResult.hits.length).toBeGreaterThan(0);
      });

      it("T3 exploratory topic change → bypassLock, lock persists", async () => {
        const r = await simulateChatMessage(`does anyone have a ${t2} in another model`, { lockedCatalogId: locked });
        expect(r.intent.bypassLock).toBe(true);
        expect(r.catalogId).toBe(cat);
      });

      it("T4 back to a part for the vehicle → lock still holds", async () => {
        const r = await simulateChatMessage(`${t4} ka number do`, { lockedCatalogId: locked });
        expect(r.catalogId).toBe(cat);
        expect(r.searchResult.hits.length).toBeGreaterThan(0);
      });
    });
  }
});
