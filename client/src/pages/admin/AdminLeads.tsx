import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, MessageSquare, Send, Loader2, LayoutGrid, List } from "lucide-react";

interface Lead {
  id: number;
  source: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  requirement: string | null;
  stage: string;
  score: number;
  createdAt: number;
}

const STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost"];
const STAGE_COLOR: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-700", contacted: "bg-amber-500/15 text-amber-700",
  qualified: "bg-violet-500/15 text-violet-700", quoted: "bg-cyan-500/15 text-cyan-700",
  won: "bg-emerald-500/15 text-emerald-700", lost: "bg-red-500/15 text-red-700",
};
const EMPTY: Partial<Lead> = { name: "", phone: "", city: "", requirement: "", source: "manual" };

export default function AdminLeads() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stageFilter, setStageFilter] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [editing, setEditing] = useState<Partial<Lead> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");
  const [outreachFor, setOutreachFor] = useState<Lead | null>(null);

  const { data, isLoading } = useQuery<{ rows: Lead[]; total: number }>({
    queryKey: ["admin-leads", stageFilter],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/leads?${stageFilter ? `stage=${stageFilter}` : ""}`);
      if (!r.ok) return { rows: [], total: 0 };
      return r.json();
    },
    enabled: !!token,
  });
  const leads = data?.rows || [];

  const save = useMutation({
    mutationFn: async (l: Partial<Lead>) => {
      const url = l.id ? `/api/admin/leads/${l.id}` : `/api/admin/leads`;
      const r = await adminFetch(token, url, { method: l.id ? "PATCH" : "POST", body: JSON.stringify(l) });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-leads"] }); setEditing(null); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeStage = useMutation({
    mutationFn: async ({ id, stage }: { id: number; stage: string }) => {
      const r = await adminFetch(token, `/api/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      if (!r.ok) throw new Error("Update failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-leads"] }),
  });

  const doImport = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/leads/bulk-import`, { method: "POST", body: JSON.stringify({ csv }) });
      if (!r.ok) throw new Error("Import failed");
      return r.json();
    },
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ["admin-leads"] }); setShowImport(false); setCsv(""); toast({ title: `Imported ${d.inserted ?? 0} leads` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const outreach = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/admin/leads/${id}/outreach`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Outreach failed");
      return d;
    },
    onSuccess: (d) => { setOutreachFor(null); toast({ title: "Outreach sent", description: d.message?.slice(0, 80) }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout title="Leads CRM">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {viewMode === "table" && (
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm">
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <div className="flex border rounded-lg overflow-hidden">
          <button onClick={() => setViewMode("kanban")} className={`px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 ${viewMode === "kanban" ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted"}`}><LayoutGrid className="w-3.5 h-3.5" /> Kanban</button>
          <button onClick={() => setViewMode("table")} className={`px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 border-l ${viewMode === "table" ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted"}`}><List className="w-3.5 h-3.5" /> Table</button>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Lead
        </button>
        <button onClick={() => setShowImport(true)} className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Upload className="w-4 h-4" /> Import
        </button>
      </div>

      {viewMode === "kanban" ? (
        <KanbanBoard
          leads={leads}
          isLoading={isLoading}
          onStageChange={(id, stage) => changeStage.mutate({ id, stage })}
          onEdit={setEditing}
          onOutreach={setOutreachFor}
        />
      ) : (
        <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
          {isLoading ? <div className="p-12 text-center text-muted-foreground">Loading…</div> :
            leads.length === 0 ? <div className="p-12 text-center text-muted-foreground">No leads.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-3 py-3 font-semibold">Name</th>
                <th className="px-3 py-3 font-semibold">Source</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold">City</th>
                <th className="px-3 py-3 font-semibold">Requirement</th>
                <th className="px-3 py-3 font-semibold">Stage</th>
                <th className="px-3 py-3 font-semibold text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y">{leads.map((l) => (
                <tr key={l.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3 font-semibold cursor-pointer hover:text-accent" onClick={() => setEditing(l)}>{l.name}</td>
                  <td className="px-3 py-3 text-xs"><span className="px-2 py-0.5 rounded bg-muted">{l.source}</span></td>
                  <td className="px-3 py-3">{l.phone || "—"}</td>
                  <td className="px-3 py-3">{l.city || "—"}</td>
                  <td className="px-3 py-3 text-xs max-w-xs truncate">{l.requirement || "—"}</td>
                  <td className="px-3 py-3">
                    <select value={l.stage} onChange={(e) => changeStage.mutate({ id: l.id, stage: e.target.value })}
                      className={`text-xs font-bold rounded px-2 py-1 border-0 ${STAGE_COLOR[l.stage] || "bg-muted"}`}>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOutreachFor(l)} className="p-1.5 rounded hover:bg-muted" title="AI Outreach"><MessageSquare className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{editing.id ? "Edit" : "New"} Lead</h2>
            <div className="grid grid-cols-2 gap-3">
              {([["name", "Name *"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["city", "City"], ["state", "State"], ["source", "Source"]] as const).map(([k, label]) => (
                <label key={k} className="text-xs font-semibold">{label}
                  <input value={(editing as any)[k] || ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" />
                </label>
              ))}
              <label className="text-xs font-semibold col-span-2">Requirement
                <textarea value={editing.requirement || ""} onChange={(e) => setEditing({ ...editing, requirement: e.target.value })} rows={3}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.name || save.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">Import Leads (CSV)</h2>
            <p className="text-xs text-muted-foreground mb-3">Headers: name, phone, email, city, state, requirement, source</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10}
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm font-mono" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => doImport.mutate()} disabled={!csv.trim() || doImport.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Import</button>
            </div>
          </div>
        </div>
      )}

      {outreachFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOutreachFor(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">AI Outreach</h2>
            <p className="text-sm text-muted-foreground mb-4">Send an AI-drafted WhatsApp message to <b>{outreachFor.name}</b> ({outreachFor.phone || outreachFor.whatsapp || "no phone"})?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setOutreachFor(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => outreach.mutate(outreachFor.id)} disabled={outreach.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                {outreach.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// ---- Kanban Board Component ----
interface KanbanBoardProps {
  leads: Lead[];
  isLoading: boolean;
  onStageChange: (id: number, stage: string) => void;
  onEdit: (lead: Partial<Lead>) => void;
  onOutreach: (lead: Lead) => void;
}

const KANBAN_COLS = [
  { key: "new", label: "New", color: "border-blue-400" },
  { key: "contacted", label: "Contacted", color: "border-amber-400" },
  { key: "qualified", label: "Qualified", color: "border-violet-400" },
  { key: "quoted", label: "Quoted", color: "border-cyan-400" },
  { key: "won", label: "Won", color: "border-emerald-400" },
  { key: "lost", label: "Lost", color: "border-red-400" },
];

function KanbanBoard({ leads, isLoading, onStageChange, onEdit, onOutreach }: KanbanBoardProps) {
  if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {KANBAN_COLS.map((col) => {
        const colLeads = leads.filter((l) => l.stage === col.key);
        return (
          <div key={col.key} className={`flex-shrink-0 w-56 bg-card border-t-2 ${col.color} rounded-xl shadow-sm`}>
            <div className="px-3 py-2.5 border-b flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider">{col.label}</span>
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-semibold">{colLeads.length}</span>
            </div>
            <div className="p-2 space-y-2 min-h-[120px]">
              {colLeads.map((lead) => (
                <KanbanCard
                  key={lead.id}
                  lead={lead}
                  onStageChange={onStageChange}
                  onEdit={onEdit}
                  onOutreach={onOutreach}
                />
              ))}
              {colLeads.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 opacity-50">Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  lead, onStageChange, onEdit, onOutreach,
}: {
  lead: Lead;
  onStageChange: (id: number, stage: string) => void;
  onEdit: (lead: Partial<Lead>) => void;
  onOutreach: (lead: Lead) => void;
}) {
  const [showMove, setShowMove] = useState(false);

  return (
    <div className="bg-background border rounded-lg p-2.5 shadow-sm text-xs group relative">
      <div
        className="font-semibold text-sm cursor-pointer hover:text-accent mb-0.5 truncate"
        onClick={() => onEdit(lead)}
        title={lead.name}
      >
        {lead.name}
      </div>
      {lead.city && <div className="text-muted-foreground truncate">{lead.city}</div>}
      {lead.phone && <div className="text-muted-foreground font-mono truncate">{lead.phone}</div>}
      {lead.requirement && (
        <div className="mt-1 text-muted-foreground line-clamp-2 leading-tight">{lead.requirement}</div>
      )}
      <div className="mt-2 flex items-center gap-1">
        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{lead.source}</span>
        <div className="flex-1" />
        <button
          onClick={() => onOutreach(lead)}
          className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
          title="Outreach"
        >
          <MessageSquare className="w-3 h-3" />
        </button>
        <button
          onClick={() => setShowMove(!showMove)}
          className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
          title="Move to stage"
        >
          ↗
        </button>
      </div>
      {showMove && (
        <div className="absolute right-0 top-full mt-1 bg-card border rounded-lg shadow-xl z-20 py-1 w-36">
          {STAGES.filter((s) => s !== lead.stage).map((s) => (
            <button
              key={s}
              onClick={() => { onStageChange(lead.id, s); setShowMove(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted capitalize"
            >
              → {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
