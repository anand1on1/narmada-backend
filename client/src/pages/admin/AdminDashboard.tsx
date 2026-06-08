import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Package, MessageSquare, Map, DollarSign } from "lucide-react";
import { Link } from "wouter";

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
    (async () => {
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
    })();
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
            className="block p-5 bg-card border rounded-xl hover:shadow-md hover:border-accent/40 transition"
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

      <div className="grid lg:grid-cols-2 gap-6 mt-8">
        <div className="p-6 bg-card border rounded-xl">
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

        <div className="p-6 bg-card border rounded-xl">
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
