import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Send, Plus, Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RFQ { id: number; rfqNumber: string; status: string; createdAt: number; }
interface Vendor { id: number; name: string; phone: string | null; city: string | null; }
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-700",
  sent: "bg-blue-500/15 text-blue-700",
  closed: "bg-emerald-500/15 text-emerald-700",
};

function fmt(d: number) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TeamRFQs() {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [showNew, setShowNew] = useState(false);

  const { data: rfqs = [] } = useQuery<RFQ[]>({
    queryKey: ["team-rfqs"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/rfqs`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  return (
    <TeamLayout title="RFQs (Vendor Quotes)">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New RFQ
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {rfqs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No RFQs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-3 font-semibold">RFQ Number</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Created</th>
                <th className="px-3 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rfqs.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3 font-semibold">{r.rfqNumber}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[r.status] || "bg-muted"}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/team/rfqs/${r.id}`}>
                      <a className="text-accent font-semibold inline-flex items-center gap-1 hover:underline">
                        <Send className="w-4 h-4" /> Open
                      </a>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewRFQModal
          token={token}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ["team-rfqs"] });
            setShowNew(false);
            navigate(`/team/rfqs/${id}`);
          }}
          toast={toast}
        />
      )}
    </TeamLayout>
  );
}

interface NewRFQModalProps {
  token: string | null;
  onClose: () => void;
  onCreated: (id: number) => void;
  toast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}

function NewRFQModal({ token, onClose, onCreated, toast }: NewRFQModalProps) {
  const [notes, setNotes] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<any[]>([]);
  const [selectedParts, setSelectedParts] = useState<Array<{ partNumber: string; description: string; qty: number; brand: string }>>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorResults, setVendorResults] = useState<Vendor[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<Vendor[]>([]);
  const [busy, setBusy] = useState(false);

  async function searchParts() {
    if (!token || partSearch.length < 3) return;
    try {
      const r = await teamFetch(token, `/api/team/parts?q=${encodeURIComponent(partSearch)}`);
      if (r.ok) setPartResults(await r.json());
    } catch {}
  }

  async function searchVendors() {
    if (!token || vendorSearch.length < 2) return;
    try {
      const r = await teamFetch(token, `/api/team/vendors?q=${encodeURIComponent(vendorSearch)}`);
      if (r.ok) {
        const d = await r.json();
        setVendorResults(Array.isArray(d) ? d : d.vendors || []);
      }
    } catch {}
  }

  function addPart(p: any) {
    if (selectedParts.find((x) => x.partNumber === p.partNumber)) return;
    setSelectedParts([...selectedParts, { partNumber: p.partNumber, description: p.description || "", qty: 1, brand: p.brand || "" }]);
    setPartResults([]);
    setPartSearch("");
  }

  function addVendor(v: Vendor) {
    if (selectedVendors.find((x) => x.id === v.id)) return;
    setSelectedVendors([...selectedVendors, v]);
    setVendorResults([]);
    setVendorSearch("");
  }

  async function submit() {
    if (!token) return;
    if (selectedParts.length === 0) { toast({ title: "Add at least one part", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const r = await teamFetch(token, `/api/team/rfqs`, {
        method: "POST",
        body: JSON.stringify({
          notes,
          items: selectedParts.map((p) => ({
            partNumber: p.partNumber,
            description: p.description,
            brand: p.brand,
            qty: p.qty,
          })),
          vendorIds: selectedVendors.map((v) => v.id),
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast({ title: "Error", description: j.error || "Failed", variant: "destructive" }); return; }
      toast({ title: `RFQ ${j.rfqNumber} created` });
      onCreated(j.id);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-lg font-bold">New RFQ</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Parts */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Parts *</div>
            <div className="flex gap-2 mb-1">
              <input
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchParts()}
                placeholder="Type ≥3 chars of part number…"
                className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
              />
              <button type="button" onClick={searchParts} disabled={partSearch.length < 3}
                className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-1">
                <Search className="w-4 h-4" />
              </button>
            </div>
            {partResults.length > 0 && (
              <div className="border rounded-lg bg-background max-h-40 overflow-y-auto">
                {partResults.map((p: any, i: number) => (
                  <button key={i} type="button" onClick={() => addPart(p)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted text-xs border-b last:border-0">
                    <span className="font-mono font-semibold">{p.partNumber}</span>
                    {p.brand && <span className="ml-2 text-muted-foreground">{p.brand}</span>}
                    {p.description && <span className="ml-2 text-muted-foreground truncate">{p.description}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedParts.length > 0 && (
              <div className="border rounded-lg overflow-hidden mt-1">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Part #</th>
                      <th className="px-2 py-1.5 text-left">Brand</th>
                      <th className="px-2 py-1.5 text-right w-16">Qty</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedParts.map((p) => (
                      <tr key={p.partNumber}>
                        <td className="px-2 py-1 font-mono font-semibold">{p.partNumber}</td>
                        <td className="px-2 py-1 text-muted-foreground">{p.brand || "—"}</td>
                        <td className="px-2 py-1">
                          <input type="number" min={1} value={p.qty}
                            onChange={(e) => setSelectedParts(selectedParts.map((x) => x.partNumber === p.partNumber ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                            className="w-14 border rounded px-1 py-0.5 bg-background text-right" />
                        </td>
                        <td className="px-1">
                          <button type="button" onClick={() => setSelectedParts(selectedParts.filter((x) => x.partNumber !== p.partNumber))} className="text-red-500">
                            <X className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Vendors */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Sellers (optional)</div>
            <div className="flex gap-2 mb-1">
              <input
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchVendors()}
                placeholder="Search sellers by name…"
                className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
              />
              <button type="button" onClick={searchVendors} disabled={vendorSearch.length < 2}
                className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-1">
                <Search className="w-4 h-4" />
              </button>
            </div>
            {vendorResults.length > 0 && (
              <div className="border rounded-lg bg-background max-h-40 overflow-y-auto">
                {vendorResults.map((v) => (
                  <button key={v.id} type="button" onClick={() => addVendor(v)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted text-xs border-b last:border-0">
                    <span className="font-semibold">{v.name}</span>
                    {v.city && <span className="ml-2 text-muted-foreground">{v.city}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedVendors.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {selectedVendors.map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1 bg-muted rounded px-2 py-1 text-xs">
                    {v.name}
                    <button type="button" onClick={() => setSelectedVendors(selectedVendors.filter((x) => x.id !== v.id))} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes (optional)</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm"
              placeholder="Any special requirements…"
            />
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || selectedParts.length === 0}
            className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create RFQ"}
          </button>
        </div>
      </div>
    </div>
  );
}
