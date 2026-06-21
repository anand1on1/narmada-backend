import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heart, Trash2, ArrowLeft, ShoppingCart } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";
import { formatPrice } from "@/lib/currency";
import { addToCart } from "@/lib/cart";
import { parseJsonArray } from "@/lib/utils-app";
import { SeoHead } from "@/components/SeoHead";
import { useToast } from "@/hooks/use-toast";

export default function ShopWishlist() {
  const { token, user, ready } = useShopAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (ready && !user) navigate("/customer/login"); }, [ready, user, navigate]);

  const load = async () => {
    if (!token) return;
    const r = await shopFetch(token, "/api/shop/wishlist");
    if (r.ok) setItems(await r.json());
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const remove = async (id: number) => {
    await shopFetch(token, `/api/shop/wishlist/${id}`, { method: "DELETE" });
    load();
  };

  const toCart = (w: any) => {
    const img = parseJsonArray(w.imageUrls)[0] || null;
    addToCart({ productId: w.productId, slug: w.slug, partNumber: w.partNumber, name: w.name, image: img, unitPriceInr: w.priceInr }, 1);
    toast({ title: "Added to cart", description: w.name });
  };

  return (
    <>
      <SeoHead title="Wishlist — Narmada Mobility" description="Your saved products." />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/customer/account"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft className="h-4 w-4" /> Back to account</a></Link>
        <h1 className="font-display font-black text-3xl tracking-tight mb-6 flex items-center gap-2"><Heart className="h-7 w-7" /> Wishlist</h1>
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center border-card-border text-muted-foreground">Your wishlist is empty.</Card>
        ) : (
          <div className="space-y-3">
            {items.map((w) => (
              <Card key={w.id} className="p-4 border-card-border flex items-center gap-4" data-testid={`wishlist-${w.id}`}>
                <div className="h-14 w-14 rounded-md bg-secondary overflow-hidden flex-shrink-0">
                  {parseJsonArray(w.imageUrls)[0] && <img src={parseJsonArray(w.imageUrls)[0]} alt={w.name} className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={w.slug ? `/product/${w.slug}` : "#"}><a className="font-semibold truncate hover:text-[hsl(212_95%_50%)]">{w.name || w.partNumber}</a></Link>
                  {w.partNumber && <div className="text-xs text-muted-foreground font-mono">Part #{w.partNumber}</div>}
                  {w.priceInr != null && <div className="text-sm text-muted-foreground">{formatPrice(w.priceInr)}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => toCart(w)} disabled={w.priceInr == null} data-testid={`wishlist-cart-${w.id}`}><ShoppingCart className="h-4 w-4 mr-1" /> Add</Button>
                <button onClick={() => remove(w.id)} className="text-muted-foreground hover:text-red-600" data-testid={`wishlist-remove-${w.id}`}><Trash2 className="h-4 w-4" /></button>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
