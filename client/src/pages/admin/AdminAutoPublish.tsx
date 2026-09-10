// R28 Session 3 — Auto-Publish log + manual trigger + backfill.
// Endpoints:
//   GET  /api/admin/auto-publish/log?limit=&offset=&po_id=&status=
//   POST /api/admin/auto-publish/manual/:poId
//   POST /api/admin/part-images/backfill?limit=10
//   GET  /api/admin/settings/auto-product-markup (informational)
import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, PackagePlus, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { formatTs, formatINR, isRepresentationalImage } from "@/lib/r28-utils";

interface AutoPublishRow {
  id: number;
  poId: number;
  partNumber: string;
  description: string;
  purchasePrice: number;
  publishedPrice: number;
  markupPct: number;
  quantity: number;
  productId: number | null;
  imageUrl: string | null;
  imageSource: string | null;
  status: string;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: number;
}

const STATUSES = ["", "published", "updated", "skipped", "error"];

export default function AdminAutoPublish() {
  const { token } = useAdminAuth();
  const [status, setStatus] = useState("");
  const [poId, setPoId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [manualPo, setManualPo] = useState("");
  const [manualDialog, setManualDialog] = useState(false);
  const [running, setRunning] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const params = new URLSearchParams();
  params.set("limit", "200");
  if (status) params.set("status", status);
  if (poId.trim()) params.set("po_id", poId.trim());

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["auto-publish-log", status, poId],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/auto-publish/log?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });

  const { data: settings } = useQuery<any>({
    queryKey: ["auto-publish-settings"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/settings/auto-product-markup`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!token,
  });

  const rowsRaw: AutoPublishRow[] = Array.isArray(data) ? data : (data?.rows ?? []);
  const rows = rowsRaw.filter((r) => {
    if (!dateFrom && !dateTo) return true;
    const ts = Number(r.createdAt || 0);
    if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
    if (dateTo && ts > new Date(dateTo).getTime() + 86_400_000) return false;
    return true;
  });

  const trigger = async () => {
    const n = parseInt(manualPo, 10);
    if (!n) { toast({ title: "Enter a valid PO ID", variant: "destructive" }); return; }
    if (!confirm(`Manually trigger auto-publish for PO #${n}? This is idempotent — already-published lines are skipped.`)) return;
    setRunning(true);
    try {
      const r = await adminFetch(token, `/api/admin/auto-publish/manual/${n}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: "Auto-publish complete", description: `Processed: ${JSON.stringify(j).slice(0, 200)}` });
      setManualDialog(false); setManualPo("");
      refetch();
    } catch (e: any) {
      toast({ title: "Manual trigger failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setRunning(false); }
  };

  const backfill = async () => {
    if (!confirm("Regenerate images for the top 10 placeholder rows?")) return;
    setBackfilling(true);
    try {
      const r = await adminFetch(token, `/api/admin/part-images/backfill?limit=10`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: `Backfill: processed ${j.processed ?? 0} items` });
      refetch();
    } catch (e: any) {
      toast({ title: "Backfill failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setBackfilling(false); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      published: "bg-emerald-100 text-emerald-700",
      updated: "bg-blue-100 text-blue-700",
      skipped: "bg-slate-100 text-slate-500",
      error: "bg-red-100 text-red-700",
    };
    return map[s] || "bg-slate-100 text-slate-500";
  };
  const sourceBadge = (s: string | null) => {
    const map: Record<string, string> = {
      generated: "bg-purple-100 text-purple-700",
      reused: "bg-cyan-100 text-cyan-700",
      placeholder: "bg-amber-100 text-amber-700",
    };
    return map[s || ""] || "bg-slate-100 text-slate-500";
  };

  return (
    <AdminLayout title="Auto-Publish Log">
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-xs text-slate-500 space-y-0.5">
            <div>
              Feature flags: <span className="font-mono">AUTO_PUBLISH_ENABLED</span>, <span className="font-mono">AUTO_PUBLISH_IMAGE_GEN_ENABLED</span> — toggle via Render env vars.
            </div>
            {settings && (
              <div>Markup: <b>{settings.markupPct ?? settings.markup_pct ?? 22}%</b> · Quantity per part: <b>{settings.quantity ?? 10}</b></div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={backfill} disabled={backfilling}>
              <PackagePlus className={`w-4 h-4 mr-1 ${backfilling ? "animate-spin" : ""}`} /> Cache backfill (10)
            </Button>
            <Button size="sm" onClick={() => setManualDialog(true)}><Play className="w-4 h-4 mr-1" /> Manual trigger</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">PO ID</span>
            <Input value={poId} onChange={(e) => setPoId(e.target.value)} placeholder="123" className="h-8 text-xs w-24" />
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">From</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">To</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" />
          </label>
        </div>

        {/* Desktop */}
        <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Part #</th>
                <th className="px-3 py-2 text-right">Purchase</th>
                <th className="px-3 py-2 text-right">Published (+22%)</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-left">Image src</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No auto-publish activity yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{formatTs(r.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    <Link href={`/admin/purchase-orders-v2/${r.poId}`}><a className="text-indigo-600">#{r.poId}</a></Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.partNumber}</td>
                  <td className="px-3 py-2 text-right text-xs">{formatINR(r.purchasePrice)}</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-emerald-700">{formatINR(r.publishedPrice)}</td>
                  <td className="px-3 py-2 text-right text-xs">{r.quantity}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${sourceBadge(r.imageSource)}`}>{r.imageSource || "—"}</span></td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${statusBadge(r.status)}`}>{r.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.productId ? (
                      <Link href={`/admin/products?id=${r.productId}`}><a><Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" /> Product</Button></a></Link>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3">
          {isLoading && <div className="text-center text-slate-500 py-6">Loading…</div>}
          {!isLoading && rows.length === 0 && <div className="text-center text-slate-500 py-6">No auto-publish activity.</div>}
          {rows.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border p-3 space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-mono text-xs">{r.partNumber}</div>
                  <div className="text-xs text-slate-500">PO <Link href={`/admin/purchase-orders-v2/${r.poId}`}><a className="text-indigo-600">#{r.poId}</a></Link> · {formatTs(r.createdAt)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${statusBadge(r.status)}`}>{r.status}</span>
              </div>
              <div className="text-xs text-slate-700">
                Purchase {formatINR(r.purchasePrice)} → <b className="text-emerald-700">{formatINR(r.publishedPrice)}</b> · Qty {r.quantity}
              </div>
              <div className="text-xs"><Badge className={sourceBadge(r.imageSource)}>{r.imageSource || "—"}</Badge></div>
              {r.imageUrl && (
                <div>
                  <img src={r.imageUrl} alt="" className="w-16 h-16 object-cover rounded" loading="lazy" />
                  {isRepresentationalImage(r.imageSource) && <div className="text-[10px] italic text-slate-500 mt-0.5">* Image is for representation purpose only</div>}
                </div>
              )}
              {r.errorMessage && <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded p-1">{r.errorMessage}</div>}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={manualDialog} onOpenChange={setManualDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Manually trigger auto-publish</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="text-sm">
              PO ID
              <Input type="number" value={manualPo} onChange={(e) => setManualPo(e.target.value)} className="mt-1" placeholder="e.g. 1234" />
            </label>
            <div className="text-xs text-slate-500">The endpoint is idempotent — already-processed lines will be skipped rather than duplicated.</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setManualDialog(false)}>Cancel</Button>
              <Button onClick={trigger} disabled={running}>{running ? "Triggering…" : "Trigger"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
