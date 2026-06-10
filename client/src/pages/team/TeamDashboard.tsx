import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { FileText, Clock, Send, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface DashStats {
  total: number;
  drafts: number;
  sentThisMonth: number;
  accepted: number;
}

interface RecentQuotation {
  id: number;
  quoteNo: string;
  status: string;
  customerName: string;
  grandTotal: number;
  currency: string;
  createdAt: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  accepted: "bg-emerald-500/15 text-emerald-700",
  expired: "bg-muted text-muted-foreground",
};

export default function TeamDashboard() {
  const { token } = useTeamAuth();

  const { data: stats } = useQuery<DashStats>({
    queryKey: ["team-dash-stats"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/quotations/stats");
      if (!r.ok) return { total: 0, drafts: 0, sentThisMonth: 0, accepted: 0 };
      return r.json();
    },
    enabled: !!token,
  });

  const { data: recent = [] } = useQuery<RecentQuotation[]>({
    queryKey: ["team-recent-quotations"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/quotations?page=1&limit=10");
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : j.quotations || j.items || [];
    },
    enabled: !!token,
  });

  const statCards = [
    { label: "Total Quotations", value: stats?.total ?? "—", icon: FileText, color: "bg-blue-500/10 text-blue-700" },
    { label: "Drafts", value: stats?.drafts ?? "—", icon: Clock, color: "bg-amber-500/10 text-amber-700" },
    { label: "Sent This Month", value: stats?.sentThisMonth ?? "—", icon: Send, color: "bg-purple-500/10 text-purple-700" },
    { label: "Accepted", value: stats?.accepted ?? "—", icon: CheckCircle, color: "bg-emerald-500/10 text-emerald-700" },
  ];

  return (
    <TeamLayout title="Dashboard">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((s) => (
          <div key={s.label} className="bg-card border rounded-xl p-5">
            <div className={`w-10 h-10 rounded-lg ${s.color} flex items-center justify-center mb-3`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border rounded-xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Recent Quotations</h2>
          <Link href="/team/quotations">
            <a className="text-sm text-accent hover:underline">View all</a>
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No quotations yet.{" "}
            <Link href="/team/quotations/new">
              <a className="text-accent hover:underline">Create your first quotation</a>
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Quote #</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent.map((q) => (
                <tr key={q.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/team/quotations/${q.id}`}>
                      <a className="font-mono font-semibold text-accent hover:underline">{q.quoteNo}</a>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{q.customerName || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_BADGE[q.status] || STATUS_BADGE.draft}`}>
                      {q.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {q.currency !== "INR" ? q.currency + " " : "₹"}
                    {Number(q.grandTotal || 0).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(q.createdAt).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </TeamLayout>
  );
}
