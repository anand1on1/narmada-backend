// R27.36 — Expense Approvals.
//
// Same shape and same gate as R27.35's AdminPaymentApprovals: expenses whose
// GST-inclusive total exceeds ₹5,000 wait here, and only the `narmadamobility123`
// login may act. Every other admin sees the queue read-only. The rule keys off the
// username, not the role, because roles are editable from the admin UI.
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import type { ExpensePageProps } from "@/lib/expense-page-props";
import { useToast } from "@/hooks/use-toast";
import { Check, X, RefreshCw, ShieldAlert } from "lucide-react";

type ApprovalStatus = "auto_approved" | "pending_approval" | "approved" | "rejected";

interface ExpenseApproval {
  id: number;
  expense_date_display: string;
  category_name: string;
  payee_name: string;
  description: string | null;
  amount: number;
  gst_percent: number;
  gst_mode: "inclusive" | "exclusive";
  gst_amount: number;
  total_amount: number;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  rejection_reason: string | null;
  created_by: string;
  slip_number: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS = [
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const BADGES: Record<ApprovalStatus, { label: string; dot: string; cls: string }> = {
  approved: { label: "Approved", dot: "🟢", cls: "bg-emerald-500/15 text-emerald-700" },
  pending_approval: { label: "Pending Approval", dot: "🟡", cls: "bg-amber-500/15 text-amber-800" },
  rejected: { label: "Rejected", dot: "🔴", cls: "bg-rose-500/15 text-rose-700" },
  auto_approved: { label: "Auto-Approved", dot: "⚪", cls: "bg-slate-500/15 text-slate-600" },
};
function Badge({ status }: { status: ApprovalStatus }) {
  const b = BADGES[status] || BADGES.auto_approved;
  return (
    <span className={"text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 " + b.cls} data-testid={`badge-expense-approval-${status}`}>
      <span aria-hidden>{b.dot}</span>{b.label}
    </span>
  );
}

export function ExpenseApprovalsBody({ token, fetcher, Layout }: ExpensePageProps) {
  const { toast } = useToast();

  const [tab, setTab] = useState("pending_approval");
  const [rows, setRows] = useState<ExpenseApproval[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  // The server is the authority on who may approve; the UI only mirrors its answer.
  const [canApprove, setCanApprove] = useState(false);
  const [approverUsername, setApproverUsername] = useState("narmadamobility123");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ExpenseApproval | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetcher(token, `/api/admin/expense-approvals/pending?status=${encodeURIComponent(tab)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d = await r.json();
      setRows(Array.isArray(d.expenses) ? d.expenses : []);
      setPendingCount(Number(d.pending_count) || 0);
      setCanApprove(!!d.can_approve);
      if (d.approver_username) setApproverUsername(d.approver_username);
    } catch (e: any) {
      toast({ title: "Failed to load expense approvals", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(e: ExpenseApproval, action: "approve" | "reject", reason?: string) {
    if (!token) return;
    setBusyId(e.id);
    try {
      const r = await fetcher(token, `/api/admin/expense-approvals/${e.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: action === "approve" ? `Expense approved — ${inr(e.total_amount)}` : `Expense rejected` });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (err: any) {
      toast({ title: action === "approve" ? "Approve failed" : "Reject failed", description: err.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  function confirmApprove(e: ExpenseApproval) {
    if (!window.confirm(`Approve expense of ${inr(e.total_amount)} to ${e.payee_name}?`)) return;
    decide(e, "approve");
  }

  const reasonTooShort = rejectReason.trim().length < 5;
  const totalOnScreen = useMemo(() => rows.reduce((s, r) => s + r.total_amount, 0), [rows]);

  return (
    <Layout title="Expense Approvals">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground" data-testid="heading-expense-approvals">
            Expenses over ₹5,000 wait here until released. Anything at or under ₹5,000 is approved automatically.
          </p>
          <button onClick={load} className="px-4 py-2 border rounded-lg font-semibold text-sm inline-flex items-center gap-2 hover:bg-muted" data-testid="button-refresh-expense-approvals">
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
          </button>
        </div>

        {!canApprove && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2" data-testid="banner-not-expense-approver">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Only {approverUsername} can approve expenses. You can view the queue but not act on it.</span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={"px-3 py-1.5 rounded-lg text-sm font-semibold border " + (tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-muted")}
              data-testid={`tab-expense-approvals-${t.key}`}
            >
              {t.label}
              {t.key === "pending_approval" && pendingCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px]">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="bg-card border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-expense-approvals">
              {tab === "pending_approval" ? "Nothing waiting for approval." : "No expenses in this view."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-3 font-semibold">Date</th>
                    <th className="px-3 py-3 font-semibold">Category</th>
                    <th className="px-3 py-3 font-semibold">Payee</th>
                    <th className="px-3 py-3 font-semibold">Description</th>
                    <th className="px-3 py-3 font-semibold">Booked by</th>
                    <th className="px-3 py-3 font-semibold text-right">Amount</th>
                    <th className="px-3 py-3 font-semibold text-right">GST</th>
                    <th className="px-3 py-3 font-semibold text-right">Total</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((e) => {
                    const actionable = e.approval_status === "pending_approval" && canApprove;
                    return (
                      <tr key={e.id} data-testid={`row-expense-approval-${e.id}`}>
                        <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{e.expense_date_display}</td>
                        <td className="px-3 py-3">{e.category_name}</td>
                        <td className="px-3 py-3">
                          {e.payee_name}
                          {e.is_recurring && <span className="ml-1.5 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-700">{e.recurring_frequency}</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-600 max-w-[200px] truncate">{e.description || "—"}</td>
                        <td className="px-3 py-3 text-slate-500">{e.created_by}</td>
                        <td className="px-3 py-3 text-right">{inr(e.amount)}</td>
                        <td className="px-3 py-3 text-right text-slate-500">
                          {inr(e.gst_amount)}<span className="text-[10px] ml-1">{e.gst_percent}% {e.gst_mode === "inclusive" ? "inc" : "exc"}</span>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">{inr(e.total_amount)}</td>
                        <td className="px-3 py-3">
                          <Badge status={e.approval_status} />
                          {e.rejection_reason && (
                            <div className="text-[10px] text-rose-700 mt-0.5" data-testid={`text-expense-rejection-${e.id}`}>{e.rejection_reason}</div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => confirmApprove(e)}
                              disabled={!actionable || busyId === e.id}
                              title={canApprove ? undefined : `Only ${approverUsername} can approve expenses`}
                              className="px-2 py-1 text-xs rounded bg-emerald-500/15 text-emerald-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                              data-testid={`button-approve-expense-${e.id}`}
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => { setRejectTarget(e); setRejectReason(""); }}
                              disabled={!actionable || busyId === e.id}
                              title={canApprove ? undefined : `Only ${approverUsername} can reject expenses`}
                              className="px-2 py-1 text-xs rounded bg-rose-500/15 text-rose-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                              data-testid={`button-reject-expense-${e.id}`}
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={7} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total on screen</td>
                    <td className="px-3 py-2 text-right" data-testid="text-expense-approvals-total">{inr(totalOnScreen)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRejectTarget(null)}>
          <div className="bg-card border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} data-testid="dialog-reject-expense">
            <h2 className="text-lg font-bold mb-1">Reject expense</h2>
            <p className="text-sm text-muted-foreground mb-3">
              {inr(rejectTarget.total_amount)} to {rejectTarget.payee_name}. The person who booked it sees this reason.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Why is this expense being rejected?"
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm"
              data-testid="input-reject-expense-reason"
            />
            {reasonTooShort && rejectReason.length > 0 && (
              <div className="text-xs text-rose-600 mt-1">Reason must be at least 5 characters.</div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejectTarget(null)} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button
                onClick={() => decide(rejectTarget, "reject", rejectReason.trim())}
                disabled={reasonTooShort || busyId === rejectTarget.id}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-40"
                data-testid="button-confirm-reject-expense"
              >
                Reject Expense
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// Admin panel entry point — unchanged route /admin/expense-approvals.
export default function AdminExpenseApprovals() {
  const { token } = useAdminAuth();
  return <ExpenseApprovalsBody token={token} fetcher={adminFetch} Layout={AdminLayout} />;
}
