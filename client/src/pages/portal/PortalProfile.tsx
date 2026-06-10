import { useState, useEffect } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, MapPin, Mail, User } from "lucide-react";

interface CustomerProfile {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loginEmail: string;
}

interface CustomerEmail {
  id: number;
  email: string;
  label: string | null;
  isPrimary: boolean;
}

interface CustomerAddress {
  id: number;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string | null;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
}

export default function PortalProfile() {
  const { token, customer } = useCustomerAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"profile" | "emails" | "addresses">("profile");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [newEmail, setNewEmail] = useState({ email: "", label: "" });
  const [newAddr, setNewAddr] = useState({
    label: "Billing", line1: "", city: "", state: "", pincode: "",
    isDefaultBilling: false, isDefaultShipping: false,
  });
  const [editAddr, setEditAddr] = useState<CustomerAddress | null>(null);

  useEffect(() => {
    if (customer) {
      setName(customer.name || "");
      setPhone(customer.phone || "");
    }
  }, [customer]);

  const { data: emails = [] } = useQuery<CustomerEmail[]>({
    queryKey: ["portal-emails"],
    queryFn: async () => {
      const r = await customerFetch(token!, "/api/portal/emails");
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && tab === "emails",
  });

  const { data: addresses = [] } = useQuery<CustomerAddress[]>({
    queryKey: ["portal-addresses"],
    queryFn: async () => {
      const r = await customerFetch(token!, "/api/portal/addresses");
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && tab === "addresses",
  });

  const updateProfileMut = useMutation({
    mutationFn: async () => {
      const r = await customerFetch(token!, "/api/portal/me", {
        method: "PATCH", body: JSON.stringify({ name, phone }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-me"] });
      toast({ title: "Profile updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addEmailMut = useMutation({
    mutationFn: async () => {
      const r = await customerFetch(token!, "/api/portal/emails", {
        method: "POST", body: JSON.stringify(newEmail),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-emails"] });
      setNewEmail({ email: "", label: "" });
      toast({ title: "Email added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const delEmailMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await customerFetch(token!, `/api/portal/emails/${id}`, { method: "DELETE" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-emails"] });
      toast({ title: "Email removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addAddrMut = useMutation({
    mutationFn: async () => {
      const r = await customerFetch(token!, "/api/portal/addresses", {
        method: "POST", body: JSON.stringify(newAddr),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-addresses"] });
      setNewAddr({ label: "Billing", line1: "", city: "", state: "", pincode: "", isDefaultBilling: false, isDefaultShipping: false });
      toast({ title: "Address added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateAddrMut = useMutation({
    mutationFn: async (addr: CustomerAddress) => {
      const r = await customerFetch(token!, `/api/portal/addresses/${addr.id}`, {
        method: "PATCH", body: JSON.stringify(addr),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-addresses"] });
      setEditAddr(null);
      toast({ title: "Address updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <PortalLayout title="My Profile">
      {/* Tabs */}
      <div className="flex gap-2 border-b mb-6">
        {(["profile", "emails", "addresses"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 -mb-px transition ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="max-w-md space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <User className="w-6 h-6 text-accent" />
            </div>
            <div>
              <div className="font-semibold">{customer?.name}</div>
              <div className="text-sm text-muted-foreground">{customer?.loginEmail}</div>
            </div>
          </div>
          <Field label="Full Name">
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background" />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background" />
          </Field>
          <button onClick={() => updateProfileMut.mutate()} disabled={updateProfileMut.isPending}
            className="px-6 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50">
            {updateProfileMut.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}

      {tab === "emails" && (
        <div className="max-w-md space-y-4">
          <p className="text-sm text-muted-foreground">Manage additional email addresses for OTP login and notifications.</p>
          <div className="border rounded-xl divide-y">
            {emails.length === 0 && <div className="p-4 text-sm text-muted-foreground">No additional emails.</div>}
            {emails.map((e) => (
              <div key={e.id} className="p-3 flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{e.email}</div>
                  {e.label && <div className="text-xs text-muted-foreground">{e.label}</div>}
                </div>
                {e.isPrimary
                  ? <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-700 rounded">Primary</span>
                  : <button onClick={() => delEmailMut.mutate(e.id)} className="p-1.5 hover:bg-red-50 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                }
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input placeholder="email@example.com" value={newEmail.email} onChange={(e) => setNewEmail({ ...newEmail, email: e.target.value })}
              className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
            <input placeholder="Label" value={newEmail.label} onChange={(e) => setNewEmail({ ...newEmail, label: e.target.value })}
              className="w-32 border rounded-lg px-3 py-2 bg-background text-sm" />
            <button onClick={() => addEmailMut.mutate()} disabled={!newEmail.email.trim() || addEmailMut.isPending}
              className="px-3 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {tab === "addresses" && (
        <div className="max-w-lg space-y-4">
          <div className="border rounded-xl divide-y">
            {addresses.length === 0 && <div className="p-4 text-sm text-muted-foreground">No addresses yet.</div>}
            {addresses.map((a) => (
              <div key={a.id} className="p-3 flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">{a.label}</div>
                  <div className="text-xs text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</div>
                  <div className="text-xs text-muted-foreground">{[a.city, a.state, a.pincode].filter(Boolean).join(", ")}</div>
                  <div className="flex gap-2 mt-1">
                    {a.isDefaultBilling && <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-500/15 text-emerald-700 rounded">Default Billing</span>}
                    {a.isDefaultShipping && <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-blue-500/15 text-blue-700 rounded">Default Shipping</span>}
                  </div>
                </div>
                <button onClick={() => setEditAddr(a)} className="text-xs px-2 py-1 border rounded hover:bg-muted">Edit</button>
              </div>
            ))}
          </div>

          {/* Add address form */}
          <div className="border rounded-xl p-4 bg-muted/30 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add Address</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <select value={newAddr.label} onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })}
                className="border rounded-lg px-3 py-2 bg-background text-sm">
                <option value="Billing">Billing</option>
                <option value="Shipping">Shipping</option>
                <option value="Office">Office</option>
              </select>
              <input placeholder="Street address *" value={newAddr.line1} onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })}
                className="border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="City" value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
                className="border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="State" value={newAddr.state} onChange={(e) => setNewAddr({ ...newAddr, state: e.target.value })}
                className="border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="Pincode" value={newAddr.pincode} onChange={(e) => setNewAddr({ ...newAddr, pincode: e.target.value })}
                className="border rounded-lg px-3 py-2 bg-background text-sm" />
            </div>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={newAddr.isDefaultBilling} onChange={(e) => setNewAddr({ ...newAddr, isDefaultBilling: e.target.checked })} />
                Default billing
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={newAddr.isDefaultShipping} onChange={(e) => setNewAddr({ ...newAddr, isDefaultShipping: e.target.checked })} />
                Default shipping
              </label>
            </div>
            <button onClick={() => addAddrMut.mutate()} disabled={!newAddr.line1.trim() || addAddrMut.isPending}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
              Add Address
            </button>
          </div>
        </div>
      )}

      {/* Edit address modal */}
      {editAddr && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="border-b px-5 py-4 flex items-center justify-between">
              <h2 className="font-semibold">Edit Address</h2>
              <button onClick={() => setEditAddr(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-5 space-y-3">
              <input placeholder="Line 1" value={editAddr.line1} onChange={(e) => setEditAddr({ ...editAddr, line1: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="City" value={editAddr.city} onChange={(e) => setEditAddr({ ...editAddr, city: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="State" value={editAddr.state} onChange={(e) => setEditAddr({ ...editAddr, state: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
              <input placeholder="Pincode" value={editAddr.pincode || ""} onChange={(e) => setEditAddr({ ...editAddr, pincode: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
            </div>
            <div className="border-t px-5 py-4 flex justify-end gap-2">
              <button onClick={() => setEditAddr(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => updateAddrMut.mutate(editAddr!)} disabled={updateAddrMut.isPending}
                className="px-5 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
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
