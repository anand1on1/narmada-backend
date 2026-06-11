import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";

interface HistoryRow {
  id: number;
  poNumber: string;
  poDate: number;
  customerName: string | null;
  partNumber: string | null;
  brand: string | null;
  qty: number;
  vendorName: string | null;
  vendorRate: number | null;
  lineTotal: number | null;
}

export default function AdminPurchaseHistory() {
  const { token } = useAdminAuth();
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [search, setSearch] = useState<{ q: string; brand: string }>({ q: "", brand: "" });
  const [page, setPage] = useState(1);

  const { data, isFetching } = useQuery<{ rows: HistoryRow[]; total: number }>({
    queryKey: ["admin-purchase-history", search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.q) params.set("q", search.q);
      if (search.brand) params.set("brand", search.brand);
      params.set("page", String(page));
      params.set("limit", "50");
      const r = await adminFetch(token, `/api/admin/purchase-history?${params}`);
      if (!r.ok) return { rows: [], total: 0 };
      return r.json();
    },
    enabled: !!token,
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;

  function doSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch({ q: q.trim(), brand: brand.trim() });
  }

  async function exportExcel() {
    if (!token) return;
    const params = new URLSearchParams();
    if (search.q) params.set("q", search.q);
    if (search.brand) params.set("brand", search.brand);
    const r = await adminFetch(token, `/api/admin/purchase-history/export.xlsx?${params}`);
    if (!r.ok) { alert("Export failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-history-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminLayout title="Purchase History">
      <form onSubmit={doSearch} className="bg-card border rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end shadow-sm">
        <label className="text-xs font-semibold block">
          Part #
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. 2723 or FIL-"
            className="mt-1 border rounded-lg px-3 py-2 bg-background text-sm font-normal w-44"
          />
        </label>
        <label className="text-xs font-semibold block">
          Brand
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="TATA, CEAT…"
            className="mt-1 border rounded-lg px-3 py-2 bg-background text-sm font-normal w-36"
          />
        </label>
        <div className="flex gap-2 items-end">
          <button type="submit" className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
            <Search className="w-4 h-4" /> Search
          </button>
          <button
            type="button"
            onClick={exportExcel}
            className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </form>

      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        {isFetching ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No purchase history found.</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">PO #</th>
                  <th className="px-3 py-3 font-semibold">Customer</th>
                  <th className="px-3 py-3 font-semibold">Part #</th>
                  <th className="px-3 py-3 font-semibold">Brand</th>
                  <th className="px-3 py-3 font-semibold text-right">Qty</th>
                  <th className="px-3 py-3 font-semibold">Seller</th>
                  <th className="px-3 py-3 font-semibold text-right">Rate</th>
                  <th className="px-3 py-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs">{r.poDate ? new Date(r.poDate).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{r.poNumber}</td>
                    <td className="px-3 py-2 text-xs">{r.customerName || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.partNumber || "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.brand || "—"}</td>
                    <td className="px-3 py-2 text-xs text-right">{r.qty}</td>
                    <td className="px-3 py-2 text-xs">{r.vendorName || "—"}</td>
                    <td className="px-3 py-2 text-xs text-right">{r.vendorRate != null ? `₹${r.vendorRate.toLocaleString("en-IN")}` : "—"}</td>
                    <td className="px-3 py-2 text-xs text-right font-semibold">{r.lineTotal != null ? `₹${r.lineTotal.toLocaleString("en-IN")}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>{total} total records</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 border rounded disabled:opacity-40">← Prev</button>
                <span className="px-2 py-1">Page {page}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={rows.length < 50} className="px-2 py-1 border rounded disabled:opacity-40">Next →</button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
