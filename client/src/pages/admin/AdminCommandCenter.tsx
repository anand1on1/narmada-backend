import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "./AdminLayout";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import {
  DollarSign, FileText, Truck, AlertTriangle, MessageSquare, BarChart3,
  Send, Users, Building2, ChevronDown,
} from "lucide-react";

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

// R25a Fix 5 — colored gradient widget card with icon top-right.
function Card({ title, children, gradient, text, icon: Icon }: {
  title: string; children: React.ReactNode;
  gradient: string; text: string; icon: React.ElementType;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} border rounded-2xl shadow-md p-6 flex flex-col relative overflow-hidden`}
      data-testid={`widget-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Icon className={`w-8 h-8 absolute top-4 right-4 opacity-30 ${text}`} />
      <div className={`text-[11px] uppercase tracking-wider font-bold mb-2 ${text} opacity-80`}>{title}</div>
      <div className={`flex-1 ${text}`}>{children}</div>
    </div>
  );
}

// R25a Fix 5 — quick role switcher (opens each portal's login/home in a new tab).
const ROLE_LINKS: Array<{ label: string; hash: string }> = [
  { label: "Admin", hash: "#/admin" },
  { label: "Data Team", hash: "#/team/login" },
  { label: "Delhi", hash: "#/delhi/login" },
  { label: "Consignment", hash: "#/admin/consignments" },
  { label: "Customer", hash: "#/portal" },
];
function RoleSwitcher() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="px-3 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 bg-card hover:bg-muted"
        data-testid="role-switcher">
        Quick Login As… <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-card border rounded-lg shadow-xl z-20 py-1 w-44">
            {ROLE_LINKS.map((r) => (
              <a key={r.hash} href={r.hash} target="_blank" rel="noreferrer"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm hover:bg-muted">
                {r.label}
              </a>
            ))}
          </div>
        </>
      )}
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
      <div className="flex justify-end mb-4">
        <RoleSwitcher />
      </div>
      {err && <div className="mb-4 text-sm text-red-600">Error: {err}</div>}
      {!data && !err && <div className="text-sm text-muted-foreground">Loading widgets…</div>}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card title="Today's Revenue" gradient="from-emerald-50 to-emerald-100" text="text-emerald-800" icon={DollarSign}>
            <div className="text-3xl font-bold">{inr(data.todayRevenue)}</div>
          </Card>
          <Card title="Open POs" gradient="from-blue-50 to-blue-100" text="text-blue-800" icon={FileText}>
            <div className="text-3xl font-bold">{data.openPos.count}</div>
            <div className="text-sm opacity-70 mt-1">{inr(data.openPos.value)} value</div>
          </Card>
          <Card title="Pending Dispatches" gradient="from-amber-50 to-amber-100" text="text-amber-800" icon={Truck}>
            <div className="text-3xl font-bold">{data.pendingDispatches}</div>
          </Card>

          <Card title="Low Margin Alerts (<5%)" gradient="from-rose-50 to-rose-100" text="text-rose-800" icon={AlertTriangle}>
            {data.lowMarginAlerts.length === 0 ? (
              <div className="text-sm opacity-70">None — healthy margins.</div>
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

          <Card title="Recent Vendor Replies" gradient="from-purple-50 to-purple-100" text="text-purple-800" icon={MessageSquare}>
            {data.recentVendorReplies.length === 0 ? (
              <div className="text-sm opacity-70">No replies yet.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recentVendorReplies.map((r) => (
                  <li key={r.id}>
                    <div className="flex justify-between">
                      <span className="font-semibold truncate">{r.vendorName}</span>
                      <span className="text-xs opacity-70">{timeAgo(r.createdAt)}</span>
                    </div>
                    <div className="opacity-70 truncate">{r.snippet}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="This Week's Quotations" gradient="from-indigo-50 to-indigo-100" text="text-indigo-800" icon={BarChart3}>
            <div className="flex gap-6">
              <div><div className="text-2xl font-bold">{data.weekQuotations.sent}</div><div className="text-xs opacity-70">sent</div></div>
              <div><div className="text-2xl font-bold">{data.weekQuotations.accepted}</div><div className="text-xs opacity-70">accepted</div></div>
            </div>
          </Card>

          <Card title="RFQs Awaiting Rates" gradient="from-cyan-50 to-cyan-100" text="text-cyan-800" icon={Send}>
            <div className="text-3xl font-bold">{data.awaitingRates}</div>
            <div className="text-xs opacity-70 mt-1">last 7 days</div>
          </Card>

          <Card title="Top Customers (30d)" gradient="from-fuchsia-50 to-fuchsia-100" text="text-fuchsia-800" icon={Users}>
            {data.topCustomers.length === 0 ? (
              <div className="text-sm opacity-70">No data.</div>
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

          <Card title="Top Vendors by Spend (30d)" gradient="from-orange-50 to-orange-100" text="text-orange-800" icon={Building2}>
            {data.topVendors.length === 0 ? (
              <div className="text-sm opacity-70">No data.</div>
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
