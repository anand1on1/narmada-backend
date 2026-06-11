import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

interface Task { id: number; title: string; description: string | null; assignedTo: number | null; assignedBy: string | null; dueDate: number | null; status: string; priority: string; }
const STATUSES = ["open", "doing", "done"];
const STATUS_COLOR: Record<string, string> = { open: "bg-blue-500/15 text-blue-700", doing: "bg-amber-500/15 text-amber-700", done: "bg-emerald-500/15 text-emerald-700" };

export default function AdminTasks() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ title: string; description: string; assignedTo: string; priority: string } | null>(null);

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["admin-tasks"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/tasks`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (t: { title: string; description: string; assignedTo: string; priority: string }) => {
      const r = await adminFetch(token, `/api/admin/tasks`, { method: "POST", body: JSON.stringify({ ...t, assignedTo: t.assignedTo ? Number(t.assignedTo) : null }) });
      if (!r.ok) throw new Error("Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-tasks"] }); setEditing(null); toast({ title: "Created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => { await adminFetch(token, `/api/admin/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tasks"] }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/tasks/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-tasks"] }); toast({ title: "Deleted" }); },
  });

  return (
    <AdminLayout title="Tasks">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ title: "", description: "", assignedTo: "", priority: "normal" })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {tasks.length === 0 ? <div className="p-12 text-center text-muted-foreground">No tasks.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Task</th>
              <th className="px-3 py-3 font-semibold">Priority</th>
              <th className="px-3 py-3 font-semibold">Assigned To</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{tasks.map((t) => (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-3 py-3"><div className="font-semibold">{t.title}</div>{t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}</td>
                <td className="px-3 py-3 text-xs">{t.priority}</td>
                <td className="px-3 py-3">{t.assignedTo ?? "—"}</td>
                <td className="px-3 py-3">
                  <select value={t.status} onChange={(e) => setStatus.mutate({ id: t.id, status: e.target.value })}
                    className={`text-xs font-bold rounded px-2 py-1 border-0 ${STATUS_COLOR[t.status] || "bg-muted"}`}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3 text-right">
                  <button onClick={() => { if (confirm("Delete?")) del.mutate(t.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">New Task</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Title *
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Description
                <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Assigned To (team user ID)
                <input type="number" value={editing.assignedTo} onChange={(e) => setEditing({ ...editing, assignedTo: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Priority
                <select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                  <option value="low">low</option><option value="normal">normal</option><option value="high">high</option>
                </select></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.title || save.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
