import { apiUrl } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MessageCircle, Phone, Mail, Package, ShieldCheck, Truck, ArrowLeft } from "lucide-react";
import { whatsappLink, buildBuyMessage, formatUSD, formatINR, parseJsonArray } from "@/lib/utils-app";
import { BRANDS } from "@/data/brands";
import { SeoHead } from "@/components/SeoHead";
import NotFound from "@/pages/not-found";
import { useState } from "react";

export default function ProductDetailPage() {
  const [, params] = useRoute<{ slug: string }>("/product/:slug");
  const slug = params?.slug;
  const { data: product, isLoading } = useQuery<Product>({
    queryKey: [`/api/products/${slug}`],
    queryFn: async () => { const r = await fetch(apiUrl(`/api/products/${slug}`)); if (!r.ok) throw new Error("Not found"); return r.json(); },
    enabled: !!slug,
  });
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;
  const [activeImg, setActiveImg] = useState(0);

  if (isLoading) return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20"><div className="h-96 bg-secondary animate-pulse rounded-lg" /></div>;
  if (!product) return <NotFound />;

  const brandInfo = BRANDS[product.brand as keyof typeof BRANDS];
  const images = parseJsonArray(product.imageUrls);
  const compatible = parseJsonArray(product.compatibleModels);
  const buyUrl = whatsappLink("7909083806", buildBuyMessage({
    name: product.name, partNumber: product.partNumber || undefined, slug: product.slug, brand: brandInfo?.name || product.brand,
  }));

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
          {product.partNumber && <div className="mt-2 font-mono text-sm text-[hsl(220_60%_12%)]/75 font-medium">Part No. <span className="text-foreground">{product.partNumber}</span>{product.oemNumber && <> · OEM <span className="text-foreground">{product.oemNumber}</span></>}</div>}

          <div className="mt-6 p-5 rounded-xl bg-secondary/40 border border-card-border">
            <div className="text-xs uppercase tracking-wider text-[hsl(220_60%_12%)]/75 font-medium">Price</div>
            <div className="text-4xl font-display font-black text-foreground" data-testid="product-price-usd">{formatUSD(product.priceInr, usdInr)}</div>
            <div className="text-sm text-muted-foreground mt-0.5">≈ {formatINR(product.priceInr)} · auto-converted at live USD/INR rate</div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#25D366] hover:bg-[#1da851] text-white" data-testid="button-buy-now">
                <a href={buyUrl} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-2" /> Buy Now on WhatsApp</a>
              </Button>
              <Button asChild size="lg" variant="outline" data-testid="button-call">
                <a href="tel:+917909083806"><Phone className="h-4 w-4 mr-2" /> Call to Order</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-[hsl(220_60%_12%)]/75 font-medium">Clicking Buy Now opens WhatsApp with this part pre-filled. Our sales team confirms availability, freight, and lead time within an hour during business hours.</p>
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
