// R27.24a7 — regression suite for the 4 production bugs surfaced by the R27.24c
// 710-interaction harness. Each block asserts the CORRECTED behavior:
//   Bug 1 — single-part search now synonym-expands (tyre→TIRE, headlamp→HEAD
//           LIGHT, alternator→GENERATOR, pressure plate→CLUTCH COVER).
//   Bug 2 — Hindi/Hinglish "aur" / "और" are list separators (without splitting
//           "aurangabad").
//   Bug 3 — two distinct chassis numbers no longer silently auto-lock; a
//           disambiguation prompt fires (covered end-to-end in edge-cases E9,
//           re-asserted here for the marker).
//   Bug 4 — spaced VC No / VIN / chassis are extracted and resolve.
// All deterministic — no live LLM.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage } from "../fixtures/partsetu-fixture";
import { extractMultiPartList } from "../../server/services/partsetu/intent";
import { extractVehicleIdentifierCandidates, resolveVehicle } from "../../server/services/partsetu/uvi-resolver";

beforeAll(() => { setupTestDb(); });

const LOCK1 = { lockedCatalogId: 1 } as const;

// ---- Bug 1: single-part synonym expansion ---------------------------------
describe("Bug 1 — single-part queries synonym-expand to OEM phrasing", () => {
  const cases: Array<[string, string]> = [
    ["tyre", "TIRE"],
    ["headlamp", "HEAD LIGHT"],
    ["alternator", "GENERATOR"],
    ["pressure plate", "CLUTCH COVER"],
    ["starting motor", "SELF STARTER / STARTER"],
  ];
  it.each(cases)("'%s' (customer word) returns >=1 hit in the locked catalog", async (q) => {
    const r = await simulateChatMessage(`${q} chahiye`, LOCK1);
    expect(r.catalogId).toBe(1);
    expect(r.searchResult.hits.length).toBeGreaterThan(0);
  });
});

// ---- Bug 2: Hindi/Hinglish "aur" / "और" separator -------------------------
describe("Bug 2 — 'aur' / 'और' split multi-part lists; 'aurangabad' does not", () => {
  it("'oil filter aur fuel filter aur air filter' → 3 segments", () => {
    const r = extractMultiPartList("oil filter aur fuel filter aur air filter");
    expect(r?.length).toBe(3);
  });

  it("mixed 'oil filter, fuel filter aur air filter' → 3 segments", () => {
    const r = extractMultiPartList("oil filter, fuel filter aur air filter");
    expect(r?.length).toBe(3);
  });

  it("Devanagari 'oil filter और fuel filter और air filter' → 3 segments", () => {
    const r = extractMultiPartList("oil filter और fuel filter और air filter");
    expect(r?.length).toBe(3);
  });

  it("'aurangabad' inside a segment does NOT create a false split", () => {
    // 3 comma segments; the trailing 'aurangabad' must stay attached, not split
    // the list into 4. Whitespace-anchored \saur\s never matches inside the word.
    const r = extractMultiPartList("oil filter, fuel filter, air filter aurangabad");
    expect(r?.length).toBe(3);
  });

  it("'aur' list routes to multi_part_list intent end-to-end", async () => {
    const r = await simulateChatMessage("oil filter aur fuel filter aur air filter", LOCK1);
    expect(r.intent.kind).toBe("multi_part_list");
  });
});

// ---- Bug 3: multi-chassis disambiguation ----------------------------------
describe("Bug 3 — two distinct chassis numbers fire disambiguation, no silent lock", () => {
  it("'505409 aur 802502' → needsDisambiguation, no catalog locked", async () => {
    const r = await simulateChatMessage("505409 aur 802502 dono chahiye");
    expect(r.needsDisambiguation).toBe(true);
    expect(r.catalogId).toBeNull();
    expect(r.systemPrompt).toContain("MULTIPLE VEHICLE MATCHES");
  });

  it("a single chassis still auto-locks (no false disambiguation)", async () => {
    const r = await simulateChatMessage("mera chassis 505409 hai");
    expect(r.needsDisambiguation).toBe(false);
    expect(r.catalogId).toBe(1);
  });
});

// ---- Bug 4: spaced VC No / VIN / chassis extraction -----------------------
describe("Bug 4 — spaced identifiers are extracted and resolve", () => {
  it("spaced VC No '5161 0568 000R' extracts the normalized 51610568000R", () => {
    const cands = extractVehicleIdentifierCandidates("mera vc number 5161 0568 000R hai");
    expect(cands).toContain("51610568000R");
  });

  it("spaced VC No resolves and auto-locks catalog 1", async () => {
    const r = await resolveVehicle("51610568000R");
    expect(r.auto_lock?.catalog_id).toBe(1);
  });

  it("spaced VC No end-to-end locks the right catalog", async () => {
    const r = await simulateChatMessage("vc number 5161 0568 000R hai");
    expect(r.catalogId).toBe(1);
  });

  it("spaced full VIN 'MAT 505409 XY987 ZW1' extracts and locks via VDS", async () => {
    const cands = extractVehicleIdentifierCandidates("MAT 505409 XY987 ZW1");
    expect(cands).toContain("MAT505409XY987ZW1");
    const r = await simulateChatMessage("chassis MAT 505409 XY987 ZW1");
    expect(r.catalogId).toBe(1);
  });

  it("spaced bare chassis '5054 09' extracts the DB-known 505409", () => {
    const cands = extractVehicleIdentifierCandidates("chassis 5054 09 hai");
    expect(cands).toContain("505409");
  });

  it("spaced bare chassis does NOT invent a candidate for unknown spaced digits", () => {
    const cands = extractVehicleIdentifierCandidates("order 1234 5678 ka status");
    expect(cands).not.toContain("12345678");
  });
});
