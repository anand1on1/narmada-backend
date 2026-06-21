import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { StoreAuth } from "@/lib/role-auth";
import { Warehouse, PackageCheck, Boxes } from "lucide-react";

interface Transfer { id: number; po_id: number | null; poNumber?: string | null; clientName?: string | null; itemSummary?: string | null; partNumbers?: string | null; transferInvoiceNo?: string | null; status: string; dispatched_at?: string | null; received_at?: string | null; notes?: string | null; source?: string; from_branch?: string | null; to_branch?: string | null; carrier?: string | null; }

async function downloadFile(token: string | null, url: string, filename: string) {
  const r = await StoreAuth.roleFetch(token, url);
  if (!r.ok) return;
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
interface ExpectedItem { partNumber: string | null; name: string | null; expectedQty: number; rate: number | null; }

export default function StoreDashboard() {
  const { token } = StoreAuth.useAuth();
  const [tab, setTab] = useState<"transfers" | "stock">("transfers");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function loadTransfers() {
    const r = await StoreAuth.roleFetch(token, "/api/store/transfers");
    if (r.ok) setTransfers(await r.json());
  }
  async function loadStock() {
    const r = await StoreAuth.roleFetch(token, "/api/store/stock");
    if (r.ok) setStock(await r.json());
  }
  // R27.4 BUG-9 — poll every 20s so Delhi→Patna transfers appear without a manual reload.
  useEffect(() => {
    if (!token) return;
    loadTransfers(); loadStock();
    const id = setInterval(() => { loadTransfers(); loadStock(); }, 20000);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line

  async function openDetail(id: number) {
    const r = await StoreAuth.roleFetch(token, `/api/store/transfers/${id}`);
    if (r.ok) {
      const d = await r.json();
      setDetail(d);
      const init: Record<string, number> = {};
      (d.expected || []).forEach((it: ExpectedItem) => { init[it.partNumber || ""] = it.expectedQty; });
      setRecv(init);
    }
  }

  async function submitReceive() {
    if (!detail) return;
    const items = (detail.expected || []).map((it: ExpectedItem) => ({
      part_number: it.partNumber || "",
      expected_qty: it.expectedQty,
      received_qty: Number(recv[it.partNumber || ""] ?? it.expectedQty) || 0,
      rate: it.rate ?? undefined,
    }));
    const r = await StoreAuth.roleFetch(token, `/api/store/transfers/${detail.id}/receive`, { method: "POST", body: JSON.stringify({ items }) });
    if (r.ok) {
      setMsg("Received. Any shortfall was flagged as a deviation + sub-PO.");
      setDetail(null); loadTransfers(); loadStock();
      setTimeout(() => setMsg(null), 4000);
    } else { const j = await r.json().catch(() => ({})); setMsg(j.error || "Receive failed"); }
  }

  return (
    <RolePortalShell title="Store Portal" accent="text-amber-600" icon={Warehouse} auth={StoreAuth} loginPath="/store/login">
      {msg && <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("transfers")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === "transfers" ? "bg-accent text-accent-foreground" : "border"}`}>Incoming Transfers</button>
        <button onClick={() => setTab("stock")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === "stock" ? "bg-accent text-accent-foreground" : "border"}`}>Patna Stock</button>
      </div>

      {tab === "transfers" ? (
        <div>
          <div className="flex justify-end gap-2 mb-3">
            <button onClick={() => downloadFile(token, "/api/store/received.xlsx", "store-received.xlsx")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export XLSX</button>
            <button onClick={() => downloadFile(token, "/api/store/received.csv", "store-received.csv")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export CSV</button>
          </div>
          <div className="bg-card border rounded-xl overflow-hidden">
          {transfers.length === 0 ? <div className="p-10 text-center text-muted-foreground">No transfers from Delhi yet.</div> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-3">Ref #</th><th className="p-3">Client</th><th className="p-3">PO No</th><th className="p-3">Item</th><th className="p-3">Part No</th><th className="p-3">Status</th><th className="p-3">Invoice No</th><th className="p-3">Dispatched</th><th className="p-3"></th></tr></thead>
              <tbody className="divide-y">
                {transfers.map((t) => {
                  const isConsignment = t.source === "consignment" || t.id < 0;
                  return (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono">{isConsignment ? (t.poNumber || `CN-${-t.id}`) : `#${t.id}`}</td>
                    <td className="p-3">{t.clientName || "Internal Transfer"}</td>
                    <td className="p-3">{t.poNumber || (isConsignment ? "—" : (t.po_id || "—"))}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[16rem] truncate" title={t.itemSummary || ""}>{t.itemSummary || "—"}</td>
                    <td className="p-3 font-mono text-xs">{t.partNumbers || "—"}</td>
                    <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${t.status === "received" ? "bg-emerald-600 text-white" : t.status === "partial_received" ? "bg-amber-500/15 text-amber-700" : "bg-blue-500/15 text-blue-700"}`}>{t.status}</span></td>
                    <td className="p-3 font-mono text-xs">{t.transferInvoiceNo || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{t.dispatched_at ? new Date(t.dispatched_at).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="p-3">{isConsignment
                      ? <span className="text-xs text-muted-foreground italic">In transit (consignment)</span>
                      : t.status === "received"
                        ? <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1"><PackageCheck className="w-3.5 h-3.5" /> Received</span>
                        : <button onClick={() => openDetail(t.id)} className="px-2 py-1 rounded bg-accent text-accent-foreground text-xs font-semibold inline-flex items-center gap-1"><PackageCheck className="w-3.5 h-3.5" /> Mark Received</button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          {stock.length === 0 ? <div className="p-10 text-center text-muted-foreground"><Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />No stock in Patna yet.</div> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-3">Part #</th><th className="p-3">Product</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3">Received</th></tr></thead>
              <tbody className="divide-y">
                {stock.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono">{s.part_number || "—"}</td>
                    <td className="p-3">{s.productName || "—"}</td>
                    <td className="p-3 text-right">{s.qty}</td>
                    <td className="p-3 text-right">{s.rate != null ? `₹${s.rate}` : "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{s.received_at ? new Date(s.received_at).toLocaleDateString("en-IN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Receive Transfer #{detail.id}</h3>
            <p className="text-sm text-muted-foreground mb-4">PO {detail.poNumber || detail.po_id}. Enter received quantities — shortfalls auto-create a deviation and sub-PO.</p>
            <table className="w-full text-sm mb-4">
              <thead className="bg-muted/50 text-left"><tr><th className="p-2">Part #</th><th className="p-2">Product</th><th className="p-2 text-right">Expected</th><th className="p-2 text-right">Received</th></tr></thead>
              <tbody className="divide-y">
                {(detail.expected || []).map((it: ExpectedItem, i: number) => (
                  <tr key={i}>
                    <td className="p-2 font-mono">{it.partNumber || "—"}</td>
                    <td className="p-2">{it.name || "—"}</td>
                    <td className="p-2 text-right">{it.expectedQty}</td>
                    <td className="p-2 text-right"><input type="number" value={recv[it.partNumber || ""] ?? it.expectedQty} onChange={(e) => setRecv((r) => ({ ...r, [it.partNumber || ""]: Number(e.target.value) }))} className="w-20 px-2 py-1 rounded border bg-background text-right" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!detail.expected || detail.expected.length === 0) && <p className="text-sm text-muted-foreground mb-4">No expected line items on the parent PO.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={submitReceive} disabled={!detail.expected?.length} className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Confirm Received</button>
            </div>
          </div>
        </div>
      )}
    </RolePortalShell>
  );
}
