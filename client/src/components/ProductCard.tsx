import { Link } from "wouter";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { MessageCircle, Package, ArrowUpRight } from "lucide-react";
import { whatsappLink, buildBuyMessage, formatUSD, parseJsonArray } from "@/lib/utils-app";
import { BRANDS } from "@/data/brands";
import stockTurbo from "@/assets/v2/product-turbo.png";
import stockBrake from "@/assets/v2/product-brake.png";
import stockInjector from "@/assets/v2/product-injector.png";
import stockFlatlay from "@/assets/v2/parts-flatlay.png";

// Stock product imagery for fallback — cycled by product id so the catalog never looks empty.
const STOCK_IMAGES = [stockTurbo, stockBrake, stockInjector, stockFlatlay];

export function ProductCard({ product, usdInr }: { product: Product; usdInr: number }) {
  const brandInfo = BRANDS[product.brand as keyof typeof BRANDS];
  const images = parseJsonArray(product.imageUrls);
  const cover = images[0] || STOCK_IMAGES[product.id % STOCK_IMAGES.length];
  const buyUrl = whatsappLink("7909083806", buildBuyMessage({
    name: product.name, partNumber: product.partNumber || undefined, slug: product.slug,
    brand: brandInfo?.name || product.brand,
  }));
  return (
    <div className="group relative rounded-xl overflow-hidden bg-[hsl(210_35%_98%)] border border-[hsl(220_45%_20%)]/8 hover:border-[hsl(212_95%_55%)]/40 transition-all duration-300" data-testid={`card-product-${product.id}`}>
      <Link href={`/product/${product.slug}`}>
        <a className="block aspect-[4/3] relative overflow-hidden bg-[hsl(210_22%_90%)]" data-testid={`link-product-${product.id}`}>
          {cover ? (
            <img src={cover} alt={product.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[hsl(220_60%_12%)]/30">
              <Package className="h-12 w-12" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(210_30%_96%)]/95 via-[hsl(210_30%_96%)]/10 to-transparent" />

          {brandInfo && (
            <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md glass-panel-strong px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[hsl(220_60%_12%)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: brandInfo.color }} />
              {brandInfo.name}
            </div>
          )}
          {product.featured ? (
            <div className="absolute top-3 right-3 rounded-md bg-[hsl(212_95%_55%)] text-[hsl(220_60%_12%)] text-[10px] font-mono uppercase tracking-wider px-2 py-1 font-semibold" data-testid={`badge-featured-${product.id}`}>Featured</div>
          ) : null}

          {product.partNumber && (
            <div className="absolute bottom-3 left-3 font-mono text-[10px] text-[hsl(220_60%_12%)]/82 uppercase tracking-wider">
              <span className="text-[hsl(220_60%_12%)]/40">OEM</span> {product.partNumber}
            </div>
          )}
        </a>
      </Link>
      <div className="p-5 flex flex-col gap-2.5">
        <Link href={`/product/${product.slug}`}>
          <a className="font-display font-bold text-[15px] leading-snug text-[hsl(220_60%_12%)] hover:text-[hsl(212_95%_65%)] transition-colors line-clamp-2" data-testid={`text-product-name-${product.id}`}>{product.name}</a>
        </Link>
        {product.model && (
          <div className="text-[11px] text-[hsl(220_60%_12%)]/82 font-mono uppercase tracking-wider" data-testid={`text-model-${product.id}`}>
            Fits · {product.model}
          </div>
        )}
        <div className="mt-3 flex items-end justify-between gap-2 pt-3 border-t border-[hsl(220_45%_20%)]/8">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[hsl(220_60%_12%)]/40">Price</div>
            <div className="text-xl font-display font-black text-[hsl(220_60%_12%)]" data-testid={`text-price-${product.id}`}>{formatUSD(product.priceInr, usdInr)}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href={`/product/${product.slug}`}>
              <a className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[hsl(220_45%_20%)]/15 text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:border-[hsl(220_45%_20%)]/30 transition-colors" aria-label="View details">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Link>
            <Button asChild size="sm" className="bg-[#25D366] hover:bg-[#1da851] text-white font-medium h-8 px-3 text-[12px]" data-testid={`button-buy-${product.id}`}>
              <a href={buyUrl} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Buy</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
