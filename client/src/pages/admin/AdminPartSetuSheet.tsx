// PartSetu AI v1.4 — shared flexible-mapping upload page for Price Lists (C2)
// and Consumption Reports (C3). Upload → backend returns columns + sample rows →
// admin maps each schema field to a column → ingest with the chosen mapping.
import { useEffect, useRef, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { apiUrl } from "@/lib/queryClient";
import { UploadCloud, Trash2, ArrowRight } from "lucide-react";

interface SourceRow {
  id: number;
  source_name: string | null;
  row_count: number | null;
  uploaded_by: string | null;
  uploaded_at: number | null;
}

interface Preview {
  filePath: string;
  originalName: string;
  schemaFields: string[];
  columns: string[];
  sampleRows: any[][];
  totalRows: number;
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

export function AdminPartSetuSheet({ kind, title, hint, accept, maxMb }: {
  kind: "prices" | "consumption";
  title: string;
  hint: string;
  accept: string;
  maxMb: number;
}) {
  const { token, role, adminFetch, uploadHeaders } = useShellAuth();
  const canDelete = role !== "data_center";
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [map, setMap] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/${kind}`);
      const j = r.ok ? await r.json() : [];
      setRows(Array.isArray(j) ? j : []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, kind]);

  async function doPreview(file: File) {
    if (!token || uploading) return;
    setUploading(true);
    setMsg(null);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const r = await fetch(apiUrl("/api/admin/partsetu/sheet/preview"), {
        method: "POST",
        headers: uploadHeaders,
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setPreview(j);
        setSourceName(file.name);
        // Best-effort auto-map: match schema field to a column name containing it.
        const auto: Record<string, number> = {};
        (j.schemaFields || []).forEach((f: string) => {
          const idx = (j.columns || []).findIndex((c: string) =>
            String(c).toLowerCase().replace(/[^a-z0-9]/g, "").includes(f.toLowerCase().replace(/[^a-z0-9]/g, "")));
          if (idx >= 0) auto[f] = idx;
        });
        setMap(auto);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setMsg({ kind: "err", text: j.error || `Preview failed (${r.status}).` });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Preview failed." });
    } finally { setUploading(false); }
  }

  async function ingest() {
    if (!token || !preview || ingesting) return;
    setIngesting(true);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/${kind}/ingest`, {
        method: "POST",
        body: JSON.stringify({ filePath: preview.filePath, sourceName: sourceName.trim() || preview.originalName, columnMap: map }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ kind: "ok", text: `Ingested ${j.totalInserted ?? j.rowsInserted ?? 0} rows.` });
        setPreview(null);
        load();
      } else {
        setMsg({ kind: "err", text: j.error || "Ingest failed." });
      }
    } finally { setIngesting(false); }
  }

  async function remove(row: SourceRow) {
    if (!token || busyId) return;
    if (!confirm(`Delete source "${row.source_name}"? This removes all its rows.`)) return;
    setBusyId(row.id);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/${kind}/${row.id}`, { method: "DELETE" });
      if (r.ok) setMsg({ kind: "ok", text: "Source deleted." });
      else setMsg({ kind: "err", text: "Delete failed." });
      load();
    } finally { setBusyId(null); }
  }

  return (
    <ShellLayout title={title}>
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <UploadCloud className="w-4 h-4" /> {hint}
      </div>

      {!preview && (
        <div className="border rounded-lg p-4 mb-5 bg-muted/20">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doPreview(f); }}
              disabled={uploading}
              className="text-sm"
              data-testid={`input-${kind}-file`}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
              data-testid={`button-${kind}-upload`}
            >
              <UploadCloud className="w-4 h-4" /> {uploading ? "Reading columns…" : "Choose file & preview"}
            </button>
            <span className="text-xs text-muted-foreground">Up to {maxMb} MB. You map columns after upload.</span>
          </div>
          {msg && (
            <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`} data-testid={`text-${kind}-msg`}>
              {msg.text}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="border rounded-lg p-4 mb-5 bg-muted/10" data-testid={`${kind}-mapping`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Map columns — {preview.originalName} ({preview.totalRows} rows)</h3>
            <button onClick={() => setPreview(null)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
          </div>
          <div className="mb-3">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Source name</label>
            <input value={sourceName} onChange={(e) => setSourceName(e.target.value)}
              className="block mt-1 w-full max-w-md border rounded-lg px-3 py-2 bg-background text-sm" data-testid={`input-${kind}-source-name`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {preview.schemaFields.map((f) => (
              <div key={f}>
                <label className="text-xs font-medium">{f}</label>
                <select
                  value={map[f] ?? -1}
                  onChange={(e) => setMap({ ...map, [f]: Number(e.target.value) })}
                  className="block mt-1 w-full border rounded-lg px-2 py-1.5 bg-background text-sm"
                  data-testid={`select-${kind}-map-${f}`}
                >
                  <option value={-1}>— not mapped —</option>
                  {preview.columns.map((c, i) => (
                    <option key={i} value={i}>{c || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto mb-4 border rounded">
            <table className="text-xs">
              <thead className="bg-muted/50">
                <tr>{preview.columns.map((c, i) => <th key={i} className="px-2 py-1 text-left font-semibold whitespace-nowrap">{c || `Col ${i + 1}`}</th>)}</tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, ri) => (
                  <tr key={ri} className="border-t">{preview.columns.map((_, ci) => <td key={ci} className="px-2 py-1 whitespace-nowrap">{String(row[ci] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={ingest} disabled={ingesting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
            data-testid={`button-${kind}-ingest`}>
            <ArrowRight className="w-4 h-4" /> {ingesting ? "Ingesting…" : "Ingest with this mapping"}
          </button>
          {msg && (
            <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</div>
          )}
        </div>
      )}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Rows</th>
              <th className="px-3 py-2 font-semibold">Uploaded</th>
              <th className="px-3 py-2 font-semibold">By</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No sources yet.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30" data-testid={`${kind}-row-${r.id}`}>
                <td className="px-3 py-2 font-medium">{r.source_name || "—"}</td>
                <td className="px-3 py-2">{r.row_count ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.uploaded_at)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.uploaded_by || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    {canDelete && <button onClick={() => remove(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50" data-testid={`${kind}-delete-${r.id}`}><Trash2 className="w-4 h-4" />Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ShellLayout>
  );
}
