import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, AdminRole } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, ShieldCheck, Truck, KeyRound, Calculator, Briefcase } from "lucide-react";

interface AdminUser {
  id: number;
  username: string;
  role: AdminRole;
  displayName: string | null;
  active: boolean;
  createdAt: string;
}

const ROLE_META: Record<AdminRole, { label: string; desc: string; icon: any; badge: string }> = {
  admin:     { label: "Admin",     desc: "Full access",              icon: ShieldCheck, badge: "bg-purple-500/15 text-purple-700" },
  logistics: { label: "Logistics", desc: "Consignments only",        icon: Truck,       badge: "bg-blue-500/15 text-blue-700" },
  accounts:  { label: "Accounts",  desc: "Dashboard + consignments", icon: Calculator,  badge: "bg-emerald-500/15 text-emerald-700" },
  sales:     { label: "Sales",     desc: "Price lists + products",   icon: Briefcase,   badge: "bg-amber-500/15 text-amber-700" },
  data_center: { label: "Data Center", desc: "PartSetu + Products (no delete)", icon: Briefcase, badge: "bg-cyan-500/15 text-cyan-700" },
};

export default function AdminTeam() {
  const { token } = useAdminAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState<{
    id?: number; username: string; password: string; role: AdminRole; displayName: string; active: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/v2/admin/users");
    if (r.status === 403) { setForbidden(true); return; }
    { const _d = await r.json(); setUsers(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const isNew = !open.id;
      const url = isNew ? "/api/v2/admin/users" : `/api/v2/admin/users/${open.id}`;
      const body: any = { role: open.role, displayName: open.displayName, active: open.active };
      if (isNew) { body.username = open.username; body.password = open.password; }
      else if (open.password) { body.password = open.password; }
      const r = await adminFetch(token, url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) alert(data.error || "Save failed");
      else { await load(); setOpen(null); }
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!token) return;
    if (!confirm("Delete this user?")) return;
    await adminFetch(token, `/api/v2/admin/users/${id}`, { method: "DELETE" });
    await load();
  }

  if (forbidden) {
    return (
      <AdminLayout title="Team">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 text-center">
          <ShieldCheck className="w-8 h-8 mx-auto text-amber-700 mb-3" />
          <h3 className="font-bold text-lg mb-1">Admin role required</h3>
          <p className="text-sm text-muted-foreground">Only users with the admin role can manage team members.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Team / Sub-users">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Create sub-users with limited access. Roles: <span className="font-semibold">Admin</span> (full), <span className="font-semibold">Logistics</span> (consignments), <span className="font-semibold">Accounts</span> (dashboard + consignments), <span className="font-semibold">Sales</span> (price lists + products + contacts).
          </p>
        </div>
        <button onClick={() => setOpen({ username: "", password: "", role: "logistics", displayName: "", active: true })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-new-user">
          <Plus className="w-4 h-4" /> Add Sub-user
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {users.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No sub-users yet. The primary admin is configured via environment variables.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-5 py-3 font-semibold">Username</th>
                <th className="px-5 py-3 font-semibold">Display Name</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Created</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} data-testid={`row-user-${u.id}`}>
                  <td className="px-5 py-3 font-mono font-semibold">{u.username}</td>
                  <td className="px-5 py-3">{u.displayName || "—"}</td>
                  <td className="px-5 py-3">
                    {(() => {
                      const meta = ROLE_META[u.role] || ROLE_META.admin;
                      const Icon = meta.icon;
                      return (
                        <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${meta.badge}`}>
                          <Icon className="w-3 h-3" /> {u.role}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3">
                    {u.active ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 uppercase font-bold tracking-wider">Active</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-500/15 text-slate-700 uppercase font-bold tracking-wider">Disabled</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpen({ id: u.id, username: u.username, password: "", role: u.role, displayName: u.displayName || "", active: u.active })}
                      className="p-2 hover:bg-muted rounded" data-testid={`button-edit-user-${u.id}`}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => del(u.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-user-${u.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{open.id ? "Edit Sub-user" : "New Sub-user"}</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Username (lowercase, no spaces)">
                <input value={open.username} onChange={(e) => setOpen({ ...open, username: e.target.value.toLowerCase().replace(/\s+/g, "") })}
                  disabled={!!open.id}
                  className="w-full border rounded-lg px-3 py-2 bg-background font-mono disabled:opacity-60" data-testid="input-username" />
              </Field>
              <Field label={open.id ? "New Password (leave blank to keep current)" : "Password (min 8 chars)"}>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="password" value={open.password} onChange={(e) => setOpen({ ...open, password: e.target.value })}
                    className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background" data-testid="input-password" />
                </div>
              </Field>
              <Field label="Display Name">
                <input value={open.displayName} onChange={(e) => setOpen({ ...open, displayName: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-display-name" />
              </Field>
              <Field label="Role">
                <select value={open.role} onChange={(e) => setOpen({ ...open, role: e.target.value as AdminRole })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="select-role">
                  <option value="logistics">Logistics — consignments only</option>
                  <option value="accounts">Accounts — dashboard + consignments (read)</option>
                  <option value="sales">Sales — price lists + products + contacts</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </Field>
              {open.id && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={open.active} onChange={(e) => setOpen({ ...open, active: e.target.checked })}
                    data-testid="checkbox-active" />
                  <span className="text-sm font-semibold">Active (uncheck to disable login)</span>
                </label>
              )}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm disabled:opacity-50"
                data-testid="button-save-user">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</div>
      {children}
    </div>
  );
}
