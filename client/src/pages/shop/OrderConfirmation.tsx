import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { formatPrice } from "@/lib/currency";
import { SeoHead } from "@/components/SeoHead";

export default function OrderConfirmation() {
  const [, params] = useRoute<{ id: string }>("/order-confirmation/:id");
  const { token } = useShopAuth();
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (!token || !params?.id) return;
    (async () => {
      const r = await shopFetch(token, `/api/shop/orders/${params.id}`);
      if (r.ok) setOrder(await r.json());
    })();
  }, [token, params?.id]);

  return (
    <>
      <SeoHead title="Order Confirmed — Narmada Mobility" description="Your order has been placed successfully." />
      <section className="max-w-lg mx-auto px-4 py-16 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
        <h1 className="font-display font-black text-3xl tracking-tight mb-2">Order Confirmed!</h1>
        <p className="text-muted-foreground mb-6">Thank you for your order. We've sent a confirmation email and our team will reach out shortly.</p>
        {order && (
          <Card className="p-6 border-card-border text-left mb-6">
            <div className="font-mono font-semibold text-lg" data-testid="confirm-order-number">{order.orderNumber}</div>
            <div className="text-sm text-muted-foreground mt-1">{order.items?.length} item(s) · Cash on Delivery</div>
            <div className="border-t border-card-border mt-3 pt-3 flex justify-between font-semibold">
              <span>Total</span><span>{formatPrice(order.totalInr)}</span>
            </div>
          </Card>
        )}
        <div className="flex gap-3 justify-center">
          {order && <Button asChild><Link href={`/customer/orders/${order.id}`}><a>View Order</a></Link></Button>}
          <Button asChild variant="outline"><Link href="/products"><a>Continue Shopping</a></Link></Button>
        </div>
      </section>
    </>
  );
}
