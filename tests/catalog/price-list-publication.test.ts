import { beforeEach, afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { transformSync } from "esbuild";
import express from "express";
import { registerPriceCatalog } from "../../server/price-catalog-routes";
import { initPriceCatalog, startUpload, uploadChunk, finishUpload, createJob, runCatalogBatch, rollbackBatch, positivePrice, partKey, publicCatalogPrices, catalogFx, indexedCatalogQuery } from "../../server/price-catalog";
import { splitSitemapIndex, splitSitemapPage } from "../../server/catalog-sitemap";
import { renderProductPage } from "../../server/seo-templates";

let db: Database.Database;
function schema() {
  db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,name TEXT,brand TEXT,category TEXT,part_number TEXT,description TEXT,price_inr REAL,stock_qty INTEGER,image_urls TEXT,compatible_models TEXT,active INTEGER,featured INTEGER,created_at INTEGER,model TEXT,oem_number TEXT);
    CREATE TABLE price_lists(id INTEGER PRIMARY KEY,brand TEXT,version_label TEXT,item_count INTEGER,effective_date INTEGER,notes TEXT,uploaded_at INTEGER);
    CREATE TABLE price_items(id INTEGER PRIMARY KEY,brand TEXT,price_list_id INTEGER,part_number TEXT,part_number_clean TEXT,description TEXT,mrp REAL,dealer_price REAL,hsn_code TEXT,gst_percent REAL,uom TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE INDEX price_clean ON price_items(part_number_clean);
  `);
  initPriceCatalog(db);
  db.prepare("INSERT INTO settings VALUES('catalog_verified_fx',?)").run(JSON.stringify({rate:83.5,at:1700000000000}));
}
beforeEach(()=>{db=new Database(":memory:");schema();});
afterEach(()=>db.close());
function upload(rows:any[],brand="tata") {
  const u=startUpload(db,{requestKey:randomUUID(),brand}) as any;
  uploadChunk(db,u.id,0,rows);finishUpload(db,u.id);return u;
}
function job(listId?:number,mode="publish") {
  const j=createJob(db,{requestKey:randomUUID(),listId,mode}) as any;
  let out:any=j; while(["queued","running"].includes(out.state)) out=runCatalogBatch(db,j.id,2);
  return out;
}
const row=(partNumber:string,mrp:any=1000)=>({partNumber,mrp,description:"Actual filter"});
describe("price-list publication",()=>{
  it("preserves zeros/punctuation and rejects signed, blank, partial, nonfinite prices",()=>{
    expect(partKey(" 00A-1 ")).toBe("00a-1");
    for(const v of ["","-1",0,"₹100","1x","1e2",Infinity,null,"1,23"]) expect(positivePrice(v)).toBeNull();
    expect(positivePrice("1,234.50")).toBe(1234.5);
  });
  it("dry run never creates products; publication uses GST-inclusive MRP / verified FX",()=>{
    const u=upload([row("001-A",1000)]);
    expect(job(u.list_id,"dry-run").created).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({n:0});
    expect(job(u.list_id).created).toBe(1);
    const p=db.prepare("SELECT * FROM products").get() as any;
    expect(p.price_inr).toBe(1000);expect(p.stock_qty).toBe(0);
    expect(publicCatalogPrices(db,[p])[0]).toMatchObject({priceUsd:11.98,catalogPriced:true});
  });
  it("reupload preserves IDs, URLs and rich details, inserts new parts and retains omitted parts",()=>{
    const first=upload([row("001",835),row("002",1670)]);job(first.list_id);
    const p=db.prepare("SELECT * FROM products WHERE part_number='001'").get() as any;
    db.prepare("UPDATE products SET description='Rich description',image_urls='[\"/real.jpg\"]',compatible_models='[\"Documented model\"]' WHERE id=?").run(p.id);
    const next=upload([row("001",1670),row("003",2505)]);const j=job(next.list_id);
    expect(j).toMatchObject({created:1,updated:1,rejected:0});
    expect(db.prepare("SELECT * FROM products WHERE id=?").get(p.id)).toMatchObject({slug:p.slug,description:"Rich description",image_urls:'["/real.jpg"]',compatible_models:'["Documented model"]',price_inr:1670});
    expect(db.prepare("SELECT count(*) n FROM products WHERE active=1").get()).toEqual({n:3});
    expect(job(next.list_id).skipped).toBe(2);
  });
  it("retains last valid price and isolates brands and unsupported currencies",()=>{
    job(upload([row("001",835)]).list_id);
    const bad=upload([row("001","-10"),row("0",0),{...row("usd",100),sourceCurrency:"USD"}]);
    expect(job(bad.list_id).rejected).toBe(3);
    expect(db.prepare("SELECT price_inr FROM products WHERE part_number='001'").get()).toEqual({price_inr:835});
    expect(job(upload([row("001",1670)],"volvo").list_id).created).toBe(1);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({n:2});
  });
  it("retries chunks idempotently and rejects changed retries; distinct same-brand concurrent uploads converge on newer list",()=>{
    const a=startUpload(db,{requestKey:"retry-123456",brand:"tata"}) as any;
    expect((startUpload(db,{requestKey:"retry-123456",brand:"tata"}) as any).id).toBe(a.id);
    uploadChunk(db,a.id,0,[row("001",835)]);uploadChunk(db,a.id,0,[row("001",835)]);
    expect(()=>uploadChunk(db,a.id,0,[row("001",100)])).toThrow("differs");
    const b=upload([row("001",1670)]);job(b.list_id);finishUpload(db,a.id);
    expect(job(a.list_id).skipped).toBe(1);
    expect(db.prepare("SELECT price_inr FROM products").get()).toEqual({price_inr:1670});
  });
  it("reports conflicting duplicates and legacy punctuation collisions without collapsing identities",()=>{
    const u=upload([row("A",1),row("A",2),row("B",3),row("B",3),row("00-1",2),row("001",2)]);
    const j=job(u.list_id);expect(j).toMatchObject({created:1,skipped:1,rejected:4});
  });
  it("does not publish unfinished uploads, needs verified rate and keeps truthful stale snapshot",()=>{
    const u=startUpload(db,{requestKey:randomUUID(),brand:"tata"}) as any;uploadChunk(db,u.id,0,[row("1")]);
    expect(()=>job(u.list_id)).toThrow("incomplete");
    expect(job().rejected).toBe(1);finishUpload(db,u.id);
    db.exec("DELETE FROM settings");
    expect(catalogFx(db)).toBeNull();expect(()=>job(u.list_id)).toThrow("verified FX");
    db.prepare("INSERT INTO settings VALUES('catalog_verified_fx',?)").run(JSON.stringify({rate:100,at:1000}));
    job(u.list_id);
    expect(db.prepare("SELECT fx_rate,fx_at,price_usd FROM catalog_prices").get()).toEqual({fx_rate:100,fx_at:1000,price_usd:10});
  });
  it("rolls back only unchanged operation results and never deletes product identities",()=>{
    const first=job(upload([row("1",100),row("2",200)]).list_id);
    db.prepare("UPDATE products SET description='Changed later' WHERE part_number='2'").run();
    rollbackBatch(db,first.id);rollbackBatch(db,first.id);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({n:2});
    expect(db.prepare("SELECT active FROM products WHERE part_number='1'").get()).toEqual({active:0});
    expect(db.prepare("SELECT active FROM products WHERE part_number='2'").get()).toEqual({active:1});
    expect(db.prepare("SELECT count(*) n FROM catalog_audit WHERE outcome='reversal_conflict'").get()).toEqual({n:1});
  });
  it("renders matching public USD, no invented stock or discount, split sitemap and actual lastmod",()=>{
    job(upload([row("001-A",1000)]).list_id);
    const p=db.prepare("SELECT * FROM products").get() as any;
    const pub=publicCatalogPrices(db,[{...p,partNumber:p.part_number,priceInr:p.price_inr,stockQty:0}])[0];
    const html=renderProductPage(pub,[],{baseUrl:"https://narmadamobility.com",siteName:"Narmada Mobility",whatsappNumber:"919000000000"} as any);
    expect(html).toContain("US$11.98");expect(html).toContain('"priceCurrency":"USD"');
    expect(html).toContain("Contact us for a discount");
    expect(html).not.toContain('"availability"');expect(html).not.toContain("PreOrder");
    expect(splitSitemapIndex(db)).toContain("<sitemapindex");
    expect(splitSitemapPage(db,"0")).toContain("<lastmod>");
    expect(splitSitemapPage(db,"999")).toBeNull();
  });
  it("serializes genuinely concurrent worker transactions without duplicate publication",async()=>{
    const path=mkdtempSync("/dev/shm/catalog-concurrent-")+"/fixture.db";
    db.close();db=new Database(path);db.pragma("journal_mode=WAL");schema();
    const u=upload(Array.from({length:20},(_,i)=>row(`P${i}`,835)));
    const j=createJob(db,{requestKey:randomUUID(),listId:u.list_id,mode:"publish"}) as any;
    const code=transformSync(readFileSync("server/price-catalog.ts","utf8"),{loader:"ts",format:"cjs"}).code;
    const workerCode=`${code}
      const {workerData,parentPort}=require('node:worker_threads');
      const DB=require(workerData.modulePath);const db=new DB(workerData.path);
      for(let i=0;i<30;i++){const j=module.exports.runCatalogBatch(db,workerData.id,2);if(j.state==='complete')break;}
      db.close();parentPort.postMessage('done');`;
    const run=()=>new Promise((resolve,reject)=>{
      const w=new Worker(workerCode,{eval:true,workerData:{path,id:j.id,modulePath:require.resolve("better-sqlite3")}});
      w.once("message",resolve);w.once("error",reject);w.once("exit",c=>{if(c) reject(Error(`worker exit ${c}`));});
    });
    await Promise.all([run(),run()]);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({n:20});
    expect(db.prepare("SELECT processed,created FROM catalog_jobs WHERE id=?").get(j.id)).toEqual({processed:20,created:20});
  });
  it("admin API protects imports and explicit future-sync opt-in creates one resumable job",async()=>{
    const app=express();app.use(express.json());
    registerPriceCatalog(app,db,(req,res,next)=>req.headers["x-admin-token"]==="fixture" ? next():void res.sendStatus(403));
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
    const base=`http://127.0.0.1:${(server.address() as any).port}`;
    const post=async(path:string,body:any)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":"fixture"},body:JSON.stringify(body)});
    try {
      expect((await fetch(base+"/api/admin/catalog-sync")).status).toBe(403);
      expect(db.prepare("SELECT count(*) n FROM catalog_jobs").get()).toEqual({n:0});
      await post("/api/admin/catalog-sync/settings",{enabled:true});
      const u=await (await post("/api/admin/catalog-sync/uploads",{requestKey:randomUUID(),brand:"tata"})).json();
      const chunk={seq:0,rows:[row("api-001",835)]};
      expect((await post(`/api/admin/catalog-sync/uploads/${u.id}/chunks`,chunk)).status).toBe(200);
      await post(`/api/admin/catalog-sync/uploads/${u.id}/chunks`,chunk);
      const done=await (await post(`/api/admin/catalog-sync/uploads/${u.id}/finish`,{})).json();
      await post(`/api/admin/catalog-sync/uploads/${u.id}/finish`,{});
      expect(db.prepare("SELECT count(*) n FROM catalog_jobs").get()).toEqual({n:1});
      expect(runCatalogBatch(db,done.job.id)).toMatchObject({created:1,processed:1});
    } finally {await new Promise<void>(r=>server.close(()=>r()));}
  });
  it("builds the search index only on request and keeps substring searches current",()=>{
    job(upload([row("000123-X",835)]).list_id);
    expect(indexedCatalogQuery(db,"123")).toBeNull();
    job(undefined,"search-index");
    const query=indexedCatalogQuery(db,"123");
    expect(query).toBeTruthy();
    expect(db.prepare("SELECT rowid FROM catalog_search WHERE catalog_search MATCH ?").all(query)).toHaveLength(1);
    db.prepare("UPDATE products SET description='Documented replacement filter'").run();
    expect(db.prepare("SELECT rowid FROM catalog_search WHERE catalog_search MATCH ?").all('"replacement"')).toHaveLength(1);
  });
  it.runIf(process.env.CATALOG_SCALE_TEST==="1")("bounded 400k synthetic identity/page/sitemap query benchmark",()=>{
    const n=400000;
    const insert=db.prepare("INSERT INTO products(slug,name,brand,category,part_number,description,price_inr,active,created_at) VALUES(?,?,'tata','other',?,'Fixture',100,1,1700000000000)");
    const t=performance.now();
    db.transaction(()=>{for(let i=1;i<=n;i++){const part=String(i).padStart(9,"0");insert.run("p-"+part,"Fixture "+part,part);}})();
    const setupMs=performance.now()-t, timings:number[]=[];
    for(let i=0;i<30;i++) {
      const start=performance.now();
      expect(db.prepare("SELECT id FROM products WHERE lower(trim(brand))=? AND lower(trim(part_number))=?").get("tata","000399999")).toBeTruthy();
      expect((db.prepare("SELECT id FROM products WHERE active=1 ORDER BY id DESC LIMIT 24 OFFSET 399960").all()).length).toBe(24);
      expect((db.prepare("SELECT count(*) n FROM products WHERE active=1").get() as any).n).toBe(n);
      timings.push(performance.now()-start);
    }
    expect((splitSitemapIndex(db).match(/<sitemap>/g)||[]).length).toBe(401);
    expect((splitSitemapPage(db,"399")!.match(/<url>/g)||[]).length).toBe(1000);
    const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM products WHERE lower(trim(brand))=? AND lower(trim(part_number))=?").all("tata","000399999");
    expect(JSON.stringify(plan)).toContain("catalog_product_identity");
    console.log("SYNTHETIC_400K",JSON.stringify({setupMs,p95Ms:timings.sort((a,b)=>a-b)[28],plan,scope:"in-memory fixture; identity lookup + deep page + count, not production throughput"}));
  },60000);
});
