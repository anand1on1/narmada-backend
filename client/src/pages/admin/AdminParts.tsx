import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Search, Package } from "lucide-react";

interface Part {
  partNumber: string;
  brand: string | null;
  description: string | null;
  lastCustomer?: string | null;
  lastDiscount?: number | null;
  lastQuotedAt?: number | null;
}

export default function AdminParts() {
  const { token } = useAdminAuth();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const { data: parts = [], isFetching } = useQuery<Part[]>({
    queryKey: ["admin-parts", search],
    queryFn: async () => {
      if (search.length < 3) return [];
      const r = await adminFetch(token, `/api/team/parts?q=${encodeURIComponent(search)}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && search.length >= 3,
  });

  function doSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q.trim());
  }

  return (
    <AdminLayout title="Parts Master">
      <div className="bg-card border rounded-xl p-5 shadow-sm mb-6">
        <p className="text-sm text-muted-foreground mb-3">
          Search the parts catalogue. Enter at least 3 characters of a part number or description.
        </p>
        <form onSubmit={doSearch} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. 2723 or brake pad or OEM number…"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm"
          />
          <button
            type="submit"
            disabled={q.trim().length < 3}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Search className="w-4 h-4" /> Search
          </button>
        </form>
      </div>

      {search.length >= 3 && (
        <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
          {isFetching ? (
            <div className="p-12 text-center text-muted-foreground">Searching…</div>
          ) : parts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
              <Package className="w-10 h-10 opacity-30" />
              <span>No parts found for "{search}".</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-3 font-semibold">Part Number</th>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Last Customer</th>
                  <th className="px-4 py-3 font-semibold text-right">Last Discount %</th>
                  <th className="px-4 py-3 font-semibold">Last Quoted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {parts.map((p, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{p.partNumber}</td>
                    <td className="px-4 py-3">{p.brand || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{p.description || "—"}</td>
                    <td className="px-4 py-3 text-xs">{p.lastCustomer || "—"}</td>
                    <td className="px-4 py-3 text-xs text-right">
                      {p.lastDiscount != null ? `${p.lastDiscount}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.lastQuotedAt ? new Date(p.lastQuotedAt).toLocaleDateString("en-IN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
