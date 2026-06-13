import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Trash2, Plus, ExternalLink } from "lucide-react";

// R26.5 (A3) — repointed to the v2 quotations table (Data Team is source of truth).
// GET /api/admin/quotations returns { quotations, total, pages }.
interface Quote {
  id: number; quoteNo: string; customerId: number; customerName?: string | null;
  status: string; currency?: string; grandTotal?: number; subtotal?: number;
  totalTax?: number; validUntil: number | null; notes?: string | null;
  createdAt: number;
}

const STATUSES = ["draft", "sent", "accepted", "expired", "revised", "cancelled"];

export default function AdminQuotes() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<Quote[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const r = await adminFetch(token, `/api/admin/quotations?${params}`);
    if (!r.ok) { setItems([]); return; }
    const d = await r.json();
    // v2 shape: { quotations, total, pages }; tolerate a bare array too.
    setItems(Array.isArray(d) ? d : (Array.isArray(d?.quotations) ? d.quotations : []));
  }
  useEffect(() => { load(); }, [token, filter]); // eslint-disable-line

  async function setStatus(id: number, status: string) {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/quotations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      load();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this quotation? (soft delete)")) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/quotations/${id}`, { method: "DELETE" });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      load();
    } finally { setBusy(false); }
  }

  const total = (q: Quote) => Number(q.grandTotal ?? 0);
  const badge = (s: string) => {
    const map: Record<string, string> = {
      draft: "bg-slate-500/15 text-slate-700", sent: "bg-blue-500/15 text-blue-700",
      accepted: "bg-emerald-500/15 text-emerald-700", expired: "bg-slate-500/15 text-slate-700",
      revised: "bg-amber-500/15 text-amber-700", cancelled: "bg-red-500/15 text-red-700",
    };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  return (
    <AdminLayout title="Quotes">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border"}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border"}`}>{s}</button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => navigate("/team/quotations/new")}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-new-quotation"
          title="Opens the 5-step Quotation wizard in the Team portal (requires a separate Data Team login)"
        >
          <Plus className="w-4 h-4" /> New Quotation
        </button>
      </div>
      <div className="mb-4 text-xs text-muted-foreground">
        Showing the v2 quotations table (same data the Data Team sees). Use Open / PDF to edit line items in the Team portal.
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No quotations in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Quote #</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Valid Until</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((q) => (
                <tr key={q.id} data-testid={`row-quote-${q.id}`}>
                  <td className="px-4 py-3 font-mono font-bold">{q.quoteNo}</td>
                  <td className="px-4 py-3 text-xs">{q.createdAt ? new Date(q.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3">{q.customerName || `#${q.customerId}`}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{total(q).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-xs">{q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3">{badge(q.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a
                      href={`/#/team/quotations/${q.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border rounded mr-1 hover:bg-muted"
                      title="Open in Team portal to edit / download PDF / convert to PO"
                    >
                      <ExternalLink className="w-3 h-3" /> Open / PDF
                    </a>
                    <select value={q.status} disabled={busy} onChange={(e) => setStatus(q.id, e.target.value)} className="text-xs border rounded px-2 py-1 bg-background mr-1" data-testid={`select-status-${q.id}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => del(q.id)} disabled={busy} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-${q.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
