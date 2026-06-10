import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { Search, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Part {
  id: number;
  partNumber: string;
  name: string;
  hsn: string | null;
  gstRate: number | null;
  brand: string | null;
  lastMrp: number | null;
  lastSource: string | null;
  lastUpdated: number | null;
}

export default function TeamParts() {
  const { token } = useTeamAuth();
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const { data: parts = [], isLoading } = useQuery<Part[]>({
    queryKey: ["team-parts", searchQ],
    queryFn: async () => {
      if (!searchQ.trim() || searchQ.trim().length < 3) return [];
      const r = await teamFetch(token, `/api/team/parts?q=${encodeURIComponent(searchQ.trim())}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  function doSearch() { setSearchQ(q); }

  return (
    <TeamLayout title="Parts Master">
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search by part number or name (min. 3 chars)…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" />
        </div>
        <button onClick={doSearch} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Search className="w-4 h-4" /> Search
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {!searchQ.trim() ? (
          <div className="p-12 text-center">
            <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Enter at least 3 characters to search parts.</p>
          </div>
        ) : isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Searching…</div>
        ) : parts.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No parts found for "{searchQ}".</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Part Number</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Brand</th>
                <th className="px-4 py-3 font-semibold">HSN</th>
                <th className="px-4 py-3 font-semibold">GST%</th>
                <th className="px-4 py-3 font-semibold text-right">Last MRP</th>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {parts.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono font-semibold">{p.partNumber}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{p.brand || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.hsn || "—"}</td>
                  <td className="px-4 py-3">{p.gstRate != null ? `${p.gstRate}%` : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {p.lastMrp != null ? `₹${Number(p.lastMrp).toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{p.lastSource || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {p.lastUpdated ? new Date(p.lastUpdated).toLocaleDateString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Parts master is populated automatically as quotations are created. Read-only view.
      </p>
    </TeamLayout>
  );
}
