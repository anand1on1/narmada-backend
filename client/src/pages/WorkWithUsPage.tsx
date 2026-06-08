import { useState } from "react";
import { SeoHead } from "@/components/SeoHead";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Handshake, TrendingUp, Truck, Globe, CheckCircle2 } from "lucide-react";
import worldShipping from "@/assets/world-shipping.png";

const PARTNERSHIP_TYPES = [
  { icon: Handshake, title: "Distributor Partnership", body: "Become an exclusive country / state distributor for Tata, BharatBenz, Ashok Leyland, Eicher or Volvo aftermarket parts in your region." },
  { icon: Truck, title: "Workshop & Dealer", body: "Volume pricing for spare-parts workshops, fleet garages, multi-brand service centres and authorised dealers." },
  { icon: Globe, title: "Export & Re-export", body: "DDP and EXW shipments for traders supplying Africa, GCC, CIS, ASEAN and Latin America." },
  { icon: TrendingUp, title: "OEM Sourcing", body: "Long-term supply contracts for fleet operators, OEMs and original equipment manufacturers." },
];

export default function WorkWithUsPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", country: "", subject: "Partnership Enquiry",
    productInterest: "Distributor / Reseller", message: "",
  });
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/contact", data);
      return res.json();
    },
    onSuccess: () => { setDone(true); toast({ title: "Thank you", description: "Our team will be in touch within 24 hours." }); },
    onError: () => { toast({ title: "Submission failed", description: "Please try again or email sales@Narmadamobility.com directly.", variant: "destructive" }); },
  });

  return (
    <>
      <SeoHead
        title="Work With Us — Distributor, Dealer & Workshop Partnerships | Narmada Mobility"
        description="Become a Narmada Mobility partner — distributor, workshop, exporter or fleet supplier for Tata, BharatBenz, Volvo, Eicher and Ashok Leyland spare parts. Apply online."
        keywords="commercial vehicle parts distributor india, become spare parts dealer, narmada mobility partnership, volvo parts distributor, tata parts wholesaler"
      />

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-primary via-primary to-slate-900 text-primary-foreground py-20 lg:py-28 overflow-hidden">
        <div className="absolute inset-0 pattern-diagonal opacity-10" />
        <div className="container mx-auto px-4 relative max-w-4xl">
          <span className="inline-block px-4 py-1.5 bg-accent/20 text-accent border border-accent/30 rounded-full text-sm font-semibold uppercase tracking-wider mb-6">
            Partner With Narmada
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            Grow Your Business with India's <span className="text-gradient-amber">Most Trusted</span> Spare Parts Supplier.
          </h1>
          <p className="text-lg md:text-xl text-primary-foreground/80 leading-relaxed">
            Distributors, workshops, exporters and fleet operators — work with the team that has shipped commercial vehicle parts to 60+ countries for over two decades.
          </p>
        </div>
      </section>

      {/* Types */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Partnership Models</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold">Choose the Partnership That Fits You</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {PARTNERSHIP_TYPES.map((p) => (
              <div key={p.title} className="p-7 bg-card border rounded-xl hover:shadow-lg hover:border-accent/40 transition">
                <p.icon className="w-10 h-10 text-accent mb-4" strokeWidth={1.5} />
                <h3 className="font-display text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-slate-50 dark:bg-[hsl(220_45%_20%)]/30">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Why Partner With Us</div>
              <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">What You Get</h2>
              <ul className="space-y-4">
                {[
                  "Tier-1 pricing on 10,000+ part SKUs across 5 OEMs",
                  "Dedicated account manager and dispatch desk",
                  "Full export documentation — invoice, packing list, certificate of origin, HS codes",
                  "Drop-ship and white-label fulfillment available",
                  "Marketing co-op support — listings on this platform",
                  "Credit terms for vetted long-term partners",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-accent flex-shrink-0 mt-0.5" />
                    <span className="text-[hsl(220_60%_12%)]/75 font-medium">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <img src={worldShipping} alt="Global shipping" className="rounded-2xl shadow-xl" />
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-3">Apply Now</h2>
            <p className="text-[hsl(220_60%_12%)]/75 font-medium">Tell us about your business — we respond within 24 hours.</p>
          </div>

          {done ? (
            <div className="p-10 bg-accent/10 border border-accent/30 rounded-xl text-center">
              <CheckCircle2 className="w-16 h-16 text-accent mx-auto mb-4" />
              <h3 className="font-display text-2xl font-bold mb-2">Application Received</h3>
              <p className="text-[hsl(220_60%_12%)]/75 font-medium">Our partnership team will email you within one business day.</p>
            </div>
          ) : (
            <form
              className="grid md:grid-cols-2 gap-4 p-8 bg-card border rounded-xl shadow-sm"
              onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }}
            >
              <Field label="Full Name *" name="name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Email *" name="email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
              <Field label="Phone / WhatsApp" name="phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Country *" name="country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} required />
              <div className="md:col-span-2">
                <label className="text-sm font-semibold mb-1.5 block">Partnership Type *</label>
                <select
                  className="w-full px-4 py-2.5 border rounded-lg bg-background"
                  value={form.productInterest}
                  onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
                  data-testid="select-partnership"
                  required
                >
                  <option>Distributor / Reseller</option>
                  <option>Workshop / Service Centre</option>
                  <option>Exporter / Re-exporter</option>
                  <option>OEM / Fleet Operator</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold mb-1.5 block">Tell us about your business *</label>
                <textarea
                  className="w-full px-4 py-2.5 border rounded-lg bg-background min-h-[120px]"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  required
                  data-testid="input-message"
                  placeholder="Region you cover, brands you handle, monthly volume, current suppliers..."
                />
              </div>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="md:col-span-2 px-8 py-3.5 bg-accent text-accent-foreground rounded-lg font-bold hover:bg-accent/90 transition disabled:opacity-60"
                data-testid="button-submit-partnership"
              >
                {mutation.isPending ? "Submitting..." : "Submit Partnership Application"}
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}

function Field({ label, name, value, onChange, type = "text", required = false }: { label: string; name: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-sm font-semibold mb-1.5 block">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-4 py-2.5 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-accent/50"
        data-testid={`input-${name}`}
      />
    </div>
  );
}
