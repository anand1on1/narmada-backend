// PartSetu AI v1.4 — admin comparative-sheet (xref) management.
// Upload WABCO-style cross-reference .xlsx workbooks. These feed part xref
// matching only — NEVER pricing (prices come from partsetu_prices + price_master).
import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { Link2, UploadCloud, RefreshCw, Trash2 } from "lucide-react";

interface XrefSource {
  id: number;
  source_name: string | null;
  source_brand: string | null;
  row_count: number | null;
  uploaded_by: string | null;
  uploaded_at: number | null;
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

export default function AdminPartSetuXrefs() {
  const { token, role } = useAdminAuth();
  const canDelete = role !== "data_center";
  const [rows, setRows] = useState<XrefSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceBrand, setSourceBrand] = useState("WABCO");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const r = await adminFetch(token, "/api/admin/partsetu/xrefs");
      const j = r.ok ? await r.json() : [];
      setRows(Array.isArray(j) ? j : []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function upload(file: File) {
    if (!token || uploading) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setMsg({ kind: "err", text: "Please choose a .xlsx file." }); return; }
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (sourceName.trim()) fd.append("sourceName", sourceName.trim());
      if (sourceBrand.trim()) fd.append("sourceBrand", sourceBrand.trim());
      const r = await fetch(apiUrl("/api/admin/partsetu/xrefs/upload"), {
        method: "POST",
        headers: { "x-admin-token": token },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ kind: "ok", text: `Ingested ${j.totalInserted} xref rows from ${j.sheetsUsed} sheet(s).` });
        if (fileRef.current) fileRef.current.value = "";
        load();
      } else {
        setMsg({ kind: "err", text: j.error || `Upload failed (${r.status}).` });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Upload failed." });
    } finally { setUploading(false); }
  }

  async function reingest(row: XrefSource) {
    if (!token || busyId) return;
    if (!confirm(`Re-parse "${row.source_name}"? Existing rows for this source will be replaced.`)) return;
    setBusyId(row.id);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/xrefs/${row.id}/reingest`, { method: "POST", body: JSON.stringify({}) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setMsg({ kind: "ok", text: `Re-ingested — ${j.totalInserted} rows.` });
      else setMsg({ kind: "err", text: j.error || "Re-ingest failed." });
      load();
    } finally { setBusyId(null); }
  }

  async function remove(row: XrefSource) {
    if (!token || busyId) return;
    if (!confirm(`Delete source "${row.source_name}"? This removes all its xref rows.`)) return;
    setBusyId(row.id);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/xrefs/${row.id}`, { method: "DELETE" });
      if (r.ok) setMsg({ kind: "ok", text: "Source deleted." });
      else setMsg({ kind: "err", text: "Delete failed." });
      load();
    } finally { setBusyId(null); }
  }

  return (
    <AdminLayout title="PartSetu — Comparative Sheets">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link2 className="w-4 h-4" /> Upload cross-reference / comparative workbooks (.xlsx). These power part cross-matching only — pricing never comes from these sheets.
      </div>

      <div className="border rounded-lg p-4 mb-5 bg-muted/20">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="Source name (optional)"
            disabled={uploading}
            className="text-sm border rounded-lg px-3 py-1.5 bg-background"
            data-testid="input-xref-source-name"
          />
          <input
            type="text"
            value={sourceBrand}
            onChange={(e) => setSourceBrand(e.target.value)}
            placeholder="Brand"
            disabled={uploading}
            className="text-sm border rounded-lg px-3 py-1.5 bg-background w-28"
            data-testid="input-xref-source-brand"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
            disabled={uploading}
            className="text-sm"
            data-testid="input-xref-file"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            data-testid="button-xref-upload"
          >
            <UploadCloud className="w-4 h-4" /> {uploading ? "Uploading & parsing…" : "Upload workbook"}
          </button>
          <span className="text-xs text-muted-foreground">.xlsx only, up to 100 MB.</span>
        </div>
        {msg && (
          <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`} data-testid="text-xref-msg">
            {msg.text}
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Brand</th>
              <th className="px-3 py-2 font-semibold">Rows</th>
              <th className="px-3 py-2 font-semibold">Uploaded</th>
              <th className="px-3 py-2 font-semibold">By</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No comparative sheets yet.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30" data-testid={`xref-row-${r.id}`}>
                <td className="px-3 py-2 font-medium">{r.source_name || "—"}</td>
                <td className="px-3 py-2">{r.source_brand || "—"}</td>
                <td className="px-3 py-2">{r.row_count ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.uploaded_at)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.uploaded_by || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => reingest(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-amber-700 hover:underline disabled:opacity-50" data-testid={`xref-reingest-${r.id}`}><RefreshCw className="w-4 h-4" />Re-ingest</button>
                    {canDelete && <button onClick={() => remove(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50" data-testid={`xref-delete-${r.id}`}><Trash2 className="w-4 h-4" />Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
