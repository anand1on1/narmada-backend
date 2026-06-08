import { apiUrl } from "@/lib/queryClient";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SeoHead } from "@/components/SeoHead";
import { ProductCard } from "@/components/ProductCard";
import { BRANDS, PRODUCT_CATEGORIES } from "@/data/brands";
import type { Product } from "@shared/schema";
import { Wrench, ArrowLeft } from "lucide-react";

export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const cat = PRODUCT_CATEGORIES.find((c) => c.slug === params.slug);

  const { data: settings } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = settings?.usdInr ?? 83.5;

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products", { category: params.slug }],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/products?category=${encodeURIComponent(params.slug)}`));
      return r.json();
    },
  });

  if (!cat) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-bold mb-3">Category not found</h1>
        <Link href="/products" className="text-accent font-semibold">← Back to all products</Link>
      </div>
    );
  }

  const brandSlugs = Object.keys(BRANDS) as Array<keyof typeof BRANDS>;

  return (
    <>
      <SeoHead
        title={`${cat.name} — Spare Parts for Tata, BharatBenz, Volvo, Eicher, Ashok Leyland | Narmada Mobility`}
        description={`Buy genuine and OEM-equivalent ${cat.name.toLowerCase()} for Indian commercial vehicles. Worldwide export. Compare across all 5 major brands at Narmada Mobility.`}
        keywords={`${cat.name.toLowerCase()}, tata ${cat.name.toLowerCase()}, volvo ${cat.name.toLowerCase()}, bharat benz ${cat.name.toLowerCase()}, spare parts ${cat.slug}`}
      />

      <section className="bg-gradient-to-br from-primary to-slate-900 text-primary-foreground py-16 lg:py-20">
        <div className="container mx-auto px-4">
          <Link href="/products" className="inline-flex items-center gap-2 text-primary-foreground/70 hover:text-accent mb-4 text-sm" data-testid="link-back">
            <ArrowLeft className="w-4 h-4" /> All Categories
          </Link>
          <div className="flex items-start gap-5 max-w-3xl">
            <div className="w-16 h-16 bg-accent/20 border border-accent/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wrench className="w-8 h-8 text-accent" />
            </div>
            <div>
              <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-2">Category</div>
              <h1 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold mb-3">{cat.name}</h1>
              <p className="text-primary-foreground/80 leading-relaxed">
                Authentic {cat.name.toLowerCase()} for India's leading commercial vehicle brands — exported to 60+ countries with full documentation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Brand filters */}
      <section className="py-10 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30 border-b">
        <div className="container mx-auto px-4">
          <div className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-4">Shop {cat.name} by Brand</div>
          <div className="flex flex-wrap gap-3">
            {brandSlugs.map((b) => {
              const brand = BRANDS[b];
              return (
                <Link
                  key={b}
                  href={`/brand/${b}`}
                  className="px-5 py-3 bg-card border rounded-lg hover:border-accent hover:shadow-md transition font-semibold"
                  data-testid={`link-brand-${b}`}
                >
                  {brand.name}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="py-12 lg:py-16 bg-background">
        <div className="container mx-auto px-4">
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-80 bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground mb-6">No products listed yet in this category. Send us your enquiry — we likely have it in stock.</p>
              <Link href="/contact" className="inline-block px-6 py-3 bg-accent text-accent-foreground rounded-lg font-bold" data-testid="link-contact-empty">
                Request a Quote
              </Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} usdInr={usdInr} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SEO content */}
      <section className="py-16 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="font-display text-2xl font-bold mb-4">About {cat.name}</h2>
          <p className="text-muted-foreground leading-relaxed">
            Narmada Mobility is one of India's leading exporters of {cat.name.toLowerCase()} for medium and heavy commercial vehicles. We stock and ship parts across the entire spectrum — from Tata SFC 407 light commercial to Volvo EC 210 excavator and BharatBenz 3523 R BS6 mining tippers. Every part comes with full traceability, OEM cross-reference where applicable, and worldwide door-to-door shipping. Whether you operate one truck or a thousand, we have a pricing tier for you.
          </p>
        </div>
      </section>
    </>
  );
}
