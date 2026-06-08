import { SeoHead } from "@/components/SeoHead";

export default function PrivacyPage() {
  return (
    <>
      <SeoHead
        title="Privacy Policy | Narmada Mobility"
        description="How Narmada Mobility collects, uses, stores and protects your personal information."
      />
      <section className="py-16 lg:py-20 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Legal</div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-muted-foreground mb-10">Last updated: June 2026</p>

          <article className="prose dark:prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">1. Who We Are</h2>
              <p>Narmada Mobility is a product of UrbanFleet Technologies Pvt. Ltd., operating from J-157, J Sector, Kankarbagh, Patna-800020, Bihar, India. This privacy policy explains how we handle information we collect from visitors and customers of the narmadamobility.com website.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">2. Information We Collect</h2>
              <p>We collect the following types of information when you interact with our website:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className="text-foreground">Contact data</strong> — name, email, phone number, country, and message when you submit a contact, quote or partnership form.</li>
                <li><strong className="text-foreground">Order data</strong> — product enquiries forwarded via WhatsApp or email.</li>
                <li><strong className="text-foreground">Technical data</strong> — browser type, device, IP address, and pages visited (via standard analytics).</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">3. How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>To respond to your quotes, enquiries and partnership applications.</li>
                <li>To process and fulfil orders, including export documentation.</li>
                <li>To communicate updates about your enquiry or shipment.</li>
                <li>To improve our products, catalogue and website experience.</li>
                <li>To comply with applicable Indian and international trade laws.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">4. Sharing of Information</h2>
              <p>We do <strong className="text-foreground">not</strong> sell your data. We may share necessary information with:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Logistics partners (DHL, FedEx, freight forwarders) for shipment fulfilment.</li>
                <li>Banks and payment processors for invoice settlement.</li>
                <li>Government authorities where legally required (customs, GST, RBI).</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">5. Cookies</h2>
              <p>We use minimal first-party cookies to maintain session state. We do not use cross-site tracking cookies. You may disable cookies in your browser, though some features may not work as expected.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">6. Data Retention & Security</h2>
              <p>We retain contact and order data for as long as needed to provide our services and to comply with statutory obligations (typically 7 years for export records). We use industry-standard administrative, technical and physical safeguards to protect your data.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">7. Your Rights</h2>
              <p>You may request access to, correction of, or deletion of your personal data by writing to <a className="text-accent font-semibold" href="mailto:sales@Narmadamobility.com">sales@Narmadamobility.com</a>. We will respond within 30 days.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">8. International Transfers</h2>
              <p>Because we serve customers in 60+ countries, your data may be processed outside India for order fulfilment. We apply contractual safeguards in all such transfers.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">9. Contact</h2>
              <p>Questions about this policy? Write to <a className="text-accent font-semibold" href="mailto:sales@Narmadamobility.com">sales@Narmadamobility.com</a> or call <a className="text-accent font-semibold" href="tel:+917909083806">+91 7909083806</a>.</p>
            </section>
          </article>
        </div>
      </section>
    </>
  );
}
