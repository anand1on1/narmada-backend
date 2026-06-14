import { useEffect, useMemo, useState } from "react";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, X } from "lucide-react";

interface Audience { id: number; name: string; description: string | null; filter_json: string; }

type AudienceType = "customers" | "sellers" | "leads" | "all";

interface Contact { typed_id: string; id: number; name: string; phone: string | null; email: string | null; }

const INDIAN_STATES = [
  "", "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Gujarat", "Haryana", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu",
  "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

// Map the audience source radio to the contacts-endpoint source key.
const SOURCE_KEY: Record<AudienceType, string> = { customers: "customers", sellers: "sellers", leads: "leads", all: "customers" };

export function AudienceBuilder({ existing, onClose, onSaved }: { existing: Audience | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAdminAuth();
  const { toast } = useToast();

  const initial = useMemo(() => {
    if (!existing) return { name: "", description: "", type: "customers" as AudienceType, state: "", lastOrderAfter: "", minSpend: "", includeIds: [] as string[], excludeIds: [] as string[] };
    try {
      const f = JSON.parse(existing.filter_json);
      return {
        name: existing.name,
        description: existing.description || "",
        type: (f.audience_type || "customers") as AudienceType,
        state: f.filters?.state || "",
        lastOrderAfter: f.filters?.last_order_after ? new Date(f.filters.last_order_after).toISOString().slice(0, 10) : "",
        minSpend: f.filters?.min_spend != null ? String(f.filters.min_spend) : "",
        includeIds: Array.isArray(f.include_ids) ? f.include_ids : [],
        excludeIds: Array.isArray(f.exclude_ids) ? f.exclude_ids : [],
      };
    } catch {
      return { name: existing.name, description: existing.description || "", type: "customers" as AudienceType, state: "", lastOrderAfter: "", minSpend: "", includeIds: [] as string[], excludeIds: [] as string[] };
    }
  }, [existing]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [type, setType] = useState<AudienceType>(initial.type);
  const [state, setState] = useState(initial.state);
  const [lastOrderAfter, setLastOrderAfter] = useState(initial.lastOrderAfter);
  const [minSpend, setMinSpend] = useState(initial.minSpend);
  const [includeIds, setIncludeIds] = useState<string[]>(initial.includeIds);
  const [excludeIds, setExcludeIds] = useState<string[]>(initial.excludeIds);
  const [preview, setPreview] = useState<{ total: number; sample: Array<{ name: string; email: string | null }> } | null>(null);
  const [busy, setBusy] = useState(false);

  // Contacts for the include/exclude pickers, loaded for the selected source.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQ, setContactQ] = useState("");
  useEffect(() => {
    let cancel = false;
    const src = SOURCE_KEY[type];
    adminFetch(token, `/api/marketing/audiences/contacts?source=${src}&q=${encodeURIComponent(contactQ)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (!cancel) setContacts(rows); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [token, type, contactQ]);

  const contactName = (tid: string) => contacts.find((c) => c.typed_id === tid)?.name || tid;
  function toggle(list: string[], setList: (v: string[]) => void, tid: string) {
    setList(list.includes(tid) ? list.filter((x) => x !== tid) : [...list, tid]);
  }

  function buildFilter() {
    const filters: Record<string, unknown> = {};
    if (state) filters.state = state;
    if (lastOrderAfter) filters.last_order_after = new Date(lastOrderAfter).getTime();
    if (minSpend) filters.min_spend = Number(minSpend);
    const filter: Record<string, unknown> = { audience_type: type };
    if (Object.keys(filters).length > 0) filter.filters = filters;
    if (includeIds.length) filter.include_ids = includeIds;
    if (excludeIds.length) filter.exclude_ids = excludeIds;
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

  // State/spend filters only meaningful for customers (sellers/leads have no orders here).
  const showOrderFilters = type === "customers";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-4">{existing ? "Edit Audience" : "New Audience"}</h2>
        <div className="space-y-3">
          <label className="text-xs font-semibold block">Name *
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold block">Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>

          <div>
            <span className="text-xs font-semibold block mb-1">Source</span>
            <div className="flex gap-2 flex-wrap">
              {(["customers", "sellers", "leads", "all"] as AudienceType[]).map((t) => (
                <label key={t} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${type === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`}>
                  <input type="radio" name="aud-source" className="hidden" checked={type === t} onChange={() => setType(t)} data-testid={`radio-source-${t}`} />
                  {t === "sellers" ? "Vendors" : t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </div>

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

          {/* Include / Exclude overrides */}
          <div className="border rounded-lg p-3 bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">Manual include / exclude</span>
              <input value={contactQ} onChange={(e) => setContactQ(e.target.value)} placeholder="Search contacts…" className="border rounded px-2 py-1 text-xs w-40" data-testid="search-contacts" />
            </div>
            {(includeIds.length > 0 || excludeIds.length > 0) && (
              <div className="flex flex-wrap gap-1 mb-2">
                {includeIds.map((tid) => <Chip key={tid} label={`+ ${contactName(tid)}`} tone="emerald" onRemove={() => toggle(includeIds, setIncludeIds, tid)} />)}
                {excludeIds.map((tid) => <Chip key={tid} label={`− ${contactName(tid)}`} tone="rose" onRemove={() => toggle(excludeIds, setExcludeIds, tid)} />)}
              </div>
            )}
            <div className="max-h-40 overflow-y-auto divide-y border rounded bg-white">
              {contacts.length === 0 ? (
                <div className="p-3 text-xs text-slate-400">No contacts.</div>
              ) : contacts.map((c) => (
                <div key={c.typed_id} className="flex items-center justify-between px-2 py-1.5 text-xs" data-testid={`contact-${c.typed_id}`}>
                  <span>{c.name}<span className="text-slate-400"> {c.phone || ""}</span></span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => toggle(includeIds, setIncludeIds, c.typed_id)} className={`px-1.5 py-0.5 rounded border ${includeIds.includes(c.typed_id) ? "bg-emerald-600 text-white" : ""}`} title="Include"><Plus className="w-3 h-3" /></button>
                    <button type="button" onClick={() => toggle(excludeIds, setExcludeIds, c.typed_id)} className={`px-1.5 py-0.5 rounded border ${excludeIds.includes(c.typed_id) ? "bg-rose-600 text-white" : ""}`} title="Exclude"><X className="w-3 h-3" /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button onClick={doPreview} className="px-3 py-1.5 border rounded-lg text-sm inline-flex items-center gap-2" data-testid="btn-preview-audience"><Users className="w-4 h-4" /> Preview recipients</button>
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
          <button onClick={save} disabled={busy || !name} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="btn-save-audience">{existing ? "Update" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, tone, onRemove }: { label: string; tone: "emerald" | "rose"; onRemove: () => void }) {
  const c = tone === "emerald" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${c}`}>
      {label}
      <button type="button" onClick={onRemove}><X className="w-3 h-3" /></button>
    </span>
  );
}
