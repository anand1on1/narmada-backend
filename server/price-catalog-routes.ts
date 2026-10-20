import type { Express, RequestHandler } from "express";
import type { Database } from "better-sqlite3";
import Papa from "papaparse";
import { createHash } from "node:crypto";
import { catalogFx, createJob, finishUpload, rollbackBatch, runCatalogBatch, startUpload, uploadChunk } from "./price-catalog";

export function registerPriceCatalog(app: Express, db: Database, admin: RequestHandler) {
  const safe = (fn: (req: any) => any): RequestHandler => (req,res) => {
    try { res.json(fn(req)); } catch(e) { res.status(400).json({error:(e as Error).message}); }
  };
  app.get("/api/admin/catalog-sync",admin,safe(() => ({
    enabled:(db.prepare("SELECT value FROM settings WHERE key='catalog_auto_sync'").get() as any)?.value==="true",
    fx:catalogFx(db),
    jobs:db.prepare("SELECT * FROM catalog_jobs ORDER BY id DESC LIMIT 30").all(),
  })));
  app.post("/api/admin/catalog-sync/settings",admin,safe(req => {
    if(typeof req.body?.enabled!=="boolean") throw Error("enabled must be boolean");
    db.prepare("INSERT INTO settings(key,value) VALUES('catalog_auto_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(req.body.enabled));
    return {enabled:req.body.enabled};
  }));
  app.post("/api/admin/catalog-sync/uploads",admin,safe(req=>startUpload(db,req.body)));
  app.post("/api/admin/catalog-sync/uploads/:id/chunks",admin,safe(req=>uploadChunk(db,Number(req.params.id),req.body.seq,req.body.rows)));
  app.post("/api/admin/catalog-sync/uploads/:id/finish",admin,safe(req=>finishUpload(db,Number(req.params.id))));
  app.post("/api/admin/catalog-sync/jobs",admin,safe(req=>createJob(db,req.body)));
  app.get("/api/admin/catalog-sync/jobs/:id/audit",admin,safe(req=>{
    const cursor=Number(req.query.after || 0);
    if(!Number.isSafeInteger(cursor) || cursor<0) throw Error("Invalid cursor");
    return db.prepare("SELECT id,item_id,outcome,reason,product_id,created_at FROM catalog_audit WHERE job_id=? AND id>? ORDER BY id LIMIT 100").all(Number(req.params.id),cursor);
  }));
  app.post("/api/admin/catalog-sync/jobs/:id/control",admin,safe(req=>{
    const id=Number(req.params.id), action=req.body.action;
    const job=db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(id) as any;
    if(!job) throw Error("Job not found");
    if(action==="pause") db.prepare("UPDATE catalog_jobs SET state='paused' WHERE id=? AND state IN ('queued','running','waiting_fx')").run(id);
    else if(action==="resume") db.prepare("UPDATE catalog_jobs SET state=?,error=NULL WHERE id=? AND state IN ('paused','failed')").run(job.mode==="publish" && !job.fx_rate ? "waiting_fx":"queued",id);
    else if(action==="reverse" && req.body.confirm===true && job.mode==="publish" && ["complete","paused"].includes(job.state))
      db.prepare("UPDATE catalog_jobs SET state='rollback' WHERE id=?").run(id);
    else throw Error("Invalid control or explicit reversal confirmation missing");
    return db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(id);
  }));
  // Backward-compatible bounded CSV entry; native Excel UI uses 500-row chunks.
  app.post("/api/admin/price-lists",admin,safe(req=>{
    if(typeof req.body.csv!=="string" || Buffer.byteLength(req.body.csv)>1000000) throw Error("Use the chunked Excel uploader for large files");
    const parsed=Papa.parse<any>(req.body.csv,{header:true,skipEmptyLines:true,transformHeader:h=>h.trim().toLowerCase().replace(/\s+/g,"_")});
    if(parsed.errors.length || parsed.data.length>5000) throw Error("Invalid CSV or over 5000 rows; use chunked uploader");
    const requestKey=req.body.requestKey || "csv-"+createHash("sha256").update(JSON.stringify([req.body.brand,req.body.versionLabel,req.body.effectiveDate,req.body.csv])).digest("hex");
    const upload=startUpload(db,{...req.body,requestKey}) as any;
    for(let i=0;i<parsed.data.length;i+=500) uploadChunk(db,upload.id,i/500,parsed.data.slice(i,i+500).map(r=>({
      partNumber:r.part_number || r.partnumber || r.part_no, description:r.description,mrp:r.mrp,hsnCode:r.hsn_code,uom:r.uom,
    })));
    return {...finishUpload(db,upload.id),ok:true,inserted:parsed.data.length,errors:[]};
  }));
  // Resumes only explicitly requested jobs, never creates a backfill at boot.
  if(process.env.NODE_ENV!=="test") {
    const timer=setInterval(()=>{
      const fx=catalogFx(db);
      if(fx) db.prepare("UPDATE catalog_jobs SET state='queued',fx_rate=?,fx_at=? WHERE state='waiting_fx'").run(fx.rate,fx.at);
      const job=db.prepare("SELECT id,state FROM catalog_jobs WHERE state IN ('queued','running','rollback') ORDER BY id LIMIT 1").get() as any;
      if(!job) return;
      try { if(job.state==="rollback") rollbackBatch(db,job.id); else runCatalogBatch(db,job.id); }
      catch(e) { db.prepare("UPDATE catalog_jobs SET state='failed',error=? WHERE id=?").run(String((e as Error).message).slice(0,500),job.id); }
    },1000);
    timer.unref();
  }
}
