import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils-app";

const STATUSES = ["all", "placed", "confirmed", "processing", "dispatched", "delivered", "cancelled"];

export default function AdminShopOrders() {
  const { token } = useAdminAuth();
  const [data, setData] = useState<{ orders: any[]; total: number }>({ orders: [], total: 0 });
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    const r = await adminFetch(token, `/api/admin/shop-orders?${params.toString()}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => { load(); }, [token, status]); // eslint-disable-line

  return (
    <AdminLayout title="Web Orders">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold capitalize ${status === s ? "bg-accent text-accent-foreground" : "bg-card border hover:bg-muted"}`} data-testid={`filter-${s}`}>{s}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="ml-auto flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order #, name, email, phone" className="px-3 py-1.5 rounded-lg border bg-card text-sm w-64" data-testid="search-input" />
          <button className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="search-btn">Search</button>
        </form>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {data.orders.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No orders found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Order #</th><th className="p-3">Customer</th><th className="p-3">Items</th>
                <th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.orders.map((o) => (
                <tr key={o.id} className="hover:bg-muted/30" data-testid={`order-row-${o.id}`}>
                  <td className="p-3"><Link href={`/admin/orders/${o.id}`}><a className="font-mono font-semibold text-accent hover:underline">{o.orderNumber}</a></Link></td>
                  <td className="p-3">{o.customerName || o.customerEmail}<div className="text-xs text-muted-foreground">{o.customerPhone}</div></td>
                  <td className="p-3">{o.itemCount}</td>
                  <td className="p-3 font-medium">{formatINR(o.totalInr)}</td>
                  <td className="p-3 capitalize">{o.status}</td>
                  <td className="p-3 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-3">{data.total} total order(s)</p>
    </AdminLayout>
  );
}
