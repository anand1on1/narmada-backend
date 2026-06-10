import { useEffect, useState } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Plus, Trash2 } from "lucide-react";

export default function CustomerRFQs() {
  const { token } = useCustomerAuth();
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);

  async function load() {
    if (!token) return;
    const r = await customerFetch(token, "/api/customer/rfqs");
    if (r.ok) setItems(await r.json());
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    const payload = { ...open, items: JSON.stringify(open.itemsList || []) };
    delete payload.itemsList;
    const r = await customerFetch(token, "/api/customer/rfqs", { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setOpen(null); load();
  }

  const badge = (s: string) => {
    const map: Record<string, string> = { open: "bg-blue-500/15 text-blue-700", quoted: "bg-amber-500/15 text-amber-700", closed: "bg-emerald-500/15 text-emerald-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  function parseItems(json: string): any[] { try { return JSON.parse(json); } catch { return []; } }

  return (
    <PortalLayout title="Request for Quote (RFQ)">
      <div className="flex justify-end mb-4">
        <button onClick={() => setOpen({ notes: "", itemsList: [{ partNumber: "", description: "", quantity: 1 }] })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-rfq">
          <Plus className="w-4 h-4" /> New RFQ
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No RFQs yet. Click New RFQ to request a quote.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Items</th>
              <th className="px-4 py-3 font-semibold">Notes</th><th className="px-4 py-3 font-semibold">Status</th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((r) => {
                const its = parseItems(r.items);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-xs">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 text-xs">
                      {its.slice(0, 3).map((i, idx) => <div key={idx}><span className="font-mono">{i.partNumber}</span> × {i.quantity}</div>)}
                      {its.length > 3 && <div className="text-muted-foreground">+{its.length - 3} more</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.notes || "—"}</td>
                    <td className="px-4 py-3">{badge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && <RFQForm open={open} setOpen={setOpen} onSave={save} />}
    </PortalLayout>
  );
}

function RFQForm({ open, setOpen, onSave }: any) {
  function setItem(i: number, k: string, v: any) {
    const next = [...open.itemsList]; next[i] = { ...next[i], [k]: v };
    setOpen({ ...open, itemsList: next });
  }
  function addRow() { setOpen({ ...open, itemsList: [...open.itemsList, { partNumber: "", description: "", quantity: 1 }] }); }
  function delRow(i: number) { setOpen({ ...open, itemsList: open.itemsList.filter((_: any, j: number) => j !== i) }); }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-lg font-bold">New RFQ</h2>
          <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-muted-foreground">List the parts you need quoted. Our team will respond within 24 hours.</div>
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted/50"><tr>
              <th className="px-3 py-2 text-left">Part Number</th><th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right w-20">Qty</th><th className="w-8"></th>
            </tr></thead>
            <tbody className="divide-y">
              {open.itemsList.map((it: any, i: number) => (
                <tr key={i}>
                  <td className="px-3 py-1"><input value={it.partNumber} onChange={(e) => setItem(i, "partNumber", e.target.value)} placeholder="e.g. 268601-0040" className="w-full border rounded px-2 py-1 bg-background text-xs font-mono" /></td>
                  <td className="px-3 py-1"><input value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} placeholder="(optional)" className="w-full border rounded px-2 py-1 bg-background text-xs" /></td>
                  <td className="px-3 py-1"><input type="number" value={it.quantity} onChange={(e) => setItem(i, "quantity", parseFloat(e.target.value) || 1)} className="w-full border rounded px-2 py-1 bg-background text-xs text-right" /></td>
                  <td className="px-2 py-1"><button onClick={() => delRow(i)} className="text-red-600"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addRow} className="px-3 py-1.5 border rounded-lg text-xs">+ Add row</button>
          <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes</div>
            <textarea value={open.notes} onChange={(e) => setOpen({ ...open, notes: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Delivery location, urgency, vehicle model, etc." />
          </label>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={onSave} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Submit RFQ</button>
        </div>
      </div>
    </div>
  );
}
