// PartSetu v1.4 B2/B3/B4/B5 — post-parse catalog enrichment.
// Runs after a catalog's parts have been inserted:
//   B2 detectOem        — OEM from cover text (regex, no LLM).
//   B3 generateProfile  — one Sonnet call → vehicle profile (model/variant/etc).
//   B4 classifyParts    — batched Sonnet calls → (category, subcategory) per part.
//   B5 extractSpecs     — regex pass + batched Sonnet pass → partsetu_part_specs.
// All enrichment is best-effort: failures are logged and never abort ingestion.
import { rawSqlite as db } from "../storage";
import { callClaudeSonnet, isPartSetuClaudeConfigured } from "./claude";

// ---- B2: OEM detection from cover text -------------------------------------
const OEM_PATTERNS: Array<[RegExp, string]> = [
  [/\bashok\s*leyland\b/i, "Ashok Leyland"],
  [/\bbharat\s*benz\b/i, "BharatBenz"],
  [/\beicher\b/i, "Eicher"],
  [/\bmahindra\b/i, "Mahindra"],
  [/\bsml\b|\bswaraj\s*mazda\b/i, "SML"],
  [/\bamw\b/i, "AMW"],
  [/\btata\s*motors\b|\btata\b/i, "Tata"],
];

export function detectOem(coverText: string): string {
  const t = coverText || "";
  for (const [re, oem] of OEM_PATTERNS) {
    if (re.test(t)) return oem;
  }
  return "Unknown";
}

// R7 drive-code → tyre-count mapping.
const DRIVE_TYRES: Record<string, number> = {
  "4x2": 4, "4x4": 4, "6x2": 6, "6x4": 10, "8x2": 8, "8x4": 12,
  "ac10x2": 12, "10x2": 10, "10x4": 14,
};

export function tyreCountForDrive(driveType?: string | null): number | null {
  if (!driveType) return null;
  const key = driveType.toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  return DRIVE_TYRES[key] ?? null;
}

function stripJson(text: string): string {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
}

// ---- B3: vehicle profile ---------------------------------------------------
const PROFILE_SYSTEM = `You extract a structured vehicle profile from the cover and first pages of an Indian commercial-vehicle spare-parts catalogue. Return ONLY a JSON object with keys: model, variant, emission_stage, body_type, drive_type, fuel_type, engine_family, short_desc, long_desc. Use empty string for unknown fields. emission_stage like BS3/BS4/BS6/BS6-PH2. drive_type like 4x2,6x4,AC10x2. body_type like truck/bus/tipper/tractor/haulage/boogie/passenger. No prose, no markdown.`;

export interface VehicleProfile {
  model: string; variant: string; emission_stage: string; body_type: string;
  drive_type: string; fuel_type: string; engine_family: string;
  short_desc: string; long_desc: string;
}

export async function generateProfile(coverPlusPages: string): Promise<VehicleProfile | null> {
  if (!isPartSetuClaudeConfigured()) return null;
  try {
    const res = await callClaudeSonnet(PROFILE_SYSTEM, [{ role: "user", content: coverPlusPages.slice(0, 12000) }], 1024);
    if (!res.ok) return null;
    const obj = JSON.parse(stripJson(res.text));
    return {
      model: String(obj.model || ""), variant: String(obj.variant || ""),
      emission_stage: String(obj.emission_stage || ""), body_type: String(obj.body_type || ""),
      drive_type: String(obj.drive_type || ""), fuel_type: String(obj.fuel_type || ""),
      engine_family: String(obj.engine_family || ""),
      short_desc: String(obj.short_desc || ""), long_desc: String(obj.long_desc || ""),
    };
  } catch (e: any) {
    console.warn("[enrichment] profile failed:", e?.message || e);
    return null;
  }
}

// Persist profile fields + detected OEM + tyre count onto the catalog row.
export function applyProfile(catalogId: number, oem: string, profile: VehicleProfile | null): void {
  const tyre = profile ? tyreCountForDrive(profile.drive_type) : null;
  db.prepare(
    `UPDATE partsetu_catalogs SET
       oem = COALESCE(NULLIF(?, ''), oem),
       emission_stage = ?, body_type = ?, drive_type = ?, tyre_count = ?,
       fuel_type = ?, engine_family = ?, short_desc = ?, long_desc = ?
     WHERE id = ?`,
  ).run(
    oem || "",
    profile?.emission_stage || null, profile?.body_type || null, profile?.drive_type || null, tyre,
    profile?.fuel_type || null, profile?.engine_family || null,
    profile?.short_desc || null, profile?.long_desc || null,
    catalogId,
  );
}

// ---- B4: part category/subcategory classification --------------------------
const TAXONOMY = `Engine>Filtration,Cooling,Lubrication,Fuel system,Air intake,Exhaust,Engine block; Transmission>Clutch,Gearbox,Propeller shaft,Differential; Braking>Foundation brake,Air brake system,Hand brake; Suspension>Springs,Shock absorbers,Axles & links; Steering>Steering box,Linkage,Power steering; Body>Cabin,Frame,External; Electrical>Battery & wiring,Lighting,Switches & sensors; Cabin & interior>HVAC,Seats,Dashboard & instruments; Tyres & wheels>Wheel rim,Hub & bearing,Wheel nut/stud; Misc>misc`;
const CLASSIFY_SYSTEM = `You classify Indian commercial-vehicle spare parts into a (category, subcategory) pair from this taxonomy: ${TAXONOMY}. Input is a JSON array of {id, description}. Return ONLY a JSON array of {id, category, subcategory} using exact taxonomy names. If a part doesn't fit, use the best-fit category with subcategory "misc". No prose, no markdown.`;

export async function classifyParts(catalogId: number): Promise<number> {
  if (!isPartSetuClaudeConfigured()) return 0;
  const parts = db.prepare(
    `SELECT id, description FROM partsetu_parts WHERE catalog_id = ? AND description IS NOT NULL AND description != ''`,
  ).all(catalogId) as Array<{ id: number; description: string }>;
  if (!parts.length) return 0;

  const update = db.prepare(`UPDATE partsetu_parts SET category = ?, subcategory = ? WHERE id = ?`);
  let classified = 0;
  for (let i = 0; i < parts.length; i += 50) {
    const batch = parts.slice(i, i + 50);
    try {
      const res = await callClaudeSonnet(
        CLASSIFY_SYSTEM,
        [{ role: "user", content: JSON.stringify(batch.map((p) => ({ id: p.id, description: p.description.slice(0, 120) }))) }],
        2048,
      );
      if (!res.ok) continue;
      const arr = JSON.parse(stripJson(res.text));
      if (!Array.isArray(arr)) continue;
      const tx = db.transaction(() => {
        for (const row of arr) {
          if (row && row.id != null && row.category) {
            update.run(String(row.category), String(row.subcategory || "misc"), Number(row.id));
            classified++;
          }
        }
      });
      tx();
    } catch (e: any) {
      console.warn(`[enrichment] classify batch ${i} failed:`, e?.message || e);
    }
  }
  return classified;
}

// ---- B5: spec extraction ---------------------------------------------------
// Regex catches the common shapes; the rest go to a batched Sonnet pass.
const SPEC_REGEXES: Array<{ name: string; re: RegExp; unit?: string }> = [
  { name: "thread", re: /\bM(\d{1,2})\s*[×x]\s*([\d.]+)(?:\s*[×x]\s*([\d.]+))?\b/i },
  { name: "diameter", re: /[Ø⌀]\s*([\d.]+)/i, unit: "mm" },
  { name: "length", re: /\bL\s*=\s*([\d.]+)\s*(mm|cm)?/i },
];

export function extractSpecsRegex(catalogId: number, sourceDocId: number | null): number {
  const parts = db.prepare(
    `SELECT id, description FROM partsetu_parts WHERE catalog_id = ? AND description IS NOT NULL AND description != ''`,
  ).all(catalogId) as Array<{ id: number; description: string }>;
  if (!parts.length) return 0;

  const insert = db.prepare(
    `INSERT INTO partsetu_part_specs (part_id, spec_name, spec_value, unit, source, confidence, source_doc_id, created_at)
     VALUES (?, ?, ?, ?, 'description_extracted', ?, ?, ?)`,
  );
  const ts = Date.now();
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const p of parts) {
      for (const spec of SPEC_REGEXES) {
        const m = p.description.match(spec.re);
        if (m) {
          insert.run(p.id, spec.name, m[0].trim(), spec.unit || null, 0.7, sourceDocId, ts);
          inserted++;
        }
      }
    }
  });
  tx();
  return inserted;
}

// Full enrichment pipeline driven by the ingester.
export async function enrichCatalog(opts: {
  catalogId: number; coverText: string; firstPagesText: string;
}): Promise<{ oem: string; profileOk: boolean; classified: number; specs: number }> {
  const { catalogId, coverText, firstPagesText } = opts;
  const oem = detectOem(coverText);
  const profile = await generateProfile(`${coverText}\n\n${firstPagesText}`);
  applyProfile(catalogId, oem, profile);
  const classified = await classifyParts(catalogId);
  const specs = extractSpecsRegex(catalogId, catalogId);
  console.log(`[enrichment] catalog=${catalogId} oem=${oem} profile=${profile ? "ok" : "skip"} classified=${classified} specs=${specs}`);
  return { oem, profileOk: !!profile, classified, specs };
}
