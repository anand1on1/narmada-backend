import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { DispatchAuth } from "@/lib/role-auth";
import { Truck } from "lucide-react";

export default function DispatchDashboard() {
  const { token } = DispatchAuth.useAuth();
  const [ready, setReady] = useState<any[]>([]);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [invoice, setInvoice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await DispatchAuth.roleFetch(token, "/api/dispatch/ready");
    if (r.ok) setReady(await r.json());
  }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line

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
    </RolePortalShell>
  );
}
