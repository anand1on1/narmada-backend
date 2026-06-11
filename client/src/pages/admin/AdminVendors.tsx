import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Upload, Search } from "lucide-react";

interface Vendor {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  categories: string | null;
  isActive: boolean;
}

const EMPTY: Partial<Vendor> = { name: "", phone: "", email: "", city: "", state: "", gstin: "", categories: "" };

export default function AdminVendors() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Vendor> | null>(null);
  const [csv, setCsv] = useState("");
  const [showImport, setShowImport] = useState(false);

  const { data: vendors = [], isLoading } = useQuery<Vendor[]>({
    queryKey: ["admin-vendors", q],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendors?q=${encodeURIComponent(q)}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (v: Partial<Vendor>) => {
      const url = v.id ? `/api/admin/vendors/${v.id}` : `/api/admin/vendors`;
      const r = await adminFetch(token, url, { method: v.id ? "PUT" : "POST", body: JSON.stringify(v) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); setEditing(null); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/admin/vendors/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); toast({ title: "Deleted" }); },
  });

  const doImport = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendors/bulk-import`, { method: "POST", body: JSON.stringify({ csv }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Import failed");
      return r.json();
    },
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); setShowImport(false); setCsv(""); toast({ title: `Imported ${d.inserted ?? d.count ?? 0} vendors` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout title="Vendors / Suppliers">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" />
        </div>
        <button onClick={() => setEditing({ ...EMPTY })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Vendor
        </button>
        <button onClick={() => setShowImport(true)} className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Upload className="w-4 h-4" /> Bulk Import
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {isLoading ? <div className="p-12 text-center text-muted-foreground">Loading…</div> :
          vendors.length === 0 ? <div className="p-12 text-center text-muted-foreground">No vendors yet.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Code</th>
              <th className="px-3 py-3 font-semibold">Name</th>
              <th className="px-3 py-3 font-semibold">Phone</th>
              <th className="px-3 py-3 font-semibold">City</th>
              <th className="px-3 py-3 font-semibold">GSTIN</th>
              <th className="px-3 py-3 font-semibold">Categories</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{v.code}</td>
                  <td className="px-3 py-3 font-semibold">{v.name}</td>
                  <td className="px-3 py-3">{v.phone || "—"}</td>
                  <td className="px-3 py-3">{v.city || "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{v.gstin || "—"}</td>
                  <td className="px-3 py-3 text-xs">{v.categories || "—"}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(v)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => { if (confirm(`Delete ${v.name}?`)) del.mutate(v.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{editing.id ? "Edit" : "New"} Vendor</h2>
            <div className="grid grid-cols-2 gap-3">
              {([["name", "Name *"], ["phone", "Phone"], ["email", "Email"], ["city", "City"], ["state", "State"], ["gstin", "GSTIN"], ["categories", "Categories (comma-sep)"]] as const).map(([k, label]) => (
                <label key={k} className={`text-xs font-semibold ${k === "categories" ? "col-span-2" : ""}`}>
                  {label}
                  <input value={(editing as any)[k] || ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.name || save.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">Bulk Import Vendors (CSV)</h2>
            <p className="text-xs text-muted-foreground mb-3">Headers: name, phone, email, city, state, gstin, categories</p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10}
              placeholder="name,phone,city&#10;ABC Auto,9876543210,Delhi"
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm font-mono" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => doImport.mutate()} disabled={!csv.trim() || doImport.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Import</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
