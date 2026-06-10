import { useEffect, useState } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Landmark, Copy } from "lucide-react";

export default function CustomerPayments() {
  const { token } = useCustomerAuth();
  const [payments, setPayments] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const [pR, bR] = await Promise.all([
          customerFetch(token, "/api/customer/payments"),
          customerFetch(token, "/api/customer/banks"),
        ]);
        if (pR.ok) { const _d = await pR.json(); setPayments(Array.isArray(_d) ? _d : []); }
        if (bR.ok) { const _d = await bR.json(); setBanks(Array.isArray(_d) ? _d : []); }
      } finally { setLoading(false); }
    })();
  }, [token]);

  function copy(s: string) { navigator.clipboard?.writeText(s); }
  const total = payments.reduce((s, p) => s + (p.amountInr || 0), 0);

  return (
    <PortalLayout title="Payments">
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <div className="bg-card border rounded-xl overflow-x-auto">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div className="font-display text-lg font-bold">Payment History</div>
              <div className="text-sm text-muted-foreground">Total: <strong>₹{total.toLocaleString("en-IN")}</strong></div>
            </div>
            {loading ? <div className="p-12 text-center text-muted-foreground">Loading…</div>
              : payments.length === 0 ? <div className="p-12 text-center text-muted-foreground">No payments yet.</div>
              : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50 text-left">
                    <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Mode</th>
                    <th className="px-4 py-3 font-semibold">Reference</th><th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold">Notes</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 text-xs">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-IN") : "—"}</td>
                        <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">{p.paymentMode}</span></td>
                        <td className="px-4 py-3 text-xs font-mono">{p.referenceNo || "—"}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">₹{(Number(p.amountInr) || 0).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{p.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>

        <div>
          <div className="bg-card border rounded-xl p-5">
            <h2 className="font-display text-lg font-bold mb-3 inline-flex items-center gap-2"><Landmark className="w-5 h-5" />Pay via NEFT/RTGS</h2>
            <div className="text-xs text-muted-foreground mb-3">After payment, share the UTR via WhatsApp/email so we can post it to your ledger.</div>
            {banks.length === 0 ? <div className="text-sm text-muted-foreground">Contact support for bank details.</div>
              : banks.map((b) => (
                <div key={b.id} className="border rounded-lg p-3 mb-3">
                  <div className="font-semibold">{b.bankName} <span className="text-xs text-muted-foreground">— {b.label}</span></div>
                  <dl className="text-xs mt-2 space-y-1">
                    <Row k="Name" v={b.accountName} copy={() => copy(b.accountName)} />
                    <Row k="A/c" v={b.accountNo} copy={() => copy(b.accountNo)} />
                    <Row k="IFSC" v={b.ifsc} copy={() => copy(b.ifsc)} />
                    {b.branch && <Row k="Branch" v={b.branch} />}
                  </dl>
                </div>
              ))}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

function Row({ k, v, copy }: { k: string; v: string; copy?: () => void }) {
  return <div className="grid grid-cols-[60px,1fr,auto] gap-2 items-center">
    <dt className="text-[10px] uppercase font-bold text-muted-foreground">{k}</dt>
    <dd className="font-mono break-all">{v}</dd>
    {copy && <button onClick={copy} className="p-1 hover:bg-muted rounded" title="Copy"><Copy className="w-3 h-3" /></button>}
  </div>;
}
