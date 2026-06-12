import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Search } from "lucide-react";

interface Seller {
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
  notes: string | null;
  isActive: boolean;
}

const EMPTY: Partial<Seller> = {
  name: "", phone: "", whatsapp: "", email: "",
  address: "", city: "", state: "", pincode: "",
  gstin: "", pan: "", paymentTerms: "",
  brands: "", categories: "", notes: "",
};

export default function TeamSellers() {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [editing, setEditing] = useState<Partial<Seller> | null>(null);

  const { data: sellers = [], isLoading } = useQuery<Seller[]>({
    queryKey: ["team-sellers", searchQ],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/sellers?q=${encodeURIComponent(searchQ)}`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (s: Partial<Seller>) => {
      const isUpdate = !!s.id;
      const url = isUpdate ? `/api/team/sellers/${s.id}` : `/api/team/sellers`;
      const { id, ...body } = s as any;
      const r = await teamFetch(token, url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isUpdate ? body : s),
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
      qc.invalidateQueries({ queryKey: ["team-sellers"] });
      setEditing(null);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const r = await teamFetch(token, `/api/team/sellers/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const text = await r.text();
        let msg = "Delete failed";
        try { msg = JSON.parse(text).error || msg; } catch { msg = text.slice(0, 120) || msg; }
        throw new Error(msg);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-sellers"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Field config: [key, label, span (1 or 2), placeholder?]
  const FIELDS: Array<[keyof Seller, string, 1 | 2, string?]> = [
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
    <TeamLayout title="Sellers">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchQ(q)}
            placeholder="Search sellers by name, phone, city, GST…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" />
        </div>
        <button onClick={() => setSearchQ(q)} className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Search</button>
        <button onClick={() => setEditing({ ...EMPTY })} className="ml-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:opacity-90">
          <Plus className="w-4 h-4" /> Add Seller
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {isLoading ? <div className="p-12 text-center text-muted-foreground">Loading…</div> :
          sellers.length === 0 ? <div className="p-12 text-center text-muted-foreground">No sellers yet.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Name</th>
              <th className="px-3 py-3 font-semibold">Phone</th>
              <th className="px-3 py-3 font-semibold">City/State</th>
              <th className="px-3 py-3 font-semibold">GST</th>
              <th className="px-3 py-3 font-semibold">Brands</th>
              <th className="px-3 py-3 font-semibold">Payment Terms</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {sellers.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3 font-semibold">{s.name}</td>
                  <td className="px-3 py-3">{s.phone || s.whatsapp || "—"}</td>
                  <td className="px-3 py-3 text-xs">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{s.gstin || "—"}</td>
                  <td className="px-3 py-3 text-xs">{s.brands || "—"}</td>
                  <td className="px-3 py-3 text-xs">{s.paymentTerms || "—"}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(s)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => { if (confirm(`Delete ${s.name}?`)) del.mutate(s.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
            <h2 className="font-bold text-lg mb-4">{editing.id ? "Edit" : "New"} Seller</h2>
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
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 hover:opacity-90">
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeamLayout>
  );
}
