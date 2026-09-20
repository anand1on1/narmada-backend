import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const php = readFileSync("client/public/blog-bridge.php", "utf8");
const ht = readFileSync("client/public/.htaccess", "utf8");
describe("GoDaddy bridge deployment contract", () => {
  it("rewrites only blog and sitemap ahead of stale static paths, never proxies product/write routes", () => {
    expect(ht.indexOf("RewriteRule ^blog")).toBeLessThan(ht.indexOf("RewriteCond %{REQUEST_FILENAME}"));
    expect(ht).toContain("RewriteRule ^sitemap-blog\\.xml$ blog-bridge.php");
    expect(ht).not.toMatch(/^\s*ProxyPass/m);
    expect(ht).not.toMatch(/RewriteRule.*(?:product|api)/);
  });
  it("uses a fixed HTTPS upstream with TLS validation, redirects off, read-only method whitelist and limits", () => {
    expect(php).toContain("'https://narmada-backend.onrender.com' . $upstreamPath");
    expect(php).toContain("$method !== 'GET' && $method !== 'HEAD'");
    expect(php).toContain("CURLOPT_FOLLOWLOCATION => false");
    expect(php).toContain("CURLOPT_SSL_VERIFYPEER => true");
    expect(php).toContain("CURLOPT_SSL_VERIFYHOST => 2");
    expect(php).toContain("CURLOPT_TIMEOUT => 25");
    expect(php).toContain("> 2000000");
    expect(php).toContain("time() - 30");
    expect(php).not.toContain("$_POST"); expect(php).not.toContain("HTTP_AUTHORIZATION");
  });
  it("adds the dynamic blog sitemap without clobbering the existing sitemap and emits build identity", () => {
    const robots = readFileSync("client/public/robots.txt", "utf8");
    expect(robots).toContain("Sitemap: https://narmadamobility.com/sitemap.xml");
    expect(robots).toContain("Sitemap: https://narmadamobility.com/sitemap-blog.xml");
    expect(readFileSync("script/build.ts", "utf8")).toContain('writeFile("dist/public/version.json"');
  });
});

const hasPhp = spawnSync("php", ["-v"]).status === 0;
describe.skipIf(!hasPhp)("PHP bridge runtime with offline cURL contracts", () => {
  function php(env: Record<string, string> = {}) {
    const r = spawnSync("php", ["-n", "tests/blog/php-bridge-harness.php"], { encoding: "utf8", env: {
      ...process.env, FIXTURE_URI: `/blog/fixture-${Date.now()}-${Math.floor(Math.random() * 100000)}`, ...env,
    } });
    expect(r.status).toBe(0);
    return { body: r.stdout, meta: JSON.parse(r.stderr) };
  }
  it("passes actual SSR HTML through a fixed TLS-only upstream", () => {
    const r = php();
    expect(r.body).toContain("<h1>Fixture article</h1>");
    expect(r.meta.url).toMatch(/^https:\/\/narmada-backend.onrender.com\/public-blog\/html\/fixture-/);
    expect(r.meta.tls).toBe(true); expect(r.meta.redirects).toBe(false); expect(r.meta.status).toBe(200);
  });
  it("preserves upstream 404, fails closed on redirects/unavailable responses, and HEAD has no body", () => {
    expect(php({ FIXTURE_STATUS: "404" }).meta.status).toBe(404);
    expect(php({ FIXTURE_STATUS: "302" }).meta.status).toBe(503);
    expect(php({ FIXTURE_STATUS: "500" }).meta.status).toBe(503);
    expect(php({ FIXTURE_METHOD: "HEAD" }).body).toBe("");
    expect(php({ FIXTURE_TYPE: "application/json" }).meta.status).toBe(503);
  });
  it("rejects write methods and path injection without invoking transport", () => {
    for (const env of [{ FIXTURE_METHOD: "POST" }, { FIXTURE_URI: "/blog/../../api/admin/posts" },
      { FIXTURE_URI: "/blog/%2fadmin" }, { FIXTURE_URI: "/blog-bridge.php?url=https://evil.test" }]) {
      const r = php(env); expect(r.meta.url).toBeNull(); expect([404, 405]).toContain(r.meta.status);
    }
  });
  it("forwards only constrained search filters, never arbitrary destination parameters", () => {
    const r = php({ FIXTURE_URI: "/blog?q=brakes&category=brake&page=2&url=https://evil.test" });
    expect(r.meta.url).toBe("https://narmada-backend.onrender.com/public-blog/html?q=brakes&category=brake&page=2");
  });
  it("handles dynamically returned XML and a bounded successful cache", () => {
    const r = php({ FIXTURE_URI: "/sitemap-blog.xml", FIXTURE_TYPE: "application/xml",
      FIXTURE_BODY: '<?xml version="1.0"?><urlset><url><loc>https://narmadamobility.com/blog/fixture</loc></url></urlset>' });
    expect(r.body).toContain("<urlset>");
    const uri = `/blog/cache-test-${Date.now()}`;
    expect(php({ FIXTURE_URI: uri }).meta.url).not.toBeNull();
    expect(php({ FIXTURE_URI: uri }).meta.url).toBeNull();
  });
});
