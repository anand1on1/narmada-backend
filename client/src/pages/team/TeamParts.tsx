import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { Search, Package, ChevronDown, ChevronRight as ChevronRightIcon, History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface EnrichedPart {
  id: number;
  partNumber: string;
  name: string;
  brand: string | null;
  hsn: string | null;
  gstRate: number | null;
  lastMrp: number | null;
  lastSource: string | null;
  lastUpdated: number | null;
  useCount: number | null;
  lastDiscount: number | null;
  lastCustomerName: string | null;
  lastCustomerCode: string | null;
  lastQuotedAt: number | null;
  totalQuotesCount: number;
}

interface HistoryRow {
  quotationId: number;
  quoteNo: string;
  customerName: string | null;
  customerCode: string | null;
  brand: string | null;
  mrp: number | null;
  discount: number | null;
  qty: number | null;
  quotedAt: number | null;
}

function fmt(d: number | null) {
  return d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function inr(n: number | null) {
  return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
}

function HistoryExpander({ partNumber }: { partNumber: string }) {
  const { token } = useTeamAuth();
  const { data: history = [], isLoading } = useQuery<HistoryRow[]>({
    queryKey: ["part-history", partNumber],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/parts/${encodeURIComponent(partNumber)}/history?limit=10`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && !!partNumber,
  });

  if (isLoading) {
    return <div className="p-3 text-center text-xs text-muted-foreground">Loading history…</div>;
  }
  if (history.length === 0) {
    return <div className="p-3 text-center text-xs text-muted-foreground">No quote history for this part yet.</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-muted/30 text-left text-[10px] uppercase">
          <th className="px-3 py-2 font-semibold">Date</th>
          <th className="px-3 py-2 font-semibold">Quote #</th>
          <th className="px-3 py-2 font-semibold">Customer</th>
          <th className="px-3 py-2 font-semibold">Brand</th>
          <th className="px-3 py-2 font-semibold text-right">Qty</th>
          <th className="px-3 py-2 font-semibold text-right">MRP</th>
          <th className="px-3 py-2 font-semibold text-right">Disc %</th>
          <th className="px-3 py-2 font-semibold text-right">Net Rate</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {history.map((h, i) => {
          const net = h.mrp != null && h.discount != null ? h.mrp * (1 - h.discount / 100) : null;
          return (
            <tr key={`${h.quotationId}-${i}`} className="hover:bg-muted/20">
              <td className="px-3 py-2 text-muted-foreground">{fmt(h.quotedAt)}</td>
              <td className="px-3 py-2 font-mono font-semibold">{h.quoteNo}</td>
              <td className="px-3 py-2">{h.customerName || "—"} {h.customerCode && <span className="text-muted-foreground">[{h.customerCode}]</span>}</td>
              <td className="px-3 py-2">{h.brand || "—"}</td>
              <td className="px-3 py-2 text-right">{h.qty ?? "—"}</td>
              <td className="px-3 py-2 text-right">{inr(h.mrp)}</td>
              <td className="px-3 py-2 text-right">{h.discount != null ? `${h.discount}%` : "—"}</td>
              <td className="px-3 py-2 text-right font-semibold">{inr(net)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function TeamParts() {
  const { token } = useTeamAuth();
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: parts = [], isLoading } = useQuery<EnrichedPart[]>({
    queryKey: ["team-parts-enriched", searchQ],
    queryFn: async () => {
      if (!searchQ.trim() || searchQ.trim().length < 3) return [];
      const r = await teamFetch(token, `/api/team/parts?q=${encodeURIComponent(searchQ.trim())}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  function doSearch() {
    setSearchQ(q);
    setExpanded(new Set());
  }

  function toggleRow(pn: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(pn)) n.delete(pn);
      else n.add(pn);
      return n;
    });
  }

  return (
    <TeamLayout title="Parts Master">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search part number, name, or brand (min. 3 chars)…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" />
        </div>
        <button onClick={doSearch} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Search className="w-4 h-4" /> Search
        </button>
        {searchQ && (
          <span className="text-xs text-muted-foreground">{parts.length} result{parts.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {!searchQ.trim() ? (
          <div className="p-12 text-center">
            <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Enter at least 3 characters to search parts.</p>
            <p className="text-xs text-muted-foreground mt-2">Each result shows the latest brand, customer, discount, and quoting date for that part.</p>
          </div>
        ) : isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Searching…</div>
        ) : parts.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No parts found for "{searchQ}".</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-3 font-semibold w-8"></th>
                <th className="px-3 py-3 font-semibold">Part Number</th>
                <th className="px-3 py-3 font-semibold">Name</th>
                <th className="px-3 py-3 font-semibold">Brand</th>
                <th className="px-3 py-3 font-semibold">HSN</th>
                <th className="px-3 py-3 font-semibold">GST%</th>
                <th className="px-3 py-3 font-semibold text-right">Last MRP</th>
                <th className="px-3 py-3 font-semibold text-right">Last Disc %</th>
                <th className="px-3 py-3 font-semibold">Last Customer</th>
                <th className="px-3 py-3 font-semibold">Last Quoted</th>
                <th className="px-3 py-3 font-semibold text-right"># Quotes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {parts.map((p) => {
                const isOpen = expanded.has(p.partNumber);
                return (
                  <>
                    <tr key={p.partNumber} className="hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <button onClick={() => toggleRow(p.partNumber)}
                          className="p-1 rounded hover:bg-muted"
                          title="Show quote history"
                          disabled={p.totalQuotesCount === 0}>
                          {p.totalQuotesCount === 0 ? (
                            <ChevronRightIcon className="w-4 h-4 text-muted-foreground/30" />
                          ) : isOpen ? (
                            <ChevronDown className="w-4 h-4 text-accent" />
                          ) : (
                            <ChevronRightIcon className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono font-semibold">{p.partNumber}</td>
                      <td className="px-3 py-3">{p.name}</td>
                      <td className="px-3 py-3">{p.brand ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-muted">{p.brand}</span>
                      ) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-3 font-mono text-xs">{p.hsn || "—"}</td>
                      <td className="px-3 py-3">{p.gstRate != null ? `${p.gstRate}%` : "—"}</td>
                      <td className="px-3 py-3 text-right">{inr(p.lastMrp)}</td>
                      <td className="px-3 py-3 text-right">{p.lastDiscount != null ? <span className="font-semibold text-emerald-600">{p.lastDiscount}%</span> : "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        {p.lastCustomerName ? (
                          <>
                            <div className="font-medium">{p.lastCustomerName}</div>
                            {p.lastCustomerCode && <div className="text-[10px] text-muted-foreground font-mono">[{p.lastCustomerCode}]</div>}
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(p.lastQuotedAt)}</td>
                      <td className="px-3 py-3 text-right text-xs">
                        {p.totalQuotesCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 font-semibold">
                            <History className="w-3 h-3" /> {p.totalQuotesCount}
                          </span>
                        ) : <span className="text-muted-foreground">0</span>}
                      </td>
                    </tr>
                    {isOpen && p.totalQuotesCount > 0 && (
                      <tr key={`${p.partNumber}-history`}>
                        <td colSpan={11} className="bg-muted/10 px-4 py-2 border-t">
                          <HistoryExpander partNumber={p.partNumber} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Parts master is populated automatically as quotations and price lists are uploaded. Click the arrow next to a part to see the last 10 quotes for it.
      </p>
    </TeamLayout>
  );
}
