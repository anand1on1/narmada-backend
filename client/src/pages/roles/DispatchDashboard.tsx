import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { DispatchAuth } from "@/lib/role-auth";
import { Truck } from "lucide-react";

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

interface TransferInvoice {
  id: number; invoice_no?: string | null; status: string; source_branch?: string | null; dest_branch?: string | null;
  clientName?: string | null; poNumber?: string | null; transport_vendor?: string | null; vehicle_no?: string | null;
  freight_charge?: number | null; eway_bill_no?: string | null; remarks?: string | null; pdf_url?: string | null;
}

export default function DispatchDashboard() {
  const { token } = DispatchAuth.useAuth();
  const [ready, setReady] = useState<any[]>([]);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [invoice, setInvoice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingInv, setPendingInv] = useState<TransferInvoice[]>([]);
  const [invForm, setInvForm] = useState<TransferInvoice | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  async function load() {
    const r = await DispatchAuth.roleFetch(token, "/api/dispatch/ready");
    if (r.ok) setReady(await r.json());
    const ri = await DispatchAuth.roleFetch(token, "/api/dispatch/transfer-invoices");
    if (ri.ok) setPendingInv(await ri.json());
  }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line

  async function finalizeInvoice() {
    if (!invForm) return;
    const fd = new FormData();
    fd.append("transport_vendor", invForm.transport_vendor || "");
    fd.append("vehicle_no", invForm.vehicle_no || "");
    fd.append("freight_charge", invForm.freight_charge != null ? String(invForm.freight_charge) : "");
    fd.append("eway_bill_no", invForm.eway_bill_no || "");
    fd.append("remarks", invForm.remarks || "");
    if (pdfFile) fd.append("pdf", pdfFile);
    const r = await DispatchAuth.roleFetch(token, `/api/dispatch/transfer-invoices/${invForm.id}/finalize`, { method: "POST", body: fd });
    if (r.ok) {
      const j = await r.json();
      setMsg(`Transfer invoice ${j.invoice_no} created. Admin notified.`);
      setInvForm(null); setPdfFile(null); load();
      setTimeout(() => setMsg(null), 5000);
    } else { const j = await r.json().catch(() => ({})); setMsg(j.error || "Finalize failed"); }
  }

  async function handover() {
    const stock_ids = Object.entries(sel).filter(([, v]) => v).map(([k]) => Number(k));
    if (!stock_ids.length) { setMsg("Select at least one stock item."); return; }
    const r = await DispatchAuth.roleFetch(token, "/api/dispatch/handover", { method: "POST", body: JSON.stringify({ stock_ids, invoice_number: invoice || undefined }) });
    if (r.ok) {
      const j = await r.json();
      setMsg(`Handed over ${j.dispatched} item(s).`);
      setSel({}); setInvoice(""); load();
      setTimeout(() => setMsg(null), 4000);
    } else { const j = await r.json().catch(() => ({})); setMsg(j.error || "Handover failed"); }
  }

  const selectedCount = Object.values(sel).filter(Boolean).length;

  return (
    <RolePortalShell title="Dispatch Portal" accent="text-indigo-600" icon={Truck} auth={DispatchAuth} loginPath="/dispatch/login">
      {msg && <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex items-center gap-2 mb-4">
        <input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Invoice / docket # (optional)" className="px-3 py-1.5 rounded-lg border bg-background text-sm w-64" />
        <button onClick={handover} disabled={!selectedCount} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1"><Truck className="w-4 h-4" /> Hand over {selectedCount > 0 ? `(${selectedCount})` : ""}</button>
        <div className="flex-1" />
        <button onClick={() => downloadFile(token, "/api/dispatch/sent.xlsx", "dispatch-sent.xlsx")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export XLSX</button>
        <button onClick={() => downloadFile(token, "/api/dispatch/sent.csv", "dispatch-sent.csv")} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-muted">Export CSV</button>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden">
        {ready.length === 0 ? <div className="p-10 text-center text-muted-foreground">No stock ready for dispatch.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3 w-10"></th><th className="p-3">Part #</th><th className="p-3">Product</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th></tr></thead>
            <tbody className="divide-y">
              {ready.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="p-3"><input type="checkbox" checked={!!sel[s.id]} onChange={(e) => setSel((m) => ({ ...m, [s.id]: e.target.checked }))} /></td>
                  <td className="p-3 font-mono">{s.part_number || "—"}</td>
                  <td className="p-3">{s.productName || "—"}</td>
                  <td className="p-3 text-right">{s.qty}</td>
                  <td className="p-3 text-right">{s.rate != null ? `₹${s.rate}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h3 className="text-base font-bold mt-8 mb-3">Pending Transfer Invoices</h3>
      <div className="bg-card border rounded-xl overflow-hidden">
        {pendingInv.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No transfer invoices yet. They appear when Store marks a transfer received.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Invoice No</th><th className="p-3">Client</th><th className="p-3">PO No</th><th className="p-3">Route</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {pendingInv.map((iv) => (
                <tr key={iv.id} className="hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{iv.invoice_no || <span className="text-muted-foreground italic">pending</span>}</td>
                  <td className="p-3">{iv.clientName || "Internal Transfer"}</td>
                  <td className="p-3">{iv.poNumber || "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{(iv.source_branch || "Delhi")} → {(iv.dest_branch || "Patna")}</td>
                  <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${iv.status === "invoiced" ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700"}`}>{iv.status}</span></td>
                  <td className="p-3">
                    {iv.status === "invoiced" && iv.pdf_url
                      ? <a href={iv.pdf_url} target="_blank" rel="noreferrer" className="text-indigo-600 text-xs font-semibold underline">View PDF</a>
                      : <button onClick={() => { setInvForm(iv); setPdfFile(null); }} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs font-semibold">{iv.status === "invoiced" ? "Edit" : "Fill invoice"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setInvForm(null)}>
          <div className="bg-card rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Transfer Invoice {invForm.invoice_no || "(new)"}</h3>
            <p className="text-sm text-muted-foreground mb-4">{(invForm.source_branch || "Delhi")} → {(invForm.dest_branch || "Patna")} · {invForm.clientName || "Internal Transfer"}</p>
            <div className="space-y-3">
              <div><label className="text-xs font-semibold">Transport Vendor</label><input value={invForm.transport_vendor || ""} onChange={(e) => setInvForm({ ...invForm, transport_vendor: e.target.value })} className="w-full px-3 py-2 rounded border bg-background text-sm" /></div>
              <div><label className="text-xs font-semibold">Vehicle No</label><input value={invForm.vehicle_no || ""} onChange={(e) => setInvForm({ ...invForm, vehicle_no: e.target.value })} className="w-full px-3 py-2 rounded border bg-background text-sm" /></div>
              <div><label className="text-xs font-semibold">Freight Charge (₹)</label><input type="number" value={invForm.freight_charge ?? ""} onChange={(e) => setInvForm({ ...invForm, freight_charge: e.target.value === "" ? null : Number(e.target.value) })} className="w-full px-3 py-2 rounded border bg-background text-sm" /></div>
              <div><label className="text-xs font-semibold">E-way Bill No</label><input value={invForm.eway_bill_no || ""} onChange={(e) => setInvForm({ ...invForm, eway_bill_no: e.target.value })} className="w-full px-3 py-2 rounded border bg-background text-sm" /></div>
              <div><label className="text-xs font-semibold">Remarks</label><textarea value={invForm.remarks || ""} onChange={(e) => setInvForm({ ...invForm, remarks: e.target.value })} className="w-full px-3 py-2 rounded border bg-background text-sm" rows={2} /></div>
              <div><label className="text-xs font-semibold">Invoice PDF</label><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} className="w-full text-sm" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setInvForm(null)} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={finalizeInvoice} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">Create / Update Invoice</button>
            </div>
          </div>
        </div>
      )}
    </RolePortalShell>
  );
}
