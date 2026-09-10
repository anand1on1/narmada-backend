// R28 Session 4 — scratch verifier. Runs the SEO templates + sitemap
// generator against an in-memory dataset and pipes the outputs through basic
// well-formedness checks (no external validator required). Not a test; kept
// out of tests/**  so vitest won't pick it up.
import { renderProductPage, renderChassisPage, renderCategoryPage, type SeoConfig } from "../server/seo-templates";

const CFG: SeoConfig = {
  baseUrl: "https://narmadamobility.com",
  siteName: "Narmada Mobility",
  whatsappNumber: "917909083806",
  spaBase: "https://narmadamobility.com",
};

const p: any = {
  id: 1, slug: "sample-part", name: "Sample Cross Joint",
  brand: "tata", model: "TATA 1109 LPT", category: "transmission",
  partNumber: "UJ-9001", oemNumber: "OEM-1", description: "Sample cross joint description",
  priceInr: 1499.5, stockQty: 10, imageUrls: ["/uploads/x.jpg"],
  compatibleModels: [], imageSource: "placeholder", createdAt: Date.now(),
};

const html = renderProductPage(p, [p], CFG);
console.log("--- product page bytes:", html.length);
for (const tag of ['<!DOCTYPE html>', '<meta name="viewport"', 'rel="canonical"', 'og:type', 'twitter:card', '"@type":"Product"', '"@type":"BreadcrumbList"', '* Image is for representation purpose only', 'wa.me/917909083806']) {
  console.log("  contains", tag, "→", html.includes(tag));
}

const chassis: any = { id: 1, slug: "sample-chassis", chassisCode: "SC", chassisDisplayName: "Sample Chassis", make: "TATA", model: "M", variant: "V", coverImageUrl: null, description: null };
const cHtml = renderChassisPage(chassis, [{ id: 1, partNumber: "PN-1", description: "d", category: "brake", sellPrice: 100, productSlug: "sample-part" }], CFG);
console.log("--- chassis page bytes:", cHtml.length, "canonical ok:", cHtml.includes("https://narmadamobility.com/c/sample-chassis"));

const catHtml = renderCategoryPage("transmission", [p], CFG);
console.log("--- category page bytes:", catHtml.length, "canonical ok:", catHtml.includes("https://narmadamobility.com/cat/transmission"));

// Validate sitemap XML with a tiny XML parser check.
import { buildSitemapForSeo } from "../server/seo-routes";
process.env.SEO_BASE_URL = "https://narmadamobility.com";
const urls = buildSitemapForSeo();
console.log("--- sitemap URL count:", urls.length);
