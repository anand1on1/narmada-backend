import type { Database } from "better-sqlite3";
import { createHash } from "node:crypto";

// ASCII case and surrounding whitespace only: preserve punctuation and zeros.
export const CATALOG_BRANDS = ["tata", "bharatbenz", "ashok-leyland", "eicher", "volvo", "scania", "mahindra", "force", "swaraj-mazda"];
export const partKey = (v: string) => v.trim().replace(/[A-Z]/g, c => c.toLowerCase());
export function identity(brand: unknown, part: unknown) {
  if (typeof brand !== "string" || !CATALOG_BRANDS.includes(brand)) throw Error("Select a supported brand");
  if (typeof part !== "string" || !part.trim() || part.length > 120 || /[\x00-\x1f\x7f]/.test(part)) throw Error("Part number must be text, 1–120 characters");
  return { brand, part: part.trim(), key: partKey(part) };
}
export function positivePrice(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 1e10 ? n : null;
}
// Missing/blank private metadata means "retain the most recent valid value".
// Explicit zero is meaningful (including zero-rated GST), never a missing value.
function privateNumber(value: unknown, field: "dealer_price" | "gst_percent"): number | undefined {
  if(value==null || (typeof value==="string" && !value.trim())) return undefined;
  if(typeof value!=="number" && typeof value!=="string") throw Error(`Invalid ${field}`);
  let text=String(value).trim();
  if(field==="gst_percent") text=text.replace(/%$/,"").trim();
  else text=text.replace(/^(?:₹\s*|INR\s+|Rs\.?\s+)/i,"");
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,4})?$/.test(text)) throw Error(`Invalid ${field}`);
  const n=Number(text.replace(/,/g,""));
  if(!Number.isFinite(n) || n<0 || n>(field==="gst_percent"?100:1e10)) throw Error(`Invalid ${field}`);
  return n;
}
function previousPrivateNumber(db: Database, brand: string, part: string, listId: number, field: "dealer_price" | "gst_percent"): number | null {
  if(!part) return null;
  // field is an internal fixed enum, never request-provided SQL.
  const row=db.prepare(`SELECT pi.${field} value FROM price_items pi JOIN price_lists pl ON pl.id=pi.price_list_id
    WHERE pi.brand=? AND lower(trim(pi.part_number))=? AND pi.mrp>0
      AND typeof(pi.${field}) IN ('integer','real') AND pi.${field}>=0 AND pi.${field}<=?
      AND (pl.effective_date IS NULL OR pl.effective_date<=?)
      AND (pi.price_list_id=? OR NOT EXISTS(SELECT 1 FROM catalog_uploads u WHERE u.list_id=pi.price_list_id AND u.status!='complete'))
    ORDER BY (pi.price_list_id=?) DESC,pl.uploaded_at DESC,pi.id DESC LIMIT 1`)
    .get(brand,partKey(part),field==="gst_percent"?100:1e10,Date.now(),listId,listId) as any;
  return row ? row.value : null;
}
export type CatalogFx = { rate: number; at: number };
export function catalogFx(db: Database): CatalogFx | null {
  const r = db.prepare("SELECT value FROM settings WHERE key='catalog_verified_fx'").get() as any;
  try { const x = JSON.parse(r?.value); return x.rate > 0 && Number.isFinite(x.rate) && x.at > 0 ? x : null; } catch { return null; }
}
export function initPriceCatalog(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_uploads(
      id INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, brand TEXT NOT NULL,
      list_id INTEGER NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'uploading', next_chunk INTEGER NOT NULL DEFAULT 0,
      rows INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_chunks(upload_id INTEGER, seq INTEGER, digest TEXT NOT NULL, PRIMARY KEY(upload_id,seq));
    CREATE TABLE IF NOT EXISTS catalog_jobs(
      id INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, list_id INTEGER, mode TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', cursor INTEGER NOT NULL DEFAULT 0, max_id INTEGER NOT NULL,
      total INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
      limit_rows INTEGER NOT NULL, fx_rate REAL, fx_at INTEGER, error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
    CREATE TABLE IF NOT EXISTS catalog_prices(
      brand TEXT NOT NULL, part_key TEXT NOT NULL, product_id INTEGER NOT NULL UNIQUE,
      source_item_id INTEGER NOT NULL, source_list_id INTEGER NOT NULL, source_inr REAL NOT NULL,
      price_usd REAL NOT NULL, fx_rate REAL NOT NULL, fx_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(brand,part_key));
    CREATE TABLE IF NOT EXISTS catalog_audit(
      id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, item_id INTEGER, outcome TEXT NOT NULL,
      reason TEXT, product_id INTEGER, before_json TEXT, after_json TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS catalog_audit_job ON catalog_audit(job_id,id);
    CREATE INDEX IF NOT EXISTS catalog_jobs_queue ON catalog_jobs(state,id);
    CREATE INDEX IF NOT EXISTS catalog_prices_part ON catalog_prices(part_key);
    CREATE INDEX IF NOT EXISTS catalog_product_identity ON products(lower(trim(brand)),lower(trim(part_number)));
    CREATE INDEX IF NOT EXISTS catalog_product_page ON products(active,id);
    CREATE INDEX IF NOT EXISTS catalog_product_brand_page ON products(active,brand,id);
    CREATE INDEX IF NOT EXISTS catalog_product_category_page ON products(active,category,id);
    CREATE INDEX IF NOT EXISTS catalog_product_name ON products(active,name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS catalog_product_part ON products(active,part_number COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS catalog_brand_clean ON price_items(brand,part_number_clean);
    CREATE INDEX IF NOT EXISTS catalog_item_identity ON price_items(brand,lower(trim(part_number)),price_list_id,id);
    CREATE INDEX IF NOT EXISTS catalog_item_list ON price_items(price_list_id,id);
    CREATE VIRTUAL TABLE IF NOT EXISTS catalog_search USING fts5(name,description,model,part_number,oem_number,tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS catalog_search_insert AFTER INSERT ON products BEGIN
      INSERT INTO catalog_search(rowid,name,description,model,part_number,oem_number) VALUES(new.id,new.name,new.description,new.model,new.part_number,new.oem_number);
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_update AFTER UPDATE OF name,description,model,part_number,oem_number ON products BEGIN
      DELETE FROM catalog_search WHERE rowid=old.id;
      INSERT INTO catalog_search(rowid,name,description,model,part_number,oem_number) VALUES(new.id,new.name,new.description,new.model,new.part_number,new.oem_number);
    END;
    CREATE TRIGGER IF NOT EXISTS catalog_search_delete AFTER DELETE ON products BEGIN DELETE FROM catalog_search WHERE rowid=old.id; END;
  `);
}
export function indexedCatalogQuery(db: Database, q: string): string | null {
  if(q.trim().length<3) return null;
  if((db.prepare("SELECT value FROM settings WHERE key='catalog_search_ready'").get() as any)?.value!=="true") return null;
  return '"'+q.trim().slice(0,120).replace(/"/g,'""')+'"';
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function key(v: unknown) { if (typeof v !== "string" || !/^[\w-]{8,100}$/.test(v)) throw Error("A stable request key is required"); return v; }
export function startUpload(db: Database, body: any) {
  const request = key(body.requestKey), brand = identity(body.brand, "validation").brand;
  return db.transaction(() => {
    const old = db.prepare("SELECT * FROM catalog_uploads WHERE request_key=?").get(request) as any;
    if (old) { if (old.brand !== brand) throw Error("Request key belongs to another brand"); return old; }
    const effective = body.effectiveDate ? Date.parse(body.effectiveDate) : null;
    if (effective !== null && !Number.isFinite(effective)) throw Error("Invalid effective date");
    const list = db.prepare("INSERT INTO price_lists(brand,version_label,item_count,effective_date,notes,uploaded_at) VALUES(?,?,0,?,?,?)")
      .run(brand, String(body.versionLabel || "").slice(0,100), effective, String(body.notes || "").slice(0,1000), Date.now());
    const id = db.prepare("INSERT INTO catalog_uploads(request_key,brand,list_id,created_at) VALUES(?,?,?,?)")
      .run(request, brand, Number(list.lastInsertRowid), Date.now()).lastInsertRowid;
    return db.prepare("SELECT * FROM catalog_uploads WHERE id=?").get(id);
  }).immediate();
}
export function uploadChunk(db: Database, id: number, seq: number, rows: any[]) {
  if (!Number.isInteger(seq) || seq < 0 || !Array.isArray(rows) || !rows.length || rows.length > 500) throw Error("Send 1–500 rows per chunk");
  const hash = digest(JSON.stringify(rows));
  return db.transaction(() => {
    const u = db.prepare("SELECT * FROM catalog_uploads WHERE id=?").get(id) as any;
    if (!u) throw Error("Upload not found");
    const prior = db.prepare("SELECT digest FROM catalog_chunks WHERE upload_id=? AND seq=?").get(id, seq) as any;
    if (prior) { if (prior.digest !== hash) throw Error("Chunk retry differs"); return u; }
    if (u.status !== "uploading" || u.next_chunk !== seq) throw Error("Upload closed or chunk out of sequence");
    if (u.rows + rows.length > 500000) throw Error("Upload exceeds 500000 rows");
    const insert = db.prepare(`INSERT INTO price_items(brand,price_list_id,part_number,part_number_clean,description,mrp,dealer_price,hsn_code,gst_percent,uom)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      // Retain invalid rows for explicit job rejection; never repair their prices.
      let part = typeof row.partNumber === "string" ? row.partNumber.trim() : "";
      if (part.length > 120 || /[\x00-\x1f\x7f]/.test(part)) part = "";
      const dealer=privateNumber(row.dealerPrice ?? row.dealer_price,"dealer_price");
      const gst=privateNumber(row.gstPercent ?? row.gst_percent,"gst_percent");
      insert.run(u.brand, u.list_id, part, partKey(part).replace(/[^a-z0-9]/g,""),
        String(row.description || "").slice(0,1000), row.sourceCurrency && row.sourceCurrency!=="INR" ? null : positivePrice(row.mrp),
        dealer===undefined ? previousPrivateNumber(db,u.brand,part,u.list_id,"dealer_price") : dealer,
        String(row.hsnCode || "").slice(0,30),
        gst===undefined ? previousPrivateNumber(db,u.brand,part,u.list_id,"gst_percent") : gst,
        String(row.uom || "").slice(0,20));
    }
    db.prepare("INSERT INTO catalog_chunks VALUES(?,?,?)").run(id,seq,hash);
    db.prepare("UPDATE catalog_uploads SET rows=rows+?,next_chunk=next_chunk+1 WHERE id=?").run(rows.length,id);
    return db.prepare("SELECT * FROM catalog_uploads WHERE id=?").get(id);
  }).immediate();
}
export function createJob(db: Database, body: any) {
  return db.transaction(() => {
    const request = key(body.requestKey);
    const old = db.prepare("SELECT * FROM catalog_jobs WHERE request_key=?").get(request) as any;
    if (old) {
      if (old.mode !== body.mode || old.list_id !== (body.listId == null ? null : Number(body.listId)) || old.limit_rows!==Number(body.limit || 2147483647)) throw Error("Request key reused with different parameters");
      return old;
    }
    const mode = body.mode;
    if (!["dry-run","publish","search-index"].includes(mode)) throw Error("Choose dry-run, publish or search-index");
    const listId = body.listId == null ? null : Number(body.listId);
    if (listId !== null && (!Number.isSafeInteger(listId) || listId < 1)) throw Error("Invalid list");
    if (listId && db.prepare("SELECT 1 FROM catalog_uploads WHERE list_id=? AND status!='complete'").get(listId)) throw Error("Upload incomplete");
    const limit = Number(body.limit || 2147483647);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2147483647) throw Error("Invalid row limit");
    const fx = catalogFx(db);
    if (mode === "publish" && !fx) throw Error("No verified FX rate: wait for a successful existing FX-service refresh");
    const where = listId ? " WHERE price_list_id=?" : "";
    const args = listId ? [listId] : [];
    const size = mode==="search-index" ? db.prepare("SELECT count(*) n,coalesce(max(id),0) max FROM products").get() as any
      : db.prepare(`SELECT count(*) n,coalesce(max(id),0) max FROM price_items${where}`).get(...args) as any;
    const id = db.prepare(`INSERT INTO catalog_jobs(request_key,list_id,mode,max_id,total,limit_rows,fx_rate,fx_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(request,listId,mode,size.max,Math.min(size.n,limit),limit,fx?.rate ?? null,fx?.at ?? null,Date.now()).lastInsertRowid;
    return db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(id);
  }).immediate();
}
export function finishUpload(db: Database, id: number) {
  return db.transaction(() => {
    const u = db.prepare("SELECT * FROM catalog_uploads WHERE id=?").get(id) as any;
    if (!u || !u.rows) throw Error("Empty or missing upload");
    db.prepare("UPDATE catalog_uploads SET status='complete' WHERE id=?").run(id);
    db.prepare("UPDATE price_lists SET item_count=? WHERE id=?").run(u.rows,u.list_id);
    const enabled = (db.prepare("SELECT value FROM settings WHERE key='catalog_auto_sync'").get() as any)?.value === "true";
    let job: any = db.prepare("SELECT * FROM catalog_jobs WHERE request_key=?").get(`upload-${id}-publish`);
    if (enabled && !job) {
      const max = (db.prepare("SELECT max(id) n FROM price_items WHERE price_list_id=?").get(u.list_id) as any).n;
      const fx = catalogFx(db);
      const jid = db.prepare(`INSERT INTO catalog_jobs(request_key,list_id,mode,max_id,total,limit_rows,fx_rate,fx_at,state,created_at) VALUES(?,?,'publish',?,?,?,?,?,?,?)`)
        .run(`upload-${id}-publish`,u.list_id,max,u.rows,u.rows,fx?.rate ?? null,fx?.at ?? null,fx ? "queued":"waiting_fx",Date.now()).lastInsertRowid;
      job = db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(jid);
    }
    return { uploadId: id, listId: u.list_id, rows: u.rows, job: job || null, autoSync: enabled };
  }).immediate();
}
function owner(db: Database, brand: string, part: string) {
  return db.prepare("SELECT * FROM catalog_prices WHERE brand=? AND part_key=?").get(brand,partKey(part)) as any;
}
export function linkedProduct(db: Database, brand: string, part: string) {
  return db.prepare(`SELECT p.* FROM catalog_prices c JOIN products p ON p.id=c.product_id WHERE c.brand=? AND c.part_key=?`).get(brand.trim().toLowerCase(),partKey(part)) as any;
}
export function publicCatalogPrices<T extends { id: number }>(db: Database, rows: T[]): T[] {
  if (!rows.length) return rows;
  try {
    const values = db.prepare(`SELECT product_id,price_usd,fx_at FROM catalog_prices WHERE product_id IN (${rows.map(()=>"?").join(",")})`).all(...rows.map(p=>p.id)) as any[];
    const prices = new Map(values.map(v=>[v.product_id,v]));
    return rows.map(p => { const c=prices.get(p.id); return c ? {...p,priceUsd:c.price_usd,price:c.price_usd,priceCurrency:"USD",sourceCurrency:"INR",taxIncluded:true,catalogFxAt:c.fx_at,catalogPriced:true} : p; });
  } catch(e) {
    if(/no such table: catalog_prices/.test(String((e as Error).message))) return rows;
    throw e; // Never silently relabel a linked product on a database failure.
  }
}
function snapshot(db: Database, id: number) {
  return { product: db.prepare("SELECT * FROM products WHERE id=?").get(id), price: db.prepare("SELECT * FROM catalog_prices WHERE product_id=?").get(id) || null };
}
function applyRow(db: Database, j: any, r: any, now: number) {
  const result: { outcome: string; reason: string; productId: number | null; before: any; after: any } =
    { outcome:"rejected",reason:"",productId:null,before:null,after:null };
  try { return db.transaction(() => {
    const ident = identity(r.brand,r.part_number), price=positivePrice(r.mrp);
    if (!price) throw Error("Invalid/non-positive MRP");
    if (r.effective_date && r.effective_date > now) throw Error("Future effective date; rerun on or after that date");
    if (db.prepare("SELECT 1 FROM catalog_uploads WHERE list_id=? AND status!='complete'").get(r.price_list_id)) throw Error("Incomplete upload");
    const duplicates = db.prepare(`SELECT count(DISTINCT mrp) prices,sum(mrp IS NULL OR mrp<=0) invalid,max(id) last
      FROM price_items WHERE brand=? AND lower(trim(part_number))=? AND price_list_id=?`).get(ident.brand,ident.key,r.price_list_id) as any;
    if (duplicates.prices > 1 || duplicates.invalid) throw Error("Conflicting duplicate rows");
    if (duplicates.last !== r.id) return {...result,outcome:"skipped",reason:"Duplicate identical price"};
    const prior = owner(db,ident.brand,ident.part);
    const newer = db.prepare(`SELECT pi.id FROM price_items pi JOIN price_lists pl ON pl.id=pi.price_list_id
      WHERE pi.brand=? AND lower(trim(pi.part_number))=? AND pi.price_list_id>? AND pi.mrp>0
      AND (pl.effective_date IS NULL OR pl.effective_date<=?)
      AND NOT EXISTS(SELECT 1 FROM catalog_uploads u WHERE u.list_id=pi.price_list_id AND u.status!='complete') LIMIT 1`)
      .get(ident.brand,ident.key,r.price_list_id,now);
    if (newer || (prior && prior.source_list_id>r.price_list_id)) return {...result,outcome:"skipped",reason:"Newer current price-list row takes precedence"};
    const matches = db.prepare("SELECT * FROM products WHERE lower(trim(brand))=? AND lower(trim(part_number))=? LIMIT 2").all(ident.brand,ident.key) as any[];
    if (matches.length>1) throw Error("Multiple catalog identities; manual collision resolution required");
    // Legacy checker punctuation collisions are distinct identities, not automatic aliases.
    const collision = db.prepare(`SELECT part_number FROM price_items WHERE brand=? AND part_number_clean=?
      AND lower(trim(part_number))!=? LIMIT 1`).get(ident.brand,ident.key.replace(/[^a-z0-9]/g,""),ident.key) as any;
    if (collision) throw Error(`Legacy normalized-part collision with ${collision.part_number}; review required`);
    const p=matches[0]; result.productId=p?.id ?? null;
    if (p && !p.active && !prior) throw Error("Existing inactive product requires separate publication approval");
    if (prior && p?.id !== prior.product_id) throw Error("Identity ownership conflict");
    const usd=Math.round((price/(j.fx_rate || 1))*100)/100;
    if (j.fx_rate && (!Number.isFinite(usd) || usd<=0)) throw Error("Price rounds to zero USD");
    result.outcome=p ? "updated":"created";
    if (prior && prior.source_item_id===r.id && prior.price_usd===usd && p.price_inr===price) result.outcome="skipped";
    if (j.mode==="publish" && result.outcome!=="skipped") {
      result.before=p ? snapshot(db,p.id) : null;
      if (!p) {
        const slug=`${ident.brand}-${ident.key.replace(/[^a-z0-9]+/g,"-").slice(0,65)}-${digest(ident.brand+"|"+ident.key).slice(0,12)}`;
        const description=String(r.description || `${ident.brand} part ${ident.part}`).trim();
        const created=db.prepare(`INSERT INTO products(slug,name,brand,category,part_number,description,price_inr,stock_qty,image_urls,compatible_models,active,featured,created_at)
          VALUES(?,?,?,'other',?,?,?,0,'[]','[]',1,0,?)`).run(slug,description,ident.brand,ident.part,description,price,now);
        result.productId=Number(created.lastInsertRowid);
      } else db.prepare("UPDATE products SET price_inr=? WHERE id=?").run(price,p.id);
      db.prepare(`INSERT INTO catalog_prices VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(brand,part_key) DO UPDATE SET source_item_id=excluded.source_item_id,source_list_id=excluded.source_list_id,
        source_inr=excluded.source_inr,price_usd=excluded.price_usd,fx_rate=excluded.fx_rate,fx_at=excluded.fx_at,updated_at=excluded.updated_at`)
        .run(ident.brand,ident.key,result.productId,r.id,r.price_list_id,price,usd,j.fx_rate,j.fx_at,
          prior && prior.source_inr===price && prior.price_usd===usd && prior.fx_at===j.fx_at ? prior.updated_at : now);
      result.after=snapshot(db,result.productId!);
    }
    return result;
  })(); } catch(e) { return {...result,outcome:"rejected",reason:(e as Error).message,before:null,after:null}; }
}
export function runCatalogBatch(db: Database, jobId: number, batch = 200) {
  return db.transaction(() => {
    const j = db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(jobId) as any;
    if (!j || !["queued","running"].includes(j.state)) return j;
    if(j.mode==="search-index") {
      const rows=db.prepare("SELECT * FROM products WHERE id>? AND id<=? ORDER BY id LIMIT 200").all(j.cursor,j.max_id) as any[];
      const insert=db.prepare("INSERT INTO catalog_search(rowid,name,description,model,part_number,oem_number) VALUES(?,?,?,?,?,?)");
      for(const r of rows){db.prepare("DELETE FROM catalog_search WHERE rowid=?").run(r.id);insert.run(r.id,r.name,r.description,r.model,r.part_number,r.oem_number);j.cursor=r.id;j.processed++;}
      const done=!rows.length || j.cursor>=j.max_id;
      db.prepare("UPDATE catalog_jobs SET cursor=?,processed=?,updated=?,state=?,finished_at=? WHERE id=?").run(j.cursor,j.processed,j.processed,done?"complete":"running",done?Date.now():null,j.id);
      if(done) db.prepare("INSERT INTO settings(key,value) VALUES('catalog_search_ready','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
      return db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(j.id);
    }
    const now = Date.now();
    const rows = db.prepare(`SELECT pi.*,pl.effective_date FROM price_items pi JOIN price_lists pl ON pl.id=pi.price_list_id
      WHERE pi.id>? AND pi.id<=? ${j.list_id ? "AND pi.price_list_id=?" : ""} ORDER BY pi.id LIMIT ?`)
      .all(j.cursor,j.max_id,...(j.list_id?[j.list_id]:[]),Math.min(200,batch,j.limit_rows-j.processed)) as any[];
    for (const r of rows) {
      const result = applyRow(db,j,r,now);
      db.prepare("INSERT INTO catalog_audit(job_id,item_id,outcome,reason,product_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(j.id,r.id,result.outcome,result.reason,result.productId,result.before?JSON.stringify(result.before):null,result.after?JSON.stringify(result.after):null,now);
      j[result.outcome]++; j.processed++; j.cursor=r.id;
    }
    const done=rows.length===0 || j.processed>=j.limit_rows || j.cursor>=j.max_id;
    db.prepare(`UPDATE catalog_jobs SET cursor=?,processed=?,created=?,updated=?,skipped=?,rejected=?,state=?,finished_at=? WHERE id=?`)
      .run(j.cursor,j.processed,j.created,j.updated,j.skipped,j.rejected,done?"complete":"running",done?now:null,j.id);
    return db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(j.id);
  }).immediate();
}
// Explicit operation-scoped reversal, compare-and-swap protects subsequent edits.
// New products are hidden, never deleted; existing products only regain their price.
export function rollbackBatch(db: Database, jobId: number) {
  return db.transaction(() => {
    const j=db.prepare("SELECT * FROM catalog_jobs WHERE id=?").get(jobId) as any;
    if (!j || j.mode!=="publish" || !["complete","paused","rollback"].includes(j.state)) throw Error("Pause or complete the publication before reversal");
    const audits=db.prepare(`SELECT * FROM catalog_audit a WHERE job_id=? AND after_json IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM catalog_audit b WHERE b.job_id=a.job_id AND b.item_id=a.id AND b.outcome IN ('reversed','reversal_conflict'))
      ORDER BY id DESC LIMIT 200`).all(jobId) as any[];
    for(const a of audits) {
      const current=snapshot(db,a.product_id), expected=JSON.parse(a.after_json);
      let outcome="reversal_conflict";
      if(JSON.stringify(current)===JSON.stringify(expected)) {
        const before=a.before_json ? JSON.parse(a.before_json):null;
        db.prepare("DELETE FROM catalog_prices WHERE product_id=?").run(a.product_id);
        if(before) {
          db.prepare("UPDATE products SET price_inr=? WHERE id=?").run(before.product.price_inr,a.product_id);
          if(before.price) {
            const p=before.price;
            db.prepare("INSERT INTO catalog_prices VALUES(?,?,?,?,?,?,?,?,?,?)").run(p.brand,p.part_key,p.product_id,p.source_item_id,p.source_list_id,p.source_inr,p.price_usd,p.fx_rate,p.fx_at,p.updated_at);
          }
        } else db.prepare("UPDATE products SET active=0 WHERE id=?").run(a.product_id);
        outcome="reversed";
      }
      db.prepare("INSERT INTO catalog_audit(job_id,item_id,outcome,product_id,created_at) VALUES(?,?,?,?,?)").run(jobId,a.id,outcome,a.product_id,Date.now());
    }
    db.prepare("UPDATE catalog_jobs SET state=? WHERE id=?").run(audits.length ? "rollback":"reversed",jobId);
    return { processed:audits.length };
  }).immediate();
}
