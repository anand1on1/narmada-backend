import { beforeAll,afterAll,beforeEach,describe,it,expect } from "vitest";
import express from "express";
import { Readable } from "node:stream";
import { request as httpRequest, type Server } from "node:http";
import { randomUUID,createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { register } from "tsx/cjs/api";
import { rawSqlite as db } from "../../server/storage";
import { registerV2Routes } from "../../server/routes-v2";
import { startUpload,uploadChunk,finishUpload,createJob,runCatalogBatch } from "../../server/price-catalog";
import { streamPriceCsv,CSV_MAX_BYTES,CSV_MAX_RECORD_CHARS } from "../../server/price-csv-stream";
let server:Server,base:string;
const unregister=register();
const endpoint="/api/admin/catalog-sync/csv-imports";
const auth={"x-admin-token":"csv-admin"};
beforeAll(async()=>{
  const app=express();
  // Execute the existing production CORS block verbatim, without booting the
  // application or its network/background jobs. No duplicate test-only policy.
  const entry=readFileSync("server/index.ts","utf8");
  const cors=entry.slice(entry.indexOf("const ALLOWED_ORIGINS"),entry.indexOf("// Health check"));
  new Function("app","process",transformSync(cors,{loader:"ts",format:"cjs"}).code)(app,{env:{ALLOWED_ORIGINS:"https://narmadamobility.com"}});
  app.use(express.json({limit:"20mb"}));
  registerV2Routes(app,{tokenMap:new Map([["csv-admin",{username:"csv-fixture",role:"admin"}],["csv-sales",{username:"sales",role:"sales"}]]) as any,
    primaryAdminUsername:"fixture",primaryAdminPassword:"unused",regenSitemap:async()=>({urlCount:0}),uploadsDir:process.env.DATA_DIR!});
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));unregister();});
beforeEach(()=>{
  for(const t of ["catalog_csv_imports","catalog_audit","catalog_prices","products","price_items","catalog_chunks","catalog_jobs","catalog_uploads","price_lists"]) db.exec(`DELETE FROM ${t}`);
  db.prepare("INSERT INTO settings(key,value) VALUES('catalog_auto_sync','false') ON CONFLICT(key) DO UPDATE SET value='false'").run();
  db.prepare("INSERT INTO settings(key,value) VALUES('catalog_verified_fx',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({rate:83.5,at:1700000000000}));
});
const post=(path:string,body:any,headers=auth)=>fetch(base+path,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(body)});
async function begin(csv:Buffer|string,extra:any={}) {
  const r=await post(endpoint,{requestKey:randomUUID(),brand:"tata",encoding:"utf-8",bytes:Buffer.byteLength(csv),...extra});
  expect(r.status).toBe(200);return r.json();
}
async function send(id:number,csv:Buffer|string) {
  const r=await fetch(`${base}${endpoint}/${id}/content`,{method:"PUT",headers:{...auth,"Content-Type":"text/csv"},body:csv});
  const text=await r.text();return {status:r.status,events:text.trim().split("\n").map(s=>JSON.parse(s))};
}
async function state(id:number) {return (await fetch(`${base}${endpoint}/${id}`,{headers:auth})).json();}
const good="part_number,description,mrp,dealer_price,gst_percent\n000-A,\"Quoted, \"\"name\"\"\nline\",835,600,18%\n000-B,Zero metadata,1670,0,0\n";
describe("strict bounded CSV parsing",()=>{
  it("preserves split UTF-8, BOM, CRLF, quoted newlines/commas/escaped quotes and identifiers",async()=>{
    const text='\uFEFFpart_number,description,mrp\r\n000-A,"₹ note, ""quoted""\r\nline",835\r\n';
    const rows:any[]=[];
    const result=await streamPriceCsv(Readable.from([...Buffer.from(text)].map(b=>Buffer.from([b]))),"utf-8",async b=>{rows.push(...b);});
    expect(rows).toEqual([expect.objectContaining({partNumber:"000-A",description:'₹ note, "quoted"\r\nline',mrp:"835"})]);
    expect(result.sha256).toBe(createHash("sha256").update(text).digest("hex"));
  });
  it.each([
    ["part_number,mrp\nA,\"1",/unterminated/],
    ['part_number,mrp\nA,"1"x',/after closing quote/],
    ['part_number,mrp\nA,1"2',/inside an unquoted/],
    ["part_number,mrp\nA,1,extra",/column count/],
    ["part_number,part_number,mrp\nA,A,1",/duplicate/],
    ["part_number,mrp\nA,"+"x".repeat(CSV_MAX_RECORD_CHARS),/record exceeds/],
  ])("rejects malformed CSV without partial record publication",async(csv,error)=>{
    await expect(streamPriceCsv(Readable.from([Buffer.from(csv)]),"utf-8",async()=>{})).rejects.toThrow(error);
  });
  it("rejects byte and row limits independently",async()=>{
    const csv=Buffer.from("part_number,mrp\nA,835\nB,835");
    await expect(streamPriceCsv(Readable.from([csv]),"utf-8",async()=>{},{bytes:20,rows:100})).rejects.toThrow("bytes");
    await expect(streamPriceCsv(Readable.from([csv]),"utf-8",async()=>{},{bytes:100,rows:1})).rejects.toThrow("data rows");
  });
  it("reports damaged description byte at exact CSV record/column; does not guess encoding",async()=>{
    const csv=Buffer.concat([Buffer.from("part_number,description,mrp\n000-A,bad"),Buffer.from([0xbf]),Buffer.from(",835\n")]);
    await expect(streamPriceCsv(Readable.from([csv]),"utf-8",async()=>{})).rejects.toThrow(/record 2, column description/);
    await expect(streamPriceCsv(Readable.from([Buffer.from("part_number,mrp\nA,"),Buffer.from([0xf0,0x80])]),"utf-8",async()=>{})).rejects.toThrow("Invalid utf-8");
    await expect(streamPriceCsv(Readable.from([Buffer.from("part_number,description,mrp\nA,"),Buffer.from([0xe2,0x82])]),"utf-8",async()=>{})).rejects.toThrow("Incomplete utf-8");
  });
  it("supports explicit strict Windows-1252 but rejects its undefined bytes",async()=>{
    const prefix=Buffer.from("part_number,description,mrp\nA,");
    const rows:any[]=[];
    await streamPriceCsv(Readable.from([prefix,Buffer.from([0xa3]),Buffer.from(",835")]),"windows-1252",async b=>{rows.push(...b);});
    expect(rows[0].description).toBe("£");
    await expect(streamPriceCsv(Readable.from([prefix,Buffer.from([0x8f]),Buffer.from(",835")]),"windows-1252",async()=>{})).rejects.toThrow("Invalid windows-1252");
  });
  it("streams 400,000 synthetic rows larger than the real file in batches of at most 500 without a physical fixture or database",async()=>{
    let seen=0,maxBatch=0,batches=0;
    async function* generate() {
      yield Buffer.from("part_number,description,mrp\n");
      for(let i=0;i<400000;i+=100) yield Buffer.from(Array.from({length:100},(_,j)=>`000-${i+j},${"synthetic ".repeat(7)},835\n`).join(""));
    }
    const result=await streamPriceCsv(Readable.from(generate()),"utf-8",async rows=>{
      seen+=rows.length;maxBatch=Math.max(maxBatch,rows.length);batches++;
    });
    expect(result.rows).toBe(400000);expect(seen).toBe(400000);expect(maxBatch).toBe(500);expect(batches).toBe(800);
    expect(result.bytes).toBeGreaterThan(19276411);expect(result.bytes).toBeLessThan(CSV_MAX_BYTES);
  },20000);
});
describe("authenticated large CSV staging",()=>{
  it("serves the real existing CORS preflight for raw CSV PUT and admin header",async()=>{
    const headers={Origin:"https://narmadamobility.com","Access-Control-Request-Method":"PUT","Access-Control-Request-Headers":"content-type,x-admin-token"};
    const r=await fetch(base+endpoint+"/1/content",{method:"OPTIONS",headers});
    expect(r.status).toBe(204);expect(r.headers.get("access-control-allow-origin")).toBe(headers.Origin);
    expect(r.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(r.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    expect(r.headers.get("access-control-allow-headers")).toContain("x-admin-token");
    const denied=await fetch(base+endpoint+"/1/content",{method:"OPTIONS",headers:{...headers,Origin:"https://untrusted.example"}});
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("requires actual admin role on creation, streaming and status",async()=>{
    for(const headers of [{},{"x-admin-token":"csv-sales"}]) {
      const expected=Object.keys(headers).length?403:401;
      expect((await post(endpoint,{},headers as any)).status).toBe(expected);
      expect((await fetch(base+endpoint+"/1",{headers})).status).toBe(expected);
      expect((await fetch(base+endpoint+"/1/content",{method:"PUT",headers})).status).toBe(expected);
    }
    expect(db.prepare("SELECT count(*) n FROM catalog_uploads").get()).toEqual({n:0});
  });
  it("validates metadata, persists idempotent session and bounds rate/size",async()=>{
    expect((await post(endpoint,{brand:"tata",requestKey:randomUUID(),encoding:"utf-8",bytes:CSV_MAX_BYTES+1})).status).toBe(413);
    expect((await post(endpoint,{brand:"tata",requestKey:randomUUID(),encoding:"latin1",bytes:100})).status).toBe(400);
    const key=randomUUID(),u=await begin(good,{requestKey:key});
    expect((await begin(good,{requestKey:key})).upload_id).toBe(u.upload_id);
    expect((await post(endpoint,{brand:"tata",requestKey:key,encoding:"utf-8",bytes:10})).status).toBe(409);
    for(let i=0;i<5;i++) await begin(good);
    expect((await post(endpoint,{brand:"tata",requestKey:randomUUID(),encoding:"utf-8",bytes:good.length})).status).toBe(429);
    for(let i=0;i<8;i++) expect((await state(u.upload_id)).state).toBe("pending");
    expect((await begin(good,{requestKey:key})).upload_id).toBe(u.upload_id);
  });
  it("imports native text/metadata through existing validation; sync remains off and complete retry adds no rows",async()=>{
    const u=await begin(good);const r=await send(u.upload_id,good);
    expect(r.events.at(-1)).toMatchObject({event:"complete",staged_rows:2,publication:{job:null,autoSync:false}});
    expect(db.prepare("SELECT part_number,mrp,dealer_price,gst_percent FROM price_items ORDER BY id").all()).toEqual([
      {part_number:"000-A",mrp:835,dealer_price:600,gst_percent:18},{part_number:"000-B",mrp:1670,dealer_price:0,gst_percent:0},
    ]);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({n:0});
    expect((await send(u.upload_id,good)).events[0].alreadyComplete).toBe(true);
    expect(db.prepare("SELECT count(*) n FROM price_items").get()).toEqual({n:2});
  });
  it("retains blank-part rows for existing publication rejection without silently dropping source records",async()=>{
    const csv="part_number,mrp\n,835\n000-A,835\n",u=await begin(csv);
    expect((await send(u.upload_id,csv)).events.at(-1)).toMatchObject({event:"complete",parsed_rows:2,staged_rows:2});
    const job=createJob(db,{listId:u.list_id,mode:"publish",requestKey:randomUUID()}) as any;
    expect(runCatalogBatch(db,job.id)).toMatchObject({created:1,rejected:1});
  });
  it("preserves existing dealer/GST carryforward, blank MRP staging and enabled-sync job idempotency",async()=>{
    const old=startUpload(db,{brand:"tata",requestKey:randomUUID()}) as any;
    uploadChunk(db,old.id,0,[{partNumber:"000-A",mrp:835,dealerPrice:600,gstPercent:0}]);finishUpload(db,old.id);
    db.prepare("UPDATE settings SET value='true' WHERE key='catalog_auto_sync'").run();
    const csv="part_number,mrp\n000-A,1670\nBAD,\n";
    const u=await begin(csv);await send(u.upload_id,csv);
    expect(db.prepare("SELECT dealer_price,gst_percent FROM price_items WHERE price_list_id=? AND part_number='000-A'").get(u.list_id)).toEqual({dealer_price:600,gst_percent:0});
    expect(db.prepare("SELECT mrp FROM price_items WHERE price_list_id=? AND part_number='BAD'").get(u.list_id)).toEqual({mrp:null});
    const job=db.prepare("SELECT * FROM catalog_jobs WHERE list_id=?").get(u.list_id) as any;
    expect(job.state).toBe("queued");expect(runCatalogBatch(db,job.id)).toMatchObject({created:1,rejected:1});
    expect(db.prepare("SELECT price_usd FROM catalog_prices WHERE part_key='000-a'").get()).toEqual({price_usd:20});
    await send(u.upload_id,csv);
    expect(db.prepare("SELECT count(*) n FROM catalog_jobs WHERE list_id=?").get(u.list_id)).toEqual({n:1});
  });
  it("keeps failed UTF-8 imports invisible and prevents direct finish/chunk/deletion bypass",async()=>{
    const old=startUpload(db,{brand:"tata",requestKey:randomUUID()}) as any;
    uploadChunk(db,old.id,0,[{partNumber:"OLD",mrp:835}]);finishUpload(db,old.id);
    const job=createJob(db,{listId:old.list_id,mode:"publish",requestKey:randomUUID()}) as any;runCatalogBatch(db,job.id);
    const before=db.prepare("SELECT * FROM catalog_prices").all();
    const prefix="part_number,description,mrp\n"+Array.from({length:500},(_,i)=>`NEW-${i},valid,835\n`).join("");
    const csv=Buffer.concat([Buffer.from(prefix+"BAD,damaged"),Buffer.from([0xbf]),Buffer.from(",100\n")]);
    const u=await begin(csv);const r=await send(u.upload_id,csv);
    expect(r.events.at(-1).error).toMatch(/record 502, column description/);
    expect(await state(u.upload_id)).toMatchObject({state:"failed",staged_rows:500,upload_status:"uploading"});
    expect(db.prepare("SELECT * FROM catalog_prices").all()).toEqual(before);
    expect((await post(`/api/admin/catalog-sync/uploads/${u.upload_id}/finish`,{})).status).toBe(400);
    expect((await post(`/api/admin/catalog-sync/uploads/${u.upload_id}/chunks`,{seq:1,rows:[{partNumber:"BYPASS",mrp:100}]})).status).toBe(400);
    expect((await fetch(`${base}/api/admin/price-lists/${u.list_id}`,{method:"DELETE",headers:auth})).status).toBe(409);
    const publicRows=await(await fetch(base+"/api/price-lists/search?q=NEW")).json();expect(publicRows.count).toBe(0);
  });
  it("rolls back malformed private metadata chunk and checks changed retry chunks",async()=>{
    const prefix="part_number,mrp,dealer_price\n"+Array.from({length:500},(_,i)=>`P-${i},835,600\n`).join("");
    const bad=prefix+"BAD,835,nope\n",u=await begin(bad);
    expect((await send(u.upload_id,bad)).events.at(-1).error).toContain("Invalid dealer_price");
    expect(await state(u.upload_id)).toMatchObject({staged_rows:500,upload_status:"uploading"});
    expect((await send(u.upload_id,bad)).status).toBe(429);
    db.prepare("UPDATE catalog_csv_imports SET attempted_at=0 WHERE upload_id=?").run(u.upload_id);
    expect((await send(u.upload_id,bad.replace("P-0,835","P-0,836"))).events.at(-1).error).toContain("Chunk retry differs");
    expect(db.prepare("SELECT mrp FROM price_items WHERE price_list_id=? AND part_number='P-0'").get(u.list_id)).toEqual({mrp:835});
  });
  it("blocks concurrent streams, exposes progress and safely retries an aborted final record",async()=>{
    const csv="part_number,mrp\n"+Array.from({length:501},(_,i)=>`P-${i},835\n`).join("");
    const u=await begin(csv),v=await begin(csv);
    const req=httpRequest(`${base}${endpoint}/${u.upload_id}/content`,{method:"PUT",headers:{...auth,"Content-Type":"text/csv","Content-Length":Buffer.byteLength(csv)}});
    const started=new Promise<void>((resolve,reject)=>{req.on("response",r=>{r.on("data",()=>resolve());r.on("error",()=>{});});req.on("error",()=>{});req.once("error",reject);});
    req.write(csv.slice(0,csv.lastIndexOf("P-500")));await started;
    expect((await send(v.upload_id,csv)).status).toBe(409);
    req.destroy();
    for(let i=0;i<100;i++) {
      if((await state(u.upload_id)).state==="failed") break;
      await new Promise(r=>setImmediate(r));
    }
    expect(await state(u.upload_id)).toMatchObject({state:"failed",upload_status:"uploading",staged_rows:500});
    db.prepare("UPDATE catalog_csv_imports SET attempted_at=0 WHERE upload_id=?").run(u.upload_id);
    expect((await send(u.upload_id,csv)).events.at(-1)).toMatchObject({event:"complete",staged_rows:501});
    expect(db.prepare("SELECT count(*) n FROM price_items WHERE price_list_id=?").get(u.list_id)).toEqual({n:501});
  });
  it("cannot finalize earlier staged extra chunks after a shorter changed-file retry of the same byte length",async()=>{
    const header="part_number,mrp,dealer_price\n";
    const rows=Array.from({length:1000},(_,i)=>`P-${i},835,600\n`);
    const bad=header+rows.join("")+"BAD,835,nope\n",u=await begin(bad);
    await send(u.upload_id,bad);
    expect(await state(u.upload_id)).toMatchObject({staged_rows:1000,state:"failed"});
    const prefix=header+rows.slice(0,500).join("");
    const changed=prefix+"\n".repeat(Buffer.byteLength(bad)-Buffer.byteLength(prefix));
    db.prepare("UPDATE catalog_csv_imports SET attempted_at=0 WHERE upload_id=?").run(u.upload_id);
    expect((await send(u.upload_id,changed)).events.at(-1).error).toContain("row/chunk count differs");
    expect(await state(u.upload_id)).toMatchObject({state:"failed",upload_status:"uploading"});
  });
  it("recovers stale leases without accepting a stale owner's append; rejects compression and size mismatch",async()=>{
    const u=await begin(good);
    db.prepare("UPDATE catalog_csv_imports SET state='streaming',lease_token='old',lease_until=1 WHERE upload_id=?").run(u.upload_id);
    expect(await state(u.upload_id)).toMatchObject({state:"interrupted"});
    expect(()=>uploadChunk(db,u.upload_id,0,[{partNumber:"STALE",mrp:100}],{csvLease:"old"})).toThrow("protected CSV");
    expect((await fetch(`${base}${endpoint}/${u.upload_id}/content`,{method:"PUT",headers:{...auth,"Content-Type":"text/csv","Content-Encoding":"gzip"},body:good})).status).toBe(415);
    expect((await send(u.upload_id,"short")).status).toBe(409);
    expect((await send(u.upload_id,good)).events.at(-1).event).toBe("complete");
  });
  it("accepts chunked HTTP without Content-Length and rejects truncated declared file bytes before finish",async()=>{
    async function chunked(id:number) {
      return new Promise<any>((resolve,reject)=>{
        const req=httpRequest(`${base}${endpoint}/${id}/content`,{method:"PUT",headers:{...auth,"Content-Type":"text/csv"}},res=>{
          let text="";res.on("data",b=>{text+=b;});res.on("end",()=>resolve(JSON.parse(text.trim().split("\n").at(-1)!)));res.on("error",reject);
        });
        req.on("error",reject);req.write(good.slice(0,30));req.end(good.slice(30));
      });
    }
    const complete=await begin(good);
    expect(await chunked(complete.upload_id)).toMatchObject({event:"complete",staged_rows:2});
    const truncated=await begin(good,{bytes:Buffer.byteLength(good)+1});
    expect(await chunked(truncated.upload_id)).toMatchObject({event:"error",error:expect.stringContaining("declared byte length")});
    expect(await state(truncated.upload_id)).toMatchObject({state:"failed",upload_status:"uploading"});
  });
});
