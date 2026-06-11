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
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  paymentTerms: string | null;
  brands: string | null;
  categories: string | null;
  rating: number | null;
  notes: string | null;
  isActive: boolean;
}

const EMPTY: Partial<Vendor> = {
  name: "", phone: "", whatsapp: "", email: "",
  address: "", city: "", state: "", pincode: "",
  gstin: "", pan: "", paymentTerms: "",
  brands: "", categories: "", notes: "",
};

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
      const isUpdate = !!v.id;
      const url = isUpdate ? `/api/admin/vendors/${v.id}` : `/api/admin/vendors`;
      // Strip id from body on update so backend doesn't reject
      const { id, ...body } = v as any;
      const r = await adminFetch(token, url, {
        method: isUpdate ? "PATCH" : "POST",
        body: JSON.stringify(isUpdate ? body : v),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = "Save failed";
        try { msg = JSON.parse(text).error || msg; } catch { msg = text.slice(0, 120) || msg; }
        throw new Error(msg);
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      setEditing(null);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/admin/vendors/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-vendors"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const doImport = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendors/bulk-import`, { method: "POST", body: JSON.stringify({ csv }) });
      if (!r.ok) {
        const t = await r.text();
        let msg = "Import failed";
        try { msg = JSON.parse(t).error || msg; } catch { msg = t.slice(0, 120) || msg; }
        throw new Error(msg);
      }
      return r.json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      setShowImport(false);
      setCsv("");
      toast({ title: `Imported ${d.inserted ?? d.count ?? 0} vendors` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Field config: [key, label, span (1 or 2), placeholder?]
  const FIELDS: Array<[keyof Vendor, string, 1 | 2, string?]> = [
    ["name", "Name *", 2],
    ["phone", "Phone", 1, "9876543210"],
    ["whatsapp", "WhatsApp", 1, "9876543210"],
    ["email", "Email", 2],
    ["address", "Address", 2],
    ["city", "City", 1],
    ["state", "State", 1],
    ["pincode", "Pincode", 1],
    ["gstin", "GSTIN", 1, "10ASWPP6442P1ZZ"],
    ["pan", "PAN", 1],
    ["paymentTerms", "Payment Terms", 1, "15 days / Advance"],
    ["brands", "Brands (comma-sep)", 2, "Tata, Ashok Leyland"],
    ["categories", "Categories (comma-sep)", 2, "Engine, Fuel System"],
    ["notes", "Notes", 2],
  ];

  return (
    <AdminLayout title="Vendors / Sellers">
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
              <th className="px-3 py-3 font-semibold">Phone / WA</th>
              <th className="px-3 py-3 font-semibold">City</th>
              <th className="px-3 py-3 font-semibold">Brands</th>
              <th className="px-3 py-3 font-semibold">Payment</th>
              <th className="px-3 py-3 font-semibold">GSTIN</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {vendors.map((v) => (
                <tr key={v.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3 font-mono text-xs">{v.code}</td>
                  <td className="px-3 py-3 font-semibold">{v.name}</td>
                  <td className="px-3 py-3">{v.phone || v.whatsapp || "—"}</td>
                  <td className="px-3 py-3">{v.city || "—"}</td>
                  <td className="px-3 py-3 text-xs">{v.brands || "—"}</td>
                  <td className="px-3 py-3 text-xs">{v.paymentTerms || "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{v.gstin || "—"}</td>
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
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{editing.id ? "Edit" : "New"} Vendor</h2>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(([k, label, span, placeholder]) => (
                <label key={k as string} className={`text-xs font-semibold ${span === 2 ? "col-span-2" : ""}`}>
                  {label}
                  <input
                    value={((editing as any)[k] ?? "") as string}
                    onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
                    placeholder={placeholder || ""}
                    className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => save.mutate(editing)} disabled={!editing.name || save.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowImport(false)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">Bulk Import Vendors (CSV)</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Headers: <code>code, name, gstin, pan, phone, whatsapp, email, address, city, state, pincode, payment_terms, brands, categories</code>
            </p>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10}
              placeholder="name,phone,whatsapp,brands,payment_terms&#10;Bharat Auto Parts,9876543210,9876543210,Tata|Ashok Leyland,15 days"
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm font-mono" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => doImport.mutate()} disabled={!csv.trim() || doImport.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
                {doImport.isPending ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
