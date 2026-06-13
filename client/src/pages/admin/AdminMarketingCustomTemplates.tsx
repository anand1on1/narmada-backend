import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Trash2, Pencil } from "lucide-react";

// R26.5 (I) — Custom WhatsApp templates over /api/admin/marketing/whatsapp-templates.
// These are operator-defined approved templates (separate from the built-in defaults).
interface WaTemplate {
  id: number; template_name: string; display_name: string | null; category: string | null;
  language: string | null; header_type: string | null; variable_count: number | null;
  variable_labels: string | null; status: string | null; is_default: number | null;
}
interface Draft { id?: number; name: string; display_name: string; category: string; language: string; variableLabels: string; status: string; }

const fmtVars = (labels: string | null, count: number | null) => {
  try { const arr = labels ? JSON.parse(labels) : []; if (Array.isArray(arr) && arr.length) return arr.join(", "); } catch { /* ignore */ }
  return count ? `${count} variable(s)` : "—";
};

export default function AdminMarketingCustomTemplates() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<WaTemplate[]>([]);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/marketing/whatsapp-templates");
    if (r.ok) setItems(await r.json()); else setItems([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  function newTpl() { setEdit({ name: "", display_name: "", category: "marketing", language: "en", variableLabels: "", status: "active" }); }
  function editTpl(t: WaTemplate) {
    let labels = "";
    try { const arr = t.variable_labels ? JSON.parse(t.variable_labels) : []; if (Array.isArray(arr)) labels = arr.join(", "); } catch { /* ignore */ }
    setEdit({ id: t.id, name: t.template_name, display_name: t.display_name || "", category: t.category || "marketing", language: t.language || "en", variableLabels: labels, status: t.status || "active" });
  }

  async function save() {
    if (!token || !edit) return;
    if (!edit.name.trim()) { alert("Template name is required."); return; }
    setBusy(true);
    try {
      const labelsArr = edit.variableLabels.split(",").map((s) => s.trim()).filter(Boolean);
      const body = JSON.stringify({
        name: edit.name.trim(), display_name: edit.display_name || edit.name.trim(),
        category: edit.category, language: edit.language, status: edit.status,
        variable_count: labelsArr.length, variable_labels: JSON.stringify(labelsArr),
      });
      const isNew = !edit.id;
      const r = await adminFetch(token, isNew ? "/api/admin/marketing/whatsapp-templates" : `/api/admin/marketing/whatsapp-templates/${edit.id}`, { method: isNew ? "POST" : "PATCH", body });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      setEdit(null); load();
    } finally { setBusy(false); }
  }

  async function del(t: WaTemplate) {
    if (!token || t.is_default || !confirm(`Delete template "${t.template_name}"?`)) return;
    const r = await adminFetch(token, `/api/admin/marketing/whatsapp-templates/${t.id}`, { method: "DELETE" });
    if (!r.ok) { alert("Failed"); return; }
    load();
  }

  return (
    <AdminLayout title="Marketing — Custom Templates">
      <MarketingTabs active="custom-templates" />
      <div className="flex justify-end mb-4">
        <button onClick={newTpl} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-indigo-700" data-testid="button-new-custom-template"><Plus className="w-4 h-4" /> New Custom Template</button>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Template</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Lang</th>
              <th className="text-left px-4 py-3">Variables</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No custom templates.</td></tr>
            ) : items.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50" data-testid={`row-custom-template-${t.id}`}>
                <td className="px-4 py-3"><div className="font-medium text-slate-900">{t.display_name || t.template_name}</div><div className="text-xs font-mono text-slate-500">{t.template_name}{t.is_default ? <span className="ml-2 uppercase font-bold text-[10px]">default</span> : null}</div></td>
                <td className="px-4 py-3 text-slate-600 capitalize">{t.category || "—"}</td>
                <td className="px-4 py-3 text-slate-600 uppercase">{t.language || "en"}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{fmtVars(t.variable_labels, t.variable_count)}</td>
                <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">{t.status || "active"}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {!t.is_default && <button onClick={() => editTpl(t)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Edit" data-testid={`button-edit-custom-template-${t.id}`}><Pencil className="w-4 h-4" /></button>}
                    {!t.is_default && <button onClick={() => del(t)} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" title="Delete" data-testid={`button-delete-custom-template-${t.id}`}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{edit.id ? "Edit Custom Template" : "New Custom Template"}</h2>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Template Name (WhatsApp-approved name) *
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono font-normal" data-testid="input-custom-template-name" /></label>
              <label className="text-xs font-semibold block">Display Name
                <input value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold block">Category
                  <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
                    <option value="marketing">marketing</option><option value="utility">utility</option><option value="authentication">authentication</option>
                  </select></label>
                <label className="text-xs font-semibold block">Language
                  <input value={edit.language} onChange={(e) => setEdit({ ...edit, language: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
              </div>
              <label className="text-xs font-semibold block">Variable Labels (comma-separated, in order)
                <input value={edit.variableLabels} onChange={(e) => setEdit({ ...edit, variableLabels: e.target.value })} placeholder="e.g. customer_name, order_id" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" data-testid="input-custom-template-vars" /></label>
              <label className="text-xs font-semibold block">Status
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
                  <option value="active">active</option><option value="paused">paused</option>
                </select></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} disabled={!edit.name.trim() || busy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="button-save-custom-template">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
