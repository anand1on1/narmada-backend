// SEO landing page for /:brand-spare-parts-:location combinations.
// Route example: /tata-spare-parts-maharashtra, /volvo-spare-parts-kenya
import { apiUrl } from "@/lib/queryClient";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SeoHead } from "@/components/SeoHead";
import { ProductCard } from "@/components/ProductCard";
import { BRANDS, INDIAN_STATES, TARGET_COUNTRIES, PRODUCT_CATEGORIES, type BrandKey } from "@/data/brands";
import type { Product } from "@shared/schema";
import { MapPin, Truck, ShieldCheck, Globe2, Phone } from "lucide-react";

function findLocation(slug: string): { name: string; type: "state" | "country" } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  for (const st of INDIAN_STATES) if (norm(st) === slug) return { name: st, type: "state" };
  for (const c of TARGET_COUNTRIES) if (norm(c) === slug) return { name: c, type: "country" };
  return null;
}

export default function SeoLandingPage(props: { __brand?: string; __location?: string }) {
  const params = useParams<{ brand?: string; location?: string }>();
  const brandKey = (props.__brand ?? params.brand) as BrandKey | undefined;
  const locSlug = props.__location ?? params.location;
  const brand = brandKey ? BRANDS[brandKey] : undefined;
  const loc = locSlug ? findLocation(locSlug) : null;

  const { data: settings } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = settings?.usdInr ?? 83.5;

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products", { brand: brand?.key }],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/products?brand=${encodeURIComponent(brand?.key ?? "")}`));
      return r.json();
    },
    enabled: !!brand,
  });

  if (!brand || !loc) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-bold mb-3">Page not found</h1>
        <Link href="/" className="text-accent font-semibold">← Return home</Link>
      </div>
    );
  }

  const title = `${brand.name} Spare Parts in ${loc.name} — Exporter & Supplier | Narmada Mobility`;
  const description = `Buy genuine ${brand.name} spare parts in ${loc.name}. Engine, dozer, urea, clutch, gearbox, suspension, electrical and BS6 parts for ${brand.models.slice(0, 4).join(", ")} and more. Worldwide shipping from Patna, India.`;
  const keywords = [
    `${brand.name} spare parts ${loc.name}`,
    `${brand.name} parts dealer ${loc.name}`,
    `${brand.name} ${loc.type === "state" ? "India" : loc.name}`,
    ...brand.models.slice(0, 6).map((m) => `${m} spare parts`),
  ].join(", ");

  return (
    <>
      <SeoHead title={title} description={description} keywords={keywords} />

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-primary via-primary to-slate-900 text-primary-foreground py-16 lg:py-24 overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-10" />
        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 text-sm text-accent uppercase tracking-wider font-semibold mb-3">
              <MapPin className="w-4 h-4" /> {loc.type === "state" ? "India" : "Worldwide"} · {loc.name}
            </div>
            <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold leading-tight mb-5">
              {brand.name} Spare Parts in <span className="text-gradient-amber">{loc.name}</span>
            </h1>
            <p className="text-lg text-primary-foreground/85 leading-relaxed max-w-3xl">
              Narmada Mobility is a leading supplier and exporter of genuine {brand.name} spare parts to {loc.name}. Engine, gearbox, dozer & urea (BS6), suspension, brake, electrical and cabin parts for {brand.models.slice(0, 3).join(", ")} and the full {brand.name} range — shipped from our Patna warehouse to {loc.name} {loc.type === "country" ? "by air or sea" : "anywhere in the state via road and rail freight"}.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/contact" className="px-7 py-3.5 bg-accent text-accent-foreground rounded-lg font-bold hover:bg-accent/90 transition" data-testid="link-quote-hero">
                Get a Quote
              </Link>
              <a href="tel:+917909083806" className="px-7 py-3.5 border-2 border-[hsl(220_45%_20%)]/30 rounded-lg font-bold hover:bg-[hsl(220_45%_20%)]/10 transition inline-flex items-center gap-2" data-testid="link-call-hero">
                <Phone className="w-4 h-4" /> +91 7909083806
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="py-8 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30 border-b">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            {[
              { icon: ShieldCheck, t: "Genuine Sourcing" },
              { icon: Globe2, t: `Direct to ${loc.name}` },
              { icon: Truck, t: "Door-to-Door Delivery" },
              { icon: Phone, t: "24×7 Support" },
            ].map((b) => (
              <div key={b.t} className="flex items-center gap-3">
                <b.icon className="w-6 h-6 text-accent" />
                <span className="font-semibold">{b.t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Models targeted */}
      <section className="py-14 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Models Covered</div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-6">
            {brand.name} Models We Supply in {loc.name}
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6 max-w-3xl">
            Our {brand.name} parts catalogue for {loc.name} covers the complete model range — from light commercial to heavy mining tippers, trailers and {brand.key === "volvo" ? "construction equipment" : "buses"}.
          </p>
          <div className="flex flex-wrap gap-2">
            {brand.models.map((m) => (
              <span key={m} className="px-3 py-1.5 bg-card border rounded-md text-sm font-mono text-foreground/80 hover:border-accent transition">
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-14 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Parts We Stock</div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-6">
            All {brand.name} Spare Parts Categories — Available for {loc.name}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PRODUCT_CATEGORIES.map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="block p-5 bg-card border rounded-lg hover:border-accent hover:shadow-md transition"
                data-testid={`link-category-${c.slug}`}
              >
                <div className="font-semibold mb-1">{c.name}</div>
                <div className="text-sm text-[hsl(220_60%_12%)]/75 font-medium">{brand.name} {c.name.toLowerCase()} for {loc.name}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Products */}
      {products.length > 0 && (
        <section className="py-16 bg-background">
          <div className="container mx-auto px-4 max-w-7xl">
            <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">In Stock Now</div>
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-8">Featured {brand.name} Parts Available</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {products.slice(0, 8).map((p) => (
                <ProductCard key={p.id} product={p} usdInr={usdInr} />
              ))}
            </div>
            <div className="text-center mt-10">
              <Link href={`/brand/${brand.key}`} className="inline-block px-7 py-3 bg-accent text-accent-foreground rounded-lg font-bold" data-testid="link-view-all">
                View All {brand.name} Parts
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Long-form SEO */}
      <section className="py-16 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-5">
            Why {loc.name} Customers Choose Narmada for {brand.name} Parts
          </h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">Direct sourcing.</strong> We work with {brand.name}'s authorised distribution chain and tier-1 component suppliers, which means every part we ship to {loc.name} carries the same OE quality you'd get at a {brand.name} dealership in India — at a fraction of the price.
            </p>
            <p>
              <strong className="text-foreground">Built for {loc.type === "country" ? "international export" : "all-India dispatch"}.</strong> Whether you're in {loc.name}'s commercial capital or a remote district, our logistics team coordinates door-to-door shipping with full export documentation — commercial invoice, packing list, certificate of origin and HS-code classification.
            </p>
            <p>
              <strong className="text-foreground">Complete coverage.</strong> From engine overhaul kits and turbochargers to BS-VI dozer and urea injection components, propeller shafts, leaf springs, brake drums, electrical sensors, cabin parts and undercarriage components — our {brand.name} catalogue covers the entire mechanical and electrical bill of materials.
            </p>
            <p>
              <strong className="text-foreground">Talk to a real human.</strong> Send your chassis number, engine number or existing part number on WhatsApp <a className="text-accent font-semibold" href="https://wa.me/917909083806">+91 7909083806</a> — we will identify the part, confirm stock and email you a formal quotation in INR or USD.
            </p>
          </div>

          <div className="mt-10 p-7 bg-accent/10 border border-accent/30 rounded-xl">
            <h3 className="font-display text-xl font-bold mb-2">Ready to source for {loc.name}?</h3>
            <p className="text-muted-foreground mb-4">Send us your enquiry — typical response within 2 business hours.</p>
            <Link href="/contact" className="inline-block px-6 py-3 bg-accent text-accent-foreground rounded-lg font-bold" data-testid="link-cta-final">
              Request Quote for {brand.name} Parts
            </Link>
          </div>
        </div>
      </section>

      {/* Inter-link */}
      <section className="py-12 bg-background border-t">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-4">
            Also Available — {brand.name} Parts in Other {loc.type === "state" ? "States" : "Countries"}
          </div>
          <div className="flex flex-wrap gap-2">
            {(loc.type === "state" ? INDIAN_STATES : TARGET_COUNTRIES)
              .filter((x) => x !== loc.name)
              .slice(0, 18)
              .map((x) => {
                const xSlug = x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                return (
                  <Link
                    key={x}
                    href={`/${brand.key}-spare-parts-${xSlug}`}
                    className="px-3 py-1.5 text-sm bg-card border rounded-md hover:border-accent hover:text-accent transition"
                    data-testid={`link-loc-${xSlug}`}
                  >
                    {brand.name} parts {x}
                  </Link>
                );
              })}
          </div>
        </div>
      </section>
    </>
  );
}
