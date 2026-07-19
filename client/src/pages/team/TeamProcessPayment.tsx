// R27.32c frontend — Process Payment for the Data Team panel. A faithful mirror of
// client/src/pages/admin/AdminProcessPayment.tsx, wired to the team surface:
//   - TeamLayout shell instead of AdminLayout
//   - teamFetch / useTeamAuth (x-team-token) instead of adminFetch / useAdminAuth
//   - /api/team/customers for the client dropdown
// Backend /api/payments/* accepts both admin and team tokens (R27.32c dual-auth guard),
// so this page hits the exact same endpoints. Two tabs:
//   1. Process Vendors — filter POs, select, aggregate line items by vendor (rates
//      default from R9 quotes, inline-editable), generate a batch + download the ZIP.
//   2. Assign Payments — per-vendor payment queue: download slip, mark paid (with
//      optional proof upload), mark skipped, or bulk mark paid.
// Role-gated to admin | procurement | finance (matches the backend guard).
import { useEffect, useMemo, useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/queryClient";
import {
  RefreshCw, ChevronLeft, FileArchive, Download, Check, Ban, Loader2, Search,
  Trash2, Plus, RotateCcw,
} from "lucide-react";

const PAYMENT_ROLES = ["admin", "procurement", "finance", "data_team"];

// ---------------------------------------------------------------------------
// Types (mirror server/routes-payments.ts response shapes)
// ---------------------------------------------------------------------------
interface PoRow {
  id: number;
  po_number: string;
  client_id: number | null;
  client_name: string | null;
  created_at: string;
  status: string;
  total_amount: number;
  vendor_count: number;
  already_in_batch: boolean;
  last_batch_slip: string | null;
}
interface AggItem { po_item_id: number | null; item_name: string; qty: number; rate_default: number; amount: number; }
interface AggPo { po_id: number; po_number: string; items: AggItem[]; }
interface AggVendor {
  vendor_name: string;
  already_processed: boolean;
  last_slip_number: string | null;
  last_batch_date: string | null;
  pos: AggPo[];
  vendor_total: number;
}
// Editable working copy: per item we carry a mutable rate and a checked flag
// (item-level selection; only checked items are sent to /generate).
// R27.33 adds qty editing, deletion, custom items and per-vendor GST.
type OverrideSource = "original" | "qty_modified" | "manually_added" | "removed";
type PoScope = "slip_only" | "update_po";
type GstMode = "exclusive" | "inclusive"; // R27.33a
const GST_PRESETS = [0, 5, 12, 18, 28]; // R27.33a quick-preset pills next to the free % input
interface EditItem extends AggItem {
  rate: number;
  checked: boolean;
  originalQty: number;         // snapshot for the "modified" indicator
  overrideSource: OverrideSource;
}
interface EditPo { po_id: number; po_number: string; items: EditItem[]; scope: PoScope; }
interface EditVendor {
  vendor_name: string;
  already_processed: boolean;
  last_slip_number: string | null;
  last_batch_date: string | null;
  pos: EditPo[];
  gstPercent: number;          // R27.33 per-vendor GST %, default 18
  gstMode: GstMode;            // R27.33a exclusive (default) | inclusive
}

interface BatchVendorRow {
  id: number;
  batch_id: number;
  vendor_name: string;
  total_amount: number;
  status: "pending" | "paid" | "skipped";
  po_numbers: string | null;
  paid_at: number | null;
  paid_by_name: string | null;
  proof_url: string | null;
  skip_reason: string | null;
  notes: string | null;
  slip_number: string;
  batch_date: string;
  batch_notes: string | null;
}
interface Customer { id: number; name: string; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function vendorSlug(name: string): string {
  return (name || "vendor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "vendor";
}

// Stream a fetch Response body to a browser download via blob + object URL.
async function downloadBlob(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^"]+)"?/.exec(cd);
  const name = m ? m[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function TeamProcessPayment() {
  const { user } = useTeamAuth();
  const [tab, setTab] = useState<"process" | "assign">("process");
  const allowed = PAYMENT_ROLES.includes((user?.role as string) || "");

  if (!allowed) {
    return (
      <TeamLayout title="Process Payment">
        <div className="bg-card border rounded-xl p-12 text-center" data-testid="payments-forbidden">
          <div className="text-lg font-bold text-rose-600 mb-1">403 — Access denied</div>
          <div className="text-sm text-muted-foreground">
            Process Payment is available to admin, procurement, finance and data team roles only.
          </div>
        </div>
      </TeamLayout>
    );
  }

  return (
    <TeamLayout title="Process Payment">
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        <TabBtn active={tab === "process"} onClick={() => setTab("process")} testid="tab-process-vendors">
          Process Vendors
        </TabBtn>
        <TabBtn active={tab === "assign"} onClick={() => setTab("assign")} testid="tab-assign-payments">
          Assign Payments
        </TabBtn>
      </div>
      {tab === "process" ? <ProcessVendorsTab onGenerated={() => setTab("assign")} /> : <AssignPaymentsTab />}
    </TeamLayout>
  );
}

function TabBtn({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: any; testid: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={
        "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition " +
        (active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800")
      }
    >
      {children}
    </button>
  );
}

// ===========================================================================
// Tab 1 — Process Vendors
// ===========================================================================
function ProcessVendorsTab({ onGenerated }: { onGenerated: () => void }) {
  const { token } = useTeamAuth();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const [pos, setPos] = useState<PoRow[]>([]);
  const [loadingPos, setLoadingPos] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [step, setStep] = useState<"select" | "aggregate">("select");
  const [editVendors, setEditVendors] = useState<EditVendor[]>([]);
  const [notes, setNotes] = useState("");
  const [aggregating, setAggregating] = useState(false);
  const [generating, setGenerating] = useState(false);
  // R27.33 — "+ Add Custom Item" modal (scoped to the vendor block it was opened from).
  const [customModal, setCustomModal] = useState<{ vi: number } | null>(null);
  const [customForm, setCustomForm] = useState({ poId: "", itemName: "", qty: "1", rate: "0" });

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await teamFetch(token, `/api/team/customers?limit=500`);
        const d = await r.json();
        setCustomers(Array.isArray(d) ? d.map((c: any) => ({ id: c.id, name: c.name })) : []);
      } catch { /* dropdown just stays empty */ }
    })();
  }, [token]);

  async function loadPos() {
    if (!token) return;
    setLoadingPos(true);
    try {
      const p = new URLSearchParams();
      if (clientId) p.set("client_id", clientId);
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      if (status) p.set("status", status);
      const r = await teamFetch(token, `/api/payments/pos?${p}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d = await r.json();
      setPos(Array.isArray(d) ? d : []);
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "Failed to load POs", description: e.message, variant: "destructive" });
    } finally {
      setLoadingPos(false);
    }
  }
  useEffect(() => { loadPos(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    pos.forEach((p) => p.status && s.add(p.status));
    return Array.from(s).sort();
  }, [pos]);

  const allVisibleSelected = pos.length > 0 && pos.every((p) => selected.has(p.id));
  const selectedTotal = pos.reduce((s, p) => s + (selected.has(p.id) ? Number(p.total_amount) || 0 : 0), 0);
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(pos.map((p) => p.id)));
  }
  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function continueToAggregate() {
    if (!token || selected.size === 0) return;
    setAggregating(true);
    try {
      const r = await teamFetch(token, `/api/payments/aggregate`, {
        method: "POST",
        body: JSON.stringify({ po_ids: Array.from(selected) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d: { vendors: AggVendor[] } = await r.json();
      const edit: EditVendor[] = (d.vendors || []).map((v) => ({
        vendor_name: v.vendor_name,
        already_processed: v.already_processed,
        last_slip_number: v.last_slip_number,
        last_batch_date: v.last_batch_date,
        gstPercent: 18,
        gstMode: "exclusive" as GstMode,
        pos: v.pos.map((po) => ({
          po_id: po.po_id,
          po_number: po.po_number,
          scope: "slip_only" as PoScope,
          items: po.items.map((it) => ({
            ...it, rate: it.rate_default, checked: true,
            originalQty: it.qty, overrideSource: "original" as OverrideSource,
          })),
        })),
      }));
      if (edit.length === 0) {
        toast({ title: "Nothing to aggregate", description: "No vendor line items found for the selected POs.", variant: "destructive" });
        return;
      }
      setEditVendors(edit);
      setStep("aggregate");
    } catch (e: any) {
      toast({ title: "Aggregation failed", description: e.message, variant: "destructive" });
    } finally {
      setAggregating(false);
    }
  }

  // Deep-clone the working copy so state updates stay immutable, then apply `mut`.
  function mutateVendors(mut: (next: EditVendor[]) => void) {
    setEditVendors((prev) => {
      const next = prev.map((v) => ({ ...v, pos: v.pos.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i })) })) }));
      mut(next);
      return next;
    });
  }

  function setRate(vi: number, pi: number, ii: number, rate: number) {
    mutateVendors((next) => { next[vi].pos[pi].items[ii].rate = rate; });
  }

  // R27.33 — inline qty editing. A qty that differs from the original snapshot flags
  // the row as "qty_modified"; reverting to the original clears the flag. Manually
  // added rows keep their "manually_added" source regardless of qty.
  function setQty(vi: number, pi: number, ii: number, qty: number) {
    mutateVendors((next) => {
      const it = next[vi].pos[pi].items[ii];
      it.qty = qty;
      if (it.overrideSource === "manually_added") return;
      it.overrideSource = qty !== it.originalQty ? "qty_modified" : "original";
    });
  }

  // R27.33 — delete: flag as "removed" (strikethrough + Undo). Manually-added rows
  // are dropped outright since there is nothing to restore them from.
  function removeItem(vi: number, pi: number, ii: number) {
    mutateVendors((next) => {
      const items = next[vi].pos[pi].items;
      if (items[ii].overrideSource === "manually_added") items.splice(ii, 1);
      else items[ii].overrideSource = "removed";
    });
  }
  function undoRemove(vi: number, pi: number, ii: number) {
    mutateVendors((next) => {
      const it = next[vi].pos[pi].items[ii];
      it.overrideSource = it.qty !== it.originalQty ? "qty_modified" : "original";
    });
  }

  // R27.33 — per-PO scope. Flipping to "update_po" requires an explicit confirm since
  // it mutates the underlying Purchase Order.
  function setPoScope(vi: number, pi: number, scope: PoScope) {
    if (scope === "update_po") {
      const ok = window.confirm(
        "This will modify the original Purchase Order and may affect quotations, deviations, and downstream reports. Continue?",
      );
      if (!ok) return;
    }
    mutateVendors((next) => { next[vi].pos[pi].scope = scope; });
  }

  // R27.33a — free GST % entry (Option A). Accepts any value 0–28 incl. decimals;
  // blank/NaN resolves to 0. Preset pills call this with a fixed number.
  function setVendorGst(vi: number, pct: number) {
    mutateVendors((next) => {
      const clamped = !Number.isFinite(pct) ? 0 : Math.min(28, Math.max(0, pct));
      next[vi].gstPercent = clamped;
    });
  }

  function setVendorGstMode(vi: number, mode: GstMode) {
    mutateVendors((next) => { next[vi].gstMode = mode; });
  }

  function addCustomItem() {
    if (!customModal) return;
    const { vi } = customModal;
    const po = editVendors[vi]?.pos.find((p) => String(p.po_id) === customForm.poId);
    if (!po) { toast({ title: "Pick a PO", description: "Select a PO for the custom item.", variant: "destructive" }); return; }
    const name = customForm.itemName.trim();
    if (!name) { toast({ title: "Item name required", variant: "destructive" }); return; }
    const qty = Number(customForm.qty) || 0;
    const rate = Number(customForm.rate) || 0;
    mutateVendors((next) => {
      const target = next[vi].pos.find((p) => p.po_id === po.po_id)!;
      target.items.push({
        po_item_id: null, item_name: name, qty, rate_default: rate, amount: Math.round(qty * rate * 100) / 100,
        rate, checked: true, originalQty: qty, overrideSource: "manually_added",
      });
    });
    setCustomModal(null);
    setCustomForm({ poId: "", itemName: "", qty: "1", rate: "0" });
  }

  // item-level toggle.
  function toggleItem(vi: number, pi: number, ii: number) {
    mutateVendors((next) => {
      const it = next[vi].pos[pi].items[ii];
      it.checked = !it.checked;
    });
  }

  // PO-level toggle: if every item under the PO is checked, uncheck all;
  // otherwise check all (so a partial/none state resolves to fully-checked).
  function togglePo(vi: number, pi: number) {
    mutateVendors((next) => {
      const items = next[vi].pos[pi].items.filter((i) => i.overrideSource !== "removed");
      const allOn = items.length > 0 && items.every((i) => i.checked);
      items.forEach((i) => { i.checked = !allOn; });
    });
  }

  // Only checked, non-removed items contribute to a vendor subtotal.
  const isPayable = (i: EditItem) => i.checked && i.overrideSource !== "removed";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // Σ rate × qty as entered by the team — mode-agnostic raw figure.
  const vendorRawTotal = (v: EditVendor) =>
    v.pos.reduce((s, p) => s + p.items.reduce((ss, i) => ss + (isPayable(i) ? (Number(i.qty) || 0) * (Number(i.rate) || 0) : 0), 0), 0);
  // R27.33a — inclusive extracts the taxable value out of the entered rate; exclusive
  // (default) adds GST on top. Mirrors the server calc in routes-payments.ts.
  const vendorTotals = (v: EditVendor) => {
    const raw = vendorRawTotal(v);
    const pct = Number(v.gstPercent) || 0;
    if (v.gstMode === "inclusive") {
      const subtotal = pct > 0 ? r2(raw / (1 + pct / 100)) : raw;
      return { subtotal, gst: r2(raw - subtotal), total: r2(raw) };
    }
    const gst = r2(raw * (pct / 100));
    return { subtotal: r2(raw), gst, total: r2(raw + gst) };
  };
  const grandTotal = editVendors.reduce((s, v) => s + vendorTotals(v).total, 0);
  const checkedItemCount = editVendors.reduce(
    (s, v) => s + v.pos.reduce((ss, p) => ss + p.items.filter(isPayable).length, 0), 0);

  async function generate() {
    if (!token) return;
    setGenerating(true);
    try {
      // only checked items are sent; vendors left with no payable items drop out.
      // R27.33 — carry qty/override provenance + per-PO scope + per-vendor GST. A removed
      // item is sent ONLY when its PO scope is "update_po" (so the backend can soft-delete
      // the po_item); slip-only removals simply never leave the browser.
      const vendors = editVendors.map((v) => ({
        vendor_name: v.vendor_name,
        gst_percent: Number(v.gstPercent) || 0,
        gst_mode: v.gstMode,
        items: v.pos.flatMap((p) =>
          p.items
            .filter((i) => {
              if (i.overrideSource === "removed") return p.scope === "update_po";
              return i.checked;
            })
            .map((i) => {
              const qty = Number(i.qty) || 0;
              const rate = Number(i.rate) || 0;
              return {
                po_id: p.po_id,
                po_item_id: i.po_item_id,
                item_name: i.item_name,
                qty,
                rate_locked: rate,
                amount_locked: Math.round(qty * rate * 100) / 100,
                override_source: i.overrideSource,
                original_qty: i.originalQty,
                scope: p.scope,
              };
            }),
        ),
      })).filter((v) => v.items.length > 0);
      const r = await teamFetch(token, `/api/payments/generate`, {
        method: "POST",
        body: JSON.stringify({ vendors, notes: notes || undefined, gst_default_percent: 18, gst_default_mode: "exclusive" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const slip = r.headers.get("X-Slip-Number") || "batch";
      await downloadBlob(r, `${slip.replace(/\//g, "-")}.zip`);
      toast({
        title: `Batch ${slip} created`,
        description: `${vendors.length} vendor(s) — ${inr(grandTotal)} total. ZIP downloaded.`,
      });
      // Reset and move to the queue.
      setStep("select");
      setEditVendors([]);
      setNotes("");
      setSelected(new Set());
      await loadPos();
      onGenerated();
    } catch (e: any) {
      toast({ title: "Generate failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  // ---- Step 2: vendor aggregation view ------------------------------------
  if (step === "aggregate") {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setStep("select")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            data-testid="button-back-to-select"
          >
            <ChevronLeft className="w-4 h-4" /> Back to PO selection
          </button>
          <div className="text-sm text-slate-500">
            Grand total: <strong className="text-slate-900" data-testid="text-grand-total">{inr(grandTotal)}</strong>
          </div>
        </div>

        <div className="space-y-4">
          {editVendors.map((v, vi) => (
            <div key={v.vendor_name} className="bg-card border rounded-xl overflow-hidden" data-testid={`card-vendor-${vendorSlug(v.vendor_name)}`}>
              <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{v.vendor_name}</span>
                  {v.already_processed && (
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700" data-testid={`badge-vendor-processed-${vendorSlug(v.vendor_name)}`}>
                      Previously processed{v.last_slip_number ? ` · ${v.last_slip_number}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {/* R27.33a — GST mode toggle (exclusive default | inclusive) */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <span>Mode</span>
                    <div className="inline-flex rounded-lg border overflow-hidden" role="group" aria-label="GST mode">
                      {(["exclusive", "inclusive"] as GstMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setVendorGstMode(vi, m)}
                          className={`px-2.5 py-1 capitalize transition-colors ${v.gstMode === m ? "bg-indigo-600 text-white" : "bg-background text-slate-600 hover:bg-slate-100"}`}
                          data-testid={`toggle-vendor-gstmode-${m}-${vendorSlug(v.vendor_name)}`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* R27.33a — free GST % input (Option A) + quick presets */}
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <span>GST%</span>
                    <input
                      type="number" step="0.01" min="0" max="28"
                      value={Number.isFinite(v.gstPercent) ? v.gstPercent : ""}
                      onChange={(e) => setVendorGst(vi, parseFloat(e.target.value))}
                      onBlur={(e) => { if (e.target.value === "") setVendorGst(vi, 0); }}
                      className="w-16 border rounded-lg px-2 py-1 bg-background text-right"
                      placeholder="%"
                      data-testid={`input-vendor-gst-${vendorSlug(v.vendor_name)}`}
                    />
                    <div className="hidden sm:flex items-center gap-1">
                      {GST_PRESETS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setVendorGst(vi, g)}
                          className={`px-1.5 py-0.5 rounded border text-[11px] transition-colors ${(Number(v.gstPercent) || 0) === g ? "bg-indigo-600 text-white border-indigo-600" : "bg-background text-slate-500 hover:bg-slate-100"}`}
                          data-testid={`preset-vendor-gst-${g}-${vendorSlug(v.vendor_name)}`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* R27.33 / R27.33a — live vendor totals (mode-aware) */}
                  {(() => {
                    const t = vendorTotals(v);
                    return (
                      <div className="text-sm text-right" data-testid={`text-vendor-totals-${vendorSlug(v.vendor_name)}`}>
                        <div className="text-xs text-slate-500">
                          {v.gstMode === "inclusive"
                            ? `Total ${inr(t.total)}${t.gst > 0 ? ` (incl. GST ${inr(t.gst)}, taxable ${inr(t.subtotal)})` : ""}`
                            : `Subtotal ${inr(t.subtotal)}${t.gst > 0 ? ` · GST ${inr(t.gst)}` : ""}`}
                        </div>
                        <div>Vendor total: <strong>{inr(t.total)}</strong></div>
                      </div>
                    );
                  })()}
                </div>
              </div>
              {v.pos.map((po, pi) => {
                const poAllChecked = po.items.filter((i) => i.overrideSource !== "removed").length > 0
                  && po.items.every((i) => i.overrideSource === "removed" || i.checked);
                const poSomeChecked = po.items.some((i) => i.overrideSource !== "removed" && i.checked);
                return (
                <div key={po.po_id} className="border-b last:border-b-0">
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={poAllChecked}
                        ref={(el) => { if (el) el.indeterminate = poSomeChecked && !poAllChecked; }}
                        onChange={() => togglePo(vi, pi)}
                        data-testid={`checkbox-po-${po.po_id}`}
                      />
                      {po.po_number}
                    </label>
                    {/* R27.33 — per-PO scope toggle. Default "Only this slip" (safe). */}
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 normal-case">
                      Apply to:
                      <select
                        value={po.scope}
                        onChange={(e) => setPoScope(vi, pi, e.target.value as PoScope)}
                        className="border rounded-lg px-2 py-1 bg-background"
                        data-testid={`select-po-scope-${po.po_id}`}
                      >
                        <option value="slip_only">Only this slip</option>
                        <option value="update_po">Update PO too</option>
                      </select>
                    </label>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-semibold w-8"></th>
                        <th className="px-4 py-2 font-semibold">Item</th>
                        <th className="px-4 py-2 font-semibold text-right w-24">Qty</th>
                        <th className="px-4 py-2 font-semibold text-right w-40">Rate (₹)</th>
                        <th className="px-4 py-2 font-semibold text-right w-40">Amount</th>
                        <th className="px-4 py-2 font-semibold text-right w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((it, ii) => {
                        const removed = it.overrideSource === "removed";
                        const modified = it.overrideSource === "qty_modified";
                        const added = it.overrideSource === "manually_added";
                        const rowBorder = removed ? "border-l-4 border-l-slate-300"
                          : modified ? "border-l-4 border-l-yellow-400"
                          : added ? "border-l-4 border-l-green-500" : "";
                        return (
                        <tr key={ii} className={"border-t " + rowBorder + " " + (removed ? "bg-slate-50 text-slate-400" : it.checked ? "" : "opacity-50")}>
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={it.checked}
                              disabled={removed}
                              onChange={() => toggleItem(vi, pi, ii)}
                              data-testid={`checkbox-item-${po.po_id}-${it.po_item_id ?? `${pi}-${ii}`}`}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <span className={removed ? "line-through" : ""}>{it.item_name}</span>
                            {modified && <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-700" data-testid="badge-item-modified">modified</span>}
                            {added && <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-700" data-testid="badge-item-added">added</span>}
                            {removed && <span className="ml-2 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-400/20 text-slate-500" data-testid="badge-item-removed">removed</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {removed ? (
                              <span className="line-through">{it.qty}</span>
                            ) : (
                              <input
                                type="number" step="1" min="1"
                                value={it.qty}
                                onChange={(e) => setQty(vi, pi, ii, parseFloat(e.target.value) || 0)}
                                className="w-20 border rounded-lg px-2 py-1 bg-background text-right"
                                data-testid={`input-vendor-qty-${vendorSlug(v.vendor_name)}-${it.po_item_id ?? `${pi}-${ii}`}`}
                              />
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {removed ? (
                              <span className="line-through">{inr(it.rate)}</span>
                            ) : (
                              <input
                                type="number" step="0.01" min="0"
                                value={it.rate}
                                onChange={(e) => setRate(vi, pi, ii, parseFloat(e.target.value) || 0)}
                                className="w-32 border rounded-lg px-2 py-1 bg-background text-right"
                                data-testid={`input-vendor-rate-${vendorSlug(v.vendor_name)}-${it.po_item_id ?? `${pi}-${ii}`}`}
                              />
                            )}
                          </td>
                          <td className={"px-4 py-2 text-right font-medium " + (removed ? "line-through" : "")}>{inr((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
                          <td className="px-4 py-2 text-right">
                            {removed ? (
                              <button
                                onClick={() => undoRemove(vi, pi, ii)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                                data-testid={`button-undo-item-${po.po_id}-${it.po_item_id ?? `${pi}-${ii}`}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Undo
                              </button>
                            ) : (
                              <button
                                onClick={() => removeItem(vi, pi, ii)}
                                className="text-slate-400 hover:text-rose-600"
                                title="Remove from slip"
                                data-testid={`button-remove-item-${po.po_id}-${it.po_item_id ?? `${pi}-${ii}`}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                );
              })}
              {/* R27.33 — add an ad-hoc line item to this vendor's slip */}
              <div className="px-4 py-3 border-t">
                <button
                  onClick={() => { setCustomForm({ poId: String(v.pos[0]?.po_id ?? ""), itemName: "", qty: "1", rate: "0" }); setCustomModal({ vi }); }}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 border border-dashed rounded-lg px-3 py-1.5 hover:bg-muted"
                  data-testid={`button-add-custom-item-${vendorSlug(v.vendor_name)}`}
                >
                  <Plus className="w-4 h-4" /> Add Custom Item
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* R27.33 — Add Custom Item modal */}
        {customModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="modal-add-custom-item">
            <div className="bg-card border rounded-xl w-full max-w-md p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900">Add Custom Item</h3>
                <span className="text-xs text-slate-500">{editVendors[customModal.vi]?.vendor_name}</span>
              </div>
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">PO #</div>
                <select
                  value={customForm.poId}
                  onChange={(e) => setCustomForm((f) => ({ ...f, poId: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 bg-background"
                  data-testid="select-custom-po"
                >
                  {editVendors[customModal.vi]?.pos.map((p) => <option key={p.po_id} value={p.po_id}>{p.po_number}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Item name</div>
                <input
                  type="text" value={customForm.itemName}
                  onChange={(e) => setCustomForm((f) => ({ ...f, itemName: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 bg-background"
                  data-testid="input-custom-item-name"
                />
              </label>
              <div className="flex gap-3">
                <label className="block text-sm flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Qty</div>
                  <input
                    type="number" step="1" min="1" value={customForm.qty}
                    onChange={(e) => setCustomForm((f) => ({ ...f, qty: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 bg-background text-right"
                    data-testid="input-custom-item-qty"
                  />
                </label>
                <label className="block text-sm flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Rate (₹)</div>
                  <input
                    type="number" step="0.01" min="0" value={customForm.rate}
                    onChange={(e) => setCustomForm((f) => ({ ...f, rate: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 bg-background text-right"
                    data-testid="input-custom-item-rate"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setCustomModal(null)}
                  className="px-4 py-2 border rounded-lg font-semibold text-sm hover:bg-muted"
                  data-testid="button-custom-cancel"
                >Cancel</button>
                <button
                  onClick={addCustomItem}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm"
                  data-testid="button-custom-add"
                >Add Item</button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm">
            <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes (optional)</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 bg-background"
              placeholder="Any note to record on this batch…"
              data-testid="textarea-generate-notes"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {checkedItemCount === 0 && (
            <div className="text-sm font-medium text-rose-600" data-testid="text-no-items-selected">
              Select at least one item to generate
            </div>
          )}
          <div className="text-sm text-slate-500">
            {checkedItemCount} item(s) · <strong className="text-slate-900">{inr(grandTotal)}</strong>
          </div>
          <button
            onClick={generate}
            disabled={generating || checkedItemCount === 0}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="button-generate-slips"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
            Generate Slips
          </button>
        </div>
      </div>
    );
  }

  // ---- Step 1: PO selection -----------------------------------------------
  return (
    <div>
      {/* sticky action bar: appears the moment ≥1 PO is selected so the
          user never has to scroll to the bottom Continue button. */}
      {selected.size > 0 && (
        <div
          className="sticky top-[73px] z-10 -mx-6 px-6 py-3 mb-4 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm flex items-center justify-between"
          data-testid="bar-selection-sticky"
        >
          <div className="text-sm text-slate-700">
            <strong className="text-slate-900">{selected.size}</strong> PO{selected.size === 1 ? "" : "s"} selected · <strong className="text-slate-900">{inr(selectedTotal)}</strong> total
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 border rounded-lg font-semibold text-sm hover:bg-muted"
              data-testid="button-clear-selection"
            >
              Clear selection
            </button>
            <button
              onClick={continueToAggregate}
              disabled={aggregating}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="button-continue-top"
            >
              {aggregating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Continue →
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end mb-4">
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Client</div>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm min-w-52"
            data-testid="select-client"
          >
            <option value="">All clients</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">From</div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-date-from" />
        </label>
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">To</div>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-date-to" />
        </label>
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm min-w-36" data-testid="select-po-status">
            <option value="">All</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button
          onClick={loadPos}
          className="px-4 py-2 border rounded-lg font-semibold text-sm inline-flex items-center gap-2 hover:bg-muted"
          data-testid="button-refresh-pos"
        >
          <RefreshCw className={"w-4 h-4 " + (loadingPos ? "animate-spin" : "")} /> Refresh
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {loadingPos ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}
          </div>
        ) : pos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground" data-testid="empty-pos">No POs match your filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} data-testid="checkbox-select-all-pos" />
                </th>
                <th className="px-4 py-3 font-semibold">PO #</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold text-right">Vendors</th>
                <th className="px-4 py-3 font-semibold text-right">Total Value</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pos.map((p) => (
                <tr key={p.id} data-testid={`row-po-${p.id}`} className={selected.has(p.id) ? "bg-indigo-50/50" : ""}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} data-testid={`select-po-${p.id}`} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.po_number}
                    {p.already_in_batch && (
                      <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700" data-testid={`badge-po-processed-${p.id}`}>
                        Processed{p.last_batch_slip ? ` · ${p.last_batch_slip}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{p.client_name || `#${p.client_id ?? "—"}`}</td>
                  <td className="px-4 py-3 text-xs">{p.created_at || "—"}</td>
                  <td className="px-4 py-3 text-right">{p.vendor_count}</td>
                  <td className="px-4 py-3 text-right font-medium">{inr(p.total_amount)}</td>
                  <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-500/15 text-slate-700">{p.status || "—"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <div className="text-sm text-slate-500" data-testid="text-selected-count">{selected.size} selected</div>
        <button
          onClick={continueToAggregate}
          disabled={selected.size === 0 || aggregating}
          className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="button-continue-aggregate"
        >
          {aggregating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Continue
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Tab 2 — Assign Payments
// ===========================================================================
interface GroupedBatch {
  batch_id: number;
  slip_number: string;
  batch_date: string;
  batch_notes: string | null;
  vendors: BatchVendorRow[];
  total: number;
  paid: number;
  pending: number;
  skipped: number;
}

function AssignPaymentsTab() {
  const { token } = useTeamAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<BatchVendorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchSearch, setBatchSearch] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<number>>(new Set());

  // Dialog state
  const [paidTarget, setPaidTarget] = useState<BatchVendorRow | null>(null);
  const [paidNotes, setPaidNotes] = useState("");
  const [paidFile, setPaidFile] = useState<File | null>(null);
  const [skipTarget, setSkipTarget] = useState<BatchVendorRow | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNotes, setBulkNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (vendorSearch) p.set("vendor_search", vendorSearch);
      const r = await teamFetch(token, `/api/payments/batches?${p}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d = await r.json();
      setRows(Array.isArray(d) ? d : []);
    } catch (e: any) {
      toast({ title: "Failed to load batches", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token, statusFilter, vendorSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const batches: GroupedBatch[] = useMemo(() => {
    const map = new Map<number, GroupedBatch>();
    for (const r of rows) {
      if (!map.has(r.batch_id)) {
        map.set(r.batch_id, {
          batch_id: r.batch_id,
          slip_number: r.slip_number,
          batch_date: r.batch_date,
          batch_notes: r.batch_notes,
          vendors: [], total: 0, paid: 0, pending: 0, skipped: 0,
        });
      }
      const g = map.get(r.batch_id)!;
      g.vendors.push(r);
      g.total += Number(r.total_amount) || 0;
      if (r.status === "paid") g.paid++;
      else if (r.status === "skipped") g.skipped++;
      else g.pending++;
    }
    let list = Array.from(map.values());
    const q = batchSearch.trim().toLowerCase();
    if (q) list = list.filter((b) => b.slip_number.toLowerCase().includes(q));
    return list; // already in created_at DESC order from the backend
  }, [rows, batchSearch]);

  const selectedBatch = batches.find((b) => b.batch_id === selectedBatchId) || null;
  // Keep a valid selection when the list changes.
  useEffect(() => {
    if (batches.length === 0) { setSelectedBatchId(null); return; }
    if (!batches.some((b) => b.batch_id === selectedBatchId)) setSelectedBatchId(batches[0].batch_id);
  }, [batches, selectedBatchId]);

  const pendingInBatch = selectedBatch ? selectedBatch.vendors.filter((v) => v.status === "pending") : [];
  const allPendingSelected = pendingInBatch.length > 0 && pendingInBatch.every((v) => selectedVendorIds.has(v.id));

  function toggleVendorSel(id: number) {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAllPending() {
    setSelectedVendorIds(allPendingSelected ? new Set() : new Set(pendingInBatch.map((v) => v.id)));
  }

  async function downloadSlip(v: BatchVendorRow) {
    if (!token) return;
    try {
      const r = await teamFetch(token, `/api/payments/batches/${v.id}/slip`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await downloadBlob(r, `${v.slip_number.replace(/\//g, "-")}_${vendorSlug(v.vendor_name)}.jpg`);
    } catch (e: any) {
      toast({ title: "Slip download failed", description: e.message, variant: "destructive" });
    }
  }

  async function uploadProof(file: File): Promise<string | null> {
    if (!token) return null;
    const fd = new FormData();
    fd.append("proof", file);
    // Direct fetch: FormData must not carry a JSON Content-Type (teamFetch would set one).
    const r = await fetch(apiUrl(`/api/payments/proof-upload`), {
      method: "POST",
      headers: { "x-team-token": token },
      body: fd,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const d = await r.json();
    return d.proof_url || null;
  }

  async function confirmMarkPaid() {
    if (!token || !paidTarget) return;
    setSubmitting(true);
    try {
      let proof_url: string | undefined;
      if (paidFile) {
        const url = await uploadProof(paidFile);
        proof_url = url || undefined;
      }
      const r = await teamFetch(token, `/api/payments/batches/${paidTarget.id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ notes: paidNotes || undefined, proof_url }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: "Marked paid", description: `${paidTarget.vendor_name} — ${inr(paidTarget.total_amount)}` });
      setPaidTarget(null); setPaidNotes(""); setPaidFile(null);
      await load();
    } catch (e: any) {
      toast({ title: "Mark paid failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmMarkSkipped() {
    if (!token || !skipTarget) return;
    if (!skipReason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const r = await teamFetch(token, `/api/payments/batches/${skipTarget.id}/mark-skipped`, {
        method: "POST",
        body: JSON.stringify({ skip_reason: skipReason.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      toast({ title: "Marked skipped", description: skipTarget.vendor_name });
      setSkipTarget(null); setSkipReason("");
      await load();
    } catch (e: any) {
      toast({ title: "Mark skipped failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmBulkPaid() {
    if (!token) return;
    const ids = Array.from(selectedVendorIds);
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      const r = await teamFetch(token, `/api/payments/batches/bulk-mark-paid`, {
        method: "POST",
        body: JSON.stringify({ vendor_ids: ids, notes: bulkNotes || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const d = await r.json();
      toast({ title: "Bulk marked paid", description: `${d.updated ?? ids.length} vendor(s) updated.` });
      setBulkOpen(false); setBulkNotes(""); setSelectedVendorIds(new Set());
      await load();
    } catch (e: any) {
      toast({ title: "Bulk mark paid failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-end mb-4">
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Batch #</div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)} placeholder="PMT/2026/…" className="border rounded-lg pl-8 pr-3 py-2 bg-background text-sm" data-testid="input-batch-search" />
          </div>
        </label>
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Vendor</div>
          <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Vendor name…" className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-vendor-search" />
        </label>
        <label className="text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Status</div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="select-batch-status">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>
        <button onClick={load} className="px-4 py-2 border rounded-lg font-semibold text-sm inline-flex items-center gap-2 hover:bg-muted" data-testid="button-refresh-batches">
          <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Batch list */}
        <div className="bg-card border rounded-xl overflow-hidden lg:col-span-1">
          <div className="px-4 py-3 border-b bg-muted/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">Batches</div>
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}</div>
          ) : batches.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-batches">No batches yet.</div>
          ) : (
            <div className="divide-y max-h-[70vh] overflow-y-auto">
              {batches.map((b) => (
                <button
                  key={b.batch_id}
                  onClick={() => { setSelectedBatchId(b.batch_id); setSelectedVendorIds(new Set()); }}
                  className={"w-full text-left px-4 py-3 hover:bg-muted/50 transition " + (b.batch_id === selectedBatchId ? "bg-indigo-50" : "")}
                  data-testid={`row-batch-${b.batch_id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-indigo-700">{b.slip_number}</span>
                    <span className="text-xs text-slate-500">{b.batch_date}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="text-emerald-700">{b.paid} paid</span>
                    <span className="text-slate-500">{b.pending} pending</span>
                    <span className="text-rose-600">{b.skipped} skipped</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{b.vendors.length} vendor(s) · {inr(b.total)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Vendor queue */}
        <div className="bg-card border rounded-xl overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {selectedBatch ? `Vendors — ${selectedBatch.slip_number}` : "Vendors"}
            </span>
            {pendingInBatch.length > 0 && (
              <button
                onClick={() => setBulkOpen(true)}
                disabled={selectedVendorIds.size === 0}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                data-testid="button-bulk-mark-paid"
              >
                <Check className="w-3.5 h-3.5" /> Bulk Mark Paid ({selectedVendorIds.size})
              </button>
            )}
          </div>
          {!selectedBatch ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Select a batch to view its vendors.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-3 w-8">
                      {pendingInBatch.length > 0 && (
                        <input type="checkbox" checked={allPendingSelected} onChange={toggleAllPending} data-testid="checkbox-select-all-pending" />
                      )}
                    </th>
                    <th className="px-3 py-3 font-semibold">Vendor</th>
                    <th className="px-3 py-3 font-semibold">PO Refs</th>
                    <th className="px-3 py-3 font-semibold text-right">Amount</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold">Proof</th>
                    <th className="px-3 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedBatch.vendors.map((v) => (
                    <tr key={v.id} data-testid={`row-batch-vendor-${v.id}`}>
                      <td className="px-3 py-3">
                        {v.status === "pending" && (
                          <input type="checkbox" checked={selectedVendorIds.has(v.id)} onChange={() => toggleVendorSel(v.id)} data-testid={`checkbox-vendor-${v.id}`} />
                        )}
                      </td>
                      <td className="px-3 py-3 font-medium">{v.vendor_name}</td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-500">{v.po_numbers || "—"}</td>
                      <td className="px-3 py-3 text-right font-medium">{inr(v.total_amount)}</td>
                      <td className="px-3 py-3"><StatusBadge status={v.status} /></td>
                      <td className="px-3 py-3">
                        {v.proof_url ? (
                          <a href={apiUrl(v.proof_url)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-xs" data-testid={`link-proof-${v.id}`}>View</a>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => downloadSlip(v)} title="Download slip" className="p-1.5 hover:bg-muted rounded text-slate-600" data-testid={`button-download-slip-${v.id}`}>
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setPaidTarget(v); setPaidNotes(""); setPaidFile(null); }}
                            disabled={v.status !== "pending"}
                            className="px-2 py-1 text-xs rounded bg-emerald-500/15 text-emerald-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                            data-testid={`button-mark-paid-${v.id}`}
                          >
                            <Check className="w-3.5 h-3.5" /> Paid
                          </button>
                          <button
                            onClick={() => { setSkipTarget(v); setSkipReason(""); }}
                            disabled={v.status !== "pending"}
                            className="px-2 py-1 text-xs rounded bg-rose-500/15 text-rose-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                            data-testid={`button-mark-skipped-${v.id}`}
                          >
                            <Ban className="w-3.5 h-3.5" /> Skip
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Mark Paid dialog */}
      {paidTarget && (
        <Modal title={`Mark Paid — ${paidTarget.vendor_name}`} onClose={() => setPaidTarget(null)} testid="dialog-mark-paid">
          <div className="text-sm text-slate-500 mb-3">Amount: <strong className="text-slate-900">{inr(paidTarget.total_amount)}</strong></div>
          <FieldLabel label="Notes (optional)">
            <textarea value={paidNotes} onChange={(e) => setPaidNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-mark-paid-notes" />
          </FieldLabel>
          <FieldLabel label="Proof (image/PDF, optional)">
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setPaidFile(e.target.files?.[0] || null)} className="w-full text-sm" data-testid="input-mark-paid-proof" />
          </FieldLabel>
          <ModalFooter onCancel={() => setPaidTarget(null)} onConfirm={confirmMarkPaid} confirmLabel="Mark Paid" submitting={submitting} confirmTestid="button-confirm-mark-paid" />
        </Modal>
      )}

      {/* Mark Skipped dialog */}
      {skipTarget && (
        <Modal title={`Mark Skipped — ${skipTarget.vendor_name}`} onClose={() => setSkipTarget(null)} testid="dialog-mark-skipped">
          <FieldLabel label="Reason *">
            <textarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Why is this vendor being skipped?" data-testid="input-skip-reason" />
          </FieldLabel>
          <ModalFooter onCancel={() => setSkipTarget(null)} onConfirm={confirmMarkSkipped} confirmLabel="Mark Skipped" submitting={submitting} confirmTestid="button-confirm-mark-skipped" />
        </Modal>
      )}

      {/* Bulk paid dialog */}
      {bulkOpen && (
        <Modal title={`Bulk Mark Paid — ${selectedVendorIds.size} vendor(s)`} onClose={() => setBulkOpen(false)} testid="dialog-bulk-paid">
          <FieldLabel label="Notes (optional)">
            <textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-bulk-notes" />
          </FieldLabel>
          <ModalFooter onCancel={() => setBulkOpen(false)} onConfirm={confirmBulkPaid} confirmLabel="Mark Paid" submitting={submitting} confirmTestid="button-confirm-bulk-paid" />
        </Modal>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/15 text-emerald-700",
    pending: "bg-amber-500/15 text-amber-700",
    skipped: "bg-rose-500/15 text-rose-700",
  };
  return <span className={"text-[10px] uppercase font-bold px-2 py-0.5 rounded " + (map[status] || "bg-slate-500/15 text-slate-700")} data-testid={`badge-status-${status}`}>{status}</span>;
}

function FieldLabel({ label, children }: { label: string; children: any }) {
  return (
    <label className="block text-sm mb-3">
      <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose, testid }: { title: string; children: any; onClose: () => void; testid: string }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid={testid}>
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ onCancel, onConfirm, confirmLabel, submitting, confirmTestid }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; submitting: boolean; confirmTestid: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
      <button onClick={onConfirm} disabled={submitting} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50" data-testid={confirmTestid}>
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {confirmLabel}
      </button>
    </div>
  );
}
