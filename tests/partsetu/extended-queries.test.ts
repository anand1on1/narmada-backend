// R27.24c — Extended part-query suite (200 interactions), distilled from
// PARTSETU-EXTENDED-TEST-SUITE.md PART 1. Exercises the multi-strategy search
// over the synonym-seeded catalog: FTS description match for part-name groups
// (locked to catalog 1, which carries one OEM-style row per canonical synonym),
// the deterministic multi-part-list splitter, spec extraction, and the
// bidirectional cross-reference walk. All deterministic — no live LLM.
import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, simulateChatMessage, search } from "../fixtures/partsetu-fixture";

beforeAll(() => { setupTestDb(); });

// Part-name groups are asked against the already-locked SIGNA catalog (#1),
// which seedRealisticParts populated with an OEM-style row for every canonical
// synonym. Each query token overlaps at least one seeded description token, so
// the FTS description strategy must return >=1 hit without leaving the lock.
const LOCK1 = { lockedCatalogId: 1 } as const;

function expectLockedHits(label: string, queries: string[]) {
  describe(label, () => {
    it.each(queries)("locked-catalog search '%s' returns parts", async (msg) => {
      const r = await simulateChatMessage(msg, LOCK1);
      expect(r.catalogId).toBe(1);
      expect(r.searchResult.hits.length).toBeGreaterThan(0);
    });
  });
}

// A. Filters (20)
expectLockedHits("A. Filters (20)", [
  "oil filter", "engine oil filter", "lub oil filter", "filter oil ka number",
  "fuel filter", "diesel filter", "fuel water separator filter", "fuel filter chahiye",
  "air filter", "air cleaner", "air filter element", "air filter dikhana",
  "cabin filter", "pollen filter", "ac filter", "cabin air filter",
  "oil filter for this truck", "fuel filter for this vehicle", "air cleaner element", "primary oil filter",
]);

// B. Brakes (20)
expectLockedHits("B. Brakes (20)", [
  "brake shoe", "rear brake shoe", "front brake shoe", "brake shoe set",
  "brake lining", "brake lining set", "brake friction lining", "brake lining ka number",
  "brake pad", "front brake pad", "rear brake pad", "disc brake pad",
  "brake drum", "rear brake drum", "front brake drum", "brake drum assembly",
  "brake disc", "front brake disc", "brake rotor disc", "brake disc chahiye",
]);

// C. Clutch (15)
expectLockedHits("C. Clutch (15)", [
  "clutch plate", "clutch disc", "clutch driven plate", "clutch plate 430",
  "pressure plate", "clutch cover", "clutch cover assembly", "pressure plate 430",
  "clutch release bearing", "release bearing", "clutch thrust bearing", "throwout clutch bearing",
  "clutch plate for this truck", "clutch disc assembly", "clutch cover plate",
]);

// D. Electrical (25)
expectLockedHits("D. Electrical (25)", [
  "starter motor", "self starter", "self starting motor", "starter assembly",
  "generator", "charging generator",
  "battery", "storage battery", "truck battery", "lead acid battery",
  "spark plug", "plug spark", "ignition plug", "cng spark plug",
  "glow plug", "heater plug",
  "horn", "electric horn", "air horn",
  "wiper blade", "windshield wiper",
  "head light", "head lamp",
  "tail light", "tail lamp",
]);

// E. Suspension (15)
expectLockedHits("E. Suspension (15)", [
  "shock absorber", "shocker", "front shock absorber", "rear shocker",
  "shock absorber assembly", "shocker for this truck",
  "leaf spring", "spring leaf", "main leaf spring", "rear leaf spring",
  "front leaf spring", "parabolic leaf spring", "leaf spring set", "spring leaf assembly",
  "suspension leaf spring",
]);

// F. Engine internals (25)
expectLockedHits("F. Engine internals (25)", [
  "piston", "piston assembly", "engine piston", "piston set",
  "piston ring", "ring piston", "compression ring", "oil ring",
  "cylinder head", "head cylinder", "cylinder head assembly",
  "head gasket", "cylinder head gasket", "head gasket set",
  "oil pump", "lubricating pump", "engine oil pump",
  "water pump", "coolant pump", "engine water pump",
  "fuel pump", "diesel pump",
  "injector", "fuel injector", "diesel injector",
]);

// G. Cooling (15)
expectLockedHits("G. Cooling (15)", [
  "radiator hose", "coolant hose", "upper radiator hose", "lower radiator hose",
  "thermostat hose", "cooling hose", "top hose", "bottom hose",
  "radiator", "radiator cap", "water pump", "coolant pump",
  "engine coolant pump", "coolant pipe hose", "radiator hose pipe",
]);

// H. Drivetrain (15)
expectLockedHits("H. Drivetrain (15)", [
  "propeller shaft", "prop shaft", "drive shaft", "cardan shaft",
  "axle shaft", "half shaft", "rear axle shaft", "front axle shaft",
  "constant velocity joint", "constant velocity shaft",
  "wheel bearing", "hub bearing", "wheel hub bearing",
  "propeller shaft assembly", "rear half shaft",
]);

// I. Tyres / Wheels (10)
expectLockedHits("I. Tyres / Wheels (10)", [
  "tire", "tire assembly", "pneumatic tire", "spare tire",
  "wheel rim", "rim wheel", "disc wheel", "steel wheel",
  "wheel disc", "spare wheel rim",
]);

// J. Multi-part lists (20) — 3+ comma/and-separated part names route to the
// deterministic multi_part_list intent; each is searched per-part inside the
// locked catalog, so at least one requested part resolves.
describe("J. Multi-part lists (20)", () => {
  const lists = [
    "oil filter, air filter, fuel filter",
    "brake shoe, brake drum, brake lining",
    "clutch plate, pressure plate, release bearing",
    "starter motor, alternator generator, battery",
    "piston, piston ring, cylinder head",
    "water pump, oil pump, fuel pump",
    "head light, tail light, horn",
    "radiator hose, coolant pump, thermostat hose",
    "propeller shaft, axle shaft, wheel bearing",
    "leaf spring, shock absorber, wheel bearing",
    "oil filter, fuel filter, air filter, cabin filter",
    "brake pad, brake disc, brake drum, brake shoe",
    "spark plug, glow plug, ignition plug",
    "wiper blade, head light, tail light",
    "clutch disc, clutch cover, release bearing",
    "injector, fuel pump, diesel filter",
    "piston ring, cylinder head, head gasket",
    "starter motor, battery, horn, head light",
    "water pump, radiator hose, coolant pump",
    "oil filter and air filter and fuel filter",
  ];
  it.each(lists)("multi-part '%s' splits and resolves per-part", async (msg) => {
    const r = await simulateChatMessage(msg, LOCK1);
    expect(r.intent.kind).toBe("multi_part_list");
    expect(r.searchResult.perPart?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect((r.searchResult.perPart || []).some((p) => p.parts.length > 0)).toBe(true);
  });
});

// K. Spec queries (10) — numeric/spec phrasing classifies as spec_query and the
// numeric spec is extracted deterministically (no LLM, no part number present).
describe("K. Spec queries (10)", () => {
  const cases = [
    "430 dia clutch", "352 dia clutch plate", "430 mm clutch disc",
    "24 volt starter motor", "12 volt battery", "clutch diameter kya hai",
    "kitne teeth ka gear", "bore size of piston", "diameter of flywheel",
    "voltage of alternator",
  ];
  it.each(cases)("spec phrasing '%s' classifies as spec_query", async (msg) => {
    const r = await simulateChatMessage(msg, LOCK1);
    expect(r.intent.kind).toBe("spec_query");
  });
});

// L. Cross-reference (10) — the bidirectional xref walk resolves the four pinned
// equivalences both ways; a bare OEM part number in chat classifies as a
// cross_reference_lookup that bypasses the catalog lock.
describe("L. Cross-reference (10)", () => {
  const pinned: Array<[string, string]> = [
    ["100251260", "264742300101"],
    ["0445120123", "252609110102"],
    ["0486202005", "277842300182"],
    ["S2120", "264742300202"],
  ];
  it.each(pinned)("xref %s resolves to OEM %s", async (aftermarket, oem) => {
    const resolved = search.resolveXref(aftermarket, 3).map((r) => r.partNumber);
    expect(resolved).toContain(oem);
  });

  const partNumbersInChat = [
    "264742300101", "252609110102", "277842300182", "264742300202", "253618140145", "407231100501",
  ];
  it.each(partNumbersInChat)("part number %s in chat is a cross_reference_lookup", async (pn) => {
    const r = await simulateChatMessage(`${pn} ka equivalent number do`, LOCK1);
    expect(r.intent.kind).toBe("cross_reference_lookup");
    expect(r.intent.bypassLock).toBe(true);
  });
});
