// R28 Frontend — shared utilities for the Session-1..4 pages.
// Kept as a small standalone module to avoid touching the existing helpers.

import { toast } from "@/hooks/use-toast";

/** Public site host used to build shareable SEO links (matches Session 4 SSR routes). */
export const PUBLIC_SITE_HOST = "https://narmadamobility.com";

/** Copy a string to the clipboard and show a toast. Never throws. */
export async function copyToClipboardWithToast(
  text: string,
  successMessage = "Link copied to clipboard",
): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (typeof document !== "undefined") {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast({ title: successMessage, description: text });
    return true;
  } catch (err: any) {
    toast({ title: "Copy failed", description: err?.message || String(err), variant: "destructive" });
    return false;
  }
}

/** SEO product share URL — proxied to the backend SSR page by the .htaccess mod_proxy block. */
export function productSeoUrl(slug: string): string {
  return `${PUBLIC_SITE_HOST}/p/${encodeURIComponent(slug)}`;
}

/** SEO chassis share URL. */
export function chassisSeoUrl(slug: string): string {
  // R28.11 — was /c/{slug} (SSR route on backend, gated by SEO_PAGES_ENABLED
  // and unreachable on GoDaddy static host). Switched to /chassis/{slug} which
  // matches the SPA route in App.tsx and works via the .htaccess SPA fallback.
  return `${PUBLIC_SITE_HOST}/chassis/${encodeURIComponent(slug)}`;
}

/** SEO category share URL. */
export function categorySeoUrl(slug: string): string {
  return `${PUBLIC_SITE_HOST}/cat/${encodeURIComponent(slug)}`;
}

/** Detect whether a Session 1..4 image should carry the "for representation" caption. */
export function isRepresentationalImage(imageSource: string | null | undefined): boolean {
  const s = String(imageSource || "").toLowerCase();
  return s === "generated" || s === "placeholder" || s === "reused";
}

/** Format a rupee amount (safe for null / string / negative). */
export function formatINR(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString("en-IN")}`;
  }
}

/** Format a millisecond timestamp as a short YYYY-MM-DD HH:mm string. */
export function formatTs(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whether an HTTP-error message (from apiRequest) is a 503 feature_disabled response. */
export function isFeatureDisabledError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "string" ? err : (err as any)?.message || "";
  return /^503:/.test(msg) || /feature_disabled/i.test(msg);
}

/** Whether an HTTP-error message is a 429 rate-limit response. */
export function isRateLimitedError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "string" ? err : (err as any)?.message || "";
  return /^429:/.test(msg) || /rate_limited/i.test(msg);
}

/** Build a WhatsApp deep link (E.164 number without leading +). */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
export const NARMADA_WA_NUMBER = "917909083806";
