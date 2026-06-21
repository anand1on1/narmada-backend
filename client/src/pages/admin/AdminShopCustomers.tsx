import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils-app";

export default function AdminShopCustomers() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort) params.set("sort", sort);
    const r = await adminFetch(token, `/api/admin/shop-customers?${params.toString()}`);
    if (r.ok) { const d = await r.json(); setRows(Array.isArray(d) ? d : []); }
  }
  useEffect(() => { load(); }, [token, sort]); // eslint-disable-line

  return (
    <AdminLayout title="Web Customers">
      <div className="flex items-center gap-2 mb-6">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, phone, name" className="px-3 py-1.5 rounded-lg border bg-card text-sm w-64" data-testid="search-input" />
          <button className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="search-btn">Search</button>
        </form>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="ml-auto px-3 py-1.5 rounded-lg border bg-card text-sm" data-testid="sort-select">
          <option value="recent">Most recent</option>
          <option value="spend">Highest spend</option>
        </select>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No web customers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Phone</th><th className="p-3">Orders</th><th className="p-3">Total Spend</th><th className="p-3">Joined</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30" data-testid={`customer-row-${u.id}`}>
                  <td className="p-3 font-medium">{u.fullName || "—"}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3">{u.phone || "—"}</td>
                  <td className="p-3">{u.orderCount}</td>
                  <td className="p-3 font-medium">{formatINR(u.totalSpend || 0)}</td>
                  <td className="p-3 text-muted-foreground">{u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
