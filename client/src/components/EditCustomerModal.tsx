import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiUrl } from "@/lib/queryClient";

export interface EditableCustomer {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  notes?: string | null;
  [key: string]: unknown;
}

interface Props {
  customer: EditableCustomer;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: EditableCustomer) => void;
  /** "/api/admin" or "/api/team" */
  apiBase: string;
}

function readToken(apiBase: string): string | null {
  const key = apiBase.includes("/admin") ? "narmada_admin_token" : "narmada_team_token";
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export default function EditCustomerModal({ customer, open, onClose, onSaved, apiBase }: Props) {
  const [form, setForm] = useState({
    name: "", phone: "", email: "", gstNumber: "", address: "", contactPerson: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setForm({
      name: customer.name ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      gstNumber: customer.gstNumber ?? "",
      address: customer.address ?? "",
      contactPerson: customer.contactPerson ?? "",
      notes: customer.notes ?? "",
    });
  }, [open, customer]);

  if (!open) return null;

  async function save() {
    setErr(null);
    if (!form.name.trim()) { setErr("Name is required"); return; }
    const token = readToken(apiBase);
    if (!token) { setErr("Not authenticated"); return; }
    setSaving(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      headers[apiBase.includes("/admin") ? "x-admin-token" : "x-team-token"] = token;
      const r = await fetch(apiUrl(`${apiBase}/customers/${customer.id}`), {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          gstNumber: form.gstNumber.trim() || null,
          address: form.address.trim() || null,
          contactPerson: form.contactPerson.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      onSaved({ ...customer, ...j });
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-lg">Edit Customer</h3>
          <button onClick={() => !saving && onClose()} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 rounded-lg">{err}</div>}
          <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
          </div>
          <Field label="GST Number" value={form.gstNumber} onChange={(v) => setForm({ ...form, gstNumber: v })} mono />
          <Field label="Contact Person" value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} />
          <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
              className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </label>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 bg-muted/30">
          <button disabled={saving} onClick={onClose} className="px-4 py-2 rounded-lg text-sm border hover:bg-muted">Cancel</button>
          <button disabled={saving} onClick={save} className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", mono }: { label: string; value: string; onChange: (v: string) => void; type?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${mono ? "font-mono uppercase" : ""}`}
      />
    </label>
  );
}
