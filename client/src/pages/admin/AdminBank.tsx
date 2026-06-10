import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Landmark } from "lucide-react";

interface Bank {
  id: number; label: string; accountName: string; accountNo: string; ifsc: string;
  bankName: string; branch: string | null; accountType: string | null;
  isDefault: boolean; active: boolean; createdAt: number;
}

const empty: Partial<Bank> = {
  label: "Primary", accountName: "NARMADA MOBILITY PRIVATE LIMITED", accountNo: "", ifsc: "",
  bankName: "", branch: "", accountType: "Current", isDefault: false, active: true,
};

export default function AdminBank() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<Bank[]>([]);
  const [open, setOpen] = useState<Partial<Bank> | null>(null);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, `/api/admin/bank-details`);
    { const _d = await r.json(); setItems(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    const isNew = !open.id;
    const url = isNew ? "/api/admin/bank-details" : `/api/admin/bank-details/${open.id}`;
    const r = await adminFetch(token, url, { method: isNew ? "POST" : "PATCH", body: JSON.stringify(open) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setOpen(null); load();
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this bank account?")) return;
    const r = await adminFetch(token, `/api/admin/bank-details/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    load();
  }

  return (
    <AdminLayout title="Bank Accounts">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="text-sm text-muted-foreground">Bank accounts customers see in the portal for NEFT/RTGS payment.</div>
        <div className="flex-1" />
        <button onClick={() => setOpen({ ...empty })} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-bank">
          <Plus className="w-4 h-4" /> Add Bank
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground col-span-2 bg-card border rounded-xl">No bank accounts.</div>
        ) : items.map((b) => (
          <div key={b.id} className="bg-card border rounded-xl p-5" data-testid={`card-bank-${b.id}`}>
            <div className="flex items-start gap-3 mb-3">
              <Landmark className="w-5 h-5 text-accent mt-1" />
              <div className="flex-1">
                <div className="font-display text-lg font-bold">{b.bankName}</div>
                <div className="text-xs text-muted-foreground">{b.label} · {b.accountType || "Account"}</div>
              </div>
              {b.isDefault && <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-700 rounded">Default</span>}
              {!b.active && <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-slate-500/15 text-slate-700 rounded">Inactive</span>}
            </div>
            <dl className="text-sm space-y-1">
              <Row k="Account name" v={b.accountName} />
              <Row k="Account no" v={<span className="font-mono">{b.accountNo}</span>} />
              <Row k="IFSC" v={<span className="font-mono">{b.ifsc}</span>} />
              {b.branch && <Row k="Branch" v={b.branch} />}
            </dl>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setOpen(b)} className="px-3 py-1.5 border rounded text-xs inline-flex items-center gap-1"><Edit3 className="w-3 h-3" />Edit</button>
              <button onClick={() => del(b.id)} className="px-3 py-1.5 hover:bg-red-500/10 text-red-600 border rounded text-xs inline-flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete</button>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{open.id ? "Edit Bank" : "Add Bank Account"}</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <Field label="Label *"><input value={open.label || ""} onChange={(e) => setOpen({ ...open, label: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Bank Name *"><input value={open.bankName || ""} onChange={(e) => setOpen({ ...open, bankName: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Account Name *"><input value={open.accountName || ""} onChange={(e) => setOpen({ ...open, accountName: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Account Number *"><input value={open.accountNo || ""} onChange={(e) => setOpen({ ...open, accountNo: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono" /></Field>
              <Field label="IFSC *"><input value={open.ifsc || ""} onChange={(e) => setOpen({ ...open, ifsc: e.target.value.toUpperCase() })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" /></Field>
              <Field label="Branch"><input value={open.branch || ""} onChange={(e) => setOpen({ ...open, branch: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Type"><select value={open.accountType || "Current"} onChange={(e) => setOpen({ ...open, accountType: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background">
                <option>Current</option><option>Savings</option><option>CC</option><option>OD</option>
              </select></Field>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!open.isDefault} onChange={(e) => setOpen({ ...open, isDefault: e.target.checked })} /> Default account</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={open.active !== false} onChange={(e) => setOpen({ ...open, active: e.target.checked })} /> Active</label>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="grid grid-cols-[120px,1fr] gap-2"><dt className="text-xs uppercase font-bold text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
}
function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
