import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { SalesAuth } from "@/lib/role-auth";
import NotificationsBell from "@/components/NotificationsBell";
import { Target, KanbanSquare, CheckSquare, MapPin, Camera, Mail, MessageCircle, Wallet, Plus, Trash2 } from "lucide-react";

// R26.6a (8) — open the marketing composer targeted at a single lead.
function composeForLead(id: number, channel: "email" | "whatsapp") {
  window.location.hash = `#/admin/marketing/campaigns/new?compose=1&channel=${channel}&lead_id=${id}`;
}

// R26.5 (G) — Sales rep portal. Four tabs over the /api/sales/* mirror endpoints:
// Targets (claim shipped POs), Leads Kanban (move stage via dropdown — no DnD lib),
// Tasks (own list + status), Check-in (attendance + GPS/photo visit log).
const TABS = [
  { key: "targets", label: "Targets", icon: Target },
  { key: "leads", label: "Leads", icon: KanbanSquare },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "checkin", label: "Check-in", icon: MapPin },
  { key: "expenses", label: "Expenses", icon: Wallet },
] as const;
type TabKey = typeof TABS[number]["key"];

export default function SalesDashboard() {
  const { token } = SalesAuth.useAuth();
  const [tab, setTab] = useState<TabKey>("targets");

  return (
    <RolePortalShell title="Sales Portal" accent="text-amber-600" icon={Target} auth={SalesAuth} loginPath="/sales/login"
      right={<NotificationsBell roleFetch={SalesAuth.roleFetch} token={token} />}>
      <div className="flex gap-1 mb-5 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px transition ${tab === t.key ? "border-amber-500 text-amber-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            data-testid={`tab-${t.key}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "targets" && <TargetsTab />}
      {tab === "leads" && <LeadsKanbanTab />}
      {tab === "tasks" && <TasksTab />}
      {tab === "checkin" && <CheckinTab />}
      {tab === "expenses" && <ExpensesTab />}
    </RolePortalShell>
  );
}

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// ---- R27.29 My Monthly Progress card ----
interface CatProg { target: number; achieved: number; remaining: number; pct: number; }
interface MyProgress {
  salesperson: { id: number; name: string };
  payments: CatProg; purchase_orders: CatProg; onboarding: CatProg;
  days_left: number; status: "on_track" | "behind";
  month_name?: string;
}
function ProgressTile({ title, c, isCount = false }: { title: string; c: CatProg; isCount?: boolean }) {
  const val = (n: number) => (isCount ? String(n) : inr(n));
  const barPct = Math.min(100, Math.max(0, c.pct));
  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="text-xs uppercase font-bold text-muted-foreground mb-1">{title}</div>
      <div className="text-lg font-bold">{val(c.achieved)} <span className="text-sm font-normal text-muted-foreground">/ {val(c.target)}</span></div>
      <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden"><div className={`h-full ${barPct >= 90 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${barPct}%` }} /></div>
      <div className="text-xs text-muted-foreground mt-1">{c.pct}% · remaining {val(c.remaining)}</div>
    </div>
  );
}
function MyProgressCard() {
  const { token } = SalesAuth.useAuth();
  const [p, setP] = useState<MyProgress | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await SalesAuth.roleFetch(token, "/api/sales/my-progress");
        if (r.ok) {
          const j = await r.json();
          if (j?.progress) setP({ ...j.progress, month_name: j.month_name });
        }
      } finally { setLoaded(true); }
    })();
  }, [token]);
  if (!loaded || !p) return null;
  const monthName = p.month_name || new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <div className="border rounded-xl p-4 bg-muted/20 mb-6" data-testid="my-progress-card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-bold text-sm">My Monthly Progress — {monthName}</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground"><b>{p.days_left}</b> day(s) left</span>
          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${p.status === "on_track" ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}`} data-testid="my-progress-status">
            {p.status === "on_track" ? "On track" : "Behind"}
          </span>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <ProgressTile title="Payments Collected" c={p.payments} />
        <ProgressTile title="Purchase Orders" c={p.purchase_orders} />
        <ProgressTile title="Onboarding" c={p.onboarding} isCount />
      </div>
    </div>
  );
}

// ---- Targets ----
interface Achievement { id: number; po_id: number; amount: number; admin_approved: number; }
interface SalesTarget {
  id: number; target_type: string; metric?: string; customer_id?: number | null; customer_name?: string | null;
  lead_id?: number | null; lead_name?: string | null; lead_phone?: string | null; lead_email?: string | null;
  lead_contact_person?: string | null; onboarding_status?: string | null; submitted_po_number?: string | null;
  period_start: string | null; period_end: string | null;
  target_amount: number; achieved_amount: number; achieved_computed?: number; status: string; achievements?: Achievement[];
}
const METRIC_LABEL: Record<string, string> = { po: "PO", quotation: "Quotation", payment: "Payment", onboarding: "Onboarding" };

function TargetCard({ t, onClaim }: { t: SalesTarget; onClaim: (t: SalesTarget) => void }) {
  const achieved = t.achieved_computed != null ? t.achieved_computed : t.achieved_amount;
  const pct = t.target_amount ? Math.min(100, Math.round((achieved / t.target_amount) * 100)) : 0;
  const barColor = t.metric === "quotation" ? "bg-sky-500" : t.metric === "payment" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="bg-card border rounded-xl p-4" data-testid={`target-${t.id}`}>
      <div className="flex justify-between items-start mb-1">
        <div className="text-xs uppercase font-bold text-muted-foreground">{METRIC_LABEL[t.metric || "po"]}</div>
        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700">{t.target_type}</span>
      </div>
      <div className="text-[11px] text-muted-foreground mb-1">{t.period_start || "?"} → {t.period_end || "?"}</div>
      <div className="text-xl font-bold">{inr(achieved)} <span className="text-sm font-normal text-muted-foreground">/ {inr(t.target_amount)}</span></div>
      <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden"><div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} /></div>
      <div className="text-xs text-muted-foreground mt-1">{pct}% achieved</div>
      {t.metric === "po" && <button onClick={() => onClaim(t)} className="mt-3 px-3 py-1.5 border rounded-lg text-sm font-semibold" data-testid={`button-claim-po-${t.id}`}>Claim a PO</button>}
      {t.metric === "payment" && <button onClick={() => onClaim(t)} className="mt-3 px-3 py-1.5 border rounded-lg text-sm font-semibold" data-testid={`button-submit-payment-${t.id}`}>Submit Payment</button>}
    </div>
  );
}

function TargetsTab() {
  const { token } = SalesAuth.useAuth();
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  // R26.6g — claim modal handles both PO (po_number + amount) and Payment
  // (payment_date + reference_no + amount) targets via /api/sales/targets/:id/claim.
  const [claimFor, setClaimFor] = useState<SalesTarget | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [onboardFor, setOnboardFor] = useState<SalesTarget | null>(null);
  const [onboardPo, setOnboardPo] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/targets");
    if (r.ok) setTargets(await r.json()); else setTargets([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  function openClaim(t: SalesTarget) {
    setClaimFor(t); setPoNumber(""); setClaimAmount(""); setPaymentDate(""); setReferenceNo("");
  }

  async function claim() {
    if (!token || !claimFor) return;
    const isPayment = claimFor.metric === "payment";
    const amount = Number(claimAmount);
    if (!amount || amount <= 0) { alert("Enter a valid amount."); return; }
    let body: any;
    if (isPayment) {
      if (!paymentDate) { alert("Payment date is required."); return; }
      body = { type: "payment", payment_date: paymentDate, reference_no: referenceNo.trim() || null, amount };
    } else {
      if (!poNumber.trim()) { alert("Enter a PO number."); return; }
      body = { type: "po", po_number: poNumber.trim(), amount };
    }
    setBusy(true);
    try {
      const r = await SalesAuth.roleFetch(token, `/api/sales/targets/${claimFor.id}/claim`, { method: "POST", body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Claim failed"); return; }
      alert(j.auto_approved ? "PO matched — claim auto-approved and credited!" : "Submitted — awaiting admin approval.");
      setClaimFor(null); load();
    } finally { setBusy(false); }
  }

  async function submitOnboarding() {
    if (!token || !onboardFor) return;
    if (!onboardPo.trim()) { alert("Enter a PO number."); return; }
    setBusy(true);
    try {
      const r = await SalesAuth.roleFetch(token, `/api/sales/targets/${onboardFor.id}/submit-onboarding-po`, { method: "POST", body: JSON.stringify({ po_number: onboardPo.trim() }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Submit failed"); return; }
      setOnboardFor(null); setOnboardPo("");
      alert(j.target?.onboarding_status === "verified" ? "Verified! PO matched a customer assigned to you." : "PO submitted — awaiting admin verification.");
      load();
    } finally { setBusy(false); }
  }

  const valueTargets = targets.filter((t) => (t.metric || "po") !== "onboarding");
  const onboardingTargets = targets.filter((t) => t.metric === "onboarding");

  // Group value targets by customer name (uncustomered targets fall under "General").
  const groups: Record<string, SalesTarget[]> = {};
  for (const t of valueTargets) {
    const key = t.customer_name || "General";
    (groups[key] = groups[key] || []).push(t);
  }
  const groupKeys = Object.keys(groups);

  if (targets.length === 0) return (
    <div className="space-y-6">
      <MyProgressCard />
      <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No active targets.</div>
    </div>
  );
  return (
    <div className="space-y-6">
      <MyProgressCard />
      {groupKeys.map((g) => (
        <div key={g} className="border rounded-xl p-4 bg-muted/20">
          <div className="font-bold text-sm mb-3">{g}</div>
          <div className="grid sm:grid-cols-3 gap-3">
            {groups[g].map((t) => <TargetCard key={t.id} t={t} onClaim={openClaim} />)}
          </div>
        </div>
      ))}

      {onboardingTargets.length > 0 && (
        <div className="border rounded-xl p-4 bg-muted/20">
          <div className="font-bold text-sm mb-3">Onboarding Targets</div>
          <div className="space-y-2">
            {onboardingTargets.map((t) => (
              <div key={t.id} className="bg-card border rounded-lg p-3 flex items-center justify-between gap-3" data-testid={`onboarding-target-${t.id}`}>
                <div>
                  <div className="font-semibold text-sm">{t.lead_name || `Lead #${t.lead_id}`}</div>
                  <div className="text-xs text-muted-foreground">{t.lead_contact_person ? `${t.lead_contact_person} · ` : ""}{t.lead_phone || ""}{t.lead_email ? ` · ${t.lead_email}` : ""}</div>
                  {t.submitted_po_number && <div className="text-[11px] text-muted-foreground mt-0.5">PO: {t.submitted_po_number}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${t.onboarding_status === "verified" ? "bg-emerald-500/15 text-emerald-700" : t.onboarding_status === "po_submitted" ? "bg-amber-500/15 text-amber-700" : "bg-slate-500/15 text-slate-600"}`}>{t.onboarding_status || "pending"}</span>
                  {t.onboarding_status !== "verified" && (
                    <button onClick={() => { setOnboardFor(t); setOnboardPo(""); }} className="px-3 py-1.5 border rounded-lg text-xs font-semibold" data-testid={`button-onboard-${t.id}`}>Mark Onboarded</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {claimFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setClaimFor(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            {claimFor.metric === "payment" ? (
              <>
                <h2 className="font-bold text-lg mb-1">Submit Payment</h2>
                <p className="text-xs text-muted-foreground mb-4">Payment claims are verified by an admin before being credited.</p>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold">Payment Date *
                    <input value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} type="date" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-payment-date" /></label>
                  <label className="block text-xs font-semibold">Reference Number (optional)
                    <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="UTR / cheque no." className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-payment-reference" /></label>
                  <label className="block text-xs font-semibold">Amount (₹) *
                    <input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} type="number" placeholder="0" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-payment-amount" /></label>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-bold text-lg mb-1">Claim a PO</h2>
                <p className="text-xs text-muted-foreground mb-4">Matching PO numbers auto-approve and credit instantly; others go to admin review.</p>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold">PO Number *
                    <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. NM/PO/26/0001" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-claim-po-number" /></label>
                  <label className="block text-xs font-semibold">Amount (₹) *
                    <input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} type="number" placeholder="0" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-claim-amount" /></label>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setClaimFor(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={claim} disabled={busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-confirm-claim">{busy ? "Submitting…" : "Submit"}</button>
            </div>
          </div>
        </div>
      )}
      {onboardFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOnboardFor(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Mark Onboarded</h2>
            <p className="text-xs text-muted-foreground mb-4">Enter the PO number this lead placed. If it matches a customer assigned to you, it auto-verifies.</p>
            <input value={onboardPo} onChange={(e) => setOnboardPo(e.target.value)} placeholder="PO number (e.g. NM/PO/26/0001)" className="w-full border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-onboard-po" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOnboardFor(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={submitOnboarding} disabled={busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-confirm-onboard">{busy ? "Submitting…" : "Submit"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Leads Kanban ----
interface KanbanLead { id: number; name: string; phone: string | null; city: string | null; stage: string; }
interface KanbanCol { stage_name: string; count: number; leads: KanbanLead[]; }
interface Stage { id: number; name: string; }
function LeadsKanbanTab() {
  const { token } = SalesAuth.useAuth();
  const [cols, setCols] = useState<KanbanCol[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/leads/kanban");
    if (r.ok) { const j = await r.json(); setCols(Array.isArray(j?.stages) ? j.stages : []); } else setCols([]);
    const rs = await SalesAuth.roleFetch(token, "/api/admin/lead-stages");
    if (rs.ok) setStages(await rs.json());
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function move(leadId: number, stage: string) {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, `/api/sales/leads/${leadId}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
    if (!r.ok) { alert((await r.json()).error || "Move failed"); return; }
    load();
  }

  if (cols.length === 0) return <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No leads assigned to you.</div>;
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {cols.map((col) => (
        <div key={col.stage_name} className="flex-shrink-0 w-72 bg-muted/40 rounded-xl p-3" data-testid={`kanban-col-${col.stage_name}`}>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex justify-between"><span>{col.stage_name}</span><span>{col.count}</span></div>
          <div className="space-y-2">
            {col.leads.map((l) => (
              <div key={l.id} className="bg-card border rounded-lg p-3 shadow-sm" data-testid={`kanban-lead-${l.id}`}>
                <div className="font-semibold text-sm">{l.name}</div>
                <div className="text-xs text-muted-foreground">{l.phone || ""}{l.city ? ` · ${l.city}` : ""}</div>
                <select value={l.stage} onChange={(e) => move(l.id, e.target.value)} className="mt-2 w-full border rounded px-2 py-1 text-xs bg-background" data-testid={`select-move-lead-${l.id}`}>
                  {stages.map((s) => <option key={s.id} value={s.name}>Move to: {s.name}</option>)}
                </select>
                <div className="mt-2 flex items-center gap-1">
                  <button onClick={() => composeForLead(l.id, "email")} className="p-1.5 rounded hover:bg-indigo-500/10 text-indigo-600" title="Email via Marketing" data-testid={`button-email-lead-${l.id}`}><Mail className="w-3.5 h-3.5" /></button>
                  <button onClick={() => composeForLead(l.id, "whatsapp")} className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-600" title="WhatsApp via Marketing" data-testid={`button-whatsapp-lead-${l.id}`}><MessageCircle className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Tasks ----
interface Task { id: number; title: string; description: string | null; status: string; priority: string; deadline: string | null; fileUrl: string | null; }
interface Remark { id: number; user_name: string | null; body: string; created_at: number; }
const TASK_STATUSES = ["pending", "processing", "standby", "complete", "open", "doing", "done"];
const CLOSED_STATUSES = new Set(["closed", "complete", "completed", "done"]);
const isClosed = (s: string) => CLOSED_STATUSES.has(String(s || "").toLowerCase());

function TaskRow({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { token } = SalesAuth.useAuth();
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = isClosed(task.status);

  async function loadRemarks() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, `/api/sales/tasks/${task.id}/remarks`);
    if (r.ok) setRemarks(await r.json()); else setRemarks([]);
  }
  useEffect(() => { loadRemarks(); }, [token, task.id]); // eslint-disable-line

  async function setStatus(status: string) {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, `/api/sales/tasks/${task.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Failed"); return; }
    onChanged();
  }
  async function addRemark() {
    if (!token || !draft.trim()) return;
    setBusy(true);
    try {
      const r = await SalesAuth.roleFetch(token, `/api/sales/tasks/${task.id}/remarks`, { method: "POST", body: JSON.stringify({ body: draft.trim() }) });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Failed"); return; }
      setDraft(""); loadRemarks();
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-card border rounded-xl p-4" data-testid={`sales-task-${task.id}`}>
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="font-semibold">{task.title}{locked && <span className="ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-500/15 text-slate-600" data-testid={`task-locked-${task.id}`}>Closed (locked)</span>}</div>
          {task.description && <div className="text-xs text-muted-foreground mt-0.5">{task.description}</div>}
          <div className="text-xs text-muted-foreground mt-1">Priority: {task.priority} · Deadline: {task.deadline || "—"}{task.fileUrl ? <> · <a href={task.fileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">File</a></> : null}</div>
        </div>
        <select value={task.status} disabled={locked} onChange={(e) => setStatus(e.target.value)} className="text-xs font-bold rounded px-2 py-1 border bg-background disabled:opacity-50 disabled:cursor-not-allowed" data-testid={`select-sales-task-status-${task.id}`}>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="mt-3 border-t pt-3">
        <div className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={locked} onKeyDown={(e) => e.key === "Enter" && addRemark()} placeholder={locked ? "Task closed — remarks locked" : "Add update remark…"} className="flex-1 border rounded-lg px-3 py-1.5 bg-background text-sm disabled:opacity-50" data-testid={`input-remark-${task.id}`} />
          <button onClick={addRemark} disabled={locked || busy || !draft.trim()} className="px-3 py-1.5 border rounded-lg text-sm font-semibold disabled:opacity-50" data-testid={`button-remark-${task.id}`}>Update Remark</button>
        </div>
        {remarks.length > 0 && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {remarks.map((rm) => (
              <div key={rm.id} className="text-xs border rounded px-2 py-1" data-testid={`remark-${rm.id}`}>
                <span className="text-muted-foreground">{new Date(rm.created_at).toLocaleString("en-IN")} — </span>
                <span className="font-semibold">{rm.user_name || "Rep"}:</span> {rm.body}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab() {
  const { token } = SalesAuth.useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/tasks");
    if (r.ok) setTasks(await r.json()); else setTasks([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  if (tasks.length === 0) return <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No tasks assigned to you.</div>;
  return (
    <div className="space-y-3">
      {tasks.map((t) => <TaskRow key={t.id} task={t} onChanged={load} />)}
    </div>
  );
}

// ---- Check-in / Attendance + Visit ----
interface Attendance { id: number; checkin_at: string | null; checkout_at: string | null; }
interface Visit { id: number; notes: string | null; photo_url: string | null; created_at: string; }
function CheckinTab() {
  const { token } = SalesAuth.useAuth();
  const [today, setToday] = useState<Attendance | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/attendance/today");
    if (r.ok) setToday(await r.json());
    const rv = await SalesAuth.roleFetch(token, "/api/sales/visits/today");
    if (rv.ok) setVisits(await rv.json()); else setVisits([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function checkin() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/attendance/checkin", { method: "POST", body: JSON.stringify({}) });
    if (r.ok) load(); else alert("Check-in failed");
  }
  async function checkout() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/attendance/checkout", { method: "POST", body: JSON.stringify({}) });
    if (r.ok) load(); else alert("Check-out failed");
  }

  function getGps(): Promise<{ lat?: number; lng?: number }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({}), { timeout: 8000 },
      );
    });
  }

  async function logVisit() {
    if (!token) return;
    setBusy(true);
    try {
      const gps = await getGps();
      const fd = new FormData();
      if (notes) fd.append("notes", notes);
      if (gps.lat != null) fd.append("gps_lat", String(gps.lat));
      if (gps.lng != null) fd.append("gps_lng", String(gps.lng));
      if (photo) fd.append("photo", photo);
      const r = await SalesAuth.roleFetch(token, "/api/sales/visits", { method: "POST", body: fd });
      if (!r.ok) { alert((await r.json()).error || "Visit log failed"); return; }
      setNotes(""); setPhoto(null); load();
    } finally { setBusy(false); }
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="bg-card border rounded-xl p-5">
        <h3 className="font-bold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4" /> Today's Attendance</h3>
        <div className="text-sm space-y-1 mb-4">
          <div>Check-in: <span className="font-semibold">{today?.checkin_at ? new Date(today.checkin_at).toLocaleTimeString("en-IN") : "—"}</span></div>
          <div>Check-out: <span className="font-semibold">{today?.checkout_at ? new Date(today.checkout_at).toLocaleTimeString("en-IN") : "—"}</span></div>
        </div>
        <div className="flex gap-2">
          <button onClick={checkin} disabled={!!today?.checkin_at} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-checkin">Check In</button>
          <button onClick={checkout} disabled={!today?.checkin_at || !!today?.checkout_at} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-checkout">Check Out</button>
        </div>
      </div>
      <div className="bg-card border rounded-xl p-5">
        <h3 className="font-bold mb-3 flex items-center gap-2"><Camera className="w-4 h-4" /> Log a Visit</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Visit notes…" className="w-full border rounded-lg px-3 py-2 bg-background text-sm mb-2" data-testid="input-visit-notes" />
        <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="text-sm mb-3" data-testid="input-visit-photo" />
        <button onClick={logVisit} disabled={busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-log-visit">{busy ? "Logging…" : "Log Visit (with GPS)"}</button>
        <div className="mt-4 space-y-1.5">
          {visits.map((v) => (
            <div key={v.id} className="text-xs border rounded-lg px-3 py-2 flex justify-between" data-testid={`visit-${v.id}`}>
              <span>{v.notes || "(no notes)"}</span>
              <span className="text-muted-foreground">{new Date(v.created_at).toLocaleTimeString("en-IN")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Expenses (R27.0) ----
interface SalesExpense {
  id: number; expense_type: string; expense_date: string; amount: number;
  fields?: any; proof_url?: string | null; notes?: string | null; status: string;
  rejection_reason?: string | null; created_at: string;
}

// Per-type field schemas — keep in sync with the server's documented shapes.
const EXPENSE_TYPE_FIELDS: Record<string, { key: string; label: string }[]> = {
  hotel: [
    { key: "hotel_name", label: "Hotel name" }, { key: "location", label: "Location" },
    { key: "contact", label: "Contact" }, { key: "nights", label: "Nights" },
    { key: "tariff_per_night", label: "Tariff / night" },
  ],
  train: [
    { key: "from_station", label: "From station" }, { key: "to_station", label: "To station" },
    { key: "train_name_no", label: "Train name / no." }, { key: "class", label: "Class" },
    { key: "fare", label: "Fare" },
  ],
  flight: [
    { key: "from_airport", label: "From airport" }, { key: "to_airport", label: "To airport" },
    { key: "airline", label: "Airline" }, { key: "flight_no", label: "Flight no." },
    { key: "fare", label: "Fare" },
  ],
  auto: [
    { key: "from_location", label: "From" }, { key: "to_location", label: "To" },
    { key: "distance_km", label: "Distance (km)" }, { key: "fare", label: "Fare" },
  ],
  meal: [
    { key: "location", label: "Location" }, { key: "restaurant_name", label: "Restaurant" },
    { key: "persons", label: "Persons" },
  ],
  misc: [
    { key: "description", label: "Description" },
  ],
};
const EXPENSE_TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel", train: "Train", flight: "Flight", auto: "Auto / Cab", meal: "Meal", misc: "Misc",
};
const EXPENSE_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700",
  approved: "bg-emerald-500/15 text-emerald-700",
  rejected: "bg-red-500/15 text-red-700",
};

function ExpensesTab() {
  const { token } = SalesAuth.useAuth();
  const [expenses, setExpenses] = useState<SalesExpense[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expenseType, setExpenseType] = useState("hotel");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/expenses");
    if (r.ok) setExpenses(await r.json()); else setExpenses([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  function resetForm() {
    setExpenseType("hotel"); setExpenseDate(new Date().toISOString().slice(0, 10));
    setAmount(""); setFields({}); setNotes(""); setProof(null);
  }

  async function submit() {
    if (!token) return;
    if (!(Number(amount) > 0)) { alert("Enter an amount greater than 0"); return; }
    if (!expenseDate) { alert("Pick a date"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("expense_type", expenseType);
      fd.append("expense_date", expenseDate);
      fd.append("amount", String(Number(amount)));
      fd.append("fields", JSON.stringify(fields));
      if (notes) fd.append("notes", notes);
      if (proof) fd.append("proof", proof);
      const r = await SalesAuth.roleFetch(token, "/api/sales/expenses", { method: "POST", body: fd });
      if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Submit failed"); return; }
      setOpen(false); resetForm(); load();
    } finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!token || !confirm("Delete this pending expense?")) return;
    const r = await SalesAuth.roleFetch(token, `/api/sales/expenses/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json().catch(() => ({}))).error || "Delete failed"); return; }
    load();
  }

  const typeFields = EXPENSE_TYPE_FIELDS[expenseType] || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="font-bold text-sm">My Expenses</div>
        <button onClick={() => { resetForm(); setOpen(true); }} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-1.5" data-testid="button-new-expense">
          <Plus className="w-4 h-4" /> Submit New Expense
        </button>
      </div>

      {expenses.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No expenses submitted yet.</div>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <div key={e.id} className="bg-card border rounded-xl p-3 flex items-center justify-between gap-3" data-testid={`expense-${e.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{EXPENSE_TYPE_LABEL[e.expense_type] || e.expense_type}</span>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${EXPENSE_STATUS_BADGE[e.status] || EXPENSE_STATUS_BADGE.pending}`}>{e.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">{e.expense_date} · {inr(e.amount)}{e.notes ? ` · ${e.notes}` : ""}</div>
                {e.status === "rejected" && e.rejection_reason && <div className="text-xs text-red-600 mt-0.5">Reason: {e.rejection_reason}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.proof_url && <a href={e.proof_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Proof</a>}
                {e.status === "pending" && (
                  <button onClick={() => del(e.id)} className="p-1.5 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-expense-${e.id}`} title="Delete (pending only)"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Submit New Expense</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Expense Type
                <select value={expenseType} onChange={(e) => { setExpenseType(e.target.value); setFields({}); }} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="select-expense-type">
                  {Object.keys(EXPENSE_TYPE_FIELDS).map((t) => <option key={t} value={t}>{EXPENSE_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold block">Date
                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-expense-date" />
              </label>
              {typeFields.map((f) => (
                <label key={f.key} className="text-xs font-semibold block">{f.label}
                  <input value={fields[f.key] || ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid={`input-expense-field-${f.key}`} />
                </label>
              ))}
              <label className="text-xs font-semibold block">Amount (₹)
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-expense-amount" />
              </label>
              <label className="text-xs font-semibold block">Proof (image/PDF)
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] || null)} className="mt-1 w-full text-sm font-normal" data-testid="input-expense-proof" />
              </label>
              <label className="text-xs font-semibold block">Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-expense-notes" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={submit} disabled={busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-submit-expense">{busy ? "Submitting…" : "Submit"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
