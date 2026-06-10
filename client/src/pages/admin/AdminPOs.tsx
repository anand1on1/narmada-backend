import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Trash2, Eye, Check, X, Bell } from "lucide-react";

interface Customer { id: number; name: string; }
interface PO {
  id: number; customerId: number; customerPoNumber: string; rfqId: number | null; quoteId: number | null;
  items: string; subtotalInr: number | null; gstInr: number | null; totalInr: number; status: string;
  reminderCount: number; lastRemindedAt: number | null; approvedAt: number | null; approvedBy: string | null;
  notes: string | null; createdAt: number;
}

const STATUSES = ["pending", "approved", "rejected"];

export default function AdminPOs() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<PO[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [view, setView] = useState<PO | null>(null);
  const [rejectFor, setRejectFor] = useState<PO | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const r = await adminFetch(token, `/api/admin/purchase-orders?${params}`);
    { const _d = await r.json(); setItems(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => {
    (async () => {
      if (!token) return;
      const r = await adminFetch(token, `/api/admin/customers`);
      { const _d = await r.json(); setCustomers(Array.isArray(_d) ? _d : []); }
    })();
  }, [token]);
  useEffect(() => { load(); }, [token, filter]); // eslint-disable-line

  async function approve(id: number) {
    if (!token || !confirm("Approve this PO? An invoice ledger entry will be auto-created.")) return;
    const r = await adminFetch(token, `/api/admin/purchase-orders/${id}/approve`, { method: "POST" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }
  async function reject() {
    if (!token || !rejectFor) return;
    const r = await adminFetch(token, `/api/admin/purchase-orders/${rejectFor.id}/reject`, { method: "POST", body: JSON.stringify({ notes: rejectNotes }) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setRejectFor(null); setRejectNotes(""); load();
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this PO?")) return;
    const r = await adminFetch(token, `/api/admin/purchase-orders/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name || `#${id}`;
  const badge = (s: string) => {
    const map: Record<string, string> = { pending: "bg-amber-500/15 text-amber-700", approved: "bg-emerald-500/15 text-emerald-700", rejected: "bg-red-500/15 text-red-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };
  const ageDays = (ts: number) => Math.floor((Date.now() - ts) / 86400000);

  return (
    <AdminLayout title="Purchase Orders">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border"}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border"}`}>{s}</button>
        ))}
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
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Age</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((p) => {
                const age = ageDays(p.createdAt);
                const isStale = p.status === "pending" && age > 3;
                return (
                  <tr key={p.id} className={isStale ? "bg-amber-500/5" : ""} data-testid={`row-po-${p.id}`}>
                    <td className="px-4 py-3 font-mono font-bold">{p.customerPoNumber}</td>
                    <td className="px-4 py-3 text-xs">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3">{customerName(p.customerId)}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{p.totalInr.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{badge(p.status)}</td>
                    <td className="px-4 py-3 text-xs">
                      {age}d
                      {isStale && <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700 font-bold"><Bell className="w-3 h-3" />stale</span>}
                      {p.reminderCount > 0 && <div className="text-muted-foreground">{p.reminderCount} reminder(s) sent</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setView(p)} className="p-2 hover:bg-muted rounded" title="View"><Eye className="w-4 h-4" /></button>
                      {p.status === "pending" && <>
                        <button onClick={() => approve(p.id)} className="p-2 hover:bg-emerald-500/10 text-emerald-700 rounded ml-1" title="Approve"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setRejectFor(p)} className="p-2 hover:bg-red-500/10 text-red-600 rounded ml-1" title="Reject"><X className="w-4 h-4" /></button>
                      </>}
                      <button onClick={() => del(p.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {view && <POViewer po={view} customerName={customerName(view.customerId)} onClose={() => setView(null)} />}
      {rejectFor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="border-b px-6 py-4 font-display text-lg font-bold">Reject PO {rejectFor.customerPoNumber}</div>
            <div className="p-6 space-y-3">
              <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Reason for rejection</div>
                <textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={4} className="w-full border rounded-lg px-3 py-2 bg-background" />
              </label>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setRejectFor(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={reject} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold">Reject PO</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function POViewer({ po, customerName, onClose }: { po: PO; customerName: string; onClose: () => void }) {
  let items: any[] = [];
  try { items = JSON.parse(po.items); } catch {}
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-display text-xl font-bold">PO {po.customerPoNumber}</div>
            <div className="text-xs text-muted-foreground">{customerName} · {new Date(po.createdAt).toLocaleDateString("en-IN")}</div>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-4">
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted/50"><tr>
              <th className="px-3 py-2 text-left">Part #</th><th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit ₹</th><th className="px-3 py-2 text-right">Line ₹</th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-mono text-xs">{it.partNumber}</td>
                  <td className="px-3 py-2 text-xs">{it.description}</td>
                  <td className="px-3 py-2 text-right">{it.quantity}</td>
                  <td className="px-3 py-2 text-right">₹{Number(it.unitPriceInr).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right font-semibold">₹{(Number(it.quantity) * Number(it.unitPriceInr)).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Subtotal</div><div>₹{(po.subtotalInr || 0).toLocaleString("en-IN")}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">GST</div><div>₹{(po.gstInr || 0).toLocaleString("en-IN")}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Total</div><div className="text-lg font-bold">₹{po.totalInr.toLocaleString("en-IN")}</div></div>
          </div>
          {po.notes && <div><div className="text-xs uppercase font-bold text-muted-foreground">Notes</div><div className="text-sm whitespace-pre-wrap">{po.notes}</div></div>}
          {po.approvedAt && <div className="text-xs text-muted-foreground">{po.status === "approved" ? "Approved" : "Reviewed"} by {po.approvedBy || "—"} on {new Date(po.approvedAt).toLocaleDateString("en-IN")}</div>}
        </div>
      </div>
    </div>
  );
}
