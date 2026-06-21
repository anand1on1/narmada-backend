import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Package, Heart, MapPin, LogOut } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { apiUrl } from "@/lib/queryClient";
import { SeoHead } from "@/components/SeoHead";
import { useToast } from "@/hooks/use-toast";

interface Address {
  id: number; label?: string; fullName: string; phone: string;
  line1: string; line2?: string; city: string; state: string; pincode: string; country?: string; isDefault?: boolean;
}

const EMPTY = { fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "", label: "" };

export default function ShopAccount() {
  const { user, token, ready, clear } = useShopAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<any>(EMPTY);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (ready && !user) navigate("/customer/login");
  }, [ready, user, navigate]);

  const loadAddresses = async () => {
    if (!token) return;
    const r = await shopFetch(token, "/api/shop/addresses");
    if (r.ok) setAddresses(await r.json());
  };
  useEffect(() => { loadAddresses(); /* eslint-disable-next-line */ }, [token]);

  const saveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await shopFetch(token, "/api/shop/addresses", { method: "POST", body: JSON.stringify(form) });
    if (r.ok) { setForm(EMPTY); setShowForm(false); toast({ title: "Address saved" }); loadAddresses(); }
    else { const j = await r.json(); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  };

  const delAddress = async (id: number) => {
    await shopFetch(token, `/api/shop/addresses/${id}`, { method: "DELETE" });
    loadAddresses();
  };

  const makeDefault = async (id: number) => {
    await shopFetch(token, `/api/shop/addresses/${id}/default`, { method: "POST" });
    loadAddresses();
  };

  const logout = async () => {
    if (token) await shopFetch(token, "/api/shop/logout", { method: "POST" }).catch(() => {});
    clear();
    navigate("/");
  };

  if (!ready || !user) return <div className="max-w-4xl mx-auto px-4 py-20 text-center text-muted-foreground">Loading…</div>;

  return (
    <>
      <SeoHead title="My Account — Narmada Mobility" description="Manage your account, addresses, orders, and wishlist." />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-black text-3xl tracking-tight">My Account</h1>
            <p className="text-muted-foreground mt-1">{user.fullName || user.email}</p>
          </div>
          <Button variant="outline" onClick={logout} data-testid="button-logout"><LogOut className="h-4 w-4 mr-2" /> Sign Out</Button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          <Link href="/customer/orders"><a><Card className="p-5 border-card-border hover:border-[hsl(212_95%_50%)]/40 transition-colors flex items-center gap-3" data-testid="link-orders"><Package className="h-6 w-6 text-[hsl(212_95%_50%)]" /><div><div className="font-semibold">My Orders</div><div className="text-sm text-muted-foreground">Track and view past orders</div></div></Card></a></Link>
          <Link href="/customer/wishlist"><a><Card className="p-5 border-card-border hover:border-[hsl(212_95%_50%)]/40 transition-colors flex items-center gap-3" data-testid="link-wishlist"><Heart className="h-6 w-6 text-[hsl(212_95%_50%)]" /><div><div className="font-semibold">Wishlist</div><div className="text-sm text-muted-foreground">Saved products</div></div></Card></a></Link>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-black text-xl flex items-center gap-2"><MapPin className="h-5 w-5" /> Saved Addresses</h2>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} data-testid="button-add-address"><Plus className="h-4 w-4 mr-1" /> Add Address</Button>
        </div>

        {showForm && (
          <Card className="p-5 border-card-border mb-4">
            <form onSubmit={saveAddress} className="grid sm:grid-cols-2 gap-3">
              <div><Label>Full Name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required data-testid="addr-fullname" /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required data-testid="addr-phone" /></div>
              <div className="sm:col-span-2"><Label>Address Line 1</Label><Input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} required data-testid="addr-line1" /></div>
              <div className="sm:col-span-2"><Label>Address Line 2</Label><Input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} data-testid="addr-line2" /></div>
              <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required data-testid="addr-city" /></div>
              <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required data-testid="addr-state" /></div>
              <div><Label>Pincode</Label><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} required data-testid="addr-pincode" /></div>
              <div><Label>Label (optional)</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Home, Office…" data-testid="addr-label" /></div>
              <div className="sm:col-span-2"><Button type="submit" data-testid="addr-save">Save Address</Button></div>
            </form>
          </Card>
        )}

        <div className="space-y-3">
          {addresses.length === 0 && <p className="text-muted-foreground text-sm">No saved addresses yet.</p>}
          {addresses.map((a) => (
            <Card key={a.id} className="p-4 border-card-border flex items-start justify-between gap-4" data-testid={`address-${a.id}`}>
              <div>
                <div className="font-semibold">{a.fullName} {a.label && <span className="text-xs text-muted-foreground">· {a.label}</span>} {a.isDefault && <span className="ml-1 text-[10px] uppercase font-bold text-green-700 bg-green-600/10 px-1.5 py-0.5 rounded">Default</span>}</div>
                <div className="text-sm text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} - {a.pincode}</div>
                <div className="text-sm text-muted-foreground">{a.phone}</div>
              </div>
              <div className="flex items-center gap-2">
                {!a.isDefault && <Button size="sm" variant="ghost" onClick={() => makeDefault(a.id)} data-testid={`addr-default-${a.id}`}>Set default</Button>}
                <button onClick={() => delAddress(a.id)} className="text-muted-foreground hover:text-red-600" data-testid={`addr-delete-${a.id}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
