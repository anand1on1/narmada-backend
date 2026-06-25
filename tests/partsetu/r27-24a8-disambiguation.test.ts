// R27.24a8 — disambiguation reply routing. When a message resolves to >=2
// distinct vehicles (R27.24a7 bug-3 block) PartSetu now persists the candidate
// set + the customer's original query (partsetu_pending_disambiguation). A short
// follow-up reply locks the chosen vehicle and replays the original query. These
// tests drive the production routing through the fixture (intent matchers +
// pending store + replay), deterministic, no live LLM.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage, partsetu } from "../fixtures/partsetu-fixture";

let db: ReturnType<typeof setupTestDb>["db"];
beforeAll(() => { db = setupTestDb().db; });

// The original query carries a real part so the replayed search returns hits in
// the chosen catalog. "505409 aur 802502" resolves to catalog 1 (cand #1) and
// catalog 2 (cand #2) — see SEED_CATALOGS.chassis_type.
const TRIGGER = "clutch plate chahiye 505409 aur 802502";

async function arm(sessionId: string) {
  const r = await simulateChatMessage(TRIGGER, { sessionId });
  expect(r.needsDisambiguation).toBe(true);
  expect(r.catalogId).toBeNull();
  expect(partsetu.getPendingDisambiguation(sessionId)).not.toBeNull();
  return r;
}

describe("R27.24a8 — disambiguation reply routing", () => {
  it("reply '1' picks the first candidate, auto-locks, and replays the query (hits)", async () => {
    const sid = "a8-reply-1";
    await arm(sid);
    const r = await simulateChatMessage("1", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(true);
    expect(r.selectedCandidateIndex).toBe(1);
    expect(r.catalogId).toBe(1);
    expect(r.replayedQuery).toBe(TRIGGER);
    expect(r.searchResult.hits.length).toBeGreaterThan(0);
    expect(partsetu.getPendingDisambiguation(sid)).toBeNull(); // cleared on resolve
  });

  it("reply '2' picks the second candidate (catalog 2)", async () => {
    const sid = "a8-reply-2";
    await arm(sid);
    const r = await simulateChatMessage("2", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(true);
    expect(r.selectedCandidateIndex).toBe(2);
    expect(r.catalogId).toBe(2);
  });

  it("Hindi 'वाहन 2' picks the second candidate", async () => {
    const sid = "a8-hindi";
    await arm(sid);
    const r = await simulateChatMessage("वाहन 2", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(true);
    expect(r.selectedCandidateIndex).toBe(2);
    expect(r.catalogId).toBe(2);
  });

  it("pasting back option-1's chassis (505409) picks option 1", async () => {
    const sid = "a8-pasteback";
    await arm(sid);
    const r = await simulateChatMessage("505409", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(true);
    expect(r.selectedCandidateIndex).toBe(1);
    expect(r.catalogId).toBe(1);
  });

  it("an unrelated question falls through and does NOT clear the pending row", async () => {
    const sid = "a8-fallthrough";
    await arm(sid);
    const r = await simulateChatMessage("do you have brake pads?", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(false);
    expect(partsetu.getPendingDisambiguation(sid)).not.toBeNull(); // still pending
  });

  it("'cancel' clears the pending row without resolving", async () => {
    const sid = "a8-cancel";
    await arm(sid);
    const r = await simulateChatMessage("cancel", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(false);
    expect(partsetu.getPendingDisambiguation(sid)).toBeNull();
  });

  it("an expired (>10 min) pending row is ignored and cleared", async () => {
    const sid = "a8-expired";
    await arm(sid);
    db.prepare("UPDATE partsetu_pending_disambiguation SET expires_at = ? WHERE session_id = ?")
      .run(Date.now() - 1000, sid);
    const r = await simulateChatMessage("1", { sessionId: sid });
    expect(r.disambiguationResolved).toBe(false);
    expect(partsetu.getPendingDisambiguation(sid)).toBeNull(); // cleared on expiry
  });

  it("two concurrent disambiguations resolve independently", async () => {
    const s1 = "a8-multi-1";
    const s2 = "a8-multi-2";
    await simulateChatMessage(TRIGGER, { sessionId: s1 });                       // cand1=cat1, cand2=cat2
    await simulateChatMessage("clutch plate chahiye 835401 aur 464779", { sessionId: s2 }); // cand1=cat3, cand2=cat4
    const r1 = await simulateChatMessage("1", { sessionId: s1 });
    const r2 = await simulateChatMessage("2", { sessionId: s2 });
    expect(r1.catalogId).toBe(1);
    expect(r2.catalogId).toBe(4);
  });
});
