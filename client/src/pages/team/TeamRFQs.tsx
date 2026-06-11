import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Send } from "lucide-react";

interface RFQ { id: number; rfqNumber: string; status: string; createdAt: number; }
const STATUS_COLOR: Record<string, string> = { draft: "bg-slate-500/15 text-slate-700", sent: "bg-blue-500/15 text-blue-700", closed: "bg-emerald-500/15 text-emerald-700" };

function fmt(d: number) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }

export default function TeamRFQs() {
  const { token } = useTeamAuth();
  const { data: rfqs = [] } = useQuery<RFQ[]>({
    queryKey: ["team-rfqs"],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/rfqs`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  return (
    <TeamLayout title="RFQs (Vendor Quotes)">
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {rfqs.length === 0 ? <div className="p-12 text-center text-muted-foreground">No RFQs yet.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">RFQ Number</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Created</th>
              <th className="px-3 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">{rfqs.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-3 font-semibold">{r.rfqNumber}</td>
                <td className="px-3 py-3"><span className={`text-xs font-bold rounded px-2 py-1 ${STATUS_COLOR[r.status] || "bg-muted"}`}>{r.status}</span></td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(r.createdAt)}</td>
                <td className="px-3 py-3 text-right">
                  <Link href={`/team/rfqs/${r.id}`}>
                    <a className="text-accent font-semibold inline-flex items-center gap-1 hover:underline"><Send className="w-4 h-4" /> Open</a>
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
