import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SeoHead } from "@/components/SeoHead";
import { apiUrl } from "@/lib/queryClient";
import { Calendar, User, ArrowRight, FileText, Star } from "lucide-react";

interface Post {
  id: number; slug: string; title: string; excerpt: string | null;
  coverImageUrl: string | null; type: "blog" | "spotlight";
  authorName: string | null; publishedAt: string | null; createdAt: string;
}

export default function BlogList() {
  const { data: posts, isLoading } = useQuery<Post[]>({
    queryKey: ["/api/posts"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/posts"));
      return r.json();
    },
  });

  return (
    <>
      <SeoHead
        title="Insights & Spotlights — Narmada Mobility Blog"
        description="Industry insights, technical guides and product spotlights for commercial vehicle spare parts. Tata, BharatBenz, Ashok Leyland, Eicher and Volvo expertise from Narmada Mobility."
        keywords="commercial vehicle blog, truck parts guide, tata bharatbenz ashok leyland eicher technical articles, narmada mobility"
      />
      <section className="relative surface-obsidian text-foreground py-16 lg:py-20 overflow-hidden border-b border-border">
        <div className="absolute inset-0 pattern-grid opacity-30" />
        <div className="container mx-auto px-4 relative">
          <span className="eyebrow inline-flex items-center gap-2 mb-4">
            <span className="signal-dot" /> Insights
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight">
            Articles & <span className="text-gradient-cyan">Spotlights</span>
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-2xl">
            Technical guides, product reviews, and industry insights for the commercial vehicle aftermarket.
          </p>
        </div>
      </section>

      <section className="py-12 lg:py-16 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground">Loading…</div>
          ) : !posts || posts.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground" data-testid="empty-posts">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No articles yet. Check back soon.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((p) => (
                <Link key={p.id} href={`/blog/${p.slug}`} className="block group" data-testid={`card-post-${p.id}`}>
                  <article className="bg-card border rounded-2xl overflow-hidden h-full flex flex-col hover-elevate transition">
                    <div className="aspect-[16/10] bg-muted overflow-hidden">
                      {p.coverImageUrl ? (
                        <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          {p.type === "spotlight" ? <Star className="w-12 h-12" /> : <FileText className="w-12 h-12" />}
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${p.type === "spotlight" ? "bg-amber-500/15 text-amber-700" : "bg-accent/15 text-accent"}`}>
                          {p.type === "spotlight" ? "Spotlight" : "Article"}
                        </span>
                      </div>
                      <h2 className="font-display text-xl font-bold leading-tight mb-2 group-hover:text-accent transition">{p.title}</h2>
                      <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{p.excerpt}</p>
                      <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><User className="w-3 h-3" /> {p.authorName || "Narmada Mobility"}</span>
                        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(p.publishedAt || p.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-3 text-sm font-semibold text-accent inline-flex items-center gap-1">Read article <ArrowRight className="w-3 h-3" /></div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
