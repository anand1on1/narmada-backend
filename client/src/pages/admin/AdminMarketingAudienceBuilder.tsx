import { useMemo, useState } from "react";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { Users } from "lucide-react";

interface Audience { id: number; name: string; description: string | null; filter_json: string; }

type AudienceType = "customers" | "sellers" | "all";

const INDIAN_STATES = [
  "", "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Gujarat", "Haryana", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu",
  "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export function AudienceBuilder({ existing, onClose, onSaved }: { existing: Audience | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth();
  const { toast } = useToast();

  const initial = useMemo(() => {
    if (!existing) return { name: "", description: "", type: "customers" as AudienceType, state: "", lastOrderAfter: "", minSpend: "" };
    try {
      const f = JSON.parse(existing.filter_json);
      return {
        name: existing.name,
        description: existing.description || "",
        type: (f.audience_type || "customers") as AudienceType,
        state: f.filters?.state || "",
        lastOrderAfter: f.filters?.last_order_after ? new Date(f.filters.last_order_after).toISOString().slice(0, 10) : "",
        minSpend: f.filters?.min_spend != null ? String(f.filters.min_spend) : "",
      };
    } catch {
      return { name: existing.name, description: existing.description || "", type: "customers" as AudienceType, state: "", lastOrderAfter: "", minSpend: "" };
    }
  }, [existing]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [type, setType] = useState<AudienceType>(initial.type);
  const [state, setState] = useState(initial.state);
  const [lastOrderAfter, setLastOrderAfter] = useState(initial.lastOrderAfter);
  const [minSpend, setMinSpend] = useState(initial.minSpend);
  const [preview, setPreview] = useState<{ total: number; sample: Array<{ name: string; email: string | null }> } | null>(null);
  const [busy, setBusy] = useState(false);

  function buildFilter() {
    const filters: Record<string, unknown> = {};
    if (state) filters.state = state;
    if (lastOrderAfter) filters.last_order_after = new Date(lastOrderAfter).getTime();
    if (minSpend) filters.min_spend = Number(minSpend);
    const filter: Record<string, unknown> = { audience_type: type };
    if (Object.keys(filters).length > 0) filter.filters = filters;
    return filter;
  }

  async function doPreview() {
    const r = await adminFetch(token, `/api/marketing/audiences/preview`, { method: "POST", body: JSON.stringify({ filter: buildFilter() }) });
    if (r.ok) setPreview(await r.json());
    else toast({ title: "Preview failed", variant: "destructive" });
  }

  async function save() {
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setBusy(true);
    const body = JSON.stringify({ name, description, filter_json: JSON.stringify(buildFilter()) });
    const r = existing
      ? await adminFetch(token, `/api/marketing/audiences/${existing.id}`, { method: "PATCH", body })
      : await adminFetch(token, `/api/marketing/audiences`, { method: "POST", body });
    setBusy(false);
    if (r.ok) { toast({ title: existing ? "Audience updated" : "Audience created" }); onSaved(); }
    else toast({ title: "Save failed", variant: "destructive" });
  }

  // State/spend filters only meaningful for customers (sellers have no orders here).
  const showOrderFilters = type === "customers";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-4">{existing ? "Edit Audience" : "New Audience"}</h2>
        <div className="space-y-3">
          <label className="text-xs font-semibold block">Name *
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold block">Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold block">Type
            <select value={type} onChange={(e) => setType(e.target.value as AudienceType)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
              <option value="customers">Customers</option>
              <option value="sellers">Sellers</option>
              <option value="all">All (Customers + Sellers)</option>
            </select></label>
          <label className="text-xs font-semibold block">State
            <select value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s || "Any state"}</option>)}
            </select></label>
          {showOrderFilters && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold block">Last order after
                <input type="date" value={lastOrderAfter} onChange={(e) => setLastOrderAfter(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Min spend (₹)
                <input type="number" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
            </div>
          )}
        </div>

        <div className="mt-4">
          <button onClick={doPreview} className="px-3 py-1.5 border rounded-lg text-sm inline-flex items-center gap-2"><Users className="w-4 h-4" /> Preview recipients</button>
          {preview && (
            <div className="border rounded-lg p-3 bg-slate-50 mt-3 text-sm">
              <div className="font-semibold mb-1">{preview.total} recipient{preview.total === 1 ? "" : "s"}</div>
              <div className="text-xs text-slate-600 space-y-0.5">
                {preview.sample.slice(0, 5).map((s, i) => <div key={i}>• {s.name || "(no name)"} {s.email ? `— ${s.email}` : ""}</div>)}
                {preview.total > 5 && <div className="text-slate-400">…and {preview.total - 5} more</div>}
                {preview.total === 0 && <div className="text-slate-400">No matching recipients.</div>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={save} disabled={busy || !name} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">{existing ? "Update" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
