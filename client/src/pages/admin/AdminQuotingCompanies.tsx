import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Building2, ToggleLeft, ToggleRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface QuotingCompany {
  id: number;
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  quotePrefix: string | null;
  defaultTerms: string | null;
  active: boolean;
  createdAt: number;
}

const empty: Partial<QuotingCompany> = {
  name: "", gstin: "", pan: "", address: "", city: "Patna", state: "Bihar", pincode: "",
  phone: "", email: "", bankName: "", bankAccount: "", bankIfsc: "", bankBranch: "",
  logoUrl: "", signatureUrl: "", quotePrefix: "NM", defaultTerms: "", active: true,
};

export default function AdminQuotingCompanies() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Partial<QuotingCompany> | null>(null);

  const { data: items = [], isLoading } = useQuery<QuotingCompany[]>({
    queryKey: ["quoting-companies"],
    queryFn: async () => {
      const r = await adminFetch(token, "/api/admin/quoting-companies");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const saveMut = useMutation({
    mutationFn: async (item: Partial<QuotingCompany>) => {
      const isNew = !item.id;
      const url = isNew ? "/api/admin/quoting-companies" : `/api/admin/quoting-companies/${item.id}`;
      const r = await adminFetch(token, url, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(item) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quoting-companies"] });
      setOpen(null);
      toast({ title: "Saved successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/admin/quoting-companies/${id}`, { method: "DELETE" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Delete failed"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quoting-companies"] });
      toast({ title: "Deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = async (c: QuotingCompany) => {
    const r = await adminFetch(token, `/api/admin/quoting-companies/${c.id}`, {
      method: "PATCH", body: JSON.stringify({ active: !c.active }),
    });
    if (r.ok) qc.invalidateQueries({ queryKey: ["quoting-companies"] });
  };

  return (
    <AdminLayout title="Quoting Companies">
      <div className="flex gap-2 mb-4 items-center">
        <Building2 className="w-5 h-5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{items.length} compan{items.length === 1 ? "y" : "ies"}</span>
        <div className="flex-1" />
        <button onClick={() => setOpen({ ...empty })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Company
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No quoting companies yet. Click New Company to add one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">GSTIN / PAN</th>
                <th className="px-4 py-3 font-semibold">Prefix</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Bank</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{[c.city, c.state].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">
                    <div>{c.gstin || "—"}</div>
                    <div className="text-muted-foreground">{c.pan || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent rounded font-mono font-bold text-xs">{c.quotePrefix || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{c.email || "—"}</div>
                    <div className="text-muted-foreground">{c.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{c.bankName || "—"}</div>
                    <div className="text-muted-foreground font-mono">{c.bankIfsc || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(c)} title="Toggle active" className="p-1 rounded hover:bg-muted">
                      {c.active
                        ? <ToggleRight className="w-5 h-5 text-emerald-600" />
                        : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpen(c)} className="p-2 hover:bg-muted rounded"><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => { if (confirm("Delete this company?")) delMut.mutate(c.id); }}
                      className="p-2 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <CompanyEditor
          item={open}
          onChange={setOpen}
          onClose={() => setOpen(null)}
          onSave={() => saveMut.mutate(open)}
          saving={saveMut.isPending}
        />
      )}
    </AdminLayout>
  );
}

function CompanyEditor({ item, onChange, onClose, onSave, saving }: {
  item: Partial<QuotingCompany>;
  onChange: (v: Partial<QuotingCompany>) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [tab, setTab] = useState<"basic" | "bank" | "branding">("basic");

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-xl font-bold">{item.id ? "Edit Company" : "New Quoting Company"}</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="px-6 pt-4 flex gap-2 border-b">
          {(["basic", "bank", "branding"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg ${tab === t ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="p-6 space-y-4">
          {tab === "basic" && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Company Name *">
                  <input value={item.name || ""} onChange={(e) => onChange({ ...item, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Quote Prefix (e.g. NM, NMM)">
                  <input value={item.quotePrefix || ""} onChange={(e) => onChange({ ...item, quotePrefix: e.target.value.toUpperCase() })}
                    className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" maxLength={5} />
                </Field>
                <Field label="GSTIN">
                  <input value={item.gstin || ""} onChange={(e) => onChange({ ...item, gstin: e.target.value.toUpperCase() })}
                    className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" />
                </Field>
                <Field label="PAN">
                  <input value={item.pan || ""} onChange={(e) => onChange({ ...item, pan: e.target.value.toUpperCase() })}
                    className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" />
                </Field>
                <Field label="Address">
                  <input value={item.address || ""} onChange={(e) => onChange({ ...item, address: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="City">
                  <input value={item.city || ""} onChange={(e) => onChange({ ...item, city: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="State">
                  <input value={item.state || ""} onChange={(e) => onChange({ ...item, state: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Pincode">
                  <input value={item.pincode || ""} onChange={(e) => onChange({ ...item, pincode: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Phone">
                  <input value={item.phone || ""} onChange={(e) => onChange({ ...item, phone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
                <Field label="Email">
                  <input value={item.email || ""} onChange={(e) => onChange({ ...item, email: e.target.value })} type="email"
                    className="w-full border rounded-lg px-3 py-2 bg-background" />
                </Field>
              </div>
              <Field label="Default Terms">
                <textarea value={item.defaultTerms || ""} onChange={(e) => onChange({ ...item, defaultTerms: e.target.value })}
                  rows={4} className="w-full border rounded-lg px-3 py-2 bg-background text-sm" placeholder="e.g. Payment within 30 days. Goods once sold will not be taken back..." />
              </Field>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!item.active} onChange={(e) => onChange({ ...item, active: e.target.checked })} />
                Active (appears in team's company picker)
              </label>
            </>
          )}
          {tab === "bank" && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Bank Name">
                <input value={item.bankName || ""} onChange={(e) => onChange({ ...item, bankName: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" />
              </Field>
              <Field label="Account Number">
                <input value={item.bankAccount || ""} onChange={(e) => onChange({ ...item, bankAccount: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background font-mono" />
              </Field>
              <Field label="IFSC Code">
                <input value={item.bankIfsc || ""} onChange={(e) => onChange({ ...item, bankIfsc: e.target.value.toUpperCase() })}
                  className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" />
              </Field>
              <Field label="Branch">
                <input value={item.bankBranch || ""} onChange={(e) => onChange({ ...item, bankBranch: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" />
              </Field>
            </div>
          )}
          {tab === "branding" && (
            <div className="space-y-4">
              <Field label="Logo URL">
                <input value={item.logoUrl || ""} onChange={(e) => onChange({ ...item, logoUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="https://..." />
              </Field>
              {item.logoUrl && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">Logo preview:</div>
                  <img src={item.logoUrl} alt="Logo" className="h-16 object-contain" />
                </div>
              )}
              <Field label="Signature URL">
                <input value={item.signatureUrl || ""} onChange={(e) => onChange({ ...item, signatureUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="https://..." />
              </Field>
              {item.signatureUrl && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">Signature preview:</div>
                  <img src={item.signatureUrl} alt="Signature" className="h-12 object-contain" />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={onSave} disabled={saving} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
