import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface Quotation {
  id: number;
  quoteNo: string;
  status: string;
  customerName: string;
  customerId: number;
  grandTotal: number;
  currency: string;
  validUntil: string | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  accepted: "bg-emerald-500/15 text-emerald-700",
  expired: "bg-muted text-muted-foreground",
};

const STATUSES = ["", "draft", "sent", "accepted", "expired"];

export default function TeamQuotations() {
  const { token } = useTeamAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (search.trim()) params.set("q", search.trim());
  params.set("page", String(page));

  const { data, isLoading } = useQuery<{ quotations: Quotation[]; total: number; pages: number } | Quotation[]>({
    queryKey: ["team-quotations", status, search, page],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations?${params}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const items: Quotation[] = Array.isArray(data) ? data : (data as any)?.quotations || [];
  const totalPages: number = Array.isArray(data) ? 1 : (data as any)?.pages || 1;

  function doSearch() { setPage(1); }

  return (
    <TeamLayout title="Quotations">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search quote #, customer…"
            className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-64" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Statuses</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={doSearch} className="px-3 py-2 border rounded-lg text-sm hover:bg-muted">Search</button>
        {(status || search) && (
          <button onClick={() => { setStatus(""); setSearch(""); setPage(1); }} className="px-3 py-2 border rounded-lg text-sm text-muted-foreground">Clear</button>
        )}
        <div className="flex-1" />
        <Link href="/team/quotations/new">
          <a className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Quotation
          </a>
        </Link>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No quotations found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Quote #</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3 font-semibold">Valid Until</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((q) => (
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
                    {q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(q.createdAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/team/quotations/${q.id}`}>
                      <a className="px-3 py-1.5 border rounded-lg text-xs hover:bg-muted">Edit</a>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="p-2 border rounded-lg disabled:opacity-40 hover:bg-muted">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="p-2 border rounded-lg disabled:opacity-40 hover:bg-muted">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </TeamLayout>
  );
}
