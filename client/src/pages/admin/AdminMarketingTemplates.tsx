import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Trash2, Mail, MessageCircle, AlertTriangle } from "lucide-react";

interface Template {
  id: number;
  name: string;
  channel: string;
  email_subject: string | null;
  email_body_html: string | null;
  whatsapp_template_name: string | null;
  updated_at: number | null;
}

type Channel = "email" | "whatsapp";

function fmt(d: number | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminMarketingTemplates() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState<{ name: string; channel: Channel; email_subject: string; email_body_html: string; whatsapp_template_name: string } | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["marketing-templates"],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/templates`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (t: any) => {
      const r = await adminFetch(token, `/api/marketing/templates`, { method: "POST", body: JSON.stringify(t) });
      if (!r.ok) throw new Error("Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-templates"] }); setEditing(null); toast({ title: "Template saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/marketing/templates/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-templates"] }); toast({ title: "Deleted" }); },
  });

  // "Use Template" → seed composer via sessionStorage handoff.
  function useTemplate(t: Template) {
    try {
      sessionStorage.setItem("marketing_template_seed", JSON.stringify(t));
    } catch { /* ignore */ }
    navigate("/admin/marketing/campaigns/new");
  }

  return (
    <AdminLayout title="Marketing — Templates">
      <MarketingTabs active="templates" />
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ name: "", channel: "email", email_subject: "", email_body_html: "", whatsapp_template_name: "" })} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-indigo-700"><Plus className="w-4 h-4" /> New Template</button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Channel</th>
              <th className="text-left px-4 py-3">Updated</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">No templates.</td></tr>
            ) : templates.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 capitalize">{t.channel === "email" ? <Mail className="w-4 h-4 text-indigo-600" /> : <MessageCircle className="w-4 h-4 text-emerald-600" />} {t.channel}</span></td>
                <td className="px-4 py-3 text-slate-600">{fmt(t.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => useTemplate(t)} className="px-2.5 py-1 text-xs rounded bg-indigo-50 text-indigo-700 font-semibold">Use Template</button>
                    <button onClick={() => { if (confirm("Delete template?")) del.mutate(t.id); }} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">New Template</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Name *
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Channel
                <select value={editing.channel} onChange={(e) => setEditing({ ...editing, channel: e.target.value as Channel })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select></label>
              {editing.channel === "email" ? (
                <>
                  <label className="text-xs font-semibold block">Subject
                    <input value={editing.email_subject} onChange={(e) => setEditing({ ...editing, email_subject: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
                  <label className="text-xs font-semibold block">Body (HTML)
                    <textarea value={editing.email_body_html} onChange={(e) => setEditing({ ...editing, email_body_html: e.target.value })} rows={6} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono" /></label>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs"><AlertTriangle className="w-4 h-4" /> WhatsApp sending activates in R26.4b.</div>
                  <label className="text-xs font-semibold block">WhatsApp template name
                    <input value={editing.whatsapp_template_name} onChange={(e) => setEditing({ ...editing, whatsapp_template_name: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.name || save.isPending} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
