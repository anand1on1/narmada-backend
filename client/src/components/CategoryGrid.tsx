import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { PRODUCT_CATEGORIES } from "@/data/brands";

// Vite glob import so every category JPG gets bundled with a hashed URL.
const categoryImageModules = import.meta.glob("@/assets/categories/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function resolveImage(slug: string): string | undefined {
  const match = Object.entries(categoryImageModules).find(([k]) =>
    k.endsWith(`/${slug}.jpg`),
  );
  return match?.[1];
}

export function CategoryGrid() {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3"
      data-testid="category-grid"
    >
      {PRODUCT_CATEGORIES.map((c) => {
        const img = resolveImage(c.slug);
        return (
          <Link key={c.slug} href={`/category/${c.slug}`}>
            <a
              className="group relative block aspect-[4/5] sm:aspect-[3/4] rounded-xl overflow-hidden border border-[hsl(220_45%_20%)]/8 hover:border-[hsl(212_95%_55%)]/40 transition-all"
              data-testid={`link-category-${c.slug}`}
            >
              {img ? (
                <img
                  src={img}
                  alt={c.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                />
              ) : (
                <div className="absolute inset-0 bg-[hsl(210_35%_98%)]" />
              )}
              {/* Dark gradient bottom — keeps photo prominent, ensures white text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/85 via-slate-900/35 to-transparent" />
              {/* Cyan accent line on hover */}
              <div className="absolute inset-x-0 bottom-0 h-px bg-[hsl(212_95%_55%)] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-500" />

              <div className="relative h-full flex flex-col justify-end p-4 sm:p-5">
                <div className="font-semibold text-white text-[15px] sm:text-base leading-tight tracking-tight mb-1.5">
                  {c.name}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/75 inline-flex items-center gap-1 group-hover:text-[hsl(212_95%_65%)] transition-colors">
                  Browse parts
                  <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </div>
            </a>
          </Link>
        );
      })}
    </div>
  );
}
