import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { RefreshCw, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import { PUBLIC_ORIGIN } from "@shared/public-urls";

export default function AdminSitemap() {
  const { token } = useAdminAuth();
  const [status, setStatus] = useState<{ urlCount: number; generatedAt: number | null; lastRegeneratedAt?: number | null;
    public?: { status: "match" | "drift" | "unknown"; count: number | null; checkedAt: number; error?: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = PUBLIC_ORIGIN;

  useEffect(() => {
    if (!token) return;
    refresh();
  }, [token]); // eslint-disable-line

  async function refresh() {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/sitemap/status");
      if (!r.ok) throw new Error("Unable to load sitemap diagnostics. Check your admin session.");
      const d = await r.json();
      setStatus(typeof d.urlCount === "number" ? d : null);
      setError(typeof d.urlCount === "number" ? "" : "Backend update required: live sitemap diagnostics are unavailable.");
    } catch (e: any) {
      setStatus(null);
      setError(e.message || "Sitemap diagnostics unavailable.");
    }
  }

  async function regenerate() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, "/api/admin/sitemap/regenerate", { method: "POST" });
      if (!r.ok) throw new Error("Sitemap regeneration failed. No public success is assumed.");
      const d = await r.json();
      setStatus(d); setError("");
    } catch (e: any) {
      setError(e.message || "Sitemap regeneration failed.");
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/sitemap/download");
      if (!r.ok) throw new Error("Download failed. Check your admin session.");
      const reader = r.body?.getReader();
      if (!reader) throw new Error("Download response was empty.");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 8000000) { await reader.cancel(); throw new Error("Sitemap too large for browser download. Use the public sitemap URL."); }
        chunks.push(part.value);
      }
      const blob = new Blob(chunks, { type: "application/xml" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "sitemap.xml"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <AdminLayout title="Sitemap & SEO" responsiveSidebar>
      <div className="max-w-3xl space-y-6">
        {/* Status */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">XML Sitemap</h2>
          <p className="text-sm text-muted-foreground mb-5">
            One canonical URL per active product, plus core public pages. Catalog HTML and XML use live backend data; new products need no daily frontend upload. A one-time GoDaddy bridge upload is required.
          </p>
          {error && <p role="alert" className="mb-4 p-4 border border-red-300 rounded-lg text-red-700">{error}</p>}

          <div className="grid sm:grid-cols-3 gap-4 mb-5">
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Backend canonical URLs</div>
              <div className="font-display text-3xl font-bold">{status?.urlCount ?? "—"}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Public served URLs</div>
              <div className="font-display text-3xl font-bold">{status?.public?.count ?? "Unknown"}</div>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Last Generated</div>
              <div className="font-display text-base font-semibold">{status?.generatedAt ? new Date(status.generatedAt).toLocaleString() : "Unknown"}</div>
            </div>
          </div>
          <div className={`p-4 mb-5 border rounded-lg text-sm ${status?.public?.status === "match" ? "border-emerald-300" : "border-amber-400"}`} data-testid="sitemap-drift-status">
            <strong>{status?.public?.status === "match" ? "Public sitemap matches backend" : status?.public?.status === "drift" ? "Mismatch — public sitemap is stale or different" : "Public sitemap not verified"}</strong>
            <p className="mt-1">{status?.public?.status === "match" ? "The URL sets match. This does not mean Google has indexed them." : "Check the GoDaddy R28.19 upload, .htaccess and PHP cURL support. Do not treat the backend count as the public count."}</p>
            {status?.public?.error && <p className="mt-1 break-words">{status.public.error.replace(/_/g, " ")}</p>}
            <p className="mt-1 text-muted-foreground">Public check: {status?.public?.checkedAt ? new Date(status.public.checkedAt).toLocaleString() : "Unknown"} · server-side check cached for up to 30 seconds.</p>
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
              href={`${PUBLIC_ORIGIN}/sitemap.xml`}
              target="_blank" rel="noreferrer"
              className="px-5 py-2.5 border rounded-lg font-bold inline-flex items-center gap-2 hover:bg-muted"
              data-testid="link-view-sitemap"
            >
              <ExternalLink className="w-4 h-4" /> View sitemap.xml
            </a>
            <button
              onClick={download}
              className="px-5 py-2.5 border rounded-lg font-bold inline-flex items-center gap-2 hover:bg-muted"
              data-testid="link-download-sitemap"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            <button onClick={refresh} className="px-5 py-2.5 border rounded-lg font-bold" data-testid="sitemap-refresh">Refresh checks</button>
          </div>
        </section>

        {/* Submit to GSC */}
        <section className="p-6 bg-card border rounded-xl">
          <h2 className="font-display text-lg font-bold mb-1">Submit to Google Search Console</h2>
          <p className="text-sm text-muted-foreground mb-4">Follow these steps once after each major update:</p>
          <ol className="space-y-3 text-sm [&_code]:break-all">
            {[
              <>Sign in to <a className="text-accent font-semibold" href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Google Search Console</a> for <code className="bg-muted px-1 rounded">narmadamobility.com</code>.</>,
              <>Open <strong>Sitemaps</strong> in the left menu.</>,
              <>After the public URL set matches, submit <code className="bg-muted px-1 rounded">{origin}/sitemap.xml</code> and <code className="bg-muted px-1 rounded">sitemap-blog.xml</code>.</>,
              <>Inspect representative product URLs and monitor indexing reports. Google chooses crawl timing and which useful pages to index; submission is not an indexing guarantee.</>,
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
              "One canonical page per active product",
              "Published blog articles in sitemap-blog.xml",
              "No duplicate /p/ product aliases",
              "No mass city/state/country landing pages",
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
