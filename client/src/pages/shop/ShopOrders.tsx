import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, ArrowLeft } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { formatPrice } from "@/lib/currency";
import { SeoHead } from "@/components/SeoHead";

const STATUS_COLORS: Record<string, string> = {
  placed: "bg-blue-600/10 text-blue-700",
  confirmed: "bg-indigo-600/10 text-indigo-700",
  processing: "bg-amber-600/10 text-amber-700",
  dispatched: "bg-purple-600/10 text-purple-700",
  delivered: "bg-green-600/10 text-green-700",
  cancelled: "bg-red-600/10 text-red-700",
};

export default function ShopOrders() {
  const { token, user, ready } = useShopAuth();
  const [, navigate] = useLocation();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // R27.1b BUG-1 — only redirect when fully resolved AND no token (avoid race with revalidate).
  useEffect(() => { if (ready && !token && !user) navigate("/customer/login"); }, [ready, token, user, navigate]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await shopFetch(token, "/api/shop/orders");
      if (r.ok) setOrders(await r.json());
      setLoading(false);
    })();
  }, [token]);

  return (
    <>
      <SeoHead title="My Orders — Narmada Mobility" description="View and track your orders." />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/customer/account"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft className="h-4 w-4" /> Back to account</a></Link>
        <h1 className="font-display font-black text-3xl tracking-tight mb-6 flex items-center gap-2"><Package className="h-7 w-7" /> My Orders</h1>
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <Card className="p-10 text-center border-card-border text-muted-foreground">You haven't placed any orders yet.</Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <Link key={o.id} href={`/customer/orders/${o.id}`}>
                <a>
                  <Card className="p-4 border-card-border hover:border-[hsl(212_95%_50%)]/40 transition-colors flex items-center justify-between gap-4" data-testid={`order-${o.id}`}>
                    <div>
                      <div className="font-mono font-semibold">{o.orderNumber}</div>
                      <div className="text-sm text-muted-foreground">{o.itemCount} item(s) · {new Date(o.createdAt).toLocaleDateString("en-IN")}</div>
                    </div>
                    <div className="text-right">
                      <Badge className={`${STATUS_COLORS[o.status] || "bg-secondary"} hover:opacity-100 capitalize`}>{o.status}</Badge>
                      <div className="font-semibold mt-1">{formatPrice(o.totalInr)}</div>
                    </div>
                  </Card>
                </a>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
