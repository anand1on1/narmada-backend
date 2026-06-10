import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { RefreshCw, Download, ExternalLink, CheckCircle2 } from "lucide-react";

export default function AdminSitemap() {
  const { token } = useAdminAuth();
  const [status, setStatus] = useState<{ urlCount: number; generatedAt: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!token) return;
    refresh();
  }, [token]); // eslint-disable-line

  async function refresh() {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/sitemap/status");
      const d = await r.json();
      // Backend returns { last: { urlCount, generatedAt } }; tolerate a flat shape too.
      const s = d?.last ?? d;
      setStatus(s && typeof s.urlCount === "number" ? { urlCount: s.urlCount, generatedAt: s.generatedAt ?? null } : null);
    } catch {
      setStatus(null);
    }
  }

  async function regenerate() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, "/api/admin/sitemap/regenerate", { method: "POST", body: JSON.stringify({ baseUrl: origin }) });
      const d = await r.json();
      setStatus({ urlCount: d.urlCount, generatedAt: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout title="Sitemap & SEO">
      <div className="max-w-3xl space-y-6">
        {/* Status */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">XML Sitemap</h2>
          <p className="text-sm text-muted-foreground mb-5">
            The sitemap lists every public URL — brand pages, products, categories, and the brand × state / brand × country SEO landing pages. Regenerate it whenever you add or remove products.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Total URLs</div>
              <div className="font-display text-3xl font-bold">{status?.urlCount ?? "—"}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Last Generated</div>
              <div className="font-display text-base font-semibold">{status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : "Never"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={regenerate}
              disabled={busy}
              className="px-5 py-2.5 bg-accent text-accent-foreground rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/90 disabled:opacity-60"
              data-testid="button-regenerate-sitemap"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Generating..." : "Regenerate Sitemap"}
            </button>
            <a
              href="/sitemap.xml"
              target="_blank" rel="noreferrer"
              className="px-5 py-2.5 border rounded-lg font-bold inline-flex items-center gap-2 hover:bg-muted"
              data-testid="link-view-sitemap"
            >
              <ExternalLink className="w-4 h-4" /> View sitemap.xml
            </a>
            <a
              href="/api/admin/sitemap/download"
              className="px-5 py-2.5 border rounded-lg font-bold inline-flex items-center gap-2 hover:bg-muted"
              data-testid="link-download-sitemap"
            >
              <Download className="w-4 h-4" /> Download
            </a>
          </div>
        </section>

        {/* Submit to GSC */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">Submit to Google Search Console</h2>
          <p className="text-sm text-muted-foreground mb-4">Follow these steps once after each major update:</p>
          <ol className="space-y-3 text-sm">
            {[
              <>Sign in to <a className="text-accent font-semibold" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Google Search Console</a> for <code className="bg-muted px-1 rounded">narmadamobility.com</code>.</>,
              <>Open <strong>Sitemaps</strong> in the left menu.</>,
              <>Submit the URL: <code className="bg-muted px-1 rounded">{origin}/sitemap.xml</code> — Google will fetch and index it within 24–48 hours.</>,
              <>Re-submit after major catalogue additions; Google detects daily.</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 bg-accent/15 text-accent border border-accent/30 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                <div className="flex-1">{s}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* What's included */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-3">What the Sitemap Includes</h2>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {[
              "Homepage & static pages",
              "5 brand pages (Tata, BharatBenz, Ashok Leyland, Eicher, Volvo)",
              "15 category pages",
              "All active product pages",
              "5 × 36 = 180 brand × Indian state landing pages",
              "5 × 60 = 300 brand × country landing pages",
              "Privacy, disclaimer, work-with-us, contact, about",
            ].map((x) => (
              <li key={x} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminLayout>
  );
}
