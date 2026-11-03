import type { Express, RequestHandler } from "express";
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToServer } from "node:timers/promises";
import { startUpload, uploadChunk, finishUpload } from "./price-catalog";
import { CSV_ENCODINGS, CSV_MAX_BYTES, CSV_MAX_ROWS, CsvImportError, streamPriceCsv } from "./price-csv-stream";

const LEASE_MS = 120000, MAX_DURATION_MS = 15 * 60 * 1000;
const status = (db: Database, id: number) => {
  const row = db.prepare(`SELECT c.upload_id,c.state,c.encoding,c.expected_bytes,c.received_bytes,c.parsed_rows,
    c.sha256,c.error,c.updated_at,c.lease_until,u.list_id,u.rows AS staged_rows,u.status AS upload_status,
    p.brand,p.version_label,p.effective_date
    FROM catalog_csv_imports c JOIN catalog_uploads u ON u.id=c.upload_id
    JOIN price_lists p ON p.id=u.list_id WHERE c.upload_id=?`).get(id) as any;
  if (!row) throw new CsvImportError("CSV import not found",404);
  if (row.state === "streaming" && row.lease_until < Date.now()) {
    row.state = "interrupted";row.error = "Import lease expired. Retry the same file and import ID.";
  }
  delete row.lease_until;
  return row;
};
function owner(db: Database,id: number,lease: string) {
  if (!db.prepare("SELECT 1 FROM catalog_csv_imports WHERE upload_id=? AND state='streaming' AND lease_token=? AND lease_until>?").get(id,lease,Date.now()))
    throw new CsvImportError("Import lease expired or changed; retry the same file",409);
}
export function registerLargeCsvImports(app: Express, db: Database, admin: RequestHandler) {
  const base = "/api/admin/catalog-sync/csv-imports";
  const safe = (fn: (req: any) => any): RequestHandler => (req,res) => {
    res.setHeader("Cache-Control","no-store");
    try { res.json(fn(req)); }
    catch (e) { res.status(e instanceof CsvImportError ? e.status : 400).json({error:(e as Error).message}); }
  };
  app.post(base,admin,safe(req => db.transaction(() => {
    const b = req.body || {};
    if (!Number.isSafeInteger(b.bytes) || b.bytes < 1 || b.bytes > CSV_MAX_BYTES) throw new CsvImportError(`CSV size must be 1-${CSV_MAX_BYTES} bytes`,413);
    if (!CSV_ENCODINGS.includes(b.encoding)) throw new CsvImportError("Choose utf-8 or windows-1252; encoding is never guessed");
    if (typeof b.requestKey !== "string" || !/^[\w-]{8,90}$/.test(b.requestKey)) throw new CsvImportError("A stable request key is required");
    if ([b.versionLabel,b.effectiveDate,b.notes].some(v => v != null && typeof v !== "string")) throw new CsvImportError("Metadata must be text");
    if ((b.versionLabel?.length || 0)>100 || (b.notes?.length || 0)>1000 || (b.effectiveDate?.length || 0)>40) throw new CsvImportError("Metadata exceeds its allowed length");
    const metadata = JSON.stringify([b.brand,b.versionLabel || "",b.effectiveDate || "",b.notes || "",b.encoding,b.bytes]);
    const key = `csv-${b.requestKey}`;
    const old = db.prepare("SELECT c.upload_id,c.metadata FROM catalog_csv_imports c JOIN catalog_uploads u ON u.id=c.upload_id WHERE u.request_key=?").get(key) as any;
    if (old) {
      if (old.metadata !== metadata) throw new CsvImportError("Request key belongs to different file metadata",409);
      return status(db,old.upload_id);
    }
    if (db.prepare("SELECT 1 FROM catalog_uploads WHERE request_key=?").get(key)) throw new CsvImportError("Request key already used",409);
    const actor = String(req.user?.username || "admin");
    const rate = db.prepare("SELECT count(*) n FROM catalog_csv_imports WHERE requested_by=? AND created_at>?").get(actor,Date.now()-3600000) as any;
    if (rate.n >= 6) throw new CsvImportError("At most six new large CSV imports per admin per hour. Retry the existing import instead.",429);
    const u = startUpload(db,{...b,requestKey:key}) as any;
    db.prepare(`INSERT INTO catalog_csv_imports(upload_id,encoding,expected_bytes,metadata,requested_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`).run(u.id,b.encoding,b.bytes,metadata,actor,Date.now(),Date.now());
    return status(db,u.id);
  }).immediate()));
  app.get(`${base}/:id`,admin,safe(req => status(db,Number(req.params.id))));
  app.put(`${base}/:id/content`,admin,async (req,res) => {
    const id = Number(req.params.id), lease = randomUUID();
    let acquired = false, timeout: ReturnType<typeof setTimeout> | undefined;
    const emit = (value: object) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value)+"\n"); };
    try {
      if (!req.is("text/csv") || req.headers["content-encoding"]) throw new CsvImportError("Send uncompressed text/csv raw file bytes",415);
      const row = db.transaction(() => {
        const c = db.prepare("SELECT * FROM catalog_csv_imports WHERE upload_id=?").get(id) as any;
        if (!c) throw new CsvImportError("CSV import not found",404);
        if (c.state === "complete") return c;
        const length = req.headers["content-length"];
        if (length && Number(length) !== c.expected_bytes) throw new CsvImportError("File byte length differs from the original import metadata",409);
        db.prepare("UPDATE catalog_csv_imports SET state='failed',error='Interrupted import; retry same file',lease_token=NULL WHERE state='streaming' AND lease_until<?").run(Date.now());
        if (db.prepare("SELECT 1 FROM catalog_csv_imports WHERE state='streaming'").get()) throw new CsvImportError("Another large CSV stream is active. Wait for it to finish or its lease to expire.",409);
        if (c.attempted_at && Date.now()-c.attempted_at < 5000) throw new CsvImportError("Wait five seconds before retrying this import",429);
        db.prepare(`UPDATE catalog_csv_imports SET state='streaming',received_bytes=0,parsed_rows=0,error=NULL,
          lease_token=?,lease_until=?,attempted_at=?,updated_at=? WHERE upload_id=?`).run(lease,Date.now()+LEASE_MS,Date.now(),Date.now(),id);
        acquired = true;return c;
      }).immediate();
      if (row.state === "complete") { req.resume();res.json({...status(db,id),alreadyComplete:true});return; }
      res.status(200).type("application/x-ndjson").setHeader("Cache-Control","no-store");
      emit({event:"started",uploadId:id,maxRows:CSV_MAX_ROWS});
      timeout = setTimeout(() => req.destroy(new Error("CSV import exceeded the 15-minute duration limit")),MAX_DURATION_MS);
      req.setTimeout(45000,() => req.destroy(new Error("CSV upload idle for 45 seconds")));
      let seq = 0, nextHeartbeat = Date.now()+30000;
      const parsed = await streamPriceCsv(req,row.encoding,async (rows,progress) => {
        db.transaction(() => {
          owner(db,id,lease);
          uploadChunk(db,id,seq++,rows,{csvLease:lease});
          db.prepare(`UPDATE catalog_csv_imports SET received_bytes=?,parsed_rows=?,lease_until=?,updated_at=?
            WHERE upload_id=?`).run(progress.bytes,progress.rows,Date.now()+LEASE_MS,Date.now(),id);
        }).immediate();
        emit({event:"progress",...status(db,id)});
        // Allow ordinary API requests, status polling and disconnects between chunks.
        await yieldToServer();
      },{bytes:row.expected_bytes,rows:CSV_MAX_ROWS},bytes=>{
        // A slow but active sender may not reach 500 rows within one lease.
        if (Date.now()<nextHeartbeat) return;
        db.transaction(()=>{
          owner(db,id,lease);
          db.prepare("UPDATE catalog_csv_imports SET received_bytes=?,lease_until=?,updated_at=? WHERE upload_id=?")
            .run(bytes,Date.now()+LEASE_MS,Date.now(),id);
        }).immediate();
        nextHeartbeat=Date.now()+30000;
      });
      if (parsed.bytes !== row.expected_bytes) throw new CsvImportError("CSV ended before its declared byte length; retry the same file",409);
      const done = db.transaction(() => {
        owner(db,id,lease);
        const staged = db.prepare("SELECT rows FROM catalog_uploads WHERE id=?").get(id) as any;
        const chunks = db.prepare("SELECT count(*) n,min(seq) first,max(seq) last FROM catalog_chunks WHERE upload_id=?").get(id) as any;
        if (staged.rows!==parsed.rows || chunks.n!==seq || chunks.first!==0 || chunks.last!==seq-1)
          throw new CsvImportError("Retry row/chunk count differs from staged data. Use the identical original file, or start a new import for a changed file.",409);
        db.prepare("UPDATE catalog_csv_imports SET state='validated',received_bytes=?,parsed_rows=?,sha256=?,updated_at=? WHERE upload_id=?")
          .run(parsed.bytes,parsed.rows,parsed.sha256,Date.now(),id);
        const result = finishUpload(db,id);
        db.prepare("UPDATE catalog_csv_imports SET state='complete',lease_token=NULL,lease_until=0 WHERE upload_id=?").run(id);
        return result;
      }).immediate();
      emit({event:"complete",...status(db,id),publication:done});res.end();
    } catch (e) {
      const message = (e as Error).message;
      if (acquired) db.prepare("UPDATE catalog_csv_imports SET state='failed',error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE upload_id=? AND lease_token=?")
        .run(message.slice(0,500),Date.now(),id,lease);
      if (!res.headersSent) res.status(e instanceof CsvImportError ? e.status : 400).json({error:message,uploadId:id});
      else { emit({event:"error",error:message,uploadId:id});res.end(); }
      // Stop accepting this bounded file on validation failure; status remains queryable.
      if (!req.complete) res.once("finish",() => req.destroy());else req.resume();
    } finally { if (timeout) clearTimeout(timeout);req.setTimeout(0); }
  });
}
