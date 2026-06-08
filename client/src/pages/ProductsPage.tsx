import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import type { Product } from "@shared/schema";
import { BRANDS, BRAND_WALL, PRODUCT_CATEGORIES } from "@/data/brands";
import { ProductCard } from "@/components/ProductCard";
import { SeoHead } from "@/components/SeoHead";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, FilterX } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import partsFlatlay from "@/assets/v2/parts-flatlay.png";

export default function ProductsPage() {
  const search = useSearch();
  const initial = new URLSearchParams(search);
  const [brand, setBrand] = useState(initial.get("brand") || "all");
  const [category, setCategory] = useState(initial.get("category") || "all");
  const [q, setQ] = useState(initial.get("q") || "");

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (brand !== "all") p.set("brand", brand);
    if (category !== "all") p.set("category", category);
    if (q) p.set("q", q);
    return `/api/products${p.toString() ? `?${p}` : ""}`;
  }, [brand, category, q]);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: [queryUrl],
    queryFn: async () => { try { const r = await apiRequest("GET", queryUrl); return await r.json(); } catch { return []; } },
  });
  const { data: fx } = useQuery<{ usdInr: number }>({ queryKey: ["/api/settings/fx"] });
  const usdInr = fx?.usdInr || 83.5;

  return (
    <>
      <SeoHead
        title="All Spare Parts — Tata, BharatBenz, Ashok Leyland, Eicher, Volvo | Narmada Mobility"
        description="Search 50,000+ commercial vehicle and construction equipment spare parts across five flagship brands. Genuine OEM and matched-quality grades."
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
          <p className="text-[hsl(220_60%_12%)]/75 mt-5 max-w-2xl text-[15px] leading-relaxed">50,000+ active SKUs · Genuine OEM and matched-quality grades · Cross-referenced part numbers. Use the filters below to narrow by brand, category or keyword.</p>
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
                const slug = b.name.toLowerCase().replace(/\s+/g, "-");
                return <SelectItem key={b.name} value={slug}>{b.name}</SelectItem>;
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
        {isLoading ? (
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
            <div className="font-mono text-[11px] uppercase tracking-wider text-[hsl(220_60%_12%)]/82 mb-5">{products.length} product{products.length !== 1 ? "s" : ""} found</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {products.map((p) => <ProductCard key={p.id} product={p} usdInr={usdInr} />)}
            </div>
          </>
        )}
      </section>
    </>
  );
}
