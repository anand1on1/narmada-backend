import { describe, expect, it } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { publicVisibility } from "../../server/public-visibility";
import { publicRecord } from "../../shared/public-visibility";
import { renderQuotePage } from "../../server/quote-page";
import cities from "../../shared/data/india-cities.json";
describe("Quotation first-page and excluded public brand", () => {
  it("renders useful no-JS content, canonical, all locations, credited photos and manual fallback", () => {
    const html = renderQuotePage(["tata"]);
    expect(html).toContain('rel="canonical" href="https://narmadamobility.com/get-quote"');
    for (const value of ["Upload Indent Copy","Enter Parts Manually","Tata","Mahindra","BharatBenz","Ashok Leyland","Volvo","AMW","Caterpillar","JCB",
      "Gangtok","Leh","Kavaratti","Patna","India","Kenya","CC BY-SA 4.0","Anthropic","<noscript>","price-checker?brand=tata"]) expect(html).toContain(value);
    expect(new Set(cities.map(c=>c.state)).size).toBe(36);
    expect(html).not.toMatch(/eicher|vecv|genuine|authorized/i);
    expect(html.length).toBeGreaterThan(20000);
  });
  it("removes static promotion, retains internal brands, and includes fixed bridge route", () => {
    for (const path of ["client/index.html","client/src/data/brands.ts","client/public/sitemap.xml","client/src/pages/HomePage.tsx"])
      expect(readFileSync(path,"utf8")).not.toMatch(/eicher|vecv/i);
    expect(readFileSync("server/price-catalog.ts","utf8")).toContain('"eicher"');
    expect(readFileSync("client/public/seo-bridge.php","utf8")).toContain("get-quote/?");
    expect(readFileSync("client/public/.htaccess","utf8")).toContain("get-quote/?");
    expect(publicRecord({ brand: "E&#105;cher" })).toBe(false);
  });
  it("filters public arrays/details/HTML but leaves historical quote and staff projections intact", async () => {
    const app=express(); app.use(publicVisibility);
    app.get("/api/parts/123",(_q,r)=>r.json({description:"Eicher part"}));
    app.get("/api/products",(_q,r)=>r.json([{brand:"eicher"},{brand:"tata"}]));
    app.get("/api/admin/products",(_q,r)=>r.json([{brand:"eicher"}]));
    app.get("/api/quote/history",(_q,r)=>r.json({description:"Eicher enquiry"}));
    app.get("/public-blog/html/test",(_q,r)=>r.type("html").send("<html><h1>VECV</h1></html>"));
    const s=await new Promise<any>(resolve=>{const server=app.listen(0,"127.0.0.1",()=>resolve(server));});
    const url=`http://127.0.0.1:${s.address().port}`;
    try {
      expect((await fetch(url+"/api/parts/123")).status).toBe(404);
      expect(await (await fetch(url+"/api/products")).json()).toEqual([{brand:"tata"}]);
      expect(await (await fetch(url+"/api/admin/products")).json()).toEqual([{brand:"eicher"}]);
      expect((await fetch(url+"/api/quote/history")).status).toBe(200);
      const html=await fetch(url+"/public-blog/html/test"); expect(html.status).toBe(404);expect(html.headers.get("x-robots-tag")).toBe("noindex");
    } finally {s.close();}
  });
});
