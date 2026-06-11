import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { FileText, Clock, Send, CheckCircle, Megaphone, CheckSquare, Target as TargetIcon, Search, Zap, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { FireRateRequestModal } from "./R9VendorQuotes";

interface DashStats {
  total: number;
  drafts: number;
  sentThisMonth: number;
  accepted: number;
}
interface Announcement { id: number; title: string; body: string | null; createdAt: number; }
interface MyTask { id: number; title: string; status: string; priority: string; }
interface MyTarget { id: number; periodKey: string; metric: string; targetValue: number; currentValue: number; }

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

interface OutstandingToday {
  pos_created: number;
  items_total: number;
  rates_received: number;
  rates_pending: number;
  breakdown: { po_id: number; po_number: string; items_total: number; pending: number }[];
}
interface PoSearchRow {
  id: number;
  po_number: string;
  customer_po_number: string | null;
  status: string;
  total: number | null;
  customer_name: string | null;
}

function PoSearchBox({ token }: { token: string | null }) {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const { data: results = [], isFetching } = useQuery<PoSearchRow[]>({
    queryKey: ["team-po-search", q],
    queryFn: async () => {
      if (q.trim().length < 2) return [];
      const r = await teamFetch(token, `/api/team/po/search?q=${encodeURIComponent(q.trim())}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token && q.trim().length >= 2,
  });

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-card border rounded-xl px-3 py-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search PO by NM/PO/… or customer PO number"
          className="flex-1 bg-transparent text-sm outline-none"
        />
        {isFetching && <span className="text-xs text-muted-foreground">…</span>}
      </div>
      {q.trim().length >= 2 && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-card border rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate(`/team/po/${r.id}/edit`)}
              className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0 flex items-center justify-between"
            >
              <span>
                <span className="font-mono font-semibold text-sm">{r.po_number}</span>
                {r.customer_po_number && <span className="ml-2 text-xs text-muted-foreground">Cust PO: {r.customer_po_number}</span>}
                {r.customer_name && <span className="ml-2 text-xs text-muted-foreground">· {r.customer_name}</span>}
              </span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground">{r.status}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !isFetching && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full bg-card border rounded-xl shadow-lg px-3 py-2 text-xs text-muted-foreground">
          No POs match "{q}".
        </div>
      )}
    </div>
  );
}

function OutstandingTodayWidget({ token }: { token: string | null }) {
  const { data } = useQuery<OutstandingToday>({
    queryKey: ["team-outstanding-today"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/outstanding-today");
      return r.ok ? r.json() : { pos_created: 0, items_total: 0, rates_received: 0, rates_pending: 0, breakdown: [] };
    },
    enabled: !!token,
  });

  function exportXlsx() {
    const t = (token || "");
    fetch(apiUrl("/api/team/outstanding-today/export.xlsx"), { headers: t ? { "x-team-token": t } : {} })
      .then((r) => r.blob())
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = "outstanding-today.xlsx"; a.click();
        URL.revokeObjectURL(u);
      });
  }

  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold"><ClipboardList className="w-4 h-4 text-accent" /> Outstanding Today</div>
        <button onClick={exportXlsx} className="text-xs text-accent hover:underline">Export .xlsx</button>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <div><div className="text-xl font-bold">{data?.pos_created ?? 0}</div><div className="text-[10px] text-muted-foreground uppercase">POs</div></div>
        <div><div className="text-xl font-bold">{data?.items_total ?? 0}</div><div className="text-[10px] text-muted-foreground uppercase">Items</div></div>
        <div><div className="text-xl font-bold text-emerald-600">{data?.rates_received ?? 0}</div><div className="text-[10px] text-muted-foreground uppercase">Rates In</div></div>
        <div><div className="text-xl font-bold text-amber-600">{data?.rates_pending ?? 0}</div><div className="text-[10px] text-muted-foreground uppercase">Pending</div></div>
      </div>
      {data && data.breakdown.length > 0 && (
        <div className="border-t pt-2 max-h-40 overflow-y-auto space-y-1">
          {data.breakdown.map((b) => (
            <div key={b.po_id} className="flex items-center justify-between text-xs">
              <span className="font-mono">{b.po_number}</span>
              <span className="text-muted-foreground">{b.items_total} items · {b.pending > 0 ? <span className="text-amber-600 font-semibold">{b.pending} pending</span> : <span className="text-emerald-600">all rated</span>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamDashboard() {
  const { token } = useTeamAuth();
  const [fireOpen, setFireOpen] = useState(false);

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

  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ["team-announcements"],
    queryFn: async () => { const r = await teamFetch(token, "/api/team/announcements"); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const { data: myTasks = [] } = useQuery<MyTask[]>({
    queryKey: ["team-my-tasks"],
    queryFn: async () => { const r = await teamFetch(token, "/api/team/my-tasks"); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const { data: myTargets = [] } = useQuery<MyTarget[]>({
    queryKey: ["team-my-targets"],
    queryFn: async () => { const r = await teamFetch(token, "/api/team/my-targets"); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const openTasks = myTasks.filter((t) => t.status !== "done");

  const statCards = [
    { label: "Total Quotations", value: stats?.total ?? "—", icon: FileText, color: "bg-blue-500/10 text-blue-700" },
    { label: "Drafts", value: stats?.drafts ?? "—", icon: Clock, color: "bg-amber-500/10 text-amber-700" },
    { label: "Sent This Month", value: stats?.sentThisMonth ?? "—", icon: Send, color: "bg-purple-500/10 text-purple-700" },
    { label: "Accepted", value: stats?.accepted ?? "—", icon: CheckCircle, color: "bg-emerald-500/10 text-emerald-700" },
  ];

  return (
    <TeamLayout title="Dashboard">
      {/* R9 procurement quick actions */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="md:col-span-2 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1"><PoSearchBox token={token} /></div>
            <button
              onClick={() => setFireOpen(true)}
              className="px-4 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Zap className="w-4 h-4" /> Fire Rate Request
            </button>
          </div>
        </div>
        <OutstandingTodayWidget token={token} />
      </div>

      {fireOpen && <FireRateRequestModal token={token} onClose={() => setFireOpen(false)} />}

      {(announcements.length > 0 || openTasks.length > 0 || myTargets.length > 0) && (
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 font-semibold mb-2"><Megaphone className="w-4 h-4 text-accent" /> Announcements</div>
            {announcements.length === 0 ? <div className="text-xs text-muted-foreground">No announcements.</div> :
              <ul className="space-y-2">{announcements.slice(0, 4).map((a) => (
                <li key={a.id} className="text-sm border-b last:border-0 pb-1"><div className="font-semibold">{a.title}</div>{a.body && <div className="text-xs text-muted-foreground line-clamp-2">{a.body}</div>}</li>
              ))}</ul>}
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 font-semibold mb-2"><CheckSquare className="w-4 h-4 text-accent" /> My Open Tasks</div>
            {openTasks.length === 0 ? <div className="text-xs text-muted-foreground">No open tasks.</div> :
              <ul className="space-y-1">{openTasks.slice(0, 5).map((t) => (
                <li key={t.id} className="text-sm flex items-center justify-between border-b last:border-0 py-1"><span>{t.title}</span><span className="text-[10px] uppercase font-bold text-muted-foreground">{t.priority}</span></li>
              ))}</ul>}
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 font-semibold mb-2"><TargetIcon className="w-4 h-4 text-accent" /> My Targets</div>
            {myTargets.length === 0 ? <div className="text-xs text-muted-foreground">No targets set.</div> :
              <ul className="space-y-2">{myTargets.slice(0, 4).map((tg) => {
                const pct = tg.targetValue > 0 ? Math.min(100, Math.round((tg.currentValue / tg.targetValue) * 100)) : 0;
                return (
                  <li key={tg.id} className="text-xs">
                    <div className="flex justify-between mb-0.5"><span>{tg.metric} ({tg.periodKey})</span><span>{pct}%</span></div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}</ul>}
          </div>
        </div>
      )}
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
