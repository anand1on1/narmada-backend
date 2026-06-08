import { useState } from "react";
import { SeoHead } from "@/components/SeoHead";
import { apiUrl } from "@/lib/queryClient";
import { Search, Truck, MapPin, Calendar, Package, FileText, MessageCircle, CheckCircle2, Clock, AlertCircle } from "lucide-react";

const WHATSAPP = "917909083806";

interface TrackResult {
  docketNumber: string;
  carrier: string | null;
  origin: string;
  destination: string;
  bundlesCount: number | null;
  status: "pending" | "in_transit" | "out_for_delivery" | "delivered" | "cancelled";
  dispatchDate: string | null;
  etaDate: string | null;
  deliveredDate: string | null;
  invoiceNumber: string | null;
}

const STEPS = [
  { key: "pending", label: "Booked" },
  { key: "in_transit", label: "In Transit" },
  { key: "out_for_delivery", label: "Out for Delivery" },
  { key: "delivered", label: "Delivered" },
];

export default function TrackConsignment() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function track() {
    if (!q.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const r = await fetch(apiUrl(`/api/track/${encodeURIComponent(q.trim())}`));
      if (!r.ok) {
        if (r.status === 404) setError("notfound");
        else setError("server");
      } else {
        setData(await r.json());
      }
    } catch { setError("network"); }
    finally { setLoading(false); }
  }

  const activeIdx = data ? STEPS.findIndex((s) => s.key === data.status) : -1;
  const isCancelled = data?.status === "cancelled";

  return (
    <>
      <SeoHead
        title="Track Your Consignment — Narmada Mobility"
        description="Track your Narmada Mobility spare parts consignment in real time. Enter your docket number to see status, origin, destination, ETA and delivery confirmation."
        keywords="track consignment, narmada mobility shipping, spare parts delivery tracking, docket number lookup"
      />

      <section className="relative surface-obsidian text-foreground py-14 lg:py-20 overflow-hidden border-b border-border">
        <div className="absolute inset-0 pattern-grid opacity-30" />
        <div className="container mx-auto px-4 relative">
          <span className="eyebrow inline-flex items-center gap-2 mb-4">
            <span className="signal-dot" /> Track Shipment
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight mb-4">
            Where's my <span className="text-gradient-cyan">consignment?</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-8">
            Enter the docket number from your invoice or WhatsApp confirmation to see live status, ETA and delivery details.
          </p>

          <div className="flex gap-2 max-w-xl flex-col sm:flex-row">
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && track()}
                placeholder="Enter docket number"
                className="w-full bg-background/80 backdrop-blur border-2 border-border focus:border-accent rounded-xl pl-12 pr-4 py-3.5 text-base font-mono outline-none uppercase"
                data-testid="input-docket"
              />
            </div>
            <button onClick={track} disabled={loading}
              className="px-6 py-3.5 bg-accent text-accent-foreground rounded-xl font-bold uppercase tracking-wider text-sm disabled:opacity-60"
              data-testid="button-track">
              {loading ? "Searching…" : "Track"}
            </button>
          </div>
        </div>
      </section>

      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          {error === "notfound" && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-8 text-center" data-testid="error-notfound">
              <AlertCircle className="w-10 h-10 mx-auto text-amber-700 mb-3" />
              <h3 className="font-display text-xl font-bold mb-2">Docket "{q}" not found</h3>
              <p className="text-sm text-muted-foreground mb-4">Please check the number and try again. It usually appears on your invoice or WhatsApp dispatch message. If you still can't locate it, our team is happy to help.</p>
              <a href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi, I'm trying to track docket number ${q} but it doesn't show up. Please help.`)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm">
                <MessageCircle className="w-4 h-4" /> Ask on WhatsApp
              </a>
            </div>
          )}
          {error === "server" || error === "network" ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center text-red-700 text-sm">
              Something went wrong. Please try again in a moment.
            </div>
          ) : null}

          {data && (
            <div className="space-y-6" data-testid="track-result">
              {/* Header card */}
              <div className="bg-card border rounded-2xl p-6 lg:p-8">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Docket Number</div>
                    <div className="font-mono text-2xl font-bold">{data.docketNumber}</div>
                    {data.carrier && <div className="text-sm text-muted-foreground mt-1">via {data.carrier}</div>}
                  </div>
                  <StatusBadge status={data.status} />
                </div>

                {/* Timeline */}
                {!isCancelled ? (
                  <div className="mt-6 mb-4">
                    <div className="flex items-center justify-between relative">
                      <div className="absolute top-3.5 left-0 right-0 h-0.5 bg-muted -z-0" />
                      <div className="absolute top-3.5 left-0 h-0.5 bg-emerald-500 -z-0 transition-all"
                        style={{ width: `${activeIdx >= 0 ? (activeIdx / (STEPS.length - 1)) * 100 : 0}%` }} />
                      {STEPS.map((s, i) => {
                        const done = i <= activeIdx;
                        return (
                          <div key={s.key} className="flex flex-col items-center gap-2 relative z-10">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border-2 border-card"}`}>
                              {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                            </div>
                            <span className={`text-[10px] uppercase tracking-wider font-bold text-center ${done ? "text-emerald-700" : "text-muted-foreground"}`}>{s.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-700 my-4">
                    This consignment has been cancelled. Contact us on WhatsApp for details.
                  </div>
                )}

                {/* Details grid */}
                <div className="grid sm:grid-cols-2 gap-3 mt-6">
                  <DetailRow icon={MapPin} label="Origin" value={data.origin} />
                  <DetailRow icon={MapPin} label="Destination" value={data.destination} />
                  {data.dispatchDate && <DetailRow icon={Calendar} label="Dispatched" value={new Date(data.dispatchDate).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })} />}
                  {data.etaDate && <DetailRow icon={Clock} label="ETA" value={new Date(data.etaDate).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })} />}
                  {data.deliveredDate && <DetailRow icon={CheckCircle2} label="Delivered" value={new Date(data.deliveredDate).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })} />}
                  {data.bundlesCount !== null && data.bundlesCount !== undefined && <DetailRow icon={Package} label="Bundles" value={String(data.bundlesCount)} />}
                  {data.invoiceNumber && <DetailRow icon={FileText} label="Invoice" value={data.invoiceNumber} />}
                </div>
              </div>

              <a href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi, regarding docket ${data.docketNumber} — `)}`}
                target="_blank" rel="noopener noreferrer"
                className="block bg-emerald-600 text-white rounded-xl p-5 hover:bg-emerald-700 transition text-center font-semibold"
                data-testid="button-whatsapp-docket">
                <MessageCircle className="w-4 h-4 inline-block mr-2" />
                Ask Narmada Mobility about this consignment
              </a>
            </div>
          )}

          {!data && !error && !loading && (
            <div className="text-center py-16 text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>Enter a docket number above to see its current status.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function StatusBadge({ status }: { status: TrackResult["status"] }) {
  const map: Record<TrackResult["status"], { label: string; cls: string }> = {
    pending: { label: "Booked", cls: "bg-slate-500/15 text-slate-700" },
    in_transit: { label: "In Transit", cls: "bg-blue-500/15 text-blue-700" },
    out_for_delivery: { label: "Out for Delivery", cls: "bg-amber-500/15 text-amber-700" },
    delivered: { label: "Delivered", cls: "bg-emerald-500/15 text-emerald-700" },
    cancelled: { label: "Cancelled", cls: "bg-red-500/15 text-red-700" },
  };
  const m = map[status];
  return <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${m.cls}`}>{m.label}</span>;
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
      <Icon className="w-4 h-4 text-accent flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}
