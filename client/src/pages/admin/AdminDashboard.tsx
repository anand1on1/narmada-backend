import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Package, MessageSquare, Map, DollarSign, AlertTriangle, Check, Loader2 } from "lucide-react";
import { Link } from "wouter";

// R27.28 — a procurement decision that proceeded with a higher-than-historical rate.
interface RateIrregularity {
  id: number;
  part_number: string; part_name: string | null; new_brand: string | null;
  new_rate: number; new_vendor: string | null;
  previous_min_rate: number; previous_vendor: string | null; previous_brand: string | null;
  previous_date: string | null; previous_po_id: number | null;
  deviation_pct: number | null; decided_by: string | null; decided_at: string;
  po_id: number | null;
}

interface Stats {
  products: number;
  contacts: number;
  newContacts: number;
  urls: number;
  usdInr: number;
  lastSitemap: string | null;
}

export default function AdminDashboard() {
  const { token } = useAdminAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const refresh = async () => {
      try {
        const [prodRes, contactRes, settingsRes, sitemapRes] = await Promise.all([
          adminFetch(token, "/api/admin/products"),
          adminFetch(token, "/api/admin/contacts"),
          adminFetch(token, "/api/admin/settings"),
          adminFetch(token, "/api/admin/sitemap/status"),
        ]);
        const products = await prodRes.json();
        const contacts = await contactRes.json();
        const settings = await settingsRes.json();
        const sitemap = await sitemapRes.json();
        if (!alive) return;
        setStats({
          products: products.length,
          contacts: contacts.length,
          newContacts: contacts.filter((c: { status: string }) => c.status === "new").length,
          urls: sitemap.urlCount || 0,
          usdInr: settings.usd_inr_rate ? Number(settings.usd_inr_rate) : 83.5,
          lastSitemap: sitemap.generatedAt ? new Date(sitemap.generatedAt).toLocaleString() : null,
        });
      } catch (e) {
        console.error(e);
      }
    };
    refresh();
    const id = setInterval(refresh, 30000); // R24.5 — 30s auto-refresh, no page reload
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  const cards = [
    { icon: Package, label: "Products Listed", value: stats?.products ?? "—", color: "bg-blue-500/10 text-blue-600 border-blue-500/30", href: "/admin/products" },
    { icon: MessageSquare, label: "Total Enquiries", value: stats?.contacts ?? "—", sub: stats ? `${stats.newContacts} new` : "", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", href: "/admin/contacts" },
    { icon: Map, label: "Sitemap URLs", value: stats?.urls ?? "—", sub: stats?.lastSitemap ?? "Not generated yet", color: "bg-purple-500/10 text-purple-600 border-purple-500/30", href: "/admin/sitemap" },
    { icon: DollarSign, label: "USD/INR Rate", value: stats?.usdInr ? `₹${stats.usdInr.toFixed(2)}` : "—", color: "bg-amber-500/10 text-amber-600 border-amber-500/30", href: "/admin/settings" },
  ];

  return (
    <AdminLayout title="Dashboard">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="block p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200"
            data-testid={`card-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className={`w-10 h-10 ${c.color} border rounded-lg flex items-center justify-center mb-4`}>
              <c.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-display font-black mb-1">{c.value}</div>
            <div className="text-sm text-[hsl(220_60%_12%)]/75 font-medium">{c.label}</div>
            {c.sub && <div className="text-xs text-muted-foreground mt-2">{c.sub}</div>}
          </Link>
        ))}
      </div>

      <RateIrregularities token={token} />

      <div className="grid lg:grid-cols-2 gap-6 mt-8">
        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <h2 className="font-display text-lg font-bold mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <Link href="/admin/products" className="block px-4 py-3 bg-slate-100 dark:bg-slate-900 rounded-lg hover:bg-accent hover:text-accent-foreground transition font-semibold" data-testid="link-add-product">
              + Add a New Product
            </Link>
            <Link href="/admin/sitemap" className="block px-4 py-3 bg-slate-100 dark:bg-slate-900 rounded-lg hover:bg-accent hover:text-accent-foreground transition font-semibold" data-testid="link-regen-sitemap">
              Regenerate Sitemap
            </Link>
            <Link href="/admin/settings" className="block px-4 py-3 bg-slate-100 dark:bg-slate-900 rounded-lg hover:bg-accent hover:text-accent-foreground transition font-semibold" data-testid="link-update-rate">
              Update USD/INR Exchange Rate
            </Link>
          </div>
        </div>

        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <h2 className="font-display text-lg font-bold mb-4">Notes for the Admin</h2>
          <ul className="space-y-3 text-sm text-[hsl(220_60%_12%)]/75 font-medium">
            <li>• Products added here appear instantly on the public website.</li>
            <li>• Each product gets a unique URL of the form <code className="bg-muted px-1 py-0.5 rounded">/product/&lt;slug&gt;</code>.</li>
            <li>• Buy Now button auto-opens WhatsApp with the part number, name and product URL pre-filled.</li>
            <li>• Update the USD/INR rate weekly — all on-screen USD prices recalculate immediately.</li>
            <li>• After adding products, regenerate the sitemap and re-submit to Google Search Console.</li>
          </ul>
        </div>
      </div>
    </AdminLayout>
  );
}

// R27.28 — Rate Irregularities feed: unseen 'proceeded' higher-rate decisions. Each row
// shows the new-vs-previous comparison side by side; "Mark Seen" acknowledges & removes it.
function RateIrregularities({ token }: { token: string | null }) {
  const [rows, setRows] = useState<RateIrregularity[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/rate-irregularities");
      setRows(r.ok ? await r.json() : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  async function markSeen(rid: number) {
    setMarking(rid);
    try {
      const r = await adminFetch(token, `/api/admin/rate-irregularities/${rid}/mark-seen`, { method: "POST" });
      if (r.ok) setRows((cur) => cur.filter((x) => x.id !== rid));
    } catch { /* leave row in place on failure */ }
    finally { setMarking(null); }
  }

  const fmt = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");
  const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

  return (
    <div className="mt-8 p-6 bg-white border border-slate-200 rounded-2xl shadow-sm" data-testid="rate-irregularities">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 bg-red-500/10 text-red-600 border border-red-500/30 rounded-lg flex items-center justify-center">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <h2 className="font-display text-lg font-bold">Rate Irregularities</h2>
        {rows.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-red-600 text-white text-xs font-bold" data-testid="rate-irregularities-badge">
            {rows.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No unseen rate irregularities. Sellers locked at or below the historical low.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="border border-orange-200 bg-orange-50/50 rounded-xl p-4" data-testid={`irregularity-${r.id}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-mono font-semibold text-sm">
                    {r.part_number}{r.new_brand ? ` · ${r.new_brand}` : ""}
                  </div>
                  {r.part_name && <div className="text-xs text-muted-foreground">{r.part_name}</div>}
                </div>
                <div className="text-right">
                  {r.deviation_pct != null && (
                    <span className={`text-sm font-bold ${r.deviation_pct >= 20 ? "text-red-600" : "text-orange-600"}`}>
                      +{Number(r.deviation_pct).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div className="border border-orange-200 bg-white rounded-lg p-2">
                  <div className="text-[11px] font-semibold text-orange-700">Locked (higher)</div>
                  <div className="font-bold text-sm">{fmt(r.new_rate)}</div>
                  <div className="text-muted-foreground">{r.new_vendor || "—"}</div>
                </div>
                <div className="border bg-white rounded-lg p-2">
                  <div className="text-[11px] font-semibold text-muted-foreground">Previous lowest</div>
                  <div className="font-bold text-sm">{fmt(r.previous_min_rate)}</div>
                  <div className="text-muted-foreground">
                    {r.previous_vendor || "—"}{r.previous_brand ? ` · ${r.previous_brand}` : ""}{r.previous_date ? ` · ${fmtDate(r.previous_date)}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  By {r.decided_by || "—"} · {fmtDate(r.decided_at)}
                  {r.po_id != null && <> · PO #{r.po_id}</>}
                  {r.previous_po_id != null && <> · prev PO #{r.previous_po_id}</>}
                </span>
                <button
                  onClick={() => markSeen(r.id)}
                  disabled={marking === r.id}
                  data-testid={`mark-seen-${r.id}`}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {marking === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Mark Seen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
