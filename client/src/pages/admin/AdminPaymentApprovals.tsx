// R27.35 — Payment Approvals.
//
// Slips whose GST-inclusive grand total exceeds ₹5,000 land here in `pending_approval`
// and cannot be marked paid until released. Only the `narmadamobility123` login may act;
// every other admin sees the queue read-only. The rule is deliberately not role-based —
// roles are editable from the admin UI, this gate is not.
import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { Check, X, ChevronDown, ChevronRight, RefreshCw, ShieldAlert } from "lucide-react";

type ApprovalStatus = "auto_approved" | "pending_approval" | "approved" | "rejected";

interface ApprovalItem {
  po_number: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
}
interface ApprovalVendor {
  id: number;
  vendor_name: string;
  status: string;
  po_numbers: string | null;
  gst_percent: number;
  gst_mode: "inclusive" | "exclusive";
  subtotal: number;
  gst_amount: number;
  total_with_gst: number;
  items: ApprovalItem[];
}
interface ApprovalBatch {
  batch_id: number;
  slip_number: string;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: number | null;
  rejection_reason: string | null;
  generated_by: string;
  generated_date: string;
  notes: string | null;
  vendor_count: number;
  grand_total_snapshot: number;
  vendors: ApprovalVendor[];
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS: { key: string; label: string }[] = [
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
    <span className={"text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 " + b.cls} data-testid={`badge-approval-${status}`}>
      <span aria-hidden>{b.dot}</span>{b.label}
    </span>
  );
}

export default function AdminPaymentApprovals() {
  const { token } = useAdminAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<string>("pending_approval");
  const [batches, setBatches] = useState<ApprovalBatch[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  // The server is the authority on who may approve; the UI only mirrors its answer.
  const [canApprove, setCanApprove] = useState(false);
  const [approverUsername, setApproverUsername] = useState("narmadamobility123");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ApprovalBatch | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const r = await adminFetch(token, `/api/admin/payment-approvals/pending?status=${encodeURIComponent(tab)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d = await r.json();
      setBatches(Array.isArray(d.batches) ? d.batches : []);
      setPendingCount(Number(d.pending_count) || 0);
      setCanApprove(!!d.can_approve);
      if (d.approver_username) setApproverUsername(d.approver_username);
    } catch (e: any) {
      toast({ title: "Failed to load approvals", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function decide(b: ApprovalBatch, action: "approve" | "reject", reason?: string) {
    if (!token) return;
    setBusyId(b.batch_id);
    try {
      const r = await adminFetch(token, `/api/admin/payment-approvals/${b.batch_id}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: action === "approve" ? `${b.slip_number} approved` : `${b.slip_number} rejected` });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (e: any) {
      toast({ title: action === "approve" ? "Approve failed" : "Reject failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  function confirmApprove(b: ApprovalBatch) {
    if (!window.confirm(`Approve payment of ${inr(b.grand_total_snapshot)} to ${b.vendor_count} vendor(s)?`)) return;
    decide(b, "approve");
  }

  const reasonTooShort = rejectReason.trim().length < 5;
  const totalOnScreen = useMemo(() => batches.reduce((s, b) => s + b.grand_total_snapshot, 0), [batches]);

  return (
    <AdminLayout title="Payment Approvals">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-muted-foreground" data-testid="heading-payment-approvals">
              Slips over ₹5,000 wait here until released. Anything at or under ₹5,000 is approved automatically.
            </p>
          </div>
          <button onClick={load} className="px-4 py-2 border rounded-lg font-semibold text-sm inline-flex items-center gap-2 hover:bg-muted" data-testid="button-refresh-approvals">
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
          </button>
        </div>

        {!canApprove && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2" data-testid="banner-not-approver">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Only {approverUsername} can approve payments. You can view the queue but not act on it.</span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={"px-3 py-1.5 rounded-lg text-sm font-semibold border " + (tab === t.key ? "bg-indigo-600 text-white border-indigo-600" : "hover:bg-muted")}
              data-testid={`tab-approvals-${t.key}`}
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
          ) : batches.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-approvals">
              {tab === "pending_approval" ? "Nothing waiting for approval." : "No batches in this view."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-3 w-8" />
                    <th className="px-3 py-3 font-semibold">Batch #</th>
                    <th className="px-3 py-3 font-semibold">Generated by</th>
                    <th className="px-3 py-3 font-semibold">Date</th>
                    <th className="px-3 py-3 font-semibold text-right">Total</th>
                    <th className="px-3 py-3 font-semibold text-right">Vendors</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batches.map((b) => {
                    const open = expanded.has(b.batch_id);
                    const actionable = b.approval_status === "pending_approval" && canApprove;
                    return (
                      <Fragment key={b.batch_id}>
                        <tr data-testid={`row-approval-${b.batch_id}`}>
                          <td className="px-3 py-3">
                            <button onClick={() => toggle(b.batch_id)} className="p-1 hover:bg-muted rounded" data-testid={`button-expand-${b.batch_id}`}>
                              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs font-semibold text-indigo-700">{b.slip_number}</td>
                          <td className="px-3 py-3">{b.generated_by}</td>
                          <td className="px-3 py-3 text-slate-500">{b.generated_date}</td>
                          <td className="px-3 py-3 text-right font-semibold">{inr(b.grand_total_snapshot)}</td>
                          <td className="px-3 py-3 text-right">{b.vendor_count}</td>
                          <td className="px-3 py-3"><Badge status={b.approval_status} /></td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => confirmApprove(b)}
                                disabled={!actionable || busyId === b.batch_id}
                                title={canApprove ? undefined : `Only ${approverUsername} can approve payments`}
                                className="px-2 py-1 text-xs rounded bg-emerald-500/15 text-emerald-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                                data-testid={`button-approve-${b.batch_id}`}
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                onClick={() => { setRejectTarget(b); setRejectReason(""); }}
                                disabled={!actionable || busyId === b.batch_id}
                                title={canApprove ? undefined : `Only ${approverUsername} can reject payments`}
                                className="px-2 py-1 text-xs rounded bg-rose-500/15 text-rose-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                                data-testid={`button-reject-${b.batch_id}`}
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-6 py-4">
                              {b.rejection_reason && (
                                <div className="mb-3 text-xs text-rose-700" data-testid={`text-rejection-reason-${b.batch_id}`}>
                                  Rejected: {b.rejection_reason}
                                </div>
                              )}
                              {b.notes && <div className="mb-3 text-xs text-slate-500">Notes: {b.notes}</div>}
                              <div className="space-y-4">
                                {b.vendors.map((v) => (
                                  <div key={v.id} className="border rounded-lg bg-background" data-testid={`detail-vendor-${v.id}`}>
                                    <div className="px-3 py-2 border-b flex items-center justify-between">
                                      <span className="font-semibold text-sm">{v.vendor_name}</span>
                                      <span className="text-xs text-slate-500">
                                        {v.po_numbers || "—"} · {inr(v.subtotal)} + {v.gst_percent}% GST ({v.gst_mode}) ={" "}
                                        <strong className="text-slate-900">{inr(v.total_with_gst)}</strong>
                                      </span>
                                    </div>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left text-muted-foreground">
                                          <th className="px-3 py-1.5 font-semibold">PO</th>
                                          <th className="px-3 py-1.5 font-semibold">Item</th>
                                          <th className="px-3 py-1.5 font-semibold text-right">Qty</th>
                                          <th className="px-3 py-1.5 font-semibold text-right">Rate</th>
                                          <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {v.items.map((it, i) => (
                                          <tr key={i}>
                                            <td className="px-3 py-1.5 font-mono text-slate-500">{it.po_number}</td>
                                            <td className="px-3 py-1.5">{it.item_name}</td>
                                            <td className="px-3 py-1.5 text-right">{it.qty}</td>
                                            <td className="px-3 py-1.5 text-right">{inr(it.rate)}</td>
                                            <td className="px-3 py-1.5 text-right font-medium">{inr(it.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total on screen</td>
                    <td className="px-3 py-2 text-right" data-testid="text-approvals-total">{inr(totalOnScreen)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRejectTarget(null)}>
          <div className="bg-card border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} data-testid="dialog-reject-batch">
            <h2 className="text-lg font-bold mb-1">Reject {rejectTarget.slip_number}</h2>
            <p className="text-sm text-muted-foreground mb-3">
              {inr(rejectTarget.grand_total_snapshot)} across {rejectTarget.vendor_count} vendor(s). The team member sees this reason on the slip.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Why is this slip being rejected?"
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm"
              data-testid="input-reject-reason"
            />
            {reasonTooShort && rejectReason.length > 0 && (
              <div className="text-xs text-rose-600 mt-1">Reason must be at least 5 characters.</div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejectTarget(null)} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button
                onClick={() => decide(rejectTarget, "reject", rejectReason.trim())}
                disabled={reasonTooShort || busyId === rejectTarget.batch_id}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-40"
                data-testid="button-confirm-reject"
              >
                Reject Slip
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
