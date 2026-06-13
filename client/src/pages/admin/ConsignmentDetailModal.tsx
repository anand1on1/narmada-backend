/**
 * R26 — reusable detail modal for a From-Delhi consignment PO.
 * Fetches /api/admin/consignment/:poId/detail and renders customer/PO/status header,
 * the line items table (item, qty, brand, vendor, bundles) and a dispatch footer.
 */
import { useEffect, useState } from "react";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { StatusBadge } from "@/components/ui/status-badge";
import { X, Loader2 } from "lucide-react";

interface DetailItem {
  id: number; name: string; partNumber: string | null;
  qty: number; brand: string | null; vendorName: string | null;
}
interface DetailDispatch {
  docketNo: string | null; courier: string | null; bundles: number | null; dispatchDate: number | null;
}
interface ConsignmentDetail {
  id: number; poNumber: string; customerName: string | null; customerPhone: string | null;
  delhiSubmittedAt: number | null; consignmentStatus: string | null; status: string;
  items: DetailItem[]; dispatches: DetailDispatch[];
  totalItems: number; totalBundles: number; carrier: string | null; dockets: string[];
}

const fmtDate = (ms: number | null) => ms ? new Date(ms).toLocaleDateString("en-IN") : "—";

export function ConsignmentDetailModal({ poId, onClose }: { poId: number; onClose: () => void }) {
  const { token } = useAdminAuth();
  const [data, setData] = useState<ConsignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const r = await adminFetch(token, `/api/admin/consignment/${poId}/detail`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        const d = await r.json();
        if (alive) setData(d);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [poId, token]);

  const statusLabel = data?.consignmentStatus || "pending";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" data-testid="consignment-detail-modal">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display text-xl font-bold">Consignment Detail</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded" data-testid="button-close-detail"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {err && <div className="text-sm text-red-600">Error: {err}</div>}
          {data && (
            <>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Customer:</span> <strong>{data.customerName || "—"}</strong>{data.customerPhone ? <span className="text-muted-foreground text-xs"> · {data.customerPhone}</span> : null}</div>
                <div><span className="text-muted-foreground">PO Number:</span> <strong className="font-mono">{data.poNumber}</strong></div>
                <div><span className="text-muted-foreground">Delhi Dispatch:</span> <strong>{fmtDate(data.delhiSubmittedAt)}</strong></div>
                <div className="flex items-center gap-2"><span className="text-muted-foreground">Status:</span> <StatusBadge status={statusLabel} /></div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Line Items</div>
                <div className="border rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left">
                        <th className="px-3 py-2 font-semibold">Item</th>
                        <th className="px-3 py-2 font-semibold text-right">Qty</th>
                        <th className="px-3 py-2 font-semibold">Brand</th>
                        <th className="px-3 py-2 font-semibold">Vendor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.items.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No line items.</td></tr>
                      ) : data.items.map((it) => (
                        <tr key={it.id} data-testid={`detail-item-${it.id}`}>
                          <td className="px-3 py-2">{it.name}{it.partNumber ? <span className="text-xs text-muted-foreground"> ({it.partNumber})</span> : null}</td>
                          <td className="px-3 py-2 text-right">{it.qty}</td>
                          <td className="px-3 py-2">{it.brand || "—"}</td>
                          <td className="px-3 py-2">{it.vendorName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid sm:grid-cols-4 gap-3 text-sm border-t pt-4">
                <div><div className="text-xs text-muted-foreground">Total Items</div><strong>{data.totalItems}</strong></div>
                <div><div className="text-xs text-muted-foreground">Total Bundles</div><strong>{data.totalBundles}</strong></div>
                <div><div className="text-xs text-muted-foreground">Carrier</div><strong>{data.carrier || "—"}</strong></div>
                <div><div className="text-xs text-muted-foreground">Dockets</div><strong className="font-mono text-xs">{data.dockets.length ? data.dockets.join(", ") : "—"}</strong></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
