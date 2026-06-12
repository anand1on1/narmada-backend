/**
 * R21.2 — Deviation summary modal. Shows every line whose delivered qty deviates from
 * what Patna originally ordered. Used from the Patna PO list (eye icon) and the Patna PO
 * detail banner (View Summary). Read-only.
 */
import { useQuery } from "@tanstack/react-query";
import { teamFetch } from "@/lib/team-auth";
import { X, Loader2 } from "lucide-react";

interface Deviation {
  id: number; part_number: string | null; original_qty: number | null; new_qty: number;
  diff: number; reason: string | null; deviation_at: number | null; by: string | null;
}

export function DeviationSummaryModal({ token, poId, poNumber, onClose }: {
  token: string | null; poId: number; poNumber: string; onClose: () => void;
}) {
  const { data: rows = [], isLoading } = useQuery<Deviation[]>({
    queryKey: ["po-deviations", poId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/purchase-orders/${poId}/deviations`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token && poId > 0,
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Deviation Summary — {poNumber}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground inline-flex items-center gap-2 justify-center w-full"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No deviations recorded.</div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-semibold">Part #</th>
                <th className="px-3 py-2 font-semibold text-right">Original Qty</th>
                <th className="px-3 py-2 font-semibold text-right">New Qty</th>
                <th className="px-3 py-2 font-semibold text-right">Diff</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">By</th>
              </tr></thead>
              <tbody className="divide-y">{rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-mono break-words">{d.part_number || "—"}</td>
                  <td className="px-3 py-2 text-right">{d.original_qty ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{d.new_qty}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${d.diff < 0 ? "text-red-600" : d.diff > 0 ? "text-emerald-600" : ""}`}>{d.diff > 0 ? `+${d.diff}` : d.diff}</td>
                  <td className="px-3 py-2 text-xs">{d.reason || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{d.deviation_at ? new Date(d.deviation_at).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{d.by || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Close</button>
        </div>
      </div>
    </div>
  );
}
