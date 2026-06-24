// PartSetu AI v1 — admin view of customer catalog requests.
// Lists partsetu_catalog_requests with a status filter and a detail modal where
// the team can change status and record internal notes.
import { useEffect, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { FileQuestion, X } from "lucide-react";

interface CatalogRequest {
  id: number;
  customer_id: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: string | null;
  chassis_no: string | null;
  engine_model: string | null;
  notes: string | null;
  photo_url: string | null;
  status: string;
  admin_notes: string | null;
  created_at: number | null;
  updated_at: number | null;
}

const STATUSES = ["all", "pending", "in_progress", "fulfilled", "rejected"];

function statusBadge(s: string) {
  switch (s) {
    case "pending": return "bg-amber-500/15 text-amber-700";
    case "in_progress": return "bg-blue-500/15 text-blue-700";
    case "fulfilled": return "bg-emerald-500/15 text-emerald-700";
    case "rejected": return "bg-rose-500/15 text-rose-700";
    default: return "bg-slate-500/15 text-slate-700";
  }
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}

export default function AdminCatalogRequests() {
  const { token, adminFetch } = useShellAuth();
  const [rows, setRows] = useState<CatalogRequest[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<CatalogRequest | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (status !== "all") p.set("status", status);
      const r = await adminFetch(token, `/api/admin/partsetu/catalog-requests?${p.toString()}`);
      const j = r.ok ? await r.json() : [];
      setRows(Array.isArray(j) ? j : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, status]);

  return (
    <ShellLayout title="Catalog Requests">
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileQuestion className="w-4 h-4" /> PartSetu catalog requests from customers
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="select-catreq-status">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All" : s}</option>)}
          </select>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Vehicle</th>
              <th className="px-3 py-2 font-semibold">Chassis</th>
              <th className="px-3 py-2 font-semibold">Engine</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Requested</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No catalog requests.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30" data-testid={`catreq-row-${r.id}`}>
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2">{[r.make, r.model, r.variant, r.year].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-2">{r.chassis_no || "—"}</td>
                <td className="px-3 py-2">{r.engine_model || "—"}</td>
                <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(r.status)}`}>{r.status}</span></td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setActive(r)} className="text-blue-600 hover:underline font-semibold" data-testid={`catreq-view-${r.id}`}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <DetailModal
          token={token}
          request={active}
          onClose={() => setActive(null)}
          onSaved={() => { setActive(null); load(); }}
        />
      )}
    </ShellLayout>
  );
}

function DetailModal({ token, request, onClose, onSaved }: {
  token: string | null;
  request: CatalogRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { adminFetch } = useShellAuth();
  const [status, setStatus] = useState(request.status);
  const [adminNotes, setAdminNotes] = useState(request.admin_notes || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!token || busy) return;
    setBusy(true);
    try {
      await adminFetch(token, `/api/admin/partsetu/catalog-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, adminNotes }),
      });
      onSaved();
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string | null) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="catreq-modal">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Catalog Request #{request.id}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="catreq-modal-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {field("Make", request.make)}
            {field("Model", request.model)}
            {field("Variant", request.variant)}
            {field("Year", request.year)}
            {field("Chassis No.", request.chassis_no)}
            {field("Engine model", request.engine_model)}
          </div>
          {field("Customer notes", request.notes)}
          {request.photo_url && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Photo</div>
              <a href={request.photo_url} target="_blank" rel="noreferrer">
                <img src={request.photo_url} alt="Request" className="max-h-48 rounded-lg border" />
              </a>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background text-sm mt-1" data-testid="catreq-modal-status">
              {STATUSES.filter((s) => s !== "all").map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Internal notes</label>
            <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background text-sm mt-1" data-testid="catreq-modal-notes" placeholder="Notes for the team…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border text-sm font-semibold" data-testid="catreq-modal-cancel">Cancel</button>
          <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="catreq-modal-save">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
