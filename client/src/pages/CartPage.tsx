import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Plus, Minus, ShoppingCart, ArrowLeft } from "lucide-react";
import { getCart, setQty, removeFromCart, subscribeCart, cartSubtotalInr, CartItem } from "@/lib/cart";
import { formatPrice, subscribeCurrency } from "@/lib/currency";
import { SeoHead } from "@/components/SeoHead";

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>(getCart());
  const [, navigate] = useLocation();

  useEffect(() => {
    const refresh = () => setItems(getCart());
    const u1 = subscribeCart(refresh);
    const u2 = subscribeCurrency(refresh);
    return () => { u1(); u2(); };
  }, []);

  const subtotal = cartSubtotalInr();

  return (
    <>
      <SeoHead title="Your Cart — Narmada Mobility" description="Review the items in your cart and proceed to checkout." />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/products"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft className="h-4 w-4" /> Continue shopping</a></Link>
        <h1 className="font-display font-black text-3xl tracking-tight mb-6 flex items-center gap-2"><ShoppingCart className="h-7 w-7" /> Your Cart</h1>

        {items.length === 0 ? (
          <Card className="p-10 text-center border-card-border">
            <p className="text-muted-foreground mb-4">Your cart is empty.</p>
            <Button asChild><Link href="/products"><a>Browse products</a></Link></Button>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-3">
              {items.map((it, i) => (
                <Card key={`${it.productId ?? it.partNumber ?? it.name}-${i}`} className="p-4 border-card-border flex gap-4 items-center" data-testid={`cart-item-${i}`}>
                  <div className="h-16 w-16 rounded-md bg-secondary overflow-hidden flex-shrink-0">
                    {it.image ? <img src={it.image} alt={it.name} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{it.name}</div>
                    {it.partNumber && <div className="text-xs text-muted-foreground font-mono">Part #{it.partNumber}</div>}
                    <div className="text-sm text-muted-foreground mt-0.5">{formatPrice(it.unitPriceInr)} each</div>
                  </div>
                  <div className="inline-flex items-center rounded-md border border-card-border">
                    <button onClick={() => setQty(it, (it.qty || 0) - 1)} className="px-2.5 py-1.5 hover:bg-secondary" data-testid={`cart-dec-${i}`} aria-label="Decrease"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-8 text-center text-sm" data-testid={`cart-qty-${i}`}>{it.qty || 0}</span>
                    <button onClick={() => setQty(it, (it.qty || 0) + 1)} className="px-2.5 py-1.5 hover:bg-secondary" data-testid={`cart-inc-${i}`} aria-label="Increase"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="w-24 text-right font-semibold">{formatPrice(it.unitPriceInr * (it.qty || 0))}</div>
                  <button onClick={() => removeFromCart(it)} className="text-muted-foreground hover:text-red-600" data-testid={`cart-remove-${i}`} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </Card>
              ))}
            </div>

            <Card className="p-6 border-card-border self-start">
              <h2 className="font-display font-black text-lg mb-4">Order summary</h2>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold" data-testid="cart-subtotal">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm mb-4">
                <span className="text-muted-foreground">Freight</span>
                <span className="text-muted-foreground">Calculated at checkout</span>
              </div>
              <Button className="w-full" size="lg" onClick={() => navigate("/checkout")} data-testid="button-checkout">
                Proceed to Checkout
              </Button>
              <p className="text-xs text-muted-foreground mt-3 text-center">Cash on Delivery available</p>
            </Card>
          </div>
        )}
      </section>
    </>
  );
}
