import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Trash2 } from "lucide-react";

interface Customer { id: number; name: string; }
interface Payment {
  id: number; customerId: number; amountInr: number; paymentMode: string;
  referenceNo: string | null; paymentDate: number; notes: string | null;
  recordedBy: string | null; createdAt: number;
}

const MODES = ["neft", "rtgs", "upi", "cheque", "cash", "imps", "other"];

export default function AdminPayments() {
  const { token } = useAdminAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterCustomer, setFilterCustomer] = useState<number | "">("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [open, setOpen] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const r = await adminFetch(token, `/api/admin/customers`);
      { const _d = await r.json(); setCustomers(Array.isArray(_d) ? _d : []); }
    })();
  }, [token]);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filterCustomer) params.set("customer_id", String(filterCustomer));
    const r = await adminFetch(token, `/api/admin/payments?${params}`);
    { const _d = await r.json(); setPayments(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token, filterCustomer]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    const body = { ...open, paymentDate: new Date(open.paymentDate).getTime() };
    const r = await adminFetch(token, `/api/admin/payments`, { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setOpen(null); load();
  }

  async function del(id: number) {
    if (!token || !confirm("Delete this payment? Linked ledger credit will also be removed and balance recomputed.")) return;
    const r = await adminFetch(token, `/api/admin/payments/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name || `#${id}`;
  const total = payments.reduce((s, p) => s + (p.amountInr || 0), 0);

  return (
    <AdminLayout title="Payments">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value ? parseInt(e.target.value, 10) : "")}
          className="border rounded-lg px-3 py-2 bg-background text-sm min-w-60" data-testid="select-filter-customer">
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="text-sm text-muted-foreground">Total: <strong>₹{total.toLocaleString("en-IN")}</strong></div>
        <div className="flex-1" />
        <button onClick={() => setOpen({ customerId: customers[0]?.id || 0, amountInr: 0, paymentMode: "neft", referenceNo: "", paymentDate: new Date().toISOString().slice(0, 10), notes: "" })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-payment">
          <Plus className="w-4 h-4" /> Record Payment
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {payments.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No payments yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Mode</th>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
                <th className="px-4 py-3 font-semibold">Recorded by</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id} data-testid={`row-pay-${p.id}`}>
                  <td className="px-4 py-3 text-xs">{new Date(p.paymentDate).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3">{customerName(p.customerId)}</td>
                  <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">{p.paymentMode}</span></td>
                  <td className="px-4 py-3 text-xs font-mono">{p.referenceNo || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">₹{p.amountInr.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{p.notes || "—"}</td>
                  <td className="px-4 py-3 text-xs">{p.recordedBy || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => del(p.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Record Payment</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <Field label="Customer *"><select value={open.customerId} onChange={(e) => setOpen({ ...open, customerId: parseInt(e.target.value, 10) })} className="w-full border rounded-lg px-3 py-2 bg-background">
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹) *"><input type="number" value={open.amountInr} onChange={(e) => setOpen({ ...open, amountInr: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Payment Date *"><input type="date" value={open.paymentDate} onChange={(e) => setOpen({ ...open, paymentDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              </div>
              <Field label="Mode *"><select value={open.paymentMode} onChange={(e) => setOpen({ ...open, paymentMode: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background">
                {MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select></Field>
              <Field label="Reference No (UTR / cheque no)"><input value={open.referenceNo} onChange={(e) => setOpen({ ...open, referenceNo: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono" /></Field>
              <Field label="Notes"><textarea value={open.notes} onChange={(e) => setOpen({ ...open, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <div className="text-xs text-muted-foreground">Saving will automatically create a credit ledger entry for this customer and recompute their balance.</div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Save Payment</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
