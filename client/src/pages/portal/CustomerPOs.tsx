import { useEffect, useState, useRef } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Upload, Eye } from "lucide-react";
import { apiUrl } from "@/lib/queryClient";

export default function CustomerPOs() {
  const { token } = useCustomerAuth();
  const [items, setItems] = useState<any[]>([]);
  const [view, setView] = useState<any | null>(null);
  const [uploadFor, setUploadFor] = useState<any | null>(null);

  async function load() {
    if (!token) return;
    const r = await customerFetch(token, "/api/customer/purchase-orders");
    if (r.ok) setItems(await r.json());
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  const badge = (s: string) => {
    const map: Record<string, string> = { pending: "bg-amber-500/15 text-amber-700", approved: "bg-emerald-500/15 text-emerald-700", rejected: "bg-red-500/15 text-red-700" };
    return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${map[s] || "bg-slate-500/15 text-slate-700"}`}>{s}</span>;
  };

  return (
    <PortalLayout title="Purchase Orders">
      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No purchase orders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">PO #</th><th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono font-bold">{p.customerPoNumber}</td>
                  <td className="px-4 py-3 text-xs">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{p.totalInr.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3">{badge(p.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setView(p)} className="p-2 hover:bg-muted rounded" title="View"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => setUploadFor(p)} className="ml-1 px-2 py-1 text-xs border rounded inline-flex items-center gap-1"><Upload className="w-3 h-3" />Upload PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {view && <POView po={view} onClose={() => setView(null)} />}
      {uploadFor && <UploadModal po={uploadFor} onClose={() => { setUploadFor(null); load(); }} />}
    </PortalLayout>
  );
}

function POView({ po, onClose }: any) {
  let items: any[] = [];
  try { items = JSON.parse(po.items); } catch {}
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-display text-xl font-bold">PO {po.customerPoNumber}</div>
            <div className="text-xs text-muted-foreground">{new Date(po.createdAt).toLocaleDateString("en-IN")}</div>
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
        </div>
      </div>
    </div>
  );
}

function UploadModal({ po, onClose }: any) {
  const { token } = useCustomerAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!token || !inputRef.current?.files?.[0]) return;
    const file = inputRef.current.files[0];
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityType", "po");
      fd.append("entityId", String(po.id));
      fd.append("fileKind", "po_pdf");
      const r = await fetch(apiUrl("/api/customer/uploads"), {
        method: "POST", headers: { "x-customer-token": token }, body: fd,
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Failed"); return; }
      alert("PO PDF uploaded.");
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="border-b px-6 py-4 font-display text-lg font-bold">Upload PO PDF — {po.customerPoNumber}</div>
        <div className="p-6 space-y-3">
          <input ref={inputRef} type="file" accept="application/pdf,image/*" className="text-sm" />
          <div className="text-xs text-muted-foreground">PDF, JPG, or PNG accepted. Max 10 MB.</div>
        </div>
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={upload} disabled={busy} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">{busy ? "Uploading…" : "Upload"}</button>
        </div>
      </div>
    </div>
  );
}
