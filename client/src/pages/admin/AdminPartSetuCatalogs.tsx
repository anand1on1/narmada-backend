// PartSetu AI v1.3 — admin catalog management.
// Upload spare-parts catalogue PDFs (stored on Render's persistent disk and
// auto-ingested into partsetu_catalogs/partsetu_parts), then view / re-ingest /
// delete them. Models the structure of AdminCatalogRequests.tsx.
import { useEffect, useRef, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { apiUrl } from "@/lib/queryClient";
import { BookOpen, UploadCloud, RefreshCw, Trash2, FileText } from "lucide-react";
import FormatConfirmDialog, { type CatalogMetadata } from "@/components/FormatConfirmDialog";

interface CatalogRow {
  id: number;
  oem: string | null;
  model: string | null;
  variant: string | null;
  vc_no: string | null;
  status: string | null;
  file_size_bytes: number | null;
  uploaded_at: number | null;
  uploaded_by: string | null;
  ingest_error: string | null;
  total_pages: number | null;
  parts_count: number;
}

function statusBadge(s: string | null) {
  switch (s) {
    case "active": return "bg-emerald-500/15 text-emerald-700";
    case "ingesting": return "bg-amber-500/15 text-amber-700";
    case "failed": return "bg-rose-500/15 text-rose-700";
    default: return "bg-slate-500/15 text-slate-700";
  }
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

function fmtSize(b: number | null) {
  if (!b) return "—";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminPartSetuCatalogs() {
  const { token, role, adminFetch, uploadHeaders } = useShellAuth();
  const canDelete = role !== "data_center";
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [chassisNo, setChassisNo] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // R27.22 — AI metadata-detection flow.
  const [detecting, setDetecting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [detect, setDetect] = useState<{ fingerprint: string; cached: boolean; metadata: CatalogMetadata | null; confidence: number | null; snippets: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const r = await adminFetch(token, "/api/admin/partsetu/catalogs");
      const j = r.ok ? await r.json() : [];
      setRows(Array.isArray(j) ? j : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  // Step 1: AI metadata detection. Stages the PDF server-side under its
  // fingerprint and opens the confirm dialog. Falls back to legacy upload if
  // detection itself fails.
  async function detectMetadata(file: File) {
    if (!token || detecting || uploading) return;
    if (!/\.pdf$/i.test(file.name)) { setMsg({ kind: "err", text: "Please choose a .pdf file." }); return; }
    setDetecting(true);
    setMsg(null);
    setPendingFile(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(apiUrl("/api/admin/partsetu/catalogs/detect-metadata"), { method: "POST", headers: uploadHeaders, body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setDetect({ fingerprint: j.fingerprint, cached: !!j.cached, metadata: j.metadata || null, confidence: j.confidence ?? null, snippets: Array.isArray(j.snippets) ? j.snippets : [] });
      } else {
        setMsg({ kind: "err", text: j.error || `Detection failed (${r.status}). Uploading with legacy handler…` });
        await legacyUpload(file);
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Detection failed." });
    } finally { setDetecting(false); }
  }

  // Step 2a: confirm the (possibly edited) metadata and ingest the staged PDF.
  async function confirmUpload(metadata: CatalogMetadata, edited: boolean) {
    if (!token || !detect || confirming) return;
    setConfirming(true);
    setMsg(null);
    try {
      const r = await adminFetch(token, "/api/admin/partsetu/catalogs/confirm-upload", {
        method: "POST",
        body: JSON.stringify({ fingerprint: detect.fingerprint, metadata, confidence: detect.confidence, originalFilename: pendingFile?.name || "catalog.pdf", edited }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ kind: "ok", text: `Ingested "${j.model || j.vcNo || "catalog"}" — ${j.partsCount} parts.` });
        closeDialog();
        load();
      } else {
        setMsg({ kind: "err", text: j.error || `Confirm failed (${r.status}).` });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Confirm failed." });
    } finally { setConfirming(false); }
  }

  // Step 2b: skip AI — upload via the legacy deterministic parser.
  async function legacyUpload(file: File) {
    if (!token || uploading) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (chassisNo.trim()) fd.append("chassisNo", chassisNo.trim());
      // Manual fetch: adminFetch forces JSON Content-Type, which breaks multipart.
      const r = await fetch(apiUrl("/api/admin/partsetu/catalogs/upload"), {
        method: "POST",
        headers: uploadHeaders,
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ kind: "ok", text: `Ingested "${j.model || j.vcNo || "catalog"}" — ${j.partsCount} parts.` });
        closeDialog();
        load();
      } else {
        setMsg({ kind: "err", text: j.error || `Upload failed (${r.status}).` });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Upload failed." });
    } finally { setUploading(false); }
  }

  function closeDialog() {
    setDetect(null);
    setPendingFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function reingest(row: CatalogRow) {
    if (!token || busyId) return;
    if (!confirm(`Re-parse this PDF? Existing parts for "${row.model || row.vc_no}" will be replaced.`)) return;
    setBusyId(row.id);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/catalogs/${row.id}/reingest`, { method: "POST", body: JSON.stringify({}) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setMsg({ kind: "ok", text: `Re-ingested — ${j.partsCount} parts.` });
      else setMsg({ kind: "err", text: j.error || "Re-ingest failed." });
      load();
    } finally { setBusyId(null); }
  }

  async function remove(row: CatalogRow) {
    if (!token || busyId) return;
    if (!confirm(`Delete catalog "${row.model || row.vc_no}"? This removes all parts and the PDF file.`)) return;
    setBusyId(row.id);
    setMsg(null);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/catalogs/${row.id}`, { method: "DELETE" });
      if (r.ok) setMsg({ kind: "ok", text: "Catalog deleted." });
      else setMsg({ kind: "err", text: "Delete failed." });
      load();
    } finally { setBusyId(null); }
  }

  function viewPdf(id: number) {
    if (!token) return;
    // Open in a new tab with the admin token via fetch → blob (header auth).
    adminFetch(token, `/api/admin/partsetu/catalogs/${id}/pdf`).then(async (r) => {
      if (!r.ok) { setMsg({ kind: "err", text: "PDF not available." }); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    });
  }

  return (
    <ShellLayout title="PartSetu — Catalog Management">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <BookOpen className="w-4 h-4" /> Upload spare-parts catalogue PDFs. They are stored on the server's persistent disk and auto-indexed for the PartSetu chatbot.
      </div>

      <div className="border rounded-lg p-4 mb-5 bg-muted/20">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) detectMetadata(f); }}
            disabled={uploading || detecting}
            className="text-sm"
            data-testid="input-catalog-pdf"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || detecting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            data-testid="button-catalog-upload"
          >
            <UploadCloud className="w-4 h-4" /> {detecting ? "Detecting metadata…" : uploading ? "Uploading & parsing…" : "Upload catalog PDF"}
          </button>
          <input
            type="text"
            value={chassisNo}
            onChange={(e) => setChassisNo(e.target.value)}
            placeholder="Chassis No (optional)"
            disabled={uploading}
            className="text-sm border rounded-lg px-3 py-1.5 bg-background"
            data-testid="input-catalog-chassis"
          />
          <span className="text-xs text-muted-foreground">PDF only, up to 100 MB. Parsing a large catalogue can take ~30s.</span>
        </div>
        {msg && (
          <div className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`} data-testid="text-catalog-msg">
            {msg.text}
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold">Model</th>
              <th className="px-3 py-2 font-semibold">Variant</th>
              <th className="px-3 py-2 font-semibold">OEM</th>
              <th className="px-3 py-2 font-semibold">VC No</th>
              <th className="px-3 py-2 font-semibold">Parts</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Size</th>
              <th className="px-3 py-2 font-semibold">Uploaded</th>
              <th className="px-3 py-2 font-semibold">By</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No catalogs yet. Upload a PDF to get started.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30 align-top" data-testid={`catalog-row-${r.id}`}>
                <td className="px-3 py-2 max-w-xs">
                  <div className="font-medium truncate" title={r.model || ""}>{r.model || "—"}</div>
                  {r.ingest_error && <div className="text-xs text-rose-600 mt-0.5">{r.ingest_error}</div>}
                </td>
                <td className="px-3 py-2">{r.variant || "—"}</td>
                <td className="px-3 py-2">{r.oem || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.vc_no || "—"}</td>
                <td className="px-3 py-2">{r.parts_count}</td>
                <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(r.status)}`}>{r.status || "—"}</span></td>
                <td className="px-3 py-2 text-muted-foreground">{fmtSize(r.file_size_bytes)}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.uploaded_at)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.uploaded_by || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => viewPdf(r.id)} className="inline-flex items-center gap-1 text-blue-600 hover:underline" data-testid={`catalog-view-${r.id}`}><FileText className="w-4 h-4" />PDF</button>
                    <button onClick={() => reingest(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-amber-700 hover:underline disabled:opacity-50" data-testid={`catalog-reingest-${r.id}`}><RefreshCw className="w-4 h-4" />Re-ingest</button>
                    {canDelete && <button onClick={() => remove(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 text-rose-600 hover:underline disabled:opacity-50" data-testid={`catalog-delete-${r.id}`}><Trash2 className="w-4 h-4" />Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detect && (
        <FormatConfirmDialog
          mode="catalog"
          metadata={detect.metadata || {}}
          snippets={detect.snippets}
          confidence={detect.confidence}
          cached={detect.cached}
          busy={confirming || uploading}
          onConfirm={confirmUpload}
          onCancel={closeDialog}
          onSkip={() => { if (pendingFile) legacyUpload(pendingFile); }}
        />
      )}
    </ShellLayout>
  );
}
