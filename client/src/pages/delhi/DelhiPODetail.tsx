/**
 * R12 — DelhiPODetail.tsx
 * PO detail for the Delhi warehouse. Shows line items with per-line "Mark Packed" (one click
 * auto-receives then packs) + bulk-select. The bottom action bar dispatches only the packed
 * lines (partial dispatch); unpacked lines stay in the PO. Dispatch modal requires courier,
 * docket number, bundles count, and a docket-slip upload (image/PDF).
 */
import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/queryClient";
import { Logo } from "@/components/Logo";
import { ArrowLeft, Loader2, Truck, PackageCheck, Upload, X, FileDown, Pencil, Clock } from "lucide-react";

interface Line {
  id: number;
  part_number: string | null;
  brand: string | null;
  description: string | null;
  qty: number;
  rate: number | null;
  line_total: number | null;
  vendor_name: string | null;
  fulfil_status: string | null;
  // R21.2 / R21.7.4
  original_qty: number | null;
  is_deviated: number;
  deviation_reason: string | null;
  patna_note: string | null;
}
interface PO {
  id: number;
  po_number: string;
  customer_name: string | null;
  customer_po_number: string | null;
  po_date: number | null;
  status: string;
  bucket: string;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_phone: string | null;
  total_qty: number;
  cust_total: number;
  // R21.7
  urgency: string | null;
  delivery_deadline: number | null;
  pickup_pending_days: number | null;
  lines: Line[];
}

const fmtINR = (v: number | null | undefined) =>
  v == null ? "—" : `Rs. ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = { pending: "To Pick Up", collected: "Received", packed: "Packed", dispatched: "Dispatched" };
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-700", collected: "bg-blue-500/15 text-blue-700",
  packed: "bg-amber-500/15 text-amber-700", dispatched: "bg-emerald-500/15 text-emerald-700",
};

// R21.7.1 — customer urgency pill colours.
const URGENCY: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "bg-red-500/15 text-red-700" },
  normal: { label: "Normal", color: "bg-slate-500/15 text-slate-700" },
  standby: { label: "Standby", color: "bg-blue-500/15 text-blue-700" },
};

// R21.7.2 — colour the delivery deadline by days remaining.
function deadlineMeta(ms: number | null): { text: string; color: string } | null {
  if (ms == null) return null;
  const days = Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
  const text = `Deadline: ${new Date(ms).toLocaleDateString("en-IN")}`;
  let color = "bg-emerald-500/15 text-emerald-700";
  if (days < 2) color = "bg-red-500/15 text-red-700";
  else if (days < 5) color = "bg-amber-500/15 text-amber-700";
  return { text, color };
}

export default function DelhiPODetail() {
  const params = useParams<{ id: string }>();
  const poId = parseInt(params.id || "0", 10);
  const { token, ready } = useTeamAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [editQtyLine, setEditQtyLine] = useState<Line | null>(null);

  const { data: po, isLoading, refetch } = useQuery<PO | null>({
    queryKey: ["delhi-po", poId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/delhi/po/${poId}`);
      if (!r.ok) return null;
      const d = await r.json();
      const lines: Line[] = (d.items || []).map((it: any) => ({
        id: it.id,
        part_number: it.partNumber ?? it.part_number ?? null,
        brand: it.brand ?? null,
        description: it.description ?? null,
        qty: it.qty ?? 0,
        rate: it.rate ?? null,
        line_total: it.line_total ?? null,
        vendor_name: it.vendor_name ?? it.vendorName ?? null,
        fulfil_status: it.fulfilStatus ?? it.fulfil_status ?? "pending",
        original_qty: it.original_qty ?? null,
        is_deviated: Number(it.is_deviated) === 1 ? 1 : 0,
        deviation_reason: it.deviation_reason ?? null,
        patna_note: it.patna_note ?? null,
      }));
      return {
        id: d.id,
        po_number: d.poNumber ?? d.po_number,
        customer_name: d.customerName ?? d.customer_name ?? null,
        customer_po_number: d.customerPoNumber ?? d.customer_po_number ?? null,
        po_date: d.poDate ?? d.po_date ?? null,
        status: d.status,
        bucket: d.bucket,
        ship_to_name: d.shipToName ?? d.ship_to_name ?? null,
        ship_to_address: d.shipToAddress ?? d.ship_to_address ?? null,
        ship_to_phone: d.shipToPhone ?? d.ship_to_phone ?? null,
        total_qty: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
        cust_total: d.cust_total ?? lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0),
        urgency: d.urgency ?? null,
        delivery_deadline: d.delivery_deadline ?? null,
        pickup_pending_days: d.pickup_pending_days ?? null,
        lines,
      };
    },
    enabled: !!token && poId > 0,
    refetchInterval: 20_000,
  });

  const packedCount = useMemo(() => (po?.lines || []).filter((l) => l.fulfil_status === "packed").length, [po]);
  const fullyDispatched = useMemo(() => (po?.lines || []).length > 0 && (po?.lines || []).every((l) => l.fulfil_status === "dispatched"), [po]);
  const remainingAfter = useMemo(() => (po?.lines || []).filter((l) => l.fulfil_status !== "packed" && l.fulfil_status !== "dispatched").length, [po]);

  const packableSelected = useMemo(
    () => Array.from(selected).filter((id) => { const l = po?.lines.find((x) => x.id === id); return l && l.fulfil_status !== "packed" && l.fulfil_status !== "dispatched"; }),
    [selected, po]
  );

  async function markPacked(id: number) {
    setBusy(true);
    try {
      const r = await teamFetch(token, `/api/delhi/po-items/${id}/mark-packed`, { method: "PUT" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      await refetch();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }

  async function downloadCustomerPdf() {
    if (!po) return;
    setDownloadingPdf(true);
    try {
      const r = await fetch(apiUrl(`/api/team/pos/${po.id}/customer-pdf`), {
        headers: { "x-team-token": token || "" },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Download failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PO-${po.po_number.replace(/\//g, "-")}-customer.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setDownloadingPdf(false); }
  }

  async function bulkMarkPacked() {
    if (packableSelected.length === 0) return;
    setBusy(true);
    try {
      const r = await teamFetch(token, `/api/delhi/po-items/bulk-mark-packed`, {
        method: "POST", body: JSON.stringify({ ids: packableSelected }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      const j = await r.json();
      toast({ title: `${j.packed} line(s) marked packed` });
      setSelected(new Set());
      await refetch();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }

  function toggleSel(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    if (!po) return;
    const selectable = po.lines.filter((l) => l.fulfil_status !== "dispatched").map((l) => l.id);
    setSelected((prev) => prev.size >= selectable.length && selectable.every((id) => prev.has(id)) ? new Set() : new Set(selectable));
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  if (!token) { navigate("/delhi"); return null; }

  return (
    <div className="panel-delhi min-h-screen bg-slate-50 dark:bg-slate-950 pb-24">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><Logo /><div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold hidden sm:block">Delhi Warehouse</div></div>
          <button onClick={() => navigate("/delhi/dashboard")} className="text-sm px-3 py-1.5 rounded-lg hover:bg-muted inline-flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back to POs
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-[1100px] mx-auto">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-16">Loading PO…</div>
        ) : !po ? (
          <div className="text-center text-muted-foreground py-16">PO not found.</div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-card border rounded-xl p-4 mb-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-lg font-bold">{po.po_number}</div>
                    {po.urgency && URGENCY[po.urgency] && (
                      <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${URGENCY[po.urgency].color}`}>{URGENCY[po.urgency].label}</span>
                    )}
                    {(() => { const dm = deadlineMeta(po.delivery_deadline); return dm ? (
                      <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${dm.color}`}>{dm.text}</span>
                    ) : null; })()}
                    {po.pickup_pending_days != null && (
                      <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-yellow-400/25 text-yellow-800 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Pickup pending since {po.pickup_pending_days} day{po.pickup_pending_days === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {po.customer_name || "—"}
                    {po.customer_po_number ? ` · Cust PO ${po.customer_po_number}` : ""}
                    {po.po_date ? ` · ${new Date(po.po_date).toLocaleDateString("en-IN")}` : ""}
                  </div>
                  {(po.ship_to_name || po.ship_to_address || po.ship_to_phone) && (
                    <div className="text-xs text-muted-foreground mt-1.5">
                      <span className="font-semibold text-foreground">Ship To: </span>
                      {[po.ship_to_name, po.ship_to_address, po.ship_to_phone].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right"><div className="text-xs text-muted-foreground">Total Qty</div><div className="font-bold">{po.total_qty}</div></div>
                  <div className="text-right"><div className="text-xs text-muted-foreground">Order Value</div><div className="font-bold">{fmtINR(po.cust_total)}</div></div>
                  <span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[po.bucket] || "bg-muted"}`}>{STATUS_LABEL[po.bucket] || po.bucket}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t flex justify-end">
                <button onClick={downloadCustomerPdf} disabled={downloadingPdf}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-background hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5">
                  {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                  Download PO PDF (Customer Rates)
                </button>
              </div>
            </div>

            {/* Bulk bar */}
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-xs text-muted-foreground">{selected.size} selected</div>
              <button onClick={bulkMarkPacked} disabled={busy || packableSelected.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5">
                <PackageCheck className="w-3.5 h-3.5" /> Mark Packed ({packableSelected.length})
              </button>
            </div>

            {/* Lines */}
            <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/50 text-left">
                  <th className="px-3 py-3 w-8"><input type="checkbox" onChange={toggleAll}
                    checked={po.lines.length > 0 && po.lines.filter((l) => l.fulfil_status !== "dispatched").every((l) => selected.has(l.id)) && selected.size > 0} /></th>
                  <th className="px-3 py-3 font-semibold min-w-[260px]">Part / Description</th>
                  <th className="px-3 py-3 font-semibold">Brand</th>
                  <th className="px-3 py-3 font-semibold">Seller</th>
                  <th className="px-3 py-3 font-semibold text-right">Qty</th>
                  <th className="px-3 py-3 font-semibold text-right">Rate</th>
                  <th className="px-3 py-3 font-semibold text-right">Line Total</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold text-right">Action</th>
                </tr></thead>
                <tbody className="divide-y">{po.lines.map((l) => {
                  const st = l.fulfil_status || "pending";
                  const done = st === "packed" || st === "dispatched";
                  return (
                    <tr key={l.id} className="hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <input type="checkbox" disabled={st === "dispatched"} checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} />
                      </td>
                      <td className="px-3 py-3 align-top min-w-[260px]">
                        <div className="font-mono font-semibold break-words whitespace-normal">{l.part_number || "—"}</div>
                        {l.description && <div className="text-xs text-muted-foreground mt-0.5 break-words whitespace-normal">{l.description}</div>}
                        {l.patna_note && <div className="text-xs italic text-muted-foreground mt-0.5 break-words whitespace-normal">Note: {l.patna_note}</div>}
                      </td>
                      <td className="px-3 py-3 align-top">{l.brand || "—"}</td>
                      <td className="px-3 py-3 align-top">{l.vendor_name || "—"}</td>
                      <td className="px-3 py-3 text-right align-top">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <span>{l.qty}</span>
                          {st !== "dispatched" && (
                            <button onClick={() => setEditQtyLine(l)} title="Edit quantity"
                              className="text-muted-foreground hover:text-accent"><Pencil className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                        {l.is_deviated === 1 && (
                          <div className="mt-1">
                            <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-orange-500/15 text-orange-700">Deviated</span>
                            {l.original_qty != null && <div className="text-[10px] text-muted-foreground mt-0.5">was {l.original_qty}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">{fmtINR(l.rate)}</td>
                      <td className="px-3 py-3 text-right font-semibold">{fmtINR(l.line_total)}</td>
                      <td className="px-3 py-3"><span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[st]}`}>{STATUS_LABEL[st] || st}</span></td>
                      <td className="px-3 py-3 text-right">
                        {st === "dispatched" ? <span className="text-xs text-emerald-600 font-semibold">Dispatched</span> :
                          <button onClick={() => markPacked(l.id)} disabled={busy || done}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1">
                            <PackageCheck className="w-3.5 h-3.5" /> {st === "packed" ? "Packed" : "Mark Packed"}
                          </button>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Bottom action bar */}
      {po && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t px-4 sm:px-6 py-3 z-30">
          <div className="max-w-[1100px] mx-auto flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              {packedCount} packed line(s) ready · {remainingAfter} not yet packed
            </div>
            <button
              onClick={() => setShowDispatch(true)}
              disabled={packedCount === 0 || fullyDispatched}
              title={fullyDispatched ? "PO fully dispatched" : packedCount === 0 ? "Mark at least one line packed first" : "Dispatch packed lines"}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
              <Truck className="w-4 h-4" /> Dispatch Packed Lines
            </button>
          </div>
        </div>
      )}

      {editQtyLine && (
        <EditQtyModal
          line={editQtyLine} token={token} onClose={() => setEditQtyLine(null)}
          onDone={() => { setEditQtyLine(null); refetch(); }}
        />
      )}

      {showDispatch && po && (
        <DispatchModal
          poId={po.id} poNumber={po.po_number} packedCount={packedCount} remainingCount={remainingAfter}
          token={token} onClose={() => setShowDispatch(false)}
          onDone={(res) => {
            setShowDispatch(false);
            toast({ title: "Dispatched", description: `Dispatched ${res.dispatched_count} line(s). ${res.remaining_count} line(s) remain in this PO.` });
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── R21.2 Edit-Qty modal (deviation flow) ───
function EditQtyModal({ line, token, onClose, onDone }: {
  line: Line; token: string | null; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const original = line.original_qty != null ? line.original_qty : line.qty;
  const [qty, setQty] = useState(String(line.qty));
  const [reason, setReason] = useState(line.deviation_reason || "");
  const [saving, setSaving] = useState(false);
  const qtyNum = Number(qty);
  const changed = Number.isFinite(qtyNum) && qtyNum !== original;

  async function save() {
    if (!Number.isFinite(qtyNum) || qtyNum < 0) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return; }
    if (changed && !reason.trim()) { toast({ title: "A reason is required when changing the quantity", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await teamFetch(token, `/api/delhi/po-items/${line.id}/qty`, {
        method: "PATCH", body: JSON.stringify({ qty: qtyNum, reason: reason.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Failed to update quantity");
      toast({ title: "Quantity updated", description: changed ? "Deviation recorded." : "No change." });
      onDone();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Update Quantity</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4 break-words">{line.part_number || "—"}{line.description ? ` · ${line.description}` : ""} · Originally ordered: <span className="font-semibold">{original}</span></p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold">New Qty <span className="text-red-500">*</span></label>
            <input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" />
          </div>
          <div>
            <label className="text-xs font-semibold">Reason {changed && <span className="text-red-500">*</span>}
              <span className="font-normal text-muted-foreground"> (required if qty changes)</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder="e.g. Short material received" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dispatch modal (PO level, multipart upload) ───
function DispatchModal({ poId, poNumber, packedCount, remainingCount, token, onClose, onDone }: {
  poId: number; poNumber: string; packedCount: number; remainingCount: number;
  token: string | null; onClose: () => void; onDone: (r: { dispatched_count: number; remaining_count: number }) => void;
}) {
  const { toast } = useToast();
  const [courier, setCourier] = useState("");
  const [docketNumber, setDocketNumber] = useState("");
  const [bundles, setBundles] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R21.6 — "external" (all fields mandatory) vs "internal" (Inter-Branch Transfer, optional).
  const [mode, setMode] = useState<"external" | "internal">("external");
  const internal = mode === "internal";

  const { data: carriers = [] } = useQuery<string[]>({
    queryKey: ["delhi-carriers"],
    queryFn: async () => { const r = await teamFetch(token, `/api/delhi/dispatch/carriers`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  async function submit() {
    const b = parseInt(bundles, 10);
    if (!internal) {
      if (!courier.trim()) { toast({ title: "Courier is required", variant: "destructive" }); return; }
      if (!docketNumber.trim()) { toast({ title: "Docket number is required", variant: "destructive" }); return; }
      if (!Number.isInteger(b) || b < 1) { toast({ title: "Bundles count (min 1) is required", variant: "destructive" }); return; }
      if (!file) { toast({ title: "Docket slip upload is required", variant: "destructive" }); return; }
    }
    if (file && file.size > 10 * 1024 * 1024) { toast({ title: "File too large (max 10MB)", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("courier", courier.trim());
      fd.append("docketNumber", docketNumber.trim());
      if (Number.isInteger(b) && b > 0) fd.append("bundles", String(b));
      if (file) fd.append("docketSlip", file);
      fd.append("isInternalTransfer", internal ? "1" : "0");
      const r = await fetch(apiUrl(`/api/delhi/po/${poId}/dispatch`), {
        method: "POST", headers: { "x-team-token": token || "" }, body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Dispatch failed");
      onDone({ dispatched_count: j.dispatched_count, remaining_count: j.remaining_count });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Dispatch — {poNumber}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Dispatching {packedCount} packed line(s). Remaining {remainingCount} line(s) stay in this PO.
        </p>

        {/* R21.6 — dispatch mode selector */}
        <div className="mb-4 grid grid-cols-1 gap-2">
          <label className={`flex items-start gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm ${!internal ? "border-accent bg-accent/5" : ""}`}>
            <input type="radio" name="dispatch-mode" checked={!internal} onChange={() => setMode("external")} className="mt-0.5" />
            <span><span className="font-semibold">External Carrier</span><span className="block text-xs text-muted-foreground">All fields mandatory.</span></span>
          </label>
          <label className={`flex items-start gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm ${internal ? "border-accent bg-accent/5" : ""}`}>
            <input type="radio" name="dispatch-mode" checked={internal} onChange={() => setMode("internal")} className="mt-0.5" />
            <span><span className="font-semibold">Inter-Branch Transfer (Patna)</span><span className="block text-xs text-muted-foreground">Our own carrier — all fields optional.</span></span>
          </label>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold">Courier {!internal && <span className="text-red-500">*</span>}</label>
            <input value={courier} onChange={(e) => setCourier(e.target.value)} list="carrier-list"
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder={internal ? "Optional" : "e.g. Delhivery, DTDC"} />
            <datalist id="carrier-list">{carriers.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="text-xs font-semibold">Docket Number {!internal && <span className="text-red-500">*</span>}</label>
            <input value={docketNumber} onChange={(e) => setDocketNumber(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder={internal ? "Optional" : "AWB / docket #"} />
          </div>
          <div>
            <label className="text-xs font-semibold">Bundles {!internal && <span className="text-red-500">*</span>}</label>
            <input type="number" min={internal ? 0 : 1} value={bundles} onChange={(e) => setBundles(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" />
          </div>
          <div>
            <label className="text-xs font-semibold">Docket Slip {!internal && <span className="text-red-500">*</span>} <span className="font-normal text-muted-foreground">(image/PDF, max 10MB)</span></label>
            <label className="mt-1 flex items-center gap-2 border border-dashed rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-muted">
              <Upload className="w-4 h-4 text-muted-foreground" />
              <span className="truncate">{file ? file.name : "Choose file…"}</span>
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Dispatch
          </button>
        </div>
      </div>
    </div>
  );
}
