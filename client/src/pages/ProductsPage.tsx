import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";
import { BRAND_WALL, PRODUCT_CATEGORIES } from "@/data/brands";
import { ProductCard } from "@/components/ProductCard";
import { SeoHead } from "@/components/SeoHead";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, FilterX } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import partsFlatlay from "@/assets/v2/parts-flatlay.png";
import { useResultParams } from "@/lib/results-navigation";

export default function ProductsPage() {
  const { params, update, page, setPage } = useResultParams();
  const brand = params.get("brand") || "all", setBrand = (brand: string) => update({ brand: brand === "all" ? "" : brand });
  const category = params.get("category") || "all", setCategory = (category: string) => update({ category: category === "all" ? "" : category });
  const q = params.get("q") || "", setQ = (q: string) => update({ q });
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(timer); }, [q]);

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (brand !== "all") p.set("brand", brand);
    if (category !== "all") p.set("category", category);
    if (debouncedQ) p.set("q", debouncedQ);
    p.set("page", String(page)); p.set("limit", "24");
    return `/api/products${p.toString() ? `?${p}` : ""}`;
  }, [brand, category, debouncedQ, page]);

  const { data, isLoading, isError, refetch } = useQuery<{ products: Product[]; total: number; pages: number }>({
    queryKey: [queryUrl],
    staleTime: 30_000,
    queryFn: async () => { const r = await apiRequest("GET", queryUrl); return await r.json(); },
  });
  const products = data?.products || [];
  const total = data?.total || 0;
  const pages = Math.max(1, data?.pages || 1);
  useEffect(() => {
    if (data && page > Math.max(1, data.pages)) setPage(Math.max(1, data.pages));
  }, [data, page]);
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;
  const pageHref = (n: number) => {
    const next = new URLSearchParams(params);
    n > 1 ? next.set("page", String(n)) : next.delete("page");
    return `/products${next.size ? `?${next}` : ""}`;
  };

  return (
    <>
      <SeoHead
        title={`Commercial vehicle parts${page > 1 ? ` — Page ${page}` : ""} | Narmada Mobility`}
        description="Browse the Narmada Mobility parts catalog. Confirm fitment, price and availability before ordering."
        noindex={!!q || brand !== "all" || category !== "all"}
        canonicalPath={`/products${page > 1 ? `?page=${page}` : ""}`}
        keywords="truck spare parts catalog, commercial vehicle parts india, heavy duty spare parts exporter"
      />
      <section className="surface-obsidian relative overflow-hidden border-b border-[hsl(220_45%_20%)]/8">
        <div className="absolute inset-0 pattern-grid opacity-40" />
        <div className="absolute inset-0">
          <img src={partsFlatlay} alt="" role="presentation" className="w-full h-full object-cover opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(210_30%_96%)] via-[hsl(210_30%_96%)]/80 to-transparent" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="eyebrow text-[hsl(212_95%_55%)] mb-3">Catalog</div>
          <h1 className="font-display font-black text-[hsl(220_60%_12%)] text-4xl md:text-5xl lg:text-6xl tracking-tight leading-[1.05] max-w-3xl">Spare parts for every commercial vehicle in your fleet.</h1>
          <p className="text-[hsl(220_60%_12%)]/75 mt-5 max-w-2xl text-[15px] leading-relaxed">Explore catalog parts by brand, category or keyword. Confirm the part reference, fitment, price and availability with our team before ordering.</p>
        </div>
      </section>

      <section className="surface-obsidian max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(220_60%_12%)]/75 font-medium" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part name, OEM number, model…" className="pl-9" data-testid="input-search" />
          </div>
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger data-testid="select-brand"><SelectValue placeholder="Brand" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {BRAND_WALL.map((b) => {
                return <SelectItem key={b.name} value={b.slug}>{b.name}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger data-testid="select-category"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(brand !== "all" || category !== "all" || q) && (
          <Button variant="outline" size="sm" className="mt-3 border-[hsl(220_45%_20%)]/15 bg-[hsl(220_45%_20%)]/5 text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/10" onClick={() => { setBrand("all"); setCategory("all"); setQ(""); }} data-testid="btn-clear">
            <FilterX className="h-3.5 w-3.5 mr-1.5" /> Clear filters
          </Button>
        )}
      </section>

      <section className="surface-obsidian max-w-7xl mx-auto px-4 sm:px-6 pb-24">
        {isError ? <div role="alert" className="text-center py-12">Unable to load products. <Button variant="outline" onClick={() => refetch()}>Try again</Button></div> : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (<div key={i} className="aspect-[3/4] rounded-xl bg-[hsl(220_45%_20%)]/5 animate-pulse" />))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24 max-w-md mx-auto">
            <h3 className="font-display font-black text-[hsl(220_60%_12%)] text-2xl mb-3">No products match your filters</h3>
            <p className="text-[hsl(220_60%_12%)]/75 mb-6">Our team is constantly adding new SKUs. Reach out on WhatsApp with your exact part requirement.</p>
            <Button asChild className="bg-[#25D366] hover:bg-[#1da851] text-white font-semibold"><a href="https://wa.me/917909083806" target="_blank" rel="noopener noreferrer">WhatsApp +91 79090 83806</a></Button>
          </div>
        ) : (
          <>
            <div className="font-mono text-[11px] uppercase tracking-wider text-[hsl(220_60%_12%)]/82 mb-5" data-testid="products-count">{total} product{total !== 1 ? "s" : ""} found · Showing {(page - 1) * 24 + 1}–{Math.min(page * 24, total)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {products.map((p) => <ProductCard key={p.id} product={p} usdInr={usdInr} />)}
            </div>
            <nav className="flex justify-between items-center gap-3 mt-8" aria-label="Products pagination">
              {page <= 1 ? <Button variant="outline" disabled>Previous</Button> :
                <Button variant="outline" asChild><a href={pageHref(page - 1)} onClick={e => { e.preventDefault(); setPage(page - 1); window.scrollTo(0, 400); }}>Previous</a></Button>}
              <span className="text-sm">Page {page} of {pages}</span>
              {page >= pages ? <Button variant="outline" disabled>Next</Button> :
                <Button variant="outline" asChild><a href={pageHref(page + 1)} onClick={e => { e.preventDefault(); setPage(page + 1); window.scrollTo(0, 400); }}>Next</a></Button>}
            </nav>
          </>
        )}
      </section>
    </>
  );
}
