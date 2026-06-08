import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SeoHead } from "@/components/SeoHead";
import { apiUrl } from "@/lib/queryClient";
import { Calendar, User, ArrowLeft, Package } from "lucide-react";

interface Post {
  id: number; slug: string; title: string; excerpt: string | null; content: string;
  coverImageUrl: string | null; type: "blog" | "spotlight"; productSlug: string | null;
  authorName: string | null; metaTitle: string | null; metaDescription: string | null;
  publishedAt: string | null; createdAt: string;
}

export default function BlogDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data: post, isLoading, isError } = useQuery<Post>({
    queryKey: ["/api/posts", slug],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/posts/${slug}`));
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
  });

  if (isLoading) return <div className="container mx-auto px-4 py-20 text-center text-muted-foreground">Loading…</div>;
  if (isError || !post) return (
    <div className="container mx-auto px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-bold mb-3">Article not found</h1>
      <Link href="/blog" className="text-accent font-semibold inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to all articles</Link>
    </div>
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": post.type === "spotlight" ? "Product" : "BlogPosting",
    headline: post.title,
    description: post.excerpt || post.metaDescription || "",
    image: post.coverImageUrl ? [post.coverImageUrl] : undefined,
    author: { "@type": "Organization", name: post.authorName || "Narmada Mobility" },
    publisher: { "@type": "Organization", name: "Narmada Mobility" },
    datePublished: post.publishedAt || post.createdAt,
  };

  return (
    <>
      <SeoHead
        title={post.metaTitle || `${post.title} — Narmada Mobility`}
        description={post.metaDescription || post.excerpt || post.title}
        jsonLd={jsonLd}
      />

      <article className="bg-background">
        {/* Hero */}
        <section className="relative surface-obsidian text-foreground py-14 lg:py-20 overflow-hidden border-b border-border">
          <div className="absolute inset-0 pattern-grid opacity-30" />
          <div className="container mx-auto px-4 relative max-w-4xl">
            <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6">
              <ArrowLeft className="w-4 h-4" /> All articles
            </Link>
            <span className={`eyebrow inline-flex items-center gap-2 mb-4`}>
              <span className="signal-dot" /> {post.type === "spotlight" ? "Product Spotlight" : "Article"}
            </span>
            <h1 className="font-display text-3xl md:text-5xl font-semibold leading-[1.1] tracking-tight mb-6">{post.title}</h1>
            <div className="flex items-center gap-5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><User className="w-4 h-4" /> {post.authorName || "Narmada Mobility"}</span>
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {new Date(post.publishedAt || post.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          </div>
        </section>

        {/* Cover image */}
        {post.coverImageUrl && (
          <div className="container mx-auto px-4 max-w-4xl -mt-8 mb-8 relative">
            <img src={post.coverImageUrl} alt={post.title} className="w-full aspect-[16/9] object-cover rounded-2xl shadow-2xl border" />
          </div>
        )}

        {/* Content */}
        <div className="container mx-auto px-4 max-w-3xl py-8 lg:py-12">
          {post.excerpt && (
            <p className="text-xl text-muted-foreground leading-relaxed mb-8 font-medium">{post.excerpt}</p>
          )}
          <div className="prose-narmada" dangerouslySetInnerHTML={{ __html: post.content }} />

          {post.productSlug && (
            <Link href={`/product/${post.productSlug}`}
              className="mt-10 block bg-accent/10 border border-accent/30 rounded-2xl p-6 hover:bg-accent/15 transition"
              data-testid="link-related-product">
              <div className="flex items-center gap-4">
                <Package className="w-8 h-8 text-accent flex-shrink-0" />
                <div>
                  <div className="text-xs uppercase tracking-wider text-accent font-bold mb-1">View Featured Product</div>
                  <div className="font-display text-lg font-semibold">/{post.productSlug}</div>
                </div>
              </div>
            </Link>
          )}

          <div className="mt-12 pt-8 border-t flex items-center justify-between">
            <Link href="/blog" className="text-sm font-semibold inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> More articles
            </Link>
            <Link href="/contact" className="px-5 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold text-sm">
              Get a Quote
            </Link>
          </div>
        </div>
      </article>

      <style>{`
        .prose-narmada { font-size: 1.05rem; line-height: 1.75; color: hsl(var(--foreground)); }
        .prose-narmada h2 { font-family: var(--font-display); font-size: 1.875rem; font-weight: 700; margin: 2rem 0 1rem; line-height: 1.2; }
        .prose-narmada h3 { font-family: var(--font-display); font-size: 1.375rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
        .prose-narmada p { margin: 1rem 0; }
        .prose-narmada ul, .prose-narmada ol { margin: 1rem 0; padding-left: 1.5rem; }
        .prose-narmada li { margin: 0.4rem 0; }
        .prose-narmada a { color: hsl(var(--accent)); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
        .prose-narmada strong { color: hsl(var(--foreground)); font-weight: 700; }
        .prose-narmada blockquote { border-left: 3px solid hsl(var(--accent)); padding-left: 1rem; margin: 1.25rem 0; color: hsl(var(--muted-foreground)); font-style: italic; }
        .prose-narmada img { max-width: 100%; border-radius: 0.75rem; margin: 1.5rem 0; }
        .prose-narmada code { background: hsl(var(--muted)); padding: 0.15rem 0.4rem; border-radius: 0.3rem; font-size: 0.9em; }
      `}</style>
    </>
  );
}
