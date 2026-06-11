import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { Search, Plus, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  gstNumber: string | null;
  defaultDiscountPct?: number | null;
}

interface NewCustomerForm {
  name: string;
  email: string;
  phone: string;
  gstNumber: string;
  address: string;
  city: string;
  state: string;
  defaultDiscountPct: string;
}

const EMPTY_FORM: NewCustomerForm = {
  name: "", email: "", phone: "", gstNumber: "", address: "", city: "", state: "", defaultDiscountPct: "",
};

export default function TeamCustomers() {
  const { token } = useTeamAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewCustomerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["team-customers", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ.trim()) p.set("q", searchQ.trim());
      const r = await teamFetch(token, `/api/team/customers?${p}`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    enabled: !!token,
  });

  async function submit() {
    setErr(null);
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        gstNumber: form.gstNumber.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
      };
      const disc = parseFloat(form.defaultDiscountPct);
      if (!Number.isNaN(disc)) payload.defaultDiscountPct = disc;
      const r = await teamFetch(token, "/api/team/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["team-customers"] });
    } catch (e: any) {
      setErr(e.message || "Failed to create customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TeamLayout title="Customers">
      <p className="text-sm text-muted-foreground mb-4">Customer list. Click <strong>+ New Customer</strong> to add one, or pick from this list when creating a quotation.</p>
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchQ(q)}
            placeholder="Search customers…"
            className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-72" />
        </div>
        <button onClick={() => setSearchQ(q)} className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Search</button>
        <button onClick={() => { setForm(EMPTY_FORM); setErr(null); setShowForm(true); }}
          className="ml-auto px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> New Customer
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No customers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">GST</th>
                <th className="px-4 py-3 font-semibold">Default Discount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{c.email || "—"}</div>
                    <div className="text-muted-foreground">{c.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono">{c.gstNumber || "—"}</td>
                  <td className="px-4 py-3 text-xs">{c.defaultDiscountPct != null ? `${c.defaultDiscountPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-lg">New Customer</h3>
              <button onClick={() => !saving && setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 rounded-lg">{err}</div>}
              <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </div>
              <Field label="GST Number" value={form.gstNumber} onChange={(v) => setForm({ ...form, gstNumber: v })} />
              <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
              </div>
              <Field label="Default Discount %" value={form.defaultDiscountPct} onChange={(v) => setForm({ ...form, defaultDiscountPct: v })} type="number" placeholder="e.g. 10" />
              <p className="text-xs text-muted-foreground">When set, new quotation line items for this customer will be pre-filled with this discount.</p>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2 bg-muted/30">
              <button disabled={saving} onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm border hover:bg-muted">Cancel</button>
              <button disabled={saving} onClick={submit} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {saving ? "Saving…" : "Create Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeamLayout>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}
