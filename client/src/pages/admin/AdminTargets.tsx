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
