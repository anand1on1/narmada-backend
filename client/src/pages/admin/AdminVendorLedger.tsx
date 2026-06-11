/**
 * R9 — Vendor Ledger (admin).
 * One row per seller: approved value, total paid, balance.
 * Expand a row to see approved line items, linked POs + rates, and payments.
 * Record a manual payment {date, amount, method, reference, notes}.
 */
import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, getAdminToken } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Plus, Loader2, Check } from "lucide-react";

interface LedgerRow {
  vendor_id: number;
  vendor_name: string | null;
  total_approved_value: number;
  total_paid: number;
  balance: number;
  item_count: number;
  last_activity_at: number | null;
}
interface LedgerItem {
  po_number: string; part: string | null; brand: string | null;
  qty: number | null; rate: number | null; line_total: number | null; approved_at: number | null;
}
interface PaymentRow {
  id: number; paid_on: number; amount: number; method: string;
  reference: string | null; notes: string | null;
}

const METHODS = ["bank", "upi", "cheque", "cash", "neft", "rtgs", "imps", "other"];
const inr = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function PaymentForm({ vendorId, token, onSaved }: { vendorId: number; token: string | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!amount) { alert("Amount required"); return; }
    setSaving(true);
    try {
      const r = await adminFetch(token, `/api/admin/vendor-ledger/${vendorId}/payment`, {
        method: "POST",
        body: JSON.stringify({
          paid_on: new Date(paidOn + "T00:00:00").getTime(),
          amount: parseFloat(amount),
          method, reference: reference || undefined, notes: notes || undefined,
        }),
      });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Failed"); return; }
      setOpen(false); setAmount(""); setReference(""); setNotes("");
      onSaved();
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 border rounded-lg inline-flex items-center gap-1 hover:bg-muted">
        <Plus className="w-3 h-3" /> Record payment
      </button>
    );
  }

  return (
    <div className="mt-2 border rounded-xl bg-muted/20 p-3 flex gap-2 flex-wrap items-end">
      <div><label className="text-[11px] block mb-0.5">Date</label>
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-xs bg-background" /></div>
      <div className="w-28"><label className="text-[11px] block mb-0.5">Amount ₹</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" /></div>
      <div><label className="text-[11px] block mb-0.5">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-xs bg-background">
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select></div>
      <div className="w-32"><label className="text-[11px] block mb-0.5">Reference</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" /></div>
      <div className="flex-1 min-w-[120px]"><label className="text-[11px] block mb-0.5">Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" /></div>
      <button onClick={save} disabled={saving}
        className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
      </button>
      <button onClick={() => setOpen(false)} className="px-2 py-1.5 border rounded-lg text-xs">Cancel</button>
    </div>
  );
}

function LedgerDetails({ vendorId, token, onPaid }: { vendorId: number; token: string | null; onPaid: () => void }) {
  const { data, refetch } = useQuery<{ items: LedgerItem[]; payments: PaymentRow[] }>({
    queryKey: ["vendor-ledger-details", vendorId],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendor-ledger/${vendorId}/details`);
      return r.ok ? r.json() : { items: [], payments: [] };
    },
    enabled: !!token,
  });

  return (
    <div className="bg-muted/20 px-4 py-3 space-y-3">
      <div>
        <div className="text-xs font-semibold mb-1">Approved line items</div>
        {!data || data.items.length === 0 ? (
          <div className="text-xs text-muted-foreground">No approved items.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left">
              <th className="py-1">PO</th><th>Part</th><th>Brand</th>
              <th className="text-right">Qty</th><th className="text-right">Rate</th>
              <th className="text-right">Line Total</th><th>Approved</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-1 font-mono">{it.po_number}</td>
                  <td>{it.part || "—"}</td><td>{it.brand || "—"}</td>
                  <td className="text-right">{it.qty ?? "—"}</td>
                  <td className="text-right">{inr(it.rate)}</td>
                  <td className="text-right font-semibold">{inr(it.line_total)}</td>
                  <td className="text-muted-foreground">{it.approved_at ? new Date(it.approved_at).toLocaleDateString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold mb-1">Payments</div>
        {!data || data.payments.length === 0 ? (
          <div className="text-xs text-muted-foreground">No payments recorded.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left">
              <th className="py-1">Date</th><th className="text-right">Amount</th>
              <th>Method</th><th>Reference</th><th>Notes</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-1">{new Date(p.paid_on).toLocaleDateString("en-IN")}</td>
                  <td className="text-right font-semibold">{inr(p.amount)}</td>
                  <td className="uppercase">{p.method}</td>
                  <td>{p.reference || "—"}</td><td>{p.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <PaymentForm vendorId={vendorId} token={token} onSaved={() => { refetch(); onPaid(); }} />
      </div>
    </div>
  );
}

export default function AdminVendorLedger() {
  const { token } = useAdminAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: rows = [] } = useQuery<LedgerRow[]>({
    queryKey: ["vendor-ledger"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendor-ledger`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  function exportXlsx() {
    const t = getAdminToken() || "";
    fetch(apiUrl("/api/admin/vendor-ledger/export.xlsx"), { headers: t ? { "x-admin-token": t } : {} })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = "vendor-ledger.xlsx"; a.click();
        URL.revokeObjectURL(u);
      });
  }

  const totals = rows.reduce(
    (s, r) => ({ approved: s.approved + r.total_approved_value, paid: s.paid + r.total_paid, bal: s.bal + r.balance }),
    { approved: 0, paid: 0, bal: 0 }
  );

  return (
    <AdminLayout title="Vendor Ledger">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4 text-sm">
          <span>Approved: <strong>{inr(totals.approved)}</strong></span>
          <span>Paid: <strong className="text-emerald-600">{inr(totals.paid)}</strong></span>
          <span>Balance: <strong className="text-amber-600">{inr(totals.bal)}</strong></span>
        </div>
        <button onClick={exportXlsx}
          className="px-3 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
          <Download className="w-4 h-4" /> Export .xlsx
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3 font-semibold">Seller</th>
              <th className="px-4 py-3 font-semibold text-right">Approved Items</th>
              <th className="px-4 py-3 font-semibold text-right">Approved Value</th>
              <th className="px-4 py-3 font-semibold text-right">Total Paid</th>
              <th className="px-4 py-3 font-semibold text-right">Balance</th>
              <th className="px-4 py-3 font-semibold">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">No seller activity yet.</td></tr>
            ) : rows.map((r) => (
              <>
                <tr key={r.vendor_id} className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => setExpanded(expanded === r.vendor_id ? null : r.vendor_id)}>
                  <td className="px-4 py-3">{expanded === r.vendor_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                  <td className="px-4 py-3 font-semibold">{r.vendor_name || `Seller #${r.vendor_id}`}</td>
                  <td className="px-4 py-3 text-right">{r.item_count}</td>
                  <td className="px-4 py-3 text-right">{inr(r.total_approved_value)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{inr(r.total_paid)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">{inr(r.balance)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.last_activity_at ? new Date(r.last_activity_at).toLocaleDateString("en-IN") : "—"}</td>
                </tr>
                {expanded === r.vendor_id && (
                  <tr key={`${r.vendor_id}-d`}>
                    <td colSpan={7} className="p-0">
                      <LedgerDetails vendorId={r.vendor_id} token={token} onPaid={() => qc.invalidateQueries({ queryKey: ["vendor-ledger"] })} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
