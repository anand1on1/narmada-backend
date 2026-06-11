import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth, getTeamToken } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { Download, Check } from "lucide-react";

interface PoItem { id: number; partNumber: string | null; brand: string | null; description: string | null; qty: number; unitPrice: number | null; vendorId: number | null; purchaseCost: number | null; fulfilStatus: string | null; }
interface PO { id: number; poNumber: string; status: string; subtotal: number | null; discount: number | null; tax: number | null; total: number | null; notes: string | null; items: PoItem[]; }
interface Vendor { id: number; name: string; }
const STATUSES = ["draft", "open", "fulfilled", "cancelled"];

export default function TeamPODetail() {
  const { id } = useParams<{ id: string }>();
  const poId = parseInt(id, 10);
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assign, setAssign] = useState<Record<number, { vendorId: string; cost: string }>>({});

  const { data: po } = useQuery<PO>({
    queryKey: ["team-po", poId],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`); return r.ok ? r.json() : null; },
    enabled: !!token && !!poId,
  });
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["team-vendors-min"],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/vendors`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => { const r = await teamFetch(token, `/api/team/purchase-orders/${poId}`, { method: "PATCH", body: JSON.stringify({ status }) }); if (!r.ok) throw new Error("Failed"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-po", poId] }); toast({ title: "Status updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignVendor = useMutation({
    mutationFn: async ({ itemId, vendorId, cost }: { itemId: number; vendorId: string; cost: string }) => {
      const r = await teamFetch(token, `/api/team/po-items/${itemId}/assign-vendor`, { method: "PUT", body: JSON.stringify({ vendorId: Number(vendorId), purchaseCost: cost ? Number(cost) : undefined }) });
      if (!r.ok) throw new Error("Assign failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-po", poId] }); toast({ title: "Vendor assigned" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function downloadPdf() {
    const t = getTeamToken();
    fetch(apiUrl(`/api/team/purchase-orders/${poId}/pdf`), { headers: t ? { "x-team-token": t } : {} })
      .then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); window.open(u, "_blank"); })
      .catch(() => toast({ title: "Error", description: "Could not load PDF", variant: "destructive" }));
  }

  if (!po) return <TeamLayout title="Purchase Order"><div className="p-12 text-center text-muted-foreground">Loading…</div></TeamLayout>;

  return (
    <TeamLayout title={`PO ${po.poNumber}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Status:</span>
          <select value={po.status} onChange={(e) => setStatus.mutate(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-background">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={downloadPdf} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2"><Download className="w-4 h-4" /> PDF</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-left">
            <th className="px-3 py-3 font-semibold">Part</th>
            <th className="px-3 py-3 font-semibold">Brand</th>
            <th className="px-3 py-3 font-semibold text-right">Qty</th>
            <th className="px-3 py-3 font-semibold text-right">Unit Price</th>
            <th className="px-3 py-3 font-semibold">Vendor</th>
            <th className="px-3 py-3 font-semibold">Assign Vendor</th>
          </tr></thead>
          <tbody className="divide-y">{po.items.map((it) => {
            const a = assign[it.id] || { vendorId: it.vendorId ? String(it.vendorId) : "", cost: it.purchaseCost != null ? String(it.purchaseCost) : "" };
            return (
              <tr key={it.id} className="hover:bg-muted/30">
                <td className="px-3 py-3"><div className="font-semibold">{it.partNumber || "—"}</div>{it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}</td>
                <td className="px-3 py-3">{it.brand || "—"}</td>
                <td className="px-3 py-3 text-right">{it.qty}</td>
                <td className="px-3 py-3 text-right">{it.unitPrice != null ? `₹${it.unitPrice.toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-3 py-3">{it.vendorId ? (vendors.find((v) => v.id === it.vendorId)?.name || `#${it.vendorId}`) : <span className="text-muted-foreground">unassigned</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    <select value={a.vendorId} onChange={(e) => setAssign({ ...assign, [it.id]: { ...a, vendorId: e.target.value } })} className="border rounded-lg px-2 py-1 text-xs bg-background">
                      <option value="">Select…</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                    <input value={a.cost} onChange={(e) => setAssign({ ...assign, [it.id]: { ...a, cost: e.target.value } })} type="number" placeholder="cost" className="border rounded-lg px-2 py-1 text-xs bg-background w-20" />
                    <button onClick={() => a.vendorId && assignVendor.mutate({ itemId: it.id, vendorId: a.vendorId, cost: a.cost })} disabled={!a.vendorId} className="p-1.5 rounded bg-accent text-accent-foreground disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      <div className="mt-4 bg-card border rounded-xl p-4 shadow-sm max-w-xs ml-auto text-sm space-y-1">
        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{(po.subtotal ?? 0).toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>₹{(po.discount ?? 0).toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹{(po.tax ?? 0).toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>₹{(po.total ?? 0).toLocaleString("en-IN")}</span></div>
      </div>
    </TeamLayout>
  );
}
