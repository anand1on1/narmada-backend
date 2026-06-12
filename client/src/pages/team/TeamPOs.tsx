import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface PO {
  id: number; poNumber: string; customerId: number | null; customerName: string | null;
  status: string; total: number | null; custTotal: number; costTotal: number; createdAt: number;
  dispatchCarrier: string | null; dispatchBundles: number; dispatchDockets: string[];
  dispatches: Array<{ docket_number: string | null; docket_slip_url: string | null; carrier: string | null; bundles: number | null }>;
}
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-700", open: "bg-blue-500/15 text-blue-700",
  partial: "bg-amber-500/15 text-amber-700", fulfilled: "bg-emerald-500/15 text-emerald-700",
  cancelled: "bg-red-500/15 text-red-700",
};

function fmt(d: number) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export default function TeamPOs() {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState<PO | null>(null);

  const { data: pos = [] } = useQuery<PO[]>({
    queryKey: ["team-pos"],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/purchase-orders`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await teamFetch(token, `/api/team/po/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Delete failed");
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "PO deleted", description: `${data.poNumber} and all its line items + seller quotes were removed.` });
      setConfirmDel(null);
      qc.invalidateQueries({ queryKey: ["team-pos"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <TeamLayout title="Purchase Orders">
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {pos.length === 0 ? <div className="p-12 text-center text-muted-foreground">No purchase orders yet. Convert a quotation to a PO to get started.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">PO Number</th>
              <th className="px-3 py-3 font-semibold">Customer</th>
              <th className="px-3 py-3 font-semibold text-right">Total</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Carrier</th>
              <th className="px-3 py-3 font-semibold text-right">Bundles</th>
              <th className="px-3 py-3 font-semibold">Docket #</th>
              <th className="px-3 py-3 font-semibold">Created</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{pos.map((p) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="px-3 py-3 font-semibold">{p.poNumber}</td>
                <td className="px-3 py-3">{p.customerName ?? (p.customerId ?? "—")}</td>
                <td className="px-3 py-3 text-right">{`₹${(p.custTotal ?? p.total ?? 0).toLocaleString("en-IN")}`}</td>
                <td className="px-3 py-3"><span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[p.status] || "bg-muted"}`}>{p.status}</span></td>
                <td className="px-3 py-3 text-xs">{p.dispatchCarrier || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-3 text-right text-xs">{p.dispatchBundles > 0 ? p.dispatchBundles : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-3 text-xs">
                  {p.dispatches && p.dispatches.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {p.dispatches.map((d, i) => d.docket_number ? (
                        d.docket_slip_url ? (
                          <a key={i} href={d.docket_slip_url} target="_blank" rel="noreferrer"
                            className="text-accent font-semibold hover:underline">{d.docket_number}</a>
                        ) : (
                          <span key={i}>{d.docket_number}</span>
                        )
                      ) : null)}
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(p.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/team/purchase-orders/${p.id}`}>
                      <a className="text-accent font-semibold inline-flex items-center gap-1 hover:underline text-xs"><FileText className="w-3.5 h-3.5" /> Open</a>
                    </Link>
                    <button onClick={() => setConfirmDel(p)}
                      className="text-red-600 hover:text-red-700 inline-flex items-center" title="Delete PO">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Delete PO {confirmDel.poNumber}?</h3>
            <p className="text-sm text-muted-foreground mb-5">
              This removes all line items and seller quotes. Cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={() => delMut.mutate(confirmDel.id)} disabled={delMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-2 disabled:opacity-60">
                {delMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Delete PO
              </button>
            </div>
          </div>
        </div>
      )}
    </TeamLayout>
  );
}
