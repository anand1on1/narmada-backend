import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";
import {
  LogOut, Package, Truck, PackageCheck, Megaphone, X,
  ClipboardList, Loader2, Check,
} from "lucide-react";

// ────────────────────────────────────────────────
// Types — existing queue
// ────────────────────────────────────────────────
interface QItem {
  id: number; partNumber: string | null; brand: string | null; qty: number;
  vendorName: string; vendorPhone: string; vendorAddress: string;
  clientName: string; clientCity: string; poNumber: string;
}
interface Queue { pickup: QItem[]; pack: QItem[]; dispatch: QItem[]; }

// ────────────────────────────────────────────────
// Types — R8 POs tab
// ────────────────────────────────────────────────
interface PoListItem {
  id: number;
  po_number: string;
  status: string;
  customer_name: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  item_count: number;
  shipped_count: number;
  dispatch_round: number | null;
  is_fully_dispatched: number;
  created_at: number;
}

interface PoItemDetail {
  id: number;
  part_number: string | null;
  brand: string | null;
  description: string | null;
  qty: number;
  unit_price: number | null;
  vendor_name: string | null;
  shipped_status: string | null;
  dispatch_round_shipped: number | null;
}

interface PoDetail {
  id: number;
  poNumber: string;
  customerPoNumber: string | null;
  status: string;
  shipToName: string | null;
  shipToAddress: string | null;
  shipToPhone: string | null;
  items: PoItemDetail[];
}

type DashTab = "pickup" | "pack" | "dispatch" | "pos";

export default function DelhiDashboard() {
  const { token, user, clear, ready } = useTeamAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Legacy dispatch modal state ──
  const [dispatchItem, setDispatchItem] = useState<QItem | null>(null);
  const [docket, setDocket] = useState("");
  const [courier, setCourier] = useState("");

  // ── Announcement banner ──
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("delhi_announcement_dismissed") === "1"; } catch { return false; }
  });

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<DashTab>("pickup");

  // ── POs tab state ──
  const [selectedPo, setSelectedPo] = useState<PoDetail | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [submitDocket, setSubmitDocket] = useState("");
  const [submitCourier, setSubmitCourier] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ────────────────────────────────────────────────
  // Data queries
  // ────────────────────────────────────────────────
  const { data: announcement } = useQuery<{ id: number; title: string; body: string | null } | null>({
    queryKey: ["delhi-announcement"],
    queryFn: async () => {
      if (!token) return null;
      const r = await teamFetch(token, `/api/team/announcements`);
      if (!r.ok) return null;
      const arr = await r.json();
      return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  // Legacy queue
  const { data: q } = useQuery<Queue>({
    queryKey: ["delhi-queue"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/delhi/queue`);
      return r.ok ? r.json() : { pickup: [], pack: [], dispatch: [] };
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  // R8 POs list (polls every 15s)
  const { data: activePOs = [] } = useQuery<PoListItem[]>({
    queryKey: ["delhi-active-pos"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/delhi/pos`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (ready && !token) navigate("/delhi");
  }, [ready, token, navigate]);

  // ────────────────────────────────────────────────
  // Legacy queue mutations
  // ────────────────────────────────────────────────
  const setStatus = useMutation({
    mutationFn: async ({ id, status, docket_no, courier }: { id: number; status: string; docket_no?: string; courier?: string }) => {
      const r = await teamFetch(token, `/api/delhi/po-items/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status, docket_no, courier }),
      });
      if (!r.ok) throw new Error("Update failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delhi-queue"] });
      setDispatchItem(null);
      setDocket("");
      setCourier("");
      toast({ title: "Updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ────────────────────────────────────────────────
  // PO detail loader
  // ────────────────────────────────────────────────
  async function loadPoDetail(poId: number) {
    setPoLoading(true);
    setSelectedPo(null);
    setSubmitDocket("");
    setSubmitCourier("");
    try {
      const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`);
      if (!r.ok) throw new Error("Could not load PO");
      const data = await r.json();
      // Delhi only sees line items that have a seller assigned (Bug 3 — partial notify).
      // Unassigned lines (e.g. 96 of 100 not yet sourced) stay hidden from the warehouse.
      const items: PoItemDetail[] = (data.items || [])
        .filter((it: any) => (it.vendorId ?? it.vendor_id) != null)
        .map((it: any) => ({
        id: it.id,
        part_number: it.partNumber ?? it.part_number ?? null,
        brand: it.brand ?? null,
        description: it.description ?? null,
        qty: it.qty ?? 0,
        unit_price: it.unitPrice ?? it.unit_price ?? null,
        vendor_name: it.vendorName ?? it.vendor_name ?? null,
        shipped_status: it.shippedStatus ?? it.shipped_status ?? null,
        dispatch_round_shipped: it.dispatchRoundShipped ?? it.dispatch_round_shipped ?? null,
      }));
      setSelectedPo({
        id: data.id,
        poNumber: data.poNumber ?? data.po_number,
        customerPoNumber: data.customerPoNumber ?? data.customer_po_number ?? null,
        status: data.status,
        shipToName: data.shipToName ?? data.ship_to_name ?? null,
        shipToAddress: data.shipToAddress ?? data.ship_to_address ?? null,
        shipToPhone: data.shipToPhone ?? data.ship_to_phone ?? null,
        items,
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPoLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  // Mark item shipped / unshipped (R8 PUT endpoint)
  // ────────────────────────────────────────────────
  async function toggleItemShipped(itemId: number, currentStatus: string | null) {
    const shipped = currentStatus !== "shipped";
    try {
      const r = await teamFetch(token, `/api/delhi/po-items/${itemId}/mark-shipped`, {
        method: "PUT",
        body: JSON.stringify({ shipped }),
      });
      if (!r.ok) throw new Error("Failed to update item");
      // Refresh detail
      if (selectedPo) await loadPoDetail(selectedPo.id);
      qc.invalidateQueries({ queryKey: ["delhi-active-pos"] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  // ────────────────────────────────────────────────
  // Submit day dispatch
  // ────────────────────────────────────────────────
  async function submitDay() {
    if (!selectedPo) return;
    if (!submitDocket) { toast({ title: "Please enter a docket/AWB number", variant: "destructive" }); return; }
    const hasShipped = selectedPo.items.some((it) => it.shipped_status === "shipped" && it.dispatch_round_shipped == null);
    if (!hasShipped) { toast({ title: "No new shipped items to submit", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const r = await teamFetch(token, `/api/delhi/po/${selectedPo.id}/submit-day`, {
        method: "POST",
        body: JSON.stringify({
          docketNo: submitDocket,
          courierName: submitCourier || undefined,
          dispatchDate: Date.now(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Submit failed");
      }
      const j = await r.json();
      toast({
        title: `Dispatch Round ${j.round} submitted`,
        description: j.isFullyDispatched ? "All items dispatched! PO marked fulfilled." : `${j.shippedCount} item(s) dispatched.`,
      });
      setSubmitDocket("");
      setSubmitCourier("");
      await loadPoDetail(selectedPo.id);
      qc.invalidateQueries({ queryKey: ["delhi-active-pos"] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    if (token) { try { await teamFetch(token, "/api/team/logout", { method: "POST" }); } catch {} }
    clear();
    navigate("/delhi");
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!token) return null;

  // ────────────────────────────────────────────────
  // Legacy queue card component
  // ────────────────────────────────────────────────
  const Card = ({ it, action }: { it: QItem; action: React.ReactNode }) => (
    <div className="bg-card border rounded-lg p-3 shadow-sm">
      <div className="font-semibold text-sm">
        {it.partNumber || "—"}{" "}
        {it.brand && <span className="text-muted-foreground font-normal">/ {it.brand}</span>}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">Qty {it.qty} · {it.poNumber}</div>
      <div className="text-xs mt-1"><span className="font-semibold">Vendor:</span> {it.vendorName} · {it.vendorPhone}</div>
      <div className="text-xs"><span className="font-semibold">Client:</span> {it.clientName} ({it.clientCity})</div>
      <div className="mt-2">{action}</div>
    </div>
  );

  const Col = ({
    title, icon: Icon, items, action,
  }: { title: string; icon: React.ElementType; items: QItem[]; action: (it: QItem) => React.ReactNode }) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3 font-bold">
        <Icon className="w-4 h-4" /> {title}{" "}
        <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
      </div>
      <div className="space-y-2">
        {items.length === 0
          ? <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">Empty</div>
          : items.map((it) => <Card key={it.id} it={it} action={action(it)} />)}
      </div>
    </div>
  );

  // ────────────────────────────────────────────────
  // Tab pills
  // ────────────────────────────────────────────────
  const TAB_LABELS: { key: DashTab; icon: React.ElementType; label: string; count?: number }[] = [
    { key: "pickup", icon: Package, label: "To Pick Up", count: q?.pickup?.length },
    { key: "pack", icon: PackageCheck, label: "To Pack", count: q?.pack?.length },
    { key: "dispatch", icon: Truck, label: "To Dispatch", count: q?.dispatch?.length },
    { key: "pos", icon: ClipboardList, label: "POs (Active)", count: activePOs.length },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-card border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Delhi Warehouse</div>
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-muted-foreground">{user.name}</span>}
          <button
            onClick={logout}
            className="text-sm px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </header>

      {/* Announcement banner */}
      {announcement && !bannerDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
          <Megaphone className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{announcement.title}</span>
            {announcement.body && <span className="ml-2">{announcement.body}</span>}
          </div>
          <button
            onClick={() => {
              setBannerDismissed(true);
              try { sessionStorage.setItem("delhi_announcement_dismissed", "1"); } catch {}
            }}
            className="text-amber-500 hover:text-amber-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="bg-card border-b px-6">
        <div className="flex gap-1">
          {TAB_LABELS.map(({ key, icon: Icon, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors inline-flex items-center gap-2 ${
                activeTab === key
                  ? "border-accent text-accent-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count != null && count > 0 && (
                <span className="bg-accent/20 text-accent-foreground text-xs rounded-full px-1.5 py-0.5 font-bold">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Legacy queue tabs ── */}
      {activeTab !== "pos" && (
        <div className="p-6 flex flex-col lg:flex-row gap-6">
          {activeTab === "pickup" && (
            <Col
              title="To Pick Up"
              icon={Package}
              items={q?.pickup || []}
              action={(it) => (
                <button
                  onClick={() => setStatus.mutate({ id: it.id, status: "collected" })}
                  className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold"
                >
                  Mark Collected
                </button>
              )}
            />
          )}
          {activeTab === "pack" && (
            <Col
              title="To Pack"
              icon={PackageCheck}
              items={q?.pack || []}
              action={(it) => (
                <button
                  onClick={() => setStatus.mutate({ id: it.id, status: "packed" })}
                  className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold"
                >
                  Mark Packed
                </button>
              )}
            />
          )}
          {activeTab === "dispatch" && (
            <Col
              title="To Dispatch"
              icon={Truck}
              items={q?.dispatch || []}
              action={(it) => (
                <button
                  onClick={() => setDispatchItem(it)}
                  className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold"
                >
                  Dispatch…
                </button>
              )}
            />
          )}
        </div>
      )}

      {/* ── POs (Active) tab ── */}
      {activeTab === "pos" && (
        <div className="p-6">
          {selectedPo ? (
            /* PO Detail view */
            <div className="max-w-3xl">
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => setSelectedPo(null)}
                  className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 border rounded-lg"
                >
                  ← Back
                </button>
                <div>
                  <div className="font-bold text-lg">{selectedPo.poNumber}</div>
                  {selectedPo.customerPoNumber && (
                    <div className="text-xs text-muted-foreground">Customer PO: {selectedPo.customerPoNumber}</div>
                  )}
                </div>
                <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
                  selectedPo.status === "fulfilled" ? "bg-emerald-100 text-emerald-700" :
                  selectedPo.status === "partial" ? "bg-blue-100 text-blue-700" :
                  "bg-muted text-muted-foreground"
                }`}>{selectedPo.status}</span>
              </div>

              {selectedPo.shipToName && (
                <div className="mb-4 bg-card border rounded-lg p-3 text-xs">
                  <span className="font-semibold">Ship To:</span> {selectedPo.shipToName}
                  {selectedPo.shipToAddress && <span className="text-muted-foreground"> — {selectedPo.shipToAddress}</span>}
                  {selectedPo.shipToPhone && <span className="text-muted-foreground"> · {selectedPo.shipToPhone}</span>}
                </div>
              )}

              {/* Items table with shipped checkboxes */}
              <div className="bg-card border rounded-xl overflow-hidden shadow-sm mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Part #</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Brand</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Seller</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Shipped?</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Round</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedPo.items.map((it) => {
                      const alreadyDispatched = it.dispatch_round_shipped != null;
                      const isShipped = it.shipped_status === "shipped";
                      return (
                        <tr key={it.id} className={`${alreadyDispatched ? "opacity-50" : "hover:bg-muted/30"}`}>
                          <td className="px-3 py-2.5">
                            <div className="font-mono font-semibold text-xs">{it.part_number || "—"}</div>
                            {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-xs">{it.brand || "—"}</td>
                          <td className="px-3 py-2.5 text-right text-xs">{it.qty}</td>
                          <td className="px-3 py-2.5 text-xs">{it.vendor_name || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2.5 text-center">
                            {alreadyDispatched ? (
                              <Check className="w-4 h-4 text-emerald-500 mx-auto" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={isShipped}
                                onChange={() => toggleItemShipped(it.id, it.shipped_status)}
                                className="w-4 h-4 rounded accent-accent cursor-pointer"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                            {it.dispatch_round_shipped ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {selectedPo.items.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-xs">No items</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Submit Day form */}
              <div className="bg-card border rounded-xl p-4 shadow-sm">
                <div className="font-semibold text-sm mb-3">Submit Day Dispatch</div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <label className="text-xs font-semibold block">
                    Docket / AWB Number <span className="text-red-500">*</span>
                    <input
                      value={submitDocket}
                      onChange={(e) => setSubmitDocket(e.target.value)}
                      placeholder="e.g. 123456789"
                      className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-semibold block">
                    Courier
                    <input
                      value={submitCourier}
                      onChange={(e) => setSubmitCourier(e.target.value)}
                      placeholder="e.g. Delhivery, DTDC"
                      className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {selectedPo.items.filter((it) => it.shipped_status === "shipped" && it.dispatch_round_shipped == null).length} item(s) marked shipped (new)
                  </p>
                  <button
                    onClick={submitDay}
                    disabled={submitting || !submitDocket}
                    className="px-5 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                    ) : (
                      <><Truck className="w-4 h-4" /> Submit Day</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* PO List view */
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold text-lg">Active Purchase Orders</h2>
                <span className="text-xs text-muted-foreground">Auto-refreshes every 15s</span>
              </div>

              {poLoading && (
                <div className="py-8 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </div>
              )}

              {!poLoading && activePOs.length === 0 && (
                <div className="py-12 text-center text-muted-foreground border border-dashed rounded-xl text-sm">
                  No active POs in queue.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activePOs.map((po) => {
                  const progress = po.item_count > 0 ? Math.round((po.shipped_count / po.item_count) * 100) : 0;
                  return (
                    <div
                      key={po.id}
                      onClick={() => loadPoDetail(po.id)}
                      className="bg-card border rounded-xl p-4 shadow-sm cursor-pointer hover:border-accent transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-bold text-sm">{po.po_number}</div>
                          {po.customer_name && (
                            <div className="text-xs text-muted-foreground mt-0.5">{po.customer_name}</div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          po.status === "fulfilled" ? "bg-emerald-100 text-emerald-700" :
                          po.status === "partial" ? "bg-blue-100 text-blue-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>{po.status}</span>
                      </div>
                      {po.ship_to_name && (
                        <div className="text-xs text-muted-foreground mb-2">Ship to: {po.ship_to_name}</div>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {po.shipped_count}/{po.item_count} shipped
                        </span>
                      </div>
                      {po.dispatch_round && po.dispatch_round > 1 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Round {po.dispatch_round - 1} dispatched
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legacy dispatch modal */}
      {dispatchItem && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setDispatchItem(null)}
        >
          <div
            className="bg-card rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg mb-1">Dispatch {dispatchItem.partNumber}</h2>
            <p className="text-xs text-muted-foreground mb-4">
              To {dispatchItem.clientName} ({dispatchItem.clientCity})
            </p>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">
                Docket / AWB Number
                <input
                  value={docket}
                  onChange={(e) => setDocket(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold block">
                Courier
                <input
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                  placeholder="e.g. Delhivery, DTDC"
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDispatchItem(null)} className="px-4 py-2 border rounded-lg text-sm">
                Cancel
              </button>
              <button
                onClick={() => setStatus.mutate({ id: dispatchItem.id, status: "dispatched", docket_no: docket, courier })}
                disabled={setStatus.isPending}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                Confirm Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
