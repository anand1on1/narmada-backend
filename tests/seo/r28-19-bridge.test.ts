import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const hasPhp = spawnSync("php", ["-v"]).status === 0;
describe.skipIf(!hasPhp)("R28.19 PHP runtime, offline cURL fixture", () => {
  const html = '<!doctype html><html><head><link rel="canonical" href="https://narmadamobility.com/product/PN/filter"></head><body><h1>Filter</h1></body></html>';
  function php(env: Record<string, string> = {}) {
    const r = spawnSync("php", ["-n", "tests/blog/php-bridge-harness.php"], { encoding: "utf8",
      env: { ...process.env, FIXTURE_BRIDGE: "seo", FIXTURE_URI: "/product/PN/filter", FIXTURE_BODY: html, ...env } });
    expect(r.status).toBe(0);
    return { body: r.stdout, meta: JSON.parse(r.stderr) };
  }
  it("passes product HTML and empty HEAD with fixed TLS host and no redirects/cookies/auth", () => {
    const r = php();
    expect(r.body).toBe(html); expect(r.meta.status).toBe(200);
    expect(r.meta.url).toBe("https://narmada-backend.onrender.com/product/PN/filter");
    expect(r.meta.tls).toBe(true); expect(r.meta.redirects).toBe(false);
    expect(php({ FIXTURE_METHOD: "HEAD" }).body).toBe("");
    const file = readFileSync("client/public/seo-bridge.php", "utf8");
    expect(file).not.toMatch(/\$_POST|HTTP_AUTHORIZATION|HTTP_COOKIE/);
  });
  it("passes XML/robots and only allowed filters; rejects old SPA-as-SSR upstream", () => {
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://narmadamobility.com/product/PN/filter</loc></url></urlset>';
    expect(php({ FIXTURE_URI: "/sitemap.xml", FIXTURE_TYPE: "application/xml", FIXTURE_BODY: xml }).body).toBe(xml);
    expect(php({ FIXTURE_URI: "/robots.txt", FIXTURE_TYPE: "text/plain", FIXTURE_BODY: "User-agent: *\nSitemap: https://narmadamobility.com/sitemap.xml" }).meta.status).toBe(200);
    expect(php({ FIXTURE_URI: "/products?page=2&q=filter&url=https://evil.test" }).meta.url).toBe("https://narmada-backend.onrender.com/products?page=2&q=filter");
    expect(php({ FIXTURE_BODY: '<!doctype html><html><body><div id="root"></div></body></html>' }).meta.status).toBe(503);
  });
  it("relays only public canonical 301s and preserves 404; fails closed on outage/HTML pretending XML", () => {
    expect(php({ FIXTURE_STATUS: "301", FIXTURE_LOCATION: "https://narmadamobility.com/product/PN/filter" }).meta.status).toBe(301);
    for (const location of ["https://evil.test/", "https://narmadamobility.com.evil.test/product/x", "https://narmadamobility.com/api/admin", "https://narmadamobility.com/product/x%0d%0aX-Bad:y"]) {
      expect(php({ FIXTURE_STATUS: "301", FIXTURE_LOCATION: location }).meta.status).toBe(503);
    }
    expect(php({ FIXTURE_STATUS: "404" }).meta.status).toBe(404);
    expect(php({ FIXTURE_STATUS: "500" }).meta.status).toBe(503);
    expect(php({ FIXTURE_URI: "/sitemap.xml", FIXTURE_TYPE: "text/html" }).meta.status).toBe(503);
  });
  it("rejects writes and path/host injection before transport; unknown SPA pages are true 404s", () => {
    for (const env of [{ FIXTURE_METHOD: "POST" }, { FIXTURE_URI: "/product/../../api/admin" }, { FIXTURE_URI: "/product/%2e%2e/api" },
      { FIXTURE_URI: "/seo-bridge.php?url=https://evil.test" }, { FIXTURE_URI: "//evil.test/products" }, { FIXTURE_URI: "/products?page=0" }]) {
      const r = php(env); expect(r.meta.url).toBeNull(); expect([404, 405]).toContain(r.meta.status);
    }
    const unknown = php({ FIXTURE_BRIDGE: "entry", FIXTURE_URI: "/no-such-page" });
    expect(unknown.meta.status).toBe(404); expect(unknown.body).toContain('content="noindex"');
  });
  it("GoDaddy rewrites public hosts only, before stale files, and keeps admin SPA / Accounts route", () => {
    const ht = readFileSync("client/public/.htaccess", "utf8");
    expect(ht).toContain("RewriteCond %{HTTP_HOST} ^www\\.narmadamobility\\.com$");
    expect(ht).toContain("RewriteCond %{HTTPS} !=on");
    expect(ht).not.toMatch(/^\s*ProxyPass/m);
    expect(ht.indexOf("seo-bridge.php")).toBeLessThan(ht.indexOf("RewriteCond %{REQUEST_FILENAME}"));
    expect(readFileSync("client/public/site-entry.php", "utf8")).toContain("admin(?:/[^?]*)?");
    expect(readFileSync("client/src/App.tsx", "utf8")).toContain('path="/admin/accounts"');
  });
});
