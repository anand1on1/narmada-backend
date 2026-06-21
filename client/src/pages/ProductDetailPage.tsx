import { apiUrl } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MessageCircle, Phone, Mail, Package, ShieldCheck, Truck, ArrowLeft, ShoppingCart, Plus, Minus } from "lucide-react";
import { whatsappLink, buildBuyMessage, parseJsonArray, productHref } from "@/lib/utils-app";
import { BRANDS } from "@/data/brands";
import { SeoHead } from "@/components/SeoHead";
import NotFound from "@/pages/not-found";
import { useState } from "react";
import { useLocation } from "wouter";
import { addToCart } from "@/lib/cart";
import { formatPrice, getCurrency } from "@/lib/currency";
import { useToast } from "@/hooks/use-toast";

export default function ProductDetailPage() {
  // Match both /product/:slug and the SEO-friendly /product/:slug/:partNumber.
  // The part number in the URL is purely for bookmarkability/SEO — the product is
  // still loaded by slug, so either route resolves to the same page.
  const [, params2] = useRoute<{ slug: string; partNumber: string }>("/product/:slug/:partNumber");
  const [, params1] = useRoute<{ slug: string }>("/product/:slug");
  const slug = params2?.slug || params1?.slug;
  const { data: product, isLoading } = useQuery<Product>({
    queryKey: [`/api/products/${slug}`],
    queryFn: async () => { const r = await fetch(apiUrl(`/api/products/${slug}`)); if (!r.ok) throw new Error("Not found"); return r.json(); },
    enabled: !!slug,
  });
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;
  const [activeImg, setActiveImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  if (isLoading) return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20"><div className="h-96 bg-secondary animate-pulse rounded-lg" /></div>;
  if (!product) return <NotFound />;

  const brandInfo = BRANDS[product.brand as keyof typeof BRANDS];
  const images = parseJsonArray(product.imageUrls);
  const compatible = parseJsonArray(product.compatibleModels);
  const buyUrl = whatsappLink("7909083806", buildBuyMessage({
    name: product.name, partNumber: product.partNumber || undefined, slug: product.slug, brand: brandInfo?.name || product.brand,
  }));

  const cartLine = {
    productId: product.id,
    slug: product.slug,
    partNumber: product.partNumber || null,
    name: product.name,
    image: images[0] || null,
    unitPriceInr: product.priceInr,
  };
  const handleAddToCart = () => {
    addToCart(cartLine, qty);
    toast({ title: "Added to cart", description: `${qty} × ${product.name}` });
  };
  const handleBuyNow = () => {
    addToCart(cartLine, qty);
    navigate("/checkout");
  };

  return (
    <>
      <SeoHead
        title={product.metaTitle || `${product.name} — ${brandInfo?.name || product.brand} | Narmada Mobility`}
        description={product.metaDescription || product.shortDescription || product.description.slice(0, 160)}
        keywords={product.metaKeywords || undefined}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          image: images,
          description: product.description,
          sku: product.partNumber || product.slug,
          mpn: product.oemNumber || undefined,
          brand: { "@type": "Brand", name: brandInfo?.name || product.brand },
          offers: {
            "@type": "Offer",
            priceCurrency: "USD",
            price: (product.priceInr / usdInr).toFixed(2),
            availability: (product.stockQty ?? 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
            seller: { "@type": "Organization", name: "Narmada Mobility" },
          },
        }}
      />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/products"><a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All products</a></Link>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 grid lg:grid-cols-2 gap-10">
        {/* Image gallery */}
        <div>
          <div className="aspect-square rounded-xl overflow-hidden bg-secondary border border-card-border">
            {images.length > 0 ? (
              <img src={images[activeImg]} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[hsl(220_60%_12%)]/75 font-medium"><Package className="h-20 w-20" /></div>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {images.map((src, i) => (
                <button key={i} onClick={() => setActiveImg(i)} className={`aspect-square rounded-md overflow-hidden border-2 ${i === activeImg ? "border-[hsl(212_95%_55%)]" : "border-transparent"}`} data-testid={`thumb-${i}`}>
                  <img src={src} alt={`${product.name} view ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {brandInfo && <Badge style={{ backgroundColor: brandInfo.color }} className="text-[hsl(220_60%_12%)] hover:opacity-90" data-testid="badge-brand">{brandInfo.name}</Badge>}
            {product.model && <Badge variant="outline">{product.model}</Badge>}
            <Badge variant="outline">{product.category}</Badge>
            {(product.stockQty ?? 0) > 0 ? (
              <Badge className="bg-green-600/15 text-green-700 hover:bg-green-600/15">In stock · {product.stockQty} units</Badge>
            ) : (
              <Badge variant="outline">Made to order</Badge>
            )}
          </div>
          <h1 className="font-display font-black text-3xl md:text-4xl tracking-tight leading-tight" data-testid="product-title">{product.name}</h1>
          {(product.partNumber || product.oemNumber) && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="product-part-number">
              {product.partNumber && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary border border-card-border px-3 py-1.5 font-mono text-sm font-semibold text-foreground">
                  <span className="text-muted-foreground font-normal">Part #</span>{product.partNumber}
                </span>
              )}
              {product.oemNumber && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary border border-card-border px-3 py-1.5 font-mono text-sm font-semibold text-foreground">
                  <span className="text-muted-foreground font-normal">OEM #</span>{product.oemNumber}
                </span>
              )}
            </div>
          )}

          <div className="mt-6 p-5 rounded-xl bg-secondary/40 border border-card-border">
            <div className="text-xs uppercase tracking-wider text-[hsl(220_60%_12%)]/75 font-medium">Price</div>
            <div className="text-4xl font-display font-black text-foreground" data-testid="product-price">{formatPrice(product.priceInr)}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{getCurrency() === "USD" ? "Converted at live USD/INR rate" : "Inclusive of GST · freight calculated at checkout"}</div>

            {/* Qty stepper */}
            <div className="mt-5 flex items-center gap-3">
              <span className="text-sm font-medium">Quantity</span>
              <div className="inline-flex items-center rounded-md border border-card-border">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2 hover:bg-secondary" data-testid="qty-dec" aria-label="Decrease quantity"><Minus className="h-4 w-4" /></button>
                <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-14 text-center bg-transparent outline-none" data-testid="qty-input" />
                <button onClick={() => setQty((q) => q + 1)} className="px-3 py-2 hover:bg-secondary" data-testid="qty-inc" aria-label="Increase quantity"><Plus className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button size="lg" onClick={handleBuyNow} className="bg-[hsl(212_95%_50%)] hover:bg-[hsl(212_95%_45%)] text-white" data-testid="button-buy-now">
                <ShoppingCart className="h-4 w-4 mr-2" /> Buy Now
              </Button>
              <Button size="lg" variant="outline" onClick={handleAddToCart} data-testid="button-add-cart">
                <ShoppingCart className="h-4 w-4 mr-2" /> Add to Cart
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button asChild size="sm" variant="ghost" className="text-[#25D366] hover:text-[#1da851]" data-testid="button-whatsapp">
                <a href={buyUrl} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-2" /> Enquire on WhatsApp</a>
              </Button>
              <Button asChild size="sm" variant="ghost" data-testid="button-call">
                <a href="tel:+917909083806"><Phone className="h-4 w-4 mr-2" /> Call to Order</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-[hsl(220_60%_12%)]/75 font-medium">Cash on Delivery available. Our team confirms availability and freight before dispatch.</p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Card className="p-3 border-card-border"><Truck className="h-5 w-5 mx-auto mb-1 text-[hsl(212_95%_50%)]" /><div className="text-xs font-medium">Global Shipping</div></Card>
            <Card className="p-3 border-card-border"><ShieldCheck className="h-5 w-5 mx-auto mb-1 text-[hsl(212_95%_50%)]" /><div className="text-xs font-medium">OEM Verified</div></Card>
            <Card className="p-3 border-card-border"><Package className="h-5 w-5 mx-auto mb-1 text-[hsl(212_95%_50%)]" /><div className="text-xs font-medium">Safe Packaging</div></Card>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20 grid lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <h2 className="font-display font-black text-2xl tracking-tight mb-4">Product description</h2>
          <p className="text-base leading-relaxed text-muted-foreground whitespace-pre-line">{product.description}</p>
          {compatible.length > 0 && (
            <>
              <h3 className="font-display font-black text-lg mt-8 mb-3">Compatible models</h3>
              <div className="flex flex-wrap gap-2">
                {compatible.map((m) => <Badge key={m} variant="outline">{m}</Badge>)}
              </div>
            </>
          )}
        </div>
        <Card className="p-6 border-card-border bg-secondary/30 self-start">
          <h3 className="font-display font-black mb-3">Need help choosing?</h3>
          <p className="text-sm text-muted-foreground mb-4">Share your chassis VIN or part reference — we'll confirm the exact fitment.</p>
          <div className="space-y-2 text-sm">
            <a href="https://wa.me/917909083806" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-[hsl(212_95%_50%)]"><MessageCircle className="h-4 w-4 text-[#25D366]" /> WhatsApp +91 79090 83806</a>
            <a href="mailto:sales@Narmadamobility.com" className="flex items-center gap-2 hover:text-[hsl(212_95%_50%)]"><Mail className="h-4 w-4" /> sales@Narmadamobility.com</a>
            <a href="tel:+917909083806" className="flex items-center gap-2 hover:text-[hsl(212_95%_50%)]"><Phone className="h-4 w-4" /> Call: +91 79090 83806</a>
          </div>
        </Card>
      </section>
    </>
  );
}
