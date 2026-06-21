import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { getCart, cartSubtotalInr, clearCart, CartItem } from "@/lib/cart";
import { formatPrice } from "@/lib/currency";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { apiUrl } from "@/lib/queryClient";
import { SeoHead } from "@/components/SeoHead";

const EMPTY = { fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" };

export default function CheckoutPage() {
  const { token, user, ready } = useShopAuth();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<CartItem[]>(getCart());
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<number | "new">("new");
  const [form, setForm] = useState<any>(EMPTY);
  const [freight, setFreight] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [err, setErr] = useState("");

  const subtotal = cartSubtotalInr();

  // Redirect to login if not authenticated (after ready).
  useEffect(() => {
    if (ready && !user) navigate("/customer/login");
  }, [ready, user, navigate]);

  // Empty cart guard.
  useEffect(() => { setItems(getCart()); }, []);

  // Load saved addresses.
  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await shopFetch(token, "/api/shop/addresses");
      if (r.ok) {
        const list = await r.json();
        setAddresses(list);
        const def = list.find((a: any) => a.isDefault) || list[0];
        if (def) setSelectedAddr(def.id);
      }
    })();
  }, [token]);

  // Freight quote whenever cart changes.
  useEffect(() => {
    (async () => {
      if (items.length === 0) { setFreight(0); return; }
      try {
        const r = await fetch(apiUrl("/api/shop/freight-quote"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map((it) => ({ part_number: it.partNumber, qty: it.qty || 1 })) }),
        });
        if (r.ok) { const j = await r.json(); setFreight(Number(j.freightInr) || 0); }
      } catch { setFreight(0); }
    })();
  }, [items]);

  const shipFrom = (): any => {
    if (selectedAddr === "new") return form;
    const a = addresses.find((x) => x.id === selectedAddr);
    return a || form;
  };

  const placeOrder = async () => {
    setErr(""); setPlacing(true);
    try {
      const ship = shipFrom();
      if (!ship.fullName || !ship.phone || !ship.line1 || !ship.city || !ship.state || !ship.pincode) {
        throw new Error("Please complete the shipping address");
      }
      // Save a new address for reuse (best-effort).
      if (selectedAddr === "new") {
        await shopFetch(token, "/api/shop/addresses", { method: "POST", body: JSON.stringify(form) }).catch(() => {});
      }
      const r = await shopFetch(token, "/api/shop/orders", {
        method: "POST",
        body: JSON.stringify({
          ship,
          items: items.map((it) => ({
            product_id: it.productId, part_number: it.partNumber, name: it.name,
            image: it.image, unit_price: it.unitPriceInr, qty: it.qty || 1,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Order failed");
      clearCart();
      navigate(`/order-confirmation/${j.id}`);
    } catch (e: any) { setErr(e.message); } finally { setPlacing(false); }
  };

  if (!ready) return <div className="max-w-4xl mx-auto px-4 py-20 text-center text-muted-foreground">Loading…</div>;

  if (items.length === 0) {
    return (
      <section className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground mb-4">Your cart is empty.</p>
        <Button asChild><Link href="/products"><a>Browse products</a></Link></Button>
      </section>
    );
  }

  const total = subtotal + freight;

  return (
    <>
      <SeoHead title="Checkout — Narmada Mobility" description="Complete your order with Cash on Delivery." />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/cart"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft className="h-4 w-4" /> Back to cart</a></Link>
        <h1 className="font-display font-black text-3xl tracking-tight mb-6">Checkout</h1>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 border-card-border">
              <h2 className="font-display font-black text-lg mb-4">Shipping Address</h2>

              {addresses.length > 0 && (
                <div className="space-y-2 mb-4">
                  {addresses.map((a) => (
                    <label key={a.id} className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer ${selectedAddr === a.id ? "border-[hsl(212_95%_50%)] bg-[hsl(212_95%_50%)]/5" : "border-card-border"}`} data-testid={`addr-option-${a.id}`}>
                      <input type="radio" name="addr" checked={selectedAddr === a.id} onChange={() => setSelectedAddr(a.id)} className="mt-1" />
                      <div className="text-sm">
                        <div className="font-semibold">{a.fullName} · {a.phone}</div>
                        <div className="text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} - {a.pincode}</div>
                      </div>
                    </label>
                  ))}
                  <label className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer ${selectedAddr === "new" ? "border-[hsl(212_95%_50%)] bg-[hsl(212_95%_50%)]/5" : "border-card-border"}`} data-testid="addr-option-new">
                    <input type="radio" name="addr" checked={selectedAddr === "new"} onChange={() => setSelectedAddr("new")} />
                    <span className="text-sm font-medium">Use a new address</span>
                  </label>
                </div>
              )}

              {selectedAddr === "new" && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Full Name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} data-testid="ship-fullname" /></div>
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="ship-phone" /></div>
                  <div className="sm:col-span-2"><Label>Address Line 1</Label><Input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} data-testid="ship-line1" /></div>
                  <div className="sm:col-span-2"><Label>Address Line 2</Label><Input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} data-testid="ship-line2" /></div>
                  <div><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="ship-city" /></div>
                  <div><Label>State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="ship-state" /></div>
                  <div><Label>Pincode</Label><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} data-testid="ship-pincode" /></div>
                </div>
              )}
            </Card>

            <Card className="p-6 border-card-border">
              <h2 className="font-display font-black text-lg mb-2">Payment</h2>
              <label className="flex items-center gap-3 p-3 rounded-md border border-[hsl(212_95%_50%)] bg-[hsl(212_95%_50%)]/5">
                <input type="radio" checked readOnly />
                <span className="text-sm font-medium">Cash on Delivery (COD)</span>
              </label>
              <p className="text-xs text-muted-foreground mt-2">Pay when your order is delivered. Online payment coming soon.</p>
            </Card>
          </div>

          <Card className="p-6 border-card-border self-start">
            <h2 className="font-display font-black text-lg mb-4">Order Summary</h2>
            <div className="space-y-2 mb-3">
              {items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm" data-testid={`summary-item-${i}`}>
                  <span className="truncate pr-2">{it.name} × {it.qty || 0}</span>
                  <span className="font-medium whitespace-nowrap">{formatPrice(it.unitPriceInr * (it.qty || 0))}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-card-border pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPrice(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Freight</span><span data-testid="checkout-freight">{formatPrice(freight)}</span></div>
              <div className="flex justify-between font-semibold text-base pt-1"><span>Total</span><span data-testid="checkout-total">{formatPrice(total)}</span></div>
            </div>
            {err && <p className="text-sm text-red-600 mt-3" data-testid="checkout-error">{err}</p>}
            <Button className="w-full mt-4" size="lg" onClick={placeOrder} disabled={placing} data-testid="button-place-order">
              {placing ? "Placing order…" : "Place Order (COD)"}
            </Button>
          </Card>
        </div>
      </section>
    </>
  );
}
