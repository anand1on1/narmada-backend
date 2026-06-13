import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Trash2, Paperclip, ExternalLink } from "lucide-react";

// R26.5 (C) — Tasks V2 over /api/admin/tasks (camelCase TaskItem). Adds file upload
// (POST /api/admin/tasks/:id/file) and granular status PATCH (/api/admin/tasks/:id/status).
interface Task {
  id: number; title: string; description: string | null; assignedTo: number | null;
  assignedToUserId: number | null; assignedBy: string | null; deadline: string | null;
  dueDate: number | null; status: string; priority: string; fileUrl: string | null;
}
interface User { id: number; username: string; name: string | null; role: string; }

const STATUSES = ["pending", "processing", "standby", "complete", "open", "doing", "done"];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-700", processing: "bg-amber-500/15 text-amber-700",
  standby: "bg-orange-500/15 text-orange-700", complete: "bg-emerald-500/15 text-emerald-700",
  open: "bg-blue-500/15 text-blue-700", doing: "bg-amber-500/15 text-amber-700",
  done: "bg-emerald-500/15 text-emerald-700",
};

interface Draft { title: string; description: string; assignedTo: string; priority: string; deadline: string; file: File | null; }

export default function AdminTasksV2() {
  const { token } = useAdminAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/tasks");
    if (r.ok) setTasks(await r.json()); else setTasks([]);
  }
  async function loadUsers() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/users");
    if (r.ok) setUsers(await r.json());
  }
  useEffect(() => { load(); loadUsers(); }, [token]); // eslint-disable-line

  const userName = (id: number | null) => {
    if (id == null) return "—";
    const u = users.find((x) => x.id === id);
    return u ? `${u.name || u.username} (${u.role})` : `#${id}`;
  };

  async function save() {
    if (!token || !edit) return;
    if (!edit.title.trim()) { alert("Title is required."); return; }
    setBusy(true);
    try {
      const body = JSON.stringify({
        title: edit.title.trim(), description: edit.description || null,
        assignedTo: edit.assignedTo ? Number(edit.assignedTo) : null,
        assignedToUserId: edit.assignedTo ? Number(edit.assignedTo) : null,
        priority: edit.priority, deadline: edit.deadline || null,
      });
      const r = await adminFetch(token, "/api/admin/tasks", { method: "POST", body });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      const created: Task = await r.json();
      if (edit.file && created?.id) {
        const fd = new FormData();
        fd.append("file", edit.file);
        await adminFetch(token, `/api/admin/tasks/${created.id}/file`, { method: "POST", body: fd });
      }
      setEdit(null); load();
    } finally { setBusy(false); }
  }

  async function setStatus(id: number, status: string) {
    if (!token) return;
    const r = await adminFetch(token, `/api/admin/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  async function del(id: number) {
    if (!token || !confirm("Delete this task?")) return;
    const r = await adminFetch(token, `/api/admin/tasks/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Failed"); return; }
    load();
  }

  return (
    <AdminLayout title="Tasks">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEdit({ title: "", description: "", assignedTo: "", priority: "normal", deadline: "", file: null })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2" data-testid="button-new-task">
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
              <th className="px-3 py-3 font-semibold">Deadline</th>
              <th className="px-3 py-3 font-semibold">File</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{tasks.map((t) => (
              <tr key={t.id} className="hover:bg-muted/30" data-testid={`row-task-${t.id}`}>
                <td className="px-3 py-3"><div className="font-semibold">{t.title}</div>{t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}</td>
                <td className="px-3 py-3 text-xs">{t.priority}</td>
                <td className="px-3 py-3 text-xs">{userName(t.assignedToUserId ?? t.assignedTo)}</td>
                <td className="px-3 py-3 text-xs">{t.deadline || "—"}</td>
                <td className="px-3 py-3 text-xs">
                  {t.fileUrl ? <a href={t.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline" data-testid={`link-task-file-${t.id}`}><ExternalLink className="w-3.5 h-3.5" />Open</a> : "—"}
                </td>
                <td className="px-3 py-3">
                  <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}
                    className={`text-xs font-bold rounded px-2 py-1 border-0 ${STATUS_COLOR[t.status] || "bg-muted"}`} data-testid={`select-task-status-${t.id}`}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3 text-right">
                  <button onClick={() => del(t.id)} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" data-testid={`button-delete-task-${t.id}`}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEdit(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">New Task</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Title *
                <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-task-title" /></label>
              <label className="text-xs font-semibold block">Description
                <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={3} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Assigned To
                <select value={edit.assignedTo} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="select-task-assigned">
                  <option value="">— Unassigned —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username} ({u.role})</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold block">Priority
                  <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                    <option value="low">low</option><option value="normal">normal</option><option value="high">high</option>
                  </select></label>
                <label className="text-xs font-semibold block">Deadline
                  <input type="date" value={edit.deadline} onChange={(e) => setEdit({ ...edit, deadline: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" data-testid="input-task-deadline" /></label>
              </div>
              <label className="text-xs font-semibold block">Attachment
                <div className="mt-1 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <input type="file" onChange={(e) => setEdit({ ...edit, file: e.target.files?.[0] || null })} className="text-sm font-normal" data-testid="input-task-file" />
                </div></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={!edit.title.trim() || busy} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-save-task">{busy ? "Saving…" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
