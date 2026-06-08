import { apiUrl } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { BRANDS, type BrandKey, INDIAN_STATES, TARGET_COUNTRIES } from "@/data/brands";
import { SeoHead } from "@/components/SeoHead";
import NotFound from "@/pages/not-found";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, MapPin, CheckCircle2, Globe, MessageCircle, Truck, Package, ShieldCheck, Clock, Award, Factory, Anchor, Wrench, Cog, FileText, Banknote, Ship, Phone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { ProductCard } from "@/components/ProductCard";
import { toSlug } from "@/lib/utils-app";
import excavatorImg from "@/assets/excavator-action.png";
import tipperImg from "@/assets/tipper-mining.png";
import truckImg from "@/assets/truck-tata-style.png";

// Accent palette (tasteful — orange for stats/eyebrows, green for trust, deeper blue for immersive bands)
const ORANGE = "hsl(22 90% 55%)";
const GREEN = "hsl(150 65% 40%)";
const ELECTRIC = "hsl(212 95% 55%)";

export default function BrandPage() {
  const [, params] = useRoute<{ slug: string }>("/brand/:slug");
  const slug = params?.slug as BrandKey | undefined;
  const brand = slug ? BRANDS[slug] : undefined;
  if (!brand) return <NotFound />;

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products", `brand=${brand.slug}`],
    queryFn: async () => { const r = await fetch(apiUrl(`/api/products?brand=${brand.slug}`)); return r.ok ? r.json() : []; },
  });
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;

  const heroImg = brand.category === "equipment" ? excavatorImg : brand.key === "ashok-leyland" ? tipperImg : truckImg;

  const title = `${brand.name} Spare Parts — Genuine + OEM Exporter India | Narmada Mobility`;
  const description = `${brand.description} Authorized supplier exporting ${brand.name} spares to 60+ countries. ${brand.models.length}+ models · ${brand.categories.length} part categories · Same-day dispatch from Patna, India.`;
  const keywords = brand.keywordTargets.join(", ");

  // Structured data: Product + FAQ + Breadcrumb
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${brand.name} Spare Parts`,
    brand: { "@type": "Brand", name: brand.name },
    description: brand.longDescription,
    offers: { "@type": "AggregateOffer", offerCount: products.length || 100, priceCurrency: "USD", availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: "Narmada Mobility" } },
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: brand.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: "Brands", item: "/products" },
      { "@type": "ListItem", position: 3, name: brand.name, item: `/brand/${brand.slug}` },
    ],
  };

  return (
    <>
      <SeoHead title={title} description={description} keywords={keywords} jsonLd={[productLd, faqLd, breadcrumbLd]} />

      {/* HERO — confident dark gradient, white text, brand-color accent stripe */}
      <section className="relative overflow-hidden text-white" style={{ background: "linear-gradient(135deg, hsl(220 60% 10%) 0%, hsl(220 55% 16%) 60%, hsl(212 70% 22%) 100%)" }}>
        {/* Background equipment imagery — dimmed & desaturated for readability */}
        <div className="absolute inset-0 opacity-[0.18]">
          <img src={heroImg} alt="" className="w-full h-full object-cover" style={{ filter: "grayscale(0.4) contrast(1.1)" }} />
        </div>
        {/* Dark scrim ensures text contrast everywhere */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, hsl(220 60% 10% / 0.92) 0%, hsl(220 60% 10% / 0.7) 55%, hsl(220 60% 10% / 0.45) 100%)" }} />
        {/* Brand-color accent stripe at top */}
        <div className="absolute top-0 inset-x-0 h-1" style={{ background: `linear-gradient(to right, ${brand.color}, ${ORANGE}, ${ELECTRIC})` }} />
        {/* Subtle dotted texture */}
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <Link href="/products"><a className="inline-flex items-center text-sm text-white/85 hover:text-white mb-5 font-bold transition-colors" data-testid="link-back">← All brands</a></Link>

          <div className="flex flex-wrap items-center gap-2.5 mb-5">
            <Badge className="bg-white/10 text-white border-white/25 hover:bg-white/15 font-bold backdrop-blur-sm">
              <Factory className="h-3 w-3 mr-1.5" /> Since {brand.founded}
            </Badge>
            <Badge className="bg-white/10 text-white border-white/25 hover:bg-white/15 font-bold backdrop-blur-sm">
              <MapPin className="h-3 w-3 mr-1.5" /> {brand.origin}
            </Badge>
            <Badge className="text-white font-bold border-0 shadow-md" style={{ backgroundColor: GREEN }}>
              <ShieldCheck className="h-3 w-3 mr-1" /> Authorized Supplier
            </Badge>
            <Badge className="text-white font-bold border-0 shadow-md" style={{ backgroundColor: ORANGE }}>
              <Award className="h-3 w-3 mr-1" /> 20+ Yrs Exporter
            </Badge>
            <Badge className="text-white font-bold border-0 shadow-md" style={{ backgroundColor: brand.color }}>
              {brand.category === "truck" ? "Trucks · Buses" : "Construction Equipment"}
            </Badge>
          </div>

          <h1 className="font-display font-black text-4xl md:text-6xl tracking-tight max-w-4xl leading-[1.02] text-white" data-testid="brand-title">
            {brand.name} <span className="text-white/85">Spare Parts</span>
          </h1>
          <p className="mt-5 text-lg md:text-xl text-white/90 max-w-3xl leading-relaxed font-semibold">{brand.tagline}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-white font-bold shadow-lg shadow-[hsl(212_95%_55%)]/30" data-testid="btn-shop">
              <Link href={`/products?brand=${brand.slug}`}>Shop {brand.name} Parts <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
            <Button asChild size="lg" className="text-white font-bold border-0 shadow-lg" style={{ backgroundColor: GREEN }}>
              <a href="https://wa.me/917909083806" target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-2" /> WhatsApp Enquiry</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/35 text-white hover:bg-white/10 font-bold bg-transparent">
              <a href="tel:+917909083806"><Phone className="h-4 w-4 mr-2" /> +91 79090 83806</a>
            </Button>
          </div>

          {/* Hero stat strip */}
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl">
            {[
              { v: `${brand.models.length}+`, l: "Models Covered" },
              { v: `${brand.categories.length}`, l: "Part Categories" },
              { v: "60+", l: "Export Countries" },
              { v: "48h", l: "VIN-to-Quote" },
            ].map((s) => (
              <div key={s.l} className="bg-white/10 backdrop-blur-md border border-white/15 rounded-lg p-4">
                <div className="font-display font-black text-2xl md:text-3xl leading-none" style={{ color: ORANGE }}>{s.v}</div>
                <div className="text-[10px] uppercase tracking-wider font-black text-white/80 mt-2">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY THIS BRAND MATTERS — keyword-rich intro */}
      {brand.whyMatters && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid lg:grid-cols-5 gap-8 lg:gap-12">
            <div className="lg:col-span-3">
              <div className="text-xs uppercase tracking-[0.2em] font-black mb-3" style={{ color: ORANGE }}>Why {brand.name} matters</div>
              <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-4 text-[hsl(220_60%_12%)] leading-[1.1]">
                The {brand.name} fleet operators trust — and the spare parts they need fast
              </h2>
              <p className="text-[hsl(220_60%_12%)]/85 leading-relaxed text-base md:text-[17px] font-medium">{brand.whyMatters}</p>
            </div>
            {brand.industries && brand.industries.length > 0 && (
              <div className="lg:col-span-2">
                <Card className="p-6 bg-[hsl(210_25%_92%)] border-[hsl(220_45%_20%)]/12">
                  <h3 className="font-display font-black text-sm uppercase tracking-wider mb-4 text-[hsl(220_60%_12%)]">Industries Served</h3>
                  <ul className="space-y-2.5">
                    {brand.industries.map((ind) => (
                      <li key={ind} className="text-sm font-bold text-[hsl(220_60%_12%)]/90 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: GREEN }} /> {ind}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </div>
        </section>
      )}

      {/* About + Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 grid lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>About this brand</div>
          <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-5 text-[hsl(220_60%_12%)] leading-[1.1]">Genuine {brand.name} parts inventory — built for fleets and exporters</h2>
          <p className="text-[hsl(220_60%_12%)]/85 leading-relaxed text-base font-medium">{brand.longDescription}</p>
          <div className="mt-6 grid sm:grid-cols-2 gap-3">
            {brand.highlights.map((h) => (
              <div key={h} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" style={{ color: GREEN }} />
                <span className="text-sm font-bold text-[hsl(220_60%_12%)]/88">{h}</span>
              </div>
            ))}
          </div>
        </div>
        <Card className="p-6 bg-[hsl(210_25%_92%)] border-[hsl(220_45%_20%)]/12">
          <h3 className="font-display font-black mb-4 text-sm uppercase tracking-wider text-[hsl(220_60%_12%)]">Part Categories</h3>
          <ul className="space-y-2.5">
            {brand.categories.map((c) => (
              <li key={c} className="text-sm font-bold text-[hsl(220_60%_12%)]/88 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ORANGE }} /> {c}
              </li>
            ))}
          </ul>
          <div className="mt-6 pt-5 border-t border-[hsl(220_60%_12%)]/10">
            <Badge className="text-white font-bold border-0" style={{ backgroundColor: GREEN }}>
              <Package className="h-3 w-3 mr-1" /> In Stock
            </Badge>
            <p className="text-xs text-[hsl(220_60%_12%)]/78 mt-3 font-semibold">
              Send your VIN or chassis number on WhatsApp — we confirm fitment within 48 hours.
            </p>
          </div>
        </Card>
      </section>

      {/* TECHNICAL SPECS PANEL */}
      {brand.specs && brand.specs.length > 0 && (
        <section className="bg-[hsl(210_25%_92%)] py-14 border-y border-[hsl(220_45%_20%)]/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Technical coverage</div>
            <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-8 text-[hsl(220_60%_12%)] leading-[1.1]">{brand.name} technical specifications we support</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {brand.specs.map((s) => (
                <div key={s.label} className="p-5 rounded-lg bg-[hsl(210_35%_98%)] border border-[hsl(220_45%_20%)]/12">
                  <div className="flex items-center gap-2 mb-3">
                    <Cog className="h-4 w-4" style={{ color: ELECTRIC }} />
                    <div className="text-[10px] uppercase tracking-wider font-black text-[hsl(220_60%_12%)]/65">{s.label}</div>
                  </div>
                  <div className="font-display font-black text-base text-[hsl(220_60%_12%)] leading-snug">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* MODELS GRID */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Models We Cover</div>
              <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight text-[hsl(220_60%_12%)] leading-[1.1]">{brand.models.length} {brand.name} models — and counting</h2>
            </div>
            <Badge variant="outline" className="font-bold text-[hsl(220_60%_12%)]">SEO-optimized model index</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {brand.models.map((m) => (
              <Card key={m} className="p-3.5 flex items-center gap-2 hover-elevate border-[hsl(220_45%_20%)]/12 bg-[hsl(210_35%_98%)]" data-testid={`model-${toSlug(m)}`}>
                <Truck className="h-4 w-4 shrink-0" style={{ color: ORANGE }} />
                <span className="text-sm font-bold leading-snug text-[hsl(220_60%_12%)]">{m}</span>
              </Card>
            ))}
          </div>
          <p className="text-sm text-[hsl(220_60%_12%)]/80 mt-6 max-w-3xl font-semibold">
            Genuine and OE-equivalent spare parts available for every model listed. Don't see your variant? Send the chassis VIN on WhatsApp — we'll source it within 48 hours.
          </p>
        </div>
      </section>

      {/* COMMON ISSUES & FIXES */}
      {brand.commonIssues && brand.commonIssues.length > 0 && (
        <section className="bg-[hsl(210_25%_92%)] py-16 border-y border-[hsl(220_45%_20%)]/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Common service issues</div>
            <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-3 text-[hsl(220_60%_12%)] leading-[1.1]">{brand.name} issues we fix every week</h2>
            <p className="text-[hsl(220_60%_12%)]/80 max-w-3xl mb-10 font-medium">
              Real-world {brand.name} problems our customers ask us to solve — and the exact part numbers / assemblies we recommend.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {brand.commonIssues.map((c, i) => (
                <div key={i} className="p-5 rounded-lg bg-[hsl(210_35%_98%)] border border-[hsl(220_45%_20%)]/12 hover-elevate">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `${ORANGE}20`, border: `1px solid ${ORANGE}55` }}>
                      <Wrench className="h-4 w-4" style={{ color: ORANGE }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-display font-black text-[15px] text-[hsl(220_60%_12%)] leading-snug">{c.issue}</h3>
                      <div className="mt-2.5 flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
                        <p className="text-[13px] text-[hsl(220_60%_12%)]/85 leading-relaxed font-medium">{c.fix}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TOP PART NUMBERS */}
      {brand.topPartNumbers && brand.topPartNumbers.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Fast-Moving Part Numbers</div>
          <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-6 text-[hsl(220_60%_12%)] leading-[1.1]">Top-selling {brand.name} part numbers</h2>
          <p className="text-[hsl(220_60%_12%)]/80 max-w-3xl mb-8 font-medium">
            High-rotation part numbers we keep in ready stock for {brand.name} fleets and dealers. Quote the part number on WhatsApp for instant pricing and air-freight ETAs.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {brand.topPartNumbers.map((pn) => (
              <div key={pn} className="p-3 rounded-md border border-[hsl(220_45%_20%)]/15 bg-[hsl(210_35%_98%)] flex items-center gap-2.5 hover-elevate" data-testid={`part-${pn}`}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: GREEN }} />
                <span className="font-mono text-[12px] font-bold text-[hsl(220_60%_12%)] tracking-tight">{pn}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* WHY NARMADA MOBILITY — deep blue immersive band */}
      <section className="py-20 relative overflow-hidden" style={{ background: "linear-gradient(135deg, hsl(220 60% 12%) 0%, hsl(212 85% 22%) 100%)" }}>
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-xs uppercase tracking-[0.25em] font-black mb-3" style={{ color: ORANGE }}>Why Narmada Mobility</div>
          <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-3 text-white max-w-3xl leading-[1.1]">
            India's spare parts source for the world — chosen by {brand.name} operators in 60+ countries
          </h2>
          <p className="text-white/85 max-w-3xl mb-12 font-medium leading-relaxed text-base md:text-[17px]">
            We are not a generic re-seller. We are an export-first supplier specialised in commercial-vehicle and construction-equipment spare parts, with deep stock for {brand.name} and direct relationships with Tier-1 OEM vendors.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: ShieldCheck, color: GREEN, title: "Genuine + OEM-Equivalent", body: "Every part is either OEM-genuine, or sourced from the same Tier-1 supplier that feeds the manufacturer's assembly line." },
              { icon: Clock, color: ORANGE, title: "48-Hour Quote Turnaround", body: "Send VIN or part number on WhatsApp. Quote with fitment confirmation and ETA in 48 hours flat." },
              { icon: Anchor, color: ELECTRIC, title: "Consolidated Export Shipping", body: "Container consolidation from Nhava Sheva, Mundra and Chennai ports. CIF, FOB, EXW — your call." },
              { icon: Factory, color: GREEN, title: "20+ Years Sourcing", body: "Two decades sourcing for fleets across India, Africa, Middle East, CIS, LATAM and South Asia." },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-xl border border-white/15 bg-white/[0.05] backdrop-blur-sm p-5">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: `${card.color}25`, border: `1px solid ${card.color}66` }}>
                    <Icon className="h-5 w-5" style={{ color: card.color }} />
                  </div>
                  <h3 className="font-display font-black text-base text-white mb-2">{card.title}</h3>
                  <p className="text-[13px] text-white/80 leading-relaxed font-medium">{card.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SHIPPING / PAYMENT / DOCS terms */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Trade Terms</div>
        <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-3 text-[hsl(220_60%_12%)] leading-[1.1]">How we ship {brand.name} parts worldwide</h2>
        <p className="text-[hsl(220_60%_12%)]/80 max-w-3xl mb-10 font-medium">
          Buying spare parts from India should not feel risky. Here is exactly how Narmada Mobility delivers {brand.name} parts to your dock.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { icon: Ship, color: ELECTRIC, title: "Shipping & INCOTERMS", items: ["Sea freight from Nhava Sheva (JNPT), Mundra, Chennai", "Consolidated container or LCL groupage", "CIF, FOB, EXW, DAP \u2014 your choice", "Air freight via DEL / BLR for urgent AOG parts"] },
            { icon: Banknote, color: GREEN, title: "Payment & Pricing", items: ["T/T bank transfer (advance + balance against BL)", "Irrevocable L/C at sight via Indian banks", "Pricing in USD / EUR / AED \u2014 fixed for 14 days", "Volume discounts on container-load orders"] },
            { icon: FileText, color: ORANGE, title: "Export Documentation", items: ["Commercial invoice + packing list", "Certificate of Origin (FIEO / CoO under FTA)", "Bill of Lading / Air Waybill copy", "Pre-shipment inspection on request (SGS / BV)"] },
          ].map((blk) => {
            const Icon = blk.icon;
            return (
              <div key={blk.title} className="p-6 rounded-xl bg-[hsl(210_28%_94%)] border border-[hsl(220_45%_20%)]/12">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: `${blk.color}20`, border: `1px solid ${blk.color}55` }}>
                  <Icon className="h-5 w-5" style={{ color: blk.color }} />
                </div>
                <h3 className="font-display font-black text-base text-[hsl(220_60%_12%)] mb-3">{blk.title}</h3>
                <ul className="space-y-2">
                  {blk.items.map((it) => (
                    <li key={it} className="flex items-start gap-2 text-[13px] text-[hsl(220_60%_12%)]/82 font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: GREEN }} />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* PRODUCTS LIST FOR THIS BRAND */}
      {products.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
          <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Catalog</div>
              <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight text-[hsl(220_60%_12%)] leading-[1.1]">{brand.name} parts in stock</h2>
            </div>
            <Button asChild variant="outline" className="font-bold"><Link href={`/products?brand=${brand.slug}`}>See all <ArrowRight className="h-4 w-4 ml-1.5" /></Link></Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {products.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} usdInr={usdInr} />)}
          </div>
        </section>
      )}

      {/* SEO LONG-TAIL BLURBS */}
      {brand.seoBlurbs && brand.seoBlurbs.length > 0 && (
        <section className="bg-[hsl(210_25%_92%)] py-16 border-y border-[hsl(220_45%_20%)]/10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>{brand.name} sourcing guide</div>
            <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-6 text-[hsl(220_60%_12%)] leading-[1.1]">
              Buying {brand.name} spare parts from India — everything you need to know
            </h2>
            <div className="space-y-5 text-[hsl(220_60%_12%)]/88 text-base md:text-[17px] leading-relaxed font-medium">
              {brand.seoBlurbs.map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {brand.keywordTargets.slice(0, 10).map((kw) => (
                <span key={kw} className="text-xs px-2.5 py-1 rounded-md border font-semibold" style={{ borderColor: `${ORANGE}55`, backgroundColor: `${ORANGE}15`, color: "hsl(220 60% 12%)" }}>
                  {kw}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {brand.faq.length > 0 && (
        <section className="py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Frequently Asked Questions</div>
            <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-3 text-[hsl(220_60%_12%)] leading-[1.1]">
              {brand.name} spare parts — common questions
            </h2>
            <p className="text-[hsl(220_60%_12%)]/80 mb-10 font-medium">
              Quick answers buyers ask us most often about {brand.name} parts sourcing, pricing and export terms.
            </p>
            <div className="space-y-4">
              {brand.faq.map((item, i) => (
                <details key={i} className="group bg-[hsl(210_35%_98%)] border border-[hsl(220_45%_20%)]/12 rounded-lg overflow-hidden" data-testid={`faq-${i}`}>
                  <summary className="cursor-pointer list-none p-5 flex items-start justify-between gap-4 hover:bg-[hsl(210_28%_94%)] transition-colors">
                    <h3 className="font-display font-black text-base md:text-lg text-[hsl(220_60%_12%)] leading-snug">{item.q}</h3>
                    <span className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-transform group-open:rotate-45 text-white font-black text-lg leading-none" style={{ backgroundColor: ORANGE }}>+</span>
                  </summary>
                  <div className="px-5 pb-5 pt-1">
                    <p className="text-[hsl(220_60%_12%)]/85 leading-relaxed font-medium text-sm md:text-[15px]">{item.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* SEO: STATE LANDING LINKS */}
      <section className="bg-[hsl(210_25%_92%)] py-16 border-t border-[hsl(220_45%_20%)]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Pan-India Coverage</div>
          <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-6 text-[hsl(220_60%_12%)] leading-[1.1]">{brand.name} spare parts supplier — every Indian state</h2>
          <p className="text-[hsl(220_60%_12%)]/80 max-w-3xl mb-8 font-medium">
            We dispatch {brand.name} parts to fleet operators, dealers, fabricators and service centres across every Indian state and union territory.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {INDIAN_STATES.map((s) => (
              <Link key={s} href={`/${brand.slug}-spare-parts-${toSlug(s)}`}>
                <a className="text-sm py-1.5 px-2.5 rounded-md hover-elevate inline-flex items-center gap-1.5 text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] font-semibold" data-testid={`state-link-${toSlug(s)}`}>
                  <MapPin className="h-3 w-3" style={{ color: ORANGE }} />{s}
                </a>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* SEO: COUNTRY LANDING LINKS */}
      <section className="bg-[hsl(210_30%_96%)] text-[hsl(220_60%_12%)] py-16 border-t border-[hsl(220_45%_20%)]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Global Coverage</div>
          <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight mb-6 leading-[1.1]">{brand.name} parts exporter — worldwide</h2>
          <p className="text-[hsl(220_60%_12%)]/80 max-w-3xl mb-8 font-medium">
            Exporting {brand.name} commercial vehicle and equipment spares to 60+ countries.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {TARGET_COUNTRIES.map((c) => (
              <Link key={c} href={`/${brand.slug}-spare-parts-${toSlug(c)}`}>
                <a className="text-sm py-1.5 px-2.5 rounded-md hover-elevate inline-flex items-center gap-1.5 text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] font-semibold" data-testid={`country-link-${toSlug(c)}`}>
                  <Globe className="h-3 w-3" style={{ color: GREEN }} />{c}
                </a>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="rounded-2xl p-10 md:p-14 border border-[hsl(220_45%_20%)]/12 bg-gradient-to-br from-[hsl(210_28%_94%)] to-[hsl(210_35%_98%)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] font-black mb-2" style={{ color: ORANGE }}>Ready to order</div>
            <h2 className="font-display font-black text-2xl md:text-3xl tracking-tight text-[hsl(220_60%_12%)] max-w-xl leading-tight">
              Get a quote for {brand.name} spare parts today
            </h2>
            <p className="mt-3 text-[hsl(220_60%_12%)]/80 max-w-2xl font-medium">
              Share VIN, part number or a photo of the old part on WhatsApp. We respond within 1 business hour.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button asChild size="lg" className="bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-white font-bold">
              <Link href="/contact">Request Quote <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
            <Button asChild size="lg" className="text-white font-bold border-0" style={{ backgroundColor: GREEN }}>
              <a href="https://wa.me/917909083806" target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-2" /> WhatsApp Us</a>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
