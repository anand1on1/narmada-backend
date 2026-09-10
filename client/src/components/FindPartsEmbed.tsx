// R28.3 — Embeddable Find Parts panel.
//
// Extracted from client/src/pages/FindParts.tsx so the /find-parts standalone
// page AND the Get-Quotation Step 3 can share the exact same 4-tab UI + results
// grid. The Add-to-Cart action is prop-driven so the caller controls the cart
// store (site cart on the standalone page, wizard-local state in Step 3).
//
// Tabs:
//   reg    Registration number lookup  (POST /api/parts-finder/lookup)
//   vin    Chassis number direct match (POST /api/parts-finder/lookup-chassis)
//   model  Browse chassis catalog      (GET  /api/chassis?q=)
//   part   Search parts by number/OEM  (GET  /api/parts/search)
//
// Reg/VIN lookups take the visitor to a matched chassis; from that chassis's
// detail page the existing Add-to-Cart flow already works with the site cart.
// In wizard mode (isEmbeddedWizard=true) we surface "matched chassis" and
// deep-link to the model tab pre-filled with the chassis code so the visitor
// can add parts without leaving the wizard.
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, MessageCircle, ArrowRight, ListChecks, Package, Hash, Truck, Plus, ImageOff, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { waLink, NARMADA_WA_NUMBER, isFeatureDisabledError, isRateLimitedError, isRepresentationalImage, formatINR } from "@/lib/r28-utils";

export type FindPartsTabId = "reg" | "vin" | "model" | "part";

export interface AddablePart {
  part_id: number;
  part_number: string;
  oem_number?: string | null;
  description?: string | null;
  category?: string | null;
  sell_price?: number | null;
  stock_qty?: number | null;
  image_url?: string | null;
  image_source?: string | null;
  fits_chassis?: {
    id: number;
    slug: string;
    display_name: string;
    make?: string | null;
    model?: string | null;
  } | null;
}

export interface FindPartsEmbedProps {
  /** Initial tab (default 'reg'). */
  initialTab?: FindPartsTabId;
  /** Wizard mode hides prices and swaps CTA to "Add to quote". Default false. */
  isEmbeddedWizard?: boolean;
  /** Fires when a part is added via the ➕ button. */
  onAddToCart: (part: AddablePart) => void;
  /** Optional: part_ids already in the caller's cart (highlight the ➕ button). */
  addedPartIds?: Set<number>;
  /** Optional: called when the visitor is sent to a matched chassis. If provided,
      the "View parts" button on the reg/VIN match card calls this INSTEAD of
      navigating to /chassis/:slug (so the wizard can pre-load the model tab). */
  onOpenChassis?: (slug: string, displayName: string) => void;
}

interface LookupResult {
  ok: boolean;
  reg_number?: string | null;
  chassis_number?: string | null;
  matched_chassis?: { id: number; chassis_display_name: string; slug: string } | null;
  cached?: boolean;
  error?: string;
  message?: string;
}

interface ChassisRow {
  id: number;
  chassis_code: string;
  chassis_display_name: string;
  slug: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  cover_image_url?: string | null;
  image_source?: string | null;
}

export function FindPartsEmbed(props: FindPartsEmbedProps) {
  const { initialTab = "reg" } = props;
  const [tab, setTab] = useState<FindPartsTabId>(initialTab);

  return (
    <div data-testid="findparts-embed">
      {/* Tab bar — big, filled active state, icons, horizontally scrollable on mobile */}
      <div
        role="tablist"
        aria-label="Find parts by"
        className="flex sm:grid sm:grid-cols-4 gap-2 mb-6 overflow-x-auto -mx-1 px-1 pb-1 sm:pb-0 snap-x snap-mandatory"
      >
        <BigTab id="reg"   active={tab === "reg"}   onClick={setTab} icon={<Hash className="w-5 h-5" />}       label="Registration" />
        <BigTab id="vin"   active={tab === "vin"}   onClick={setTab} icon={<Truck className="w-5 h-5" />}      label="Chassis Number" />
        <BigTab id="model" active={tab === "model"} onClick={setTab} icon={<ListChecks className="w-5 h-5" />} label="Model" />
        <BigTab id="part"  active={tab === "part"}  onClick={setTab} icon={<Package className="w-5 h-5" />}    label="Part Number" />
      </div>

      {tab === "reg"   && <RegTab   {...props} />}
      {tab === "vin"   && <VinTab   {...props} />}
      {tab === "model" && <ModelTab {...props} />}
      {tab === "part"  && <PartTab  {...props} />}
    </div>
  );
}

function BigTab({ id, active, onClick, icon, label }: { id: FindPartsTabId; active: boolean; onClick: (t: FindPartsTabId) => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`snap-start shrink-0 sm:shrink inline-flex items-center justify-center gap-2 h-14 min-w-[160px] sm:min-w-0 px-4 rounded-xl text-sm font-semibold transition-all ${
        active
          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
          : "bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
      data-testid={`tab-${id}`}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────── Registration tab */
function RegTab({ isEmbeddedWizard, onOpenChassis }: FindPartsEmbedProps) {
  const [reg, setReg] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [, navigate] = useLocation();

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = reg.replace(/\s+/g, "").toUpperCase();
    if (!cleaned) return;
    setLoading(true); setResult(null); setFeatureDisabled(false); setRateLimited(false);
    try {
      const r = await apiRequest("POST", "/api/parts-finder/lookup", { reg_number: cleaned });
      setResult(await r.json() as LookupResult);
    } catch (e: any) {
      if (isFeatureDisabledError(e)) return setFeatureDisabled(true);
      if (isRateLimitedError(e)) return setRateLimited(true);
      toast({ title: "Lookup failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  const openMatched = () => {
    if (!result?.matched_chassis) return;
    if (onOpenChassis) {
      onOpenChassis(result.matched_chassis.slug, result.matched_chassis.chassis_display_name);
    } else {
      navigate(`/chassis/${result.matched_chassis.slug}`);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="bg-card rounded-xl border shadow-sm p-5 sm:p-6 mb-4">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono tracking-wider">Registration number</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={reg}
            onChange={(e) => setReg(e.target.value.toUpperCase())}
            placeholder="e.g. BR01AB1234"
            className="flex-1 h-12 text-base sm:text-lg font-mono tracking-wider uppercase"
            data-testid="input-reg"
          />
          <Button type="submit" size="lg" className="h-12 px-6" disabled={loading || !reg.trim()} data-testid="btn-reg-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Looking up…" : "Search"}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Powered by SurePass RC lookup. Up to 60 lookups per hour per network.</p>
      </form>

      {!result && !loading && !featureDisabled && !rateLimited && (
        <EmptyHelp title="Search by registration number" body="Type the vehicle's number-plate. We'll look up the chassis and show every part we stock for it." />
      )}
      {loading && <SkeletonMatchCard />}
      {featureDisabled && <ComingSoonCard />}
      {rateLimited && <RateLimitCard />}
      {result && result.ok && result.matched_chassis && (
        <MatchedCard
          reg={result.reg_number || null}
          chassisNumber={result.chassis_number || null}
          matched={result.matched_chassis}
          onView={openMatched}
          ctaLabel={isEmbeddedWizard ? "Browse parts for this chassis" : "View all parts for this chassis"}
        />
      )}
      {result && result.ok && !result.matched_chassis && <UnmatchedCard chassisNumber={result.chassis_number || result.reg_number || null} />}
      {result && !result.ok && <FailCard message={result.message || result.error || null} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── VIN / chassis tab */
function VinTab({ isEmbeddedWizard, onOpenChassis }: FindPartsEmbedProps) {
  const [vin, setVin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [, navigate] = useLocation();

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = vin.replace(/\s+/g, "").toUpperCase();
    if (!cleaned) return;
    setLoading(true); setResult(null); setRateLimited(false);
    try {
      const r = await apiRequest("POST", "/api/parts-finder/lookup-chassis", { chassis_number: cleaned });
      setResult(await r.json() as LookupResult);
    } catch (e: any) {
      if (isRateLimitedError(e)) return setRateLimited(true);
      toast({ title: "Lookup failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  const openMatched = () => {
    if (!result?.matched_chassis) return;
    if (onOpenChassis) {
      onOpenChassis(result.matched_chassis.slug, result.matched_chassis.chassis_display_name);
    } else {
      navigate(`/chassis/${result.matched_chassis.slug}`);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="bg-card rounded-xl border shadow-sm p-5 sm:p-6 mb-4">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono tracking-wider">Chassis number (VIN)</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="e.g. MAT445123CA123456"
            className="flex-1 h-12 text-base sm:text-lg font-mono tracking-wider uppercase"
            data-testid="input-vin"
          />
          <Button type="submit" size="lg" className="h-12 px-6" disabled={loading || !vin.trim()} data-testid="btn-vin-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Matching…" : "Match"}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Direct catalog match — we compare against every Tata chassis code in our catalog.</p>
      </form>

      {!result && !loading && !rateLimited && (
        <EmptyHelp title="Search by chassis number" body="17-character VIN found on the chassis stamp or RC book. We'll match it against every chassis code we stock." />
      )}
      {loading && <SkeletonMatchCard />}
      {rateLimited && <RateLimitCard />}
      {result && result.ok && result.matched_chassis && (
        <MatchedCard
          reg={null}
          chassisNumber={result.chassis_number || null}
          matched={result.matched_chassis}
          onView={openMatched}
          ctaLabel={isEmbeddedWizard ? "Browse parts for this chassis" : "View all parts for this chassis"}
        />
      )}
      {result && result.ok && !result.matched_chassis && <UnmatchedCard chassisNumber={result.chassis_number || null} />}
      {result && !result.ok && <FailCard message={result.message || result.error || null} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── Model browse tab */
function ModelTab({ isEmbeddedWizard, onAddToCart, addedPartIds }: FindPartsEmbedProps) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ChassisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedChassis, setSelectedChassis] = useState<ChassisRow | null>(null);
  const [parts, setParts] = useState<AddablePart[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);

  const load = async (query: string) => {
    setLoading(true);
    try {
      const url = query ? `/api/chassis?q=${encodeURIComponent(query)}` : `/api/chassis`;
      const r = await apiRequest("GET", url);
      const data = await r.json();
      setRows(Array.isArray(data) ? data : (data.results || []));
    } catch (e: any) {
      toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(""); }, []);

  const openChassis = async (c: ChassisRow) => {
    setSelectedChassis(c);
    setParts([]);
    setLoadingParts(true);
    try {
      // The parts-search endpoint accepts a chassis slug filter; fall back to
      // a client-side filter if not supported.
      const r = await apiRequest("GET", `/api/parts/search?chassis=${encodeURIComponent(c.slug)}&limit=60`);
      const data = await r.json();
      setParts((data.results || []).map((p: any) => ({
        ...p,
        fits_chassis: p.fits_chassis || { id: c.id, slug: c.slug, display_name: c.chassis_display_name },
      })));
    } catch (e: any) {
      toast({ title: "Could not load parts", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoadingParts(false); }
  };

  if (selectedChassis) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <button
              onClick={() => { setSelectedChassis(null); setParts([]); }}
              className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1 mb-1"
              data-testid="btn-back-to-chassis-list"
            >
              ← Back to all chassis
            </button>
            <div className="text-lg font-bold text-slate-900">{selectedChassis.chassis_display_name}</div>
            <div className="text-xs font-mono uppercase text-slate-500">{selectedChassis.chassis_code}</div>
          </div>
          <Badge variant="secondary">{parts.length} parts</Badge>
        </div>
        <PartsGrid
          parts={parts}
          loading={loadingParts}
          isEmbeddedWizard={!!isEmbeddedWizard}
          onAddToCart={onAddToCart}
          addedPartIds={addedPartIds}
          emptyMessage="No parts catalogued yet for this chassis. Try Part-Number search, or add manually below."
        />
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); load(q); }} className="bg-card rounded-xl border shadow-sm p-5 sm:p-6 mb-4">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono tracking-wider">Search model / variant / code</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 407, LPT, EX2, BS6" className="flex-1 h-12 text-base sm:text-lg" data-testid="input-model" />
          <Button type="submit" size="lg" className="h-12 px-6" disabled={loading} data-testid="btn-model-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Loading…" : "Search"}
          </Button>
        </div>
      </form>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      )}
      {!loading && rows.length === 0 && (
        <EmptyHelp title="No chassis found" body="Try a broader search — e.g. just 'LPT' or '407'." />
      )}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((c) => (
            <button
              key={c.id}
              onClick={() => openChassis(c)}
              className="text-left bg-card rounded-xl border shadow-sm p-4 hover:border-indigo-400 hover:shadow-md transition-all"
              data-testid={`chassis-card-${c.slug}`}
            >
              <div className="font-semibold text-slate-900">{c.chassis_display_name}</div>
              <div className="text-xs text-slate-500 font-mono uppercase mt-1">{c.chassis_code}</div>
              {(c.model || c.variant) && <div className="text-xs text-slate-500 mt-1">{[c.make, c.model, c.variant].filter(Boolean).join(" · ")}</div>}
              {isRepresentationalImage(c.image_source) && (
                <div className="text-[10px] text-amber-700 mt-2">Representative image — actual part may differ</div>
              )}
              <div className="mt-3 text-xs text-indigo-600 inline-flex items-center gap-1 font-semibold">View parts <ArrowRight className="w-3 h-3" /></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────── Part-number tab */
function PartTab({ isEmbeddedWizard, onAddToCart, addedPartIds }: FindPartsEmbedProps) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AddablePart[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = q.trim();
    if (cleaned.length < 2) return;
    setLoading(true); setSearched(true);
    try {
      const r = await apiRequest("GET", `/api/parts/search?q=${encodeURIComponent(cleaned)}&limit=30`);
      const data = await r.json();
      setRows(data.results || []);
      setTotal(data.total || (data.results?.length ?? 0));
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div>
      <form onSubmit={submit} className="bg-card rounded-xl border shadow-sm p-5 sm:p-6 mb-4">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono tracking-wider">Part number, OEM number or description</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 251434100121 or brake pad" className="flex-1 h-12 text-base sm:text-lg font-mono" data-testid="input-part" />
          <Button type="submit" size="lg" className="h-12 px-6" disabled={loading || q.trim().length < 2} data-testid="btn-part-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Searches across every chassis in the catalog. Each result shows which chassis it fits.</p>
      </form>

      {!searched && !loading && (
        <EmptyHelp title="Search by part number" body="Type any part number, OEM cross-reference, or a plain-English description like &quot;brake pad&quot;." />
      )}
      {rows.length > 0 && (
        <div className="text-xs text-slate-500 mb-2">Showing {rows.length} of {total} matches</div>
      )}
      <PartsGrid
        parts={rows}
        loading={loading}
        isEmbeddedWizard={!!isEmbeddedWizard}
        onAddToCart={onAddToCart}
        addedPartIds={addedPartIds}
        emptyMessage={searched && !loading ? `No parts found for "${q}". Try another tab or add manually below.` : ""}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── Parts grid */
function PartsGrid({ parts, loading, isEmbeddedWizard, onAddToCart, addedPartIds, emptyMessage }: {
  parts: AddablePart[];
  loading: boolean;
  isEmbeddedWizard: boolean;
  onAddToCart: (p: AddablePart) => void;
  addedPartIds?: Set<number>;
  emptyMessage: string;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }
  if (parts.length === 0 && emptyMessage) {
    return <EmptyHelp title="No matches" body={emptyMessage} />;
  }
  if (parts.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {parts.map((p) => (
        <PartCard
          key={p.part_id}
          part={p}
          isEmbeddedWizard={isEmbeddedWizard}
          onAdd={onAddToCart}
          added={!!addedPartIds?.has(p.part_id)}
        />
      ))}
    </div>
  );
}

function PartCard({ part, isEmbeddedWizard, onAdd, added }: { part: AddablePart; isEmbeddedWizard: boolean; onAdd: (p: AddablePart) => void; added: boolean }) {
  const [imgOk, setImgOk] = useState(!!part.image_url);
  const showPrice = !isEmbeddedWizard && part.sell_price != null && part.sell_price > 0;
  return (
    <div className="bg-card rounded-xl border shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow" data-testid={`part-card-${part.part_id}`}>
      <div className="flex gap-3">
        <div className="h-16 w-16 rounded-md bg-slate-100 shrink-0 flex items-center justify-center overflow-hidden">
          {part.image_url && imgOk ? (
            <img src={part.image_url} alt={part.description || part.part_number} className="h-full w-full object-contain" onError={() => setImgOk(false)} />
          ) : (
            <ImageOff className="h-5 w-5 text-slate-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm font-bold text-slate-900 truncate">{part.part_number}</div>
          {part.oem_number && <div className="font-mono text-[11px] text-slate-500 truncate">OEM {part.oem_number}</div>}
          <div className="text-xs text-slate-700 mt-1 line-clamp-2">{part.description || "—"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {part.category && <Badge variant="secondary" className="text-[10px] font-mono uppercase">{part.category}</Badge>}
          {part.stock_qty != null && part.stock_qty > 0 && (
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">In stock</Badge>
          )}
          {isRepresentationalImage(part.image_source) && (
            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">Rep. image</Badge>
          )}
        </div>
        {showPrice && <div className="text-sm font-bold text-slate-900">{formatINR(part.sell_price!)}</div>}
      </div>
      {part.fits_chassis && (
        <div className="text-[11px] text-slate-500 truncate">
          Fits: <Link href={`/chassis/${part.fits_chassis.slug}`}><a className="text-indigo-600 hover:underline">{part.fits_chassis.display_name}</a></Link>
        </div>
      )}
      <Button
        onClick={() => onAdd(part)}
        size="sm"
        className={`w-full font-semibold ${added ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
        data-testid={`btn-add-${part.part_id}`}
      >
        {added ? <><CheckCircle2 className="w-4 h-4 mr-2" /> {isEmbeddedWizard ? "Add again" : "Added — add again"}</> : <><Plus className="w-4 h-4 mr-2" /> {isEmbeddedWizard ? "Add to quote" : "Add to Cart"}</>}
      </Button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Shared cards */
function MatchedCard({ reg, chassisNumber, matched, onView, ctaLabel }: { reg: string | null; chassisNumber: string | null; matched: { id: number; slug: string; chassis_display_name: string }; onView: () => void; ctaLabel: string }) {
  return (
    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 space-y-3" data-testid="card-matched">
      <div className="text-xs text-emerald-700 font-mono uppercase tracking-wider">Chassis matched</div>
      <div className="text-2xl font-bold text-emerald-900">{matched.chassis_display_name}</div>
      {reg && <div className="text-sm text-emerald-800 font-mono">Reg: {reg}</div>}
      {chassisNumber && <div className="text-sm text-emerald-800 font-mono">Chassis #: {chassisNumber}</div>}
      <Button onClick={onView} data-testid="btn-view-parts">
        {ctaLabel} <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}
function UnmatchedCard({ chassisNumber }: { chassisNumber: string | null }) {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-6 space-y-3">
      <div className="font-medium text-amber-900">
        We couldn't match {chassisNumber ? `chassis ${chassisNumber}` : "your vehicle"} to our catalog yet.
      </div>
      <div className="text-sm text-amber-800">Contact us on WhatsApp — we'll help you find the right parts.</div>
      <a href={waLink(NARMADA_WA_NUMBER, `Hi, I need parts for ${chassisNumber || "my vehicle"}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm">
        <MessageCircle className="w-4 h-4" /> WhatsApp us
      </a>
    </div>
  );
}
function ComingSoonCard() {
  return (
    <div className="rounded-xl bg-slate-100 border border-slate-200 p-6 text-center">
      <div className="text-lg font-medium text-slate-800">Registration lookup is temporarily off</div>
      <div className="text-sm text-slate-500 mt-1">Try the Chassis Number or Model tab, or WhatsApp us.</div>
    </div>
  );
}
function RateLimitCard() {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-6 text-center">
      <div className="text-lg font-medium text-amber-900">Too many lookups from your network</div>
      <div className="text-sm text-amber-700 mt-1">Please try again in about an hour, or reach out on WhatsApp.</div>
    </div>
  );
}
function FailCard({ message }: { message: string | null }) {
  return (
    <div className="rounded-xl bg-red-50 border border-red-200 p-6">
      <div className="font-medium text-red-800">Sorry, we couldn't complete the lookup.</div>
      <div className="text-sm text-red-600 mt-1">{message || "Please try again in a moment."}</div>
    </div>
  );
}
function EmptyHelp({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      <div className="text-sm text-slate-600 mt-1 max-w-md mx-auto">{body}</div>
    </div>
  );
}
function SkeletonMatchCard() {
  return <Skeleton className="h-40 w-full rounded-xl" />;
}

