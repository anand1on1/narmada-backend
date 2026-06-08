import { SeoHead } from "@/components/SeoHead";
import { Link } from "wouter";
import { Award, Globe2, Users, Truck, ShieldCheck, Factory } from "lucide-react";
import brandsLineup from "@/assets/brands-lineup.png";

export default function AboutPage() {
  return (
    <>
      <SeoHead
        title="About Narmada Mobility — 20+ Years of Commercial Vehicle Spare Parts Excellence"
        description="Narmada Mobility, a UrbanFleet Technologies venture, has supplied genuine Tata, BharatBenz, Ashok Leyland, Eicher and Volvo spare parts across India and 60+ countries for over two decades."
        keywords="about narmada mobility, narmada motors, commercial vehicle spare parts exporter india, urbanfleet technologies"
      />

      {/* Hero */}
      <section className="relative surface-obsidian text-foreground py-20 lg:py-28 overflow-hidden border-b border-border">
        <div className="absolute inset-0 pattern-grid opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-[hsl(212_95%_52%/0.08)]" />
        <div className="container mx-auto px-4 relative">
          <div className="max-w-3xl">
            <span className="eyebrow inline-flex items-center gap-2 mb-6">
              <span className="signal-dot" /> About Narmada Mobility
            </span>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight mb-6">
              Two decades of <span className="text-gradient-cyan">trust</span>, built one part at a time.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Narmada Mobility is the global spare parts arm of the Narmada Group — supplying genuine and OEM-equivalent components for India's largest commercial vehicle brands to fleets, dealers and workshops in 60+ countries.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Our Story</div>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">From Patna to the World</h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed">
                <p>
                  What began as <strong className="text-foreground">Narmada Motors</strong> — a Tata Motors authorized service and parts outlet in Patna, Bihar — has grown over 20+ years into a global commercial-vehicle spare parts supply chain. We today serve customers in every Indian state and across Africa, the Middle East, CIS, South-East Asia and Latin America.
                </p>
                <p>
                  <strong className="text-foreground">Narmada Mobility</strong> is the international export and e-commerce arm under UrbanFleet Technologies Pvt. Ltd. Through this platform we make it possible for any workshop, fleet manager or independent dealer — anywhere — to source authentic Tata, BharatBenz, Ashok Leyland, Eicher and Volvo parts with confidence.
                </p>
                <p>
                  Our roots in dealership operations mean we understand vehicles the way the people who run them do — from a Tata LPK 2518 tipper in a Bihar quarry, to a Volvo EC210 excavator on an East-African mine site.
                </p>
              </div>
            </div>
            <div className="relative">
              <img
                src={brandsLineup}
                alt="Narmada Mobility fleet"
                className="rounded-2xl shadow-2xl"
              />
              <div className="absolute -bottom-6 -right-6 bg-card border border-accent/40 p-6 rounded-xl shadow-xl glow-cyan-sm">
                <div className="font-display text-3xl font-bold text-accent">20+</div>
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(220_60%_12%)]/75 font-medium">Years</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="py-16 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30 border-y">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { num: "60+", label: "Countries Served" },
              { num: "36", label: "Indian States Covered" },
              { num: "10,000+", label: "Active Parts SKUs" },
              { num: "5,000+", label: "Dealer & Workshop Customers" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-display text-4xl md:text-5xl font-bold text-accent mb-2">{s.num}</div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Why Customers Trust Us</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold">Built on Reliability, Run on Relationships</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: ShieldCheck, title: "Genuine Sourcing", body: "Direct relationships with OEMs and tier-1 suppliers — every part traceable to its source." },
              { icon: Globe2, title: "Global Logistics", body: "Air, sea and DDP shipping with full export documentation, HS codes and certificates of origin." },
              { icon: Award, title: "Two Decades of Expertise", body: "We've supplied parts since BS-II — through BS-III, BS-IV and the BS-VI dozer/urea era." },
              { icon: Users, title: "Dealer-First Pricing", body: "Volume-tiered pricing built for workshops, fleets and re-sellers — not retail markup." },
              { icon: Factory, title: "OEM-Equivalent Range", body: "Where genuine isn't economic, we stock vetted OEM-equivalent parts from approved manufacturers." },
              { icon: Truck, title: "Fitment Support", body: "Every part cross-referenced to model and chassis number — no guesswork, no wrong shipments." },
            ].map((v) => (
              <div key={v.title} className="p-6 bg-card border rounded-xl hover:shadow-lg hover:border-accent/40 transition">
                <v.icon className="w-10 h-10 text-accent mb-4" strokeWidth={1.5} />
                <h3 className="font-display text-xl font-bold mb-2">{v.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative surface-graphite py-20 border-t border-border overflow-hidden">
        <div className="absolute inset-0 pattern-dots opacity-40" />
        <div className="container mx-auto px-4 max-w-3xl text-center relative">
          <div className="eyebrow mb-4">Talk to us</div>
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-4">Source your next shipment from Narmada</h2>
          <p className="text-lg text-muted-foreground mb-8">
            Whether you need one urgent part or a 40-foot container — we are ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact" className="inline-flex items-center justify-center px-8 py-4 bg-accent text-accent-foreground rounded-lg font-semibold hover:bg-accent/90 transition glow-cyan-sm" data-testid="link-contact-cta">
              Request a Quote
            </Link>
            <Link href="/products" className="inline-flex items-center justify-center px-8 py-4 border border-border rounded-lg font-semibold text-foreground hover:border-accent/50 hover:bg-card transition" data-testid="link-products-cta">
              Browse Catalogue
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
