import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Edit3, Trash2, FileText } from "lucide-react";

interface Customer { id: number; name: string; }
interface RFQ {
  id: number; customerId: number | null; contactName: string | null; email: string | null;
  phone: string | null; items: string; notes: string | null; status: string;
  assignedTo: string | null; quotedAt: number | null; quoteId: number | null; createdAt: number;
}

const STATUSES = ["open", "quoted", "closed"];

export default function AdminRFQs() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<RFQ[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [quoteFor, setQuoteFor] = useState<RFQ | null>(null);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const r = await adminFetch(token, `/api/admin/rfqs?${params}`);
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

  async function updateStatus(id: number, status: string) {
    if (!token) return;
    const r = await adminFetch(token, `/api/admin/rfqs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  async function del(id: number) {
    if (!token || !confirm("Delete this RFQ?")) return;
    const r = await adminFetch(token, `/api/admin/rfqs/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  const customerName = (id: number | null) => id ? (customers.find((c) => c.id === id)?.name || `#${id}`) : "Guest";
  const badge = (s: string) => {
    const map: Record<string, string> = { open: "bg-blue-500/15 text-blue-700", quoted: "bg-amber-500/15 text-amber-700", closed: "bg-emerald-500/15 text-emerald-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  function parseItems(json: string): any[] {
    try { return JSON.parse(json); } catch { return []; }
  }

  return (
    <AdminLayout title="RFQs">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border"}`}>All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border"}`}>{s}</button>
        ))}
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No RFQs in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Items</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((r) => {
                const its = parseItems(r.items);
                return (
                  <tr key={r.id} data-testid={`row-rfq-${r.id}`}>
                    <td className="px-4 py-3 text-xs">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3">{customerName(r.customerId)}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.contactName && <div>{r.contactName}</div>}
                      {r.email && <div className="text-muted-foreground">{r.email}</div>}
                      {r.phone && <div className="text-muted-foreground">{r.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{its.length} item(s) {its[0]?.partNumber && <span className="font-mono text-muted-foreground">— {its[0].partNumber}{its.length > 1 ? ", …" : ""}</span>}</td>
                    <td className="px-4 py-3">{badge(r.status)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.status !== "quoted" && r.status !== "closed" && <button onClick={() => setQuoteFor(r)} className="px-2 py-1 text-xs bg-amber-500/15 text-amber-700 rounded inline-flex items-center gap-1" data-testid={`button-quote-${r.id}`}><FileText className="w-3 h-3" />Quote</button>}
                      {r.status !== "closed" && <button onClick={() => updateStatus(r.id, "closed")} className="px-2 py-1 text-xs border rounded ml-1">Close</button>}
                      <button onClick={() => del(r.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {quoteFor && <QuoteCreator rfq={quoteFor} onClose={() => { setQuoteFor(null); load(); }} />}
    </AdminLayout>
  );
}

function QuoteCreator({ rfq, onClose }: { rfq: RFQ; onClose: () => void }) {
  const { token } = useAdminAuth();
  let rfqItems: any[] = [];
  try { rfqItems = JSON.parse(rfq.items); } catch {}
  const [items, setItems] = useState(rfqItems.map((it) => ({
    partNumber: it.partNumber || it.part || "", description: it.description || it.name || "",
    quantity: it.quantity || 1, unitPriceInr: it.unitPriceInr || 0,
  })));
  const [gstPercent, setGstPercent] = useState(18);
  const [validDays, setValidDays] = useState(15);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("Payment: 100% advance via NEFT. Delivery: 3-5 working days from order confirmation.");
  const [busy, setBusy] = useState(false);

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) * Number(it.unitPriceInr) || 0), 0);
  const gst = subtotal * gstPercent / 100;
  const total = subtotal + gst;

  function setItem(i: number, k: string, v: any) {
    const next = [...items]; (next[i] as any)[k] = v; setItems(next);
  }
  function addRow() { setItems([...items, { partNumber: "", description: "", quantity: 1, unitPriceInr: 0 }]); }
  function delRow(i: number) { setItems(items.filter((_, j) => j !== i)); }

  async function save() {
    if (!token) return;
    if (!rfq.customerId) { alert("This RFQ has no customer linked; create a customer record first."); return; }
    setBusy(true);
    try {
      const validUntil = Date.now() + validDays * 86400000;
      const r = await adminFetch(token, `/api/admin/quotes`, {
        method: "POST",
        body: JSON.stringify({
          rfqId: rfq.id, customerId: rfq.customerId, items: JSON.stringify(items),
          subtotalInr: subtotal, gstInr: gst, totalInr: total, validUntil, notes, terms, status: "sent",
        }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Failed"); return; }
      alert(`Quote ${j.quoteNo} created (₹${total.toLocaleString("en-IN")}). Customer can view it in their portal.`);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-lg font-bold">Create Quote for RFQ #{rfq.id}</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-4">
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted/50"><tr>
              <th className="px-3 py-2 text-left">Part #</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right w-20">Qty</th>
              <th className="px-3 py-2 text-right w-32">Unit ₹</th>
              <th className="px-3 py-2 text-right w-32">Line ₹</th>
              <th className="w-8"></th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-1"><input value={it.partNumber} onChange={(e) => setItem(i, "partNumber", e.target.value)} className="w-full border rounded px-2 py-1 bg-background text-xs font-mono" /></td>
                  <td className="px-3 py-1"><input value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} className="w-full border rounded px-2 py-1 bg-background text-xs" /></td>
                  <td className="px-3 py-1"><input type="number" value={it.quantity} onChange={(e) => setItem(i, "quantity", parseFloat(e.target.value) || 0)} className="w-full border rounded px-2 py-1 bg-background text-xs text-right" /></td>
                  <td className="px-3 py-1"><input type="number" value={it.unitPriceInr} onChange={(e) => setItem(i, "unitPriceInr", parseFloat(e.target.value) || 0)} className="w-full border rounded px-2 py-1 bg-background text-xs text-right" /></td>
                  <td className="px-3 py-1 text-right text-xs font-semibold">₹{(it.quantity * it.unitPriceInr).toLocaleString("en-IN")}</td>
                  <td className="px-2 py-1"><button onClick={() => delRow(i)} className="text-red-600"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow} className="px-3 py-1.5 border rounded-lg text-xs">+ Add row</button>

          <div className="grid grid-cols-3 gap-3">
            <Field label="GST %"><input type="number" value={gstPercent} onChange={(e) => setGstPercent(parseFloat(e.target.value) || 0)} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
            <Field label="Valid for (days)"><input type="number" value={validDays} onChange={(e) => setValidDays(parseInt(e.target.value) || 0)} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
            <Field label="Total"><div className="px-3 py-2 bg-muted/30 rounded-lg font-bold text-lg">₹{total.toLocaleString("en-IN")}</div></Field>
          </div>
          <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
          <Field label="Terms"><textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
          <div className="text-xs text-muted-foreground">Subtotal ₹{subtotal.toLocaleString("en-IN")} + GST ₹{gst.toLocaleString("en-IN")} = <strong>₹{total.toLocaleString("en-IN")}</strong></div>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">{busy ? "Saving…" : "Send Quote"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
