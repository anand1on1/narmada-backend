import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, AlertTriangle, Send, Loader2 } from "lucide-react";

interface OverdueRow {
  customerId: number;
  name: string;
  phone: string | null;
  email: string | null;
  balanceInr: number;
  oldestInvoiceDate: number;
  ageDays: number;
  termDays: number;
}

function inr(n: number | null) { return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—"; }
function fmt(d: number | null) { return d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }

export default function AdminAILedger() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{ rows: any[]; sql: string; explanation: string } | null>(null);

  const ask = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/ledger/ask`, { method: "POST", body: JSON.stringify({ question }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Query failed");
      return d;
    },
    onSuccess: (d) => setResult(d),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: overdue = [], isLoading: loadingOverdue } = useQuery<OverdueRow[]>({
    queryKey: ["admin-ledger-overdue"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/ledger/overdue`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  const remind = useMutation({
    mutationFn: async (customerId: number) => {
      const r = await adminFetch(token, `/api/admin/ledger/remind/${customerId}`, { method: "POST" });
      if (!r.ok) throw new Error("Reminder failed");
      return r.json();
    },
    onSuccess: () => toast({ title: "Reminder sent" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cols = result?.rows?.length ? Object.keys(result.rows[0]) : [];

  return (
    <AdminLayout title="AI Ledger Assistant">
      <div className="bg-card border rounded-xl p-5 shadow-sm mb-6">
        <div className="flex items-center gap-2 mb-3 font-semibold"><Sparkles className="w-4 h-4 text-accent" /> Ask about ledgers, balances & payments</div>
        <div className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && question.trim() && ask.mutate()}
            placeholder="e.g. Which customers have outstanding balance over 1 lakh?"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
          <button onClick={() => ask.mutate()} disabled={!question.trim() || ask.isPending}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Ask
          </button>
        </div>
        {result && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">{result.explanation}</p>
            <details className="mb-3"><summary className="text-xs text-muted-foreground cursor-pointer">View generated SQL</summary>
              <pre className="mt-1 text-xs bg-muted/40 rounded p-2 overflow-x-auto">{result.sql}</pre></details>
            {result.rows.length === 0 ? <p className="text-sm text-muted-foreground">No rows.</p> : (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/50 text-left">{cols.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
                  <tbody className="divide-y">{result.rows.map((row, i) => (
                    <tr key={i}>{cols.map((c) => <td key={c} className="px-3 py-2">{String(row[c] ?? "")}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Overdue Accounts</div>
        {loadingOverdue ? <div className="p-8 text-center text-muted-foreground">Loading…</div> :
          overdue.length === 0 ? <div className="p-8 text-center text-muted-foreground">No overdue accounts. 🎉</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/30 text-left">
              <th className="px-3 py-2 font-semibold">Customer</th>
              <th className="px-3 py-2 font-semibold text-right">Balance</th>
              <th className="px-3 py-2 font-semibold">Oldest Invoice</th>
              <th className="px-3 py-2 font-semibold text-right">Age (days)</th>
              <th className="px-3 py-2 font-semibold text-right">Terms</th>
              <th className="px-3 py-2 font-semibold text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y">{overdue.map((o) => (
              <tr key={o.customerId} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold">{o.name}</td>
                <td className="px-3 py-2 text-right font-semibold text-red-600">{inr(o.balanceInr)}</td>
                <td className="px-3 py-2">{fmt(o.oldestInvoiceDate)}</td>
                <td className="px-3 py-2 text-right">{o.ageDays}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{o.termDays}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => remind.mutate(o.customerId)} disabled={remind.isPending}
                    className="px-2.5 py-1 border rounded text-xs font-semibold inline-flex items-center gap-1 hover:bg-muted">
                    <Send className="w-3 h-3" /> Remind
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
