import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { SalesAuth } from "@/lib/role-auth";
import NotificationsBell from "@/components/NotificationsBell";
import { Target, KanbanSquare, CheckSquare, MapPin, Camera, Mail, MessageCircle } from "lucide-react";

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
    </RolePortalShell>
  );
}

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

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
    </div>
  );
}

function TargetsTab() {
  const { token } = SalesAuth.useAuth();
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [claimFor, setClaimFor] = useState<SalesTarget | null>(null);
  const [poId, setPoId] = useState("");
  const [onboardFor, setOnboardFor] = useState<SalesTarget | null>(null);
  const [onboardPo, setOnboardPo] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/targets");
    if (r.ok) setTargets(await r.json()); else setTargets([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function claim() {
    if (!token || !claimFor) return;
    const id = parseInt(poId, 10);
    if (!id) { alert("Enter a PO ID."); return; }
    setBusy(true);
    try {
      const r = await SalesAuth.roleFetch(token, `/api/sales/targets/${claimFor.id}/claim-po`, { method: "POST", body: JSON.stringify({ po_id: id }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Claim failed"); return; }
      setClaimFor(null); setPoId(""); load();
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

  if (targets.length === 0) return <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No active targets.</div>;
  return (
    <div className="space-y-6">
      {groupKeys.map((g) => (
        <div key={g} className="border rounded-xl p-4 bg-muted/20">
          <div className="font-bold text-sm mb-3">{g}</div>
          <div className="grid sm:grid-cols-3 gap-3">
            {groups[g].map((t) => <TargetCard key={t.id} t={t} onClaim={(x) => { setClaimFor(x); setPoId(""); }} />)}
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
            <h2 className="font-bold text-lg mb-1">Claim PO</h2>
            <p className="text-xs text-muted-foreground mb-4">Enter the ID of a shipped PO for a customer assigned to you.</p>
            <input value={poId} onChange={(e) => setPoId(e.target.value)} placeholder="PO ID" type="number" className="w-full border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-claim-po-id" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setClaimFor(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={claim} disabled={busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-confirm-claim">{busy ? "Claiming…" : "Claim"}</button>
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
const TASK_STATUSES = ["pending", "processing", "standby", "complete", "open", "doing", "done"];
function TasksTab() {
  const { token } = SalesAuth.useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);

  async function load() {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, "/api/sales/tasks");
    if (r.ok) setTasks(await r.json()); else setTasks([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function setStatus(id: number, status: string) {
    if (!token) return;
    const r = await SalesAuth.roleFetch(token, `/api/sales/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  if (tasks.length === 0) return <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No tasks assigned to you.</div>;
  return (
    <div className="bg-card border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-left">
          <th className="px-4 py-3 font-semibold">Task</th><th className="px-4 py-3 font-semibold">Priority</th>
          <th className="px-4 py-3 font-semibold">Deadline</th><th className="px-4 py-3 font-semibold">File</th>
          <th className="px-4 py-3 font-semibold">Status</th>
        </tr></thead>
        <tbody className="divide-y">{tasks.map((t) => (
          <tr key={t.id} data-testid={`sales-task-${t.id}`}>
            <td className="px-4 py-3"><div className="font-semibold">{t.title}</div>{t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}</td>
            <td className="px-4 py-3 text-xs">{t.priority}</td>
            <td className="px-4 py-3 text-xs">{t.deadline || "—"}</td>
            <td className="px-4 py-3 text-xs">{t.fileUrl ? <a href={t.fileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Open</a> : "—"}</td>
            <td className="px-4 py-3">
              <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} className="text-xs font-bold rounded px-2 py-1 border bg-background" data-testid={`select-sales-task-status-${t.id}`}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </td>
          </tr>
        ))}</tbody>
      </table>
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
