import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { CalendarClock, BookOpen, ArrowUpRight, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { BloggerSettings } from "@shared/auto-blogger";
import { blogAction } from "@shared/blog-diagnostics";

type Status = {
  settings: BloggerSettings; providers: { ready: boolean; generation: boolean; research: boolean };
  deploymentEnabled: boolean; available: boolean; reason: string | null; timezone: string;
  nextSchedule?: { slot: string; at: number }; today: { published: number; usage: { calls: number; tokens: number } };
  jobs: any[]; topics: any[]; clusters: any[]; articles: any[];
  articlePage: number; articlePages: number; articleTotal: number;
  diagnostics?: { nextAction: string; providerNotice: string; connectivity: string; lastSuccessfulJobAt: number | null; budgetWarning: string | null };
};
const base = "/api/admin/auto-blogger";
const when = (n?: number) => n ? new Date(n).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
const label = (s: string) => s.toLowerCase().replace(/_/g, " ");
const button = "inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed";
const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm";

export default function AdminAutoBlogger() {
  const { token, role } = useAdminAuth();
  const [settings, setSettings] = useState<BloggerSettings | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [tab, setTab] = useState("articles"), [article, setArticle] = useState<any>(null);
  const [preview, setPreview] = useState(false);
  const [articlePage, setArticlePage] = useState(1);
  const status = useQuery<Status>({
    queryKey: [base, articlePage], enabled: !!token && role === "admin", refetchInterval: 15000,
    queryFn: async () => {
      const r = await adminFetch(token!, `${base}?page=${articlePage}`);
      if (!r.ok) throw new Error("Unable to load Auto Blogger. Check your admin session.");
      return r.json();
    },
  });
  useEffect(() => { if (status.data && !settings) setSettings(status.data.settings); }, [status.data, settings]);
  async function request(path: string, method = "POST", body?: unknown) {
    setBusy(true); setMessage("");
    try {
      const r = await adminFetch(token!, base + path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const result = await r.json();
      if (!r.ok) throw new Error(label(result.error || "Request failed"));
      await status.refetch(); return result;
    } catch (e: any) { setMessage(e.message); return null; }
    finally { setBusy(false); }
  }
  async function open(id: number) {
    const result = await request(`/articles/${id}`, "GET");
    if (result) { setArticle(result); setPreview(false); }
  }
  async function save(publish: boolean) {
    if (!article) return;
    const { title, excerpt, content, metaTitle, metaDescription, claims } = article.snapshot;
    const result = await request(`/articles/${article.id}`, "PATCH", { title, excerpt, content, metaTitle, metaDescription, claims, publish });
    if (result) { setArticle(result); setMessage(publish ? "Article saved and published after validation." : "Draft saved. Public visibility is off."); }
  }
  const data = status.data;
  return <AdminLayout title="Auto Blogger" responsiveSidebar>
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">Narmada Mobility / Editorial operations</p>
          <h1 className="text-3xl font-semibold tracking-tight">Useful insights. On a schedule.</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">Targets two new posts each day, plus one evidence-led improvement when supported. Failed checks never go live.</p></div>
        <a href="/blog" target="_blank" rel="noreferrer" className={button}>View insights <ArrowUpRight className="w-4 h-4" /></a>
      </header>
      {status.isLoading && <p role="status" className="p-8 border rounded-xl">Loading editorial controls…</p>}
      {status.error && <p role="alert" className="p-5 border border-red-300 rounded-xl text-red-700">{status.error.message}</p>}
      {message && <p role="status" className="p-4 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-900">{message}</p>}
      {data && settings && <>
        <section className={`rounded-xl border p-5 ${data.available && data.settings.mode !== "pause" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`} data-testid="blogger-availability">
          <div className="flex gap-3"><ShieldCheck className="w-5 h-5 shrink-0 mt-1" /><div>
            <h2 className="font-semibold">{data.available ? (data.settings.mode === "pause" ? "Automation paused" : data.settings.mode === "draft" ? "Draft mode — nothing auto-publishes" : "Auto mode — validated articles publish automatically") : "Automation unavailable — no articles will be generated"}</h2>
            <p className="text-sm mt-1">Generation: {data.providers.generation ? "configured" : "not configured"} · Research: {data.providers.research ? "configured" : "not configured"} · Deployment gate: {data.deploymentEnabled ? "enabled" : "off"}</p>
            {data.reason && <p className="text-sm font-semibold mt-2">{data.reason.replace(/_/g, " ")}: {data.diagnostics?.nextAction || blogAction(data.reason)}</p>}
            <p className="text-sm mt-2">{data.diagnostics?.providerNotice || "Configured means key presence, not verified connectivity or available credits."}</p>
            <p className="text-sm mt-1">Last successful engine job: {when(data.diagnostics?.lastSuccessfulJobAt || undefined)}. A manually written legacy post is not evidence that automation is running.</p>
            <p className="text-sm mt-1">One-time deployment check: <a href="https://narmadamobility.com/version.json" target="_blank" rel="noreferrer" className="underline">Public release marker</a> must show R28.19; verify <a href="https://narmadamobility.com/blog" target="_blank" rel="noreferrer" className="underline">public Insights</a> and <a href="https://narmadamobility.com/sitemap-blog.xml" target="_blank" rel="noreferrer" className="underline">blog XML</a> before enabling Render.</p>
            {data.diagnostics?.budgetWarning && <p role="alert" className="text-sm font-semibold mt-2">{data.diagnostics.budgetWarning}</p>}
          </div></div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["New posts today", `${data.today.published} / 2`, "Successful first publications"],
            ["Next scheduled slot", data.nextSchedule ? when(data.nextSchedule.at) : "—", "Asia/Kolkata · only today's due slots catch up"],
            ["Provider calls reserved", `${data.today.usage.calls} / ${data.settings.dailyCallBudget}`, "Conservative reservation before each attempt"],
            ["Token budget reserved", `${data.today.usage.tokens.toLocaleString()} / ${data.settings.dailyTokenBudget.toLocaleString()}`, "Not a provider invoice or usage estimate"],
          ].map(([name, value, help]) => <div key={name} className="bg-card border rounded-xl p-5"><p className="text-sm text-muted-foreground">{name}</p><p className="text-xl font-semibold my-2">{value}</p><p className="text-xs text-muted-foreground">{help}</p></div>)}
        </div>
        <details className="bg-card border rounded-xl p-5" open>
          <summary className="font-semibold cursor-pointer">Schedule & safeguards</summary>
          <form className="mt-5 space-y-5" onSubmit={async e => {
            e.preventDefault(); const result = await request("/settings", "PATCH", settings);
            if (result) { setSettings(result); setMessage("Schedule and limits saved."); }
          }}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm font-medium">Mode<select className={`${field} mt-2`} value={settings.mode} data-testid="blogger-mode" onChange={e => setSettings({ ...settings, mode: e.target.value as BloggerSettings["mode"] })}>
                <option value="auto">Auto — publish validated posts</option><option value="draft">Draft — generate without publishing</option><option value="pause">Pause — stop scheduled work</option></select></label>
              {([["morning", "First new post"], ["improvement", "Improve older article"], ["evening", "Second new post"]] as const).map(([key, title]) =>
                <label key={key} className="text-sm font-medium">{title}<input required type="time" className={`${field} mt-2`} value={settings[key]} onChange={e => setSettings({ ...settings, [key]: e.target.value })} /></label>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {([["dailyCallBudget", "Daily API call budget", 3, 36], ["dailyTokenBudget", "Daily token reservation limit", 60000, 600000],
                ["dailyDraftCap", "Manual draft jobs / day", 0, 3], ["maxAttempts", "Attempts per slot", 1, 3]] as const).map(([key, title, min, max]) =>
                <label key={key} className="text-sm font-medium">{title}<input required type="number" min={min} max={max} className={`${field} mt-2`} value={settings[key]} onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })} /></label>)}
            </div>
            <p className="text-xs text-muted-foreground">Fixed caps: 2 new publications + 1 improvement slot per IST day. Each provider attempt reserves 3 API calls and 60,000 tokens; skips before research spend nothing. First attempts for new posts are protected from optional work and retries. Older articles must be more than 7 days unchanged; unsupported updates are skipped. Provider outages may leave slots unfilled, never replaced by filler.</p>
            <button disabled={busy} className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="blogger-save-settings">Save controls</button>
          </form>
        </details>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} className={button} onClick={async () => { const r = await request("/plan"); if (r) setMessage(`${r.added} catalog-grounded topics added.`); }} data-testid="blogger-plan"><BookOpen className="w-4 h-4" />Plan topics</button>
          <button disabled={busy || !data.available || data.settings.mode === "pause"} className={button} onClick={async () => { const r = await request("/draft"); if (r) setMessage(`Draft job ${r.jobId} queued. It cannot auto-publish.`); }} data-testid="blogger-draft">Generate a safe draft</button>
          <button disabled={busy || !data.available || data.settings.mode === "pause"} className={button} onClick={async () => { if (await request("/wake")) setMessage("Scheduler checked. Existing daily slots and caps still apply."); }} data-testid="blogger-wake"><CalendarClock className="w-4 h-4" />Check due slots</button>
          <button disabled={busy} className={button} onClick={() => status.refetch()} aria-label="Refresh dashboard"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <div role="tablist" aria-label="Editorial views" className="flex gap-2 border-b overflow-x-auto">
          {["articles", "planner", "jobs"].map(t => <button key={t} role="tab" aria-selected={tab === t} className={`px-4 py-3 capitalize text-sm font-semibold border-b-2 ${tab === t ? "border-indigo-600 text-indigo-600" : "border-transparent"}`} onClick={() => setTab(t)}>{t}</button>)}
        </div>
        {tab === "articles" && <section className="space-y-5">
          {!data.articles.length ? <div className="border border-dashed rounded-xl p-10 text-center text-muted-foreground">No managed articles yet. Plan topics, then run in Draft or Auto once the server is configured.<p className="mt-2"><a href="/admin/blog" className="underline">Open legacy blog editor</a></p></div> :
            <div className="grid gap-4 lg:grid-cols-2">{data.articles.map(a => <article key={a.id} className="bg-card border rounded-xl p-5">
              <div className="flex gap-3 items-center text-xs"><span className={`rounded-full px-2 py-1 ${a.published ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{a.published ? "Published" : "Draft / unpublished"}</span><span className="capitalize text-muted-foreground">{a.category}</span></div>
              <h2 className="font-semibold text-lg mt-3">{a.title}</h2><p className="text-xs text-muted-foreground my-3">Updated {when(a.updated_at)}</p>
              <div className="flex gap-3 flex-wrap"><button className={button} onClick={() => open(a.id)}>Edit & revisions</button>{!!a.published && <><a href={`/blog/${a.slug}`} className={button} target="_blank" rel="noreferrer">Read</a>
                <button disabled={busy} className={button} onClick={async () => { if (confirm("Unpublish this article? Its canonical URL and revisions will be retained.")) await request(`/articles/${a.id}/unpublish`); }}>Unpublish</button></>}</div>
            </article>)}</div>}
          {!!data.articleTotal && <nav className="flex flex-wrap gap-4 justify-center items-center" aria-label="Admin article pagination">
            <button className={button} disabled={data.articlePage <= 1} onClick={() => setArticlePage(articlePage - 1)}>Previous articles</button>
            <span className="text-sm">Page {data.articlePage} / {data.articlePages} · {data.articleTotal} articles</span>
            <button className={button} disabled={data.articlePage >= data.articlePages} onClick={() => setArticlePage(articlePage + 1)}>Next articles</button>
          </nav>}
        </section>}
        {tab === "planner" && <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{data.clusters.map(c => <div className="border rounded-xl p-4 bg-card" key={c.id}><h2 className="text-sm font-semibold">{c.name}</h2><p className="text-xs text-muted-foreground mt-2">{c.pillar_post_id ? `Pillar article #${c.pillar_post_id}` : "Pillar awaiting first publication"}</p></div>)}</div>
          <p className="text-sm text-muted-foreground">Latest 100 topics. Rotates brands, categories, procurement, applications and evidence-aware geography. Research signals are not invented search-volume estimates.</p>
          {data.topics.length ? data.topics.map(t => <div key={t.id} className="border rounded-xl p-4 flex justify-between gap-4 bg-card"><div><h3 className="font-medium">{t.title}</h3><p className="text-xs text-muted-foreground mt-1">{t.intent} · {t.category} · {data.clusters.find(c => c.id === t.cluster_id)?.name}</p></div><span className="text-xs capitalize shrink-0">{t.status}</span></div>) : <p className="p-8 border border-dashed rounded-xl">The topic queue is empty. Use Plan topics to read supported public catalog categories.</p>}
        </section>}
        {tab === "jobs" && <section className="overflow-x-auto border rounded-xl bg-card"><p className="p-4 text-xs text-muted-foreground">Latest 80 jobs. Full durable history remains in the backend database.</p><table className="w-full text-sm text-left min-w-[680px]">
          <thead className="bg-muted"><tr>{["IST day / slot", "Job type", "Status", "Attempts", "Sanitized diagnostic"].map(h => <th className="p-4" key={h}>{h}</th>)}</tr></thead>
          <tbody>{data.jobs.map(j => <tr key={j.id} className="border-t"><td className="p-4">{j.day}<br /><span className="text-xs text-muted-foreground">{j.slot}</span></td><td className="p-4">{j.kind}</td><td className="p-4">{j.status}{j.status === "retry" && <p className="text-xs">{when(j.retry_at)}</p>}</td><td className="p-4">{j.attempts}</td><td className="p-4">{j.error_code ? label(j.error_code) : "—"}{j.error_code && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{j.nextAction || blogAction(j.error_code)}</p>}</td></tr>)}</tbody>
        </table>{!data.jobs.length && <p className="p-8 text-muted-foreground">No jobs yet. Scheduled work starts only when deployment and providers are enabled.</p>}</section>}
      </>}
    </div>
    {article && <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Article editor">
      <div className="max-w-5xl mx-auto bg-background rounded-2xl border p-5 md:p-8 space-y-5">
        <div className="flex justify-between gap-4"><div><h2 className="text-xl font-semibold">Article editor</h2><p className="text-xs text-muted-foreground break-all mt-1">Canonical retained: /blog/{article.slug}</p></div><button className={button} aria-label="Close editor" onClick={() => setArticle(null)}><X className="w-4 h-4" /></button></div>
        {message && <p role="alert" className="p-3 border rounded-lg">{message}</p>}
        <div className="flex gap-3"><button className={button} onClick={() => setPreview(false)}>Edit</button><button className={button} onClick={() => setPreview(true)}>Preview</button></div>
        {preview ? <iframe title="Sandboxed article preview" sandbox="" className="w-full h-[560px] border rounded-lg bg-white" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:17px/1.7 system-ui;padding:24px;color:#16213b}h2{line-height:1.3}a{color:#4338ca}</style></head><body>${article.snapshot.content}</body></html>`} /> :
          <div className="space-y-4">{(["title", "excerpt", "content", "metaTitle", "metaDescription"] as const).map(key => <label className="block text-sm font-medium" key={key}>{key === "content" ? "Article HTML (validated allowlist)" : key}
            {key === "content" ? <textarea className={`${field} mt-2 font-mono min-h-[260px]`} value={article.snapshot[key]} onChange={e => setArticle({ ...article, snapshot: { ...article.snapshot, [key]: e.target.value } })} /> :
              <input className={`${field} mt-2`} value={article.snapshot[key]} onChange={e => setArticle({ ...article, snapshot: { ...article.snapshot, [key]: e.target.value } })} />}</label>)}
            <p className="text-xs text-muted-foreground">Factual claims remain tied to stored evidence. Changing cited claim text may fail validation. Live edits and rollback must pass the factual reviewer; save as draft to take an article offline while editing.</p></div>}
        <div className="flex gap-3 flex-wrap"><button disabled={busy} className={button} onClick={() => save(false)}>Save as draft</button><button disabled={busy || !data?.available} className={`${button} bg-indigo-600 text-white`} onClick={() => save(true)}>Validate & publish</button></div>
        <section className="border-t pt-5"><h3 className="font-semibold">Revision history</h3><p className="text-xs text-muted-foreground mt-1">Rollback restores content, not the canonical URL or original publication date. Validation still applies.</p>
          <div className="space-y-2 mt-4">{article.revisions.map((r: any) => <div key={r.id} className="flex justify-between items-center gap-4 border rounded-lg p-3"><span className="text-sm">#{r.id} · {label(r.reason)}<br /><span className="text-xs text-muted-foreground">{when(r.created_at)}</span></span>
            <button disabled={busy} className={button} onClick={async () => { if (confirm(`Restore revision #${r.id}? Current content will be retained in history.`)) { const result = await request(`/articles/${article.id}`, "PATCH", { revisionId: r.id }); if (result) setArticle(result); } }}>Restore</button></div>)}</div>
        </section>
      </div>
    </div>}
  </AdminLayout>;
}
