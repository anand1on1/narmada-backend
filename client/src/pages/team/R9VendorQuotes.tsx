/**
 * R9 — Multi-vendor RFQ quotes, embedded chat approval, Fire Rate Request modal.
 * Lightweight inline UI (matches the existing TeamPOEdit Tailwind style — no shadcn Sheet/Dialog).
 * "Seller" wording throughout (per project convention).
 */
import { useState } from "react";
import { teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Loader2, Check, X, MessageSquare, Pencil, Send, ChevronRight,
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
// Per-line multi-vendor quote panel
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
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [pickVendorId, setPickVendorId] = useState("");
  const [freeName, setFreeName] = useState("");
  const [freePhone, setFreePhone] = useState("");
  const [manualFor, setManualFor] = useState<number | null>(null);
  const [chatVendor, setChatVendor] = useState<{ vendorId: number; name: string } | null>(null);

  const { data: quotes = [], refetch } = useQuery<Quote[]>({
    queryKey: ["line-quotes", itemId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  const approved = quotes.find((q) => q.status === "approved");

  const addVendor = useMutation({
    mutationFn: async () => {
      if (!pickVendorId && !freeName.trim()) throw new Error("Pick a seller or type a name");
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/quotes`, {
        method: "POST",
        body: JSON.stringify({
          vendor_id: pickVendorId ? Number(pickVendorId) : undefined,
          vendor_name: freeName.trim() || undefined,
          vendor_phone: freePhone.trim() || undefined,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
    },
    onSuccess: () => {
      setAdding(false); setPickVendorId(""); setFreeName(""); setFreePhone("");
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

  const unapprove = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/unapprove`, { method: "POST" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { refetch(); onChanged(); toast({ title: "Approval cleared" }); },
  });

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        {quotes.map((q) => (
          <span
            key={q.id}
            className={`inline-flex items-center gap-1.5 text-xs border rounded-full pl-2.5 pr-1 py-0.5 ${STATUS_STYLE[q.status] || ""}`}
          >
            <button
              onClick={() => q.vendor_id && setChatVendor({ vendorId: q.vendor_id, name: q.vendor_name || "Seller" })}
              className="font-semibold inline-flex items-center gap-1 hover:underline disabled:no-underline"
              disabled={!q.vendor_id}
              title={q.vendor_id ? "Open chat" : "Free-text seller (no chat)"}
            >
              {q.vendor_id && <MessageSquare className="w-3 h-3" />}
              {q.vendor_name || "Seller"}
            </button>
            <span className="opacity-70">· {STATUS_LABEL[q.status]}</span>
            {q.rate != null && <span>· ₹{q.rate.toLocaleString("en-IN")}</span>}
            <button
              onClick={() => setManualFor(manualFor === q.id ? null : q.id)}
              className="ml-1 p-0.5 hover:bg-black/10 rounded" title="Enter rate manually"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {q.status !== "approved" && (
              <button
                onClick={() => removeQuote.mutate(q.id)}
                className="p-0.5 hover:bg-black/10 rounded" title="Remove seller"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <button
          onClick={() => setAdding(!adding)}
          className="text-xs px-2 py-0.5 border rounded-full hover:bg-muted inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Seller
        </button>
      </div>

      {adding && (
        <div className="mt-2 flex gap-2 flex-wrap items-end border rounded-xl bg-muted/20 p-3">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs font-semibold block mb-1">Seller</label>
            <select
              value={pickVendorId}
              onChange={(e) => setPickVendorId(e.target.value)}
              className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
            >
              <option value="">— Select seller —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="text-xs font-semibold block mb-1">or free-text name</label>
            <input
              value={freeName} onChange={(e) => setFreeName(e.target.value)}
              placeholder="Seller name"
              className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
            />
          </div>
          <div className="w-32">
            <label className="text-xs font-semibold block mb-1">Phone (WA)</label>
            <input
              value={freePhone} onChange={(e) => setFreePhone(e.target.value)}
              placeholder="91XXXXXXXXXX"
              className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
            />
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

      {manualFor != null && (
        <ManualRateForm
          itemId={itemId}
          quoteId={manualFor}
          token={token}
          onClose={() => setManualFor(null)}
          onSaved={() => { setManualFor(null); refetch(); onChanged(); }}
        />
      )}

      {approved && (
        <div className="mt-2 inline-flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-1.5">
          <Check className="w-3.5 h-3.5" />
          <span className="font-semibold">Approved:</span> {approved.vendor_name || "Seller"}
          {approved.rate != null && <span>· ₹{approved.rate.toLocaleString("en-IN")}</span>}
          {approved.tax_inclusive != null && (
            <span>· Tax {approved.tax_inclusive ? "incl." : "excl."}{approved.tax_percent != null ? ` ${approved.tax_percent}%` : ""}</span>
          )}
          <button onClick={() => unapprove.mutate()} className="ml-1 underline hover:no-underline">unapprove</button>
        </div>
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
// Embedded vendor chat drawer (slide-in from right). Polls every 15s while open.
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

  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ["rfq-chat", vendorId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/rfq/chat/${vendorId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  async function approve() {
    if (!itemId) { toast({ title: "Open from a line chip to approve", variant: "destructive" }); return; }
    if (!rate) { toast({ title: "Rate required", variant: "destructive" }); return; }
    setApproving(true);
    try {
      // Ensure a quote row exists for this (line, vendor), set its rate, then approve it.
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
          <div className="text-xs font-semibold">Approve Rate</div>
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
// Fire Rate Request modal
// ─────────────────────────────────────────────
export function FireRateRequestModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [selectedVendor, setSelectedVendor] = useState<number | null>(null);
  const [checkedPos, setCheckedPos] = useState<Set<number>>(new Set());
  const [firing, setFiring] = useState(false);

  const { data: pendingVendors = [], isLoading } = useQuery<any[]>({
    queryKey: ["rfq-pending-vendors"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/rfq/pending-vendors`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  const current = pendingVendors.find((v) => v.vendor_id === selectedVendor);

  function selectVendor(vid: number) {
    setSelectedVendor(vid);
    const v = pendingVendors.find((x) => x.vendor_id === vid);
    setCheckedPos(new Set((v?.pos || []).map((p: any) => p.po_id)));
  }

  async function fire() {
    if (!selectedVendor || checkedPos.size === 0) { toast({ title: "Select a seller and at least one PO", variant: "destructive" }); return; }
    setFiring(true);
    try {
      const r = await teamFetch(token, `/api/team/rfq/fire`, {
        method: "POST",
        body: JSON.stringify({ vendor_ids: [selectedVendor], po_ids: Array.from(checkedPos) }),
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
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-bold">Fire Rate Request</div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-1/2 border-r overflow-y-auto">
            <div className="px-3 py-2 text-xs font-semibold bg-muted/40 sticky top-0">Sellers with pending requests</div>
            {isLoading ? (
              <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : pendingVendors.length === 0 ? (
              <div className="p-6 text-xs text-muted-foreground text-center">No pending rate requests. Add sellers to PO lines first.</div>
            ) : pendingVendors.map((v) => (
              <button key={v.vendor_id} onClick={() => selectVendor(v.vendor_id)}
                className={`w-full text-left px-3 py-2.5 text-sm border-b flex items-center justify-between hover:bg-muted ${selectedVendor === v.vendor_id ? "bg-accent/10" : ""}`}>
                <span className="font-semibold">{v.vendor_name || `Seller #${v.vendor_id}`}</span>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">{v.pending_count} pending <ChevronRight className="w-3 h-3" /></span>
              </button>
            ))}
          </div>
          <div className="w-1/2 overflow-y-auto">
            <div className="px-3 py-2 text-xs font-semibold bg-muted/40 sticky top-0">POs to include</div>
            {!current ? (
              <div className="p-6 text-xs text-muted-foreground text-center">Select a seller to choose POs.</div>
            ) : (current.pos || []).map((p: any) => (
              <label key={p.po_id} className="flex items-center gap-2 px-3 py-2.5 text-sm border-b hover:bg-muted cursor-pointer">
                <input type="checkbox" checked={checkedPos.has(p.po_id)}
                  onChange={(e) => {
                    const s = new Set(checkedPos);
                    e.target.checked ? s.add(p.po_id) : s.delete(p.po_id);
                    setCheckedPos(s);
                  }} />
                <span className="font-mono text-xs">{p.po_number}</span>
                {p.customer_po_number && <span className="text-xs text-muted-foreground">({p.customer_po_number})</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="p-4 border-t flex justify-end">
          <button onClick={fire} disabled={firing || !selectedVendor || checkedPos.size === 0}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {firing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Rate Request
          </button>
        </div>
      </div>
    </div>
  );
}
