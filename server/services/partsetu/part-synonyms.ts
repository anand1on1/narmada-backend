// PartSetu AI R27.24a5 — hand-curated synonym map for common commercial-vehicle
// parts. OEM catalogue descriptions rarely use the customer's words: a customer
// types "oil filter" but the row reads "FILTER ASSY,LUB OIL". Each key is the
// customer-facing name; the value lists OEM-style phrasings we expand the
// search to. This is deliberately conservative — extend it as failed queries
// surface in the [partsetu] subsearch logs.
export const PART_SYNONYMS: Record<string, string[]> = {
  // Filters
  "oil filter": ["oil filter", "filter oil", "lub oil filter", "lube oil filter", "cartridge oil", "filter assy lub", "lub filter", "lubricating filter", "engine oil filter"],
  "fuel filter": ["fuel filter", "filter fuel", "diesel filter", "cartridge fuel", "fuel water separator", "pre filter fuel"],
  "air filter": ["air filter", "air cleaner", "element air", "air element", "cartridge air", "air filter element"],
  "cabin filter": ["cabin filter", "pollen filter", "ac filter", "cabin air"],

  // Engine / Clutch
  "clutch plate": ["clutch plate", "clutch disc", "clutch driven", "driven plate", "clutch lining"],
  "pressure plate": ["pressure plate", "clutch cover", "cover clutch", "clutch cover assembly"],
  "clutch release bearing": ["release bearing", "thrust bearing", "throwout bearing", "clutch bearing"],

  // Brakes
  "brake shoe": ["brake shoe", "shoe brake", "brake lining shoe", "rear brake shoe", "front brake shoe"],
  "brake lining": ["brake lining", "lining brake", "brake friction", "brake pad"],
  "brake pad": ["brake pad", "pad brake", "disc pad", "disc brake pad"],
  "brake drum": ["brake drum", "drum brake"],
  "brake disc": ["brake disc", "disc brake", "brake rotor"],

  // Belts & Hoses
  "radiator hose": ["radiator hose", "hose radiator", "upper hose", "lower hose", "coolant hose", "thermostat hose"],
  "alternator belt": ["alternator belt", "fan belt", "v belt", "drive belt", "serpentine belt", "auxiliary belt"],
  "timing belt": ["timing belt", "cam belt", "timing chain"],

  // Electrical
  "starter motor": ["starter motor", "self starter", "starter assembly", "starting motor"],
  "alternator": ["alternator", "generator", "charging alternator"],
  "battery": ["battery", "storage battery", "lead acid battery", "truck battery"],
  "spark plug": ["spark plug", "plug spark", "ignition plug", "cng spark plug"],
  "glow plug": ["glow plug", "heater plug"],
  "horn": ["horn", "electric horn", "air horn"],
  "wiper blade": ["wiper blade", "blade wiper", "windshield wiper"],
  "headlamp": ["headlamp", "head light", "headlight", "main beam"],
  "tail lamp": ["tail lamp", "tail light", "rear lamp", "taillight"],

  // Suspension
  "shock absorber": ["shock absorber", "shocker", "damper", "suspension strut"],
  "leaf spring": ["leaf spring", "spring leaf", "main leaf"],

  // Engine internals
  "piston": ["piston", "piston assembly"],
  "piston ring": ["piston ring", "ring piston", "compression ring", "oil ring"],
  "cylinder head": ["cylinder head", "head cylinder", "head assembly"],
  "gasket": ["gasket", "sealing"],
  "head gasket": ["head gasket", "cylinder head gasket", "gasket cylinder head"],
  "oil pump": ["oil pump", "lubricating pump"],
  "water pump": ["water pump", "coolant pump"],
  "fuel pump": ["fuel pump", "diesel pump"],
  "injector": ["injector", "fuel injector", "nozzle"],

  // Drivetrain
  "propeller shaft": ["propeller shaft", "prop shaft", "cardan shaft", "drive shaft"],
  "axle shaft": ["axle shaft", "half shaft", "rear axle shaft"],
  "cv joint": ["cv joint", "constant velocity", "cv boot"],
  "wheel bearing": ["wheel bearing", "hub bearing"],

  // Tyres / Wheels
  "tyre": ["tyre", "tire", "pneumatic"],
  "wheel rim": ["wheel rim", "rim wheel", "disc wheel"],
};

function norm(s: string): string {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

// Expand a customer part name to OEM-style synonym phrases (always includes the
// original). Resolution order: exact key → substring (either direction) → token
// overlap. Returns just [name] when nothing maps.
export function expandPartName(name: string): string[] {
  const n = norm(name);
  if (!n) return [];
  if (PART_SYNONYMS[n]) return dedupe([n, ...PART_SYNONYMS[n]]);
  for (const key of Object.keys(PART_SYNONYMS)) {
    if (n.includes(key) || key.includes(n)) return dedupe([n, key, ...PART_SYNONYMS[key]]);
  }
  const nTokens = new Set(n.split(" "));
  let best: string | null = null, bestScore = 0;
  for (const key of Object.keys(PART_SYNONYMS)) {
    const overlap = key.split(" ").filter((t) => nTokens.has(t)).length;
    if (overlap > bestScore) { bestScore = overlap; best = key; }
  }
  if (best && bestScore > 0) return dedupe([n, best, ...PART_SYNONYMS[best]]);
  return [n];
}

// Every individual word that appears anywhere in the map — used to decide
// whether a free-text segment names a part (multi-part-list detection).
export const PART_KEYWORDS: Set<string> = (() => {
  const s = new Set<string>();
  for (const [key, vals] of Object.entries(PART_SYNONYMS)) {
    for (const phrase of [key, ...vals]) {
      for (const w of phrase.split(" ")) if (w.length >= 2) s.add(w);
    }
  }
  return s;
})();
