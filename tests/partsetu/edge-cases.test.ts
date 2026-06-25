// R27.24c — Edge-case suite (10 interactions), distilled from
// PARTSETU-360-TEST-QUERIES.md edge cases E1–E10. Each probes a distinct
// failure mode of the chat pipeline: RC-blob chassis extraction, non-Latin and
// emoji-only inputs, competitor/off-OEM no-lock, the price-refusal hard rule,
// genuine no-result handling, SQL-injection safety, oversized input, two-chassis
// ambiguity (documents the current no-disambiguation behavior), and a
// known-absent VC number that must never hallucinate a lock. All deterministic.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage } from "../fixtures/partsetu-fixture";

let dbRef: ReturnType<typeof setupTestDb>["db"];
beforeAll(() => { dbRef = setupTestDb().db; });

describe("Edge cases (10)", () => {
  it("E1 RC-blob with embedded VIN auto-locks via VDS", async () => {
    const rc = "REGISTRATION CERTIFICATE\nReg No: MH12AB1234\nChassis No: MAT505409XY987ZW1\nEngine No: 697TC51ABC";
    const r = await simulateChatMessage(rc);
    expect(r.uviResult?.auto_lock?.catalog_id).toBe(1);
    expect(r.catalogId).toBe(1);
  });

  it("E2 Hindi-only part query in a locked catalog runs without throwing", async () => {
    const r = await simulateChatMessage("गाड़ी का क्लच प्लेट चाहिए", { lockedCatalogId: 1 });
    expect(r.catalogId).toBe(1);
    expect(typeof r.systemPrompt).toBe("string");
    expect(r.systemPrompt.length).toBeGreaterThan(0);
  });

  it("E3 emoji-only input does not crash", async () => {
    const r = await simulateChatMessage("🚛🔧⚙️");
    expect(r).toBeTruthy();
    expect(r.uviResult?.auto_lock ?? null).toBeNull();
    expect(typeof r.systemPrompt).toBe("string");
  });

  it("E4 competitor vehicle (Ashok Leyland) does not auto-lock", async () => {
    const r = await simulateChatMessage("Ashok Leyland Dost ka clutch");
    expect(r.uviResult?.auto_lock ?? null).toBeNull();
    expect(r.catalogId).toBeNull();
  });

  it("E5 price query classifies as price_query and the prompt forbids quoting price", async () => {
    const r = await simulateChatMessage("clutch plate ka price kya hai", { lockedCatalogId: 1 });
    expect(r.intent.kind).toBe("price_query");
    expect(r.systemPrompt).toContain("NEVER quote, estimate, or mention any price");
  });

  it("E6 genuinely non-existent part yields zero hits without crashing", async () => {
    const r = await simulateChatMessage("flux capacitor warp coil chahiye", { lockedCatalogId: 1 });
    expect(r.searchResult.hits.length).toBe(0);
    expect(typeof r.systemPrompt).toBe("string");
  });

  it("E7 SQL-injection text leaves the parts table intact", async () => {
    const before = (dbRef.prepare("SELECT COUNT(*) AS c FROM partsetu_parts").get() as any).c;
    await simulateChatMessage("'; DROP TABLE partsetu_parts; --", { lockedCatalogId: 1 });
    const after = (dbRef.prepare("SELECT COUNT(*) AS c FROM partsetu_parts").get() as any).c;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  it("E8 oversized (~10k char) input does not crash", async () => {
    const huge = "clutch plate ".repeat(800); // ~10.4k chars
    const r = await simulateChatMessage(huge, { lockedCatalogId: 1 });
    expect(r).toBeTruthy();
    expect(typeof r.systemPrompt).toBe("string");
    expect(r.systemPrompt.length).toBeGreaterThan(0);
  });

  it("E9 two distinct chassis numbers resolve to one of the two (no disambiguation yet)", async () => {
    const r = await simulateChatMessage("505409 aur 802502 dono hai");
    const locked = r.uviResult?.auto_lock?.catalog_id ?? null;
    expect(locked).not.toBeNull();
    expect([1, 2]).toContain(locked);
  });

  it("E10 known-absent VC number must not hallucinate a lock", async () => {
    const r = await simulateChatMessage("VC number 55320631000R hai");
    expect(r.uviResult?.auto_lock ?? null).toBeNull();
    expect(r.catalogId).toBeNull();
  });
});
