import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Upload, Download, Trash2, ListChecks, FileSpreadsheet } from "lucide-react";
import { CatalogSyncPanel } from "./CatalogSyncPanel";

interface PriceList {
  id: number;
  brand: string;
  versionLabel: string | null;
  itemCount: number;
  effectiveDate: string | null;
  notes: string | null;
  uploadedAt: string;
}

const BRAND_OPTIONS = [
  { value: "tata", label: "Tata Motors" },
  { value: "bharatbenz", label: "BharatBenz" },
  { value: "ashok-leyland", label: "Ashok Leyland" },
  { value: "eicher", label: "Eicher" },
  { value: "volvo", label: "Volvo" },
  { value: "scania", label: "Scania" },
  { value: "mahindra", label: "Mahindra" },
  { value: "force", label: "Force Motors" },
  { value: "swaraj-mazda", label: "Swaraj Mazda" },
];

export default function AdminPriceList() {
  const { token } = useAdminAuth();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [open, setOpen] = useState<null | {
    brand: string; versionLabel: string; effectiveDate: string; notes: string; csv: string;
  }>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const busy = useRef(false);
  const [workbook, setWorkbook] = useState<any>(null);
  const [progress, setProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/price-lists");
    { const _d = await r.json(); setLists(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function upload() {
    if (!token || !open || busy.current) return;
    setUploadError("");setProgress("");
    if (!open.brand) { setUploadError("Pick a brand."); return; }
    if (!open.csv.trim() && !workbook) { setUploadError("Paste CSV or choose an Excel file."); return; }
    busy.current = true;
    setUploading(true);
    try {
      const XLSX=await import("xlsx");
      const sheet=workbook || XLSX.read(open.csv,{type:"string",raw:true}).Sheets.Sheet1;
      const range=XLSX.utils.decode_range(sheet["!ref"] || "A1");
      if(range.e.r>50000) throw Error("Split files into at most 50,000 rows each; imports are partial updates, never deletions.");
      const header=(XLSX.utils.sheet_to_json<string[]>(sheet,{header:1,range:{s:range.s,e:{r:range.s.r,c:range.e.c}},raw:false})[0] || []).map(v=>String(v).trim().toLowerCase().replace(/\s+/g,"_"));
      const partCol=header.findIndex(h=>["part_number","partnumber","part_no"].includes(h));
      if(partCol<0 || !header.includes("mrp")) throw Error("Required columns: part_number and mrp");
      const hashBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([open.brand,open.versionLabel,open.effectiveDate,sheet]))));
      const requestKey="excel-"+Array.from(hashBytes,b=>b.toString(16).padStart(2,"0")).join("");
      const send=async(path:string,body:any) => {
        const r=await adminFetch(token!,path,{method:"POST",body:JSON.stringify(body)});
        const data=await r.json();if(!r.ok) throw Error(data.error || data.message || `Upload failed (HTTP ${r.status})`);return data;
      };
      const u=await send("/api/admin/catalog-sync/uploads",{...open,csv:undefined,requestKey});
      for(let start=range.s.r+1,seq=0;start<=range.e.r;start+=500,seq++) {
        const values=XLSX.utils.sheet_to_json<string[]>(sheet,{header:1,range:{s:{r:start,c:range.s.c},e:{r:Math.min(start+499,range.e.r),c:range.e.c}},raw:false,defval:"",blankrows:true});
        const rows=values.map((v,index)=>{
          const cell=sheet[XLSX.utils.encode_cell({r:start+index,c:range.s.c+partCol})];
          const unsafe=cell?.t==="n" && (!Number.isSafeInteger(cell.v) || cell.v>=1e15);
          const get=(name:string)=>v[header.indexOf(name)] || "";
          return {partNumber:unsafe ? "" : String(v[partCol] || ""),description:get("description"),mrp:get("mrp"),dealerPrice:get("dealer_price"),gstPercent:get("gst_percent"),hsnCode:get("hsn_code"),uom:get("uom"),sourceCurrency:get("currency") || "INR"};
        });
        await send(`/api/admin/catalog-sync/uploads/${u.id}/chunks`,{seq,rows});
        setProgress(`Uploaded ${Math.min(start+499,range.e.r).toLocaleString()} / ${range.e.r.toLocaleString()} rows`);
      }
      const done=await send(`/api/admin/catalog-sync/uploads/${u.id}/finish`,{});
      setProgress(`${done.rows.toLocaleString()} rows received. ${done.job ? `Publication job ${done.job.id}: ${done.job.state}.` : "Future sync is disabled; run a dry run and publication job when ready."}`);
      setOpen(null);setWorkbook(null);await load();
    } catch(e) {
      setProgress("");
      setUploadError(`Upload stopped: ${(e as Error).message} Review the file and error before retrying. For an interrupted upload, use the same file and metadata to retry safely.`);
    }
    finally { busy.current = false; setUploading(false); }
  }

  async function del(id: number) {
    if (!token || deletingId !== null) return;
    if (!confirm("Delete this entire price list?")) return;
    setDeletingId(id);setDeleteError("");
    try {
      const r = await adminFetch(token, `/api/admin/price-lists/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw Error(data.error || data.message || `Unable to delete price list (HTTP ${r.status}).`);
      }
      await load();
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setDeletingId(null); }
  }

  async function downloadTemplate() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/price-lists/template.csv");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "narmada-price-list-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    if (busy.current) return;
    setWorkbook(null);setOpen(o=>o?{...o,csv:""}:o);setUploadError("");setProgress("");
    if(file.size>8*1024*1024) {setUploadError("Split files into pieces under 8 MB.");return;}
    busy.current = true;setParsing(true);setProgress(`Reading ${file.name}…`);
    try {
      const XLSX=await import("xlsx");
      const book=XLSX.read(await file.arrayBuffer(),{type:"array",raw:true});
      setWorkbook(book.Sheets[book.SheetNames[0]]);
      setOpen(o=>o?{...o,csv:""}:o);setProgress(`Selected ${file.name}. First worksheet; MRP in INR, GST included.`);
    } catch {setProgress("");setUploadError("Unable to read file. Choose a valid Excel or CSV file.");}
    finally {busy.current = false;setParsing(false);}
  }

  return (
    <AdminLayout title="Price Lists" responsiveSidebar>
      <CatalogSyncPanel token={token || null} />
      {!open && progress && <p role="status" className="mb-4 text-sm">{progress}</p>}
      {deleteError && <p role="alert" className="mb-4 text-sm text-red-700">{deleteError}</p>}
      <p className="mb-4 text-sm text-muted-foreground">To update prices, upload a replacement for the same brand. You do not need to delete the old list; lists used by the catalog are retained for audit. Products absent from a partial upload are not deleted.</p>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button disabled={parsing || uploading} onClick={() => {if(busy.current) return;setWorkbook(null);setProgress("");setUploadError("");setOpen({ brand: "", versionLabel: "", effectiveDate: "", notes: "", csv: "" });}}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="button-upload-list">
          <Upload className="w-4 h-4" /> Upload Price List
        </button>
        <button onClick={downloadTemplate}
          className="px-4 py-2 border rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-download-template">
          <Download className="w-4 h-4" /> Download CSV Template
        </button>
        <div className="flex-1" />
        <div className="text-sm text-muted-foreground">{lists.reduce((s, l) => s + l.itemCount, 0).toLocaleString()} total items across {lists.length} lists</div>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {lists.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No price lists uploaded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-5 py-3 font-semibold">Brand</th>
                <th className="px-5 py-3 font-semibold">Version</th>
                <th className="px-5 py-3 font-semibold">Items</th>
                <th className="px-5 py-3 font-semibold">Effective</th>
                <th className="px-5 py-3 font-semibold">Uploaded</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lists.map((l) => (
                <tr key={l.id} data-testid={`row-list-${l.id}`}>
                  <td className="px-5 py-3 font-semibold capitalize">{l.brand.replace("-", " ")}</td>
                  <td className="px-5 py-3 text-muted-foreground">{l.versionLabel || "—"}</td>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded text-xs font-bold"><ListChecks className="w-3 h-3" /> {l.itemCount.toLocaleString()}</span></td>
                  <td className="px-5 py-3 text-muted-foreground">{l.effectiveDate || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{new Date(l.uploadedAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => del(l.id)} disabled={deletingId !== null} aria-label={`Delete ${l.brand} price list ${l.versionLabel || l.id}`} className="p-2 hover:bg-red-500/10 text-red-600 rounded disabled:opacity-50" data-testid={`button-delete-list-${l.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="upload-price-list-title" aria-busy={parsing || uploading} className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 id="upload-price-list-title" className="font-display text-xl font-bold inline-flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Upload Price List</h2>
              <button onClick={() => setOpen(null)} disabled={parsing || uploading} className="px-3 py-1.5 hover:bg-muted rounded text-sm disabled:opacity-50">Close</button>
            </div>
            <fieldset disabled={parsing || uploading} className="p-6 space-y-4 min-w-0">
              <p className="text-sm text-muted-foreground">Upload a replacement for the same brand without deleting the old list. Existing catalog provenance and audit history are retained.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Brand *">
                  <select value={open.brand} onChange={(e) => setOpen({ ...open, brand: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="select-brand">
                    <option value="">— Select brand —</option>
                    {BRAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </Field>
                <Field label="Version Label (e.g. 2026-Q1)">
                  <input value={open.versionLabel} onChange={(e) => setOpen({ ...open, versionLabel: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-version" />
                </Field>
              </div>
              <Field label="Effective Date (YYYY-MM-DD)">
                <input value={open.effectiveDate} onChange={(e) => setOpen({ ...open, effectiveDate: e.target.value })}
                  placeholder="2026-01-01" className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-effective" />
              </Field>
              <Field label="Notes (internal)">
                <input value={open.notes} onChange={(e) => setOpen({ ...open, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-notes" />
              </Field>
              <Field label="Excel or CSV file (or paste CSV below)">
                <input type="file" accept=".xlsx,.xls,.csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
                  className="block w-full text-sm" data-testid="input-csv-file" />
                <textarea
                  value={open.csv} onChange={(e) => {setWorkbook(null);setUploadError("");setProgress("");setOpen({ ...open, csv: e.target.value });}}
                  rows={10}
                  placeholder="part_number,description,mrp,dealer_price,hsn_code,gst_percent,uom"
                  className="w-full mt-2 border rounded-lg px-3 py-2 bg-background font-mono text-xs"
                  data-testid="input-csv-text"
                />
                <p className="text-xs text-muted-foreground mt-1">Required: part_number, mrp. Optional: description, dealer_price, gst_percent, hsn_code, uom, currency (INR only). MRP is GST-inclusive. Dealer prices remain private; blank dealer/GST metadata retains the latest valid same-brand, same-part value. Explicit zero is retained; malformed metadata stops the chunk. First worksheet, up to 50,000 rows and 8 MB per file. Store long part numbers as text to preserve precision and leading zeros.</p>
              </Field>
            </fieldset>
            <div className="sticky bottom-0 bg-card border-t px-6 py-4">
              {uploadError && <p role="alert" className="mb-3 text-sm text-red-700 break-words">{uploadError}</p>}
              {progress && <p role="status" aria-live="polite" className="mb-3 text-sm break-words">{progress}</p>}
              <div className="flex justify-end gap-3">
              <button onClick={() => setOpen(null)} disabled={parsing || uploading} className="px-4 py-2 border rounded-lg text-sm font-semibold disabled:opacity-50">Cancel</button>
              <button onClick={upload} disabled={parsing || uploading}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm disabled:opacity-50"
                data-testid="button-upload-list-save">
                {parsing ? "Reading file…" : uploading ? "Uploading…" : "Upload Price List"}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</div>
      {children}
    </div>
  );
}
