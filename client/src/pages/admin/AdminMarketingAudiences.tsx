import { useState, useEffect } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users, Eye, SlidersHorizontal } from "lucide-react";
import { AudienceBuilder } from "./AdminMarketingAudienceBuilder";

interface Audience { id: number; name: string; description: string | null; filter_json: string; recipient_count: number; }

export default function AdminMarketingAudiences() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<Audience | null>(null);
  const [previewFor, setPreviewFor] = useState<{ total: number; sample: Array<{ name: string; email: string | null; type: string }> } | null>(null);
  const [refineFor, setRefineFor] = useState<Audience | null>(null);

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
                    <button onClick={() => setRefineFor(a)} className="p-1.5 rounded hover:bg-amber-50 text-amber-600" title="Refine (include/exclude)" data-testid={`button-refine-audience-${a.id}`}><SlidersHorizontal className="w-4 h-4" /></button>
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

      {refineFor && (
        <AudienceRefine
          audience={refineFor}
          onClose={() => setRefineFor(null)}
          onSaved={() => { setRefineFor(null); qc.invalidateQueries({ queryKey: ["marketing-audiences"] }); }}
        />
      )}
    </AdminLayout>
  );
}

interface Customer { id: number; name: string | null; email: string | null; phone: string | null; }
interface PreviewResult { customers: Array<{ id: number; name: string | null; email: string | null }>; summary: { matched: number; included_extra: number; excluded: number; final_count: number }; }

// R26.5 (I2) — manual include/exclude refinement on top of an audience's base filter.
// Operates on customer IDs via PATCH /api/admin/audiences/:id, previews via .../preview.
function AudienceRefine({ audience, onClose, onSaved }: { audience: Audience; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [exclude, setExclude] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await adminFetch(token, `/api/admin/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      if (r.ok) setCustomers((await r.json()).slice(0, 100));
    })();
  }, [token, q]);

  function toggle(set: Set<number>, setter: (s: Set<number>) => void, other: Set<number>, otherSetter: (s: Set<number>) => void, id: number) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else { next.add(id); if (other.has(id)) { const o = new Set(other); o.delete(id); otherSetter(o); } }
    setter(next);
  }

  async function doPreview() {
    if (!token) return;
    // Persist current selection first so the preview reflects it.
    await adminFetch(token, `/api/admin/audiences/${audience.id}`, { method: "PATCH", body: JSON.stringify({ include_user_ids: Array.from(include), exclude_user_ids: Array.from(exclude) }) });
    const r = await adminFetch(token, `/api/admin/audiences/${audience.id}/preview`);
    if (r.ok) setPreview(await r.json());
  }

  async function save() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/audiences/${audience.id}`, { method: "PATCH", body: JSON.stringify({ include_user_ids: Array.from(include), exclude_user_ids: Array.from(exclude) }) });
      if (!r.ok) { toast({ title: "Error", description: (await r.json()).error || "Failed", variant: "destructive" }); return; }
      toast({ title: "Audience refined" });
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-1">Refine “{audience.name}”</h2>
        <p className="text-xs text-slate-500 mb-4">Manually include extra customers or exclude customers from the base filter. Selections are by customer.</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" className="w-full border rounded-lg px-3 py-2 text-sm mb-3" data-testid="search-refine-customers" />
        <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
          {customers.length === 0 ? <div className="p-6 text-center text-sm text-slate-400">No customers.</div> : customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`refine-customer-${c.id}`}>
              <div><div className="font-medium">{c.name || "(no name)"}</div><div className="text-xs text-slate-500">{c.email || c.phone || ""}</div></div>
              <div className="flex gap-1.5">
                <button onClick={() => toggle(include, setInclude, exclude, setExclude, c.id)} className={`px-2 py-1 text-xs rounded font-semibold ${include.has(c.id) ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700"}`} data-testid={`button-include-${c.id}`}>Include</button>
                <button onClick={() => toggle(exclude, setExclude, include, setInclude, c.id)} className={`px-2 py-1 text-xs rounded font-semibold ${exclude.has(c.id) ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700"}`} data-testid={`button-exclude-${c.id}`}>Exclude</button>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-2">{include.size} included · {exclude.size} excluded</div>
        {preview && (
          <div className="mt-3 text-sm bg-slate-50 border rounded-lg p-3">
            <div className="font-semibold mb-1">Preview: {preview.summary.final_count} recipients</div>
            <div className="text-xs text-slate-500">matched {preview.summary.matched} · +{preview.summary.included_extra} included · −{preview.summary.excluded} excluded</div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={doPreview} className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-1.5" data-testid="button-preview-audience"><Eye className="w-4 h-4" /> Preview</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-save-refine">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
