// R27.1 — site-wide currency picker. Base prices are stored in INR; USD is derived
// from a live USD→INR rate (GET /api/public/currencies, daily/cached server-side).
// Selection persisted in localStorage (narmada_currency). Pub/sub mirrors cart.ts.
import { apiUrl } from "@/lib/queryClient";

export type Currency = "INR" | "USD";

const KEY = "narmada_currency";
const FALLBACK_USD_INR = 83.5;

type Listener = () => void;
const listeners = new Set<Listener>();

let usdInr = FALLBACK_USD_INR;
let loaded = false;

function readCurrency(): Currency {
  try {
    if (typeof window === "undefined") return "INR";
    const v = localStorage.getItem(KEY);
    return v === "USD" ? "USD" : "INR";
  } catch {
    return "INR";
  }
}

export function getCurrency(): Currency {
  return readCurrency();
}

export function setCurrency(c: Currency) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(KEY, c);
  } catch {}
  listeners.forEach((fn) => fn());
}

export function getUsdInr(): number {
  return usdInr;
}

export async function loadFxRate(): Promise<number> {
  if (loaded) return usdInr;
  try {
    const r = await fetch(apiUrl("/api/public/currencies"));
    if (r.ok) {
      const j = await r.json();
      const rate = j?.rates?.USD?.rate_inr;
      if (rate && Number(rate) > 0) usdInr = Number(rate);
    }
  } catch {
    /* keep fallback */
  }
  loaded = true;
  listeners.forEach((fn) => fn());
  return usdInr;
}

// Format an INR base amount in the currently selected currency.
export function formatPrice(inr: number, currency: Currency = getCurrency()): string {
  if (currency === "USD") {
    const usd = (Number(inr) || 0) / Math.max(usdInr, 0.0001);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(inr) || 0);
}

export function subscribeCurrency(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
