import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Users } from "lucide-react";

// R26.5 (D) — Create Users. Manages all data_team_users via /api/admin/users
// (GET ?role=, POST, PATCH, DELETE). Role tabs filter the list and seed new users.
interface User {
  id: number; username: string; name: string | null; email: string | null;
  phone: string | null; role: string; active: number | boolean; last_login: number | null; created_at: number;
}
const ROLES = ["admin", "data_team", "team", "dispatch", "delhi_warehouse", "consignment", "sales", "finance", "hr"];
const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-500/15 text-purple-700", sales: "bg-amber-500/15 text-amber-700",
  finance: "bg-emerald-500/15 text-emerald-700", hr: "bg-indigo-500/15 text-indigo-700",
  consignment: "bg-blue-500/15 text-blue-700",
};

interface Draft { id?: number; username: string; name: string; email: string; phone: string; role: string; password: string; active: boolean; }

export default function AdminUsers() {
  const { token } = useAdminAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roleF, setRoleF] = useState("all");
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const url = roleF === "all" ? "/api/admin/users" : `/api/admin/users?role=${encodeURIComponent(roleF)}`;
    const r = await adminFetch(token, url);
    if (r.ok) setUsers(await r.json()); else setUsers([]);
  }
  useEffect(() => { load(); }, [token, roleF]); // eslint-disable-line

  function newUser() {
    setEdit({ username: "", name: "", email: "", phone: "", role: roleF === "all" ? "sales" : roleF, password: "", active: true });
  }
  function editUser(u: User) {
    setEdit({ id: u.id, username: u.username, name: u.name || "", email: u.email || "", phone: u.phone || "", role: u.role, password: "", active: !!u.active });
  }

  async function save() {
    if (!token || !edit) return;
    if (!edit.username.trim()) { alert("Username is required."); return; }
    const isNew = !edit.id;
    if (isNew && edit.password.length < 6) { alert("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      const body: any = { username: edit.username.trim(), name: edit.name || null, email: edit.email || null, phone: edit.phone || null, role: edit.role, active: edit.active };
      if (edit.password) body.password = edit.password;
      const r = await adminFetch(token, isNew ? "/api/admin/users" : `/api/admin/users/${edit.id}`, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(body) });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      setEdit(null); load();
    } finally { setBusy(false); }
  }

  async function del(u: User) {
    if (!token || !confirm(`Delete user "${u.username}"?`)) return;
    const r = await adminFetch(token, `/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!r.ok) { alert("Failed"); return; }
    load();
  }

  const roleBadge = (r: string) => <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${ROLE_BADGE[r] || "bg-slate-500/15 text-slate-700"}`}>{r}</span>;

  return (
    <AdminLayout title="Create Users">
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <Users className="w-5 h-5 text-muted-foreground" />
        <select value={roleF} onChange={(e) => setRoleF(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="filter-user-role">
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">{users.length} user{users.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <button onClick={newUser} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-user">
          <Plus className="w-4 h-4" /> New User
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {users.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No users in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Last Login</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} data-testid={`row-user-${u.id}`}>
                  <td className="px-4 py-3 font-mono font-semibold">{u.username}{!u.active && <span className="ml-2 text-[10px] uppercase font-bold text-rose-600">inactive</span>}</td>
                  <td className="px-4 py-3">{u.name || "—"}</td>
                  <td className="px-4 py-3">{roleBadge(u.role)}</td>
                  <td className="px-4 py-3 text-xs"><div>{u.email || "—"}</div><div className="text-muted-foreground">{u.phone || "—"}</div></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.last_login ? new Date(u.last_login).toLocaleString("en-IN") : "Never"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => editUser(u)} className="p-2 hover:bg-muted rounded mr-1" title="Edit" data-testid={`button-edit-user-${u.id}`}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => del(u)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" title="Delete" data-testid={`button-delete-user-${u.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{edit.id ? "Edit User" : "New User"}</h2>
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 grid sm:grid-cols-2 gap-4">
              <UField label="Username *"><input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono" data-testid="input-user-username" /></UField>
              <UField label="Full Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></UField>
              <UField label="Role">
                <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="select-user-role">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </UField>
              <UField label={edit.id ? "New Password (blank = keep)" : "Password *"}>
                <input value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} type="password" className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-user-password" />
              </UField>
              <UField label="Email"><input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} type="email" className="w-full border rounded-lg px-3 py-2 bg-background" /></UField>
              <UField label="Phone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></UField>
              <UField label="Active">
                <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm font-normal"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active account</label>
              </UField>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={busy} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-save-user">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function UField({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
