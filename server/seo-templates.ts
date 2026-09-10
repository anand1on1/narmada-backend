// =========================================================================
// R28 Session 4 — SEO Product Pages: HTML template functions (SSR)
// -------------------------------------------------------------------------
// Small, dependency-free template-literal renderers. No React SSR. Every
// output is a full HTML5 document with title/meta/OG/Twitter/JSON-LD, a
// mobile-first inline critical CSS block (~2KB) and a WhatsApp CTA.
//
// Verbatim user requirements enforced here:
//   * "EACH PRODUCT CREATED BY EXCEL UPLOAD OF THE CHASIS CREATES A SEPARATE
//      PAGE WHICH FOLLOWS LATEST GOOGLE SEO NORMS"
//   * "start writing the full scope and this time things has to go mobile
//      responsive"  (mobile-first CSS)
//   * "* Image is for representation purpose only" — disclaimer shown verbatim
//      under the image when image_source is 'placeholder' or 'generated'.
//
// Hard constraints:
//   * NEVER render purchase_price on any public page.
//   * All external URLs must be absolute (canonical, OG, JSON-LD).
//   * Mobile-first CSS, no external stylesheet.
// =========================================================================

export interface SeoConfig {
  baseUrl: string;            // e.g. https://narmadamobility.com
  siteName?: string;          // "Narmada Mobility"
  whatsappNumber?: string;    // e.g. "917909083806" (no + prefix, no dashes)
  spaBase?: string;           // e.g. https://narmadamobility.com (for hash-route link back)
}

export interface SeoProduct {
  id: number;
  slug: string;
  name: string;
  brand: string;
  model?: string | null;
  category: string;
  partNumber?: string | null;
  oemNumber?: string | null;
  description: string;
  shortDescription?: string | null;
  priceInr: number;                 // sell price (never purchase_price)
  stockQty?: number | null;
  imageUrls?: string[] | string;    // JSON array or already-parsed
  compatibleModels?: string[] | string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  imageSource?: string | null;      // 'generated' | 'placeholder' | 'reused' | 'manual-upload' | null
  createdAt?: number;
}

export interface SeoChassis {
  id: number;
  slug: string;
  chassisCode: string;
  chassisDisplayName: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  coverImageUrl?: string | null;
  description?: string | null;
}

export interface SeoChassisPart {
  id: number;
  partNumber: string;
  oemNumber?: string | null;
  description: string;
  category?: string | null;
  sellPrice?: number | null;
  productSlug?: string | null;      // link to /p/<slug> if published
}

// ---------- helpers ----------
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function attr(s: unknown): string { return esc(s); }
function jsonSafe(v: unknown): string {
  // Safe for embedding inside <script type="application/ld+json"> — escape </
  return JSON.stringify(v).replace(/</g, "\\u003c");
}
function parseImageUrls(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter((x) => typeof x === "string") : []; }
    catch { return v.trim() ? [v.trim()] : []; }
  }
  return [];
}
function absUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  if (/^https?:\/\//i.test(path)) return path;
  return b + (path.startsWith("/") ? path : "/" + path);
}
function fmtInr(n: number): string {
  // Format 12345.6 => "12,346" using Indian numbering
  const round = Math.round(n);
  const s = String(round);
  // Indian numbering: last 3 digits, then groups of 2
  const last3 = s.slice(-3);
  const rest  = s.slice(0, -3);
  if (!rest) return last3;
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}
function shortDesc(p: SeoProduct, maxLen = 155): string {
  const raw = (p.shortDescription || p.description || "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen - 1).trimEnd() + "…";
}
function buildTitle(p: SeoProduct, siteName: string): string {
  if (p.metaTitle) return p.metaTitle;
  const parts = [p.name, p.partNumber, p.brand?.toUpperCase()].filter(Boolean);
  return `${parts.join(" — ")} | ${siteName}`;
}
function buildKeywords(p: SeoProduct): string {
  if (p.metaKeywords) return p.metaKeywords;
  const kws = new Set<string>();
  if (p.brand) kws.add(p.brand);
  if (p.category) kws.add(p.category);
  if (p.partNumber) kws.add(p.partNumber);
  if (p.oemNumber) kws.add(p.oemNumber);
  if (p.model) kws.add(p.model);
  const compat = typeof p.compatibleModels === "string"
    ? (() => { try { return JSON.parse(p.compatibleModels as string) as string[]; } catch { return []; } })()
    : (p.compatibleModels || []);
  for (const m of compat) if (typeof m === "string") kws.add(m);
  kws.add("spare parts");
  kws.add("truck spare parts India");
  return Array.from(kws).slice(0, 15).join(", ");
}

// ---------- mobile-first critical CSS (~2KB) ----------
// Purposefully inline. No external stylesheet — bots + slow mobile connections
// get one round-trip. All layout is a single-column mobile-first grid; the
// desktop breakpoint kicks in at 720px.
export const CRITICAL_CSS = `
  *,*::before,*::after{box-sizing:border-box}
  html{font-size:16px;-webkit-text-size-adjust:100%}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#111;background:#fff;line-height:1.55}
  a{color:#0a58ca;text-decoration:none}
  a:hover{text-decoration:underline}
  img{max-width:100%;height:auto;display:block}
  .container{max-width:960px;margin:0 auto;padding:16px}
  header.site{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee;background:#fff;position:sticky;top:0;z-index:10}
  header.site .brand{font-weight:700;font-size:1.05rem;color:#111}
  header.site nav a{margin-left:12px;font-size:.9rem;color:#333}
  h1{font-size:1.5rem;margin:.25rem 0 .5rem;line-height:1.25}
  h2{font-size:1.15rem;margin:1.5rem 0 .5rem;line-height:1.3;border-bottom:1px solid #eee;padding-bottom:.25rem}
  h3{font-size:1rem;margin:1rem 0 .35rem}
  .breadcrumb{font-size:.85rem;color:#555;margin:.5rem 0 1rem}
  .breadcrumb a{color:#555}
  .card{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:12px;background:#fff}
  .product{display:grid;grid-template-columns:1fr;gap:16px}
  .price{font-size:1.5rem;font-weight:700;color:#0a58ca;margin:.25rem 0}
  .stock-in{color:#0a7c2f;font-weight:600}
  .stock-out{color:#a30000;font-weight:600}
  .disclaimer{font-size:.8rem;color:#7a5a00;background:#fff8e1;border:1px solid #f5e2a0;border-radius:4px;padding:6px 10px;margin:8px 0}
  .btn{display:inline-block;padding:10px 16px;border-radius:6px;font-weight:600;font-size:1rem;line-height:1.2;text-align:center;border:1px solid transparent;cursor:pointer;min-height:44px}
  .btn-primary{background:#0a58ca;color:#fff;border-color:#0a58ca}
  .btn-primary:hover{background:#084ba7;text-decoration:none;color:#fff}
  .btn-wa{background:#25d366;color:#fff;border-color:#25d366}
  .btn-wa:hover{background:#1eb655;text-decoration:none;color:#fff}
  .btn-ghost{background:#fff;color:#0a58ca;border-color:#0a58ca}
  .cta-row{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
  .cta-row .btn{flex:1 1 auto;min-width:140px}
  table.spec{width:100%;border-collapse:collapse;margin:.5rem 0 1rem}
  table.spec th,table.spec td{border:1px solid #e5e5e5;padding:8px 10px;font-size:.92rem;text-align:left;vertical-align:top}
  table.spec th{background:#f5f7fb;font-weight:600;width:40%}
  .related-grid{display:grid;grid-template-columns:1fr;gap:12px}
  .related-item{border:1px solid #e5e5e5;border-radius:8px;padding:10px;background:#fff}
  .related-item .name{font-weight:600;margin:.3rem 0}
  .related-item .price{font-size:1.05rem}
  .parts-list{list-style:none;padding:0;margin:0}
  .parts-list li{border:1px solid #e5e5e5;border-radius:6px;padding:10px;margin-bottom:8px;background:#fff}
  .parts-list li .pn{font-weight:600}
  footer.site{border-top:1px solid #eee;margin-top:32px;padding:16px;text-align:center;font-size:.85rem;color:#666}
  @media (min-width:720px){
    .product{grid-template-columns:1fr 1fr;gap:24px}
    .related-grid{grid-template-columns:repeat(4,1fr)}
    h1{font-size:1.9rem}
    h2{font-size:1.35rem}
  }
  @media (prefers-reduced-motion:reduce){*{animation-duration:0s !important;transition-duration:0s !important}}
`.trim();

function renderHead(opts: {
  title: string;
  description: string;
  keywords?: string;
  canonical: string;
  ogImage?: string;
  ogType?: string;
  jsonLd?: unknown[];
  spaAlternate?: string;
}): string {
  const {
    title, description, keywords, canonical,
    ogImage, ogType = "website", jsonLd = [], spaAlternate,
  } = opts;
  const ogImageAbs = ogImage || "";
  const jsonLdBlocks = jsonLd
    .filter(Boolean)
    .map((obj) => `<script type="application/ld+json">${jsonSafe(obj)}</script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a58ca">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
${keywords ? `<meta name="keywords" content="${attr(keywords)}">` : ""}
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${attr(canonical)}">
${spaAlternate ? `<link rel="alternate" href="${attr(spaAlternate)}">` : ""}
<meta property="og:type" content="${attr(ogType)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${attr(canonical)}">
${ogImageAbs ? `<meta property="og:image" content="${attr(ogImageAbs)}">` : ""}
<meta property="og:site_name" content="Narmada Mobility">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(description)}">
${ogImageAbs ? `<meta name="twitter:image" content="${attr(ogImageAbs)}">` : ""}
<style>${CRITICAL_CSS}</style>
${jsonLdBlocks}
</head>`;
}

function renderHeader(cfg: SeoConfig): string {
  const site = cfg.siteName || "Narmada Mobility";
  return `<header class="site" role="banner">
  <a class="brand" href="${attr(cfg.baseUrl)}/">${esc(site)}</a>
  <nav aria-label="Primary">
    <a href="${attr(cfg.baseUrl)}/#/products">Products</a>
    <a href="${attr(cfg.baseUrl)}/#/contact">Contact</a>
  </nav>
</header>`;
}

function renderFooter(cfg: SeoConfig): string {
  const site = cfg.siteName || "Narmada Mobility";
  const year = new Date().getFullYear();
  return `<footer class="site" role="contentinfo">
  &copy; ${year} ${esc(site)}. All rights reserved.
  &middot; <a href="${attr(cfg.baseUrl)}/#/privacy">Privacy</a>
  &middot; <a href="${attr(cfg.baseUrl)}/#/contact">Contact</a>
</footer>`;
}

// ---------- Product page ----------
export function renderProductPage(
  product: SeoProduct,
  relatedProducts: SeoProduct[],
  cfg: SeoConfig,
): string {
  const site = cfg.siteName || "Narmada Mobility";
  const wa = cfg.whatsappNumber || "917909083806";
  const spaBase = cfg.spaBase || cfg.baseUrl;
  const images = parseImageUrls(product.imageUrls);
  const primaryImage = images[0];
  const primaryImageAbs = primaryImage ? absUrl(cfg.baseUrl, primaryImage) : "";
  const canonical = `${cfg.baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(product.slug)}`;
  const spaAlt    = `${spaBase.replace(/\/$/, "")}/#/product/${encodeURIComponent(product.partNumber || product.slug)}/${encodeURIComponent(product.slug)}`;
  const title    = buildTitle(product, site);
  const desc     = shortDesc(product);
  const keywords = buildKeywords(product);
  const showDisclaimer = (product.imageSource === "placeholder" || product.imageSource === "generated");
  const inStock = (product.stockQty ?? 0) > 0;
  const availability = inStock ? "https://schema.org/InStock" : "https://schema.org/PreOrder";
  const priceStr = product.priceInr.toFixed(2);

  const waMessage = encodeURIComponent(
    `Hi, I'm interested in ${product.name}${product.partNumber ? ` (Part No: ${product.partNumber})` : ""}. Please share availability & delivery details.`,
  );
  const waHref = `https://wa.me/${wa}?text=${waMessage}`;

  const productJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: desc,
    sku: product.partNumber || product.slug,
    brand: { "@type": "Brand", name: (product.brand || site).toUpperCase() },
    image: images.length ? images.map((u) => absUrl(cfg.baseUrl, u)) : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: priceStr,
      availability,
      url: canonical,
    },
  };
  if (product.category) (productJsonLd as any).category = product.category;
  if (product.oemNumber) (productJsonLd as any).mpn = product.oemNumber;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: cfg.baseUrl },
      { "@type": "ListItem", position: 2, name: "Products", item: `${cfg.baseUrl}/#/products` },
      { "@type": "ListItem", position: 3, name: product.category || "Category", item: `${cfg.baseUrl}/cat/${encodeURIComponent(product.category || "other")}` },
      { "@type": "ListItem", position: 4, name: product.name, item: canonical },
    ],
  };

  const head = renderHead({
    title, description: desc, keywords, canonical,
    ogImage: primaryImageAbs, ogType: "product",
    jsonLd: [productJsonLd, breadcrumbJsonLd],
    spaAlternate: spaAlt,
  });

  const imgBlock = primaryImageAbs
    ? `<img src="${attr(primaryImageAbs)}" alt="${attr(product.name)}" width="640" height="480" loading="eager" fetchpriority="high">`
    : `<div style="aspect-ratio:4/3;background:#f2f2f2;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#888">No image available</div>`;

  const specRows: string[] = [];
  const addRow = (k: string, v?: string | null) => { if (v) specRows.push(`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`); };
  addRow("Brand", product.brand?.toUpperCase());
  addRow("Category", product.category);
  addRow("Part Number", product.partNumber || undefined);
  addRow("OEM Number", product.oemNumber || undefined);
  addRow("Model", product.model || undefined);
  const compat = typeof product.compatibleModels === "string"
    ? (() => { try { return JSON.parse(product.compatibleModels as string) as string[]; } catch { return []; } })()
    : (product.compatibleModels || []);
  if (Array.isArray(compat) && compat.length) addRow("Compatible Models", compat.join(", "));

  const relatedHtml = relatedProducts.length
    ? `<section aria-labelledby="related-h"><h2 id="related-h">Related products</h2>
       <div class="related-grid">
         ${relatedProducts.map((r) => {
           const rImgs = parseImageUrls(r.imageUrls);
           const rImg  = rImgs[0] ? absUrl(cfg.baseUrl, rImgs[0]) : "";
           const rHref = `${cfg.baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(r.slug)}`;
           return `<a class="related-item" href="${attr(rHref)}">
             ${rImg ? `<img src="${attr(rImg)}" alt="${attr(r.name)}" width="240" height="180" loading="lazy">` : ""}
             <div class="name">${esc(r.name)}</div>
             ${r.partNumber ? `<div style="font-size:.85rem;color:#555">P/N: ${esc(r.partNumber)}</div>` : ""}
             <div class="price">&#8377;${esc(fmtInr(r.priceInr))}</div>
           </a>`;
         }).join("\n")}
       </div>
     </section>`
    : "";

  const body = `<body>
${renderHeader(cfg)}
<main class="container" role="main">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="${attr(cfg.baseUrl)}/">Home</a> &raquo;
    <a href="${attr(cfg.baseUrl)}/#/products">Products</a> &raquo;
    <a href="${attr(cfg.baseUrl)}/cat/${attr(product.category || "other")}">${esc(product.category || "Category")}</a> &raquo;
    <span aria-current="page">${esc(product.name)}</span>
  </nav>

  <article class="product">
    <div class="media">
      ${imgBlock}
      ${showDisclaimer ? `<p class="disclaimer">* Image is for representation purpose only</p>` : ""}
    </div>
    <div class="info">
      <h1>${esc(product.name)}</h1>
      ${product.partNumber ? `<p style="color:#555;margin:.15rem 0">Part No: <strong>${esc(product.partNumber)}</strong></p>` : ""}
      <p class="price">&#8377;${esc(fmtInr(product.priceInr))} <span style="font-size:.85rem;color:#555;font-weight:400">(incl. GST as applicable)</span></p>
      <p>${inStock ? `<span class="stock-in">In stock</span>` : `<span class="stock-out">Made to order &middot; contact for lead time</span>`}</p>

      <div class="cta-row">
        <a class="btn btn-wa" href="${attr(waHref)}" rel="nofollow noopener" target="_blank">WhatsApp us to order</a>
        <a class="btn btn-primary" href="${attr(spaAlt)}">View on the app</a>
      </div>

      <h2>About this part</h2>
      <p>${esc(product.description)}</p>

      ${specRows.length ? `<h2>Specifications</h2><table class="spec"><tbody>${specRows.join("")}</tbody></table>` : ""}
    </div>
  </article>

  ${relatedHtml}

  <section aria-labelledby="cta-h" class="card" style="margin-top:24px">
    <h2 id="cta-h" style="border:0;margin-top:0">Need help finding the right part?</h2>
    <p>Chat with us on WhatsApp with your chassis number and we'll confirm fitment before you order.</p>
    <div class="cta-row">
      <a class="btn btn-wa" href="${attr(waHref)}" rel="nofollow noopener" target="_blank">Chat on WhatsApp</a>
      <a class="btn btn-ghost" href="${attr(cfg.baseUrl)}/#/contact">Contact form</a>
    </div>
  </section>
</main>
${renderFooter(cfg)}
</body>
</html>`;
  return `${head}\n${body}`;
}

// ---------- Chassis page ----------
export function renderChassisPage(
  chassis: SeoChassis,
  parts: SeoChassisPart[],
  cfg: SeoConfig,
): string {
  const site = cfg.siteName || "Narmada Mobility";
  const wa = cfg.whatsappNumber || "917909083806";
  const canonical = `${cfg.baseUrl.replace(/\/$/, "")}/c/${encodeURIComponent(chassis.slug)}`;
  const spaAlt    = `${cfg.baseUrl.replace(/\/$/, "")}/#/chassis/${encodeURIComponent(chassis.slug)}`;
  const title  = `${chassis.chassisDisplayName} spare parts catalogue | ${site}`;
  const desc   = (chassis.description || `Genuine and OE-grade spare parts for ${chassis.chassisDisplayName}. Browse ${parts.length} verified part numbers with fast dispatch and WhatsApp support.`).slice(0, 155);
  const kws    = [chassis.make, chassis.model, chassis.variant, chassis.chassisCode, "spare parts", "commercial vehicle parts"].filter(Boolean).join(", ");
  const image  = chassis.coverImageUrl ? absUrl(cfg.baseUrl, chassis.coverImageUrl) : "";
  const waMsg  = encodeURIComponent(`Hi, I need parts for ${chassis.chassisDisplayName} (${chassis.chassisCode}). Please advise.`);
  const waHref = `https://wa.me/${wa}?text=${waMsg}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: cfg.baseUrl },
      { "@type": "ListItem", position: 2, name: "Chassis catalogue", item: `${cfg.baseUrl}/#/parts-finder` },
      { "@type": "ListItem", position: 3, name: chassis.chassisDisplayName, item: canonical },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${chassis.chassisDisplayName} — parts list`,
    numberOfItems: parts.length,
    itemListElement: parts.slice(0, 100).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${p.partNumber} — ${p.description}`,
      url: p.productSlug ? `${cfg.baseUrl}/p/${encodeURIComponent(p.productSlug)}` : canonical,
    })),
  };

  const head = renderHead({
    title, description: desc, keywords: kws, canonical,
    ogImage: image, ogType: "website",
    jsonLd: [breadcrumbJsonLd, itemListJsonLd],
    spaAlternate: spaAlt,
  });

  const partsHtml = parts.length
    ? `<ul class="parts-list">${parts.map((p) => {
        const href = p.productSlug ? `${cfg.baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(p.productSlug)}` : "";
        return `<li>
          <div class="pn">${esc(p.partNumber)}${p.oemNumber ? ` <span style="color:#777;font-weight:400">(OEM ${esc(p.oemNumber)})</span>` : ""}</div>
          <div style="color:#333">${esc(p.description)}</div>
          ${p.category ? `<div style="font-size:.85rem;color:#666">Category: ${esc(p.category)}</div>` : ""}
          ${p.sellPrice != null ? `<div class="price" style="font-size:1.05rem">&#8377;${esc(fmtInr(p.sellPrice))}</div>` : ""}
          ${href ? `<a class="btn btn-ghost" href="${attr(href)}" style="margin-top:6px">View part page</a>` : ""}
        </li>`;
      }).join("\n")}</ul>`
    : `<p>No published parts for this chassis yet. WhatsApp us with your part number.</p>`;

  const body = `<body>
${renderHeader(cfg)}
<main class="container" role="main">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="${attr(cfg.baseUrl)}/">Home</a> &raquo;
    <a href="${attr(cfg.baseUrl)}/#/parts-finder">Chassis catalogue</a> &raquo;
    <span aria-current="page">${esc(chassis.chassisDisplayName)}</span>
  </nav>
  <h1>${esc(chassis.chassisDisplayName)} spare parts</h1>
  <p style="color:#555">${esc(chassis.description || `Verified spare parts for ${chassis.chassisDisplayName}. ${parts.length} SKUs available.`)}</p>

  <div class="cta-row">
    <a class="btn btn-wa" href="${attr(waHref)}" rel="nofollow noopener" target="_blank">WhatsApp our parts desk</a>
    <a class="btn btn-primary" href="${attr(spaAlt)}">Open on the app</a>
  </div>

  <h2>Parts for ${esc(chassis.chassisDisplayName)}</h2>
  ${partsHtml}
</main>
${renderFooter(cfg)}
</body>
</html>`;
  return `${head}\n${body}`;
}

// ---------- Category page ----------
export function renderCategoryPage(
  category: string,
  products: SeoProduct[],
  cfg: SeoConfig,
): string {
  const site = cfg.siteName || "Narmada Mobility";
  const wa = cfg.whatsappNumber || "917909083806";
  const canonical = `${cfg.baseUrl.replace(/\/$/, "")}/cat/${encodeURIComponent(category)}`;
  const spaAlt    = `${cfg.baseUrl.replace(/\/$/, "")}/#/category/${encodeURIComponent(category)}`;
  const label     = category.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const title  = `${label} — commercial vehicle spare parts | ${site}`;
  const desc   = `Browse ${products.length} ${label.toLowerCase()} spare parts for Indian commercial vehicles. Genuine + OE-grade, dispatched from Delhi.`.slice(0, 155);
  const kws    = [label, category, "spare parts", "truck spare parts", "commercial vehicle parts India"].join(", ");
  const waMsg  = encodeURIComponent(`Hi, I'm looking for ${label} spare parts. Please share your catalogue.`);
  const waHref = `https://wa.me/${wa}?text=${waMsg}`;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: cfg.baseUrl },
      { "@type": "ListItem", position: 2, name: "Products", item: `${cfg.baseUrl}/#/products` },
      { "@type": "ListItem", position: 3, name: label, item: canonical },
    ],
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} spare parts`,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 100).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
      url: `${cfg.baseUrl}/p/${encodeURIComponent(p.slug)}`,
    })),
  };

  const head = renderHead({
    title, description: desc, keywords: kws, canonical,
    ogType: "website",
    jsonLd: [breadcrumbJsonLd, itemListJsonLd],
    spaAlternate: spaAlt,
  });

  const grid = products.length
    ? `<div class="related-grid">${products.map((p) => {
        const imgs = parseImageUrls(p.imageUrls);
        const img  = imgs[0] ? absUrl(cfg.baseUrl, imgs[0]) : "";
        const href = `${cfg.baseUrl.replace(/\/$/, "")}/p/${encodeURIComponent(p.slug)}`;
        return `<a class="related-item" href="${attr(href)}">
          ${img ? `<img src="${attr(img)}" alt="${attr(p.name)}" width="240" height="180" loading="lazy">` : ""}
          <div class="name">${esc(p.name)}</div>
          ${p.partNumber ? `<div style="font-size:.85rem;color:#555">P/N: ${esc(p.partNumber)}</div>` : ""}
          <div class="price">&#8377;${esc(fmtInr(p.priceInr))}</div>
        </a>`;
      }).join("\n")}</div>`
    : `<p>No published parts in this category yet. WhatsApp us with your requirement.</p>`;

  const body = `<body>
${renderHeader(cfg)}
<main class="container" role="main">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="${attr(cfg.baseUrl)}/">Home</a> &raquo;
    <a href="${attr(cfg.baseUrl)}/#/products">Products</a> &raquo;
    <span aria-current="page">${esc(label)}</span>
  </nav>
  <h1>${esc(label)} spare parts</h1>
  <p style="color:#555">${esc(desc)}</p>

  <div class="cta-row">
    <a class="btn btn-wa" href="${attr(waHref)}" rel="nofollow noopener" target="_blank">WhatsApp our parts desk</a>
    <a class="btn btn-primary" href="${attr(spaAlt)}">Open on the app</a>
  </div>

  <h2>All ${esc(label)} parts</h2>
  ${grid}
</main>
${renderFooter(cfg)}
</body>
</html>`;
  return `${head}\n${body}`;
}

// ---------- 404 page (SEO-friendly) ----------
export function renderNotFoundPage(cfg: SeoConfig, kind: "product" | "chassis" | "category", slug: string): string {
  const canonical = `${cfg.baseUrl.replace(/\/$/, "")}/`;
  const head = renderHead({
    title: "Not found | Narmada Mobility",
    description: "The page you're looking for is not available.",
    canonical,
    jsonLd: [],
  }).replace('name="robots" content="index,follow,max-image-preview:large"', 'name="robots" content="noindex,follow"');
  const body = `<body>
${renderHeader(cfg)}
<main class="container" role="main">
  <h1>Page not found</h1>
  <p>We couldn't find a ${esc(kind)} page for "<strong>${esc(slug)}</strong>".</p>
  <p><a class="btn btn-primary" href="${attr(cfg.baseUrl)}/">Back to home</a></p>
</main>
${renderFooter(cfg)}
</body>
</html>`;
  return `${head}\n${body}`;
}

// ---------- Bot detection (exported for reuse in routes + tests) ----------
export const BOT_UA_PATTERNS = [
  "googlebot",
  "bingbot",
  "duckduckbot",
  "yandexbot",
  "baiduspider",
  "applebot",
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "whatsapp",
];
export function isBotUA(ua?: string | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return BOT_UA_PATTERNS.some((p) => lower.includes(p));
}
