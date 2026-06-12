import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "./AdminLayout";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";

// R23.1 — owner Command Center. 9 read-only widgets, polled every 30s. No page reload.
type CC = {
  todayRevenue: number;
  openPos: { count: number; value: number };
  pendingDispatches: number;
  lowMarginAlerts: Array<{ id: number; poNumber: string; customerName: string | null; marginPct: number; custTotal: number }>;
  recentVendorReplies: Array<{ id: number; vendorName: string; snippet: string; createdAt: number }>;
  weekQuotations: { sent: number; accepted: number };
  awaitingRates: number;
  topCustomers: Array<{ customerId: number; customerName: string; total: number }>;
  topVendors: Array<{ vendorId: number; vendorName: string; spend: number }>;
};

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN");
const timeAgo = (ms: number) => {
  if (!ms) return "";
  const s = Math.floor((Date.now() - Number(ms)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl p-5 shadow-sm flex flex-col" data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">{title}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export default function AdminCommandCenter() {
  const { token } = useAdminAuth();
  const [data, setData] = useState<CC | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(token, "/api/admin/command-center");
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "failed to load");
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // R24.5 — 30s polling, no reload
    return () => clearInterval(id);
  }, [load]);

  return (
    <AdminLayout title="Command Center">
      {err && <div className="mb-4 text-sm text-red-600">Error: {err}</div>}
      {!data && !err && <div className="text-sm text-muted-foreground">Loading widgets…</div>}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card title="Today's Revenue">
            <div className="text-3xl font-bold">{inr(data.todayRevenue)}</div>
          </Card>
          <Card title="Open POs">
            <div className="text-3xl font-bold">{data.openPos.count}</div>
            <div className="text-sm text-muted-foreground mt-1">{inr(data.openPos.value)} value</div>
          </Card>
          <Card title="Pending Dispatches">
            <div className="text-3xl font-bold">{data.pendingDispatches}</div>
          </Card>

          <Card title="Low Margin Alerts (<5%)">
            {data.lowMarginAlerts.length === 0 ? (
              <div className="text-sm text-muted-foreground">None — healthy margins.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.lowMarginAlerts.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate">{a.poNumber} · {a.customerName || "—"}</span>
                    <span className={a.marginPct < 0 ? "text-red-600 font-semibold" : "text-amber-600 font-semibold"}>{a.marginPct}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent Vendor Replies">
            {data.recentVendorReplies.length === 0 ? (
              <div className="text-sm text-muted-foreground">No replies yet.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recentVendorReplies.map((r) => (
                  <li key={r.id}>
                    <div className="flex justify-between">
                      <span className="font-semibold truncate">{r.vendorName}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                    </div>
                    <div className="text-muted-foreground truncate">{r.snippet}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="This Week's Quotations">
            <div className="flex gap-6">
              <div><div className="text-2xl font-bold">{data.weekQuotations.sent}</div><div className="text-xs text-muted-foreground">sent</div></div>
              <div><div className="text-2xl font-bold">{data.weekQuotations.accepted}</div><div className="text-xs text-muted-foreground">accepted</div></div>
            </div>
          </Card>

          <Card title="RFQs Awaiting Rates">
            <div className="text-3xl font-bold">{data.awaitingRates}</div>
            <div className="text-xs text-muted-foreground mt-1">last 7 days</div>
          </Card>

          <Card title="Top Customers (30d)">
            {data.topCustomers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.topCustomers.map((c) => (
                  <li key={c.customerId} className="flex justify-between gap-2">
                    <span className="truncate">{c.customerName}</span>
                    <span className="font-semibold">{inr(c.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Top Vendors by Spend (30d)">
            {data.topVendors.length === 0 ? (
              <div className="text-sm text-muted-foreground">No data.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.topVendors.map((v) => (
                  <li key={v.vendorId} className="flex justify-between gap-2">
                    <span className="truncate">{v.vendorName}</span>
                    <span className="font-semibold">{inr(v.spend)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
