/**
 * R9/R11 — Multi-seller RFQ quotes, embedded chat approval, global Sonar search,
 * confirm/lock tick, flat Fire Rate Request modal.
 * Lightweight inline UI (matches the existing TeamPOEdit Tailwind style).
 * "Seller" wording throughout (per project convention).
 */
import { useState } from "react";
import { teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Loader2, Check, X, MessageSquare, Pencil, Send, ChevronRight,
  Globe, Sparkles, Lock, Phone, ExternalLink, ArrowLeft,
} from "lucide-react";

export interface Quote {
  id: number;
  po_item_id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  rate: number | null;
  tax_inclusive: number | null;
  tax_percent: number | null;
  status: "requested" | "received" | "approved" | "rejected" | "manual";
  source?: string | null;
  requested_at: number;
  approved_at: number | null;
  notes: string | null;
}

interface VendorMin { id: number; name: string; phone?: string | null; whatsapp?: string | null; }

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800 border-amber-200",
  received: "bg-blue-100 text-blue-800 border-blue-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  manual: "bg-violet-100 text-violet-800 border-violet-200",
};
const STATUS_LABEL: Record<string, string> = {
  requested: "Requested", received: "Received", approved: "Approved",
  rejected: "Rejected", manual: "Manual",
};

// ─────────────────────────────────────────────
// Per-line multi-seller quote panel
// ─────────────────────────────────────────────
export function LineQuotesPanel({
  itemId,
  itemContext,
  vendors,
  token,
  onChanged,
}: {
  itemId: number;
  itemContext: string;
  vendors: VendorMin[];
  token: string | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  // "+ Add new seller" mode toggles between DB-dropdown view and free-text view.
  const [addMode, setAddMode] = useState<"db" | "new">("db");
  const [pickVendorId, setPickVendorId] = useState("");
  const [freeName, setFreeName] = useState("");
  const [freePhone, setFreePhone] = useState("");
  const [manualFor, setManualFor] = useState<number | null>(null);
  const [chatVendor, setChatVendor] = useState<{ vendorId: number; name: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [confirmFor, setConfirmFor] = useState<Quote | null>(null);

  const { data: quotes = [], refetch } = useQuery<Quote[]>({
    queryKey: ["line-quotes", itemId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  const approved = quotes.find((q) => q.status === "approved");
  const pickedVendor = pickVendorId ? vendors.find((v) => String(v.id) === pickVendorId) : null;
  const pickedPhone = pickedVendor ? (pickedVendor.whatsapp || pickedVendor.phone || "") : "";

  function resetAdd() {
    setAdding(false); setAddMode("db"); setPickVendorId(""); setFreeName(""); setFreePhone("");
  }

  const addVendor = useMutation({
    mutationFn: async () => {
      const body = addMode === "db"
        ? { vendor_id: Number(pickVendorId) }
        : { vendor_name: freeName.trim() || undefined, vendor_phone: freePhone.trim() || undefined, source: "manual" };
      if (addMode === "db" && !pickVendorId) throw new Error("Pick a seller");
      if (addMode === "new" && !freeName.trim()) throw new Error("Type a seller name");
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
    },
    onSuccess: () => {
      resetAdd();
      refetch(); onChanged();
      toast({ title: "Seller added to line" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeQuote = useMutation({
    mutationFn: async (quoteId: number) => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes/${quoteId}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
    },
    onSuccess: () => { refetch(); onChanged(); toast({ title: "Seller removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmLock = useMutation({
    mutationFn: async (q: Quote) => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes/${q.id}/approve`, { method: "POST" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Approve failed"); }
    },
    onSuccess: () => { setConfirmFor(null); refetch(); onChanged(); toast({ title: "Vendor locked for this item" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unapprove = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/unapprove`, { method: "POST" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { refetch(); onChanged(); toast({ title: "Lock cleared" }); },
  });

  return (
    <div className="mt-2">
      {approved && (
        <div className="mb-2 inline-flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span className="font-semibold">Locked:</span> {approved.vendor_name || "Seller"}
          {approved.rate != null && <span>· ₹{approved.rate.toLocaleString("en-IN")}</span>}
          <button onClick={() => unapprove.mutate()} className="ml-1 underline hover:no-underline">unlock</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {quotes.map((q) => {
          const isApproved = q.status === "approved";
          const canTick = q.rate != null && !isApproved;
          return (
            <span
              key={q.id}
              className={`inline-flex items-center gap-1.5 text-xs border rounded-full pl-2.5 pr-1 py-0.5 ${STATUS_STYLE[q.status] || ""}`}
            >
              <button
                onClick={() => q.vendor_id && setChatVendor({ vendorId: q.vendor_id, name: q.vendor_name || "Seller" })}
                className="font-semibold inline-flex items-center gap-1 hover:underline disabled:no-underline"
                disabled={!q.vendor_id}
                title={q.vendor_id ? "Open chat" : "One-off seller (no chat)"}
              >
                {q.vendor_id && <MessageSquare className="w-3 h-3" />}
                {q.vendor_name || "Seller"}
              </button>
              {q.source === "global" && <span className="opacity-60 text-[10px]">🌐</span>}
              <span className="opacity-70">· {STATUS_LABEL[q.status]}</span>
              {q.rate != null && <span>· ₹{q.rate.toLocaleString("en-IN")}</span>}
              <button
                onClick={() => setManualFor(manualFor === q.id ? null : q.id)}
                className="ml-1 p-0.5 hover:bg-black/10 rounded" title="Enter rate manually"
              >
                <Pencil className="w-3 h-3" />
              </button>
              {(canTick || isApproved) && (
                <button
                  onClick={() => !isApproved && setConfirmFor(q)}
                  disabled={isApproved}
                  className={`p-0.5 rounded ${isApproved ? "text-emerald-600" : "hover:bg-black/10"}`}
                  title={isApproved ? "Locked vendor" : (approved ? `Switch lock to ${q.vendor_name}` : "Confirm & lock this vendor")}
                >
                  <Check className="w-3 h-3" />
                </button>
              )}
              {!isApproved && (
                <button
                  onClick={() => removeQuote.mutate(q.id)}
                  className="p-0.5 hover:bg-black/10 rounded" title="Remove seller"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}
        <button
          onClick={() => { setAdding(!adding); if (adding) resetAdd(); }}
          className="text-xs px-2 py-0.5 border rounded-full hover:bg-muted inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Seller
        </button>
        <button
          onClick={() => setShowSearch(true)}
          className="text-xs px-2 py-0.5 border rounded-full hover:bg-muted inline-flex items-center gap-1"
          title="Search the web for sellers (Perplexity)"
        >
          <Globe className="w-3 h-3" /> Global Search
        </button>
      </div>

      {adding && (
        <div className="mt-2 border rounded-xl bg-muted/20 p-3">
          {addMode === "db" ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold block">Seller</label>
              <select
                value={pickVendorId}
                onChange={(e) => setPickVendorId(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
              >
                <option value="">— Select seller —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {pickedVendor && (
                <div className="flex items-center justify-between gap-2 border rounded-lg bg-background px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold">{pickedVendor.name}</span>
                    <span className="text-muted-foreground"> — {pickedPhone || "no phone"}</span>
                  </div>
                  <button
                    onClick={() => addVendor.mutate()}
                    disabled={addVendor.isPending}
                    className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {addVendor.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
                  </button>
                </div>
              )}
              <button
                onClick={() => setAddMode("new")}
                className="text-xs text-accent underline hover:no-underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add new seller
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => { setAddMode("db"); setFreeName(""); setFreePhone(""); }}
                className="text-xs text-accent underline hover:no-underline inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back to list
              </button>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className="text-xs font-semibold block mb-1">Seller name</label>
                  <input
                    value={freeName} onChange={(e) => setFreeName(e.target.value)}
                    placeholder="Seller name"
                    className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
                  />
                </div>
                <div className="w-40">
                  <label className="text-xs font-semibold block mb-1">Phone (WA)</label>
                  <input
                    value={freePhone} onChange={(e) => setFreePhone(e.target.value)}
                    placeholder="9876543210 or +91…"
                    className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
                  />
                </div>
                <button
                  onClick={() => addVendor.mutate()}
                  disabled={addVendor.isPending || !freeName.trim()}
                  className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {addVendor.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
                </button>
              </div>
              {freeName.trim() && !freePhone.trim() && (
                <p className="text-[11px] text-amber-600">No phone — this seller can't be messaged on WhatsApp.</p>
              )}
            </div>
          )}
        </div>
      )}

      {manualFor != null && (
        <ManualRateForm
          itemId={itemId}
          quoteId={manualFor}
          token={token}
          onClose={() => setManualFor(null)}
          onSaved={() => { setManualFor(null); refetch(); onChanged(); }}
        />
      )}

      {confirmFor && (
        <ConfirmLockDialog
          quote={confirmFor}
          current={approved || null}
          pending={confirmLock.isPending}
          onCancel={() => setConfirmFor(null)}
          onConfirm={() => confirmLock.mutate(confirmFor)}
        />
      )}

      {showSearch && (
        <GlobalSearchDrawer
          itemId={itemId}
          itemContext={itemContext}
          token={token}
          onClose={() => setShowSearch(false)}
          onChanged={() => { refetch(); onChanged(); }}
        />
      )}

      {chatVendor && (
        <VendorChatDrawer
          vendorId={chatVendor.vendorId}
          vendorName={chatVendor.name}
          itemId={itemId}
          itemContext={itemContext}
          token={token}
          onClose={() => setChatVendor(null)}
          onApproved={() => { setChatVendor(null); refetch(); onChanged(); }}
        />
      )}
    </div>
  );
}

function ConfirmLockDialog({
  quote, current, pending, onCancel, onConfirm,
}: {
  quote: Quote; current: Quote | null; pending: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const rate = quote.rate != null ? `₹${quote.rate.toLocaleString("en-IN")}` : "—";
  const swapping = current && current.id !== quote.id;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-bold text-sm mb-2 inline-flex items-center gap-2"><Lock className="w-4 h-4" /> Confirm locked vendor</div>
        <p className="text-sm text-muted-foreground mb-4">
          {swapping
            ? `Switch lock from ${current?.vendor_name || "current"} to ${quote.vendor_name || "this seller"}?`
            : `Confirm ${quote.vendor_name || "this seller"} at ${rate} as the locked vendor for this item?`}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={pending}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-1 disabled:opacity-50">
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Yes
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualRateForm({
  itemId, quoteId, token, onClose, onSaved,
}: {
  itemId: number; quoteId: number; token: string | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rate, setRate] = useState("");
  const [taxInclusive, setTaxInclusive] = useState<"incl" | "excl">("excl");
  const [taxPct, setTaxPct] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!rate) { toast({ title: "Rate required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes/${quoteId}/manual`, {
        method: "PUT",
        body: JSON.stringify({
          rate: parseFloat(rate),
          tax_inclusive: taxInclusive === "incl",
          tax_percent: taxPct ? parseFloat(taxPct) : undefined,
          notes: notes || undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Rate saved (manual)" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <div className="mt-2 border rounded-xl bg-muted/20 p-3 flex gap-2 flex-wrap items-end">
      <div className="w-24">
        <label className="text-xs font-semibold block mb-1">Rate ₹</label>
        <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
      </div>
      <div>
        <label className="text-xs font-semibold block mb-1">Tax</label>
        <div className="flex gap-1 text-xs">
          <button onClick={() => setTaxInclusive("incl")} className={`px-2 py-1.5 border rounded-lg ${taxInclusive === "incl" ? "bg-accent text-accent-foreground" : "bg-background"}`}>Inclusive</button>
          <button onClick={() => setTaxInclusive("excl")} className={`px-2 py-1.5 border rounded-lg ${taxInclusive === "excl" ? "bg-accent text-accent-foreground" : "bg-background"}`}>Exclusive</button>
        </div>
      </div>
      <div className="w-20">
        <label className="text-xs font-semibold block mb-1">Tax %</label>
        <input type="number" value={taxPct} onChange={(e) => setTaxPct(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
      </div>
      <div className="flex-1 min-w-[100px]">
        <label className="text-xs font-semibold block mb-1">Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
      </div>
      <button onClick={save} disabled={saving}
        className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
      </button>
      <button onClick={onClose} className="px-2 py-1.5 border rounded-lg text-xs">Cancel</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Global Search drawer (Perplexity Sonar) — per line
// ─────────────────────────────────────────────
interface GlobalResult {
  name?: string; phone?: string; location?: string; website?: string;
  gst_number?: string; source_url?: string;
}

function GlobalSearchDrawer({
  itemId, itemContext, token, onClose, onChanged,
}: {
  itemId: number; itemContext: string; token: string | null; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalResult[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [ran, setRan] = useState(false);

  async function runSearch() {
    setLoading(true); setRan(true);
    try {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/global-search`, {
        method: "POST", body: JSON.stringify({ query: query.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Search failed");
      if (!query.trim() && j.query) setQuery(j.query);
      setResults(Array.isArray(j.results) ? j.results : []);
      setChecked(new Set());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }

  async function addOne(res: GlobalResult, sendRate: boolean) {
    try {
      const url = sendRate
        ? `/api/team/po-items/${itemId}/quotes/global-send`
        : `/api/team/po-items/${itemId}/quotes`;
      const body = sendRate
        ? { vendor_name: res.name, vendor_phone: res.phone, source: "global" }
        : { vendor_name: res.name, vendor_phone: res.phone, source: "global" };
      const r = await teamFetch(token, url, { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
      toast({ title: sendRate ? "Seller added + rate request sent" : "Seller added to line" });
      onChanged();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function addSelected() {
    const picks = Array.from(checked).map((i) => results[i]).filter(Boolean);
    if (picks.length === 0) { toast({ title: "Tick at least one result", variant: "destructive" }); return; }
    for (const p of picks) {
      // bulk-add only (no rate request fired)
      // eslint-disable-next-line no-await-in-loop
      await teamFetch(token, `/api/team/po-items/${itemId}/quotes`, {
        method: "POST", body: JSON.stringify({ vendor_name: p.name, vendor_phone: p.phone, source: "global" }),
      });
    }
    toast({ title: `Added ${picks.length} seller(s)` });
    onChanged(); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-background shadow-xl h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <div className="font-bold inline-flex items-center gap-2"><Globe className="w-4 h-4" /> Global Search</div>
            <div className="text-xs text-muted-foreground">{itemContext}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 border-b space-y-2">
          <textarea
            value={query} onChange={(e) => setQuery(e.target.value)}
            rows={2}
            placeholder="brand part_number description wholesale supplier India"
            className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
          />
          <button onClick={runSearch} disabled={loading}
            className="w-full px-3 py-2 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Search sellers
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          ) : results.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              {ran ? "No sellers found. Try editing the query." : "Run a search to find sellers via Perplexity."}
            </div>
          ) : results.map((res, i) => (
            <div key={i} className="border rounded-xl p-3 text-xs space-y-1">
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={checked.has(i)}
                  onChange={(e) => {
                    const s = new Set(checked);
                    e.target.checked ? s.add(i) : s.delete(i);
                    setChecked(s);
                  }} />
                <div className="flex-1">
                  <div className="font-semibold text-sm">{res.name || "Unknown seller"}</div>
                  {res.phone && (
                    <a href={`tel:${res.phone}`} className="text-accent inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {res.phone}
                    </a>
                  )}
                  {res.location && <div className="text-muted-foreground">{res.location}</div>}
                  {res.website && (
                    <a href={res.website} target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> {res.website}
                    </a>
                  )}
                  {res.gst_number && <div className="text-muted-foreground">GST: {res.gst_number}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    via Perplexity{res.source_url ? <> · <a href={res.source_url} target="_blank" rel="noreferrer" className="underline">source</a></> : ""}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => addOne(res, false)}
                  className="px-2 py-1 border rounded-lg text-xs font-semibold inline-flex items-center gap-1 hover:bg-muted">
                  <Plus className="w-3 h-3" /> Add
                </button>
                <button onClick={() => addOne(res, true)}
                  className="px-2 py-1 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1">
                  <Send className="w-3 h-3" /> Send Rate Request
                </button>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="p-4 border-t">
            <button onClick={addSelected}
              className="w-full px-3 py-2 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> Add Selected ({checked.size})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Embedded seller chat drawer (slide-in from right). Polls every 15s while open.
// R11: optional Perplexity AI Assist toggle (persists per-vendor in localStorage).
// ─────────────────────────────────────────────
export function VendorChatDrawer({
  vendorId, vendorName, itemId, itemContext, token, onClose, onApproved,
}: {
  vendorId: number; vendorName: string; itemId?: number; itemContext?: string;
  token: string | null; onClose: () => void; onApproved?: () => void;
}) {
  const { toast } = useToast();
  const [rate, setRate] = useState("");
  const [taxInclusive, setTaxInclusive] = useState<"incl" | "excl">("excl");
  const [taxPct, setTaxPct] = useState("");
  const [approving, setApproving] = useState(false);
  const aiKey = `rfq-ai-assist-${vendorId}`;
  const [aiOn, setAiOn] = useState<boolean>(() => {
    try { return localStorage.getItem(aiKey) === "1"; } catch { return false; }
  });
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [sending, setSending] = useState(false);

  const { data: messages = [], refetch: refetchMsgs } = useQuery<any[]>({
    queryKey: ["rfq-chat", vendorId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/rfq/chat/${vendorId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  function toggleAi() {
    const next = !aiOn;
    setAiOn(next);
    try { localStorage.setItem(aiKey, next ? "1" : "0"); } catch { /* ignore */ }
  }

  async function getSuggestion() {
    if (!aiQuestion.trim()) { toast({ title: "Type a question first", variant: "destructive" }); return; }
    setAiLoading(true);
    try {
      const context = (messages || []).slice(-10).map((m: any) => ({ direction: m.direction, body: m.body }));
      const r = await teamFetch(token, `/api/team/rfq/chat/${vendorId}/ai-assist`, {
        method: "POST", body: JSON.stringify({ question: aiQuestion.trim(), context }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "AI assist failed");
      setAiDraft(j.suggestion || "");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setAiLoading(false); }
  }

  async function sendDraft() {
    if (!aiDraft.trim()) return;
    setSending(true);
    try {
      const r = await teamFetch(token, `/api/team/rfq/chat/${vendorId}/send`, {
        method: "POST", body: JSON.stringify({ body: aiDraft.trim() }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Send failed"); }
      toast({ title: "Message sent" });
      setAiDraft(""); setAiQuestion("");
      refetchMsgs();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  }

  async function approve() {
    if (!itemId) { toast({ title: "Open from a line chip to approve", variant: "destructive" }); return; }
    if (!rate) { toast({ title: "Rate required", variant: "destructive" }); return; }
    setApproving(true);
    try {
      const listR = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`);
      const list: Quote[] = listR.ok ? await listR.json() : [];
      let quote = list.find((q) => q.vendor_id === vendorId);
      if (!quote) {
        const addR = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`, {
          method: "POST", body: JSON.stringify({ vendor_id: vendorId, vendor_name: vendorName }),
        });
        quote = await addR.json();
      }
      await teamFetch(token, `/api/team/po-items/${itemId}/quotes/${quote!.id}/manual`, {
        method: "PUT",
        body: JSON.stringify({ rate: parseFloat(rate), tax_inclusive: taxInclusive === "incl", tax_percent: taxPct ? parseFloat(taxPct) : undefined }),
      });
      const apprR = await teamFetch(token, `/api/team/po-items/${itemId}/quotes/${quote!.id}/approve`, { method: "POST" });
      if (!apprR.ok) { const j = await apprR.json().catch(() => ({})); throw new Error(j.error || "Approve failed"); }
      toast({ title: "Rate approved — line locked" });
      onApproved?.();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setApproving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-background shadow-xl h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <div className="font-bold">{vendorName}</div>
            <div className="text-xs text-muted-foreground">Seller chat</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>
        {itemContext && (
          <div className="px-4 py-2 bg-muted/30 text-xs border-b">{itemContext}</div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">No messages yet. Replies appear here (polled every 15s).</div>
          ) : messages.map((m) => (
            <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.direction === "out" ? "ml-auto bg-accent text-accent-foreground" : "bg-muted"}`}>
              <div className="whitespace-pre-wrap">{m.body}</div>
              <div className="opacity-60 mt-1 text-[10px]">{m.created_at ? new Date(m.created_at).toLocaleString("en-IN") : ""}</div>
            </div>
          ))}
        </div>

        <div className="border-t p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Perplexity AI Assist</div>
            <button onClick={toggleAi}
              className={`px-2 py-0.5 rounded-full text-[11px] border ${aiOn ? "bg-accent text-accent-foreground" : "bg-background"}`}>
              {aiOn ? "On" : "Off"}
            </button>
          </div>
          {aiOn && (
            <div className="space-y-2 border rounded-lg p-2 bg-muted/20">
              <textarea
                value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)}
                rows={2} placeholder="Ask AI (e.g. answer the seller's spec question)"
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
              />
              <button onClick={getSuggestion} disabled={aiLoading}
                className="w-full px-2 py-1.5 border rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50">
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Get suggestion
              </button>
              {aiDraft && (
                <div className="space-y-2">
                  <textarea
                    value={aiDraft} onChange={(e) => setAiDraft(e.target.value)}
                    rows={3}
                    className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
                  />
                  <div className="flex gap-2">
                    <button onClick={sendDraft} disabled={sending}
                      className="flex-1 px-2 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50">
                      {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
                    </button>
                    <button onClick={() => { /* already editable inline */ }}
                      className="px-2 py-1.5 border rounded-lg text-xs font-semibold inline-flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-xs font-semibold pt-1">Approve Rate</div>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="w-24">
              <label className="text-[11px] block mb-0.5">Rate ₹</label>
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
            </div>
            <div>
              <label className="text-[11px] block mb-0.5">Tax</label>
              <div className="flex gap-1">
                <label className="flex items-center gap-1 text-xs"><input type="radio" checked={taxInclusive === "incl"} onChange={() => setTaxInclusive("incl")} />Incl</label>
                <label className="flex items-center gap-1 text-xs"><input type="radio" checked={taxInclusive === "excl"} onChange={() => setTaxInclusive("excl")} />Excl</label>
              </div>
            </div>
            <div className="w-20">
              <label className="text-[11px] block mb-0.5">Tax %</label>
              <input type="number" value={taxPct} onChange={(e) => setTaxPct(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background" />
            </div>
          </div>
          <button onClick={approve} disabled={approving}
            className="w-full px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50">
            {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve &amp; Lock Line
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// R11 — Fire Rate Request modal (flat table)
// Columns: Seller | Item | Seller✓ | Item✓ | Status
// ─────────────────────────────────────────────
interface PairRow {
  quote_id: number; seller_id: number; seller_name: string | null;
  status: string; rate: number | null; po_item_id: number;
  part_number: string | null; brand: string | null; qty: number | null;
  po_id: number; po_number: string; customer_po_number: string | null;
}

export function FireRateRequestModal({ token, onClose, defaultPoId }: { token: string | null; onClose: () => void; defaultPoId?: number }) {
  const { toast } = useToast();
  const [firing, setFiring] = useState(false);
  const [sellerChecked, setSellerChecked] = useState<Set<number>>(new Set());
  const [itemChecked, setItemChecked] = useState<Set<number>>(new Set());
  const [skipQuoted, setSkipQuoted] = useState(true);
  const [initDone, setInitDone] = useState(false);

  const { data: pairs = [], isLoading } = useQuery<PairRow[]>({
    queryKey: ["rfq-pairs", defaultPoId],
    queryFn: async () => {
      const url = defaultPoId ? `/api/team/rfq/pairs?po_id=${defaultPoId}` : `/api/team/rfq/pairs`;
      const r = await teamFetch(token, url);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  const isQuoted = (r: PairRow) => ["received", "approved", "manual"].includes(r.status);

  // Default both checked, except already-quoted rows which start unchecked.
  if (!initDone && pairs.length > 0) {
    const s = new Set<number>(); const it = new Set<number>();
    pairs.forEach((r) => { if (!isQuoted(r)) { s.add(r.quote_id); it.add(r.quote_id); } });
    setSellerChecked(s); setItemChecked(it); setInitDone(true);
  }

  function toggle(set: Set<number>, setter: (s: Set<number>) => void, id: number, on: boolean) {
    const next = new Set(set);
    on ? next.add(id) : next.delete(id);
    setter(next);
  }

  function masterToggle(col: "seller" | "item", on: boolean) {
    const ids = pairs.filter((r) => !(skipQuoted && isQuoted(r))).map((r) => r.quote_id);
    const next = new Set(on ? ids : []);
    if (col === "seller") setSellerChecked(next); else setItemChecked(next);
  }

  async function fire() {
    // A row fires only if BOTH its seller and item are ticked.
    const rows = pairs
      .filter((r) => sellerChecked.has(r.quote_id) && itemChecked.has(r.quote_id))
      .map((r) => ({ seller_id: r.seller_id, po_item_id: r.po_item_id }));
    if (rows.length === 0) { toast({ title: "Tick at least one full (seller + item) row", variant: "destructive" }); return; }
    setFiring(true);
    try {
      const r = await teamFetch(token, `/api/team/rfq/fire`, {
        method: "POST", body: JSON.stringify({ rows }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Fire failed");
      toast({ title: `Rate request fired to ${j.firedVendors} seller(s), ${j.firedItems} item(s)` });
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setFiring(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-bold inline-flex items-center gap-2"><Send className="w-4 h-4" /> Fire Rate Request</div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-2 border-b flex items-center gap-3 text-xs flex-wrap">
          <button onClick={() => { masterToggle("seller", true); masterToggle("item", true); }}
            className="px-2 py-1 border rounded-lg hover:bg-muted">Select all</button>
          <button onClick={() => { masterToggle("seller", false); masterToggle("item", false); }}
            className="px-2 py-1 border rounded-lg hover:bg-muted">Deselect all</button>
          <label className="inline-flex items-center gap-1.5 ml-auto">
            <input type="checkbox" checked={skipQuoted} onChange={(e) => setSkipQuoted(e.target.checked)} />
            Skip already quoted
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
          ) : pairs.length === 0 ? (
            <div className="p-6 text-xs text-muted-foreground text-center">No seller/item pairs. Add DB sellers to PO lines first.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Seller</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-center w-16">Seller ✓</th>
                  <th className="px-2 py-2 text-center w-14">Item ✓</th>
                  <th className="px-3 py-2 text-left w-20">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pairs.map((r) => {
                  const dimmed = skipQuoted && isQuoted(r);
                  return (
                    <tr key={r.quote_id} className={dimmed ? "opacity-40" : ""}>
                      <td className="px-3 py-2 font-semibold">{r.seller_name || `Seller #${r.seller_id}`}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono">{[r.part_number, r.brand].filter(Boolean).join(" ") || "—"}</span>
                        <span className="text-muted-foreground"> x{r.qty ?? 1} · {r.po_number}</span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" disabled={dimmed} checked={sellerChecked.has(r.quote_id)}
                          onChange={(e) => toggle(sellerChecked, setSellerChecked, r.quote_id, e.target.checked)} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" disabled={dimmed} checked={itemChecked.has(r.quote_id)}
                          onChange={(e) => toggle(itemChecked, setItemChecked, r.quote_id, e.target.checked)} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] ${STATUS_STYLE[r.status] || ""}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={fire} disabled={firing}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {firing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Fire Request
          </button>
        </div>
      </div>
    </div>
  );
}
