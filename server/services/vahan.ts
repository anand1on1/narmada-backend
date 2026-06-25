// PartSetu R27.23 — VAHAN registration-lookup (provider-agnostic stub).
// Resolves an Indian vehicle registration number to its make/model/variant via
// a third-party VAHAN data provider (Surepass / IDfy / Karza). The integration
// is DEFERRED: the stub returns null until VAHAN_API_KEY + VAHAN_PROVIDER are
// set, at which point the live branch activates without any change to callers.
import { rawSqlite as db } from "../storage";

export interface VahanVehicle {
  registration_no: string;
  chassis_no?: string | null;
  engine_no?: string | null;
  oem?: string | null;            // maker / manufacturer
  model?: string | null;          // maker model
  variant?: string | null;
  fuel_type?: string | null;
  emission_stage?: string | null; // norms (BS4/BS6)
  manufactured?: string | null;   // month/year of manufacture
  raw?: any;                       // provider raw payload (kept for debugging)
}

const PROVIDER = process.env.VAHAN_PROVIDER || "";
const API_KEY = process.env.VAHAN_API_KEY || "";

export function isVahanConfigured(): boolean {
  return !!(API_KEY && PROVIDER);
}

function normalizeReg(regNo: string): string {
  return String(regNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Look up a registration number. Returns the vehicle details, or null when the
// provider is unconfigured (current default) or the lookup fails / has no data.
// Caller is expected to fall back to model-based resolution on null.
export async function lookupVahanByRegistration(regNo: string): Promise<VahanVehicle | null> {
  const reg = normalizeReg(regNo);
  if (reg.length < 6) return null;

  if (!isVahanConfigured()) {
    console.log(`[partsetu] resolve_registration=${reg} → vahan=DEFERRED (no API key)`);
    return null;
  }

  // A short-lived cache so repeated lookups for the same reg do not re-bill the
  // provider. Reuses the generic key/value cache table if present; non-fatal.
  try {
    const cached = db
      .prepare(`SELECT value FROM partsetu_vahan_cache WHERE registration_no = ? AND fetched_at > ?`)
      .get(reg, Date.now() - 30 * 24 * 60 * 60 * 1000) as any;
    if (cached?.value) return JSON.parse(cached.value) as VahanVehicle;
  } catch { /* cache table optional — ignore */ }

  try {
    const result = await callProvider(PROVIDER, reg);
    if (result) {
      try {
        db.prepare(
          `INSERT INTO partsetu_vahan_cache (registration_no, value, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(registration_no) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
        ).run(reg, JSON.stringify(result), Date.now());
      } catch { /* cache write optional */ }
    }
    return result;
  } catch (e: any) {
    console.warn(`[partsetu] resolve_registration=${reg} → vahan ERROR: ${e?.message || e}`);
    return null;
  }
}

// Provider dispatch. Each provider maps its response shape onto VahanVehicle.
// Left unimplemented (returns null) until a provider + key are wired; the
// branch names document the intended integration points.
async function callProvider(provider: string, reg: string): Promise<VahanVehicle | null> {
  switch (provider.toLowerCase()) {
    case "surepass":
    case "idfy":
    case "karza":
      // TODO(R27.24+): live HTTP call once VAHAN_API_KEY is provisioned. The
      // response is mapped to VahanVehicle here.
      console.log(`[partsetu] resolve_registration=${reg} → vahan=DEFERRED (provider=${provider} not yet implemented)`);
      return null;
    default:
      console.warn(`[partsetu] resolve_registration=${reg} → vahan: unknown provider "${provider}"`);
      return null;
  }
}
