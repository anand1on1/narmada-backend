import { useState, useMemo } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { Plus, Search, ChevronLeft, ChevronRight, X, Calendar } from "lucide-react";
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

interface Customer {
  id: number;
  name: string;
  code?: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  accepted: "bg-emerald-500/15 text-emerald-700",
  finalized: "bg-blue-500/15 text-blue-700",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/15 text-red-700",
};

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent / Finalized" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Today", range: () => { const t = new Date(); return { from: isoDate(t), to: isoDate(t) }; } },
  { label: "This Week", range: () => {
      const t = new Date();
      const day = t.getDay() || 7; // Mon=1..Sun=7
      const mon = new Date(t); mon.setDate(t.getDate() - (day - 1));
      return { from: isoDate(mon), to: isoDate(t) };
    } },
  { label: "This Month", range: () => {
      const t = new Date();
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      return { from: isoDate(start), to: isoDate(t) };
    } },
  { label: "Last 30 Days", range: () => {
      const t = new Date();
      const s = new Date(t); s.setDate(t.getDate() - 30);
      return { from: isoDate(s), to: isoDate(t) };
    } },
];

export default function TeamQuotations() {
  const { token } = useTeamAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(""); // committed search term
  const [customerId, setCustomerId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(1);

  // Load customers for dropdown
  const { data: customersData } = useQuery<{ customers: Customer[] } | Customer[]>({
    queryKey: ["team-customers-for-filter"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/customers?limit=500");
      if (!r.ok) throw new Error("Failed to load customers");
      return r.json();
    },
    enabled: !!token,
  });
  const customers: Customer[] = Array.isArray(customersData)
    ? customersData
    : (customersData as any)?.customers || [];

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (searchActive.trim()) p.set("q", searchActive.trim());
    if (customerId) p.set("customer_id", customerId);
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    p.set("page", String(page));
    return p;
  }, [status, searchActive, customerId, fromDate, toDate, page]);

  const { data, isLoading } = useQuery<{ quotations: Quotation[]; total: number; pages: number } | Quotation[]>({
    queryKey: ["team-quotations", params.toString()],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations?${params}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const items: Quotation[] = Array.isArray(data) ? data : (data as any)?.quotations || [];
  const totalPages: number = Array.isArray(data) ? 1 : (data as any)?.pages || 1;
  const totalCount: number = Array.isArray(data) ? items.length : (data as any)?.total || 0;

  function doSearch() {
    setSearchActive(search);
    setPage(1);
  }

  function applyPreset(p: typeof PRESETS[number]) {
    const r = p.range();
    setFromDate(r.from);
    setToDate(r.to);
    setPage(1);
  }

  function clearAll() {
    setStatus("");
    setSearch("");
    setSearchActive("");
    setCustomerId("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  const hasActiveFilter = !!(status || searchActive || customerId || fromDate || toDate);

  return (
    <TeamLayout title="Quotations">
      {/* Filter card */}
      <div className="bg-card border rounded-xl p-4 mb-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Search */}
          <div className="md:col-span-3">
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                onBlur={doSearch}
                placeholder="Quote # or notes…"
                className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-full" />
            </div>
          </div>

          {/* Customer dropdown */}
          <div className="md:col-span-3">
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Customer</label>
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 bg-background text-sm w-full">
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ""}{c.name}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">From</label>
            <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 bg-background text-sm w-full" />
          </div>

          {/* Date to */}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">To</label>
            <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 bg-background text-sm w-full" />
          </div>

          {/* New quote button */}
          <div className="md:col-span-2 flex justify-end">
            <Link href="/team/quotations/new">
              <a className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2 whitespace-nowrap">
                <Plus className="w-4 h-4" /> New Quotation
              </a>
            </Link>
          </div>
        </div>

        {/* Status pills + Presets row */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">Status:</span>
          {STATUS_TABS.map((tab) => (
            <button key={tab.value} onClick={() => { setStatus(tab.value); setPage(1); }}
              className={`px-3 py-1 rounded-md text-xs font-semibold border transition ${status === tab.value ? "bg-accent text-accent-foreground border-accent" : "bg-card border-border hover:bg-muted"}`}>
              {tab.label}
            </button>
          ))}
          <span className="w-px h-5 bg-border mx-1" />
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">Quick:</span>
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="px-3 py-1 rounded-md text-xs font-semibold border bg-card border-border hover:bg-muted transition">
              {p.label}
            </button>
          ))}
          <div className="flex-1" />
          {hasActiveFilter && (
            <button onClick={clearAll}
              className="px-3 py-1 rounded-md text-xs font-semibold border bg-card border-border hover:bg-muted text-muted-foreground inline-flex items-center gap-1">
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>

        {/* Active filter summary */}
        {hasActiveFilter && (
          <div className="mt-2 text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{totalCount}</span> result{totalCount !== 1 ? "s" : ""}
            {fromDate && toDate && fromDate === toDate && <> for <span className="font-semibold text-foreground">{fromDate}</span></>}
            {fromDate && toDate && fromDate !== toDate && <> from <span className="font-semibold text-foreground">{fromDate}</span> to <span className="font-semibold text-foreground">{toDate}</span></>}
            {fromDate && !toDate && <> from <span className="font-semibold text-foreground">{fromDate}</span></>}
            {!fromDate && toDate && <> up to <span className="font-semibold text-foreground">{toDate}</span></>}
            {customerId && (() => {
              const cust = customers.find((c) => String(c.id) === customerId);
              return cust ? <> for <span className="font-semibold text-foreground">{cust.name}</span></> : null;
            })()}
          </div>
        )}
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
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
