import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SeoHead } from "@/components/SeoHead";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft } from "lucide-react";

export default function BlogDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data: post, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/blog/posts", slug],
    queryFn: async () => (await apiRequest("GET", `/api/blog/posts/${encodeURIComponent(slug || "")}`)).json(),
  });
  useEffect(() => {
    let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const prior = el?.href;
    if (!el) { el = document.createElement("link"); el.rel = "canonical"; document.head.appendChild(el); }
    el.href = `https://narmadamobility.com/blog/${encodeURIComponent(slug || "")}`;
    return () => { if (prior) el!.href = prior; else el?.remove(); };
  }, [slug]);
  if (isLoading) return <p className="p-16 text-center" role="status">Loading article…</p>;
  if (isError || !post) return <section className="container mx-auto px-5 py-20"><h1 className="text-3xl font-semibold mb-4">Article not found</h1><p className="text-muted-foreground mb-4">It may be unpublished or temporarily unavailable.</p><Link href="/blog" className="underline">Browse insights</Link></section>;
  const date = (n: number) => new Date(n).toLocaleDateString("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" });
  const canonical = `https://narmadamobility.com/blog/${encodeURIComponent(post.slug)}`;
  return <>
    <SeoHead title={`${post.metaTitle || post.title} — Narmada Mobility`} description={post.metaDescription || post.excerpt} jsonLd={[
      { "@context": "https://schema.org", "@type": "Article", headline: post.title, mainEntityOfPage: canonical,
        datePublished: new Date(post.publishedAt).toISOString(), dateModified: new Date(post.updatedAt).toISOString(),
        author: { "@type": "Organization", name: post.authorName }, publisher: { "@type": "Organization", name: "Narmada Mobility" } },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://narmadamobility.com" },
        { "@type": "ListItem", position: 2, name: "Insights", item: "https://narmadamobility.com/blog" },
        { "@type": "ListItem", position: 3, name: post.title, item: canonical },
      ] },
    ]} />
    <article className="container mx-auto max-w-4xl px-5 py-10 md:py-16">
      <Link href="/blog" className="text-sm text-muted-foreground inline-flex items-center gap-2"><ArrowLeft className="w-4 h-4" />All insights</Link>
      <p className="text-xs uppercase tracking-widest font-bold text-indigo-600 dark:text-indigo-300 mt-8">{post.category}</p>
      <h1 className="font-display text-3xl md:text-5xl font-semibold tracking-tight leading-tight my-5">{post.title}</h1>
      <p className="text-xl text-muted-foreground leading-relaxed">{post.excerpt}</p>
      <p className="text-sm text-muted-foreground my-6">{post.authorName}<br />Published <time dateTime={new Date(post.publishedAt).toISOString()}>{date(post.publishedAt)}</time> · Updated <time dateTime={new Date(post.updatedAt).toISOString()}>{date(post.updatedAt)}</time></p>
      {post.aiAssisted && <p className="text-sm text-muted-foreground border-l-2 pl-4 mb-8">AI-assisted editorial content, checked automatically against cited references. This is not a claim of human technical review. Confirm vehicle-specific requirements with the manufacturer and our team.</p>}
      {/* API output is allowlist-sanitized server-side, including legacy articles. */}
      <div className="prose prose-slate dark:prose-invert max-w-none prose-a:text-indigo-600 prose-headings:font-display break-words" dangerouslySetInnerHTML={{ __html: post.content }} />
      {!!post.sources.length && <section className="mt-10 border-t pt-8"><h2 className="text-2xl font-semibold mb-4">Sources & further reading</h2><ul className="space-y-3">{post.sources.map((s: any) => <li key={s.url} className="text-sm break-words"><a href={s.url} rel="noopener noreferrer" className="underline text-indigo-600 dark:text-indigo-300">{s.title}</a> · Accessed {date(s.accessedAt)}</li>)}</ul></section>}
      {!!post.products.length && <section className="mt-10"><h2 className="text-2xl font-semibold mb-4">Explore the catalog</h2><ul className="space-y-3">{post.products.map((p: any) => <li key={p.slug}><Link href={`/product/${p.slug}`} className="underline text-indigo-600 dark:text-indigo-300">{p.name}</Link></li>)}</ul><p className="text-sm text-muted-foreground mt-3">Catalog references do not confirm fitment or current availability.</p></section>}
      <section className="mt-10 bg-slate-50 dark:bg-slate-900 border rounded-2xl p-6 md:p-8"><h2 className="text-2xl font-semibold">Make your next enquiry more useful.</h2><p className="mt-3 text-muted-foreground">Share your vehicle details, part number and requirements. Our team can help confirm fitment and availability before quoting.</p><div className="flex flex-wrap gap-4 mt-5"><Link href="/contact" className="bg-indigo-600 text-white rounded-lg px-5 py-3 font-semibold">Request a quote</Link><a href="https://wa.me/917909083806?text=Hello%20Narmada%20Mobility%2C%20I%20have%20a%20parts%20enquiry." className="border rounded-lg px-5 py-3 font-semibold">WhatsApp the team</a></div></section>
      {!!post.related.length && <section className="mt-10"><h2 className="text-2xl font-semibold mb-4">Continue reading</h2><ul className="space-y-3">{post.related.map((p: any) => <li key={p.slug}><Link href={`/blog/${p.slug}`} className="underline">{p.title}</Link></li>)}</ul></section>}
    </article>
  </>;
}
