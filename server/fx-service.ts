/**
 * FX Rate service — Session C
 * Fetches exchange rates from exchangerate.host with 1-hour cache in DB.
 * GET https://api.exchangerate.host/convert?from=INR&to=USD
 */
import { db } from "./storage";
import { fxRates } from "@shared/schema";
import { and, eq, gte } from "drizzle-orm";

const FX_API_URL = process.env.FX_API_URL || "https://api.exchangerate.host/live";
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get FX rate from `from` currency to `to` currency.
 * Checks DB cache first; fetches from exchangerate.host if stale.
 * Returns 1 for same currency. Returns null if unavailable.
 */
export async function getFXRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;

  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  // Check cache
  const cacheFrom = Date.now() - FX_CACHE_TTL_MS;
  const cached = db
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.baseCurrency, fromUpper),
        eq(fxRates.targetCurrency, toUpper),
        gte(fxRates.fetchedAt, cacheFrom),
      ),
    )
    .get();

  if (cached) {
    return cached.rate;
  }

  // Fetch fresh rate
  const rate = await fetchRateFromApi(fromUpper, toUpper);
  if (rate !== null) {
    // Store in cache
    try {
      db.insert(fxRates)
        .values({
          baseCurrency: fromUpper,
          targetCurrency: toUpper,
          rate,
          fetchedAt: Date.now(),
        })
        .run();
    } catch (e: any) {
      console.error("[fx] cache write error:", e?.message);
    }
  }

  return rate;
}

async function fetchRateFromApi(from: string, to: string): Promise<number | null> {
  try {
    // exchangerate.host /convert endpoint
    const convertUrl = `https://api.exchangerate.host/convert?from=${from}&to=${to}&amount=1`;
    const res = await fetch(convertUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = await res.json() as any;
      if (data?.result && typeof data.result === "number") {
        return data.result;
      }
      // Some versions return info.rate
      if (data?.info?.rate && typeof data.info.rate === "number") {
        return data.info.rate;
      }
    }

    // Fallback: try /live endpoint (returns base=USD quotes)
    const liveUrl = `${FX_API_URL}?base=${from}&symbols=${to}`;
    const res2 = await fetch(liveUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res2.ok) {
      const data2 = await res2.json() as any;
      const quotes = data2?.quotes || data2?.rates || {};
      // quotes may be keyed as "USDINR" or just "INR" depending on endpoint
      const key1 = `${from}${to}`;
      const key2 = to;
      const rate = quotes[key1] ?? quotes[key2];
      if (typeof rate === "number") return rate;
    }

    console.warn(`[fx] Could not fetch rate for ${from}→${to}`);
    return null;
  } catch (e: any) {
    console.error("[fx] fetchRateFromApi error:", e?.message);
    return null;
  }
}

/**
 * Get current status of FX service for health check
 */
export async function fxHealthCheck(): Promise<{ ok: boolean; cached: number }> {
  try {
    const oneHourAgo = Date.now() - FX_CACHE_TTL_MS;
    const count = db
      .select()
      .from(fxRates)
      .where(gte(fxRates.fetchedAt, oneHourAgo))
      .all().length;
    return { ok: true, cached: count };
  } catch {
    return { ok: false, cached: 0 };
  }
}
