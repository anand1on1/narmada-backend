import { useEffect, useState } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Download } from "lucide-react";

export default function CustomerLedger() {
  const { token } = useCustomerAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await customerFetch(token, "/api/customer/ledger");
        if (r.ok) {
          const j = await r.json();
          setEntries(j.entries || []);
          setBalance(j.balanceInr || 0);
        }
      } finally { setLoading(false); }
    })();
  }, [token]);

  function exportCsv() {
    const rows = [["Date", "Type", "Voucher", "Description", "Debit", "Credit", "Balance"]];
    entries.forEach((e) => rows.push([
      new Date(e.entryDate).toLocaleDateString("en-IN"), e.voucherType, e.voucherNo || "",
      e.description || "", String(e.debitInr || 0), String(e.creditInr || 0), String(e.runningBalanceInr || 0),
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ledger-${Date.now()}.csv`; a.click();
  }

  const totalDebit = entries.reduce((s, e) => s + (e.debitInr || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.creditInr || 0), 0);

  return (
    <PortalLayout title="Ledger">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Total Debit" value={`₹${totalDebit.toLocaleString("en-IN")}`} />
        <Stat label="Total Credit" value={`₹${totalCredit.toLocaleString("en-IN")}`} />
        <Stat label="Outstanding" value={`₹${balance.toLocaleString("en-IN")}`} accent={balance > 0 ? "text-red-600" : "text-emerald-700"} />
      </div>

      <div className="flex justify-end mb-3">
        <button onClick={exportCsv} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1.5"><Download className="w-4 h-4" />Export CSV</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {loading ? <div className="p-12 text-center text-muted-foreground">Loading…</div>
          : entries.length === 0 ? <div className="p-12 text-center text-muted-foreground">No ledger entries yet.</div>
          : (
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Voucher</th><th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold text-right">Debit</th><th className="px-4 py-3 font-semibold text-right">Credit</th>
                <th className="px-4 py-3 font-semibold text-right">Balance</th>
              </tr></thead>
              <tbody className="divide-y">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 text-xs">{new Date(e.entryDate).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-muted">{e.voucherType}</span></td>
                    <td className="px-4 py-3 text-xs font-mono">{e.voucherNo || "—"}</td>
                    <td className="px-4 py-3 text-xs">{e.description || "—"}</td>
                    <td className="px-4 py-3 text-right">{e.debitInr ? `₹${e.debitInr.toLocaleString("en-IN")}` : ""}</td>
                    <td className="px-4 py-3 text-right">{e.creditInr ? `₹${e.creditInr.toLocaleString("en-IN")}` : ""}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{(e.runningBalanceInr || 0).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </PortalLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="bg-card border rounded-xl p-4">
    <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${accent || ""}`}>{value}</div>
  </div>;
}
