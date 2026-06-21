import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Trash2, Eye, ExternalLink, Truck, Search, Copy } from "lucide-react";

// R26.5 (A5) — repointed to the v2 purchase_orders_v2 table (Data Team source of truth).
// GET /api/admin/purchase-orders-v2 returns camelCase Drizzle rows with live totals
// + dispatch rollup. PATCH/:id updates fields; DELETE soft-deletes.
interface PO {
  id: number;
  customerId: number | null;
  customerName?: string | null;
  companyName?: string | null;
  customerPoNumber?: string | null;
  internalPoNumber?: string | null;
  status: string;
  custTotal?: number;
  costTotal?: number;
  consignmentStatus?: string | null;
  isFullyDispatched?: number | null;
  notes?: string | null;
  createdAt: number;
  dispatchCarrier?: string | null;
  dispatchDockets?: string[];
}

const STATUSES = ["draft", "submitted", "confirmed", "dispatched", "completed", "cancelled"];

export default function AdminPOs() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<PO[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // R27.1a BUG 7 — date-range filter (YYYY-MM-DD) sent to the server as from/to.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // R27.0 — debounce the search box (250ms) so each keystroke doesn't refetch.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const r = await adminFetch(token, `/api/admin/purchase-orders-v2?${params}`);
    if (!r.ok) { setItems([]); return; }
    const d = await r.json();
    setItems(Array.isArray(d) ? d : (Array.isArray(d?.purchaseOrders) ? d.purchaseOrders : []));
  }
  useEffect(() => { load(); }, [token, filter, debouncedSearch, fromDate, toDate]); // eslint-disable-line

  // R27.1a BUG 9 — duplicate a PO (server resets date to today). Navigate to the new detail.
  async function duplicate(id: number) {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/purchase-orders/${id}/duplicate`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error || "Duplicate failed"); return; }
      const newId = j.id ?? j.po?.id ?? j.purchaseOrder?.id;
      if (newId) navigate(`/admin/purchase-orders-v2/${newId}`);
      else load();
    } finally { setBusy(false); }
  }

  async function setStatus(id: number, status: string) {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/purchase-orders-v2/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      load();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this PO? (soft delete)")) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/purchase-orders-v2/${id}`, { method: "DELETE" });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      load();
    } finally { setBusy(false); }
  }

  const poNo = (p: PO) => p.customerPoNumber || p.internalPoNumber || `PO-${p.id}`;
  const total = (p: PO) => Number(p.custTotal ?? 0);
  const badge = (s: string) => {
    const map: Record<string, string> = {
      draft: "bg-slate-500/15 text-slate-700", submitted: "bg-blue-500/15 text-blue-700",
      confirmed: "bg-indigo-500/15 text-indigo-700", dispatched: "bg-amber-500/15 text-amber-700",
      completed: "bg-emerald-500/15 text-emerald-700", cancelled: "bg-red-500/15 text-red-700",
      processed: "bg-emerald-600 text-white", // R27.1b BUG-3 — processed POs show green
    };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  return (
    <AdminLayout title="Purchase Orders">
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO #, customer, vendor, part number…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm"
            data-testid="input-po-search"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-muted-foreground">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="input-po-from" />
          <label className="text-xs text-muted-foreground">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="input-po-to" />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="text-xs text-muted-foreground underline" data-testid="button-po-clear-dates">Clear</button>
          )}
        </div>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border"}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border"}`}>{s}</button>
        ))}
      </div>
      <div className="mb-4 text-xs text-muted-foreground">
        Showing the v2 purchase orders table (same data the Data Team sees). Use Open to edit in the Team portal.
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No purchase orders in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">PO #</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Dispatch</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((p) => (
                <tr key={p.id} data-testid={`row-po-${p.id}`}>
                  <td className="px-4 py-3 font-mono font-bold">{poNo(p)}</td>
                  <td className="px-4 py-3 text-xs">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3">{p.customerName || (p.customerId ? `#${p.customerId}` : "—")}</td>
                  <td className="px-4 py-3 text-xs">{p.companyName || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{total(p).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-xs">
                    {p.dispatchDockets && p.dispatchDockets.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700"><Truck className="w-3 h-3" />{p.dispatchDockets.join(", ")}</span>
                    ) : (p.consignmentStatus || (p.isFullyDispatched ? "dispatched" : "—"))}
                  </td>
                  <td className="px-4 py-3">{badge(p.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <a
                      href={`/#/team/po/${p.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border rounded mr-1 hover:bg-muted"
                      title="Open in Team portal to edit"
                    >
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                    {/* R26.6a (5) — View opens the dedicated detail page (was a no-op/404). */}
                    <a href={`/#/admin/purchase-orders-v2/${p.id}`} className="inline-flex items-center p-2 hover:bg-muted rounded mr-1" title="View detail" data-testid={`button-view-po-${p.id}`}><Eye className="w-4 h-4" /></a>
                    {/* R27.1a BUG 9 — duplicate (date reset to today). */}
                    <button onClick={() => duplicate(p.id)} disabled={busy} className="inline-flex items-center p-2 hover:bg-muted rounded mr-1" title="Duplicate PO" data-testid={`button-duplicate-po-${p.id}`}><Copy className="w-4 h-4" /></button>
                    <select value={p.status} disabled={busy} onChange={(e) => setStatus(p.id, e.target.value)} className="text-xs border rounded px-2 py-1 bg-background mr-1" data-testid={`select-po-status-${p.id}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => del(p.id)} disabled={busy} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-po-${p.id}`}><Trash2 className="w-4 h-4" /></button>
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
