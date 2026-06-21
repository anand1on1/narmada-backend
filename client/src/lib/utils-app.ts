// App-level utilities: currency conversion, slug helpers, SEO helpers.

export function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function fromSlug(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// R27.6 #5 — product detail href with the PART NUMBER FIRST so it is unmistakably
// present in the URL (the user reported URLs that were slug-only). Format:
//   /product/{partNumber}/{slug}   — e.g. /product/BR-9988/cartridge-oil-filter
// The page still loads the product by slug (last segment); the server also falls
// back to part-number lookup. Slug-only fallback when no part number exists.
export function productHref(product: { slug: string; partNumber?: string | null }): string {
  return product.partNumber
    ? `/product/${encodeURIComponent(product.partNumber)}/${product.slug}`
    : `/product/${product.slug}`;
}

export function formatUSD(inr: number, usdInr: number): string {
  const usd = inr / Math.max(usdInr, 0.0001);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);
}

export function formatINR(inr: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(inr);
}

export function whatsappLink(phone: string, message: string): string {
  // phone is national; the user gave 7909083806 (India). Prepend country code 91.
  const intl = phone.startsWith("+") ? phone.slice(1) : phone.length === 10 ? "91" + phone : phone;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function buildBuyMessage(product: { name: string; partNumber?: string | null; slug: string; brand: string }): string {
  // R27.7 #10 — share the part-number-first URL in WhatsApp enquiries too.
  const link = `https://narmadamobility.com/#${productHref({ slug: product.slug, partNumber: product.partNumber })}`;
  return `Hello Narmada Mobility, I'd like to enquire about:\n\n*${product.name}*${product.partNumber ? `\nPart No.: ${product.partNumber}` : ""}\nBrand: ${product.brand}\nLink: ${link}\n\nPlease share availability, price and delivery time.`;
}

export function setMeta(tagName: "title" | "description" | "keywords", value: string) {
  if (typeof document === "undefined") return;
  if (tagName === "title") { document.title = value; return; }
  let el = document.querySelector(`meta[name="${tagName}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement("meta"); el.setAttribute("name", tagName); document.head.appendChild(el); }
  el.setAttribute("content", value);
}

export function useSeo(title: string, description: string, keywords?: string) {
  if (typeof document !== "undefined") {
    setMeta("title", title);
    setMeta("description", description);
    if (keywords) setMeta("keywords", keywords);
  }
}

export function parseJsonArray(s?: string | null): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
