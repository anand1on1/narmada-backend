import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { DispatchAuth } from "@/lib/role-auth";
import { Truck, FileText, Boxes, Plus, Check, X, Lock, Unlock } from "lucide-react";

async function downloadFile(token: string | null, url: string, filename: string) {
  const r = await DispatchAuth.roleFetch(token, url);
  if (!r.ok) return;
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

interface StockItem {
  transfer_item_id: number; poNumber?: string | null; clientName?: string | null; itemName?: string | null;
  partNo?: string | null; quantity?: number | null; dispatchInvoiceId?: number | null; invoiceNo?: string | null;
  invoiceStatus?: string | null; tickedAt?: string | null;
}
interface DispatchInvoice {
  id: number; invoice_no: string; companyName?: string | null; clientName?: string | null;
  status: string; itemsCount?: number; created_at?: string | null; processed_at?: string | null; unlocked_at?: string | null;
}
interface Company { id: number; name: string; }
interface Client { id: number; name: string; }

// R27.8 #3 — same-day unlock window is 24h after processing.
function withinUnlockWindow(processedAt?: string | null) {
  if (!processedAt) return false;
  const ms = Date.parse(processedAt);
  return !!ms && (Date.now() - ms) <= 24 * 60 * 60 * 1000;
}

export default function DispatchDashboard() {
  const { token } = DispatchAuth.useAuth();
  const [tab, setTab] = useState<"stock" | "invoices">("stock");
  const [stock, setStock] = useState<StockItem[]>([]);
  const [invoices, setInvoices] = useState<DispatchInvoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "processed">("all");
  const [msg, setMsg] = useState<string | null>(null);

  // Create-invoice modal (3 ordered fields: company, client, manual invoice no).
  const [showCreate, setShowCreate] = useState(false);
  const [formCompany, setFormCompany] = useState("");
  const [formClient, setFormClient] = useState("");
  const [formInvoiceNo, setFormInvoiceNo] = useState("");

  // Drill-in modal.
  const [detail, setDetail] = useState<any | null>(null);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(null), 4500); }

  async function loadStock() {
    const r = await DispatchAuth.roleFetch(token, "/api/dispatch/stock-items");
    if (r.ok) setStock(await r.json());
  }
  async function loadInvoices() {
    const url = statusFilter === "all" ? "/api/dispatch/invoices" : `/api/dispatch/invoices?status=${statusFilter}`;
    const r = await DispatchAuth.roleFetch(token, url);
    if (r.ok) setInvoices(await r.json());
  }
  async function loadMeta() {
    const rc = await DispatchAuth.roleFetch(token, "/api/dispatch/companies");
    if (rc.ok) setCompanies(await rc.json());
    const rl = await DispatchAuth.roleFetch(token, "/api/dispatch/clients");
    if (rl.ok) setClients(await rl.json());
  }

  useEffect(() => { if (token) { loadStock(); loadInvoices(); loadMeta(); } }, [token]); // eslint-disable-line
  useEffect(() => { if (token) loadInvoices(); }, [statusFilter]); // eslint-disable-line

  // Only PENDING invoices are assignable (processed invoices leave the dropdown).
  const pendingInvoices = invoices.filter((i) => i.status === "pending");

  async function createInvoice() {
    if (!formInvoiceNo.trim()) { flash("Invoice number is required."); return; }
    const r = await DispatchAuth.roleFetch(token, "/api/dispatch/invoices", {
      method: "POST",
      body: JSON.stringify({ company_id: formCompany || undefined, client_id: formClient || undefined, invoice_no: formInvoiceNo.trim() }),
    });
    if (r.ok) {
      flash(`Invoice ${formInvoiceNo.trim()} created (pending).`);
      setShowCreate(false); setFormCompany(""); setFormClient(""); setFormInvoiceNo("");
      loadInvoices();
    } else { const j = await r.json().catch(() => ({})); flash(j.error || "Create failed"); }
  }

  async function assign(transferItemId: number, invoiceId: number) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/invoices/${invoiceId}/assign`, { method: "POST", body: JSON.stringify({ transfer_item_id: transferItemId }) });
    if (r.ok) { loadStock(); loadInvoices(); } else { const j = await r.json().catch(() => ({})); flash(j.error || "Assign failed"); }
  }
  async function removeAssign(transferItemId: number) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/stock-items/${transferItemId}/remove`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { loadStock(); loadInvoices(); } else flash("Remove failed");
  }
  async function tick(transferItemId: number, ticked: boolean) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/stock-items/${transferItemId}/tick`, { method: "POST", body: JSON.stringify({ ticked }) });
    if (r.ok) loadStock(); else flash("Update failed");
  }

  async function openDetail(id: number) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/invoices/${id}`);
    if (r.ok) setDetail(await r.json());
  }
  async function markProcessed(id: number) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/invoices/${id}/process`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { flash("Invoice marked processed."); setDetail(null); loadInvoices(); loadStock(); }
    else { const j = await r.json().catch(() => ({})); flash(j.error || "Process failed"); }
  }
  async function unlock(id: number) {
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/invoices/${id}/unlock`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { flash("Invoice unlocked — back to pending."); setDetail(null); loadInvoices(); loadStock(); }
    else { const j = await r.json().catch(() => ({})); flash(j.error || "Unlock failed"); }
  }

  return (
    <RolePortalShell title="Dispatch Portal" accent="text-indigo-600" icon={Truck} auth={DispatchAuth} loginPath="/dispatch/login">
      {msg && <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("stock")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1 ${tab === "stock" ? "bg-accent text-accent-foreground" : "border"}`}><Boxes className="w-4 h-4" /> Stock</button>
        <button onClick={() => setTab("invoices")} className={`px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1 ${tab === "invoices" ? "bg-accent text-accent-foreground" : "border"}`}><FileText className="w-4 h-4" /> Invoices</button>
        <div className="flex-1" />
        <button onClick={() => downloadFile(token, "/api/dispatch/sent.xlsx", "dispatch-sent.xlsx")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export XLSX</button>
        <button onClick={() => downloadFile(token, "/api/dispatch/sent.csv", "dispatch-sent.csv")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export CSV</button>
      </div>

      {tab === "stock" ? (
        <div className="bg-card border rounded-xl overflow-hidden">
          {stock.length === 0 ? <div className="p-10 text-center text-muted-foreground">No received stock items yet.</div> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-3">PO No</th><th className="p-3">Client</th><th className="p-3">Item</th><th className="p-3">Part No</th><th className="p-3 text-right">Qty</th><th className="p-3">Assign Invoice</th><th className="p-3 text-center">Tick</th></tr></thead>
              <tbody className="divide-y">
                {stock.map((s) => {
                  const assigned = !!s.dispatchInvoiceId;
                  const processed = s.invoiceStatus === "processed";
                  return (
                    <tr key={s.transfer_item_id} className="hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{s.poNumber || "—"}</td>
                      <td className="p-3">{s.clientName || "Internal Transfer"}</td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[14rem] truncate" title={s.itemName || ""}>{s.itemName || "—"}</td>
                      <td className="p-3 font-mono text-xs">{s.partNo || "—"}</td>
                      <td className="p-3 text-right">{s.quantity ?? "—"}</td>
                      <td className="p-3">
                        {assigned ? (
                          <span className="inline-flex items-center gap-2">
                            <span className={`text-xs font-semibold rounded px-2 py-1 ${processed ? "bg-emerald-600 text-white" : "bg-indigo-500/15 text-indigo-700"}`}>{s.invoiceNo}{processed ? " (processed)" : ""}</span>
                            {!processed && <button onClick={() => removeAssign(s.transfer_item_id)} className="text-xs text-rose-600 font-semibold inline-flex items-center gap-0.5 hover:underline"><X className="w-3 h-3" /> Remove</button>}
                          </span>
                        ) : (
                          <select defaultValue="" onChange={(e) => { if (e.target.value) assign(s.transfer_item_id, Number(e.target.value)); }} className="px-2 py-1 rounded border bg-background text-xs">
                            <option value="">— assign —</option>
                            {pendingInvoices.map((iv) => <option key={iv.id} value={iv.id}>{iv.invoice_no}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <input type="checkbox" disabled={!assigned} checked={!!s.tickedAt} onChange={(e) => tick(s.transfer_item_id, e.target.checked)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus className="w-4 h-4" /> Create Invoice</button>
            <div className="flex-1" />
            {(["all", "pending", "processed"] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${statusFilter === f ? "bg-accent text-accent-foreground" : "border"}`}>{f}</button>
            ))}
          </div>
          <div className="bg-card border rounded-xl overflow-hidden">
            {invoices.length === 0 ? <div className="p-10 text-center text-muted-foreground">No invoices yet. Click "Create Invoice".</div> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-3">Invoice No</th><th className="p-3">Company</th><th className="p-3">Client</th><th className="p-3">Date</th><th className="p-3 text-right">Items</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
                <tbody className="divide-y">
                  {invoices.map((iv) => (
                    <tr key={iv.id} className="hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{iv.invoice_no}</td>
                      <td className="p-3">{iv.companyName || "—"}</td>
                      <td className="p-3">{iv.clientName || "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">{iv.created_at ? new Date(iv.created_at).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="p-3 text-right">{iv.itemsCount ?? 0}</td>
                      <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${iv.status === "processed" ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700"}`}>{iv.status}</span></td>
                      <td className="p-3"><button onClick={() => openDetail(iv.id)} className="px-2 py-1 rounded bg-accent text-accent-foreground text-xs font-semibold">View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Create Invoice</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold">1. Company</label>
                <select value={formCompany} onChange={(e) => setFormCompany(e.target.value)} className="w-full px-3 py-2 rounded border bg-background text-sm">
                  <option value="">— select company —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold">2. Client</label>
                <select value={formClient} onChange={(e) => setFormClient(e.target.value)} className="w-full px-3 py-2 rounded border bg-background text-sm">
                  <option value="">— select client —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold">3. Invoice Number</label>
                <input value={formInvoiceNo} onChange={(e) => setFormInvoiceNo(e.target.value)} placeholder="Enter invoice number" className="w-full px-3 py-2 rounded border bg-background text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={createInvoice} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Create</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Invoice {detail.invoice_no}</h3>
              <span className={`text-xs font-bold rounded px-2 py-1 ${detail.status === "processed" ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700"}`}>{detail.status}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{detail.companyName || "—"} · {detail.clientName || "—"}</p>
            <table className="w-full text-sm mb-4">
              <thead className="bg-muted/50 text-left"><tr><th className="p-2">PO No</th><th className="p-2">Item</th><th className="p-2">Part No</th><th className="p-2 text-right">Qty</th><th className="p-2 text-center">Ticked</th></tr></thead>
              <tbody className="divide-y">
                {(detail.items || []).map((it: any) => (
                  <tr key={it.id}>
                    <td className="p-2 font-mono text-xs">{it.po_no || "—"}</td>
                    <td className="p-2 text-xs">{it.item_name || "—"}</td>
                    <td className="p-2 font-mono text-xs">{it.part_no || "—"}</td>
                    <td className="p-2 text-right">{it.quantity ?? "—"}</td>
                    <td className="p-2 text-center">{it.ticked_at ? <Check className="w-4 h-4 text-emerald-600 inline" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!detail.items || detail.items.length === 0) && <p className="text-sm text-muted-foreground mb-4">No items assigned yet. Assign received stock to this invoice from the Stock tab.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDetail(null)} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Close</button>
              {detail.status === "pending" && (
                <button onClick={() => markProcessed(detail.id)} disabled={!detail.items?.length} className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"><Lock className="w-4 h-4" /> Mark Processed</button>
              )}
              {detail.status === "processed" && withinUnlockWindow(detail.processed_at) && (
                <button onClick={() => unlock(detail.id)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1"><Unlock className="w-4 h-4" /> Unlock (same-day)</button>
              )}
            </div>
          </div>
        </div>
      )}
    </RolePortalShell>
  );
}
