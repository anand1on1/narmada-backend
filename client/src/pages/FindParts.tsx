// R28.3 — Standalone /find-parts page is now a thin wrapper around
// FindPartsEmbed (the same component that Get-Quotation Step 3 uses).
// The Add-to-Cart button on part cards routes into the site cart via the
// existing cart lib.
import { Link } from "wouter";
import { MessageCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { addToCart } from "@/lib/cart";
import { FindPartsEmbed, AddablePart } from "@/components/FindPartsEmbed";

export default function FindParts() {
  const onAdd = (p: AddablePart) => {
    try {
      addToCart({
        productId: p.part_id,
        partNumber: p.part_number,
        name: p.description || p.part_number,
        unitPriceInr: p.sell_price ?? 0,
        image: p.image_url || null,
      }, 1);
      toast({ title: "Added to cart", description: `${p.part_number} — ${p.description || ""}` });
    } catch (e: any) {
      toast({ title: "Could not add", description: e?.message || String(e), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="text-center mb-8">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono uppercase mb-3">
            Find Parts
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Find the right parts</h1>
          <p className="text-slate-600 mt-2 text-base">Search by registration, chassis number, model, or part number — pick whichever you have.</p>
        </div>

        <FindPartsEmbed initialTab="reg" onAddToCart={onAdd} />

        <div className="mt-10 border-t pt-6 text-center">
          <Link href="/get-quote">
            <a className="inline-flex items-center gap-2 text-indigo-600 text-sm font-medium" data-testid="link-getquote-below">
              <MessageCircle className="w-4 h-4" /> Or start a formal quotation request
            </a>
          </Link>
        </div>
      </div>
    </div>
  );
}
