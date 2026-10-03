import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import express from "express";
import type { Server } from "node:http";
import { appHtml, catalogSitemap, checkPublicSitemap, registerPublicCatalog, publicRobots } from "../../server/public-catalog";
import { PUBLIC_ORIGIN, publicMedia, productPath } from "../../shared/public-urls";
let db: Database.Database, server: Server, base: string;
beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,name TEXT,brand TEXT,model TEXT,category TEXT,
part_number TEXT,oem_number TEXT,description TEXT,short_description TEXT,price_inr REAL,stock_qty INTEGER,
image_urls TEXT,compatible_models TEXT,meta_title TEXT,meta_description TEXT,active INTEGER);
INSERT INTO products VALUES(1,'filter','Filter & housing','Tata','','Filters','BP 100-A',NULL,'A catalog description','',125,2,
'["/uploads/parts/filter.png"]','[]',NULL,NULL,1);
INSERT INTO products SELECT 2,'hidden','Hidden','Tata','','Filters','HIDDEN',NULL,'Private draft','',0,0,'[]','[]',NULL,NULL,0;`);
  const app = express(); registerPublicCatalog(app, db);
  app.get("/sitemap.xml", (_req, res) => res.type("application/xml").send(catalogSitemap(db)));
  server = app.listen(0);
  await new Promise<void>(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); });
describe("R28.19 canonical public catalog", () => {
  it("includes exactly one live canonical URL per active product and reflects new rows without rebuild", async () => {
    let xml = await (await fetch(base + "/sitemap.xml")).text();
    expect((xml.match(/<loc>/g) || []).length).toBe(9);
    expect(xml).toContain("/product/BP%20100-A/filter");
    expect(xml).not.toMatch(/\/p\/|hidden|spare-parts-|\/cat\//);
    db.exec("INSERT INTO products SELECT 3,'new','New','Tata','','Filters',NULL,NULL,'New item','',12,1,'[]','[]',NULL,NULL,1");
    xml = await (await fetch(base + "/sitemap.xml")).text();
    expect((xml.match(/<loc>/g) || []).length).toBe(10);
    expect(xml).toContain("/product/new");
  });
  it("SSR includes actual product, one canonical, matching JSON-LD and absolute backend upload URL; HEAD is empty", async () => {
    const path = "/product/BP%20100-A/filter";
    const r = await fetch(base + path), html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain("<h1>Filter &amp; housing</h1>");
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain(`href="${PUBLIC_ORIGIN}${path}"`);
    expect(html).toContain("https://narmada-backend.onrender.com/uploads/parts/filter.png");
    const json = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    expect(json.find(j => j["@type"] === "Product").offers.url).toBe(PUBLIC_ORIGIN + path);
    expect(await (await fetch(base + path, { method: "HEAD" })).text()).toBe("");
  });
  it("redirects valid aliases once, rejects missing/inactive/wrong identifiers without soft 404", async () => {
    for (const path of ["/p/filter", "/product/filter", "/product/filter/BP%20100-A", "/product/BP%20100-A/filter/"]) {
      const r = await fetch(base + path, { redirect: "manual" });
      expect(r.status).toBe(301); expect(r.headers.get("location")).toBe(PUBLIC_ORIGIN + "/product/BP%20100-A/filter");
    }
    for (const path of ["/product/no-such", "/product/hidden", "/product/WRONG/filter", "/products?page=99999"]) {
      const r = await fetch(base + path); expect(r.status).toBe(404);
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(await r.text()).not.toContain('rel="canonical"');
    }
  });
  it("uses slug-only canonical when a part number contains Apache-rejected encoded path separators", async () => {
    db.prepare("UPDATE products SET part_number=? WHERE id=1").run("BP/100");
    expect(productPath({ slug: "filter", partNumber: "BP/100" })).toBe("/product/filter");
    expect(await (await fetch(base + "/product/filter")).text()).toContain("BP/100");
    expect(catalogSitemap(db)).not.toContain("%2F");
    const old = await fetch(base + "/product/BP%2F100/filter", { redirect: "manual" });
    expect(old.status).toBe(301); // Hosts that permit the legacy URL still redirect.
  });
  it("catalog links and numbered pagination are crawlable without JavaScript", async () => {
    for (let id = 3; id <= 28; id++) db.prepare("INSERT INTO products SELECT ?,?,'Part','Tata','','Filters',NULL,NULL,'Description','',12,1,'[]','[]',NULL,NULL,1").run(id, `part-${id}`);
    const html = await (await fetch(base + "/products")).text();
    expect(html).toContain('href="/products?page=2"');
    expect(html).toContain('href="/product/part-28"');
    const second = await (await fetch(base + "/products?page=2")).text();
    expect(second).toContain(`${PUBLIC_ORIGIN}/products?page=2`);
    expect(second).toContain('href="/products"');
  });
  it("embeds SSR into the existing app entry without duplicate canonicals/schema or changing app scripts", () => {
    const entry = '<!doctype html><html><head><title>Old</title><link rel="canonical" href="old"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';
    const result = appHtml('<!doctype html><html><head><title>Filter</title><link rel="canonical" href="new"><style>h1{color:blue}</style></head><body><h1>Filter</h1></body></html>', entry);
    expect(result).toContain('<div id="root"><style>'); expect(result).toContain("/assets/app.js");
    expect(result).not.toContain('href="old"'); expect(result.match(/rel="canonical"/g)).toHaveLength(1);
    expect(publicRobots()).toContain("/sitemap-blog.xml");
    expect(publicMedia("javascript:alert(1)")).toBe("");
  });
  it("public drift is verified against fixed HTTPS host, bounded XML and URL sets; unavailable is unknown", async () => {
    const expected = catalogSitemap(db);
    const f = vi.fn(async () => new Response(expected, { headers: { "content-type": "application/xml" } })) as any;
    expect((await checkPublicSitemap(expected, f)).status).toBe("match");
    expect(f.mock.calls[0][0]).toBe(PUBLIC_ORIGIN + "/sitemap.xml");
    expect(f.mock.calls[0][1].redirect).toBe("error");
    f.mockImplementation(async () => new Response(expected.replace("filter</loc>", "wrong</loc>"), { headers: { "content-type": "application/xml" } }));
    expect((await checkPublicSitemap(expected, f)).status).toBe("drift");
    f.mockImplementation(async () => new Response("<html>SPA</html>", { headers: { "content-type": "text/html" } }));
    expect(await checkPublicSitemap(expected, f)).toMatchObject({ status: "unknown", count: null });
    f.mockImplementation(async () => { throw new Error("secret untrusted exception"); });
    expect(JSON.stringify(await checkPublicSitemap(expected, f))).not.toContain("secret");
  });
});
