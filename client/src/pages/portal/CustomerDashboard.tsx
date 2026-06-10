import { useEffect, useState } from "react";
import { Link } from "wouter";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Wallet, FileQuestion, ShoppingCart, CreditCard, Landmark, Copy } from "lucide-react";

export default function CustomerDashboard() {
  const { token } = useCustomerAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await customerFetch(token, "/api/customer/dashboard");
        if (r.ok) setData(await r.json());
      } finally { setLoading(false); }
    })();
  }, [token]);

  function copy(s: string) { navigator.clipboard?.writeText(s); }

  return (
    <PortalLayout title="Dashboard">
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : !data ? <div>Failed to load.</div> : (
        <>
          <div className="grid sm:grid-cols-4 gap-3 mb-6">
            <Stat icon={Wallet} label="Outstanding Balance" value={`₹${(data.balanceInr || 0).toLocaleString("en-IN")}`} accent={data.balanceInr > 0 ? "text-red-600" : "text-emerald-700"} />
            <Stat icon={FileQuestion} label="Open RFQs" value={String(data.openRfqs?.length || 0)} />
            <Stat icon={ShoppingCart} label="Pending POs" value={String(data.pendingPos?.length || 0)} />
            <Stat icon={CreditCard} label="Recent Payments" value={String(data.recentPayments?.length || 0)} />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <section className="bg-card border rounded-xl p-5">
              <h2 className="font-display text-lg font-bold mb-3">Recent Ledger</h2>
              {(!data.recentLedger || data.recentLedger.length === 0) ? (
                <div className="text-sm text-muted-foreground py-4">No recent activity.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase font-bold text-muted-foreground">
                    <th className="py-1.5">Date</th><th className="py-1.5">Type</th><th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th><th className="py-1.5 text-right">Balance</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {data.recentLedger.slice(0, 10).map((e: any) => (
                      <tr key={e.id}>
                        <td className="py-2 text-xs">{new Date(e.entryDate).toLocaleDateString("en-IN")}</td>
                        <td className="py-2 text-xs">{e.voucherType}</td>
                        <td className="py-2 text-right text-xs">{e.debitInr ? `₹${e.debitInr.toLocaleString("en-IN")}` : ""}</td>
                        <td className="py-2 text-right text-xs">{e.creditInr ? `₹${e.creditInr.toLocaleString("en-IN")}` : ""}</td>
                        <td className="py-2 text-right text-xs font-semibold">₹{(e.runningBalanceInr || 0).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link href="/portal/ledger"><a className="block mt-3 text-sm text-accent underline">View full ledger →</a></Link>
            </section>

            <section className="bg-card border rounded-xl p-5">
              <h2 className="font-display text-lg font-bold mb-3 inline-flex items-center gap-2"><Landmark className="w-5 h-5" />Payment Details</h2>
              <div className="text-xs text-muted-foreground mb-3">Pay via NEFT/RTGS using the account below. Share UTR with our team after payment.</div>
              {(!data.banks || data.banks.length === 0) ? (
                <div className="text-sm text-muted-foreground">No bank details on file. Contact support.</div>
              ) : data.banks.map((b: any) => (
                <div key={b.id} className="border rounded-lg p-3 mb-2">
                  <div className="font-semibold">{b.bankName} <span className="text-xs text-muted-foreground">— {b.label}</span></div>
                  <dl className="text-xs mt-2 space-y-1">
                    <Row k="Account Name" v={b.accountName} copy={() => copy(b.accountName)} />
                    <Row k="Account No" v={b.accountNo} copy={() => copy(b.accountNo)} />
                    <Row k="IFSC" v={b.ifsc} copy={() => copy(b.ifsc)} />
                    {b.branch && <Row k="Branch" v={b.branch} />}
                  </dl>
                </div>
              ))}
            </section>
          </div>

          {data.pendingPos?.length > 0 && (
            <section className="mt-6 bg-card border rounded-xl p-5">
              <h2 className="font-display text-lg font-bold mb-3">Your Pending POs</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase font-bold text-muted-foreground"><th className="py-1.5">PO #</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {data.pendingPos.map((p: any) => (
                    <tr key={p.id}><td className="py-2 font-mono">{p.customerPoNumber}</td><td className="py-2 text-xs">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td><td className="py-2 text-right font-semibold">₹{p.totalInr.toLocaleString("en-IN")}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </PortalLayout>
  );
}

function Stat({ icon: Icon, label, value, accent }: any) {
  return <div className="bg-card border rounded-xl p-4">
    <Icon className="w-5 h-5 text-accent mb-1" />
    <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">{label}</div>
    <div className={`text-xl font-bold mt-1 ${accent || ""}`}>{value}</div>
  </div>;
}

function Row({ k, v, copy }: { k: string; v: string; copy?: () => void }) {
  return <div className="grid grid-cols-[110px,1fr,auto] gap-2 items-center">
    <dt className="text-[10px] uppercase font-bold text-muted-foreground">{k}</dt>
    <dd className="font-mono">{v}</dd>
    {copy && <button onClick={copy} className="p-1 hover:bg-muted rounded" title="Copy"><Copy className="w-3 h-3" /></button>}
  </div>;
}
