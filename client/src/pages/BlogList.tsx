import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SeoHead } from "@/components/SeoHead";
import { apiRequest } from "@/lib/queryClient";
import { ArrowRight, Search } from "lucide-react";

export default function BlogList() {
  const initial = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(initial.get("q") || "");
  const [q, setQ] = useState(search), [category, setCategory] = useState(initial.get("category") || "");
  const [page, setPage] = useState(Math.max(1, Number(initial.get("page")) || 1));
  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/blog/posts", q, category, page],
    queryFn: async () => (await apiRequest("GET", `/api/blog/posts?${new URLSearchParams({ q, category, page: String(page) })}`)).json(),
  });
  return <>
    <SeoHead title="Parts knowledge. Better decisions. — Narmada Mobility" description="Evidence-led guides to commercial vehicle parts, procurement and fleet care from the Narmada Mobility Editorial Desk." />
    <section className="bg-slate-50 dark:bg-slate-950 border-b py-12 lg:py-16">
      <div className="container mx-auto px-5 max-w-6xl">
        <p className="text-xs uppercase tracking-[.15em] text-indigo-600 dark:text-indigo-300 font-bold">Narmada Mobility / Insights</p>
        <h1 className="font-display text-4xl md:text-5xl leading-tight font-semibold tracking-tight mt-5">Parts knowledge.<br />Better decisions.</h1>
        <p className="text-lg text-muted-foreground mt-5 max-w-2xl">Evidence-led guides to commercial vehicle parts, procurement and fleet care. Useful questions to ask before your next enquiry.</p>
      </div>
    </section>
    <section className="container mx-auto px-5 max-w-6xl py-10">
      <form className="flex flex-wrap items-end gap-4 mb-8" onSubmit={e => { e.preventDefault(); setQ(search); setPage(1); }}>
        <label className="text-sm font-semibold flex-1 min-w-[200px]">Search insights<div className="flex items-center gap-2 border rounded-lg px-3 mt-2 bg-background"><Search className="w-4 h-4 text-muted-foreground" /><input className="py-3 w-full bg-transparent outline-none font-normal" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search topics" data-testid="blog-search" /></div></label>
        <label className="text-sm font-semibold">Category<select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} className="block mt-2 border rounded-lg bg-background px-3 py-3 font-normal" data-testid="blog-category"><option value="">All categories</option>{data?.categories?.map((c: string) => <option key={c}>{c}</option>)}</select></label>
        <button className="px-5 py-3 bg-indigo-600 text-white rounded-lg font-semibold text-sm">Find articles</button>
      </form>
      {isLoading ? <p className="py-16 text-center text-muted-foreground" role="status">Loading insights…</p> : isError ? <p className="py-10 border rounded-xl text-center" role="alert">Insights are temporarily unavailable. Please try again shortly.</p> : <>
        <p className="text-sm text-muted-foreground mb-6">{data.total} articles · Narmada Mobility Editorial Desk</p>
        {!data.items.length ? <div className="border border-dashed rounded-xl p-12 text-center text-muted-foreground">No articles found.{(q || category) ? <button onClick={() => { setSearch(""); setQ(""); setCategory(""); setPage(1); }} className="block mx-auto mt-4 underline">Clear filters</button> : <p className="mt-2">New editorial guides will appear here when published.</p>}</div> :
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">{data.items.map((p: any) => <article key={p.id} className="border bg-card rounded-2xl p-6 flex flex-col">
            <span className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-300 font-bold">{p.category}</span>
            <h2 className="font-display font-semibold text-2xl leading-snug mt-4"><Link href={`/blog/${p.slug}`} className="hover:text-indigo-600">{p.title}</Link></h2>
            <p className="text-muted-foreground text-sm leading-relaxed mt-4 flex-1">{p.excerpt}</p>
            <p className="text-xs text-muted-foreground mt-6">{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString("en-IN", { dateStyle: "long" }) : ""}</p>
            <Link href={`/blog/${p.slug}`} className="mt-4 text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-2 font-semibold text-sm">Read insight <ArrowRight className="w-4 h-4" /></Link>
          </article>)}</div>}
        <nav aria-label="Article pagination" className="flex items-center justify-center gap-5 mt-10">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="border rounded-lg px-4 py-2 disabled:opacity-40">Previous</button>
          <span className="text-sm">Page {page} of {Math.max(1, data.pages)}</span>
          <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="border rounded-lg px-4 py-2 disabled:opacity-40">Next</button>
        </nav>
      </>}
    </section>
  </>;
}
