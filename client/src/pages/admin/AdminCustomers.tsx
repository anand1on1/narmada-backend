import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Search, Mail, MapPin, Wallet, KeyRound } from "lucide-react";

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstNumber: string | null;
  notes: string | null;
  creditLimitInr: number | null;
  openingBalanceInr: number | null;
  paymentTermsDays: number | null;
  contactPerson: string | null;
  companyPan: string | null;
  consignmentCount?: number;
  createdAt: number;
}

const emptyCustomer: Partial<Customer> = {
  name: "", phone: "", email: "", address: "", city: "Patna", state: "Bihar",
  pincode: "", gstNumber: "", notes: "", contactPerson: "", companyPan: "",
  creditLimitInr: 0, openingBalanceInr: 0, paymentTermsDays: 0,
};

export default function AdminCustomers() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Partial<Customer> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLoginFor, setShowLoginFor] = useState<Customer | null>(null);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    const r = await adminFetch(token, `/api/admin/customers?${params}`);
    setItems(await r.json());
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const isNew = !open.id;
      const url = isNew ? "/api/admin/customers" : `/api/admin/customers/${open.id}`;
      const r = await adminFetch(token, url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(open),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Save failed"); }
      else { await load(); setOpen(null); }
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!token) return;
    if (!confirm("Delete this customer? This cannot be undone.")) return;
    const r = await adminFetch(token, `/api/admin/customers/${id}`, { method: "DELETE" });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Delete failed"); return; }
    await load();
  }

  return (
    <AdminLayout title="Customers">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search name, email, GST…"
            className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-80" data-testid="input-search" />
        </div>
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Refresh</button>
        <div className="flex-1" />
        <button onClick={() => setOpen({ ...emptyCustomer })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-new-customer">
          <Plus className="w-4 h-4" /> New Customer
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No customers yet. Click New Customer to add one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">GST</th>
                <th className="px-4 py-3 font-semibold text-right">Credit Limit</th>
                <th className="px-4 py-3 font-semibold text-right">Terms (days)</th>
                <th className="px-4 py-3 font-semibold text-right">Consignments</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id} data-testid={`row-cust-${c.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.name}</div>
                    {c.contactPerson && <div className="text-xs text-muted-foreground">{c.contactPerson}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div className="text-muted-foreground">{c.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono">{c.gstNumber || "—"}</td>
                  <td className="px-4 py-3 text-right">₹{(c.creditLimitInr || 0).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">{c.paymentTermsDays || 0}</td>
                  <td className="px-4 py-3 text-right">{c.consignmentCount || 0}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/admin/ledger?customerId=${c.id}`}>
                      <a className="p-2 hover:bg-muted rounded inline-block" title="Ledger" data-testid={`button-ledger-${c.id}`}><Wallet className="w-4 h-4" /></a>
                    </Link>
                    <button onClick={() => setShowLoginFor(c)} className="p-2 hover:bg-muted rounded" title="Portal login" data-testid={`button-login-${c.id}`}><KeyRound className="w-4 h-4" /></button>
                    <button onClick={() => setOpen(c)} className="p-2 hover:bg-muted rounded" data-testid={`button-edit-${c.id}`}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => del(c.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-${c.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && <CustomerEditor item={open} onChange={setOpen} onClose={() => setOpen(null)} onSave={save} saving={saving} />}
      {showLoginFor && <LoginEditor customer={showLoginFor} onClose={() => { setShowLoginFor(null); load(); }} />}
    </AdminLayout>
  );
}

function CustomerEditor({ item, onChange, onClose, onSave, saving }: any) {
  const { token } = useAdminAuth();
  const [tab, setTab] = useState<"basic" | "emails" | "addresses">("basic");
  const [emails, setEmails] = useState<any[]>([]);
  const [addrs, setAddrs] = useState<any[]>([]);
  const [newEmail, setNewEmail] = useState({ email: "", label: "" });
  const [newAddr, setNewAddr] = useState({ label: "Billing", line1: "", city: "Patna", state: "Bihar", pincode: "", isDefaultBilling: true, isDefaultShipping: false });

  async function loadAux() {
    if (!token || !item.id) return;
    const [eR, aR] = await Promise.all([
      adminFetch(token, `/api/admin/customers/${item.id}/emails`),
      adminFetch(token, `/api/admin/customers/${item.id}/addresses`),
    ]);
    setEmails(await eR.json());
    setAddrs(await aR.json());
  }
  useEffect(() => { loadAux(); }, [item.id, tab]); // eslint-disable-line

  async function addEmail() {
    if (!token || !item.id || !newEmail.email) return;
    const r = await adminFetch(token, `/api/admin/customers/${item.id}/emails`, { method: "POST", body: JSON.stringify(newEmail) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setNewEmail({ email: "", label: "" });
    loadAux();
  }
  async function setPrimary(id: number) {
    if (!token) return;
    await adminFetch(token, `/api/admin/customer-emails/${id}/primary`, { method: "PATCH" });
    loadAux();
  }
  async function delEmail(id: number) {
    if (!token || !confirm("Delete this email?")) return;
    await adminFetch(token, `/api/admin/customer-emails/${id}`, { method: "DELETE" });
    loadAux();
  }
  async function addAddr() {
    if (!token || !item.id || !newAddr.line1) return;
    const r = await adminFetch(token, `/api/admin/customers/${item.id}/addresses`, { method: "POST", body: JSON.stringify(newAddr) });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setNewAddr({ ...newAddr, line1: "" });
    loadAux();
  }
  async function delAddr(id: number) {
    if (!token || !confirm("Delete this address?")) return;
    await adminFetch(token, `/api/admin/customer-addresses/${id}`, { method: "DELETE" });
    loadAux();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-xl font-bold">{item.id ? "Edit Customer" : "New Customer"}</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        {item.id && (
          <div className="px-6 pt-4 flex gap-2 border-b">
            {["basic", "emails", "addresses"].map((t) => (
              <button key={t} onClick={() => setTab(t as any)}
                className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t-lg ${tab === t ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="p-6 space-y-4">
          {tab === "basic" && (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Company Name *"><input value={item.name || ""} onChange={(e) => onChange({ ...item, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-name" /></Field>
                <Field label="Contact Person"><input value={item.contactPerson || ""} onChange={(e) => onChange({ ...item, contactPerson: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Primary Email"><input value={item.email || ""} onChange={(e) => onChange({ ...item, email: e.target.value })} type="email" className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Primary Phone"><input value={item.phone || ""} onChange={(e) => onChange({ ...item, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Address"><input value={item.address || ""} onChange={(e) => onChange({ ...item, address: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="City"><input value={item.city || ""} onChange={(e) => onChange({ ...item, city: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="State"><input value={item.state || ""} onChange={(e) => onChange({ ...item, state: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Pincode"><input value={item.pincode || ""} onChange={(e) => onChange({ ...item, pincode: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="GST Number"><input value={item.gstNumber || ""} onChange={(e) => onChange({ ...item, gstNumber: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" /></Field>
                <Field label="Company PAN"><input value={item.companyPan || ""} onChange={(e) => onChange({ ...item, companyPan: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" /></Field>
                <Field label="Credit Limit (₹)"><input type="number" value={item.creditLimitInr || 0} onChange={(e) => onChange({ ...item, creditLimitInr: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Opening Balance (₹)"><input type="number" value={item.openingBalanceInr || 0} onChange={(e) => onChange({ ...item, openingBalanceInr: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Payment Terms (days)"><input type="number" value={item.paymentTermsDays || 0} onChange={(e) => onChange({ ...item, paymentTermsDays: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              </div>
              <Field label="Notes"><textarea value={item.notes || ""} onChange={(e) => onChange({ ...item, notes: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <div className="text-xs text-muted-foreground">Opening balance is seeded as a single ledger entry the first time you record any transaction. Edit on the Ledger page later if needed.</div>
            </>
          )}

          {tab === "emails" && (
            <>
              <div className="text-sm text-muted-foreground">Add multiple emails for OTP login and notifications.</div>
              <div className="border rounded-lg divide-y">
                {emails.length === 0 && <div className="p-4 text-sm text-muted-foreground">No additional emails yet.</div>}
                {emails.map((e) => (
                  <div key={e.id} className="p-3 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="font-semibold">{e.email}</div>
                      <div className="text-xs text-muted-foreground">{e.label || "—"}</div>
                    </div>
                    {e.isPrimary ? <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-700 rounded">Primary</span>
                      : <button onClick={() => setPrimary(e.id)} className="text-xs px-2 py-1 border rounded">Make primary</button>}
                    <button onClick={() => delEmail(e.id)} className="p-1.5 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input placeholder="email@example.com" value={newEmail.email} onChange={(e) => setNewEmail({ ...newEmail, email: e.target.value })} className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
                <input placeholder="Label (optional)" value={newEmail.label} onChange={(e) => setNewEmail({ ...newEmail, label: e.target.value })} className="w-48 border rounded-lg px-3 py-2 bg-background text-sm" />
                <button onClick={addEmail} className="px-3 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Add</button>
              </div>
            </>
          )}

          {tab === "addresses" && (
            <>
              <div className="text-sm text-muted-foreground">Manage billing & shipping addresses separately.</div>
              <div className="border rounded-lg divide-y">
                {addrs.length === 0 && <div className="p-4 text-sm text-muted-foreground">No addresses yet.</div>}
                {addrs.map((a) => (
                  <div key={a.id} className="p-3 flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground mt-1" />
                    <div className="flex-1">
                      <div className="font-semibold">{a.label} <span className="text-xs text-muted-foreground">— {[a.city, a.state, a.pincode].filter(Boolean).join(" ")}</span></div>
                      <div className="text-xs text-muted-foreground">{a.line1} {a.line2}</div>
                      <div className="flex gap-2 mt-1">
                        {a.isDefaultBilling ? <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-700 rounded">Default Billing</span> : null}
                        {a.isDefaultShipping ? <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-blue-500/15 text-blue-700 rounded">Default Shipping</span> : null}
                      </div>
                    </div>
                    <button onClick={() => delAddr(a.id)} className="p-1.5 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  <select value={newAddr.label} onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })} className="border rounded-lg px-3 py-2 bg-background text-sm">
                    <option value="Billing">Billing</option><option value="Shipping">Shipping</option><option value="Office">Office</option><option value="Warehouse">Warehouse</option>
                  </select>
                  <input placeholder="Line 1 *" value={newAddr.line1} onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })} className="border rounded-lg px-3 py-2 bg-background text-sm" />
                  <input placeholder="City" value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })} className="border rounded-lg px-3 py-2 bg-background text-sm" />
                  <input placeholder="State" value={newAddr.state} onChange={(e) => setNewAddr({ ...newAddr, state: e.target.value })} className="border rounded-lg px-3 py-2 bg-background text-sm" />
                  <input placeholder="Pincode" value={newAddr.pincode} onChange={(e) => setNewAddr({ ...newAddr, pincode: e.target.value })} className="border rounded-lg px-3 py-2 bg-background text-sm" />
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newAddr.isDefaultBilling} onChange={(e) => setNewAddr({ ...newAddr, isDefaultBilling: e.target.checked })} /> Default billing</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newAddr.isDefaultShipping} onChange={(e) => setNewAddr({ ...newAddr, isDefaultShipping: e.target.checked })} /> Default shipping</label>
                  </div>
                </div>
                <button onClick={addAddr} className="px-3 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Add Address</button>
              </div>
            </>
          )}
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          {tab === "basic" && <button onClick={onSave} disabled={saving} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">{saving ? "Saving…" : "Save"}</button>}
        </div>
      </div>
    </div>
  );
}

function LoginEditor({ customer, onClose }: any) {
  const { token } = useAdminAuth();
  const [login, setLogin] = useState<any>(null);
  const [email, setEmail] = useState(customer.email || "");
  const [creditLimit, setCreditLimit] = useState(customer.creditLimitInr || 0);
  const [terms, setTerms] = useState(customer.paymentTermsDays || 0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const r = await adminFetch(token, `/api/admin/customers/${customer.id}/login`);
      if (r.ok) setLogin(await r.json());
      setLoading(false);
    })();
  }, [customer.id, token]);

  async function createLogin() {
    if (!token) return;
    const r = await adminFetch(token, `/api/admin/customers/${customer.id}/login`, {
      method: "POST", body: JSON.stringify({ email, creditLimitInr: creditLimit, paymentTermsDays: terms }),
    });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setLogin(await r.json());
  }

  async function toggleActive() {
    if (!token || !login) return;
    const r = await adminFetch(token, `/api/admin/customer-logins/${login.id}`, { method: "PATCH", body: JSON.stringify({ active: !login.active }) });
    if (r.ok) setLogin(await r.json());
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Portal Login — {customer.name}</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-3">
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : login ? (
            <>
              <div className="text-sm">Login email: <strong>{login.email}</strong></div>
              <div className="text-xs text-muted-foreground">Status: {login.active ? <span className="text-emerald-700">Active</span> : <span className="text-red-600">Disabled</span>}</div>
              <div className="text-xs text-muted-foreground">Last login: {login.lastLoginAt ? new Date(login.lastLoginAt).toLocaleString() : "Never"}</div>
              <button onClick={toggleActive} className="px-4 py-2 border rounded-lg text-sm">{login.active ? "Disable" : "Enable"} login</button>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">No portal login created. Issue a login below — customer signs in at <code>/portal</code> using email + OTP.</div>
              <Field label="Login email *"><input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Credit limit (₹)"><input type="number" value={creditLimit} onChange={(e) => setCreditLimit(parseFloat(e.target.value) || 0)} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Payment terms (days)"><input type="number" value={terms} onChange={(e) => setTerms(parseInt(e.target.value) || 0)} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <button onClick={createLogin} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Create Login</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
