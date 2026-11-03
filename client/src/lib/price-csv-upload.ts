import { adminFetch } from "./admin-auth";

export const CSV_MAX_BYTES = 64 * 1024 * 1024;
export const CSV_IMPORT_BASE = "/api/admin/catalog-sync/csv-imports";
const CHECKPOINT_KEY = "narmada_price_csv_import";
export interface CsvCheckpoint { id: number; fileName: string; bytes: number }
export interface CsvImportStatus {
  upload_id: number; state: string; expected_bytes: number; received_bytes: number;
  parsed_rows: number; staged_rows: number; encoding: string; brand: string;
  version_label: string | null; effective_date: number | null; error?: string | null;
  publication?: { rows: number; autoSync: boolean; job: { id: number; state: string } | null };
}
export function readCsvCheckpoint(): CsvCheckpoint | null {
  try {
    const v=JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || "null");
    return v && Number.isSafeInteger(v.id) && v.id>0 && typeof v.fileName==="string" &&
      Number.isSafeInteger(v.bytes) && v.bytes>0 && v.bytes<=CSV_MAX_BYTES ? v : null;
  } catch { return null; }
}
export function writeCsvCheckpoint(value: CsvCheckpoint | null) {
  try {
    if(value) localStorage.setItem(CHECKPOINT_KEY,JSON.stringify(value));
    else localStorage.removeItem(CHECKPOINT_KEY);
  } catch { /* Same-tab retry still works when browser storage is unavailable. */ }
}
async function checked(response: Response) {
  if(response.ok) return response;
  const body=await response.json().catch(()=>({}));
  const detail=body.error || body.message || `Request failed (HTTP ${response.status}).`;
  throw Error(response.status===401 || response.status===403 ?
    `${detail} Sign in with an authorized admin account before retrying the saved import.` : detail);
}
export async function csvJson(token: string,path: string,init: RequestInit={}) {
  return (await checked(await adminFetch(token,path,{...init,redirect:"error",credentials:"omit"}))).json();
}
export function csvProgress(data: Partial<CsvImportStatus>) {
  return `CSV import #${data.upload_id}: ${data.state || "streaming"}. ${(data.staged_rows || 0).toLocaleString()} rows staged; ${((data.received_bytes || 0)/1024/1024).toFixed(1)} / ${((data.expected_bytes || 0)/1024/1024).toFixed(1)} MiB received.`;
}
export function csvComplete(data: CsvImportStatus) {
  const count=(data.staged_rows || data.publication?.rows || 0).toLocaleString();
  const job=data.publication?.job;
  return `${count} CSV rows received completely. ${job ?
    `Publication job ${job.id}: ${job.state}. This is not confirmation that prices are live.` :
    data.publication?.autoSync===false ? "Future sync is disabled; no publication job was created." :
    "Check publication status in the panel; import completion alone does not mean prices are live."}`;
}
// HTTP 200 only means the stream opened, not that file validation succeeded.
export async function readCsvStream(response: Response,onProgress: (data: CsvImportStatus)=>void): Promise<CsvImportStatus> {
  await checked(response);
  if(response.headers.get("Content-Type")?.includes("application/json")) {
    const data=await response.json();
    if(data.state==="complete") return data;
    throw Error(data.error || "CSV import did not complete. Check its saved status.");
  }
  if(!response.headers.get("Content-Type")?.includes("application/x-ndjson") || !response.body)
    throw Error("Unexpected CSV response. Check the saved import status before retrying.");
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let pending="",complete: CsvImportStatus | undefined;
  const event=(line: string)=>{
    if(!line.trim()) return;
    if(line.length>65536) throw Error("CSV progress response exceeded its safe limit.");
    const data=JSON.parse(line);
    if(data.event==="error") throw Error(data.error || "CSV validation failed.");
    if(data.event==="complete") {
      if(data.state!=="complete") throw Error("CSV completion could not be verified.");
      complete=data;
    }
    if(data.event==="progress" || data.event==="complete") onProgress(data);
  };
  try {
    for(;;) {
      const {value,done}=await reader.read();
      pending+=decoder.decode(value || new Uint8Array(),{stream:!done});
      let newline;
      while((newline=pending.indexOf("\n"))!==-1) {
        event(pending.slice(0,newline));pending=pending.slice(newline+1);
      }
      if(pending.length>65536) throw Error("CSV progress response exceeded its safe limit.");
      if(done) break;
    }
    if(pending) event(pending);
    if(!complete) throw Error("Connection ended without a completion event. Check the saved import status before retrying the same file.");
    return complete;
  } catch(e) { await reader.cancel().catch(()=>{});throw e; }
  finally { reader.releaseLock(); }
}
export async function streamCsvFile(token: string,id: number,file: File,onProgress: (data: CsvImportStatus)=>void) {
  return readCsvStream(await adminFetch(token,`${CSV_IMPORT_BASE}/${id}/content`,{
    method:"PUT",headers:{"Content-Type":"text/csv"},body:file,redirect:"error",credentials:"omit",
  }),onProgress);
}
