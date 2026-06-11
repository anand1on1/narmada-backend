import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, Plus, Send } from "lucide-react";

interface Candidate {
  name: string;
  city: string | null;
  phone: string | null;          // may be a raw string like "9810086222721777302098"
  phones?: string[] | null;      // array form if API returns it
  website: string | null;
  source_url: string | null;
  confidence: number;
}

/** Format phone field: could be an array joined without sep, or already an array */
function formatPhone(c: Candidate): string {
  // Prefer explicit phones array if present
  if (c.phones && c.phones.length > 0) {
    const clean = c.phones.map((p) => p.trim()).filter(Boolean);
    if (clean.length === 0) return "—";
    if (clean.length === 1) return clean[0];
    return clean[0] + ` +${clean.length - 1} more`;
  }
  // Fallback: single phone string
  if (!c.phone) return "—";
  const s = c.phone.trim();
  if (!s) return "—";
  // If it looks like multiple numbers glued together (>15 chars), split on 10-digit boundaries
  if (s.length > 15) {
    // Try to split on boundaries: Indian mobile = 10 digits, intl may have +91 prefix
    const parts = s.match(/(?:\+91[-\s]?)?[6-9]\d{9}/g);
    if (parts && parts.length > 1) {
      return parts[0] + ` +${parts.length - 1} more`;
    }
  }
  return s;
}

function phonesTooltip(c: Candidate): string {
  if (c.phones && c.phones.length > 1) return c.phones.join(", ");
  if (c.phone && c.phone.length > 15) {
    const parts = c.phone.match(/(?:\+91[-\s]?)?[6-9]\d{9}/g);
    if (parts) return parts.join(", ");
  }
  return c.phone || "";
}

export default function AdminVendorDiscovery() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [citations, setCitations] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showRFQModal, setShowRFQModal] = useState(false);

  const search = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendor-discovery`, {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      return d;
    },
    onSuccess: (d) => {
      setCandidates(d.candidates || []);
      setCitations(d.citations || []);
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addVendor = useMutation({
    mutationFn: async (c: Candidate) => {
      const phone = formatPhone(c) === "—" ? undefined : c.phone;
      const r = await adminFetch(token, `/api/admin/vendors`, {
        method: "POST",
        body: JSON.stringify({ name: c.name, city: c.city, phone, notes: c.website || undefined }),
      });
      if (!r.ok) throw new Error("Add failed");
    },
    onSuccess: () => toast({ title: "Vendor added" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function toggleSelect(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === candidates.length) setSelected(new Set());
    else setSelected(new Set(candidates.map((_, i) => i)));
  }

  const selectedCandidates = Array.from(selected).map((i) => candidates[i]);

  return (
    <AdminLayout title="AI Vendor Discovery">
      <div className="bg-card border rounded-xl p-5 shadow-sm mb-6">
        <p className="text-sm text-muted-foreground mb-3">
          Find new sellers / manufacturers via AI web search (Perplexity).
        </p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && search.mutate()}
            placeholder="e.g. brake pad manufacturers for Tata trucks in Delhi NCR"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
          />
          <button
            onClick={() => search.mutate()}
            disabled={!query.trim() || search.isPending}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
          </button>
        </div>
      </div>

      {candidates.length > 0 && (
        <>
          <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === candidates.length && candidates.length > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-3 font-semibold">Name</th>
                  <th className="px-3 py-3 font-semibold">City</th>
                  <th className="px-3 py-3 font-semibold">Phone</th>
                  <th className="px-3 py-3 font-semibold">Website</th>
                  <th className="px-3 py-3 font-semibold text-right">Conf.</th>
                  <th className="px-3 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {candidates.map((c, i) => {
                  const phone = formatPhone(c);
                  const allPhones = phonesTooltip(c);
                  return (
                    <tr key={i} className={`hover:bg-muted/30 ${selected.has(i) ? "bg-accent/5" : ""}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleSelect(i)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-3 font-semibold">{c.name}</td>
                      <td className="px-3 py-3">{c.city || "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        {allPhones && allPhones !== phone ? (
                          <span title={allPhones} className="cursor-help border-b border-dotted border-muted-foreground">
                            {phone}
                          </span>
                        ) : phone}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {c.website
                          ? <a href={c.website} target="_blank" rel="noreferrer" className="text-accent underline truncate block max-w-[150px]">{c.website}</a>
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-xs">
                        {c.confidence != null ? `${Math.round(c.confidence * 100)}%` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => addVendor.mutate(c)}
                          className="px-2.5 py-1 border rounded text-xs font-semibold inline-flex items-center gap-1 hover:bg-muted"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.size > 0 && (
            <div className="mt-3 flex items-center gap-3 p-3 bg-accent/10 border border-accent/30 rounded-xl">
              <span className="text-sm font-semibold">{selected.size} vendor{selected.size > 1 ? "s" : ""} selected</span>
              <button
                onClick={() => setShowRFQModal(true)}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2"
              >
                <Send className="w-4 h-4" /> Send RFQ to Selected
              </button>
            </div>
          )}
        </>
      )}

      {citations.length > 0 && (
        <div className="mt-4 text-xs text-muted-foreground">
          <div className="font-semibold mb-1">Sources:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {citations.map((c, i) => (
              <li key={i}><a href={c} target="_blank" rel="noreferrer" className="underline">{c}</a></li>
            ))}
          </ul>
        </div>
      )}

      {showRFQModal && (
        <DiscoveryRFQModal
          vendors={selectedCandidates}
          token={token}
          onClose={() => setShowRFQModal(false)}
          toast={toast}
        />
      )}
    </AdminLayout>
  );
}

interface DiscoveryRFQModalProps {
  vendors: Candidate[];
  token: string | null;
  onClose: () => void;
  toast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}

function DiscoveryRFQModal({ vendors, token, onClose, toast }: DiscoveryRFQModalProps) {
  const [notes, setNotes] = useState(
    `Vendor candidates from AI discovery:\n${vendors.map((v) => `- ${v.name}${v.city ? ` (${v.city})` : ""}${v.phone ? ` — ${v.phone}` : ""}`).join("\n")}`
  );
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<any[]>([]);
  const [selectedParts, setSelectedParts] = useState<Array<{ partNumber: string; description: string; qty: number }>>([]);
  const [busy, setBusy] = useState(false);

  async function searchParts() {
    if (!token || partSearch.length < 3) return;
    try {
      const r = await adminFetch(token, `/api/team/parts?q=${encodeURIComponent(partSearch)}`);
      if (r.ok) setPartResults(await r.json());
    } catch {}
  }

  function addPart(p: any) {
    if (selectedParts.find((x) => x.partNumber === p.partNumber)) return;
    setSelectedParts([...selectedParts, { partNumber: p.partNumber, description: p.description || "", qty: 1 }]);
    setPartResults([]);
    setPartSearch("");
  }

  async function submit() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/rfqs`, {
        method: "POST",
        body: JSON.stringify({
          items: JSON.stringify(selectedParts.map((p) => ({ partNumber: p.partNumber, description: p.description, quantity: p.qty }))),
          notes,
          status: "open",
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast({ title: "Error", description: j.error || "Failed", variant: "destructive" }); return; }
      toast({ title: "RFQ created", description: `RFQ #${j.id} created with discovered vendors in notes` });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-lg font-bold">Send RFQ to {vendors.length} Discovered Vendor{vendors.length > 1 ? "s" : ""}</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded text-sm">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            These vendors are not yet in your system. An RFQ will be created with vendor details captured in notes for your team to follow up manually.
          </div>

          <label className="block text-sm">
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Search & Add Parts</div>
            <div className="flex gap-2">
              <input
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchParts()}
                placeholder="Type ≥3 chars…"
                className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
              />
              <button type="button" onClick={searchParts} disabled={partSearch.length < 3}
                className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50">
                Search
              </button>
            </div>
            {partResults.length > 0 && (
              <div className="border rounded-lg mt-1 bg-background max-h-40 overflow-y-auto">
                {partResults.map((p: any, i: number) => (
                  <button key={i} type="button" onClick={() => addPart(p)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted text-xs border-b last:border-0 font-mono">
                    {p.partNumber} {p.brand && `— ${p.brand}`}
                  </button>
                ))}
              </div>
            )}
            {selectedParts.length > 0 && (
              <div className="mt-2 space-y-1">
                {selectedParts.map((p) => (
                  <div key={p.partNumber} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1">
                    <span className="font-mono font-semibold flex-1">{p.partNumber}</span>
                    <input type="number" min={1} value={p.qty}
                      onChange={(e) => setSelectedParts(selectedParts.map((x) => x.partNumber === p.partNumber ? { ...x, qty: parseInt(e.target.value) || 1 } : x))}
                      className="w-14 border rounded px-1 py-0.5 text-right bg-background"
                    />
                    <button type="button" onClick={() => setSelectedParts(selectedParts.filter((x) => x.partNumber !== p.partNumber))} className="text-red-500">✕</button>
                  </div>
                ))}
              </div>
            )}
          </label>

          <label className="block text-sm">
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes / Vendor Details</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              className="w-full border rounded-lg px-3 py-2 bg-background text-sm font-mono"
            />
          </label>
        </div>
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? "Creating…" : "Create RFQ"}
          </button>
        </div>
      </div>
    </div>
  );
}
