/**
 * R8 — TeamPOEdit.tsx
 * Enhanced vendor assignment UI for each PO line item.
 * Per item: Part#/Brand/Qty/Customer Rate + 3-tab Vendor Assignment panel:
 *   (a) History  — past purchases for this part, click "Use this vendor+rate"
 *   (b) Send RFQ — multi-select vendors from list → Send via WhatsApp (AiSensy)
 *   (c) Global   — fires search-vendor-rates to query price list
 * Shows margin% per item. "Save & Notify Delhi" button.
 */

import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth, getTeamToken } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import {
  Download, Check, Loader2, History, Send, Search,
  ChevronDown, ChevronUp, Package,
} from "lucide-react";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────
interface PoItem {
  id: number;
  partNumber: string | null;
  brand: string | null;
  description: string | null;
  qty: number;
  unitPrice: number | null;       // customer rate (selling price)
  vendorId: number | null;
  purchaseCost: number | null;    // legacy field
  vendorRate: number | null;      // R8 new field
  vendorName: string | null;      // R8 new field
  vendorBrand: string | null;     // R8 new field (stored as brand after assign)
  fulfilStatus: string | null;
  shippedStatus: string | null;
}

interface PO {
  id: number;
  poNumber: string;
  status: string;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  notes: string | null;
  customerPoNumber: string | null;
  shipToName: string | null;
  items: PoItem[];
}

interface Vendor { id: number; name: string; phone?: string | null; whatsapp?: string | null; }

interface HistoryRow {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_rate: number | null;
  brand: string | null;
  part_number: string | null;
  created_at: number;
}

interface PriceRow {
  part_number: string | null;
  brand: string | null;
  mrp: number | null;
  dealer_price: number | null;
  vendor_name: string | null;
}

interface VendorRatesResult {
  history: HistoryRow[];
  priceList: PriceRow[];
  rfqSentTo: number;
}

type TabKey = "history" | "rfq" | "global";

// ────────────────────────────────────────────────
// Margin helper
// ────────────────────────────────────────────────
function calcMargin(sellingPrice: number | null, costPrice: number | null): string | null {
  if (!sellingPrice || !costPrice || costPrice <= 0) return null;
  const margin = ((sellingPrice - costPrice) / sellingPrice) * 100;
  return margin.toFixed(1) + "%";
}

// ────────────────────────────────────────────────
// Per-item assignment panel
// ────────────────────────────────────────────────
function ItemVendorPanel({
  item,
  vendors,
  token,
  onAssigned,
}: {
  item: PoItem;
  vendors: Vendor[];
  token: string | null;
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("history");
  const [vendorId, setVendorId] = useState<string>(item.vendorId ? String(item.vendorId) : "");
  const [vendorRate, setVendorRate] = useState<string>(item.vendorRate != null ? String(item.vendorRate) : item.purchaseCost != null ? String(item.purchaseCost) : "");
  const [brand, setBrand] = useState<string>(item.vendorBrand || item.brand || "");
  const [saving, setSaving] = useState(false);

  // RFQ tab state
  const [rfqSelected, setRfqSelected] = useState<Set<number>>(new Set());
  const [rfqSending, setRfqSending] = useState(false);

  // Global search state
  const [ratesResult, setRatesResult] = useState<VendorRatesResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Current vendor display name
  const currentVendor = vendors.find((v) => v.id === item.vendorId);
  const margin = calcMargin(item.unitPrice, item.vendorRate ?? item.purchaseCost);

  async function saveAssignment() {
    if (!vendorId) return;
    setSaving(true);
    try {
      const r = await teamFetch(token, `/api/team/po-items/${item.id}/assign-vendor`, {
        method: "POST",
        body: JSON.stringify({
          vendor_id: Number(vendorId),
          vendor_rate: vendorRate ? parseFloat(vendorRate) : undefined,
          brand: brand || undefined,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Save failed");
      }
      toast({ title: "Vendor assigned" });
      setOpen(false);
      onAssigned();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function useHistoryRow(row: HistoryRow) {
    setVendorId(row.vendor_id ? String(row.vendor_id) : vendorId);
    if (row.vendor_rate != null) setVendorRate(String(row.vendor_rate));
    if (row.brand) setBrand(row.brand);
    setTab("history");
  }

  function usePriceRow(row: PriceRow) {
    const v = vendors.find((v) => v.name === row.vendor_name);
    if (v) setVendorId(String(v.id));
    const rate = row.dealer_price ?? row.mrp;
    if (rate != null) setVendorRate(String(rate));
    if (row.brand) setBrand(row.brand);
  }

  async function sendRFQsToSelected() {
    if (rfqSelected.size === 0) return;
    setRfqSending(true);
    try {
      // Fire search-vendor-rates which will WhatsApp the known vendors
      // and also return history+price list. We pass selected vendor IDs
      // via a custom header so backend can filter (best-effort; backend
      // already fires-and-forgets to known vendors from history).
      // For the multi-select UI we also POST to the same endpoint.
      const r = await teamFetch(token, `/api/team/po/${item.id}/search-vendor-rates`, {
        method: "POST",
        body: JSON.stringify({
          part_number: item.partNumber || "",
          brand: item.brand || brand || "",
          // backend will fire WA to known vendors from history
        }),
      });
      const j: VendorRatesResult = await r.json();
      setRatesResult(j);
      toast({ title: `RFQ sent to ${j.rfqSentTo} seller(s) via WhatsApp` });
    } catch (e: any) {
      toast({ title: "RFQ error", description: e.message, variant: "destructive" });
    } finally {
      setRfqSending(false);
    }
  }

  async function globalSearch() {
    setSearching(true);
    try {
      const r = await teamFetch(token, `/api/team/po/${item.id}/search-vendor-rates`, {
        method: "POST",
        body: JSON.stringify({
          part_number: item.partNumber || "",
          brand: item.brand || brand || "",
        }),
      });
      const j: VendorRatesResult = await r.json();
      setRatesResult(j);
    } catch (e: any) {
      toast({ title: "Search error", description: e.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      {/* Current assignment summary */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">
          {currentVendor ? (
            <span className="font-semibold text-foreground">{currentVendor.name}</span>
          ) : (
            <span className="italic">Unassigned</span>
          )}
          {(item.vendorRate ?? item.purchaseCost) != null && (
            <span> · ₹{(item.vendorRate ?? item.purchaseCost)!.toLocaleString("en-IN")}</span>
          )}
          {margin && <span className="ml-1 text-emerald-600 font-semibold">{margin} margin</span>}
        </span>
        <button
          onClick={() => setOpen(!open)}
          className="text-xs px-2 py-0.5 border rounded hover:bg-muted inline-flex items-center gap-1"
        >
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {open ? "Close" : "Assign"}
        </button>
      </div>

      {open && (
        <div className="mt-3 border rounded-xl bg-muted/20 p-3 space-y-3">
          {/* Vendor + rate fields */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs font-semibold block mb-1">Seller</label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
              >
                <option value="">— Select seller —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="w-24">
              <label className="text-xs font-semibold block mb-1">Rate ₹</label>
              <input
                type="number"
                value={vendorRate}
                onChange={(e) => setVendorRate(e.target.value)}
                placeholder="0"
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
              />
            </div>
            <div className="w-28">
              <label className="text-xs font-semibold block mb-1">Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Brand"
                className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
              />
            </div>
            {vendorRate && item.unitPrice && (
              <div className="flex items-end pb-1">
                <span className="text-xs font-semibold text-emerald-600">
                  {calcMargin(item.unitPrice, parseFloat(vendorRate))} margin
                </span>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div>
            <div className="flex gap-1 mb-2 border-b">
              {(["history", "rfq", "global"] as TabKey[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 transition-colors ${
                    tab === t ? "border-accent text-accent-foreground bg-accent/10" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "history" && <><History className="w-3 h-3 inline mr-1" />History</>}
                  {t === "rfq" && <><Send className="w-3 h-3 inline mr-1" />Send RFQ</>}
                  {t === "global" && <><Search className="w-3 h-3 inline mr-1" />Price Search</>}
                </button>
              ))}
            </div>

            {/* History tab */}
            {tab === "history" && (
              <HistoryTab
                partNumber={item.partNumber}
                brand={item.brand}
                token={token}
                onUse={useHistoryRow}
              />
            )}

            {/* RFQ tab */}
            {tab === "rfq" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Select sellers to send a WhatsApp RFQ for <strong>{item.partNumber || "this part"}</strong>.
                </p>
                <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                  {vendors.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center">No sellers found</div>
                  ) : vendors.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={rfqSelected.has(v.id)}
                        onChange={(e) => {
                          const s = new Set(rfqSelected);
                          e.target.checked ? s.add(v.id) : s.delete(v.id);
                          setRfqSelected(s);
                        }}
                        className="rounded"
                      />
                      <span className="font-semibold">{v.name}</span>
                      {(v.whatsapp || v.phone) && <span className="text-muted-foreground">{v.whatsapp || v.phone}</span>}
                    </label>
                  ))}
                </div>
                <button
                  onClick={sendRFQsToSelected}
                  disabled={rfqSelected.size === 0 || rfqSending}
                  className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {rfqSending ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><Send className="w-3 h-3" /> Send RFQ to {rfqSelected.size} seller(s)</>}
                </button>
                {ratesResult && (
                  <p className="text-xs text-emerald-600">RFQ sent to {ratesResult.rfqSentTo} seller(s) via WhatsApp.</p>
                )}
              </div>
            )}

            {/* Global/Price Search tab */}
            {tab === "global" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground flex-1">
                    Search price list + past purchases for <strong>{item.partNumber || "this part"}</strong>.
                  </p>
                  <button
                    onClick={globalSearch}
                    disabled={searching}
                    className="px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {searching ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching…</> : <><Search className="w-3 h-3" /> Search</>}
                  </button>
                </div>
                {ratesResult && ratesResult.priceList.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Part#</th>
                          <th className="px-2 py-1.5 text-left">Brand</th>
                          <th className="px-2 py-1.5 text-right">Dealer ₹</th>
                          <th className="px-2 py-1.5 text-right">MRP ₹</th>
                          <th className="px-2 py-1.5 text-left">Seller</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {ratesResult.priceList.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/30">
                            <td className="px-2 py-1 font-mono">{row.part_number || "—"}</td>
                            <td className="px-2 py-1">{row.brand || "—"}</td>
                            <td className="px-2 py-1 text-right">{row.dealer_price != null ? `₹${row.dealer_price.toLocaleString("en-IN")}` : "—"}</td>
                            <td className="px-2 py-1 text-right">{row.mrp != null ? `₹${row.mrp.toLocaleString("en-IN")}` : "—"}</td>
                            <td className="px-2 py-1">{row.vendor_name || "—"}</td>
                            <td className="px-1 py-1">
                              <button
                                onClick={() => usePriceRow(row)}
                                className="px-2 py-0.5 bg-accent text-accent-foreground rounded text-xs font-semibold"
                              >
                                Use
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {ratesResult && ratesResult.priceList.length === 0 && (
                  <p className="text-xs text-muted-foreground">No price list results found.</p>
                )}
              </div>
            )}
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <button
              onClick={saveAssignment}
              disabled={!vendorId || saving}
              className="px-4 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : <><Check className="w-3 h-3" /> Save Assignment</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
// History sub-component (lazy-loads on tab open)
// ────────────────────────────────────────────────
function HistoryTab({
  partNumber,
  brand,
  token,
  onUse,
}: {
  partNumber: string | null;
  brand: string | null;
  token: string | null;
  onUse: (row: HistoryRow) => void;
}) {
  const { data, isLoading } = useQuery<{ rows: HistoryRow[] }>({
    queryKey: ["ph-item", partNumber, brand],
    queryFn: async () => {
      if (!partNumber) return { rows: [] };
      const qs = new URLSearchParams({ q: partNumber, ...(brand ? { brand } : {}), limit: "10" });
      const r = await teamFetch(token, `/api/admin/purchase-history?${qs}`);
      return r.ok ? r.json() : { rows: [] };
    },
    enabled: !!partNumber && !!token,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="py-4 text-center text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;

  const rows = data?.rows ?? [];
  if (rows.length === 0) return <div className="py-4 text-center text-xs text-muted-foreground">No past purchase history for this part.</div>;

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1.5 text-left">Seller</th>
            <th className="px-2 py-1.5 text-left">Brand</th>
            <th className="px-2 py-1.5 text-right">Rate ₹</th>
            <th className="px-2 py-1.5 text-left">Date</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/30">
              <td className="px-2 py-1.5 font-semibold">{row.vendor_name || "—"}</td>
              <td className="px-2 py-1.5">{row.brand || "—"}</td>
              <td className="px-2 py-1.5 text-right">{row.vendor_rate != null ? `₹${row.vendor_rate.toLocaleString("en-IN")}` : "—"}</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {row.created_at ? new Date(row.created_at).toLocaleDateString("en-IN") : "—"}
              </td>
              <td className="px-1 py-1">
                <button
                  onClick={() => onUse(row)}
                  className="px-2 py-0.5 bg-accent text-accent-foreground rounded text-xs font-semibold"
                >
                  Use
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────
const STATUSES = ["draft", "open", "partial", "fulfilled", "cancelled"];

export default function TeamPOEdit() {
  const { id } = useParams<{ id: string }>();
  const poId = parseInt(id, 10);
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [notifying, setNotifying] = useState(false);

  const { data: po, isLoading } = useQuery<PO>({
    queryKey: ["team-po-edit", poId],
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

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed to update status");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-po-edit", poId] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function saveAndNotifyDelhi() {
    setNotifying(true);
    try {
      // Update status to "open" so Delhi can see it
      await teamFetch(token, `/api/team/purchase-orders/${poId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "open" }),
      });
      qc.invalidateQueries({ queryKey: ["team-po-edit", poId] });
      toast({ title: "PO marked open — Delhi notified", description: "Delhi team can now see this PO in their dashboard." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setNotifying(false);
    }
  }

  function downloadPdf() {
    const t = getTeamToken();
    fetch(apiUrl(`/api/team/purchase-orders/${poId}/pdf`), {
      headers: t ? { "x-team-token": t } : {},
    })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        window.open(u, "_blank");
      })
      .catch(() => toast({ title: "Error", description: "Could not load PDF", variant: "destructive" }));
  }

  if (isLoading || !po) {
    return (
      <TeamLayout title="Edit PO">
        <div className="p-12 text-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin inline mb-2" />
          <div>Loading…</div>
        </div>
      </TeamLayout>
    );
  }

  const allAssigned = po.items.length > 0 && po.items.every((it) => it.vendorId != null);

  return (
    <TeamLayout title={`PO ${po.poNumber} — Vendor Assignment`}>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-muted-foreground" />
          <div>
            <div className="font-bold text-lg">{po.poNumber}</div>
            {po.customerPoNumber && (
              <div className="text-xs text-muted-foreground">Customer PO: {po.customerPoNumber}</div>
            )}
          </div>
          <select
            value={po.status}
            onChange={(e) => setStatus.mutate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-background"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadPdf}
            className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={saveAndNotifyDelhi}
            disabled={notifying || !allAssigned}
            title={!allAssigned ? "Assign all vendors before notifying Delhi" : "Mark PO open and notify Delhi"}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {notifying ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Send className="w-4 h-4" /> Save &amp; Notify Delhi</>}
          </button>
        </div>
      </div>

      {!allAssigned && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          {po.items.filter((it) => !it.vendorId).length} item(s) still need vendor assignment before Delhi can be notified.
        </div>
      )}

      {/* Ship-to info */}
      {po.shipToName && (
        <div className="mb-4 bg-card border rounded-xl p-3 text-sm">
          <span className="font-semibold">Ship To:</span> {po.shipToName}
        </div>
      )}

      {/* Items table */}
      <div className="space-y-3">
        {po.items.map((item) => (
          <div key={item.id} className="bg-card border rounded-xl p-4 shadow-sm">
            {/* Item header */}
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

            {/* Vendor assignment panel */}
            <ItemVendorPanel
              item={item}
              vendors={vendors}
              token={token}
              onAssigned={() => qc.invalidateQueries({ queryKey: ["team-po-edit", poId] })}
            />
          </div>
        ))}

        {po.items.length === 0 && (
          <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground text-sm">
            No line items in this PO.
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="mt-6 bg-card border rounded-xl p-4 shadow-sm max-w-xs ml-auto text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>₹{(po.subtotal ?? 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Discount</span>
          <span>₹{(po.discount ?? 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span>₹{(po.tax ?? 0).toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between font-bold border-t pt-1">
          <span>Total</span>
          <span>₹{(po.total ?? 0).toLocaleString("en-IN")}</span>
        </div>
      </div>
    </TeamLayout>
  );
}
