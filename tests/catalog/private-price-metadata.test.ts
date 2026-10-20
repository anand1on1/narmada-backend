import { beforeAll,afterAll,beforeEach,describe,it,expect } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { register } from "tsx/cjs/api";
import { rawSqlite as db,storage } from "../../server/storage";
import { registerV2Routes } from "../../server/routes-v2";
import { lookupPartNumberMrp,searchPriceItems } from "../../server/storage-v2";
import { registerPublicCatalog } from "../../server/public-catalog";
import { createJob,runCatalogBatch } from "../../server/price-catalog";
let server:Server,base:string;
// The existing full V2 registrar has late CommonJS requires of .ts modules.
// Use the already-installed application loader rather than mocking the checker.
const unregister=register();
beforeAll(async()=>{
  const app=express();app.use(express.json());
  registerV2Routes(app,{tokenMap:new Map([["private-fixture",{username:"fixture",role:"admin"}],["non-admin",{username:"other",role:"sales"}]]) as any,primaryAdminUsername:"fixture",primaryAdminPassword:"unused",regenSitemap:async()=>({urlCount:0}),uploadsDir:process.env.DATA_DIR!});
  app.get("/api/products/:slug",async(req,res)=>{const p=await storage.getProductBySlug(req.params.slug);p?res.json(p):res.sendStatus(404);});
  registerPublicCatalog(app,db);
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{if(server) await new Promise<void>(r=>server.close(()=>r()));unregister();});
beforeEach(()=>{
  for(const t of ["catalog_audit","catalog_prices","products","price_items","catalog_chunks","catalog_jobs","catalog_uploads","price_lists"]) db.exec(`DELETE FROM ${t}`);
  db.prepare("INSERT INTO settings(key,value) VALUES('catalog_verified_fx',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({rate:83.5,at:1700000000000}));
  db.prepare("INSERT INTO settings(key,value) VALUES('catalog_auto_sync','false') ON CONFLICT(key) DO UPDATE SET value='false'").run();
});
const post=(path:string,body:any)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":"private-fixture"},body:JSON.stringify(body)});
async function upload(rows:any[],brand="tata",requestKey=randomUUID()) {
  const u=await(await post("/api/admin/catalog-sync/uploads",{brand,requestKey})).json();
  const c=await post(`/api/admin/catalog-sync/uploads/${u.id}/chunks`,{seq:0,rows});
  expect(c.status).toBe(200);
  const finish=await post(`/api/admin/catalog-sync/uploads/${u.id}/finish`,{});
  expect(finish.status).toBe(200);return {...u,requestKey};
}
async function latest(part="001-A",brand="tata") {
  const r=await fetch(`${base}/api/admin/price-lists/search?part_number=${encodeURIComponent(part)}&brand=${brand}`,{headers:{"x-admin-token":"private-fixture"}});
  expect(r.status).toBe(200);return (await r.json()).results.find((p:any)=>p.partNumber.toLowerCase()===part.toLowerCase());
}
const row=(extra:any={})=>({partNumber:"001-A",description:"Metadata fixture",mrp:835,...extra});
function publish(listId:number) {
  const j=createJob(db,{requestKey:randomUUID(),listId,mode:"publish"}) as any;
  expect(runCatalogBatch(db,j.id)).toMatchObject({rejected:0});return j;
}
describe("private price-list metadata through actual upload/checker routes",()=>{
  it("imports provided CSV dealer/GST updates and latest-row lookup including timestamp ties",async()=>{
    const a=await post("/api/admin/price-lists",{brand:"tata",csv:'part_number,mrp,dealer_price,gst_percent,description\n001-A,835,"₹1,200.00",18%,Actual description'});
    expect(a.status).toBe(200);
    expect(await latest()).toMatchObject({dealerPrice:1200,gstPercent:18,mrp:835});
    await upload([row({dealerPrice:619.77,gstPercent:12,mrp:1670})]);
    db.exec("UPDATE price_lists SET uploaded_at=12345");
    expect(await latest()).toMatchObject({dealerPrice:619.77,gstPercent:12,mrp:1670});
    expect(lookupPartNumberMrp("001-A")).toMatchObject({gstPercent:12,mrp:1670});
    expect((await searchPriceItems("001-A","tata"))[0].dealerPrice).toBe(619.77);
  });
  it("carries omitted/blank metadata, but preserves explicit permitted zeros",async()=>{
    await upload([row({dealerPrice:600,gstPercent:18})]);
    await upload([row({mrp:900,dealerPrice:"",gstPercent:""})]);
    expect(await latest()).toMatchObject({dealerPrice:600,gstPercent:18,mrp:900});
    await upload([row({dealerPrice:"0",gstPercent:0})]);
    expect(await latest()).toMatchObject({dealerPrice:0,gstPercent:0});
    await upload([row()]);
    expect(await latest()).toMatchObject({dealerPrice:0,gstPercent:0});
    expect(lookupPartNumberMrp("001-A")?.gstPercent).toBe(0);
  });
  it("new records remain null and never inherit another brand or punctuation-distinct part",async()=>{
    await upload([row({dealerPrice:600,gstPercent:18})]);
    await upload([row()],"volvo");
    expect(await latest("001-A","volvo")).toMatchObject({dealerPrice:null,gstPercent:null});
    await upload([row({partNumber:"001A"}),row({partNumber:"NEW-001"})]);
    expect(await latest("001A")).toMatchObject({dealerPrice:null,gstPercent:null});
    expect(await latest("NEW-001")).toMatchObject({dealerPrice:null,gstPercent:null});
    expect(await latest()).toMatchObject({dealerPrice:600,gstPercent:18});
  });
  it("finds the most recent valid private fields independently and ignores unfinished uploads",async()=>{
    await upload([row({dealerPrice:600,gstPercent:0})]);
    const b=await upload([row({dealerPrice:700,gstPercent:18})]);
    // Simulate an older importer that appended NULL without erasing historical fields.
    db.prepare("UPDATE price_items SET gst_percent=NULL WHERE price_list_id=?").run(b.list_id);
    const staged=await(await post("/api/admin/catalog-sync/uploads",{brand:"tata",requestKey:randomUUID()})).json();
    await post(`/api/admin/catalog-sync/uploads/${staged.id}/chunks`,{seq:0,rows:[row({dealerPrice:999,gstPercent:28})]});
    await upload([row()]);
    expect(await latest()).toMatchObject({dealerPrice:700,gstPercent:0});
  });
  it.each([{dealerPrice:"garbage"},{dealerPrice:-1},{gstPercent:101},{gstPercent:"18bad"},{gstPercent:-1}])("rejects malformed metadata atomically: %j",async bad=>{
    await upload([row({dealerPrice:600,gstPercent:18})]);
    const u=await(await post("/api/admin/catalog-sync/uploads",{brand:"tata",requestKey:randomUUID()})).json();
    const r=await post(`/api/admin/catalog-sync/uploads/${u.id}/chunks`,{seq:0,rows:[row({partNumber:"FIRST"}),row(bad)]});
    expect(r.status).toBe(400);expect((await r.json()).error).toMatch(/Invalid (dealer_price|gst_percent)/);
    expect(db.prepare("SELECT count(*) n FROM price_items WHERE price_list_id=?").get(u.list_id)).toEqual({n:0});
    expect(await latest()).toMatchObject({dealerPrice:600,gstPercent:18});
  });
  it("keeps upload retry idempotent and public API/HTML/schema free of private dealer costs",async()=>{
    const u=await upload([row({dealerPrice:619.77,gstPercent:12})]);
    await upload([row({dealerPrice:619.77,gstPercent:12})],"tata",u.requestKey);
    expect(db.prepare("SELECT count(*) n FROM price_items").get()).toEqual({n:1});
    publish(u.list_id);
    const p=await storage.getProductByPartNumber("001-A","tata");
    expect(p?.priceUsd).toBe(10);
    const denied=await fetch(base+"/api/admin/price-lists/search?q=001-A");
    expect(denied.status).toBe(401);
    expect((await fetch(base+"/api/admin/price-lists/search?q=001-A",{headers:{"x-admin-token":"non-admin"}})).status).toBe(403);
    const publicChecker=await(await fetch(base+"/api/price-lists/search?q=001-A&brand=tata")).json();
    expect(publicChecker.results[0]).not.toHaveProperty("dealerPrice");
    const publicProduct=await(await fetch(base+"/api/products/"+p!.slug)).json();
    expect(publicProduct).toMatchObject({priceUsd:10,priceCurrency:"USD",taxIncluded:true});
    const html=await(await fetch(base+"/product/001-A/"+p!.slug)).text();
    expect(html).toContain('\"priceCurrency\":\"USD\"');expect(html).toContain('\"price\":\"10.00\"');
    expect(JSON.stringify(publicChecker)+JSON.stringify(publicProduct)+html).not.toContain("619.77");
    expect(JSON.stringify(publicProduct)+html).not.toMatch(/dealer_price|dealerPrice/);
    await storage.updateProduct(p!.id,{description:"Rich documented content",imageUrls:'["/actual.jpg"]',compatibleModels:'["Verified model"]'});
    const update=await upload([row({mrp:1670,dealerPrice:500,gstPercent:28,description:"Flat source text"})]);publish(update.list_id);
    expect(await storage.getProduct(p!.id)).toMatchObject({slug:p!.slug,description:"Rich documented content",imageUrls:'["/actual.jpg"]',compatibleModels:'["Verified model"]',priceUsd:20});
  });
});
