import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SeoHead } from "@/components/SeoHead";
import { apiUrl } from "@/lib/queryClient";
import { Search, Tag, Package, Hash, FileSpreadsheet, MessageCircle, AlertCircle } from "lucide-react";

interface BrandStat { brand: string; count: number; lastUpdated: string; latestVersion: string | null; }
interface PriceItem {
  id: number; brand: string; partNumber: string; description: string | null;
  mrp: number | null; dealerPrice: number | null; hsnCode: string | null;
  gstPercent: number | null; uom: string | null; updatedAt: string;
}

const WHATSAPP = "917909083806";

export default function PriceChecker() {
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [searched, setSearched] = useState<string | null>(null);

  const { data: brandsData } = useQuery<BrandStat[]>({
    queryKey: ["/api/price-lists/brands"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/price-lists/brands"));
      return r.json();
    },
  });

  const { data: searchResults, isFetching: searching, refetch } = useQuery<{ results: PriceItem[]; count: number }>({
    queryKey: ["/api/price-lists/search", searched, brand],
    queryFn: async () => {
      if (!searched) return { results: [], count: 0 };
      const params = new URLSearchParams({ part_number: searched });
      if (brand) params.set("brand", brand);
      const r = await fetch(apiUrl(`/api/price-lists/search?${params.toString()}`));
      return r.json();
    },
    enabled: !!searched,
  });

  function go() {
    if (q.trim()) { setSearched(q.trim()); refetch(); }
  }

  function whatsappFor(it: PriceItem) {
    const msg = `Hi Narmada Mobility, I'd like to enquire about part number ${it.partNumber} (${it.description || ""}). Please share the latest price and availability.`;
    return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
  }

  return (
    <>
      <SeoHead
        title="Spare Part Price Checker — Narmada Mobility | Tata, BharatBenz, Ashok Leyland, Eicher, Volvo"
        description="Search any commercial vehicle spare part number to see MRP, dealer price, HSN code and GST rate. Live price lists from Tata, BharatBenz, Ashok Leyland, Eicher and Volvo."
        keywords="spare part price checker, truck part number search, hsn code lookup, tata bharatbenz ashok leyland eicher volvo parts price, narmada mobility"
      />

      <section className="relative surface-obsidian text-foreground py-14 lg:py-20 overflow-hidden border-b border-border">
        <div className="absolute inset-0 pattern-grid opacity-30" />
        <div className="container mx-auto px-4 relative">
          <span className="eyebrow inline-flex items-center gap-2 mb-4">
            <span className="signal-dot" /> Price Checker
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight mb-4">
            Look up any <span className="text-gradient-cyan">part number</span> instantly.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-8">
            Search across the latest brand price lists to see MRP, dealer price, HSN code and GST. WhatsApp enquiry available for confirmed availability.
          </p>

          {/* Search bar */}
          <div className="flex gap-2 max-w-2xl flex-col sm:flex-row">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="Enter part number (e.g. 278611200172)"
                className="w-full bg-background/80 backdrop-blur border-2 border-border focus:border-accent rounded-xl pl-12 pr-4 py-3.5 text-base font-mono outline-none"
                data-testid="input-part-number"
              />
            </div>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="bg-background/80 backdrop-blur border-2 border-border rounded-xl px-4 py-3.5 text-sm sm:w-48"
              data-testid="select-brand"
            >
              <option value="">All brands</option>
              {brandsData?.map((b) => (
                <option key={b.brand} value={b.brand}>{b.brand.replace("-", " ").replace(/\b\w/g, l => l.toUpperCase())}</option>
              ))}
            </select>
            <button onClick={go} className="px-6 py-3.5 bg-accent text-accent-foreground rounded-xl font-bold uppercase tracking-wider text-sm" data-testid="button-search">Search</button>
          </div>
        </div>
      </section>

      {/* Available brands strip */}
      <section className="bg-card border-b py-6">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-4 h-4 text-accent" />
            <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Price Lists Currently Loaded</span>
          </div>
          {!brandsData || brandsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No price lists uploaded yet. Contact us on WhatsApp for the latest prices.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {brandsData.map((b) => (
                <div key={b.brand} className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-lg text-sm" data-testid={`brand-chip-${b.brand}`}>
                  <span className="font-semibold capitalize">{b.brand.replace("-", " ")}</span>
                  <span className="text-xs text-muted-foreground">{b.count.toLocaleString()} parts</span>
                  {b.latestVersion && <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 rounded font-mono">{b.latestVersion}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Results */}
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          {!searched ? (
            <div className="text-center py-16 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>Enter a part number above to begin.</p>
              <p className="text-xs mt-2">Tip: partial matches work too (e.g. "278611" finds all parts starting with that).</p>
            </div>
          ) : searching ? (
            <div className="text-center py-16 text-muted-foreground">Searching…</div>
          ) : !searchResults || searchResults.count === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-8 text-center max-w-2xl mx-auto" data-testid="no-results">
              <AlertCircle className="w-10 h-10 mx-auto text-amber-700 mb-3" />
              <h3 className="font-display text-xl font-bold mb-2">No match found for "{searched}"</h3>
              <p className="text-sm text-muted-foreground mb-4">This part number isn't in the loaded price lists yet — but we can still source it. Send us the part number on WhatsApp and we'll respond with availability and price.</p>
              <a href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi, I'm looking for part number ${searched}. Please share price and availability.`)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm"
                data-testid="button-whatsapp-noresult">
                <MessageCircle className="w-4 h-4" /> Ask on WhatsApp
              </a>
            </div>
          ) : (
            <>
              <div className="mb-5 text-sm text-muted-foreground">Found <span className="font-semibold text-foreground">{searchResults.count}</span> match{searchResults.count === 1 ? "" : "es"} for <span className="font-mono font-bold text-foreground">"{searched}"</span></div>
              <div className="space-y-3">
                {searchResults.results.map((it) => (
                  <div key={it.id} className="bg-card border rounded-xl p-5 grid sm:grid-cols-[1fr_auto] gap-5 items-center" data-testid={`result-${it.id}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 bg-accent/15 text-accent rounded uppercase font-bold tracking-wider">{it.brand.replace("-", " ")}</span>
                        <span className="font-mono text-base font-bold">{it.partNumber}</span>
                      </div>
                      <div className="text-sm text-foreground mb-3">{it.description || "—"}</div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                        {it.mrp && <span className="inline-flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-muted-foreground" /> <span className="text-muted-foreground">MRP:</span> <span className="font-bold">₹{it.mrp.toLocaleString("en-IN")}</span></span>}
                        {it.dealerPrice && <span className="inline-flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-emerald-600" /> <span className="text-muted-foreground">Dealer:</span> <span className="font-bold text-emerald-700">₹{it.dealerPrice.toLocaleString("en-IN")}</span></span>}
                        {it.hsnCode && <span className="inline-flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-muted-foreground" /> <span className="text-muted-foreground">HSN:</span> <span className="font-mono font-semibold">{it.hsnCode}</span></span>}
                        {it.gstPercent !== null && it.gstPercent !== undefined && <span className="inline-flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-muted-foreground" /> <span className="text-muted-foreground">GST:</span> <span className="font-semibold">{it.gstPercent}%</span></span>}
                        {it.uom && <span className="text-muted-foreground">Unit: <span className="font-semibold text-foreground">{it.uom}</span></span>}
                      </div>
                    </div>
                    <a href={whatsappFor(it)} target="_blank" rel="noopener noreferrer"
                      className="px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 justify-self-end"
                      data-testid={`button-whatsapp-${it.id}`}>
                      <MessageCircle className="w-4 h-4" /> Enquire
                    </a>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-6 text-center">
                Prices are indicative and subject to confirmation. Use the WhatsApp button to confirm live availability and current pricing.
              </p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
