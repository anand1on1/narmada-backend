// R27.36 — Expense Ledger.
//
// Derived view, never a table: only expenses that are approved (or auto-approved)
// AND carry a slip number appear, so the running balance always matches money that
// was actually committed. Pending and rejected rows are invisible here by design.
import { useEffect, useMemo, useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import type { ExpensePageProps } from "@/lib/expense-page-props";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Download } from "lucide-react";

interface LedgerEntry {
  id: number;
  expense_date_display: string;
  slip_number: string;
  category_name: string;
  payee_name: string;
  description: string | null;
  amount: number;
  gst_amount: number;
  total_amount: number;
  running_balance: number;
}
interface LedgerResponse {
  entries: LedgerEntry[];
  total_debit: number;
  entry_count: number;
  grouped_by_category: Record<string, number>;
  grouped_by_payee: Record<string, number>;
  grouped_by_month: Record<string, number>;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY: LedgerResponse = {
  entries: [], total_debit: 0, entry_count: 0,
  grouped_by_category: {}, grouped_by_payee: {}, grouped_by_month: {},
};

const GROUPS = [
  { key: "all", label: "All" },
  { key: "category", label: "By Category" },
  { key: "payee", label: "By Payee" },
  { key: "month", label: "By Month" },
] as const;

function topOf(m: Record<string, number>): { name: string; value: number } {
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
  return rows.length ? { name: rows[0][0], value: rows[0][1] } : { name: "—", value: 0 };
}

export function ExpenseLedgerBody({ token, fetcher, Layout }: ExpensePageProps) {
  const { toast } = useToast();

  const [data, setData] = useState<LedgerResponse>(EMPTY);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [payees, setPayees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<string>("all");

  const [fCat, setFCat] = useState("");
  const [fPayee, setFPayee] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  async function api(pathname: string) {
    const r = await fetcher(token, pathname);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    return r.json();
  }

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setCats(await api("/api/expenses/categories"));
        setPayees(await api("/api/expenses/payees"));
      } catch { /* filters simply stay empty */ }
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (fCat) p.set("category_id", fCat);
      if (fPayee) p.set("payee_id", fPayee);
      if (fFrom) p.set("from", fFrom);
      if (fTo) p.set("to", fTo);
      setData(await api(`/api/expenses/ledger?${p.toString()}`));
    } catch (e: any) {
      toast({ title: "Failed to load ledger", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token, fCat, fPayee, fFrom, fTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const topCategory = useMemo(() => topOf(data.grouped_by_category), [data]);
  const topPayee = useMemo(() => topOf(data.grouped_by_payee), [data]);

  function exportCsv() {
    const head = ["Date", "Slip #", "Category", "Payee", "Description", "Amount", "GST", "Total", "Running Balance"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      head.join(","),
      ...data.entries.map((e) => [
        e.expense_date_display, e.slip_number, e.category_name, e.payee_name, e.description ?? "",
        e.amount, e.gst_amount, e.total_amount, e.running_balance,
      ].map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expense-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const groupMap: Record<string, number> =
    group === "category" ? data.grouped_by_category
    : group === "payee" ? data.grouped_by_payee
    : group === "month" ? data.grouped_by_month
    : {};

  return (
    <Layout title="Expense Ledger">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <p className="text-sm text-muted-foreground" data-testid="heading-expense-ledger">
            Approved expenses with a generated slip. Pending and rejected entries are excluded.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={load} className="px-3 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted" data-testid="button-refresh-ledger">
              <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
            </button>
            <button onClick={exportCsv} disabled={!data.entries.length} className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40" data-testid="button-export-csv">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-card border rounded-xl p-4" data-testid="card-total-debit">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Total Debit</div>
            <div className="text-xl font-bold mt-1">{inr(data.total_debit)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4" data-testid="card-entry-count">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Entries</div>
            <div className="text-xl font-bold mt-1">{data.entry_count}</div>
          </div>
          <div className="bg-card border rounded-xl p-4" data-testid="card-top-category">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Largest Category</div>
            <div className="text-sm font-bold mt-1 truncate">{topCategory.name}</div>
            <div className="text-xs text-muted-foreground">{inr(topCategory.value)}</div>
          </div>
          <div className="bg-card border rounded-xl p-4" data-testid="card-top-payee">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Largest Payee</div>
            <div className="text-sm font-bold mt-1 truncate">{topPayee.name}</div>
            <div className="text-xs text-muted-foreground">{inr(topPayee.value)}</div>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          {/* left filter panel */}
          <aside className="w-60 shrink-0 bg-card border rounded-xl p-4 space-y-3" data-testid="panel-ledger-filters">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Filters</div>
            <label className="block text-xs font-semibold text-slate-600">Category
              <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="w-full mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm font-normal" data-testid="ledger-filter-category">
                <option value="">All</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">Payee
              <select value={fPayee} onChange={(e) => setFPayee(e.target.value)} className="w-full mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm font-normal" data-testid="ledger-filter-payee">
                <option value="">All</option>
                {payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">From
              <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="w-full mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm font-normal" data-testid="ledger-filter-from" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">To
              <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="w-full mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm font-normal" data-testid="ledger-filter-to" />
            </label>
            <button
              onClick={() => { setFCat(""); setFPayee(""); setFFrom(""); setFTo(""); }}
              className="w-full px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted"
              data-testid="button-clear-ledger-filters"
            >
              Clear filters
            </button>
          </aside>

          {/* right table */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setGroup(g.key)}
                  className={"px-3 py-1.5 rounded-lg text-sm font-semibold border " + (group === g.key ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-muted")}
                  data-testid={`tab-ledger-${g.key}`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="bg-card border rounded-xl overflow-hidden">
              {loading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
              ) : group !== "all" ? (
                Object.keys(groupMap).length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-ledger-group">Nothing to group.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left">
                        <th className="px-3 py-3 font-semibold">{GROUPS.find((g) => g.key === group)?.label.replace("By ", "")}</th>
                        <th className="px-3 py-3 font-semibold text-right">Total</th>
                        <th className="px-3 py-3 font-semibold text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Object.entries(groupMap).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                        <tr key={k} data-testid={`row-group-${group}`}>
                          <td className="px-3 py-2.5">{k}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{inr(v)}</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground">
                            {data.total_debit > 0 ? `${((v / data.total_debit) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : data.entries.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-ledger">
                  No slipped expenses in this range.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left">
                        <th className="px-3 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Slip #</th>
                        <th className="px-3 py-3 font-semibold">Category</th>
                        <th className="px-3 py-3 font-semibold">Payee</th>
                        <th className="px-3 py-3 font-semibold">Description</th>
                        <th className="px-3 py-3 font-semibold text-right">Amount</th>
                        <th className="px-3 py-3 font-semibold text-right">GST</th>
                        <th className="px-3 py-3 font-semibold text-right">Total</th>
                        <th className="px-3 py-3 font-semibold text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.entries.map((e) => (
                        <tr key={e.id} data-testid={`row-ledger-${e.id}`}>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{e.expense_date_display}</td>
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-indigo-700">{e.slip_number}</td>
                          <td className="px-3 py-2.5">{e.category_name}</td>
                          <td className="px-3 py-2.5">{e.payee_name}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate">{e.description || "—"}</td>
                          <td className="px-3 py-2.5 text-right">{inr(e.amount)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-500">{inr(e.gst_amount)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{inr(e.total_amount)}</td>
                          <td className="px-3 py-2.5 text-right font-bold text-indigo-700" data-testid={`text-running-balance-${e.id}`}>{inr(e.running_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/40 font-semibold">
                        <td colSpan={7} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total Debit</td>
                        <td className="px-3 py-2 text-right" data-testid="text-ledger-total">{inr(data.total_debit)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// Team panel entry point — unchanged route /team/expense-ledger.
export default function TeamExpenseLedger() {
  const { token } = useTeamAuth();
  return <ExpenseLedgerBody token={token} fetcher={teamFetch} Layout={TeamLayout} />;
}
