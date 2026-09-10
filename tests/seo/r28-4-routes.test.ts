// R28 Session 4 — SEO route integration test.
// Exercises registerSeoRoutes against a real Express app + real better-sqlite3
// DB (per-file isolated via setup-env.ts DATA_DIR).
//
// Covers:
//   * SEO_PAGES_ENABLED=false  → /p/:slug returns 503 feature_disabled
//   * SEO_PAGES_ENABLED=false  → /sitemap-seo.xml + /robots-seo.txt still live
//   * SEO_PAGES_ENABLED=true   → /p/:slug returns 200 HTML with canonical
//   * bot detection: Googlebot UA marks the row as is_bot=1
//   * admin analytics + top-pages + backfill-slugs + sitemap-preview
//   * slug backfill is idempotent

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { rawSqlite } from "../../server/storage";
import { runR28_4Migrations } from "../../server/migrations";
import { registerSeoRoutes, __test__ as seoInternals } from "../../server/seo-routes";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // Bypass auth in tests — pretend every caller is admin.
  const passthroughAdmin = (_req: Request, _res: Response, next: NextFunction) => next();
  registerSeoRoutes(app, { requireAdminRole: passthroughAdmin });
  return app;
}

async function req(app: Express, method: string, url: string, opts: { headers?: Record<string, string>; body?: any } = {}): Promise<{ status: number; text: string; json?: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    // Use node's http via app.listen on port 0
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const http = require("http") as typeof import("http");
      const chunks: Buffer[] = [];
      const request = http.request({
        method, hostname: "127.0.0.1", port, path: url,
        headers: {
          "user-agent": opts.headers?.["user-agent"] || "vitest",
          ...(opts.headers || {}),
          ...(opts.body ? { "content-type": "application/json" } : {}),
        },
      }, (r) => {
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          server.close();
          const text = Buffer.concat(chunks).toString("utf8");
          let json: any;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: r.statusCode || 0, text, json, headers: r.headers as any });
        });
      });
      request.on("error", (e) => { server.close(); reject(e); });
      if (opts.body) request.write(JSON.stringify(opts.body));
      request.end();
    });
  });
}

// Bootstrap the products / chassis / seo_page_views schema in the isolated DB.
function seed() {
  runR28_4Migrations();
  // Minimal products table (real schema uses more columns; we only need the
  // ones the SEO routes read).
  rawSqlite.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT,
      category TEXT NOT NULL,
      part_number TEXT,
      oem_number TEXT,
      description TEXT NOT NULL,
      short_description TEXT,
      price_inr REAL NOT NULL,
      stock_qty INTEGER,
      image_urls TEXT DEFAULT '[]',
      compatible_models TEXT DEFAULT '[]',
      meta_title TEXT, meta_description TEXT, meta_keywords TEXT,
      featured INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chassis_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chassis_code TEXT NOT NULL,
      chassis_display_name TEXT NOT NULL,
      make TEXT, model TEXT, variant TEXT,
      slug TEXT NOT NULL UNIQUE,
      cover_image_url TEXT, description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chassis_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chassis_id INTEGER NOT NULL,
      part_number TEXT NOT NULL,
      oem_number TEXT, description TEXT NOT NULL,
      category TEXT, position_notes TEXT,
      purchase_price REAL, sell_price REAL, stock_qty INTEGER DEFAULT 0,
      image_url TEXT, product_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  // Wipe & reseed rows.
  rawSqlite.exec(`DELETE FROM products; DELETE FROM chassis_catalog; DELETE FROM chassis_parts; DELETE FROM seo_page_views;`);
  const now = Date.now();
  rawSqlite.prepare(`INSERT INTO products (slug, name, brand, category, part_number, description, price_inr, stock_qty, image_urls, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run("tata-clutch-plate-clp-9001", "Tata Clutch Plate CLP-9001", "tata", "clutch", "CLP-9001",
         "Heavy-duty clutch plate", 3499.5, 12, JSON.stringify(["/uploads/clp.jpg"]), now);
  rawSqlite.prepare(`INSERT INTO products (slug, name, brand, category, part_number, description, price_inr, stock_qty, image_urls, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run("tata-clutch-plate-clp-9002", "Tata Clutch Plate CLP-9002", "tata", "clutch", "CLP-9002",
         "Alt clutch plate", 3299.0, 5, "[]", now + 1);
  // Add a slug-less legacy product to test backfill.
  rawSqlite.prepare(`INSERT INTO products (slug, name, brand, category, part_number, description, price_inr, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run("", "Legacy Filter", "eicher", "filter", "FLT-77", "Oil filter", 220.0, now + 2);
  rawSqlite.prepare(`INSERT INTO chassis_catalog (chassis_code, chassis_display_name, make, model, variant, slug, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run("TATA-407-EX2", "Tata 407 EX2 BS6", "TATA", "407 EX2", "BS6", "tata-407-ex2-bs6", now, now);
}

beforeAll(() => seed());
beforeEach(() => { delete process.env.SEO_PAGES_ENABLED; });

describe("R28.4 SEO routes: feature flag gate", () => {
  it("/p/:slug returns 503 feature_disabled when SEO_PAGES_ENABLED unset", async () => {
    process.env.SEO_PAGES_ENABLED = "false";
    const app = makeApp();
    const r = await req(app, "GET", "/p/tata-clutch-plate-clp-9001");
    expect(r.status).toBe(503);
    expect(r.json?.error).toBe("feature_disabled");
  });
  it("/c/:slug returns 503 when disabled", async () => {
    process.env.SEO_PAGES_ENABLED = "false";
    const app = makeApp();
    const r = await req(app, "GET", "/c/tata-407-ex2-bs6");
    expect(r.status).toBe(503);
  });
  it("/cat/:cat returns 503 when disabled", async () => {
    process.env.SEO_PAGES_ENABLED = "false";
    const app = makeApp();
    const r = await req(app, "GET", "/cat/clutch");
    expect(r.status).toBe(503);
  });

  it("/sitemap-seo.xml stays live even when disabled", async () => {
    process.env.SEO_PAGES_ENABLED = "false";
    const app = makeApp();
    const r = await req(app, "GET", "/sitemap-seo.xml");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/xml/);
    expect(r.text).toMatch(/<\?xml/);
    expect(r.text).toContain("<urlset");
    expect(r.text).toContain("/p/tata-clutch-plate-clp-9001");
  });

  it("/robots-seo.txt stays live even when disabled and disallows /team/", async () => {
    process.env.SEO_PAGES_ENABLED = "false";
    const app = makeApp();
    const r = await req(app, "GET", "/robots-seo.txt");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
    expect(r.text).toContain("User-agent: *");
    expect(r.text).toContain("Disallow: /team/");
    expect(r.text).toContain("Sitemap:");
  });
});

describe("R28.4 SEO routes: SSR when enabled", () => {
  it("/p/:slug returns HTML with canonical + JSON-LD + WhatsApp", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    const r = await req(app, "GET", "/p/tata-clutch-plate-clp-9001");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["cache-control"]).toMatch(/max-age=300/);
    expect(r.text.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(r.text).toContain('rel="canonical"');
    expect(r.text).toContain('"@type":"Product"');
    expect(r.text).toContain("https://wa.me/917909083806");
  });

  it("/p/unknown returns 404 SEO-friendly HTML", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    const r = await req(app, "GET", "/p/does-not-exist");
    expect(r.status).toBe(404);
    expect(r.text).toContain("Page not found");
    expect(r.text).toContain('name="robots" content="noindex,follow"');
  });

  it("/c/:slug returns HTML for a live chassis", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    const r = await req(app, "GET", "/c/tata-407-ex2-bs6");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Tata 407 EX2 BS6");
    expect(r.text).toContain('rel="canonical" href="https://narmadamobility.com/c/tata-407-ex2-bs6"');
  });

  it("/cat/:category returns HTML with product grid", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    const r = await req(app, "GET", "/cat/clutch");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Tata Clutch Plate CLP-9001");
    expect(r.text).toContain("Tata Clutch Plate CLP-9002");
  });
});

describe("R28.4 SEO routes: bot detection + analytics", () => {
  it("logs a page view with is_bot=1 for Googlebot", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    const before = rawSqlite.prepare(`SELECT COUNT(*) AS c FROM seo_page_views WHERE is_bot=1`).get() as any;
    await req(app, "GET", "/p/tata-clutch-plate-clp-9001", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } });
    // Give the fire-and-forget insert a beat.
    await new Promise((r) => setTimeout(r, 50));
    const after = rawSqlite.prepare(`SELECT COUNT(*) AS c FROM seo_page_views WHERE is_bot=1`).get() as any;
    expect(after.c).toBeGreaterThan(before.c);
    const row = rawSqlite.prepare(`SELECT page_type, page_slug, is_bot FROM seo_page_views ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.page_type).toBe("product");
    expect(row.page_slug).toBe("tata-clutch-plate-clp-9001");
    expect(row.is_bot).toBe(1);
  });

  it("logs is_bot=0 for a regular browser UA", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    await req(app, "GET", "/p/tata-clutch-plate-clp-9001", { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)" } });
    await new Promise((r) => setTimeout(r, 50));
    const row = rawSqlite.prepare(`SELECT is_bot FROM seo_page_views ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.is_bot).toBe(0);
  });

  it("hashes IP (never stores raw IP)", () => {
    const h = seoInternals.hashIp("203.0.113.42");
    expect(h).toMatch(/^[a-f0-9]{16}$/);
    expect(h).not.toContain("203.0.113");
  });
});

describe("R28.4 admin endpoints", () => {
  it("GET /api/admin/seo/analytics returns rows with is_bot filter", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    await req(app, "GET", "/p/tata-clutch-plate-clp-9001", { headers: { "user-agent": "Googlebot/2.1" } });
    await new Promise((r) => setTimeout(r, 30));
    const r = await req(app, "GET", "/api/admin/seo/analytics?days=30&is_bot=1&limit=10");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(Array.isArray(r.json.rows)).toBe(true);
  });

  it("GET /api/admin/seo/top-pages aggregates by slug", async () => {
    process.env.SEO_PAGES_ENABLED = "true";
    const app = makeApp();
    await req(app, "GET", "/p/tata-clutch-plate-clp-9001");
    await req(app, "GET", "/p/tata-clutch-plate-clp-9001");
    await new Promise((r) => setTimeout(r, 30));
    const r = await req(app, "GET", "/api/admin/seo/top-pages?days=30&limit=5");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.rows.some((row: any) => row.page_slug === "tata-clutch-plate-clp-9001")).toBe(true);
  });

  it("POST /api/admin/seo/backfill-slugs fills empty slugs and is idempotent", async () => {
    const app = makeApp();
    const r1 = await req(app, "POST", "/api/admin/seo/backfill-slugs", { body: {} });
    expect(r1.status).toBe(200);
    expect(r1.json.ok).toBe(true);
    expect(r1.json.updated).toBeGreaterThanOrEqual(1);
    // Second run should update 0 (all slugs now set)
    const r2 = await req(app, "POST", "/api/admin/seo/backfill-slugs", { body: {} });
    expect(r2.json.updated).toBe(0);
    const legacy = rawSqlite.prepare(`SELECT slug FROM products WHERE part_number = 'FLT-77'`).get() as any;
    expect(legacy.slug).toMatch(/^eicher-filter-flt-77/);
  });

  it("GET /api/admin/seo/sitemap-preview returns URL breakdown", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/seo/sitemap-preview");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.count).toBeGreaterThan(0);
    expect(r.json.by_type.product).toBeGreaterThanOrEqual(2);
    expect(r.json.by_type.chassis).toBeGreaterThanOrEqual(1);
    expect(r.json.by_type.category).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.json.sample)).toBe(true);
  });
});

describe("R28.4 sitemap: chunk + XML shape", () => {
  it("chunkSitemap splits at max", () => {
    const urls = Array.from({ length: 12 }, (_, i) => ({ loc: `https://x.test/p/${i}` }));
    const chunks = seoInternals.chunkSitemap(urls, 5);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(5);
    expect(chunks[2].length).toBe(2);
  });
  it("renderSitemapXml emits a valid urlset", () => {
    const xml = seoInternals.renderSitemapXml([{ loc: "https://x.test/", changefreq: "daily", priority: "1.0" }]);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>https://x.test/</loc>");
    expect(xml).toContain("<changefreq>daily</changefreq>");
    expect(xml).toContain("</urlset>");
  });
});

describe("R28.4 migrations: idempotent", () => {
  it("running R28.4 twice does not throw", () => {
    expect(() => { runR28_4Migrations(); runR28_4Migrations(); }).not.toThrow();
    const cols = rawSqlite.prepare(`PRAGMA table_info(seo_page_views)`).all() as any[];
    expect(cols.some((c) => c.name === "page_type")).toBe(true);
    expect(cols.some((c) => c.name === "is_bot")).toBe(true);
  });
});
