import { useEffect, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Truck } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { formatPrice } from "@/lib/currency";
import { SeoHead } from "@/components/SeoHead";

export default function ShopOrderDetail() {
  const [, params] = useRoute<{ id: string }>("/customer/orders/:id");
  const { token, user, ready } = useShopAuth();
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // R27.1b BUG-1 — only redirect when fully resolved AND no token (avoid race with revalidate).
  useEffect(() => { if (ready && !token && !user) navigate("/customer/login"); }, [ready, token, user, navigate]);

  useEffect(() => {
    if (!token || !params?.id) return;
    (async () => {
      const r = await shopFetch(token, `/api/shop/orders/${params.id}`);
      if (r.ok) setOrder(await r.json());
      setLoading(false);
    })();
  }, [token, params?.id]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-muted-foreground">Loading…</div>;
  if (!order) return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-muted-foreground">Order not found.</div>;

  const s = order.ship || {};
  return (
    <>
      <SeoHead title={`Order ${order.orderNumber} — Narmada Mobility`} description="Order details and tracking." />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/customer/orders"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft className="h-4 w-4" /> All orders</a></Link>
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display font-black text-2xl tracking-tight font-mono">{order.orderNumber}</h1>
          <Badge className="capitalize bg-secondary">{order.status}</Badge>
        </div>

        {order.status === "dispatched" && (
          <Card className="p-4 border-card-border mb-4 bg-purple-600/5">
            <div className="font-semibold flex items-center gap-2"><Truck className="h-4 w-4" /> Dispatched</div>
            {order.dispatchedCarrier && <div className="text-sm mt-1">Carrier: {order.dispatchedCarrier}</div>}
            {order.dispatchedDocket && <div className="text-sm">Docket / Tracking #: {order.dispatchedDocket}</div>}
          </Card>
        )}

        <Card className="p-5 border-card-border mb-4">
          <h2 className="font-semibold mb-3">Items</h2>
          <div className="space-y-2">
            {order.items.map((it: any) => (
              <div key={it.id} className="flex justify-between text-sm" data-testid={`order-item-${it.id}`}>
                <span>{it.name}{it.partNumber ? ` (${it.partNumber})` : ""} × {it.qty}</span>
                <span className="font-medium">{formatPrice(it.totalInr)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-card-border mt-3 pt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatPrice(order.subtotalInr)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Freight</span><span>{formatPrice(order.freightInr)}</span></div>
            <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{formatPrice(order.totalInr)}</span></div>
            <div className="text-xs text-muted-foreground pt-1">Payment: {order.paymentMode} · {order.paymentStatus}</div>
          </div>
        </Card>

        <Card className="p-5 border-card-border">
          <h2 className="font-semibold mb-2">Shipping address</h2>
          <div className="text-sm text-muted-foreground">
            {s.fullName}, {s.phone}<br />
            {s.line1}{s.line2 ? `, ${s.line2}` : ""}<br />
            {s.city}, {s.state} - {s.pincode}
          </div>
        </Card>
      </section>
    </>
  );
}
