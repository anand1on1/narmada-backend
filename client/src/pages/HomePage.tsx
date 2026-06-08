import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowUpRight, Globe, Award, ShieldCheck, Clock, MessageCircle, Quote, Star } from "lucide-react";
import { BRANDS, TARGET_COUNTRIES } from "@/data/brands";
import { SeoHead } from "@/components/SeoHead";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Product } from "@shared/schema";
import { ProductCard } from "@/components/ProductCard";
import { BrandWall } from "@/components/BrandWall";
import { CategoryGrid } from "@/components/CategoryGrid";
import heroEngine from "@/assets/v2/hero-engine.png";
import excavatorDetail from "@/assets/v2/excavator-detail.png";
import globalMap from "@/assets/v2/global-map.png";
import truckCinematic from "@/assets/v2/truck-cinematic.png";

export default function HomePage() {
  const { data: featured = [] } = useQuery<Product[]>({ queryKey: ["/api/products", "featured=1"], queryFn: async () => {
    try { const r = await apiRequest("GET", "/api/products?featured=1"); return await r.json(); } catch { return []; }
  } });
  const { data: latest = [] } = useQuery<Product[]>({ queryKey: ["/api/products"], queryFn: async () => {
    try { const r = await apiRequest("GET", "/api/products"); return await r.json(); } catch { return []; }
  } });
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;
  const showcase = (featured.length > 0 ? featured : latest).slice(0, 4);

  return (
    <>
      <SeoHead
        title="Narmada Mobility — Global Spare Parts for Tata, BharatBenz, Ashok Leyland, Eicher & Volvo"
        description="India's trusted commercial vehicle spare parts exporter. Genuine and OEM-equivalent parts for Tata Prima, BharatBenz 2523, Ashok Leyland Captain, Eicher Pro and Volvo trucks & excavators. Shipping to 60+ countries."
        keywords="tata spare parts, bharatbenz spare parts, ashok leyland leyparts, eicher pro spare parts, volvo spare parts, truck parts exporter india, commercial vehicle parts wholesale, volvo ec210 parts, tata prima parts"
        jsonLd={{
          "@context": "https://schema.org", "@type": "Organization",
          name: "Narmada Mobility", url: "https://narmadamobility.com",
          logo: "https://narmadamobility.com/favicon.png",
          description: "Global exporter of genuine and OEM commercial vehicle spare parts.",
          address: { "@type": "PostalAddress", streetAddress: "J-157, J Sector, Kankarbagh", addressLocality: "Patna", addressRegion: "Bihar", postalCode: "800020", addressCountry: "IN" },
          telephone: "+91-7909083806", email: "sales@Narmadamobility.com",
          areaServed: TARGET_COUNTRIES,
        }}
      />

      {/* ============== HERO ============== */}
      <section className="relative overflow-hidden surface-obsidian">
        <div className="absolute inset-0">
          <img src={heroEngine} alt="" role="presentation" className="w-full h-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(210_30%_96%)] via-[hsl(210_30%_96%)]/85 to-[hsl(210_30%_96%)]/40" />
          <div className="absolute inset-0 pattern-scanlines opacity-60" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-24 lg:pt-24 lg:pb-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2.5 glass-panel rounded-full px-3.5 py-1.5 mb-7">
              <span className="signal-dot" />
              <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-[hsl(220_60%_12%)]/80">Serving the highway industry · Since 2002</span>
            </div>

            <h1 className="font-display font-black tracking-tight text-[hsl(220_60%_12%)] text-[44px] md:text-[64px] lg:text-[76px] leading-[0.98]">
              India's spare parts<br />
              source for the <span className="text-gradient-cyan">world</span>.
            </h1>

            <p className="mt-7 text-[17px] md:text-[18px] text-[hsl(220_60%_12%)]/80 max-w-2xl leading-relaxed">
              Genuine OEM and matched-quality components for Tata, BharatBenz, Ashok Leyland, Eicher and Volvo commercial vehicles — dispatched from Patna to fleets in 60+ countries.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-[hsl(220_60%_12%)] font-semibold glow-cyan h-12 px-6" data-testid="hero-cta-products">
                <Link href="/products">Browse Catalog <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-[hsl(220_45%_20%)]/20 text-[hsl(220_60%_12%)] bg-[hsl(220_45%_20%)]/5 hover:bg-[hsl(220_45%_20%)]/10 hover:text-[hsl(220_60%_12%)] h-12 px-6" data-testid="hero-cta-quote">
                <Link href="/contact">Request Bulk Quote</Link>
              </Button>
            </div>

            {/* Trust strip */}
            <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 max-w-2xl">
              {[
                { k: "20+", v: "Years of trade" },
                { k: "60+", v: "Countries served" },
                { k: "50K+", v: "SKUs stocked" },
                { k: "20+", v: "OEM brands" },
              ].map((s) => (
                <div key={s.v} className="border-l-2 border-[hsl(22_90%_55%)]/35 pl-4" data-testid={`stat-${s.v.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div className="font-display text-3xl md:text-4xl font-black text-[hsl(22_90%_55%)]">{s.k}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(220_60%_12%)]/80 mt-1.5 font-bold">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Brand strip pinned to bottom of hero — names only, brand wall renders below */}
        <div className="relative border-t border-[hsl(220_45%_20%)]/8 bg-[hsl(210_30%_96%)]/60 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center gap-x-8 gap-y-3">
            <span className="eyebrow text-[hsl(220_60%_12%)]/82">Authorized source for</span>
            {["Tata", "BharatBenz", "Ashok Leyland", "Eicher", "Volvo", "Scania", "JCB", "Caterpillar", "Komatsu"].map((name) => (
              <span key={name} className="font-bold text-[14px] text-[hsl(220_60%_12%)]/85 inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(150_65%_40%)]" />
                {name}
              </span>
            ))}
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[hsl(220_60%_12%)]/40">+ 11 more</span>
          </div>
        </div>
      </section>

      {/* ============== BRAND WALL ============== */}
      <section className="py-24 relative overflow-hidden" style={{ backgroundColor: "hsl(210 25% 92%)" }}>
        <div className="absolute inset-0 pattern-grid opacity-40 pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between gap-4 mb-10 flex-wrap">
            <div className="max-w-2xl">
              <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Brands We Deal In · 01</div>
              <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05]">
                Every truck, every excavator,<br/>
                <span className="text-gradient-cyan">every brand.</span>
              </h2>
              <p className="text-[hsl(220_60%_12%)]/75 mt-5 text-[15px] leading-relaxed">
                If it carries cargo or moves earth, we likely stock spares for it. Twenty leading OEMs on the wall — and another thirty available on request from our Patna warehouse.
              </p>
            </div>
            <Button asChild variant="outline" className="border-[hsl(220_45%_20%)]/15 bg-[hsl(220_45%_20%)]/5 text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/10" data-testid="btn-view-all-products">
              <Link href="/products">View all products <ArrowUpRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
          </div>

          <BrandWall />

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-r from-[hsl(212_95%_55%)]/10 to-transparent border border-[hsl(212_95%_55%)]/20 px-6 py-5">
            <div>
              <div className="font-semibold text-[hsl(220_60%_12%)] text-[15px]">Don't see your brand on the wall?</div>
              <div className="text-[hsl(220_60%_12%)]/75 text-[13px] mt-1">We also source parts for Cummins, AMW, Schwing Stetter, Tatra, Hino, Sany, XCMG, Doosan and many more.</div>
            </div>
            <Button asChild className="bg-[hsl(212_95%_55%)] text-[hsl(220_60%_12%)] hover:bg-[hsl(212_95%_50%)] font-semibold">
              <Link href="/contact">Ask about your brand <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ============== CATEGORIES ============== */}
      <section className="surface-graphite border-y border-[hsl(220_45%_20%)]/8 py-24 relative overflow-hidden">
        <div className="absolute inset-0 pattern-grid opacity-50" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-[1fr_2fr] gap-12 items-start">
            <div className="lg:sticky lg:top-24">
              <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Shop By Category · 02</div>
              <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05]">From a single bearing<br/>to a complete <span className="text-gradient-cyan">engine overhaul</span>.</h2>
              <p className="text-[hsl(220_60%_12%)]/75 mt-5 text-[15px] leading-relaxed max-w-md">
                15 component families. 50,000+ active SKUs. Cross-referenced to OEM part numbers — most ship the same day from our Patna distribution hub.
              </p>
              <div className="mt-7 inline-flex items-center gap-2 rounded-md border border-[hsl(220_45%_20%)]/15 bg-[hsl(220_45%_20%)]/5 px-3 py-2 text-[12px] font-mono uppercase tracking-wider text-[hsl(220_60%_12%)]/82">
                <span className="signal-dot" />
                Real-time stock check on WhatsApp
              </div>
            </div>

            <CategoryGrid />
          </div>
        </div>
      </section>

      {/* ============== FEATURED PRODUCTS ============== */}
      {showcase.length > 0 && (
        <section className="surface-obsidian py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-end justify-between gap-4 mb-12 flex-wrap">
              <div className="max-w-2xl">
                <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Trending Parts · 03</div>
                <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05]">In demand this week.</h2>
              </div>
              <Button asChild variant="outline" className="border-[hsl(220_45%_20%)]/15 bg-[hsl(220_45%_20%)]/5 text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/10">
                <Link href="/products">All products <ArrowUpRight className="h-4 w-4 ml-1.5" /></Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {showcase.map((p) => <ProductCard key={p.id} product={p} usdInr={usdInr} />)}
            </div>
          </div>
        </section>
      )}

      {/* ============== WHY US ============== */}
      <section className="surface-graphite border-y border-[hsl(220_45%_20%)]/8 py-24 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/2 hidden lg:block opacity-25">
          <img src={excavatorDetail} alt="" role="presentation" className="w-full h-full object-cover object-left" />
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(210_35%_98%)] to-transparent" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mb-14">
            <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Why Narmada · 04</div>
            <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05]">Two decades of<br/>commercial vehicle expertise.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl">
            {[
              { icon: Award, title: "OEM-authorized", desc: "Direct authorized supplier of Tata Genuine Parts and Leyparts. Cross-referenced OEM numbers on every SKU.", num: "01" },
              { icon: Globe, title: "Global logistics", desc: "Established export channels to UAE, Russia, Mozambique, USA, Mexico, Australia, Kenya, Nigeria, Sri Lanka and 50+ countries.", num: "02" },
              { icon: ShieldCheck, title: "Tested quality", desc: "Every part bench-tested where applicable. Genuine, OE, and matched-quality grades clearly labeled.", num: "03" },
              { icon: Clock, title: "Same-day dispatch", desc: "In-stock items ship within 24 hours from our Patna hub. Bulk and container orders quoted in 4 hours.", num: "04" },
            ].map((f) => (
              <div key={f.title} className="rounded-xl glass-panel p-6 hover:bg-white/[0.06] transition-colors">
                <div className="flex items-center justify-between mb-5">
                  <f.icon className="h-6 w-6 text-[hsl(212_95%_55%)]" strokeWidth={1.6} />
                  <span className="font-mono text-[10px] text-[hsl(220_60%_12%)]/30 tracking-wider">{f.num}</span>
                </div>
                <h3 className="font-display font-black text-[17px] text-[hsl(220_60%_12%)] mb-2.5">{f.title}</h3>
                <p className="text-[13px] text-[hsl(220_60%_12%)]/75 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============== GLOBAL REACH ============== */}
      <section className="surface-obsidian py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Global Reach · 05</div>
              <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05] mb-6">From Patna to<br/>60+ countries.</h2>
              <p className="text-[hsl(220_60%_12%)]/75 text-[15px] leading-relaxed mb-8 max-w-lg">
                Our distribution network spans every Indian state and every major commercial vehicle market on earth. Tata Prima haulers in Mozambique. Ashok Leyland Captains in Dubai. BharatBenz mixers in Saudi Arabia. Eicher Pro buses in Sri Lanka. Volvo EC210 excavators in Russia — we deliver.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 max-w-md mb-8">
                {["UAE","Saudi Arabia","Russia","Mexico","Nigeria","Kenya","Sri Lanka","Australia","USA","Mozambique","Uganda","Tanzania"].map((c) => (
                  <div key={c} className="text-[13px] text-[hsl(220_60%_12%)]/80 inline-flex items-center gap-2 font-mono">
                    <span className="h-1 w-1 rounded-full bg-[hsl(212_95%_55%)]" />{c}
                  </div>
                ))}
              </div>
              <Button asChild className="bg-[hsl(212_95%_55%)] text-[hsl(220_60%_12%)] hover:bg-[hsl(212_95%_50%)] font-semibold">
                <Link href="/contact">Discuss your shipment <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
              </Button>
            </div>
            <div className="rounded-xl overflow-hidden border border-[hsl(220_45%_20%)]/10 relative">
              <img src={globalMap} alt="Global shipping network" className="w-full h-auto" />
              <div className="absolute inset-0 ring-1 ring-inset ring-slate-300/8 rounded-xl pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* ============== MODEL MARQUEE ============== */}
      <section className="surface-graphite border-y border-[hsl(220_45%_20%)]/8 py-7 overflow-hidden">
        <div className="flex gap-12 animate-marquee whitespace-nowrap">
          {[...Object.values(BRANDS).flatMap((b) => b.models).slice(0, 40), ...Object.values(BRANDS).flatMap((b) => b.models).slice(0, 40)].map((m, i) => (
            <span key={i} className="font-mono text-[13px] text-[hsl(220_60%_12%)]/40 inline-flex items-center gap-3">
              <span className="h-1 w-1 rounded-full bg-[hsl(212_95%_55%)]" />
              {m}
            </span>
          ))}
        </div>
      </section>

      {/* ============== TESTIMONIAL ============== */}
      <section className="surface-obsidian py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="rounded-2xl glass-panel p-10 md:p-16 relative overflow-hidden">
            <div className="absolute -top-8 -left-2 text-[160px] font-display font-bold text-[hsl(212_95%_55%)]/8 leading-none select-none">"</div>
            <Quote className="relative h-8 w-8 text-[hsl(212_95%_55%)] mb-7" strokeWidth={1.5} />
            <blockquote className="relative font-display font-medium text-2xl md:text-3xl leading-[1.3] text-[hsl(220_60%_12%)] max-w-4xl tracking-tight">
              Narmada has been supplying spare parts to our company for more than five years. They are consistently reliable and trustworthy in terms of quality. I am definitely referring them to my colleagues.
            </blockquote>
            <div className="relative mt-8 flex items-center gap-4">
              <div className="h-11 w-11 rounded-full bg-[hsl(212_95%_55%)]/15 border border-[hsl(212_95%_55%)]/40 flex items-center justify-center font-display font-semibold text-sm text-[hsl(212_95%_55%)]">DV</div>
              <div>
                <div className="font-display font-semibold text-[hsl(220_60%_12%)] text-[15px]">Deepak Verman</div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-[hsl(220_60%_12%)]/82">Megha Engineering · India</div>
              </div>
              <div className="ml-auto flex gap-0.5 text-[hsl(212_95%_55%)]">
                {[1,2,3,4,5].map((i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA ============== */}
      <section className="surface-obsidian pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="rounded-2xl overflow-hidden relative">
            <img src={truckCinematic} alt="" role="presentation" className="absolute inset-0 w-full h-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(210_30%_96%)] via-[hsl(210_30%_96%)]/85 to-[hsl(210_30%_96%)]/40" />
            <div className="relative p-10 md:p-16 grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-8 items-end">
              <div>
                <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Get in touch</div>
                <h2 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl tracking-tight leading-[1.05] mb-4">
                  Need a part shipped tomorrow?
                </h2>
                <p className="text-[hsl(220_60%_12%)]/80 text-[15px] leading-relaxed max-w-xl">
                  Send the part number, OEM reference or chassis VIN on WhatsApp. We confirm availability, price and lead time within an hour during business hours.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button asChild size="lg" className="bg-[#25D366] hover:bg-[#1da851] text-white font-semibold h-12" data-testid="cta-whatsapp">
                  <a href="https://wa.me/917909083806" target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4 mr-2" /> WhatsApp us now</a>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-[hsl(220_45%_20%)]/25 text-[hsl(220_60%_12%)] bg-[hsl(220_45%_20%)]/5 hover:bg-[hsl(220_45%_20%)]/10 hover:text-[hsl(220_60%_12%)] h-12" data-testid="cta-quote">
                  <Link href="/contact">Get a detailed quote</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
