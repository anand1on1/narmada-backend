/**
 * R10 — TeamPODetail.tsx (merged View + Assign page)
 * Single page at /team/purchase-orders/:id. Replaces the old single-vendor
 * View + the separate Assign page. Header (PO#, status, PO date, PDF, Notify
 * Delhi, Fire Rate Request) + sub-header (customer, customer PO#, PO date, live
 * totals) + per-line multi-seller LineQuotesPanel.
 */
import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth, getTeamToken } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { Download, Check, Loader2, Package, Pencil, Calendar, Send, Flame } from "lucide-react";
import { LineQuotesPanel, FireRateRequestModal } from "./R9VendorQuotes";

interface PoItem {
  id: number;
  partNumber: string | null;
  brand: string | null;
  description: string | null;
  qty: number;
  unitPrice: number | null;
  vendorId: number | null;
  purchaseCost: number | null;
  vendorRate: number | null;
  vendorName: string | null;
  fulfilStatus: string | null;
  shippedStatus: string | null;
}

interface Quote { status: string; }

interface PO {
  id: number;
  poNumber: string;
  status: string;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  notes: string | null;
  customerName: string | null;
  customerPoNumber: string | null;
  poDate: number | null;
  custTotal: number;
  costTotal: number;
  shipToName: string | null;
  items: PoItem[];
}

interface Vendor { id: number; name: string; phone?: string | null; whatsapp?: string | null; }

const STATUSES = ["draft", "open", "partial", "fulfilled", "cancelled"];

// ─── PO date editor ───
function PoDateEditor({
  poId, poDate, token, onSaved,
}: {
  poId: number; poDate: number | null; token: string | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);

  function open() {
    const d = poDate ? new Date(poDate) : new Date();
    setVal(d.toISOString().slice(0, 10));
    setEditing(true);
  }

  async function save() {
    if (!val) { toast({ title: "Pick a date", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const ts = new Date(val + "T00:00:00").getTime();
      const r = await teamFetch(token, `/api/team/po/${poId}/po-date`, {
        method: "PUT",
        body: JSON.stringify({ po_date: ts }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "PO date updated" });
      setEditing(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input type="date" value={val} onChange={(e) => setVal(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-sm bg-background" />
        <button onClick={save} disabled={saving}
          className="px-2 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </button>
        <button onClick={() => setEditing(false)} className="px-2 py-1.5 border rounded-lg text-xs">Cancel</button>
      </span>
    );
  }

  return (
    <button onClick={open}
      className="border rounded-lg px-3 py-1.5 text-sm bg-background inline-flex items-center gap-1.5 hover:bg-muted">
      <Calendar className="w-3.5 h-3.5" />
      {poDate ? new Date(poDate).toLocaleDateString("en-IN") : "Set PO date"}
      <Pencil className="w-3 h-3 opacity-60" />
    </button>
  );
}

export default function TeamPODetail() {
  const { id } = useParams<{ id: string }>();
  const poId = parseInt(id, 10);
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [notifying, setNotifying] = useState(false);
  const [showFireRfq, setShowFireRfq] = useState(false);

  const { data: po, isLoading } = useQuery<PO>({
    queryKey: ["team-po", poId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!token && !!poId,
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["team-vendors-min"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/vendors`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  // Aggregate quote statuses across all lines to enable the Fire Rate Request
  // button (enabled when ≥1 quote is in "requested" status).
  const { data: hasRequested = false } = useQuery<boolean>({
    queryKey: ["team-po-has-requested", poId, po?.items?.length],
    queryFn: async () => {
      if (!po) return false;
      const results = await Promise.all(
        po.items.map(async (it) => {
          const r = await teamFetch(token, `/api/team/po-items/${it.id}/quotes`);
          const qs: Quote[] = r.ok ? await r.json() : [];
          return qs.some((q) => q.status === "requested");
        }),
      );
      return results.some(Boolean);
    },
    enabled: !!token && !!po,
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed to update status");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-po", poId] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function notifyDelhi() {
    setNotifying(true);
    try {
      const r = await teamFetch(token, `/api/team/po/${poId}/notify-delhi`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Notify failed");
      qc.invalidateQueries({ queryKey: ["team-po", poId] });
      toast({ title: `Delhi notified. They can see ${j.assignedCount} assigned lines.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setNotifying(false);
    }
  }

  function downloadPdf() {
    const t = getTeamToken();
    fetch(apiUrl(`/api/team/purchase-orders/${poId}/pdf?type=internal`), {
      headers: t ? { "x-team-token": t } : {},
    })
      .then((r) => r.blob())
      .then((b) => { const u = URL.createObjectURL(b); window.open(u, "_blank"); })
      .catch(() => toast({ title: "Error", description: "Could not load PDF", variant: "destructive" }));
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["team-po", poId] });
    qc.invalidateQueries({ queryKey: ["team-po-has-requested", poId] });
  }

  if (isLoading || !po) {
    return (
      <TeamLayout title="Purchase Order">
        <div className="p-12 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin inline mb-2" />
          <div>Loading…</div>
        </div>
      </TeamLayout>
    );
  }

  const assignedCount = po.items.filter(
    (it) => it.vendorId != null || (it.vendorRate != null) || (it.vendorName && it.vendorName.trim()),
  ).length;
  const anyAssigned = assignedCount > 0;
  // Live total: prefer cost total (approved seller rates) else fall back to customer total.
  const liveTotal = po.costTotal > 0 ? po.costTotal : po.custTotal;
  const margin = po.custTotal - po.costTotal;

  return (
    <TeamLayout title={`PO ${po.poNumber}`}>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-muted-foreground" />
          <div className="font-bold text-lg">{po.poNumber}</div>
          <select
            value={po.status}
            onChange={(e) => setStatus.mutate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-background"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <PoDateEditor poId={poId} poDate={po.poDate} token={token} onSaved={refresh} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadPdf}
            className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={notifyDelhi}
            disabled={notifying || !anyAssigned}
            title={!anyAssigned ? "Assign at least one seller first" : `Notify Delhi — they will see ${assignedCount} assigned line(s)`}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {notifying ? <><Loader2 className="w-4 h-4 animate-spin" /> Notifying…</> : <><Send className="w-4 h-4" /> Notify Delhi</>}
          </button>
          <button
            onClick={() => setShowFireRfq(true)}
            disabled={!hasRequested}
            title={hasRequested ? "Send rate request to this PO's sellers" : "Add a seller to a line first (status: requested)"}
            className="px-4 py-2 border border-orange-300 text-orange-700 rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-orange-50 disabled:opacity-50"
          >
            <Flame className="w-4 h-4" /> Fire Rate Request
          </button>
        </div>
      </div>

      {/* Sub-header: customer + totals */}
      <div className="mb-4 bg-card border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="space-y-0.5">
          <div className="font-semibold">{po.customerName || "—"}</div>
          <div className="text-xs text-muted-foreground">
            {po.customerPoNumber ? `Customer PO: ${po.customerPoNumber}` : "No customer PO #"}
            {po.poDate ? ` · ${new Date(po.poDate).toLocaleDateString("en-IN")}` : ""}
          </div>
        </div>
        <div className="text-xs text-right">
          <div className="font-semibold text-sm">₹{liveTotal.toLocaleString("en-IN")}</div>
          <div className="text-muted-foreground">
            Cust Total ₹{po.custTotal.toLocaleString("en-IN")} · Cost Total ₹{po.costTotal.toLocaleString("en-IN")} ·{" "}
            <span className={margin >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
              Margin ₹{margin.toLocaleString("en-IN")}
            </span>
          </div>
        </div>
      </div>

      {!anyAssigned ? (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          Assign at least one seller before notifying Delhi. You don't need to assign every line — Delhi will only see the lines you've assigned.
        </div>
      ) : (
        <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
          {assignedCount} of {po.items.length} line(s) assigned. Delhi will see only the assigned lines when notified.
        </div>
      )}

      {po.shipToName && (
        <div className="mb-4 bg-card border rounded-xl p-3 text-sm">
          <span className="font-semibold">Ship To:</span> {po.shipToName}
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {po.items.map((item) => (
          <div key={item.id} className="bg-card border rounded-xl p-4 shadow-sm">
            <div className="flex flex-wrap items-start gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm font-mono">{item.partNumber || "—"}</div>
                {item.description && <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>}
              </div>
              <div className="flex gap-4 text-xs text-right">
                <div>
                  <div className="text-muted-foreground">Brand</div>
                  <div className="font-semibold">{item.brand || "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Qty</div>
                  <div className="font-semibold">{item.qty}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cust. Rate</div>
                  <div className="font-semibold">
                    {item.unitPrice != null ? `₹${item.unitPrice.toLocaleString("en-IN")}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div className={`font-semibold capitalize ${
                    item.fulfilStatus === "fulfilled" || item.shippedStatus === "shipped"
                      ? "text-emerald-600"
                      : "text-muted-foreground"
                  }`}>
                    {item.shippedStatus === "shipped" ? "shipped" : item.fulfilStatus || "pending"}
                  </div>
                </div>
              </div>
            </div>

            {/* R9 multi-vendor quotes (ask many sellers, approve one) */}
            <div className="pt-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1">Sellers & rate requests</div>
              <LineQuotesPanel
                itemId={item.id}
                itemContext={`${item.partNumber || "Part"}${item.brand ? ` · ${item.brand}` : ""} · Qty ${item.qty}`}
                vendors={vendors}
                token={token}
                onChanged={refresh}
              />
            </div>
          </div>
        ))}

        {po.items.length === 0 && (
          <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground text-sm">
            No line items in this PO.
          </div>
        )}
      </div>

      {showFireRfq && (
        <FireRateRequestModal token={token} defaultPoId={poId} onClose={() => { setShowFireRfq(false); refresh(); }} />
      )}
    </TeamLayout>
  );
}
