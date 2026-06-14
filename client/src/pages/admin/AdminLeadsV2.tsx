import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, getAdminToken } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { Plus, Trash2, Pencil, Download, Settings2, Mail, MessageCircle } from "lucide-react";

// R26.6a (8) — open the marketing composer targeted at a single lead.
function composeForLead(id: number, channel: "email" | "whatsapp") {
  window.location.hash = `#/admin/marketing/campaigns/new?compose=1&channel=${channel}&lead_id=${id}`;
}

// R26.5 (B) — Leads V2 over /api/admin/leads-v2. Stages from /api/admin/lead-stages,
// sales reps from /api/admin/users?role=sales. Export via /api/admin/leads/export.xlsx.
interface Lead {
  id: number; name: string; contact_person: string | null; phone: string | null; email: string | null;
  city: string | null; state: string | null; address: string | null; requirement: string | null;
  stage: string; source: string | null; assigned_to_user_id: number | null; created_at: number;
}
interface Stage { id: number; name: string; position: number; is_default: number; }
interface User { id: number; username: string; name: string | null; role: string; }

export default function AdminLeadsV2() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<Lead[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [reps, setReps] = useState<User[]>([]);
  const [stageF, setStageF] = useState("all");
  const [assignedF, setAssignedF] = useState("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Lead> | null>(null);
  const [manageStages, setManageStages] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadStages() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/lead-stages");
    if (r.ok) setStages(await r.json());
  }
  async function loadReps() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/users?role=sales");
    if (r.ok) setReps(await r.json());
  }
  async function load() {
    if (!token) return;
    const p = new URLSearchParams();
    if (stageF !== "all") p.set("stage", stageF);
    if (assignedF !== "all") p.set("assigned_to", assignedF);
    if (search.trim()) p.set("search", search.trim());
    const r = await adminFetch(token, `/api/admin/leads-v2?${p}`);
    if (r.ok) setItems(await r.json()); else setItems([]);
  }
  useEffect(() => { loadStages(); loadReps(); }, [token]); // eslint-disable-line
  useEffect(() => { load(); }, [token, stageF, assignedF]); // eslint-disable-line

  const repName = (id: number | null) => (id == null ? "—" : (reps.find((u) => u.id === id)?.name || reps.find((u) => u.id === id)?.username || `#${id}`));

  async function save() {
    if (!token || !edit) return;
    if (!edit.name?.trim()) { alert("Lead name is required."); return; }
    setBusy(true);
    try {
      const body = JSON.stringify({
        name: edit.name, contact_person: edit.contact_person, phone: edit.phone, email: edit.email,
        city: edit.city, state: edit.state, address: edit.address, requirement: edit.requirement,
        stage: edit.stage || (stages[0]?.name ?? "New"), source: edit.source || "manual",
        assigned_to_user_id: edit.assigned_to_user_id ?? null,
      });
      const isNew = !edit.id;
      const r = await adminFetch(token, isNew ? "/api/admin/leads-v2" : `/api/admin/leads-v2/${edit.id}`, { method: isNew ? "POST" : "PATCH", body });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      setEdit(null); load();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this lead? (soft delete)")) return;
    const r = await adminFetch(token, `/api/admin/leads-v2/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }
  async function exportXlsx() {
    const t = token || getAdminToken();
    if (!t) return;
    const r = await fetch(apiUrl("/api/admin/leads/export.xlsx"), { headers: { "x-admin-token": t } });
    if (!r.ok) { alert("Export failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  }

  const stageBadge = (s: string) => <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700">{s}</span>;

  return (
    <AdminLayout title="Leads">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={stageF} onChange={(e) => setStageF(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="filter-stage">
          <option value="all">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select value={assignedF} onChange={(e) => setAssignedF(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="filter-assigned">
          <option value="all">All reps</option>
          <option value="">Unassigned</option>
          {reps.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search name / phone / email…" className="border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-48" data-testid="search-leads" />
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Search</button>
        <div className="flex-1" />
        <button onClick={() => setManageStages(true)} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="button-manage-stages"><Settings2 className="w-4 h-4" />Stages</button>
        <button onClick={exportXlsx} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1.5" data-testid="button-export-leads"><Download className="w-4 h-4" />Export Excel</button>
        <button onClick={() => setEdit({ stage: stages[0]?.name ?? "New", source: "manual" })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-lead"><Plus className="w-4 h-4" />Add Lead</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No leads in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Assigned</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((l) => (
                <tr key={l.id} data-testid={`row-lead-${l.id}`}>
                  <td className="px-4 py-3 font-semibold">{l.name}</td>
                  <td className="px-4 py-3 text-xs">{l.contact_person || "—"}</td>
                  <td className="px-4 py-3 text-xs">{l.phone || "—"}</td>
                  <td className="px-4 py-3 text-xs">{l.city || "—"}</td>
                  <td className="px-4 py-3">{stageBadge(l.stage)}</td>
                  <td className="px-4 py-3 text-xs">{repName(l.assigned_to_user_id)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => composeForLead(l.id, "email")} className="p-2 hover:bg-indigo-500/10 text-indigo-600 rounded mr-1" title="Email via Marketing" data-testid={`button-email-lead-${l.id}`}><Mail className="w-4 h-4" /></button>
                    <button onClick={() => composeForLead(l.id, "whatsapp")} className="p-2 hover:bg-emerald-500/10 text-emerald-600 rounded mr-1" title="WhatsApp via Marketing" data-testid={`button-whatsapp-lead-${l.id}`}><MessageCircle className="w-4 h-4" /></button>
                    <button onClick={() => setEdit(l)} className="p-2 hover:bg-muted rounded mr-1" data-testid={`button-edit-lead-${l.id}`}><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => del(l.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-lead-${l.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{edit.id ? "Edit Lead" : "Add Lead"}</h2>
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <LField label="Name *"><input value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-lead-name" /></LField>
              <div className="grid grid-cols-2 gap-3">
                <LField label="Contact Person"><input value={edit.contact_person || ""} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
                <LField label="Phone"><input value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <LField label="Email"><input value={edit.email || ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
                <LField label="Source"><input value={edit.source || ""} onChange={(e) => setEdit({ ...edit, source: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <LField label="City"><input value={edit.city || ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
                <LField label="State"><input value={edit.state || ""} onChange={(e) => setEdit({ ...edit, state: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
              </div>
              <LField label="Address"><input value={edit.address || ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
              <LField label="Requirement"><textarea value={edit.requirement || ""} onChange={(e) => setEdit({ ...edit, requirement: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" /></LField>
              <div className="grid grid-cols-2 gap-3">
                <LField label="Stage">
                  <select value={edit.stage || ""} onChange={(e) => setEdit({ ...edit, stage: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="select-lead-stage">
                    {stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </LField>
                <LField label="Assigned Rep">
                  <select value={edit.assigned_to_user_id ?? ""} onChange={(e) => setEdit({ ...edit, assigned_to_user_id: e.target.value === "" ? null : parseInt(e.target.value, 10) })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="select-lead-assigned">
                    <option value="">Unassigned</option>
                    {reps.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                  </select>
                </LField>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={busy} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-save-lead">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {manageStages && <ManageStages stages={stages} onClose={() => setManageStages(false)} onChange={loadStages} />}
    </AdminLayout>
  );
}

function ManageStages({ stages, onClose, onChange }: { stages: Stage[]; onClose: () => void; onChange: () => void }) {
  const { token } = useAdminAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!token || !name.trim()) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, "/api/admin/lead-stages", { method: "POST", body: JSON.stringify({ name: name.trim(), position: stages.length + 1 }) });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      setName(""); onChange();
    } finally { setBusy(false); }
  }
  async function del(s: Stage) {
    if (!token || s.is_default) return;
    if (!confirm(`Delete stage "${s.name}"?`)) return;
    const r = await adminFetch(token, `/api/admin/lead-stages/${s.id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    onChange();
  }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Manage Stages</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="space-y-1.5">
            {stages.map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded-lg px-3 py-2" data-testid={`stage-row-${s.id}`}>
                <span className="text-sm font-medium">{s.name}{s.is_default ? <span className="ml-2 text-[10px] uppercase font-bold text-muted-foreground">default</span> : null}</span>
                {!s.is_default && <button onClick={() => del(s)} className="p-1.5 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New stage name" className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-new-stage" />
            <button onClick={add} disabled={busy || !name.trim()} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-1"><Plus className="w-4 h-4" />Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LField({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
