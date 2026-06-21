/**
 * FX Rate service.
 *
 * R27.6 #2 — The shop was permanently showing ₹83.5 because:
 *   (1) the previous provider (exchangerate.host/convert) now requires a paid
 *       access_key and returns {success:false, missing_access_key}, so every
 *       fetch returned null and silently fell back to the hardcoded 83.5; and
 *   (2) /api/settings/fx read a STATIC `usd_inr_rate` setting that nothing kept
 *       up to date.
 *
 * Fix: fetch from open.er-api.com (free, no key — verified returning
 * rates.INR ≈ 94.4), cache the value both in the fx_rates table and in the
 * `usd_inr_rate` setting so the public /api/settings/fx endpoint serves the
 * live number, log the source on every refresh, and refresh every 6h.
 */
import { db } from "./storage";
import { storage } from "./storage";
import { fxRates } from "@shared/schema";
import { and, eq, gte } from "drizzle-orm";

// Free, key-less provider. base=USD → rates.INR is USD→INR.
const ER_API_URL = "https://open.er-api.com/v6/latest/USD";
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour DB cache
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h background refresh
// Realistic recent fallback (was 83.5, which was months stale). Only used if
// the provider is unreachable AND we have no cached value at all.
const FALLBACK_USD_INR = 94.4;

let lastUsdInr: number | null = null;
let lastSource: "er-api" | "cache" | "fallback" = "fallback";

/** Raw USD→INR fetch from the live provider. Returns null on any failure. */
async function fetchUsdInr(): Promise<number | null> {
  try {
    const res = await fetch(ER_API_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (data?.result === "success" && data?.rates && typeof data.rates.INR === "number" && data.rates.INR > 0) {
      return data.rates.INR;
    }
    return null;
  } catch (e: any) {
    console.error("[fx] fetchUsdInr error:", e?.message);
    return null;
  }
}

/**
 * Fetch + persist the live USD→INR rate. Writes the fx_rates cache rows (both
 * directions) AND the `usd_inr_rate` setting that /api/settings/fx serves.
 * Logs the resolved value and its source. Safe to call repeatedly.
 */
export async function refreshFxRate(): Promise<number> {
  const live = await fetchUsdInr();
  let usdInr: number;
  if (live && live > 0) {
    usdInr = live;
    lastSource = "er-api";
  } else {
    // Provider down — prefer the last good DB/setting value over the constant.
    const cached = await readCachedUsdInr();
    if (cached && cached > 0) { usdInr = cached; lastSource = "cache"; }
    else { usdInr = FALLBACK_USD_INR; lastSource = "fallback"; }
  }
  lastUsdInr = usdInr;

  // Persist for both the public endpoint and the convert helper cache.
  try { await storage.setSetting("usd_inr_rate", String(usdInr)); } catch (e: any) { console.error("[fx] setSetting error:", e?.message); }
  try {
    const now = Date.now();
    db.insert(fxRates).values({ baseCurrency: "USD", targetCurrency: "INR", rate: usdInr, fetchedAt: now }).run();
    db.insert(fxRates).values({ baseCurrency: "INR", targetCurrency: "USD", rate: 1 / usdInr, fetchedAt: now }).run();
  } catch (e: any) { console.error("[fx] cache write error:", e?.message); }

  console.log(`[fx] USD→INR = ${usdInr} (source: ${lastSource})`);
  return usdInr;
}

async function readCachedUsdInr(): Promise<number | null> {
  try {
    const s = await storage.getSetting("usd_inr_rate");
    const n = s ? parseFloat(s) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

/**
 * Public accessor used by /api/settings/fx and the shop currency picker.
 * Returns the freshest known USD→INR, fetching live if the cache is stale.
 */
export async function getUsdInr(): Promise<{ usdInr: number; source: string }> {
  // Serve from the 1h DB cache if fresh; otherwise refresh.
  const cacheFrom = Date.now() - FX_CACHE_TTL_MS;
  const cached = db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.baseCurrency, "USD"), eq(fxRates.targetCurrency, "INR"), gte(fxRates.fetchedAt, cacheFrom)))
    .get();
  if (cached && cached.rate > 0) {
    lastUsdInr = cached.rate;
    return { usdInr: cached.rate, source: "cache" };
  }
  const usdInr = await refreshFxRate();
  return { usdInr, source: lastSource };
}

/**
 * Get FX rate from `from` currency to `to` currency (used by quotations + shop).
 * Built on the live USD↔INR pair. Returns 1 for same currency, null if unknown.
 */
export async function getFXRate(from: string, to: string): Promise<number | null> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  const { usdInr } = await getUsdInr();
  if (!usdInr || usdInr <= 0) return null;
  if (f === "USD" && t === "INR") return usdInr;
  if (f === "INR" && t === "USD") return 1 / usdInr;
  return null;
}

/** Start the 6h background refresh. Called once at boot. */
export function startFxAutoRefresh(): void {
  refreshFxRate().catch((e) => console.error("[fx] initial refresh failed:", e?.message));
  setInterval(() => { refreshFxRate().catch((e) => console.error("[fx] scheduled refresh failed:", e?.message)); }, REFRESH_INTERVAL_MS);
  console.log("[fx] auto-refresh started (every 6h)");
}

/** Health check for diagnostics. */
export async function fxHealthCheck(): Promise<{ ok: boolean; usdInr: number | null; source: string }> {
  try {
    const { usdInr, source } = await getUsdInr();
    return { ok: true, usdInr, source };
  } catch {
    return { ok: false, usdInr: lastUsdInr, source: lastSource };
  }
}
