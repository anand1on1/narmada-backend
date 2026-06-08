import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Mail, Phone, MapPin, MessageCircle, Send, CheckCircle2, Building2, Clock } from "lucide-react";
import { SeoHead } from "@/components/SeoHead";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function ContactPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", phone: "", country: "", subject: "", message: "", productInterest: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/contact", form);
      setSubmitted(true);
      toast({ title: "Thanks!", description: "Your enquiry was sent to sales@Narmadamobility.com. We'll respond within one business hour." });
    } catch (err: any) {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <>
      <SeoHead
        title="Contact Narmada Mobility — Truck & Equipment Spare Parts Enquiry"
        description="Get a quote on Tata, BharatBenz, Ashok Leyland, Eicher or Volvo spare parts. WhatsApp, call or email — we respond within an hour during business hours."
        keywords="contact narmada mobility, spare parts enquiry, truck parts quote, narmadamobility patna"
      />
      <section className="bg-[hsl(210_30%_96%)] text-[hsl(220_60%_12%)] py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <h1 className="font-display font-black text-3xl md:text-5xl tracking-tight">Get in touch</h1>
          <p className="text-[hsl(220_60%_12%)]/82 mt-3 max-w-2xl">Send your part requirement and we'll come back with pricing, freight and lead time. Bulk and container orders welcome.</p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid lg:grid-cols-3 gap-8">
        {/* Contact details */}
        <div className="space-y-4 lg:col-span-1">
          {[
            { icon: MapPin, title: "Address", body: "J-157, J Sector, Kankarbagh, Patna-800020, Bihar, India" },
            { icon: Phone, title: "Call", body: "+91 79090 83806", href: "tel:+917909083806" },
            { icon: MessageCircle, title: "WhatsApp", body: "+91 79090 83806", href: "https://wa.me/917909083806" },
            { icon: Mail, title: "Email", body: "sales@Narmadamobility.com", href: "mailto:sales@Narmadamobility.com" },
            { icon: Clock, title: "Working hours", body: "Mon–Sat · 9:30 AM – 7:30 PM IST" },
            { icon: Building2, title: "Legal entity", body: "A unit of Narmada Motors — Highway Industry since 2002" },
          ].map((c) => (
            <Card key={c.title} className="p-4 border-card-border flex gap-3 items-start" data-testid={`contact-info-${c.title.toLowerCase()}`}>
              <div className="h-9 w-9 rounded-md bg-[hsl(212_95%_55%)]/10 flex items-center justify-center shrink-0"><c.icon className="h-4 w-4 text-[hsl(212_95%_50%)]" /></div>
              <div>
                <div className="text-xs uppercase tracking-wider text-[hsl(220_60%_12%)]/75 font-medium">{c.title}</div>
                {c.href ? (
                  <a href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="font-medium hover:text-[hsl(212_95%_50%)]">{c.body}</a>
                ) : (
                  <div className="font-medium">{c.body}</div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Form */}
        <Card className="lg:col-span-2 p-6 md:p-8 border-card-border">
          {submitted ? (
            <div className="text-center py-12">
              <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-4" />
              <h2 className="font-display font-black text-2xl mb-2">Enquiry sent!</h2>
              <p className="text-muted-foreground max-w-md mx-auto">Your message was delivered to <span className="font-mono">sales@Narmadamobility.com</span>. Our team will respond within one business hour.</p>
              <Button className="mt-6" onClick={() => { setSubmitted(false); setForm({ name: "", email: "", phone: "", country: "", subject: "", message: "", productInterest: "" }); }}>Send another</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" data-testid="form-contact">
              <h2 className="font-display font-black text-xl">Send us an enquiry</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name *</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone / WhatsApp</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-phone" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="e.g. UAE, Russia, Nigeria" data-testid="input-country" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Quote enquiry — Tata Prima 2523" data-testid="input-subject" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="productInterest">Part / model interest</Label>
                <Input id="productInterest" value={form.productInterest} onChange={(e) => setForm({ ...form, productInterest: e.target.value })} placeholder="OEM number, chassis VIN or part name" data-testid="input-product-interest" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Message *</Label>
                <Textarea id="message" required rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="input-message" />
              </div>
              <Button type="submit" disabled={submitting} className="bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-[hsl(220_60%_12%)] font-semibold" data-testid="button-submit-contact">
                {submitting ? "Sending…" : (<><Send className="h-4 w-4 mr-2" /> Send enquiry</>)}
              </Button>
              <p className="text-xs text-[hsl(220_60%_12%)]/75 font-medium">By submitting you agree to be contacted by Narmada Mobility regarding your enquiry. We never share your details with third parties.</p>
            </form>
          )}
        </Card>
      </section>

      {/* Embedded map */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <Card className="overflow-hidden border-card-border">
          <iframe
            title="Narmada Mobility on the map"
            src="https://www.google.com/maps?q=Kankarbagh,+Patna,+Bihar+800020&output=embed"
            className="w-full h-[360px] border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </Card>
      </section>
    </>
  );
}
