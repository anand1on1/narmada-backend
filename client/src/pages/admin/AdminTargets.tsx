import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

interface Target { id: number; userId: number | null; period: string; periodKey: string; metric: string; targetValue: number; currentValue: number; }
interface Customer { id: number; name: string; }
interface TeamUser { id: number; name: string | null; username: string; role: string; }

const METRICS = ["quotations", "po_value", "leads_won"];
const EMPTY: Partial<Target> = { period: "month", periodKey: new Date().toISOString().slice(0, 7), metric: "quotations", targetValue: 0 };

export default function AdminTargets() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Target> | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["admin-customers-dropdown"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/customers`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const { data: teamUsers = [] } = useQuery<TeamUser[]>({
    queryKey: ["admin-team-users-dropdown"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/data-team-users`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const salesUsers = teamUsers.filter((u) => u.role === "sales" || u.role === "data_team");

  const { data: targets = [] } = useQuery<Target[]>({
    queryKey: ["admin-targets"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/targets`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (t: Partial<Target>) => {
      const url = t.id ? `/api/admin/targets/${t.id}` : `/api/admin/targets`;
      const r = await adminFetch(token, url, { method: t.id ? "PATCH" : "POST", body: JSON.stringify({ ...t, targetValue: Number(t.targetValue), userId: t.userId ? Number(t.userId) : null }) });
      if (!r.ok) throw new Error("Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-targets"] }); setEditing(null); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/targets/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-targets"] }); toast({ title: "Deleted" }); },
  });

  // R26.6a (9) — Sales rep value-targets (the sales_targets table the rep portal reads via
  // /api/sales/targets). Admin previously had NO UI writing to this table, so reps never saw a
  // target. This block creates rows keyed by sales_rep_user_id so the assigned rep can see them.
  type SalesTargetForm = {
    sales_rep_user_id: string; metric: string; target_type: string; customer_id: string;
    period_start: string; period_end: string; target_amount: string; lead_ids: number[];
  };
  const [salesTargetEdit, setSalesTargetEdit] = useState<SalesTargetForm | null>(null);
  const { data: salesTargets = [] } = useQuery<any[]>({
    queryKey: ["admin-sales-targets"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/sales-targets`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ["admin-leads-for-targets"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/leads`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const saveSalesTarget = useMutation({
    mutationFn: async (t: SalesTargetForm) => {
      if (!t.sales_rep_user_id) throw new Error("Pick a sales rep");
      if (t.metric !== "onboarding" && !t.customer_id) throw new Error("Pick a customer");
      if (t.metric === "onboarding" && t.lead_ids.length === 0) throw new Error("Pick at least one lead");
      const body: any = {
        sales_rep_user_id: Number(t.sales_rep_user_id),
        metric: t.metric,
        target_type: t.target_type,
        period_start: t.period_start || null,
        period_end: t.period_end || null,
        target_amount: Number(t.target_amount || 0),
      };
      if (t.metric === "onboarding") body.lead_ids = t.lead_ids;
      else body.customer_id = Number(t.customer_id);
      const r = await adminFetch(token, `/api/admin/sales-targets`, { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-sales-targets"] }); setSalesTargetEdit(null); toast({ title: "Sales target assigned" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-compute period dates for the chosen target type.
  function computePeriod(type: string): { start: string; end: string } {
    const d = new Date();
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    if (type === "weekly") {
      const day = d.getDay(); const monday = new Date(d); monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { start: iso(monday), end: iso(sunday) };
    }
    if (type === "quarterly") {
      const q = Math.floor(d.getMonth() / 3); const start = new Date(d.getFullYear(), q * 3, 1);
      const end = new Date(d.getFullYear(), q * 3 + 3, 0);
      return { start: iso(start), end: iso(end) };
    }
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: iso(start), end: iso(end) };
  }
  const delSalesTarget = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/sales-targets/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-sales-targets"] }); toast({ title: "Deleted" }); },
  });
  const verifyOnboarding = useMutation({
    mutationFn: async (id: number) => { const r = await adminFetch(token, `/api/admin/sales-targets/${id}/verify-onboarding`, { method: "POST" }); if (!r.ok) throw new Error("Verify failed"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-sales-targets"] }); toast({ title: "Onboarding verified" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const repName = (id: number | null) => salesUsers.find((u) => u.id === id)?.name || salesUsers.find((u) => u.id === id)?.username || (id == null ? "—" : `#${id}`);

  // R26.6g — A1/A2: pending PO + payment claims awaiting admin approval.
  const { data: pendingClaims = [] } = useQuery<any[]>({
    queryKey: ["admin-target-claims-pending"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/target-claims?status=pending_admin_approval`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const approveClaim = useMutation({
    mutationFn: async (id: number) => { const r = await adminFetch(token, `/api/admin/target-claims/${id}/approve`, { method: "POST" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Approve failed"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-target-claims-pending"] }); qc.invalidateQueries({ queryKey: ["admin-sales-targets"] }); toast({ title: "Claim approved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectClaim = useMutation({
    mutationFn: async (id: number) => {
      const reason = prompt("Reason for rejection (optional):") || undefined;
      const r = await adminFetch(token, `/api/admin/target-claims/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Reject failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-target-claims-pending"] }); qc.invalidateQueries({ queryKey: ["admin-sales-targets"] }); toast({ title: "Claim rejected" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const claimDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("en-IN") : "—");

  return (
    <AdminLayout title="Targets">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ ...EMPTY })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Target
        </button>
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {targets.length === 0 ? <div className="p-12 text-center text-muted-foreground">No targets set.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Period</th>
              <th className="px-3 py-3 font-semibold">Metric</th>
              <th className="px-3 py-3 font-semibold text-right">Target</th>
              <th className="px-3 py-3 font-semibold">Progress</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{targets.map((t) => {
              const pct = t.targetValue > 0 ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0;
              return (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3">{t.periodKey} <span className="text-xs text-muted-foreground">({t.period})</span></td>
                  <td className="px-3 py-3">{t.metric}</td>
                  <td className="px-3 py-3 text-right font-semibold">{t.targetValue.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-3 w-48">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => { if (confirm("Delete target?")) del.mutate(t.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      {/* R26.6a (9) — Sales rep value-targets (read by the sales portal). */}
      <div className="flex items-center justify-between mt-10 mb-4">
        <h2 className="font-display text-lg font-bold">Sales Rep Targets</h2>
        <button onClick={() => { const p = computePeriod("monthly"); setSalesTargetEdit({ sales_rep_user_id: "", metric: "po", target_type: "monthly", customer_id: "", period_start: p.start, period_end: p.end, target_amount: "", lead_ids: [] }); }} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2" data-testid="button-add-sales-target">
          <Plus className="w-4 h-4" /> Assign Sales Target
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Value-based targets assigned to a specific sales rep. The rep sees these in their portal and claims shipped POs against them.</p>
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {salesTargets.length === 0 ? <div className="p-12 text-center text-muted-foreground">No sales targets assigned.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Customer / Lead</th>
              <th className="px-3 py-3 font-semibold">Rep</th>
              <th className="px-3 py-3 font-semibold">Metric</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold text-right">Target</th>
              <th className="px-3 py-3 font-semibold text-right">Achieved</th>
              <th className="px-3 py-3 font-semibold">Period</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{salesTargets.map((t: any) => (
              <tr key={t.id} className="hover:bg-muted/30" data-testid={`sales-target-row-${t.id}`}>
                <td className="px-3 py-3 font-semibold">{t.customer_name || t.lead_name || "—"}</td>
                <td className="px-3 py-3">{repName(t.sales_rep_user_id)}</td>
                <td className="px-3 py-3 text-xs uppercase">{t.metric || "po"}</td>
                <td className="px-3 py-3 text-xs">{t.target_type}</td>
                <td className="px-3 py-3 text-right font-semibold">₹{Number(t.target_amount || 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-3 text-right">{t.metric === "onboarding" ? (t.onboarding_status || "pending") : `₹${Number(t.achieved_computed ?? t.achieved_amount ?? 0).toLocaleString("en-IN")}`}</td>
                <td className="px-3 py-3 text-xs">{t.period_start || "?"} → {t.period_end || "?"}</td>
                <td className="px-3 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700">{t.metric === "onboarding" ? (t.onboarding_status || "pending") : t.status}</span></td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {t.metric === "onboarding" && t.onboarding_status !== "verified" && (
                    <button onClick={() => verifyOnboarding.mutate(t.id)} className="px-2 py-1 mr-1 rounded border text-[11px] font-semibold text-emerald-700" data-testid={`button-verify-onboarding-${t.id}`}>Verify</button>
                  )}
                  <button onClick={() => { if (confirm("Delete sales target?")) delSalesTarget.mutate(t.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" data-testid={`button-delete-sales-target-${t.id}`}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* R26.6g — A1/A2: Pending PO + Payment claims awaiting admin approval. */}
      <div className="flex items-center justify-between mt-10 mb-4">
        <h2 className="font-display text-lg font-bold">Pending Claims</h2>
        {pendingClaims.length > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700">{pendingClaims.length} awaiting</span>}
      </div>
      <p className="text-xs text-muted-foreground mb-3">PO claims with an unrecognized PO number and all payment claims land here for verification. Approving credits the rep's target.</p>
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {pendingClaims.length === 0 ? <div className="p-12 text-center text-muted-foreground">No pending claims.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Rep</th>
              <th className="px-3 py-3 font-semibold">Type</th>
              <th className="px-3 py-3 font-semibold">Customer</th>
              <th className="px-3 py-3 font-semibold">PO / Reference</th>
              <th className="px-3 py-3 font-semibold text-right">Amount</th>
              <th className="px-3 py-3 font-semibold">Date</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{pendingClaims.map((c: any) => (
              <tr key={c.id} className="hover:bg-muted/30" data-testid={`pending-claim-${c.id}`}>
                <td className="px-3 py-3">{c.rep_name}</td>
                <td className="px-3 py-3 text-xs uppercase font-semibold">{c.type === "payment" ? "Payment" : "PO"}</td>
                <td className="px-3 py-3">{c.customer_name || "—"}</td>
                <td className="px-3 py-3 font-mono text-xs">{c.type === "payment" ? (c.reference_no || "—") : (c.po_number || "—")}</td>
                <td className="px-3 py-3 text-right font-semibold">₹{Number(c.amount || 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-3 text-xs">{claimDate(c.claim_date || c.created_at)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <button onClick={() => approveClaim.mutate(c.id)} disabled={approveClaim.isPending} className="px-2.5 py-1 mr-1 rounded border text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50" data-testid={`button-approve-claim-${c.id}`}>Approve</button>
                  <button onClick={() => rejectClaim.mutate(c.id)} disabled={rejectClaim.isPending} className="px-2.5 py-1 rounded border text-[11px] font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50" data-testid={`button-reject-claim-${c.id}`}>Reject</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {salesTargetEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSalesTargetEdit(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Assign Sales Target</h2>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <label className="text-xs font-semibold block">Sales Rep
                <select value={salesTargetEdit.sales_rep_user_id} onChange={(e) => setSalesTargetEdit({ ...salesTargetEdit, sales_rep_user_id: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="select-sales-target-rep">
                  <option value="">— Select a sales rep —</option>
                  {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name || u.username} ({u.role})</option>)}
                </select></label>
              <div>
                <div className="text-xs font-semibold mb-1">Metric</div>
                <div className="flex flex-wrap gap-2">
                  {["po", "quotation", "payment", "onboarding"].map((m) => (
                    <label key={m} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${salesTargetEdit.metric === m ? "border-accent bg-accent/10" : ""}`}>
                      <input type="radio" className="hidden" checked={salesTargetEdit.metric === m} onChange={() => setSalesTargetEdit({ ...salesTargetEdit, metric: m })} data-testid={`radio-metric-${m}`} />
                      {m === "po" ? "PO" : m.charAt(0).toUpperCase() + m.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              {salesTargetEdit.metric !== "onboarding" ? (
                <label className="text-xs font-semibold block">Customer
                  <select value={salesTargetEdit.customer_id} onChange={(e) => setSalesTargetEdit({ ...salesTargetEdit, customer_id: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="select-sales-target-customer">
                    <option value="">— Select a customer —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
              ) : (
                <div>
                  <div className="text-xs font-semibold mb-1">Leads to onboard (creates one target per lead)</div>
                  <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                    {leads.length === 0 ? <div className="text-xs text-muted-foreground">No leads.</div> : leads.map((l: any) => (
                      <label key={l.id} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={salesTargetEdit.lead_ids.includes(l.id)} onChange={(e) => {
                          const ids = e.target.checked ? [...salesTargetEdit.lead_ids, l.id] : salesTargetEdit.lead_ids.filter((x) => x !== l.id);
                          setSalesTargetEdit({ ...salesTargetEdit, lead_ids: ids });
                        }} data-testid={`checkbox-lead-${l.id}`} />
                        {l.name} {l.phone ? <span className="text-muted-foreground">· {l.phone}</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="text-xs font-semibold block">Target Type
                <select value={salesTargetEdit.target_type} onChange={(e) => { const p = computePeriod(e.target.value); setSalesTargetEdit({ ...salesTargetEdit, target_type: e.target.value, period_start: p.start, period_end: p.end }); }} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="select-sales-target-type">
                  <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="quarterly">Quarterly</option>
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold block">Period Start
                  <input type="date" value={salesTargetEdit.period_start} onChange={(e) => setSalesTargetEdit({ ...salesTargetEdit, period_start: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
                <label className="text-xs font-semibold block">Period End
                  <input type="date" value={salesTargetEdit.period_end} onChange={(e) => setSalesTargetEdit({ ...salesTargetEdit, period_end: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              </div>
              {salesTargetEdit.metric !== "onboarding" && (
                <label className="text-xs font-semibold block">Target Amount (₹)
                  <input type="number" value={salesTargetEdit.target_amount} onChange={(e) => setSalesTargetEdit({ ...salesTargetEdit, target_amount: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-sales-target-amount" /></label>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setSalesTargetEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => saveSalesTarget.mutate(salesTargetEdit)} disabled={saveSalesTarget.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-save-sales-target">Save</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">New Target</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Period
                <select value={editing.period} onChange={(e) => setEditing({ ...editing, period: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                  <option value="month">Month</option><option value="quarter">Quarter</option>
                </select></label>
              <label className="text-xs font-semibold block">Period Key (e.g. 2026-06)
                <input value={editing.periodKey} onChange={(e) => setEditing({ ...editing, periodKey: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Metric
                <select value={editing.metric} onChange={(e) => setEditing({ ...editing, metric: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                  {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
              <label className="text-xs font-semibold block">Target Value
                <input type="number" value={editing.targetValue} onChange={(e) => setEditing({ ...editing, targetValue: Number(e.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Assign To (Sales User, optional)
                <select value={editing.userId || ""} onChange={(e) => setEditing({ ...editing, userId: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                  <option value="">— Company-wide (no specific user) —</option>
                  {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name || u.username} ({u.role})</option>)}
                </select></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={save.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
