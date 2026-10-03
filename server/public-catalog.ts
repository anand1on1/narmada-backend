import type { Database } from "better-sqlite3";
import type { Express, RequestHandler } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PUBLIC_ORIGIN, productPath } from "../shared/public-urls";
import { escapeHtml as esc } from "./auto-blogger-safety";
import { renderProductPage, renderNotFoundPage, CRITICAL_CSS } from "./seo-templates";

const config = { baseUrl: PUBLIC_ORIGIN };
export const CORE_PATHS = ["/", "/products", "/about", "/contact", "/work-with-us", "/privacy", "/disclaimer", "/blog"];
export function canonicalSitemapEntries(products: any[], base = PUBLIC_ORIGIN): string[] {
  // Deliberately omit alias, gated category/chassis and mass geo landing pages.
  const paths = new Set([...CORE_PATHS, ...products.filter(p => p.active && p.slug).map(productPath)]);
  return Array.from(paths).map(p => `  <url><loc>${esc(base + p)}</loc></url>`);
}
export const sitemapXml = (entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;
export const publicRobots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /team/\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\nSitemap: ${PUBLIC_ORIGIN}/sitemap-blog.xml\n`;
export function catalogSitemap(db: Database) {
  return sitemapXml(canonicalSitemapEntries(db.prepare("SELECT slug,part_number,active FROM products WHERE active=1 ORDER BY id").all()));
}
// Embed real content in the existing app entry, not a bot-only page. React replaces
// this root on startup, retaining the current catalog/cart/design and admin workflows.
export function appHtml(html: string, entry?: string): string {
  if (!entry) { try { entry = readFileSync(resolve("dist/public/index.html"), "utf8"); } catch { return html; } }
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] || "";
  const metadata = head.match(/<title>[\s\S]*?<\/title>|<meta[^>]+(?:name="(?:description|robots|keywords)"|property="[^"]+")[^>]*>|<link rel="canonical"[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>/gi)?.join("\n") || "";
  const style = head.match(/<style>[\s\S]*?<\/style>/i)?.[0] || "";
  const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] || "";
  return entry.replace(/<title>[\s\S]*?<\/title>|<meta[^>]+(?:name="(?:description|robots|keywords)"|property="[^"]+")[^>]*>|<link rel="canonical"[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "")
    .replace("</head>", metadata + "\n</head>")
    .replace(/<div id="root"><\/div>/, `<div id="root">${style}${body}</div>`);
}
const columns = `id,slug,name,brand,model,category,part_number AS partNumber,oem_number AS oemNumber,
 description,short_description AS shortDescription,price_inr AS priceInr,stock_qty AS stockQty,
 image_urls AS imageUrls,compatible_models AS compatibleModels,meta_title AS metaTitle,meta_description AS metaDescription`;
export function registerPublicCatalog(app: Express, db: Database) {
  const notFound = (res: any) => res.status(404).set("X-Robots-Tag", "noindex").type("html")
    .send(renderNotFoundPage(config, "product", "not-found"));
  const product: RequestHandler = (req, res) => {
    res.set("Cache-Control", "no-store").set("X-Narmada-SEO", "R28.19");
    const a = String(req.params.a || ""), b = String(req.params.b || "");
    // A two-segment alias is accepted only if BOTH identifiers match the same row.
    // Never turn arbitrary /wrong/valid-slug pairs into a successful page.
    const row = db.prepare(`SELECT ${columns} FROM products WHERE active=1 AND ${
      b ? "((slug=? AND part_number=?) OR (slug=? AND part_number=?))" : "slug=?"
    } LIMIT 1`).get(...(b ? [b, a, a, b] : [a])) as any;
    if (!row) return notFound(res);
    const canonical = productPath(row);
    if (req.path !== canonical) return res.redirect(301, PUBLIC_ORIGIN + canonical);
    const related = db.prepare(`SELECT ${columns} FROM products WHERE active=1 AND category=? AND id!=? ORDER BY id DESC LIMIT 4`).all(row.category, row.id) as any[];
    try { row.imageSource = (db.prepare("SELECT image_source FROM auto_publish_log WHERE product_id=? ORDER BY id DESC LIMIT 1").get(row.id) as any)?.image_source; } catch { /* optional old install */ }
    return res.type("html").send(appHtml(renderProductPage(row, related, config)));
  };
  app.get(["/product/:a/:b", "/product/:a", "/p/:a"], product);
  app.use(/^\/(?:product|p)(?:\/|$)/, (_req, res) => notFound(res));
  app.get("/products", (req, res) => {
    const pageText = String(req.query.page || "1");
    if (!/^[1-9]\d{0,5}$/.test(pageText)) return notFound(res);
    const page = Number(pageText), limit = 24;
    const total = (db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get() as any).n;
    if (page > Math.max(1, Math.ceil(total / limit))) return notFound(res);
    const rows = db.prepare(`SELECT ${columns} FROM products WHERE active=1 ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, (page - 1) * limit) as any[];
    const path = `/products${page > 1 ? `?page=${page}` : ""}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Commercial vehicle parts${page > 1 ? ` — Page ${page}` : ""} | Narmada Mobility</title>
<meta name="description" content="Browse the Narmada Mobility parts catalog. Confirm fitment, price and availability before ordering.">
<meta name="robots" content="${Object.keys(req.query).some(k => k !== "page") ? "noindex,follow" : "index,follow"}">
<link rel="canonical" href="${PUBLIC_ORIGIN}${esc(path)}"><style>${CRITICAL_CSS}</style></head><body>
<header class="site"><a class="brand" href="${PUBLIC_ORIGIN}/">Narmada Mobility</a><nav><a href="/blog">Insights</a><a href="/contact">Contact</a></nav></header>
<main class="container"><h1>Commercial vehicle parts</h1><p>${total} catalog products. Confirm fitment and availability with our team.</p>
<div class="related-grid">${rows.map(p => `<article class="card"><h2><a href="${esc(productPath(p))}">${esc(p.name)}</a></h2><p>${esc(p.partNumber)} · ${esc(p.brand)}</p></article>`).join("")}</div>
<nav aria-label="Catalog pagination">${page > 1 ? `<a href="/products${page > 2 ? `?page=${page - 1}` : ""}">Previous</a> · ` : ""}Page ${page} of ${Math.max(1, Math.ceil(total / limit))}${page * limit < total ? ` · <a href="/products?page=${page + 1}">Next</a>` : ""}</nav></main></body></html>`;
    res.set("Cache-Control", "no-store").type("html").send(appHtml(html));
  });
  // Obsolete SEO feed now redirects to the single canonical feed.
  app.get(["/sitemap-seo.xml", "/sitemap-seo-index.xml"], (_req, res) => res.redirect(301, PUBLIC_ORIGIN + "/sitemap.xml"));
}

export type PublicSitemapCheck = { status: "match" | "drift" | "unknown"; count: number | null; checkedAt: number; error?: string };
// Fixed host/path; bounded timeout/bytes; no redirects, user URL, cookies or credentials.
// Compare URL sets (not merely equal counts). Short server cache prevents admin refresh storms.
let cachedCheck: { fingerprint: string; until: number; value: PublicSitemapCheck } | undefined;
export async function checkPublicSitemap(expected: string, fetcher: typeof fetch = fetch): Promise<PublicSitemapCheck> {
  const fingerprint = createHash("sha256").update(expected).digest("hex");
  if (fetcher === fetch && cachedCheck?.fingerprint === fingerprint && cachedCheck.until > Date.now()) return cachedCheck.value;
  let value: PublicSitemapCheck;
  try {
    const r = await fetcher(PUBLIC_ORIGIN + "/sitemap.xml", { redirect: "error", signal: AbortSignal.timeout(12000), headers: { Accept: "application/xml" } });
    if (!r.ok || !/xml/i.test(r.headers.get("content-type") || "")) throw new Error("PUBLIC_SITEMAP_NOT_XML");
    const reader = r.body?.getReader(); if (!reader) throw new Error("PUBLIC_SITEMAP_EMPTY");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const p = await reader.read(); if (p.done) break;
      size += p.value.length;
      if (size > 8000000) { await reader.cancel(); throw new Error("PUBLIC_SITEMAP_TOO_LARGE"); }
      chunks.push(p.value);
    }
    const xml = Buffer.concat(chunks).toString("utf8");
    if (!/^\s*<\?xml/.test(xml) || !/<urlset[\s>]/.test(xml) || !/<\/urlset>\s*$/.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("PUBLIC_SITEMAP_INVALID");
    const locs = (s: string) => Array.from(s.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]).sort();
    const actual = locs(xml), wanted = locs(expected);
    value = { status: JSON.stringify(actual) === JSON.stringify(wanted) ? "match" : "drift", count: actual.length, checkedAt: Date.now() };
  } catch (e) {
    value = { status: "unknown", count: null, checkedAt: Date.now(), error: e instanceof Error && /^PUBLIC_SITEMAP_[A-Z_]+$/.test(e.message) ? e.message : "PUBLIC_SITEMAP_UNREACHABLE" };
  }
  if (fetcher === fetch) cachedCheck = { fingerprint, until: Date.now() + 30000, value };
  return value;
}
