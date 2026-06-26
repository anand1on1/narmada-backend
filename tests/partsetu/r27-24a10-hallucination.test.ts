// R27.24a10 — stop hallucinating, force DB-grounded answers. A production trace
// showed the bot (1) inventing fictional "SIGNA 2821.K BS6 / BS6-PH2" variants
// for a model query, (2) failing to route the "2 no" reply because no pending
// row was ever saved, and (3) saying "crankshaft ka catalogue data available
// nahi hai" while the locked catalog had parts. These tests drive the
// production routing through the fixture (variant_query → real pending row →
// "X no" reply → locked-catalog top-3 fallback) plus direct unit checks on the
// new matcher and DB helper. Deterministic, no live LLM.
//
// NOTE ON CATALOGS: the production trace named "tata 2821 / signa 2821 bs6".
// The isolated test DB seeds catalogs #6 (LPK 2821), #7 (SIGNA 2821.K 5L BS6)
// and #8 (SIGNA 2823.K). "2821" matches #6 + #7 (BS6 keeps both); "2 no" picks
// the SECOND option (#7). The behavior — only REAL catalog rows are ever
// offered, never an invented variant — is identical to production.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage, partsetu } from "../fixtures/partsetu-fixture";
import {
  detectVariantQuery,
  matchReplyToIndex,
  classifyIntentHeuristic,
} from "../../server/services/partsetu/intent";

let db: ReturnType<typeof setupTestDb>["db"];
beforeAll(() => { db = setupTestDb().db; });

describe("R27.24a10 — bug 1: variant_query offers REAL catalog rows", () => {
  it("a model query with 2+ real catalogs saves a pending row of REAL catalogs and offers them", async () => {
    const sid = "a10-variant-multi";
    const r = await simulateChatMessage("signa 2821 bs 6 ka knowledge hai", { sessionId: sid });
    expect(r.intent.kind).toBe("variant_query");
    expect(r.variantOptionsCount).toBeGreaterThanOrEqual(2);
    expect(r.verifiedVehicleBlock).toContain("MODEL VARIANTS IN OUR DATABASE");
    // The block lists ONLY real catalog rows — #7 (SIGNA 2821.K) must appear.
    expect(r.verifiedVehicleBlock).toContain("SIGNA 2821.K");
    // No invented "BS6-PH2" variant — only what the DB holds.
    expect(r.verifiedVehicleBlock).not.toMatch(/PH2|PH-2/i);
    const pending = partsetu.getPendingDisambiguation(sid);
    expect(pending).not.toBeNull();
    const catIds = pending!.candidates.map((c: any) => c.lock.catalog_id);
    expect(catIds).toContain(7);
  });

  it("a model query with ZERO catalogs is honest (MODEL NOT IN DATABASE), never invents a variant", async () => {
    const sid = "a10-variant-none";
    const r = await simulateChatMessage("tata 9999 bs6 ka knowledge hai", { sessionId: sid });
    expect(r.intent.kind).toBe("variant_query");
    expect(r.variantNoMatch).toBe(true);
    expect(r.verifiedVehicleBlock).toContain("MODEL NOT IN DATABASE");
    expect(r.catalogId).toBeNull();
    expect(partsetu.getPendingDisambiguation(sid)).toBeNull();
  });

  it("a model query that resolves to exactly ONE catalog auto-locks it", async () => {
    const sid = "a10-variant-one";
    // YODHA 1700 is the only "1700" model in the seed set.
    const r = await simulateChatMessage("yodha 1700 ka knowledge hai", { sessionId: sid });
    expect(r.variantAutoLockedCatalogId).toBe(4);
    expect(r.catalogId).toBe(4);
    expect(r.verifiedVehicleBlock).toContain("VERIFIED VEHICLE CONTEXT");
  });
});

describe("R27.24a10 — bug 2: 'X no' / 'no X' reply routing", () => {
  it("'2 no' resolves the pending variant disambiguation to the SECOND real catalog (#7)", async () => {
    const sid = "a10-2no";
    const arm = await simulateChatMessage("signa 2821 bs 6 ka knowledge hai", { sessionId: sid });
    expect(arm.variantOptionsCount).toBeGreaterThanOrEqual(2);
    const r = await simulateChatMessage("2 no", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(true);
    expect(r.selectedCandidateIndex).toBe(2);
    expect(r.catalogId).toBe(7);
    expect(partsetu.getPendingDisambiguation(sid)).toBeNull();
  });

  it("matchReplyToIndex matches the documented 'X no' / 'no X' / 'no. 2' / 'number 2' forms", () => {
    const ids = [["A"], ["B"], ["C"]];
    const kw = "option|part|number|no";
    expect(matchReplyToIndex("2 no", ids, kw)).toBe(1);
    expect(matchReplyToIndex("no 2", ids, kw)).toBe(1);
    expect(matchReplyToIndex("no. 2", ids, kw)).toBe(1);
    expect(matchReplyToIndex("number 2", ids, kw)).toBe(1);
    expect(matchReplyToIndex("3", ids, kw)).toBe(2);
  });
});

describe("R27.24a10 — bug 4: locked catalog never says 'nahi hai' when it has parts", () => {
  it("a part with no exact match in a locked catalog yields a CLOSEST PARTS block, not 'nahi hai'", async () => {
    const sid = "a10-closest";
    // Lock catalog 1 directly, then ask for a part absent from the synonym map.
    const r = await simulateChatMessage("isme crankshaft ka part no btao", { sessionId: sid, lockedCatalogId: 1 });
    expect(r.catalogId).toBe(1);
    expect(r.searchResult.hits.length).toBe(0);
    expect(r.lockedTotalParts).toBeGreaterThan(0);
    expect(r.closestParts.length).toBeGreaterThan(0);
    expect(r.contextBlock).toContain("NO EXACT MATCH — CLOSEST PARTS");
    // The block explicitly forbids the banned phrase and shows the catalog name.
    expect(r.contextBlock).toContain("SIGNA 2818.K");
    expect(r.contextBlock).toContain('NEVER say "catalogue data available nahi hai"');
  });

  it("the full 4-turn production trace never invents a variant and never claims no data while locked", async () => {
    const sid = "a10-trace";
    // t1: "tata 2821 ka knowledge" — a brand+number variant query.
    const t1 = await simulateChatMessage("tata 2821 ka saman ka knowledge hai tmhe", { sessionId: sid });
    expect(t1.intent.kind).toBe("variant_query");
    expect(t1.verifiedVehicleBlock).toContain("MODEL VARIANTS IN OUR DATABASE");
    // t2: "signa 2821 bs6 ka knowledge" — narrows; real pending row with #7.
    const t2 = await simulateChatMessage("signa 2821 bs 6 ka knowledge hai", { sessionId: sid });
    expect(t2.variantOptionsCount).toBeGreaterThanOrEqual(2);
    expect(t2.verifiedVehicleBlock).not.toMatch(/PH2|PH-2/i);
    expect(partsetu.getPendingDisambiguation(sid)).not.toBeNull();
    // t3: "2 no" — routes to a REAL catalog (#7), no fictional variant.
    const t3 = await simulateChatMessage("2 no", { sessionId: sid });
    expect(t3.disambiguationResolved).toBe(true);
    expect(t3.catalogId).toBe(7);
    // t4: "isme crankshaft ka part no btao" — locked to #7; never "nahi hai".
    const t4 = await simulateChatMessage("isme crankshaft ka part no btao", { sessionId: sid, lockedCatalogId: 7 });
    expect(t4.catalogId).toBe(7);
    if (!t4.searchResult.hits.length) {
      expect(t4.lockedTotalParts).toBeGreaterThan(0);
      expect(t4.contextBlock).toContain("NO EXACT MATCH — CLOSEST PARTS");
    }
  });
});

describe("R27.24a10 — unit: detectVariantQuery boundaries", () => {
  it("fires on model codes and brand+number, not on bare chassis codes or chassis numbers", () => {
    expect(detectVariantQuery("signa 2821 bs6 ka knowledge hai")).not.toBeNull();
    expect(detectVariantQuery("tata 2821 ka knowledge")).not.toBeNull();
    expect(detectVariantQuery("lpk 2518")).not.toBeNull();
    // Bare 5-8 digit chassis-type code → UVI owns it, variant_query must skip.
    expect(detectVariantQuery("mera chassis 505409 hai")).toBeNull();
    expect(detectVariantQuery("MAT458123KAR12345")).toBeNull();
    // No model signal at all.
    expect(detectVariantQuery("clutch plate chahiye")).toBeNull();
  });

  it("classifyIntentHeuristic only routes to variant_query when no vehicle is locked", () => {
    expect(classifyIntentHeuristic("signa 2821 bs6 ka knowledge hai", {}).kind).toBe("variant_query");
    expect(
      classifyIntentHeuristic("signa 2821 bs6 ka knowledge hai", { lockedCatalogId: 1 }).kind,
    ).toBe("locked_vehicle_part");
  });
});
