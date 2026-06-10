import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, KeyRound, ToggleLeft, ToggleRight, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface DataTeamUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  active: boolean;
  lastLogin: number | null;
  createdAt: number;
}

const emptyUser: Partial<DataTeamUser> & { password?: string } = {
  username: "", name: "", email: "", phone: "", active: true, password: "",
};

export default function AdminDataTeam() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState<(Partial<DataTeamUser> & { password?: string }) | null>(null);
  const [resetTarget, setResetTarget] = useState<DataTeamUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const { data: users = [], isLoading } = useQuery<DataTeamUser[]>({
    queryKey: ["data-team-users"],
    queryFn: async () => {
      const r = await adminFetch(token, "/api/admin/data-team-users");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const saveMut = useMutation({
    mutationFn: async (item: Partial<DataTeamUser> & { password?: string }) => {
      const isNew = !item.id;
      const url = isNew ? "/api/admin/data-team-users" : `/api/admin/data-team-users/${item.id}`;
      const body = { ...item };
      if (!isNew) delete body.password; // don't send password on edit
      const r = await adminFetch(token, url, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["data-team-users"] });
      setOpen(null);
      toast({ title: "Saved successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetMut = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const r = await adminFetch(token, `/api/admin/data-team-users/${id}/reset-password`, {
        method: "POST", body: JSON.stringify({ password }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Reset failed"); }
      return r.json();
    },
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword("");
      toast({ title: "Password reset successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = async (u: DataTeamUser) => {
    const r = await adminFetch(token, `/api/admin/data-team-users/${u.id}`, {
      method: "PATCH", body: JSON.stringify({ active: !u.active }),
    });
    if (r.ok) qc.invalidateQueries({ queryKey: ["data-team-users"] });
  };

  return (
    <AdminLayout title="Data Team Users">
      <div className="flex gap-2 mb-4 items-center">
        <Users className="w-5 h-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{users.length} user{users.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen({ ...emptyUser })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> New User
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No data team users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Last Login</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{u.username}</td>
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{u.email || "—"}</div>
                    <div className="text-muted-foreground">{u.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-IN") : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(u)} title="Toggle active" className="p-1 rounded hover:bg-muted">
                      {u.active
                        ? <ToggleRight className="w-5 h-5 text-emerald-600" />
                        : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setResetTarget(u)} className="p-2 hover:bg-muted rounded" title="Reset password">
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button onClick={() => setOpen(u)} className="p-2 hover:bg-muted rounded" title="Edit">
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit dialog */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{open.id ? "Edit User" : "New Data Team User"}</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Username *">
                  <input value={open.username || ""} onChange={(e) => setOpen({ ...open, username: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background font-mono" disabled={!!open.id} />
                </Field>
                <Field label="Full Name *">
                  <input value={open.name || ""} onChange={(e) => setOpen({ ...open, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Email">
                  <input value={open.email || ""} onChange={(e) => setOpen({ ...open, email: e.target.value })}
                    type="email" className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Phone">
                  <input value={open.phone || ""} onChange={(e) => setOpen({ ...open, phone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                {!open.id && (
                  <Field label="Password *">
                    <input value={open.password || ""} onChange={(e) => setOpen({ ...open, password: e.target.value })}
                      type="password" className="w-full border rounded-lg px-3 py-2 bg-background" />
                  </Field>
                )}
                <Field label="Active">
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={!!open.active} onChange={(e) => setOpen({ ...open, active: e.target.checked })} />
                    Active account
                  </label>
                </Field>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => saveMut.mutate(open)} disabled={saveMut.isPending}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">
                {saveMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password dialog */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Reset Password</h2>
              <button onClick={() => { setResetTarget(null); setNewPassword(""); }} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">Set a new password for <strong>{resetTarget.name}</strong> ({resetTarget.username}).</p>
              <Field label="New Password">
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password"
                  className="w-full border rounded-lg px-3 py-2 bg-background" autoFocus />
              </Field>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => { setResetTarget(null); setNewPassword(""); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => resetMut.mutate({ id: resetTarget.id, password: newPassword })}
                disabled={resetMut.isPending || !newPassword.trim()}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">
                {resetMut.isPending ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
