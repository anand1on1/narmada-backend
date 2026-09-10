// R28.2 — Unified public "Find Parts" page. Replaces PartsFinder + ChassisBrowse
// with one page that has four tabs. Old routes (/parts-finder, /chassis) still
// mount their original pages for backwards compatibility, but the sitewide nav
// and links point here.
//
// Tabs:
//   reg    — Registration number lookup (POST /api/parts-finder/lookup)
//   vin    — Chassis number direct match (POST /api/parts-finder/lookup-chassis)
//   model  — Browse chassis catalog (GET /api/chassis?q=)
//   part   — Search parts by number / oem / description (GET /api/parts/search)
//
// The active tab is driven by `?tab=` so links / redirects survive reload.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MessageCircle, ArrowRight, ListChecks, Package, Hash, Truck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { waLink, NARMADA_WA_NUMBER, isFeatureDisabledError, isRateLimitedError, isRepresentationalImage, formatINR } from "@/lib/r28-utils";
import { addToCart } from "@/lib/cart";

type TabId = "reg" | "vin" | "model" | "part";

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

interface PartSearchRow {
  part_id: number;
  part_number: string;
  oem_number?: string | null;
  description?: string | null;
  category?: string | null;
  sell_price?: number | null;
  stock_qty?: number | null;
  image_url?: string | null;
  fits_chassis: {
    id: number;
    slug: string;
    display_name: string;
    make?: string | null;
    model?: string | null;
  };
}

function readTabFromLocation(loc: string): TabId {
  try {
    const q = loc.split("?")[1] || "";
    const t = new URLSearchParams(q).get("tab") || "";
    if (t === "vin" || t === "model" || t === "part") return t;
  } catch { /* noop */ }
  return "reg";
}

export default function FindParts() {
  const [location, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>(readTabFromLocation(location));

  // Sync tab -> URL when user clicks a chip so links are shareable.
  const setTabAndSync = (t: TabId) => {
    setTab(t);
    navigate(`/find-parts?tab=${t}`, { replace: true });
  };

  // On mount and whenever location changes, re-derive tab from URL.
  useEffect(() => { setTab(readTabFromLocation(location)); }, [location]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="text-center mb-6">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono uppercase mb-3">R28.2 · Find Parts</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Find the right parts</h1>
          <p className="text-slate-600 mt-2 text-sm sm:text-base">Search by registration, chassis number, model, or part number — pick whichever you have.</p>
        </div>

        {/* Tab bar */}
        <div className="bg-white rounded-2xl shadow-sm border p-1.5 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-1" role="tablist">
          <TabButton id="reg"   active={tab === "reg"}   onClick={setTabAndSync} icon={<Hash className="w-4 h-4" />}    label="Registration"   />
          <TabButton id="vin"   active={tab === "vin"}   onClick={setTabAndSync} icon={<Truck className="w-4 h-4" />}   label="Chassis Number" />
          <TabButton id="model" active={tab === "model"} onClick={setTabAndSync} icon={<ListChecks className="w-4 h-4" />} label="Model"        />
          <TabButton id="part"  active={tab === "part"}  onClick={setTabAndSync} icon={<Package className="w-4 h-4" />} label="Part Number"    />
        </div>

        {tab === "reg"   && <RegTab   />}
        {tab === "vin"   && <VinTab   />}
        {tab === "model" && <ModelTab />}
        {tab === "part"  && <PartTab  />}

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

function TabButton({ id, active, onClick, icon, label }: { id: TabId; active: boolean; onClick: (t: TabId) => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-600 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100"
      }`}
      data-testid={`tab-${id}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------- Registration tab */
function RegTab() {
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

  return (
    <div>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 mb-6">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Registration number</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} placeholder="e.g. BR01AB1234" className="flex-1 h-12 text-base sm:text-lg font-mono tracking-wider uppercase" autoFocus data-testid="input-reg" />
          <Button type="submit" className="h-12 px-6" disabled={loading || !reg.trim()} data-testid="btn-reg-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Looking up…" : "Search"}
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Powered by SurePass RC lookup. Up to 60 lookups per hour per network.</p>
      </form>

      {featureDisabled && <ComingSoonCard />}
      {rateLimited && <RateLimitCard />}
      {result && result.ok && result.matched_chassis && (
        <MatchedCard reg={result.reg_number || null} chassisNumber={result.chassis_number || null} matched={result.matched_chassis} onView={() => navigate(`/chassis/${result.matched_chassis!.slug}`)} />
      )}
      {result && result.ok && !result.matched_chassis && (
        <UnmatchedCard chassisNumber={result.chassis_number || result.reg_number || null} />
      )}
      {result && !result.ok && <FailCard message={result.message || result.error || null} />}
    </div>
  );
}

/* -------------------------------------------------------------- VIN / chassis tab */
function VinTab() {
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

  return (
    <div>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 mb-6">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Chassis number (VIN)</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="e.g. MAT445123CA123456" className="flex-1 h-12 text-base sm:text-lg font-mono tracking-wider uppercase" autoFocus data-testid="input-vin" />
          <Button type="submit" className="h-12 px-6" disabled={loading || !vin.trim()} data-testid="btn-vin-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Matching…" : "Match"}
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Direct catalog match — we compare against every Tata chassis code in our catalog.</p>
      </form>

      {rateLimited && <RateLimitCard />}
      {result && result.ok && result.matched_chassis && (
        <MatchedCard reg={null} chassisNumber={result.chassis_number || null} matched={result.matched_chassis} onView={() => navigate(`/chassis/${result.matched_chassis!.slug}`)} />
      )}
      {result && result.ok && !result.matched_chassis && <UnmatchedCard chassisNumber={result.chassis_number || null} />}
      {result && !result.ok && <FailCard message={result.message || result.error || null} />}
    </div>
  );
}

/* -------------------------------------------------------------- Model browse tab */
function ModelTab() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ChassisRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); load(q); }} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 mb-6">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Search model / variant / code</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 407, LPT, EX2, BS6" className="flex-1 h-12 text-base sm:text-lg" data-testid="input-model" />
          <Button type="submit" className="h-12 px-6" disabled={loading} data-testid="btn-model-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Loading…" : "Search"}
          </Button>
        </div>
      </form>

      {loading && <div className="text-slate-500 text-sm text-center py-6">Loading chassis…</div>}
      {!loading && rows.length === 0 && <div className="text-slate-500 text-sm text-center py-6">No chassis found. Try a different search.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((c) => (
          <Link key={c.id} href={`/chassis/${c.slug}`}>
            <a className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-400 hover:shadow-sm transition-all" data-testid={`chassis-card-${c.slug}`}>
              <div className="font-semibold text-slate-900">{c.chassis_display_name}</div>
              <div className="text-xs text-slate-500 font-mono uppercase mt-1">{c.chassis_code}</div>
              {(c.model || c.variant) && <div className="text-xs text-slate-500 mt-1">{[c.make, c.model, c.variant].filter(Boolean).join(" · ")}</div>}
              {isRepresentationalImage(c.image_source) && (
                <div className="text-[10px] text-amber-700 mt-2">Representative image — actual part may differ</div>
              )}
              <div className="mt-3 text-xs text-indigo-600 inline-flex items-center gap-1">View parts <ArrowRight className="w-3 h-3" /></div>
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Part number tab */
function PartTab() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PartSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = q.trim();
    if (cleaned.length < 2) return;
    setLoading(true);
    try {
      const r = await apiRequest("GET", `/api/parts/search?q=${encodeURIComponent(cleaned)}`);
      const data = await r.json();
      setRows(data.results || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  const onAdd = (p: PartSearchRow) => {
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
    <div>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 mb-6">
        <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Part number, OEM number or description</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 251434100121 or brake pad" className="flex-1 h-12 text-base sm:text-lg font-mono" data-testid="input-part" />
          <Button type="submit" className="h-12 px-6" disabled={loading || q.trim().length < 2} data-testid="btn-part-search">
            <Search className="w-4 h-4 mr-2" /> {loading ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Searches across every chassis in the catalog. Each result shows which chassis it fits.</p>
      </form>

      {loading && <div className="text-slate-500 text-sm text-center py-6">Searching…</div>}
      {!loading && rows.length === 0 && q.trim().length >= 2 && (
        <div className="text-slate-500 text-sm text-center py-6">No parts matched "{q}". Try a different query or WhatsApp us.</div>
      )}
      {rows.length > 0 && (
        <div className="text-xs text-slate-500 mb-2">Showing {rows.length} of {total} matches</div>
      )}
      <div className="grid grid-cols-1 gap-3">
        {rows.map((p) => (
          <div key={p.part_id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-4" data-testid={`part-row-${p.part_id}`}>
            <div className="flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono font-semibold text-slate-900">{p.part_number}</span>
                {p.oem_number && <span className="text-xs text-slate-500 font-mono">OEM {p.oem_number}</span>}
                {p.category && <span className="text-[10px] uppercase font-mono text-slate-400">· {p.category}</span>}
              </div>
              <div className="text-sm text-slate-700 mt-1">{p.description || "—"}</div>
              <div className="mt-2 text-xs text-slate-500">
                Fits: <Link href={`/chassis/${p.fits_chassis.slug}`}><a className="text-indigo-600 hover:underline" data-testid={`part-fits-${p.part_id}`}>{p.fits_chassis.display_name}</a></Link>
              </div>
            </div>
            <div className="flex sm:flex-col items-end sm:items-end justify-between gap-2 sm:min-w-[120px]">
              {p.sell_price != null && p.sell_price > 0 && (
                <div className="text-slate-900 font-semibold">{formatINR(p.sell_price)}</div>
              )}
              <Button size="sm" onClick={() => onAdd(p)} data-testid={`btn-add-${p.part_id}`}>Add to Cart</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Shared cards */
function MatchedCard({ reg, chassisNumber, matched, onView }: { reg: string | null; chassisNumber: string | null; matched: { id: number; slug: string; chassis_display_name: string }; onView: () => void }) {
  return (
    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 space-y-3" data-testid="card-matched">
      <div className="text-xs text-emerald-700 font-mono uppercase">Chassis matched</div>
      <div className="text-2xl font-bold text-emerald-900">{matched.chassis_display_name}</div>
      {reg && <div className="text-sm text-emerald-800 font-mono">Reg: {reg}</div>}
      {chassisNumber && <div className="text-sm text-emerald-800 font-mono">Chassis #: {chassisNumber}</div>}
      <Button onClick={onView} data-testid="btn-view-parts">
        View all parts for this chassis <ArrowRight className="w-4 h-4 ml-2" />
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
