import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users, Eye } from "lucide-react";
import { AudienceBuilder } from "./AdminMarketingAudienceBuilder";

interface Audience { id: number; name: string; description: string | null; filter_json: string; recipient_count: number; }

export default function AdminMarketingAudiences() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<Audience | null>(null);
  const [previewFor, setPreviewFor] = useState<{ total: number; sample: Array<{ name: string; email: string | null; type: string }> } | null>(null);

  const { data: audiences = [], isLoading } = useQuery<Audience[]>({
    queryKey: ["marketing-audiences"],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/audiences`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/marketing/audiences/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-audiences"] }); toast({ title: "Audience deleted" }); },
  });

  const audienceType = (a: Audience) => {
    try { return JSON.parse(a.filter_json).audience_type || "all"; } catch { return "all"; }
  };

  const preview = async (id: number) => {
    const r = await adminFetch(token, `/api/marketing/audiences/${id}/preview`);
    if (r.ok) setPreviewFor(await r.json());
  };

  return (
    <AdminLayout title="Marketing — Audiences">
      <MarketingTabs active="audiences" />
      <div className="flex justify-end mb-4">
        <button onClick={() => { setEditing(null); setShowBuilder(true); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-indigo-700"><Plus className="w-4 h-4" /> New Audience</button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Recipients (live)</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : audiences.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">No audiences.</td></tr>
            ) : audiences.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><div className="font-medium text-slate-900">{a.name}</div>{a.description && <div className="text-xs text-slate-500">{a.description}</div>}</td>
                <td className="px-4 py-3 capitalize text-slate-600">{audienceType(a)}</td>
                <td className="px-4 py-3 text-slate-600"><span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{a.recipient_count}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => preview(a.id)} className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600" title="Preview"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => { setEditing(a); setShowBuilder(true); }} className="px-2 py-1 text-xs rounded hover:bg-slate-100 text-slate-600">Edit</button>
                    <button onClick={() => { if (confirm("Delete audience?")) del.mutate(a.id); }} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPreviewFor(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-3">{previewFor.total} recipient{previewFor.total === 1 ? "" : "s"}</h3>
            <div className="text-sm space-y-1 max-h-80 overflow-auto">
              {previewFor.sample.map((s, i) => <div key={i} className="border-b pb-1">{s.name || "(no name)"} <span className="text-xs text-slate-400 capitalize">({s.type})</span><br /><span className="text-xs text-slate-500">{s.email || "no email"}</span></div>)}
            </div>
            <button onClick={() => setPreviewFor(null)} className="mt-4 px-4 py-2 border rounded-lg text-sm w-full">Close</button>
          </div>
        </div>
      )}

      {showBuilder && (
        <AudienceBuilder
          existing={editing}
          onClose={() => setShowBuilder(false)}
          onSaved={() => { setShowBuilder(false); qc.invalidateQueries({ queryKey: ["marketing-audiences"] }); }}
        />
      )}
    </AdminLayout>
  );
}
