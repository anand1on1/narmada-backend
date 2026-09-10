// =========================================================================
// R28 Session 4 — SEO routes: SSR product / chassis / category pages,
// sitemap.xml, robots.txt, admin analytics endpoints.
// -------------------------------------------------------------------------
// All SSR routes are gated by SEO_PAGES_ENABLED (default false → 503).
// Sitemap + robots are ALWAYS live regardless of the flag (safe empty output).
//
// Additive-only. Does not touch Sessions 1/2/3 code. The existing
// /sitemap.xml + /robots.txt routes in routes.ts (R27.31) stay mounted first
// so they still handle those paths — Session 4 exposes NEW enhanced sitemap +
// robots at /sitemap-seo.xml and /robots-seo.txt so nothing pre-existing
// changes. See buildSitemapForSeo() for the URL set.
//
// Verbatim user requirement (from Session 4 brief):
//   "EACH PRODUCT CREATED BY EXCEL UPLOAD OF THE CHASIS CREATES A SEPARATE
//    PAGE WHICH FOLLOWS LATEST GOOGLE SEO NORMS"
// =========================================================================

import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { rawSqlite } from "./storage";
import {
  renderProductPage,
  renderChassisPage,
  renderCategoryPage,
  renderNotFoundPage,
  isBotUA,
  type SeoConfig,
  type SeoProduct,
  type SeoChassis,
  type SeoChassisPart,
} from "./seo-templates";

// --------------------------- config helpers ---------------------------
function seoEnabled(): boolean {
  return String(process.env.SEO_PAGES_ENABLED || "").toLowerCase() === "true";
}
function seoBaseUrl(): string {
  const v = process.env.SEO_BASE_URL;
  if (v && /^https?:\/\//i.test(v)) return v.replace(/\/$/, "");
  return "https://narmadamobility.com";
}
function getConfig(): SeoConfig {
  return {
    baseUrl: seoBaseUrl(),
    siteName: "Narmada Mobility",
    whatsappNumber: "917909083806", // matches server/routes.ts WHATSAPP_NUMBER
    spaBase: seoBaseUrl(),
  };
}

// GDPR-safe IP hash — SHA-256 of (ip + salt) truncated to 16 hex chars.
function hashIp(ip: string): string {
  const salt = process.env.SEO_ANALYTICS_SALT || "narmada-seo-v1";
  return crypto.createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 16);
}

// Fire-and-forget page view log. Never throws to caller.
function logPageView(pageType: "product" | "chassis" | "category", slug: string, req: Request): void {
  try {
    const ua = (req.headers["user-agent"] as string | undefined) || "";
    const referer = (req.headers["referer"] as string | undefined) || (req.headers["referrer"] as string | undefined) || "";
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "";
    const isBot = isBotUA(ua) ? 1 : 0;
    rawSqlite
      .prepare(`INSERT INTO seo_page_views (page_type, page_slug, user_agent, referer, ip_hash, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(pageType, slug, ua.slice(0, 500), referer.slice(0, 500), ip ? hashIp(ip) : null, isBot, Date.now());
  } catch (e: any) {
    // Never let analytics failures affect the response.
    console.error("[seo-routes] logPageView failed:", e?.message || e);
  }
}

// --------------------------- data access ------------------------------
function loadProductBySlug(slug: string): SeoProduct | null {
  const row = rawSqlite.prepare(`
    SELECT id, slug, name, brand, model, category, part_number AS partNumber,
           oem_number AS oemNumber, description, short_description AS shortDescription,
           price_inr AS priceInr, stock_qty AS stockQty, image_urls AS imageUrls,
           compatible_models AS compatibleModels, meta_title AS metaTitle,
           meta_description AS metaDescription, meta_keywords AS metaKeywords,
           active, created_at AS createdAt
    FROM products WHERE slug = ? LIMIT 1
  `).get(slug) as any;
  if (!row) return null;
  if (!row.active) return null;
  // NEVER surface purchase_price — the products table doesn't have it anyway,
  // purchase price lives on chassis_parts + auto_publish_log. Explicit call-out.
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    model: row.model,
    category: row.category,
    partNumber: row.partNumber,
    oemNumber: row.oemNumber,
    description: row.description,
    shortDescription: row.shortDescription,
    priceInr: Number(row.priceInr),
    stockQty: row.stockQty,
    imageUrls: row.imageUrls,
    compatibleModels: row.compatibleModels,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    metaKeywords: row.metaKeywords,
    imageSource: resolveImageSource(row.id),
    createdAt: row.createdAt,
  };
}

// image_source is not on products — it's on auto_publish_log. Best-effort
// lookup by product_id; if the table doesn't exist or no row, return null.
function resolveImageSource(productId: number): string | null {
  try {
    const r = rawSqlite.prepare(`SELECT image_source FROM auto_publish_log WHERE product_id = ? ORDER BY id DESC LIMIT 1`).get(productId) as any;
    return r?.image_source || null;
  } catch { return null; }
}

// Related products: same category, exclude self, limit 4, only active.
// Strategy = same category. (Session 4 return-summary asks explicitly which
// strategy we picked — see SESSION-4-AUDIT-REPORT.md.)
function loadRelatedProducts(product: SeoProduct, limit = 4): SeoProduct[] {
  try {
    const rows = rawSqlite.prepare(`
      SELECT id, slug, name, brand, model, category, part_number AS partNumber,
             oem_number AS oemNumber, description, short_description AS shortDescription,
             price_inr AS priceInr, stock_qty AS stockQty, image_urls AS imageUrls,
             compatible_models AS compatibleModels
      FROM products
      WHERE active = 1 AND category = ? AND id != ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(product.category, product.id, limit) as any[];
    return rows.map((r) => ({
      ...r,
      priceInr: Number(r.priceInr),
    }));
  } catch { return []; }
}

function loadChassisBySlug(slug: string): SeoChassis | null {
  try {
    const row = rawSqlite.prepare(`
      SELECT id, slug, chassis_code AS chassisCode, chassis_display_name AS chassisDisplayName,
             make, model, variant, cover_image_url AS coverImageUrl, description, is_active
      FROM chassis_catalog WHERE slug = ? LIMIT 1
    `).get(slug) as any;
    if (!row || !row.is_active) return null;
    return {
      id: row.id, slug: row.slug, chassisCode: row.chassisCode,
      chassisDisplayName: row.chassisDisplayName, make: row.make, model: row.model,
      variant: row.variant, coverImageUrl: row.coverImageUrl, description: row.description,
    };
  } catch { return null; }
}

function loadChassisParts(chassisId: number): SeoChassisPart[] {
  try {
    const rows = rawSqlite.prepare(`
      SELECT cp.id, cp.part_number AS partNumber, cp.oem_number AS oemNumber,
             cp.description, cp.category, cp.sell_price AS sellPrice,
             cp.product_id AS productId,
             p.slug AS productSlug
      FROM chassis_parts cp
      LEFT JOIN products p ON p.id = cp.product_id AND p.active = 1
      WHERE cp.chassis_id = ? AND cp.is_active = 1
      ORDER BY cp.category, cp.part_number
    `).all(chassisId) as any[];
    // NEVER surface purchase_price. Only sell_price is included above.
    return rows.map((r) => ({
      id: r.id,
      partNumber: r.partNumber,
      oemNumber: r.oemNumber,
      description: r.description,
      category: r.category,
      sellPrice: r.sellPrice != null ? Number(r.sellPrice) : null,
      productSlug: r.productSlug || null,
    }));
  } catch { return []; }
}

function loadCategoryProducts(category: string, limit = 100): SeoProduct[] {
  try {
    const rows = rawSqlite.prepare(`
      SELECT id, slug, name, brand, model, category, part_number AS partNumber,
             oem_number AS oemNumber, description, short_description AS shortDescription,
             price_inr AS priceInr, stock_qty AS stockQty, image_urls AS imageUrls,
             compatible_models AS compatibleModels
      FROM products
      WHERE active = 1 AND category = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(category, limit) as any[];
    return rows.map((r) => ({ ...r, priceInr: Number(r.priceInr) }));
  } catch { return []; }
}

// --------------------------- sitemap ------------------------------
export interface SitemapUrl {
  loc: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
  lastmod?: string;
}

// Build the URL set the Session 4 spec calls for: homepage + every active
// product's /p/{slug} + every active chassis's /c/{slug} + distinct category
// pages. Uses SEO_BASE_URL for the canonical host.
export function buildSitemapForSeo(): SitemapUrl[] {
  const base = seoBaseUrl();
  const urls: SitemapUrl[] = [];
  urls.push({ loc: `${base}/`, changefreq: "daily", priority: "1.0" });

  try {
    const products = rawSqlite.prepare(`
      SELECT slug, created_at FROM products WHERE active = 1 ORDER BY created_at DESC
    `).all() as any[];
    for (const p of products) {
      if (!p.slug) continue;
      urls.push({
        loc: `${base}/p/${encodeURIComponent(p.slug)}`,
        changefreq: "weekly",
        priority: "0.7",
        lastmod: p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : undefined,
      });
    }
  } catch { /* table missing, safe empty */ }

  try {
    const chassis = rawSqlite.prepare(`
      SELECT slug, updated_at FROM chassis_catalog WHERE is_active = 1
    `).all() as any[];
    for (const c of chassis) {
      if (!c.slug) continue;
      urls.push({
        loc: `${base}/c/${encodeURIComponent(c.slug)}`,
        changefreq: "weekly",
        priority: "0.6",
        lastmod: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : undefined,
      });
    }
  } catch { /* ignore */ }

  try {
    const cats = rawSqlite.prepare(`SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL AND category != ''`).all() as any[];
    for (const c of cats) {
      urls.push({
        loc: `${base}/cat/${encodeURIComponent(c.category)}`,
        changefreq: "weekly",
        priority: "0.6",
      });
    }
  } catch { /* ignore */ }

  return urls;
}

function renderSitemapXml(urls: SitemapUrl[]): string {
  const items = urls.map((u) => {
    const parts: string[] = [`<loc>${u.loc}</loc>`];
    if (u.lastmod) parts.push(`<lastmod>${u.lastmod}</lastmod>`);
    if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`);
    if (u.priority) parts.push(`<priority>${u.priority}</priority>`);
    return `  <url>${parts.join("")}</url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

// Google limit: 50,000 URLs or 50 MB per sitemap. We're nowhere near that, but
// the split helper is here so future scale doesn't need a code change.
export const SITEMAP_MAX_URLS = 50000;
export function chunkSitemap(urls: SitemapUrl[], max = SITEMAP_MAX_URLS): SitemapUrl[][] {
  if (urls.length <= max) return [urls];
  const chunks: SitemapUrl[][] = [];
  for (let i = 0; i < urls.length; i += max) chunks.push(urls.slice(i, i + max));
  return chunks;
}

function renderRobotsTxt(): string {
  const base = seoBaseUrl();
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin/",
    "Disallow: /team/",
    "",
    `Sitemap: ${base}/sitemap-seo.xml`,
    "",
  ].join("\n");
}

// --------------------------- slug backfill ----------------------------
function toKebabSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "product";
}
function generateSlug(brand: string, category: string, partNumber: string | null): string {
  const parts = [brand, category, partNumber || `p-${Date.now()}`].filter(Boolean).map((x) => String(x));
  return toKebabSlug(parts.join("-"));
}
export function backfillProductSlugs(): { updated: number; skipped: number; total: number } {
  // Any product with a missing/empty slug gets one. Uniqueness enforced by
  // schema — collisions get -N suffix.
  let updated = 0;
  let skipped = 0;
  const rows = rawSqlite.prepare(`SELECT id, brand, category, part_number, slug FROM products`).all() as any[];
  const total = rows.length;
  for (const r of rows) {
    if (r.slug && String(r.slug).trim().length > 0) { skipped++; continue; }
    const base = generateSlug(r.brand || "part", r.category || "other", r.part_number || null);
    let cand = base;
    let n = 2;
    while (rawSqlite.prepare(`SELECT id FROM products WHERE slug = ? AND id != ? LIMIT 1`).get(cand, r.id)) {
      cand = `${base}-${n++}`;
      if (n > 50) { cand = `${base}-${Date.now()}`; break; }
    }
    try {
      rawSqlite.prepare(`UPDATE products SET slug = ? WHERE id = ?`).run(cand, r.id);
      updated++;
    } catch { skipped++; }
  }
  return { updated, skipped, total };
}

// --------------------------- route registration -----------------------
// requireAdminRole helper is provided by the caller (registerV2Routes already
// exports a single canonical requireAdminRole via the tokenMap-scoped closure);
// here we accept a simpler middleware from routes.ts callers.
export interface SeoRouteContext {
  requireAdminRole: (req: Request, res: Response, next: NextFunction) => void;
}

export function registerSeoRoutes(app: Express, ctx: SeoRouteContext) {
  const setPublicCache = (res: Response) => {
    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
  };

  // -----------------------------------------------------------------
  // Sitemap + robots — ALWAYS live regardless of SEO_PAGES_ENABLED.
  // We use NEW paths (sitemap-seo.xml, robots-seo.txt) so we do NOT collide
  // with the existing /sitemap.xml + /robots.txt served by routes.ts (Session
  // 1/2/3 code is off-limits, and the pre-Session-1 R27.31 sitemap is still
  // in production use).
  // -----------------------------------------------------------------
  app.get("/sitemap-seo.xml", (_req, res) => {
    try {
      const urls = buildSitemapForSeo();
      const chunks = chunkSitemap(urls);
      // Single-file mode: emit the flat urlset. If we ever exceed 50k, callers
      // should switch to the index route below.
      const xml = renderSitemapXml(chunks[0]);
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      res.send(xml);
    } catch (e: any) {
      console.error("[seo-routes] sitemap failed:", e?.message || e);
      res.status(500).set("Content-Type", "application/xml").send(`<?xml version="1.0"?><error>sitemap generation failed</error>`);
    }
  });

  // Optional sitemap index for future scale (>50k URLs). Currently returns
  // a single-entry index pointing at sitemap-seo.xml.
  app.get("/sitemap-seo-index.xml", (_req, res) => {
    try {
      const base = seoBaseUrl();
      const urls = buildSitemapForSeo();
      const chunks = chunkSitemap(urls);
      const now = new Date().toISOString().slice(0, 10);
      const items = chunks.length === 1
        ? `  <sitemap><loc>${base}/sitemap-seo.xml</loc><lastmod>${now}</lastmod></sitemap>`
        : chunks.map((_c, i) => `  <sitemap><loc>${base}/sitemap-seo-${i + 1}.xml</loc><lastmod>${now}</lastmod></sitemap>`).join("\n");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      res.send(xml);
    } catch (e: any) {
      console.error("[seo-routes] sitemap-index failed:", e?.message || e);
      res.status(500).send("");
    }
  });

  app.get("/robots-seo.txt", (_req, res) => {
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(renderRobotsTxt());
  });

  // -----------------------------------------------------------------
  // SSR PAGES — gated by SEO_PAGES_ENABLED. When disabled, all three return
  // 503 { error: "feature_disabled" } so the deploy is safe until the admin
  // reviews /api/admin/seo/sitemap-preview and flips the env var.
  // -----------------------------------------------------------------
  const gated = (handler: (req: Request, res: Response) => void | Promise<void>) =>
    async (req: Request, res: Response) => {
      if (!seoEnabled()) {
        res.status(503).json({ error: "feature_disabled", feature: "SEO_PAGES_ENABLED" });
        return;
      }
      try { await handler(req, res); }
      catch (e: any) {
        console.error("[seo-routes] handler failed:", e?.message || e);
        res.status(500).type("text/html").send(`<!doctype html><html><body><h1>Error</h1><p>${String(e?.message || e)}</p></body></html>`);
      }
    };

  // /p/:slug — product SSR page
  app.get("/p/:slug", gated((req, res) => {
    const slug = String(req.params.slug || "").trim();
    const cfg = getConfig();
    const product = loadProductBySlug(slug);
    if (!product) {
      res.status(404).type("text/html").send(renderNotFoundPage(cfg, "product", slug));
      return;
    }
    logPageView("product", slug, req);
    const related = loadRelatedProducts(product, 4);
    setPublicCache(res);
    res.type("text/html").send(renderProductPage(product, related, cfg));
  }));

  // /c/:slug — chassis SSR page
  app.get("/c/:slug", gated((req, res) => {
    const slug = String(req.params.slug || "").trim();
    const cfg = getConfig();
    const chassis = loadChassisBySlug(slug);
    if (!chassis) {
      res.status(404).type("text/html").send(renderNotFoundPage(cfg, "chassis", slug));
      return;
    }
    logPageView("chassis", slug, req);
    const parts = loadChassisParts(chassis.id);
    setPublicCache(res);
    res.type("text/html").send(renderChassisPage(chassis, parts, cfg));
  }));

  // /cat/:category — category SSR page
  app.get("/cat/:category", gated((req, res) => {
    const category = String(req.params.category || "").trim();
    const cfg = getConfig();
    const products = loadCategoryProducts(category, 100);
    if (!products.length) {
      res.status(404).type("text/html").send(renderNotFoundPage(cfg, "category", category));
      return;
    }
    logPageView("category", category, req);
    setPublicCache(res);
    res.type("text/html").send(renderCategoryPage(category, products, cfg));
  }));

  // -----------------------------------------------------------------
  // ADMIN endpoints (all require admin role via caller-supplied middleware)
  // -----------------------------------------------------------------
  const requireAdmin = ctx.requireAdminRole;

  // Recent page views. Filter: ?days=30&is_bot=0|1&limit=100
  app.get("/api/admin/seo/analytics", requireAdmin, (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 100)));
      const isBotParam = req.query.is_bot;
      const since = Date.now() - days * 86400_000;
      const conds: string[] = [`created_at >= ?`];
      const params: any[] = [since];
      if (isBotParam !== undefined && isBotParam !== "") {
        conds.push(`is_bot = ?`);
        params.push(String(isBotParam) === "1" || String(isBotParam).toLowerCase() === "true" ? 1 : 0);
      }
      const sql = `SELECT id, page_type, page_slug, user_agent, referer, ip_hash, is_bot, created_at
                     FROM seo_page_views
                    WHERE ${conds.join(" AND ")}
                    ORDER BY id DESC
                    LIMIT ?`;
      const rows = rawSqlite.prepare(sql).all(...params, limit);
      res.json({ ok: true, days, count: rows.length, rows });
    } catch (e: any) { res.status(500).json({ error: e?.message || "analytics failed" }); }
  });

  // Aggregate by slug: view_count, bot_view_count
  app.get("/api/admin/seo/top-pages", requireAdmin, (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
      const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50)));
      const since = Date.now() - days * 86400_000;
      const rows = rawSqlite.prepare(`
        SELECT page_type, page_slug,
               COUNT(*) AS view_count,
               SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_view_count
        FROM seo_page_views
        WHERE created_at >= ?
        GROUP BY page_type, page_slug
        ORDER BY view_count DESC
        LIMIT ?
      `).all(since, limit);
      res.json({ ok: true, days, count: rows.length, rows });
    } catch (e: any) { res.status(500).json({ error: e?.message || "top-pages failed" }); }
  });

  // One-time slug backfill for old products (products created before Session 3).
  // Session 3 already writes slugs on new auto-published rows; this fixes any
  // gaps. Idempotent — already-slugged rows are skipped.
  app.post("/api/admin/seo/backfill-slugs", requireAdmin, (_req, res) => {
    try {
      const stats = backfillProductSlugs();
      res.json({ ok: true, ...stats });
    } catch (e: any) { res.status(500).json({ error: e?.message || "backfill failed" }); }
  });

  // Sitemap preview: return the URL list as JSON so admin can review before
  // Google actually starts crawling.
  app.get("/api/admin/seo/sitemap-preview", requireAdmin, (_req, res) => {
    try {
      const urls = buildSitemapForSeo();
      res.json({
        ok: true,
        base_url: seoBaseUrl(),
        enabled: seoEnabled(),
        count: urls.length,
        sample: urls.slice(0, 20),
        by_type: {
          product: urls.filter((u) => u.loc.includes("/p/")).length,
          chassis: urls.filter((u) => u.loc.includes("/c/")).length,
          category: urls.filter((u) => u.loc.includes("/cat/")).length,
          other: urls.filter((u) => !u.loc.includes("/p/") && !u.loc.includes("/c/") && !u.loc.includes("/cat/")).length,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e?.message || "preview failed" }); }
  });
}

// Exports for tests.
export const __test__ = {
  hashIp, buildSitemapForSeo, renderSitemapXml, renderRobotsTxt,
  chunkSitemap, toKebabSlug, generateSlug, isBotUA,
};
