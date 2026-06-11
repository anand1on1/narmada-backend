import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Megaphone } from "lucide-react";

interface Announcement { id: number; title: string; body: string | null; audience: string; createdBy: string | null; createdAt: number; }
const AUDIENCES = ["all", "patna", "delhi", "admin"];

function fmt(d: number) { return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

export default function AdminAnnouncements() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ title: string; body: string; audience: string } | null>(null);

  const { data: items = [] } = useQuery<Announcement[]>({
    queryKey: ["admin-announcements"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/announcements`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (a: { title: string; body: string; audience: string }) => {
      const r = await adminFetch(token, `/api/admin/announcements`, { method: "POST", body: JSON.stringify(a) });
      if (!r.ok) throw new Error("Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-announcements"] }); setEditing(null); toast({ title: "Posted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/announcements/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-announcements"] }); toast({ title: "Deleted" }); },
  });

  return (
    <AdminLayout title="Announcements">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ title: "", body: "", audience: "all" })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Announcement
        </button>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? <div className="p-12 text-center text-muted-foreground bg-card border rounded-xl">No announcements.</div> :
          items.map((a) => (
            <div key={a.id} className="bg-card border rounded-xl p-4 shadow-sm flex items-start justify-between">
              <div className="flex gap-3">
                <Megaphone className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <div className="font-semibold flex items-center gap-2">{a.title}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-muted uppercase font-bold">{a.audience}</span></div>
                  {a.body && <p className="text-sm text-muted-foreground mt-1">{a.body}</p>}
                  <div className="text-[10px] text-muted-foreground mt-1">{fmt(a.createdAt)}{a.createdBy ? ` · ${a.createdBy}` : ""}</div>
                </div>
              </div>
              <button onClick={() => { if (confirm("Delete?")) del.mutate(a.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">New Announcement</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Title *
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Body
                <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={4} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Audience
                <select value={editing.audience} onChange={(e) => setEditing({ ...editing, audience: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal">
                  {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.title || save.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Post</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
