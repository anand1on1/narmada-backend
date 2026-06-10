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
        else console.error("[portal] dashboard load failed:", r.status);
      } catch (e) {
        console.error("[portal] dashboard load error:", e);
      } finally { setLoading(false); }
    })();
  }, [token]);

  function copy(s: string) { navigator.clipboard?.writeText(s); }

  // Brand-new approved customers have no data yet — treat a null/empty response as an
  // empty portal, never a "Failed to load" dead-end, and guard every array map.
  const d = data || {};
  const recentLedger = Array.isArray(d.recentLedger) ? d.recentLedger : [];
  const openRfqs = Array.isArray(d.openRfqs) ? d.openRfqs : [];
  const pendingPos = Array.isArray(d.pendingPos) ? d.pendingPos : [];
  const recentPayments = Array.isArray(d.recentPayments) ? d.recentPayments : [];
  const banks = Array.isArray(d.banks) ? d.banks : [];
  const balanceInr = Number(d.balanceInr) || 0;
  const fmtDate = (ts: any) => { const n = Number(ts); return n ? new Date(n).toLocaleDateString("en-IN") : "—"; };
  const fmtInr = (n: any) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

  return (
    <PortalLayout title="Dashboard">
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <>
          {!data && (
            <div className="bg-card border rounded-xl p-6 mb-6 text-sm text-muted-foreground">
              Welcome to your portal. No data yet — your activity will appear here as orders and payments are processed.
            </div>
          )}
          <div className="grid sm:grid-cols-4 gap-3 mb-6">
            <Stat icon={Wallet} label="Outstanding Balance" value={fmtInr(balanceInr)} accent={balanceInr > 0 ? "text-red-600" : "text-emerald-700"} />
            <Stat icon={FileQuestion} label="Open RFQs" value={String(openRfqs.length)} />
            <Stat icon={ShoppingCart} label="Pending POs" value={String(pendingPos.length)} />
            <Stat icon={CreditCard} label="Recent Payments" value={String(recentPayments.length)} />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <section className="bg-card border rounded-xl p-5">
              <h2 className="font-display text-lg font-bold mb-3">Recent Ledger</h2>
              {recentLedger.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">No recent activity.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase font-bold text-muted-foreground">
                    <th className="py-1.5">Date</th><th className="py-1.5">Type</th><th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th><th className="py-1.5 text-right">Balance</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {recentLedger.slice(0, 10).map((e: any) => (
                      <tr key={e.id}>
                        <td className="py-2 text-xs">{fmtDate(e.entryDate)}</td>
                        <td className="py-2 text-xs">{e.voucherType ?? "—"}</td>
                        <td className="py-2 text-right text-xs">{e.debitInr ? fmtInr(e.debitInr) : ""}</td>
                        <td className="py-2 text-right text-xs">{e.creditInr ? fmtInr(e.creditInr) : ""}</td>
                        <td className="py-2 text-right text-xs font-semibold">{fmtInr(e.runningBalanceInr)}</td>
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
              {banks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No bank details on file. Contact support.</div>
              ) : banks.map((b: any) => (
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

          {pendingPos.length > 0 && (
            <section className="mt-6 bg-card border rounded-xl p-5">
              <h2 className="font-display text-lg font-bold mb-3">Your Pending POs</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase font-bold text-muted-foreground"><th className="py-1.5">PO #</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {pendingPos.map((p: any) => (
                    <tr key={p.id}><td className="py-2 font-mono">{p.customerPoNumber ?? "—"}</td><td className="py-2 text-xs">{fmtDate(p.createdAt)}</td><td className="py-2 text-right font-semibold">{fmtInr(p.totalInr)}</td></tr>
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
