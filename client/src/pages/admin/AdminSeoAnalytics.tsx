// R28 Session 4 — SEO Analytics (analytics, top pages, sitemap preview).
// Endpoints:
//   GET  /api/admin/seo/analytics?days=&is_bot=&limit=
//   GET  /api/admin/seo/top-pages?days=&limit=
//   GET  /api/admin/seo/sitemap-preview
//   POST /api/admin/seo/backfill-slugs
import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, ExternalLink, Zap } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatTs, PUBLIC_SITE_HOST } from "@/lib/r28-utils";

const BOT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "1", label: "Bots only" },
  { value: "0", label: "Humans only" },
];

export default function AdminSeoAnalytics() {
  const { token } = useAdminAuth();
  const [days, setDays] = useState(30);
  const [isBot, setIsBot] = useState("");
  const [backfilling, setBackfilling] = useState(false);

  const { data: analytics, isLoading: aLoading, refetch: aRefetch, isFetching: aFetching } = useQuery<any>({
    queryKey: ["seo-analytics", days, isBot],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("days", String(days));
      p.set("limit", "200");
      if (isBot !== "") p.set("is_bot", isBot);
      const r = await adminFetch(token, `/api/admin/seo/analytics?${p}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });

  const { data: top, isLoading: tLoading, refetch: tRefetch, isFetching: tFetching } = useQuery<any>({
    queryKey: ["seo-top", days],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("days", String(days));
      p.set("limit", "100");
      const r = await adminFetch(token, `/api/admin/seo/top-pages?${p}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });

  const { data: preview, isLoading: pLoading, refetch: pRefetch, isFetching: pFetching } = useQuery<any>({
    queryKey: ["seo-preview"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/seo/sitemap-preview`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });

  const backfill = async () => {
    if (!confirm("Backfill missing product slugs? Idempotent — already-slugged rows are skipped.")) return;
    setBackfilling(true);
    try {
      const r = await adminFetch(token, `/api/admin/seo/backfill-slugs`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: "Slug backfill complete", description: `Filled ${j.filled ?? j.updated ?? 0} slugs` });
      pRefetch();
    } catch (e: any) {
      toast({ title: "Backfill failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setBackfilling(false); }
  };

  const buildLoc = (rowType: string, slug: string) => {
    // R28.11 — chassis uses /chassis/ (SPA route) not /c/ (SSR-only). Product
    // /p/ + category /cat/ stay for now (SSR-only, admin-visible even when off).
    if (rowType === "product") return `${PUBLIC_SITE_HOST}/p/${slug}`;
    if (rowType === "chassis") return `${PUBLIC_SITE_HOST}/chassis/${slug}`;
    if (rowType === "category") return `${PUBLIC_SITE_HOST}/cat/${slug}`;
    return `${PUBLIC_SITE_HOST}/${slug}`;
  };

  return (
    <AdminLayout title="SEO Analytics">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">Days</span>
            <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} className="border rounded-md px-2 py-1.5 text-sm">
              {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">Bot filter</span>
            <select value={isBot} onChange={(e) => setIsBot(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
              {BOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <Tabs defaultValue="analytics">
          <TabsList>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="top">Top Pages</TabsTrigger>
            <TabsTrigger value="sitemap">Sitemap Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="analytics" className="mt-3">
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm text-slate-600">{analytics?.count ?? 0} page views over {analytics?.days ?? days} days</div>
              <Button variant="outline" size="sm" onClick={() => aRefetch()} disabled={aFetching}>
                <RefreshCw className={`w-4 h-4 ${aFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Slug</th>
                    <th className="px-3 py-2 text-left">Bot</th>
                    <th className="px-3 py-2 text-left">User Agent</th>
                    <th className="px-3 py-2 text-left">Referer</th>
                  </tr>
                </thead>
                <tbody>
                  {aLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
                  {!aLoading && (analytics?.rows || []).length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No page views recorded yet.</td></tr>}
                  {(analytics?.rows || []).map((r: any) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50 align-top">
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{formatTs(r.created_at)}</td>
                      <td className="px-3 py-2 text-xs">{r.page_type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.page_slug}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.is_bot ? <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px]">bot</span> : <span className="text-slate-400">no</span>}
                      </td>
                      <td className="px-3 py-2 text-[11px] max-w-xs truncate" title={r.user_agent}>{r.user_agent || "—"}</td>
                      <td className="px-3 py-2 text-[11px] max-w-xs truncate" title={r.referer}>{r.referer || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="top" className="mt-3">
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm text-slate-600">Top pages over {top?.days ?? days} days</div>
              <Button variant="outline" size="sm" onClick={() => tRefetch()} disabled={tFetching}>
                <RefreshCw className={`w-4 h-4 ${tFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Slug</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Bots</th>
                    <th className="px-3 py-2 text-right">Humans</th>
                    <th className="px-3 py-2 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {tLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
                  {!tLoading && (top?.rows || []).length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No traffic yet.</td></tr>}
                  {(top?.rows || []).map((r: any, i: number) => (
                    <tr key={i} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs">{r.page_type}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.page_slug}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold">{r.view_count}</td>
                      <td className="px-3 py-2 text-right text-xs">{r.bot_view_count ?? 0}</td>
                      <td className="px-3 py-2 text-right text-xs">{Math.max(0, (r.view_count ?? 0) - (r.bot_view_count ?? 0))}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={buildLoc(r.page_type, r.page_slug)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 text-xs">
                          <ExternalLink className="w-3 h-3" /> Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="sitemap" className="mt-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
              <div className="text-sm text-slate-600 space-y-0.5">
                <div>
                  Base: <span className="font-mono">{preview?.base_url || "—"}</span> · Feature enabled: <b>{preview?.enabled ? "yes" : "no"}</b>
                </div>
                <div>{preview?.count ?? 0} URLs · P {preview?.by_type?.product ?? 0} · C {preview?.by_type?.chassis ?? 0} · Cat {preview?.by_type?.category ?? 0} · Other {preview?.by_type?.other ?? 0}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => pRefetch()} disabled={pFetching}>
                  <RefreshCw className={`w-4 h-4 ${pFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={backfill} disabled={backfilling}>
                  <Zap className="w-4 h-4 mr-1" /> {backfilling ? "Filling…" : "Backfill slugs"}
                </Button>
              </div>
            </div>
            <div className="bg-white rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">URL</th>
                    <th className="px-3 py-2 text-left">Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  {pLoading && <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
                  {!pLoading && (preview?.sample || []).length === 0 && <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-500">No entries in sitemap preview.</td></tr>}
                  {(preview?.sample || []).map((u: any, i: number) => (
                    <tr key={i} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <a href={u.loc} target="_blank" rel="noopener noreferrer" className="text-indigo-600">{u.loc}</a>
                      </td>
                      <td className="px-3 py-2 text-xs">{u.lastmod || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
