import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Edit3, Trash2, FileText, Eye, X, Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Customer { id: number; name: string; }
interface RFQ {
  id: number; customerId: number | null; contactName: string | null; email: string | null;
  phone: string | null; items: string; notes: string | null; status: string;
  assignedTo: string | null; quotedAt: number | null; quoteId: number | null; createdAt: number;
}

const STATUSES = ["open", "quoted", "closed"];

export default function AdminRFQs() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<RFQ[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [quoteFor, setQuoteFor] = useState<RFQ | null>(null);
  const [detailsFor, setDetailsFor] = useState<RFQ | null>(null);
  const [showNewRFQ, setShowNewRFQ] = useState(false);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const r = await adminFetch(token, `/api/admin/rfqs?${params}`);
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
        <div className="flex-1" />
        <button
          onClick={() => setShowNewRFQ(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New RFQ
        </button>
      </div>
      {showNewRFQ && (
        <NewRFQModal
          token={token}
          customers={customers}
          onClose={() => setShowNewRFQ(false)}
          onCreated={(id) => { setShowNewRFQ(false); load(); }}
          toast={toast}
        />
      )}

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
                      <button onClick={() => setDetailsFor(r)} className="px-2 py-1 text-xs bg-blue-500/15 text-blue-700 rounded inline-flex items-center gap-1" data-testid={`button-view-${r.id}`}><Eye className="w-3 h-3" />View</button>
                      {r.status !== "quoted" && r.status !== "closed" && <button onClick={() => setQuoteFor(r)} className="px-2 py-1 text-xs bg-amber-500/15 text-amber-700 rounded inline-flex items-center gap-1 ml-1" data-testid={`button-quote-${r.id}`}><FileText className="w-3 h-3" />Quote</button>}
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
      {detailsFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailsFor(null)}>
          <div className="bg-card border rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-card">
              <div>
                <div className="font-bold text-lg">RFQ #{detailsFor.id}</div>
                <div className="text-xs text-muted-foreground">{customerName(detailsFor.customerId)} · {new Date(detailsFor.createdAt).toLocaleString("en-IN")} · {badge(detailsFor.status)}</div>
              </div>
              <button onClick={() => setDetailsFor(null)} className="p-2 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><div className="text-xs text-muted-foreground uppercase font-semibold">Contact Name</div><div>{detailsFor.contactName || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground uppercase font-semibold">Phone</div><div>{detailsFor.phone || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground uppercase font-semibold">Email</div><div>{detailsFor.email || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground uppercase font-semibold">Assigned To</div><div>{detailsFor.assignedTo || "—"}</div></div>
              </div>
              {detailsFor.notes && <div><div className="text-xs text-muted-foreground uppercase font-semibold mb-1">Notes</div><div className="p-3 bg-muted/30 rounded whitespace-pre-wrap">{detailsFor.notes}</div></div>}
              <div>
                <div className="text-xs text-muted-foreground uppercase font-semibold mb-2">Items ({parseItems(detailsFor.items).length})</div>
                <div className="border rounded overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Part No.</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Brand</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {parseItems(detailsFor.items).map((it: any, i: number) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2 font-mono">{it.partNumber || it.part_number || "—"}</td>
                          <td className="px-3 py-2">{it.productName || it.name || it.description || "—"}</td>
                          <td className="px-3 py-2">{it.brand || "—"}</td>
                          <td className="px-3 py-2 text-right">{it.qty || it.quantity || 1}</td>
                          <td className="px-3 py-2 text-muted-foreground">{it.notes || "—"}</td>
                        </tr>
                      ))}
                      {parseItems(detailsFor.items).length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No items listed.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {detailsFor.quotedAt && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs">
                  <span className="font-semibold">Quoted at:</span> {new Date(detailsFor.quotedAt).toLocaleString("en-IN")}
                  {detailsFor.quoteId && <> — Quote ID #{detailsFor.quoteId}</>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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

// ---- New RFQ Modal (Admin) ----
interface NewRFQModalProps {
  token: string | null;
  customers: Customer[];
  onClose: () => void;
  onCreated: (id: number) => void;
  toast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}

function NewRFQModal({ token, customers, onClose, onCreated, toast }: NewRFQModalProps) {
  const [customerId, setCustomerId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<any[]>([]);
  const [selectedParts, setSelectedParts] = useState<Array<{ partNumber: string; description: string; qty: number }>>([]);
  const [busy, setBusy] = useState(false);

  async function searchParts() {
    if (!token || partSearch.length < 3) return;
    try {
      const r = await adminFetch(token, `/api/team/parts?q=${encodeURIComponent(partSearch)}`);
      if (r.ok) setPartResults(await r.json());
    } catch {}
  }

  function addPart(p: any) {
    if (selectedParts.find((x) => x.partNumber === p.partNumber)) return;
    setSelectedParts([...selectedParts, { partNumber: p.partNumber, description: p.description || "", qty: 1 }]);
    setPartResults([]);
    setPartSearch("");
  }

  function removePart(pn: string) {
    setSelectedParts(selectedParts.filter((p) => p.partNumber !== pn));
  }

  function setPartQty(pn: string, qty: number) {
    setSelectedParts(selectedParts.map((p) => p.partNumber === pn ? { ...p, qty } : p));
  }

  async function submit() {
    if (!token) return;
    if (!customerId) { toast({ title: "Select a customer", variant: "destructive" }); return; }
    if (selectedParts.length === 0) { toast({ title: "Add at least one part", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/rfqs`, {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId),
          items: JSON.stringify(selectedParts.map((p) => ({ partNumber: p.partNumber, description: p.description, quantity: p.qty }))),
          notes,
          status: "open",
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast({ title: "Error", description: j.error || "Failed", variant: "destructive" }); return; }
      toast({ title: `RFQ created` });
      onCreated(j.id);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-lg font-bold">New RFQ</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <Field label="Customer *">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm"
            >
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Search & Add Parts">
            <div className="flex gap-2">
              <input
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchParts()}
                placeholder="Type ≥3 chars of part number…"
                className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
              />
              <button
                type="button"
                onClick={searchParts}
                disabled={partSearch.length < 3}
                className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
            {partResults.length > 0 && (
              <div className="border rounded-lg mt-1 bg-background shadow-md max-h-48 overflow-y-auto">
                {partResults.map((p: any, i: number) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => addPart(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-xs border-b last:border-0"
                  >
                    <span className="font-mono font-semibold">{p.partNumber}</span>
                    {p.brand && <span className="ml-2 text-muted-foreground">{p.brand}</span>}
                    {p.description && <span className="ml-2 text-muted-foreground truncate">{p.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </Field>

          {selectedParts.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Part #</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right w-20">Qty</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedParts.map((p) => (
                    <tr key={p.partNumber}>
                      <td className="px-3 py-1.5 font-mono font-semibold">{p.partNumber}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[180px]">{p.description}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min={1}
                          value={p.qty}
                          onChange={(e) => setPartQty(p.partNumber, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 border rounded px-2 py-0.5 bg-background text-right"
                        />
                      </td>
                      <td className="px-2">
                        <button type="button" onClick={() => removePart(p.partNumber)} className="text-red-500 hover:text-red-700">
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm"
              placeholder="Any special requirements or context…"
            />
          </Field>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !customerId || selectedParts.length === 0}
            className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create RFQ"}
          </button>
        </div>
      </div>
    </div>
  );
}
