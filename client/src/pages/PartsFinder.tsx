// R28 Session 2 — Parts Finder (public).
// Enter a vehicle registration number; backend looks it up in SurePass, maps to a chassis, and shows results.
// POST /api/parts-finder/lookup { reg_number }
// Public (no auth). Feature-gated: on 503 show "coming soon".
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MessageCircle, ArrowRight, ListChecks } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { waLink, NARMADA_WA_NUMBER, isFeatureDisabledError, isRateLimitedError } from "@/lib/r28-utils";

const RECENT_KEY = "narmada_recent_lookups";
const MAX_RECENT = 5;

interface LookupResult {
  ok: boolean;
  reg_number: string;
  chassis_number?: string | null;
  matched_chassis?: {
    id: number;
    chassis_display_name: string;
    slug: string;
  } | null;
  cached?: boolean;
  error?: string;
  message?: string;
}

function loadRecent(): string[] {
  try {
    const s = localStorage.getItem(RECENT_KEY);
    return s ? (JSON.parse(s) as string[]).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}
function saveRecent(reg: string) {
  try {
    const list = [reg, ...loadRecent().filter((r) => r !== reg)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

export default function PartsFinder() {
  const [reg, setReg] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [, navigate] = useLocation();

  useEffect(() => { setRecent(loadRecent()); }, []);

  const lookup = async (regNumber: string) => {
    const cleaned = regNumber.replace(/\s+/g, "").toUpperCase();
    if (!cleaned) return;
    setLoading(true);
    setResult(null);
    setFeatureDisabled(false);
    setRateLimited(false);
    try {
      const r = await apiRequest("POST", "/api/parts-finder/lookup", { reg_number: cleaned });
      const data: LookupResult = await r.json();
      setResult(data);
      saveRecent(cleaned);
      setRecent(loadRecent());
    } catch (e: any) {
      if (isFeatureDisabledError(e)) { setFeatureDisabled(true); return; }
      if (isRateLimitedError(e)) { setRateLimited(true); return; }
      toast({ title: "Lookup failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup(reg);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-8">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono uppercase mb-3">R28 · Parts Finder</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Find parts for your vehicle</h1>
          <p className="text-slate-600 mt-2 text-sm sm:text-base">Enter your vehicle registration number — we'll match it to a chassis and show every part we stock.</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 mb-6">
          <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Registration number</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={reg}
              onChange={(e) => setReg(e.target.value.toUpperCase())}
              placeholder="e.g. BR01AB1234"
              className="flex-1 h-12 text-base sm:text-lg font-mono tracking-wider uppercase"
              autoFocus
              data-testid="input-reg-number"
            />
            <Button type="submit" className="h-12 px-6" disabled={loading || !reg.trim()} data-testid="button-lookup">
              <Search className="w-4 h-4 mr-2" /> {loading ? "Looking up…" : "Search"}
            </Button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Powered by SurePass RC lookup. Up to 60 lookups per hour per network.</p>
        </form>

        {/* Feature disabled */}
        {featureDisabled && (
          <div className="rounded-xl bg-slate-100 border border-slate-200 p-6 text-center">
            <div className="text-lg font-medium text-slate-800">Parts Finder is coming soon</div>
            <div className="text-sm text-slate-500 mt-1">This feature is temporarily off. Meanwhile, message us on WhatsApp with your chassis number.</div>
            <a href={waLink(NARMADA_WA_NUMBER, "Hi, I need parts. My vehicle registration is:")} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-4 bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm">
              <MessageCircle className="w-4 h-4" /> WhatsApp us
            </a>
          </div>
        )}

        {/* Rate limited */}
        {rateLimited && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-6 text-center">
            <div className="text-lg font-medium text-amber-900">Too many lookups from your network</div>
            <div className="text-sm text-amber-700 mt-1">Please try again in about an hour, or reach out on WhatsApp for help.</div>
          </div>
        )}

        {/* Result */}
        {result && result.ok && result.matched_chassis && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 space-y-3">
            <div className="text-xs text-emerald-700 font-mono uppercase">Chassis matched</div>
            <div className="text-2xl font-bold text-emerald-900">{result.matched_chassis.chassis_display_name}</div>
            {result.chassis_number && <div className="text-sm text-emerald-800 font-mono">Chassis #: {result.chassis_number}</div>}
            <Button onClick={() => navigate(`/chassis/${result.matched_chassis!.slug}`)} data-testid="button-view-parts">
              View all parts for this chassis <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {result && result.ok && !result.matched_chassis && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-6 space-y-3">
            <div className="font-medium text-amber-900">
              We found your chassis {result.chassis_number ? `(${result.chassis_number})` : ""} but don't have parts loaded for it yet.
            </div>
            <div className="text-sm text-amber-800">Contact us on WhatsApp — we'll help you find the right parts.</div>
            <a href={waLink(NARMADA_WA_NUMBER, `Hi, I need parts for chassis ${result.chassis_number || result.reg_number}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm">
              <MessageCircle className="w-4 h-4" /> WhatsApp us
            </a>
          </div>
        )}

        {result && !result.ok && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6">
            <div className="font-medium text-red-800">Sorry, we couldn't complete the lookup.</div>
            <div className="text-sm text-red-600 mt-1">{result.message || result.error || "Please try again in a moment."}</div>
          </div>
        )}

        {/* Recent lookups */}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="text-xs uppercase text-slate-500 mb-2 font-mono">Recent lookups</div>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button
                  key={r}
                  onClick={() => { setReg(r); lookup(r); }}
                  className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-sm font-mono hover:border-indigo-300 hover:bg-indigo-50 transition"
                  data-testid={`chip-recent-${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 border-t pt-6 text-center">
          <Link href="/chassis"><a className="inline-flex items-center gap-2 text-indigo-600 text-sm font-medium">
            <ListChecks className="w-4 h-4" /> Or browse the full chassis catalog
          </a></Link>
        </div>
      </div>
    </div>
  );
}
