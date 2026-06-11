import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText } from "lucide-react";

interface PO { id: number; poNumber: string; customerId: number | null; status: string; total: number | null; createdAt: number; }
const STATUS_COLOR: Record<string, string> = { draft: "bg-slate-500/15 text-slate-700", open: "bg-blue-500/15 text-blue-700", fulfilled: "bg-emerald-500/15 text-emerald-700", cancelled: "bg-red-500/15 text-red-700" };

function fmt(d: number) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export default function TeamPOs() {
  const { token } = useTeamAuth();
  const { data: pos = [] } = useQuery<PO[]>({
    queryKey: ["team-pos"],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/purchase-orders`); return r.ok ? r.json() : []; },
    enabled: !!token,
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
              <th className="px-3 py-3 font-semibold">Created</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{pos.map((p) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="px-3 py-3 font-semibold">{p.poNumber}</td>
                <td className="px-3 py-3">{p.customerId ?? "—"}</td>
                <td className="px-3 py-3 text-right">{p.total != null ? `₹${p.total.toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-3 py-3"><span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[p.status] || "bg-muted"}`}>{p.status}</span></td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(p.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                  <Link href={`/team/purchase-orders/${p.id}`}>
                    <a className="text-accent font-semibold inline-flex items-center gap-1 hover:underline"><FileText className="w-4 h-4" /> Open</a>
                  </Link>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </TeamLayout>
  );
}
