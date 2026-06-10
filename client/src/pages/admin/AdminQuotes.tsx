import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Trash2, Eye } from "lucide-react";

interface Customer { id: number; name: string; }
interface Quote {
  id: number; quoteNo: string; rfqId: number | null; customerId: number;
  items: string; subtotalInr: number; gstInr: number; totalInr: number;
  validUntil: number | null; status: string; notes: string | null; terms: string | null;
  createdAt: number;
}

const STATUSES = ["sent", "accepted", "expired", "revised", "cancelled"];

export default function AdminQuotes() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [view, setView] = useState<Quote | null>(null);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const r = await adminFetch(token, `/api/admin/quotes?${params}`);
    setItems(await r.json());
  }
  useEffect(() => {
    (async () => {
      if (!token) return;
      const r = await adminFetch(token, `/api/admin/customers`);
      setCustomers(await r.json());
    })();
  }, [token]);
  useEffect(() => { load(); }, [token, filter]); // eslint-disable-line

  async function setStatus(id: number, status: string) {
    if (!token) return;
    const r = await adminFetch(token, `/api/admin/quotes/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this quote?")) return;
    const r = await adminFetch(token, `/api/admin/quotes/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name || `#${id}`;
  const badge = (s: string) => {
    const map: Record<string, string> = { sent: "bg-blue-500/15 text-blue-700", accepted: "bg-emerald-500/15 text-emerald-700", expired: "bg-slate-500/15 text-slate-700", revised: "bg-amber-500/15 text-amber-700", cancelled: "bg-red-500/15 text-red-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  return (
    <AdminLayout title="Quotes">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border"}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border"}`}>{s}</button>
        ))}
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No quotes in this view.</div>
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
                  <td className="px-4 py-3 text-xs">{new Date(q.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3">{customerName(q.customerId)}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{q.totalInr.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-xs">{q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3">{badge(q.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setView(q)} className="p-2 hover:bg-muted rounded" title="View"><Eye className="w-4 h-4" /></button>
                    <select value={q.status} onChange={(e) => setStatus(q.id, e.target.value)} className="text-xs border rounded px-2 py-1 bg-background ml-1">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => del(q.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded ml-1"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view && <QuoteViewer quote={view} customerName={customerName(view.customerId)} onClose={() => setView(null)} />}
    </AdminLayout>
  );
}

function QuoteViewer({ quote, customerName, onClose }: { quote: Quote; customerName: string; onClose: () => void }) {
  let items: any[] = [];
  try { items = JSON.parse(quote.items); } catch {}
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-display text-xl font-bold">{quote.quoteNo}</div>
            <div className="text-xs text-muted-foreground">{customerName} · {new Date(quote.createdAt).toLocaleDateString("en-IN")}</div>
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
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Subtotal</div><div>₹{quote.subtotalInr.toLocaleString("en-IN")}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">GST</div><div>₹{quote.gstInr.toLocaleString("en-IN")}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Total</div><div className="text-lg font-bold">₹{quote.totalInr.toLocaleString("en-IN")}</div></div>
          </div>
          {quote.notes && <div><div className="text-xs uppercase font-bold text-muted-foreground">Notes</div><div className="text-sm whitespace-pre-wrap">{quote.notes}</div></div>}
          {quote.terms && <div><div className="text-xs uppercase font-bold text-muted-foreground">Terms</div><div className="text-sm whitespace-pre-wrap">{quote.terms}</div></div>}
        </div>
      </div>
    </div>
  );
}
