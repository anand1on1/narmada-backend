import { SeoHead } from "@/components/SeoHead";

export default function DisclaimerPage() {
  return (
    <>
      <SeoHead
        title="Disclaimer | Narmada Mobility"
        description="Legal disclaimer for the use of Narmada Mobility website, product listings, prices and trademarks."
      />
      <section className="py-16 lg:py-20 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-sm uppercase tracking-wider text-accent font-semibold mb-3">Legal</div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">Disclaimer</h1>
          <p className="text-muted-foreground mb-10">Last updated: June 2026</p>

          <article className="space-y-6 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">1. General Information</h2>
              <p>The information provided on narmadamobility.com is for general informational and commercial purposes only. While we endeavour to keep all part numbers, descriptions, fitments, prices and stock levels up to date, we make no warranties — express or implied — about the completeness, accuracy or reliability of the information available on this website.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">2. Trademark & Brand Use</h2>
              <p>All brand names, logos and trademarks — including but not limited to <strong className="text-foreground">Tata, Tata Motors, BharatBenz, Mercedes-Benz, Ashok Leyland, Eicher, VECV, Volvo, Volvo Construction Equipment</strong> — are the property of their respective owners. Their use on this website is purely descriptive, to identify the make and model of the vehicle for which a given spare part is intended.</p>
              <p>Narmada Mobility is <strong className="text-foreground">not</strong> an authorised dealer, distributor or agent of these vehicle OEMs unless explicitly stated. We supply genuine OEM parts where available and OEM-equivalent / aftermarket parts elsewhere; this is always clearly labelled on the product page.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">3. Pricing & Currency</h2>
              <p>Prices on this website are displayed in <strong className="text-foreground">US Dollars (USD)</strong> for informational and indicative purposes. Final pricing is confirmed in <strong className="text-foreground">Indian Rupees (INR)</strong> on the commercial invoice and may vary based on order quantity, shipping mode, prevailing customs duties and the spot USD-INR exchange rate at the time of invoicing.</p>
              <p>The on-screen USD figure is converted from our internal INR base rate using a periodically-updated reference exchange rate and should not be treated as a binding quote.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">4. Product Images</h2>
              <p>Product images on this website are representative. Actual parts may vary in appearance, packaging or revision (engineering change level) from the photograph shown. The part number printed on our invoice is authoritative.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">5. Fitment Responsibility</h2>
              <p>While we do our best to cross-reference parts to the correct model, the responsibility for confirming fitment — by checking the chassis number, engine number, model year and existing part number — lies with the buyer or their workshop. We recommend confirming fitment with our sales team before placing an order.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">6. External Links</h2>
              <p>This website may contain links to third-party websites. We have no control over the content of such sites and accept no responsibility for them.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">7. Limitation of Liability</h2>
              <p>To the maximum extent permitted by law, Narmada Mobility, UrbanFleet Technologies Pvt. Ltd. and its directors, employees and agents shall not be liable for any indirect, incidental or consequential loss arising out of the use of, or reliance on, the information on this website.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">8. Jurisdiction</h2>
              <p>This disclaimer is governed by the laws of India. Any dispute arising hereunder shall be subject to the exclusive jurisdiction of the courts at Patna, Bihar.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl font-bold text-foreground mb-3">9. Contact</h2>
              <p>For clarifications, write to <a className="text-accent font-semibold" href="mailto:sales@Narmadamobility.com">sales@Narmadamobility.com</a>.</p>
            </section>
          </article>
        </div>
      </section>
    </>
  );
}
