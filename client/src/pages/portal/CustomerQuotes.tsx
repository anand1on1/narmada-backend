import { useEffect, useState } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Eye, ShoppingCart } from "lucide-react";

export default function CustomerQuotes() {
  const { token } = useCustomerAuth();
  const [items, setItems] = useState<any[]>([]);
  const [view, setView] = useState<any | null>(null);
  const [acceptFor, setAcceptFor] = useState<any | null>(null);

  async function load() {
    if (!token) return;
    const r = await customerFetch(token, "/api/customer/quotes");
    if (r.ok) { const _d = await r.json(); setItems(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  const badge = (s: string) => {
    const map: Record<string, string> = { sent: "bg-blue-500/15 text-blue-700", accepted: "bg-emerald-500/15 text-emerald-700", expired: "bg-slate-500/15 text-slate-700", revised: "bg-amber-500/15 text-amber-700", cancelled: "bg-red-500/15 text-red-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };
  const fmtInr = (n: any) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;
  const fmtDate = (ts: any) => { const x = Number(ts); return x ? new Date(x).toLocaleDateString("en-IN") : "—"; };

  return (
    <PortalLayout title="Quotes">
      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No quotes received yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">Quote #</th><th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold">Valid Until</th>
              <th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((q) => (
                <tr key={q.id}>
                  <td className="px-4 py-3 font-mono font-bold">{q.quoteNo}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(q.createdAt)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmtInr(q.totalInr)}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(q.validUntil)}</td>
                  <td className="px-4 py-3">{badge(q.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setView(q)} className="p-2 hover:bg-muted rounded" title="View"><Eye className="w-4 h-4" /></button>
                    {q.status === "sent" && <button onClick={() => setAcceptFor(q)} className="ml-1 px-2 py-1 text-xs bg-emerald-500/15 text-emerald-700 rounded inline-flex items-center gap-1"><ShoppingCart className="w-3 h-3" />Accept & Raise PO</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view && <QuoteView quote={view} onClose={() => setView(null)} />}
      {acceptFor && <AcceptModal quote={acceptFor} onClose={() => { setAcceptFor(null); load(); }} />}
    </PortalLayout>
  );
}

function QuoteView({ quote, onClose }: any) {
  const fmtInr = (n: any) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;
  let items: any[] = [];
  try { const p = JSON.parse(quote.items); if (Array.isArray(p)) items = p; } catch {}
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-display text-xl font-bold">{quote.quoteNo}</div>
            <div className="text-xs text-muted-foreground">{quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("en-IN") : "—"} {quote.validUntil && `· Valid until ${new Date(quote.validUntil).toLocaleDateString("en-IN")}`}</div>
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
                  <td className="px-3 py-2 text-right">{fmtInr(it.unitPriceInr)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtInr((Number(it.quantity) || 0) * (Number(it.unitPriceInr) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Subtotal</div><div>{fmtInr(quote.subtotalInr)}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">GST</div><div>{fmtInr(quote.gstInr)}</div></div>
            <div><div className="text-xs uppercase font-bold text-muted-foreground">Total</div><div className="text-lg font-bold">{fmtInr(quote.totalInr)}</div></div>
          </div>
          {quote.notes && <div><div className="text-xs uppercase font-bold text-muted-foreground">Notes</div><div className="text-sm whitespace-pre-wrap">{quote.notes}</div></div>}
          {quote.terms && <div><div className="text-xs uppercase font-bold text-muted-foreground">Terms</div><div className="text-sm whitespace-pre-wrap">{quote.terms}</div></div>}
        </div>
      </div>
    </div>
  );
}

function AcceptModal({ quote, onClose }: any) {
  const { token } = useCustomerAuth();
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!token || !poNumber.trim()) return;
    setBusy(true);
    try {
      const r = await customerFetch(token, "/api/customer/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          customerPoNumber: poNumber.trim(), rfqId: quote.rfqId, quoteId: quote.id,
          items: quote.items, subtotalInr: quote.subtotalInr, gstInr: quote.gstInr, totalInr: quote.totalInr,
          notes,
        }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Failed"); return; }
      alert(`PO ${poNumber} submitted. Our accounts team will approve shortly.`);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="border-b px-6 py-4 font-display text-lg font-bold">Accept Quote — Raise PO</div>
        <div className="p-6 space-y-3">
          <div className="text-sm">Quote: <strong>{quote.quoteNo}</strong> · Total <strong>₹{(Number(quote.totalInr) || 0).toLocaleString("en-IN")}</strong></div>
          <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Your PO Number *</div>
            <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background font-mono" placeholder="e.g. PO/2026/001" />
          </label>
          <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" />
          </label>
          <div className="text-xs text-muted-foreground">You can upload the PDF copy of your PO from the Purchase Orders page after submission.</div>
        </div>
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={go} disabled={busy || !poNumber.trim()} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">{busy ? "Submitting…" : "Submit PO"}</button>
        </div>
      </div>
    </div>
  );
}
