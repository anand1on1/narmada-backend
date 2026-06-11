import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Star } from "lucide-react";

interface Company {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  bankName: string | null;
  bankBranch: string | null;
  accountNo: string | null;
  ifsc: string | null;
  beneficiaryName: string | null;
  signatoryName: string | null;
  signatoryPhone: string | null;
  signatoryEmail: string | null;
  isDefault: boolean;
}

const FIELDS: [keyof Company, string][] = [
  ["name", "Company Name *"], ["gstin", "GSTIN"], ["pan", "PAN"],
  ["addressLine1", "Address Line 1"], ["addressLine2", "Address Line 2"],
  ["city", "City"], ["state", "State"], ["pincode", "Pincode"],
  ["bankName", "Bank Name"], ["bankBranch", "Bank Branch"], ["accountNo", "Account No"], ["ifsc", "IFSC"],
  ["beneficiaryName", "Beneficiary"], ["signatoryName", "Signatory"], ["signatoryPhone", "Signatory Phone"], ["signatoryEmail", "Signatory Email"],
];

export default function AdminCompanies() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Company> | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["admin-companies"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/companies`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  const save = useMutation({
    mutationFn: async (c: Partial<Company>) => {
      const url = c.id ? `/api/admin/companies/${c.id}` : `/api/admin/companies`;
      const r = await adminFetch(token, url, { method: c.id ? "PATCH" : "POST", body: JSON.stringify(c) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-companies"] }); setEditing(null); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setDefault = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/companies/${id}/set-default`, { method: "POST" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-companies"] }); toast({ title: "Default company updated" }); },
  });

  const del = useMutation({
    mutationFn: async (id: number) => { await adminFetch(token, `/api/admin/companies/${id}`, { method: "DELETE" }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-companies"] }); toast({ title: "Deleted" }); },
  });

  return (
    <AdminLayout title="Quoting / Billing Companies">
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing({ name: "" })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Company
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading ? <div className="p-12 text-center text-muted-foreground col-span-2">Loading…</div> :
          companies.length === 0 ? <div className="p-12 text-center text-muted-foreground col-span-2">No companies yet.</div> :
          companies.map((c) => (
            <div key={c.id} className="bg-card border rounded-xl p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-lg flex items-center gap-2">{c.name}
                    {c.isDefault && <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 font-bold uppercase">Default</span>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{c.code}</div>
                </div>
                <div className="flex gap-1">
                  {!c.isDefault && <button onClick={() => setDefault.mutate(c.id)} className="p-1.5 rounded hover:bg-muted" title="Set default"><Star className="w-4 h-4" /></button>}
                  <button onClick={() => setEditing(c)} className="p-1.5 rounded hover:bg-muted" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => { if (confirm(`Delete ${c.name}?`)) del.mutate(c.id); }} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="mt-3 text-sm space-y-1 text-muted-foreground">
                {c.gstin && <div>GSTIN: <span className="font-mono text-foreground">{c.gstin}</span></div>}
                {(c.addressLine1 || c.city) && <div>{[c.addressLine1, c.addressLine2, c.city, c.state, c.pincode].filter(Boolean).join(", ")}</div>}
                {c.bankName && <div>{c.bankName} · A/c {c.accountNo} · {c.ifsc}</div>}
                {c.signatoryName && <div>Signatory: {c.signatoryName} {c.signatoryPhone && `(${c.signatoryPhone})`}</div>}
              </div>
            </div>
          ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">{editing.id ? "Edit" : "New"} Company</h2>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(([k, label]) => (
                <label key={k} className="text-xs font-semibold">{label}
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
    </AdminLayout>
  );
}
