// R27.36a-part-2 — Unified Expenses page.
//
// A single page with 5 tabs replacing the R27.6 Accounts Dashboard for the
// unified expense ledger delivered in R27.36a-part-1:
//   - Ledger: every slip (direct + advance + bus) across all 3 series.
//   - Advances: ADV/ slips with outstanding balance, reconcile + mark-returned.
//   - Cash in Hand: per-branch balance + deposit/withdrawal entries.
//   - Person Ledger: aggregate per payee + drill-down.
//   - Categories: system + custom, with is_system lock.
//
// The old R27.6 AccountsDashboard is NOT deleted in this release — it stays
// reachable at /admin/accounts, /finance/dashboard, etc. so we can roll back
// instantly. R27.36a-part-3 will retire it once this page is validated on prod.
//
// Rendered by three portals (admin/team/finance) via the same ExpensePageProps
// contract as R27.36-FIX-1: caller supplies token + fetcher + Layout.
import { useEffect, useMemo, useState } from "react";
import type { ExpensePageProps } from "@/lib/expense-page-props";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Wallet, ListTree, Users, FolderTree, HandCoins, Download, Check, X, Lock } from "lucide-react";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { TeamLayout } from "@/pages/team/TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";

type Tab = "ledger" | "advances" | "cash" | "person" | "categories";

type ExpenseType = "direct" | "advance" | "bus";
type ApprovalStatus = "auto_approved" | "pending_approval" | "approved" | "rejected";
type AdvanceStatus = "open" | "partial" | "reconciled" | "returned";

interface LedgerRow {
  id: number;
  expense_type?: ExpenseType | null;
  slip_number: string | null;
  expense_date_display: string;
  category_name: string | null;
  payee_name: string;
  description: string | null;
  amount: number;
  gst_amount: number;
  total_amount: number;
  approval_status: ApprovalStatus;
  is_legacy?: number | null;
}

interface AdvanceRow {
  id: number;
  slip_number: string | null;
  expense_date_display: string;
  payee_name: string;
  branch_id: number | null;
  amount: number;
  reconciled_amount: number;
  returned_amount: number;
  outstanding: number;
  advance_status: AdvanceStatus | null;
  expected_return_date: number | null;
}

interface CashInHandEntry {
  id: number;
  branch: string;
  entry_type: "deposit" | "withdrawal";
  amount: number;
  date_display?: string;
  notes: string | null;
}
interface CashInHandBalance { branch: string; balance: number }
interface CashInHandResponse { balances: CashInHandBalance[]; entries: CashInHandEntry[] }

interface PersonLedgerRow {
  payee_name: string;
  total_advances: number;
  total_reconciled: number;
  total_returned: number;
  net_outstanding: number;
  slip_count?: number;
}

interface Category { id: number; name: string; description: string | null; is_system?: number }

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_BADGE: Record<ExpenseType, { label: string; cls: string }> = {
  direct: { label: "Direct", cls: "bg-emerald-500/15 text-emerald-700" },
  advance: { label: "Advance", cls: "bg-blue-500/15 text-blue-700" },
  bus: { label: "Bus", cls: "bg-orange-500/15 text-orange-700" },
};

const STATUS_BADGE: Record<ApprovalStatus, string> = {
  approved: "bg-emerald-500/15 text-emerald-700",
  auto_approved: "bg-slate-500/15 text-slate-600",
  pending_approval: "bg-amber-500/15 text-amber-800",
  rejected: "bg-rose-500/15 text-rose-700",
};

const ADV_BADGE: Record<AdvanceStatus, string> = {
  open: "bg-amber-500/15 text-amber-800",
  partial: "bg-blue-500/15 text-blue-700",
  reconciled: "bg-emerald-500/15 text-emerald-700",
  returned: "bg-slate-500/15 text-slate-600",
};

export function ExpensesUnifiedBody({ token, fetcher, Layout }: ExpensePageProps) {
  const [tab, setTab] = useState<Tab>("ledger");
  return (
    <Layout title="Expenses">
      <div className="flex flex-wrap gap-2 mb-5">
        <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")} icon={ListTree} label="Ledger" testid="tab-ledger" />
        <TabBtn active={tab === "advances"} onClick={() => setTab("advances")} icon={HandCoins} label="Advances" testid="tab-advances" />
        <TabBtn active={tab === "cash"} onClick={() => setTab("cash")} icon={Wallet} label="Cash in Hand" testid="tab-cash" />
        <TabBtn active={tab === "person"} onClick={() => setTab("person")} icon={Users} label="Person Ledger" testid="tab-person" />
        <TabBtn active={tab === "categories"} onClick={() => setTab("categories")} icon={FolderTree} label="Categories" testid="tab-categories" />
      </div>
      {tab === "ledger" && <LedgerTab token={token} fetcher={fetcher} />}
      {tab === "advances" && <AdvancesTab token={token} fetcher={fetcher} />}
      {tab === "cash" && <CashInHandTab token={token} fetcher={fetcher} />}
      {tab === "person" && <PersonLedgerTab token={token} fetcher={fetcher} />}
      {tab === "categories" && <CategoriesTab token={token} fetcher={fetcher} />}
    </Layout>
  );
}

function TabBtn({ active, onClick, icon: Icon, label, testid }: { active: boolean; onClick: () => void; icon: any; label: string; testid: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={"px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 " +
        (active ? "bg-accent text-accent-foreground" : "border hover:bg-muted")}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Ledger tab
// ────────────────────────────────────────────────────────────────────────────
function LedgerTab({ token, fetcher }: { token: string | null; fetcher: ExpensePageProps["fetcher"] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | ExpenseType>("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (typeFilter !== "all") p.set("type", typeFilter);
      if (q) p.set("search", q);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetcher(token, `/api/expenses/ledger?${p.toString()}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed to load ledger");
      setRows(Array.isArray(d?.rows) ? d.rows : Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast({ title: "Failed to load ledger", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [typeFilter, from, to]);

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.total_amount || 0), 0), [rows]);

  const downloadCsv = async () => {
    try {
      const p = new URLSearchParams();
      if (typeFilter !== "all") p.set("type", typeFilter);
      if (q) p.set("search", q);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetcher(token, `/api/expenses/ledger/csv?${p.toString()}`);
      if (!r.ok) throw new Error("CSV export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `expenses-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "CSV export failed", description: String(e?.message || e), variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="select-ledger-type">
            <option value="all">All types</option>
            <option value="direct">Direct only</option>
            <option value="advance">Advances only</option>
            <option value="bus">Bus only</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-ledger-from" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-ledger-to" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Payee / description / slip" className="border rounded px-2 py-1 text-sm bg-background w-full" data-testid="input-ledger-search" />
        </div>
        <button onClick={load} className="px-3 py-1.5 border rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted" data-testid="button-ledger-refresh">
          <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
          Refresh
        </button>
        <button onClick={downloadCsv} className="px-3 py-1.5 border rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted" data-testid="button-ledger-csv">
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Slip</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Payee</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-right px-3 py-2">GST</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No expenses match the filters.</td></tr>
            )}
            {rows.map((r) => {
              const t = (r.expense_type || "direct") as ExpenseType;
              const badge = TYPE_BADGE[t] || TYPE_BADGE.direct;
              return (
                <tr key={r.id} className="border-t" data-testid={`row-ledger-${r.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.expense_date_display}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.slip_number || <span className="text-muted-foreground">—</span>}{r.is_legacy ? <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-slate-400/20 text-slate-600">R27.6</span> : null}</td>
                  <td className="px-3 py-2"><span className={"text-[10px] font-bold px-2 py-0.5 rounded " + badge.cls}>{badge.label}</span></td>
                  <td className="px-3 py-2">{r.category_name || "—"}</td>
                  <td className="px-3 py-2">{r.payee_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.description || ""}</td>
                  <td className="px-3 py-2 text-right">{inr(r.amount)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{inr(r.gst_amount)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{inr(r.total_amount)}</td>
                  <td className="px-3 py-2"><span className={"text-[10px] font-bold px-2 py-0.5 rounded " + STATUS_BADGE[r.approval_status]}>{r.approval_status.replace(/_/g, " ")}</span></td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td colSpan={8} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total</td>
                <td className="px-3 py-2 text-right" data-testid="text-ledger-total">{inr(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Advances tab
// ────────────────────────────────────────────────────────────────────────────
function AdvancesTab({ token, fetcher }: { token: string | null; fetcher: ExpensePageProps["fetcher"] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | AdvanceStatus>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [returnFor, setReturnFor] = useState<AdvanceRow | null>(null);
  const [returnAmt, setReturnAmt] = useState("");
  const [returnNotes, setReturnNotes] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (statusFilter !== "all") p.set("status", statusFilter);
      const r = await fetcher(token, `/api/expenses/advances?${p.toString()}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed to load advances");
      setRows(Array.isArray(d?.rows) ? d.rows : Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast({ title: "Failed to load advances", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const submitReturn = async () => {
    if (!returnFor) return;
    const amt = Number(returnAmt);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Amount must be > 0", variant: "destructive" });
      return;
    }
    if (amt > returnFor.outstanding + 0.01) {
      toast({ title: "Return exceeds outstanding", description: `Outstanding: ${inr(returnFor.outstanding)}`, variant: "destructive" });
      return;
    }
    setBusyId(returnFor.id);
    try {
      const r = await fetcher(token, `/api/expenses/advances/${returnFor.id}/mark-returned`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ return_amount: amt, notes: returnNotes || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Mark returned failed");
      toast({ title: "Marked returned" });
      setReturnFor(null); setReturnAmt(""); setReturnNotes("");
      load();
    } catch (e: any) {
      toast({ title: "Mark returned failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    amount: acc.amount + Number(r.amount || 0),
    outstanding: acc.outstanding + Number(r.outstanding || 0),
  }), { amount: 0, outstanding: 0 }), [rows]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="select-adv-status">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="partial">Partial</option>
            <option value="reconciled">Reconciled</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <button onClick={load} className="px-3 py-1.5 border rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted" data-testid="button-adv-refresh">
          <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Slip</th>
              <th className="text-left px-3 py-2">Payee</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-right px-3 py-2">Reconciled</th>
              <th className="text-right px-3 py-2">Returned</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No advances match.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t" data-testid={`row-adv-${r.id}`}>
                <td className="px-3 py-2 whitespace-nowrap">{r.expense_date_display}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.slip_number || "—"}</td>
                <td className="px-3 py-2">{r.payee_name}</td>
                <td className="px-3 py-2 text-right">{inr(r.amount)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{inr(r.reconciled_amount)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{inr(r.returned_amount)}</td>
                <td className="px-3 py-2 text-right font-semibold">{inr(r.outstanding)}</td>
                <td className="px-3 py-2">
                  {r.advance_status && <span className={"text-[10px] font-bold px-2 py-0.5 rounded " + ADV_BADGE[r.advance_status]}>{r.advance_status}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.outstanding > 0 && (
                    <button
                      onClick={() => { setReturnFor(r); setReturnAmt(String(r.outstanding.toFixed(2))); setReturnNotes(""); }}
                      className="px-2 py-1 border rounded text-xs font-semibold hover:bg-muted"
                      disabled={busyId === r.id}
                      data-testid={`button-adv-return-${r.id}`}
                    >
                      Mark Returned
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total</td>
                <td className="px-3 py-2 text-right">{inr(totals.amount)}</td>
                <td />
                <td />
                <td className="px-3 py-2 text-right" data-testid="text-adv-outstanding-total">{inr(totals.outstanding)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {returnFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setReturnFor(null)}>
          <div className="bg-background border rounded-lg p-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2">Mark returned — {returnFor.slip_number}</h3>
            <p className="text-xs text-muted-foreground mb-3">Outstanding: <span className="font-semibold text-foreground">{inr(returnFor.outstanding)}</span></p>
            <label className="block text-xs mb-1">Return amount</label>
            <input type="number" step="0.01" value={returnAmt} onChange={(e) => setReturnAmt(e.target.value)} className="w-full border rounded px-2 py-1 text-sm bg-background mb-3" data-testid="input-return-amount" />
            <label className="block text-xs mb-1">Notes (optional)</label>
            <textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} rows={2} className="w-full border rounded px-2 py-1 text-sm bg-background mb-3" data-testid="input-return-notes" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReturnFor(null)} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
              <button onClick={submitReturn} disabled={busyId === returnFor.id} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="button-confirm-return">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cash in Hand tab
// ────────────────────────────────────────────────────────────────────────────
function CashInHandTab({ token, fetcher }: { token: string | null; fetcher: ExpensePageProps["fetcher"] }) {
  const { toast } = useToast();
  const [data, setData] = useState<CashInHandResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState("Delhi");
  const [entryType, setEntryType] = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetcher(token, `/api/expenses/cash-in-hand`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed to load cash");
      const balances = Array.isArray(d?.balances) ? d.balances : [];
      const entries = Array.isArray(d?.entries) ? d.entries : [];
      setData({ balances, entries });
    } catch (e: any) {
      toast({ title: "Failed to load cash-in-hand", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Amount must be > 0", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetcher(token, `/api/expenses/cash-in-hand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, entry_type: entryType, amount: amt, notes: notes || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Save failed");
      toast({ title: `${entryType === "deposit" ? "Deposit" : "Withdrawal"} recorded` });
      setAmount(""); setNotes("");
      load();
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {data?.balances.map((b) => (
          <div key={b.branch} className="border rounded-lg p-4" data-testid={`card-cash-${b.branch}`}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{b.branch}</div>
            <div className="text-2xl font-bold text-emerald-700">{inr(b.balance)}</div>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-4 mb-4 bg-muted/20">
        <div className="font-semibold text-sm mb-2">Record deposit / withdrawal</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs mb-1">Branch</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="select-cash-branch">
              <option>Delhi</option>
              <option>Patna</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Type</label>
            <select value={entryType} onChange={(e) => setEntryType(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="select-cash-type">
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background w-32" data-testid="input-cash-amount" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background w-full" data-testid="input-cash-notes" />
          </div>
          <button onClick={submit} disabled={saving} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="button-cash-submit">
            {saving ? "Saving…" : "Record"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Branch</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(!data || data.entries.length === 0) && !loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No entries yet.</td></tr>
            )}
            {data?.entries.map((e) => (
              <tr key={e.id} className="border-t" data-testid={`row-cash-${e.id}`}>
                <td className="px-3 py-2 whitespace-nowrap">{e.date_display || "—"}</td>
                <td className="px-3 py-2">{e.branch}</td>
                <td className="px-3 py-2">
                  <span className={"text-[10px] font-bold px-2 py-0.5 rounded " + (e.entry_type === "deposit" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700")}>
                    {e.entry_type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold">{inr(e.amount)}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Person Ledger tab
// ────────────────────────────────────────────────────────────────────────────
function PersonLedgerTab({ token, fetcher }: { token: string | null; fetcher: ExpensePageProps["fetcher"] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PersonLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetcher(token, `/api/expenses/person-ledger`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed to load");
      setRows(Array.isArray(d?.rows) ? d.rows : Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast({ title: "Failed to load person ledger", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div>
      <div className="flex mb-3">
        <button onClick={load} className="px-3 py-1.5 border rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted" data-testid="button-person-refresh">
          <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Payee</th>
              <th className="text-right px-3 py-2">Advances Given</th>
              <th className="text-right px-3 py-2">Adjusted</th>
              <th className="text-right px-3 py-2">Returned</th>
              <th className="text-right px-3 py-2">Net Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No entries.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.payee_name + i} className="border-t" data-testid={`row-person-${i}`}>
                <td className="px-3 py-2 font-semibold">{r.payee_name}</td>
                <td className="px-3 py-2 text-right">{inr(r.total_advances)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{inr(r.total_reconciled)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{inr(r.total_returned)}</td>
                <td className={"px-3 py-2 text-right font-bold " + (r.net_outstanding > 0 ? "text-amber-700" : "text-emerald-700")}>{inr(r.net_outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Categories tab
// ────────────────────────────────────────────────────────────────────────────
function CategoriesTab({ token, fetcher }: { token: string | null; fetcher: ExpensePageProps["fetcher"] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetcher(token, `/api/expenses/categories`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed");
      setRows(Array.isArray(d?.rows) ? d.rows : Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast({ title: "Failed to load categories", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetcher(token, `/api/expenses/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: desc.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Save failed");
      toast({ title: "Category added" });
      setName(""); setDesc("");
      load();
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const del = async (c: Category) => {
    if (c.is_system) return;
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try {
      const r = await fetcher(token, `/api/expenses/categories/${c.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Delete failed");
      toast({ title: "Deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="border rounded-lg p-4 mb-4 bg-muted/20">
        <div className="font-semibold text-sm mb-2">Add category</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" data-testid="input-cat-name" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs mb-1">Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background w-full" data-testid="input-cat-desc" />
          </div>
          <button onClick={submit} disabled={saving} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="button-cat-add">
            {saving ? "…" : "Add"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No categories.</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="border-t" data-testid={`row-cat-${c.id}`}>
                <td className="px-3 py-2 font-semibold inline-flex items-center gap-1.5">
                  {c.is_system ? <Lock className="w-3 h-3 text-slate-500" /> : null}
                  {c.name}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.description || ""}</td>
                <td className="px-3 py-2 text-right">
                  {c.is_system ? (
                    <span className="text-xs text-muted-foreground italic">system</span>
                  ) : (
                    <button onClick={() => del(c)} className="px-2 py-1 border rounded text-xs font-semibold hover:bg-rose-50 hover:text-rose-700" data-testid={`button-cat-delete-${c.id}`}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Portal wrappers
// ────────────────────────────────────────────────────────────────────────────
export default function AdminExpensesUnified() {
  const { token } = useAdminAuth();
  return <ExpensesUnifiedBody token={token} fetcher={adminFetch} Layout={AdminLayout} />;
}

export function TeamExpensesUnified() {
  const { token } = useTeamAuth();
  return <ExpensesUnifiedBody token={token} fetcher={teamFetch} Layout={TeamLayout} />;
}
