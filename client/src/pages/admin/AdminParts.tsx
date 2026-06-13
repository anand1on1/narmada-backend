import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, Plus, Pencil, Trash2 } from "lucide-react";

// R26.5 (A4) — repointed to /api/admin/parts (seeded 30 Tata/Ashok Leyland parts).
// Returns camelCase enriched rows. Adds CRUD modal (POST/PATCH/DELETE).
interface Part {
  id?: number;
  partNumber: string;
  name?: string | null;
  brand: string | null;
  hsn?: string | null;
  gstRate?: number | null;
  lastMrp?: number | null;
  description?: string | null;
  lastCustomerName?: string | null;
  lastDiscount?: number | null;
  lastQuotedAt?: number | null;
}

export default function AdminParts() {
  const { token } = useAdminAuth();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Part | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: parts = [], isFetching, refetch } = useQuery<Part[]>({
    queryKey: ["admin-parts", search],
    queryFn: async () => {
      if (search.length < 3) return [];
      const r = await adminFetch(token, `/api/admin/parts?q=${encodeURIComponent(search)}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && search.length >= 3,
  });

  function doSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q.trim());
  }

  async function savePart() {
    if (!token || !edit) return;
    if (!edit.partNumber?.trim() || !edit.name?.trim()) { alert("Part number and name are required."); return; }
    setBusy(true);
    try {
      const isNew = !edit.id && !parts.some((p) => p.partNumber === edit.partNumber);
      const url = isNew ? `/api/admin/parts` : `/api/admin/parts/${encodeURIComponent(edit.partNumber)}`;
      const method = isNew ? "POST" : "PATCH";
      const body = JSON.stringify({
        partNumber: edit.partNumber, name: edit.name, brand: edit.brand,
        hsn: edit.hsn, gstRate: edit.gstRate, lastMrp: edit.lastMrp,
      });
      const r = await adminFetch(token, url, { method, body });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      setEdit(null);
      if (search.length >= 3) refetch();
    } finally { setBusy(false); }
  }

  async function delPart(partNumber: string) {
    if (!token || !confirm(`Delete part ${partNumber}?`)) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/parts/${encodeURIComponent(partNumber)}`, { method: "DELETE" });
      if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
      refetch();
    } finally { setBusy(false); }
  }

  return (
    <AdminLayout title="Parts Master">
      <div className="bg-card border rounded-xl p-5 shadow-sm mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm text-muted-foreground">
            Search the parts catalogue. Enter at least 3 characters of a part number or description.
          </p>
          <button
            onClick={() => setEdit({ partNumber: "", name: "", brand: "", hsn: "", gstRate: null, lastMrp: null })}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            data-testid="button-new-part"
          >
            <Plus className="w-4 h-4" /> New Part
          </button>
        </div>
        <form onSubmit={doSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. 2723 or brake pad or clutch…"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
            data-testid="input-parts-search"
          />
          <button
            type="submit"
            disabled={q.trim().length < 3}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Search className="w-4 h-4" /> Search
          </button>
        </form>
      </div>

      {search.length >= 3 && (
        <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
          {isFetching ? (
            <div className="p-12 text-center text-muted-foreground">Searching…</div>
          ) : parts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
              <Package className="w-10 h-10 opacity-30" />
              <span>No parts found for "{search}".</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-3 font-semibold">Part Number</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold text-right">Last MRP</th>
                  <th className="px-4 py-3 font-semibold">Last Customer</th>
                  <th className="px-4 py-3 font-semibold text-right">Last Disc %</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {parts.map((p, i) => (
                  <tr key={p.partNumber || i} className="hover:bg-muted/30" data-testid={`row-part-${p.partNumber}`}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{p.partNumber}</td>
                    <td className="px-4 py-3 text-xs">{p.name || p.description || "—"}</td>
                    <td className="px-4 py-3">{p.brand || "—"}</td>
                    <td className="px-4 py-3 text-xs text-right">{p.lastMrp != null ? `₹${Number(p.lastMrp).toLocaleString("en-IN")}` : "—"}</td>
                    <td className="px-4 py-3 text-xs">{p.lastCustomerName || "—"}</td>
                    <td className="px-4 py-3 text-xs text-right">{p.lastDiscount != null ? `${p.lastDiscount}%` : "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEdit({ ...p, name: p.name || p.description || "" })} className="p-2 hover:bg-muted rounded mr-1" data-testid={`button-edit-part-${p.partNumber}`}><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => delPart(p.partNumber)} disabled={busy} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-part-${p.partNumber}`}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{edit.id || parts.some((p) => p.partNumber === edit.partNumber) ? "Edit Part" : "New Part"}</h2>
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <PField label="Part Number *"><input value={edit.partNumber} disabled={!!edit.id || parts.some((p) => p.partNumber === edit.partNumber)} onChange={(e) => setEdit({ ...edit, partNumber: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background disabled:opacity-60" data-testid="input-part-number" /></PField>
              <PField label="Name *"><input value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-part-name" /></PField>
              <PField label="Brand"><input value={edit.brand || ""} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></PField>
              <div className="grid grid-cols-3 gap-3">
                <PField label="HSN"><input value={edit.hsn || ""} onChange={(e) => setEdit({ ...edit, hsn: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></PField>
                <PField label="GST %"><input type="number" value={edit.gstRate ?? ""} onChange={(e) => setEdit({ ...edit, gstRate: e.target.value === "" ? null : parseFloat(e.target.value) })} className="w-full border rounded-lg px-3 py-2 bg-background" /></PField>
                <PField label="Last MRP"><input type="number" value={edit.lastMrp ?? ""} onChange={(e) => setEdit({ ...edit, lastMrp: e.target.value === "" ? null : parseFloat(e.target.value) })} className="w-full border rounded-lg px-3 py-2 bg-background" /></PField>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={savePart} disabled={busy} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold" data-testid="button-save-part">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function PField({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
