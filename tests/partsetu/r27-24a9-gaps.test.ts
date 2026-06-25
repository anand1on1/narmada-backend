// R27.24a9 — close 4 conversational gaps. A production trace exposed
// cross-catalog leakage: after re-locking to a new vehicle, the assistant kept
// citing the PREVIOUS catalog's part numbers (copied out of chat history past
// the citation guard). These tests drive the production routing through the
// fixture (relock purge, parts cart, part-name disambiguation) plus a direct
// citation-guard check. Deterministic, no live LLM.
//
// NOTE ON CATALOGS: the production trace named catalogs #22 (SFC407CNG) and #2
// (SIGNA 4232). The isolated test DB only has catalogs #1..#5, so the trace is
// reproduced faithfully with fixture catalogs (lock A, ask parts, re-lock B,
// assert ZERO catalog-A numbers leak). The behavior — never leak the prior
// catalog after a re-lock — is identical.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage, partsetu, search } from "../fixtures/partsetu-fixture";

let db: ReturnType<typeof setupTestDb>["db"];
beforeAll(() => { db = setupTestDb().db; });

// Catalog-1 KNOWN OEM numbers (the "prior catalog" in leakage tests).
const CAT1_OEMS = ["264742300101", "277842300182", "252609110102", "252325108201"];

function oemsOf(hits: Array<{ part_number: string }>): string[] {
  return hits.map((h) => String(h.part_number || "")).filter(Boolean);
}

describe("R27.24a9 — gap 1: cross-catalog leakage after re-lock", () => {
  it("trace replay: after re-locking to a new vehicle, the part turn never returns the prior catalog's numbers", async () => {
    const sid = "a9-trace";
    // t1: lock vehicle A (catalog 3) by chassis.
    const t1 = await simulateChatMessage("mera chassis 835401 hai", { sessionId: sid });
    expect(t1.catalogId).toBe(3);
    // t2: ask a part on A — answered from catalog 3.
    const t2 = await simulateChatMessage("clutch plate ka part number", { sessionId: sid, lockedCatalogId: 3 });
    expect(t2.searchResult.hits.every((h) => h.catalog_id === 3)).toBe(true);
    // t3: customer switches to vehicle B (catalog 4) — re-lock + purge.
    const t3 = await simulateChatMessage("mera gari hai chassis no 464779", { sessionId: sid, lockedCatalogId: 3 });
    expect(t3.vehicleRelocked).toBe(true);
    expect(t3.catalogId).toBe(4);
    // t4: the leaking turn — ask parts; must be catalog 4 (or empty), NEVER cat3/cat1.
    const t4 = await simulateChatMessage("brake chamber aur hand brake aur clutch booster ka part number btao", { sessionId: sid, lockedCatalogId: 4 });
    const allHits = [...t4.searchResult.hits, ...(t4.searchResult.perPart?.flatMap((p) => p.hits ?? []) ?? [])]
      .filter(Boolean);
    expect(allHits.every((h) => h.catalog_id === 4)).toBe(true);
    for (const n of CAT1_OEMS) expect(oemsOf(allHits)).not.toContain(n);
  });

  it("zero OEM overlap between the prior catalog's parts and the re-locked catalog's search", async () => {
    const sid = "a9-overlap";
    await simulateChatMessage("mera chassis 835401 hai", { sessionId: sid });
    const before = await simulateChatMessage("clutch plate", { sessionId: sid, lockedCatalogId: 3 });
    // "clutch" alone may disambiguate; gather catalog-3 numbers directly instead.
    const cat3Nums = new Set(
      (db.prepare("SELECT part_number FROM partsetu_parts WHERE catalog_id = 3").all() as any[])
        .map((r) => String(r.part_number)),
    );
    const relock = await simulateChatMessage("mera chassis 464779 hai", { sessionId: sid, lockedCatalogId: 3 });
    expect(relock.catalogId).toBe(4);
    const after = await simulateChatMessage("oil filter ka part number", { sessionId: sid, lockedCatalogId: 4 });
    for (const n of oemsOf(after.searchResult.hits)) expect(cat3Nums.has(n)).toBe(false);
    expect(before.catalogId).toBe(3);
  });

  it("citation guard strips a part number whose inline citation names a DIFFERENT catalog than the locked one", () => {
    // Sonnet copied a catalog-1 number with its original "(from catalog #1 ...)"
    // attribution out of history after re-locking to catalog 2. The guard must
    // strip it because the cited catalog (#1) != the locked catalog (#2).
    const reply =
      "Brake chamber: 264742300101 (from catalog #1 — SIGNA 2818.K). " +
      "Clutch disc: 264742300202 (from catalog #2 — LPK 2518).";
    const hits = [{ part_number: "264742300202", catalog_label: "catalog #2 — LPK 2518" }];
    const out = search.enforcePartCitations(reply, hits, "", new Set(["264742300202"]), 2);
    expect(out).not.toContain("264742300101"); // foreign (catalog #1) stripped
    expect(out).toContain("264742300202");     // locked-catalog number kept
  });

  it("citation guard keeps a number whose cited catalog matches the locked one (no false strip)", () => {
    const reply = "Clutch disc: 264742300101 (from catalog #1 — SIGNA 2818.K).";
    const hits = [{ part_number: "264742300101", catalog_label: "catalog #1 — SIGNA 2818.K" }];
    const out = search.enforcePartCitations(reply, hits, "", new Set(["264742300101"]), 1);
    expect(out).toContain("264742300101");
  });
});

describe("R27.24a9 — gap 3: parts cart memory", () => {
  it("'aur clutch bhi chahiye' on a non-empty cart appends only the clutch and grows the cart", async () => {
    const sid = "a9-cart-append";
    // Fill the cart with a 3-part list (no clutch).
    await simulateChatMessage("oil filter aur air filter aur fuel filter chahiye", { sessionId: sid, lockedCatalogId: 1 });
    const cartAfterList = partsetu.getCart(sid, 1).length;
    expect(cartAfterList).toBeGreaterThan(0);
    // Append a single part.
    const r = await simulateChatMessage("aur clutch bhi chahiye", { sessionId: sid, lockedCatalogId: 1 });
    expect(r.isPartsAppend).toBe(true);
    expect(r.intent.kind).not.toBe("multi_part_list"); // narrowed to one part
    expect(r.searchResult.hits.some((h) => /CLUTCH/i.test(h.description))).toBe(true);
    expect(r.cartCount).toBeGreaterThanOrEqual(cartAfterList);
  });

  it("the cart is archived on re-lock to a different catalog", async () => {
    const sid = "a9-cart-archive";
    await simulateChatMessage("oil filter aur air filter aur fuel filter chahiye", { sessionId: sid, lockedCatalogId: 1 });
    const priorItems = partsetu.getCart(sid, 1).length;
    expect(priorItems).toBeGreaterThan(0);
    const relock = await simulateChatMessage("mera chassis 802502 hai", { sessionId: sid, lockedCatalogId: 1 });
    expect(relock.vehicleRelocked).toBe(true);
    expect(relock.catalogId).toBe(2);
    expect(relock.relockArchivedItems).toBe(priorItems);
    expect(partsetu.getCart(sid, 1).length).toBe(0); // prior catalog's cart gone
  });
});

describe("R27.24a9 — gap 4: part-name disambiguation reply routing", () => {
  it("a bare 'clutch' offers multiple options; reply '2' resolves to the second", async () => {
    const sid = "a9-part-disambig";
    const arm = await simulateChatMessage("clutch", { sessionId: sid, lockedCatalogId: 1 });
    expect(arm.partNeedsDisambiguation).toBe(true);
    expect(arm.partOptionsCount).toBeGreaterThanOrEqual(2);
    expect(partsetu.getPendingPartDisambiguation(sid)).not.toBeNull();
    const r = await simulateChatMessage("2", { sessionId: sid, lockedCatalogId: 1 });
    expect(r.partDisambiguationResolved).toBe(true);
    expect(r.selectedPartIndex).toBe(2);
    expect(partsetu.getPendingPartDisambiguation(sid)).toBeNull();
  });

  it("pasting back a candidate part name resolves to that option", async () => {
    const sid = "a9-part-pasteback";
    await simulateChatMessage("clutch", { sessionId: sid, lockedCatalogId: 1 });
    const pending = partsetu.getPendingPartDisambiguation(sid);
    expect(pending).not.toBeNull();
    const target = pending!.candidates[1] as any; // paste back option 2's name
    const r = await simulateChatMessage(target.part_name, { sessionId: sid, lockedCatalogId: 1 });
    expect(r.partDisambiguationResolved).toBe(true);
    expect(r.selectedPartOem).toBe(target.oem_number);
  });
});

describe("R27.24a9 — gap 5: deliberate re-lock", () => {
  it("a same-catalog high-confidence UVI is a no-op (no re-lock)", async () => {
    const sid = "a9-noop";
    const r = await simulateChatMessage("mera chassis 505409 hai", { sessionId: sid, lockedCatalogId: 1 });
    expect(r.sameCatalogNoOp).toBe(true);
    expect(r.vehicleRelocked).toBe(false);
    expect(r.catalogId).toBe(1);
  });

  it("a different-catalog UVI triggers the full re-lock purge", async () => {
    const sid = "a9-relock-purge";
    // Seed a pending part-disambig + cart, then re-lock to a different catalog.
    await simulateChatMessage("clutch", { sessionId: sid, lockedCatalogId: 1 });
    expect(partsetu.getPendingPartDisambiguation(sid)).not.toBeNull();
    const r = await simulateChatMessage("mera chassis 567059 hai", { sessionId: sid, lockedCatalogId: 1 });
    expect(r.vehicleRelocked).toBe(true);
    expect(r.catalogId).toBe(5);
    expect(partsetu.getPendingPartDisambiguation(sid)).toBeNull(); // cleared on re-lock
  });
});
