// R28 Session 2 — Public chassis detail page.
// GET /api/chassis/:slug
// GET /api/chassis/:slug/parts?q=&limit=&offset=
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MessageCircle, Truck, ChevronLeft, Share2 } from "lucide-react";
import { NARMADA_WA_NUMBER, waLink, isFeatureDisabledError, copyToClipboardWithToast, chassisSeoUrl, isRepresentationalImage } from "@/lib/r28-utils";

interface ChassisPart {
  id: number;
  partNumber: string;
  description: string;
  category?: string | null;
  mrp?: number | null;
  imageUrl?: string | null;
  imageSource?: string | null;
  productId?: number | null;
  productSlug?: string | null;
}

export default function ChassisDetail() {
  const params = useParams();
  const slug = params.slug as string;
  const [q, setQ] = useState("");

  const { data: chassis, isLoading: chassisLoading, error: chassisError } = useQuery<any>({
    queryKey: ["public-chassis-detail", slug],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/chassis/${slug}`);
      return r.json();
    },
  });
  const { data: partsData, isLoading: partsLoading } = useQuery<any>({
    queryKey: ["public-chassis-parts", slug, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      p.set("limit", "300");
      const r = await apiRequest("GET", `/api/chassis/${slug}/parts?${p}`);
      return r.json();
    },
    enabled: !!chassis && !isFeatureDisabledError(chassisError),
  });

  const parts: ChassisPart[] = Array.isArray(partsData) ? partsData : (partsData?.rows ?? []);
  const disabled = isFeatureDisabledError(chassisError);

  if (disabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md p-6">
          <div className="text-lg font-medium text-slate-800">Chassis catalog is coming soon</div>
          <div className="text-sm text-slate-500 mt-1">This feature is temporarily off.</div>
        </div>
      </div>
    );
  }

  const chassisName = chassis?.chassis_display_name || slug;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Link href="/chassis"><a className="inline-flex items-center gap-1 text-sm text-slate-500 mb-3"><ChevronLeft className="w-4 h-4" /> Back to chassis catalog</a></Link>

        {chassisLoading && <div className="text-center text-slate-500 py-12">Loading…</div>}

        {chassis && (
          <>
            <div className="bg-white rounded-2xl border p-4 sm:p-6 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <Truck className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{chassisName}</h1>
                  {(chassis.make || chassis.model || chassis.variant) && (
                    <div className="text-sm text-slate-500 mt-1">{[chassis.make, chassis.model, chassis.variant].filter(Boolean).join(" · ")}</div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <a
                      href={waLink(NARMADA_WA_NUMBER, `Hi, I need parts for chassis "${chassisName}".`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm"
                      data-testid="link-whatsapp-chassis"
                    >
                      <MessageCircle className="w-4 h-4" /> WhatsApp for pricing
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboardWithToast(chassisSeoUrl(slug), "Share this page (SEO-friendly link)")}
                      data-testid="button-share-chassis"
                    >
                      <Share2 className="w-4 h-4 mr-1" /> Share this page (SEO-friendly link)
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-4 relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts within this chassis…" className="pl-9 h-11" data-testid="input-parts-search" />
            </div>

            {partsLoading && <div className="text-center text-slate-500 py-8">Loading parts…</div>}
            {!partsLoading && parts.length === 0 && <div className="text-center text-slate-500 py-8">No parts found for this chassis.</div>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parts.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border p-3 flex flex-col" data-testid={`card-part-${p.partNumber}`}>
                  {p.imageUrl ? (
                    <div className="mb-2">
                      <div className="aspect-square rounded-lg bg-slate-100 overflow-hidden">
                        <img src={p.imageUrl} alt={p.description} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      {isRepresentationalImage(p.imageSource) && (
                        <div className="text-[10px] italic text-slate-500 mt-0.5">* Image is for representation purpose only</div>
                      )}
                    </div>
                  ) : null}
                  <div className="font-mono text-xs text-slate-500">{p.partNumber}</div>
                  <div className="font-medium text-sm text-slate-900 mt-0.5 line-clamp-2">{p.description}</div>
                  {p.category && <div className="text-xs text-slate-500 mt-1">{p.category}</div>}
                  {typeof p.mrp === "number" && p.mrp > 0 && <div className="text-sm text-emerald-700 font-semibold mt-1">₹{Number(p.mrp).toLocaleString("en-IN")}</div>}
                  <div className="mt-3 flex gap-2">
                    <a
                      href={waLink(NARMADA_WA_NUMBER, `Hi, I need this part:\nChassis: ${chassisName}\nPart #: ${p.partNumber}\n${p.description}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 bg-[#25D366] text-white px-3 py-1.5 rounded text-xs flex-1 justify-center"
                      data-testid={`link-whatsapp-part-${p.partNumber}`}
                    >
                      <MessageCircle className="w-3 h-3" /> Enquire
                    </a>
                    {p.productSlug && (
                      <Link href={`/product/${p.productSlug}`}><a className="inline-flex items-center gap-1 border px-3 py-1.5 rounded text-xs">Product page</a></Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
