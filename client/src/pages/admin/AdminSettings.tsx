import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Save, RefreshCw, CheckCircle2 } from "lucide-react";

export default function AdminSettings() {
  const { token } = useAdminAuth();
  const [usdInr, setUsdInr] = useState("83.5");
  const [siteEmail, setSiteEmail] = useState("sales@Narmadamobility.com");
  const [whatsapp, setWhatsapp] = useState("7909083806");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await adminFetch(token, "/api/admin/settings");
      const s = await r.json();
      if (s.usd_inr_rate) setUsdInr(s.usd_inr_rate);
      if (s.site_email) setSiteEmail(s.site_email);
      if (s.whatsapp) setWhatsapp(s.whatsapp);
    })();
  }, [token]);

  async function save() {
    if (!token) return;
    setSaving(true); setSaved(false);
    await adminFetch(token, "/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        usd_inr_rate: usdInr,
        site_email: siteEmail,
        whatsapp,
      }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function fetchLiveRate() {
    try {
      const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=INR");
      const d = await r.json();
      if (d?.rates?.INR) setUsdInr(String(d.rates.INR.toFixed(2)));
    } catch {
      // network might be blocked in sandbox; ignore
    }
  }

  return (
    <AdminLayout title="Site Settings">
      <div className="max-w-2xl space-y-6">
        {/* Currency */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">Currency Conversion</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Set the USD/INR rate the website uses to display USD prices. We recommend updating this weekly.
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-sm font-semibold mb-1.5 block">1 USD = ₹</label>
              <input
                type="number"
                step="0.01"
                value={usdInr}
                onChange={(e) => setUsdInr(e.target.value)}
                className="w-full px-4 py-2.5 border rounded-lg bg-background font-mono text-lg"
                data-testid="input-usdinr"
              />
            </div>
            <button
              onClick={fetchLiveRate}
              className="px-4 py-2.5 border rounded-lg font-semibold inline-flex items-center gap-2 hover:bg-muted"
              data-testid="button-fetch-rate"
              type="button"
            >
              <RefreshCw className="w-4 h-4" /> Fetch Live
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Tip: check <a className="text-accent font-semibold" href="https://www.google.com/finance/quote/USD-INR" target="_blank" rel="noreferrer">Google Finance</a> for the latest spot rate.
          </p>
        </section>

        {/* Contact */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">Contact Routing</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Where contact-form submissions are mirrored and the WhatsApp number Buy Now buttons open.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Sales Email</label>
              <input
                type="email"
                value={siteEmail}
                onChange={(e) => setSiteEmail(e.target.value)}
                className="w-full px-4 py-2.5 border rounded-lg bg-background"
                data-testid="input-email"
              />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1.5 block">WhatsApp Number (10-digit India)</label>
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full px-4 py-2.5 border rounded-lg bg-background font-mono"
                data-testid="input-whatsapp"
              />
              <p className="text-xs text-muted-foreground mt-1">+91 is prepended automatically by Buy Now buttons.</p>
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-3 bg-accent text-accent-foreground rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/90 disabled:opacity-60"
            data-testid="button-save-settings"
          >
            <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Settings"}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Saved successfully
            </span>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
