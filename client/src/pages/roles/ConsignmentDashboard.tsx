import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { ConsignmentAuth } from "@/lib/role-auth";
import { Truck } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";

// R26.5 (F) — Consignment portal. Read view over /api/consignment/orders mirroring
// the admin consignments columns. Status filter + free-text search.
interface Consignment {
  id: number; docketNumber: string; carrier: string | null; origin: string; destination: string;
  customerName: string | null; customerPhone: string | null; invoiceNumber: string | null;
  invoiceAmount: number | null; status: string; dispatchDate: number | null; etaDate: number | null;
  deliveredDate: number | null;
}
const STATUSES = ["pending", "in_transit", "out_for_delivery", "delivered", "cancelled"];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-700", in_transit: "bg-amber-500/15 text-amber-700",
  out_for_delivery: "bg-blue-500/15 text-blue-700", delivered: "bg-emerald-500/15 text-emerald-700",
  cancelled: "bg-rose-500/15 text-rose-700",
};
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-IN") : "—");

export default function ConsignmentDashboard() {
  const { token } = ConsignmentAuth.useAuth();
  const [items, setItems] = useState<Consignment[]>([]);
  const [statusF, setStatusF] = useState("all");
  const [q, setQ] = useState("");

  async function load() {
    if (!token) return;
    const p = new URLSearchParams();
    if (statusF !== "all") p.set("status", statusF);
    if (q.trim()) p.set("q", q.trim());
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/orders?${p}`);
    if (r.ok) setItems(await r.json()); else setItems([]);
  }
  useEffect(() => { load(); }, [token, statusF]); // eslint-disable-line

  const statusBadge = (s: string) => <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_COLOR[s] || "bg-muted"}`}>{s.replace(/_/g, " ")}</span>;

  return (
    <RolePortalShell title="Consignment Portal" accent="text-blue-600" icon={Truck} auth={ConsignmentAuth} loginPath="/consignment/login"
      right={<NotificationsBell roleFetch={ConsignmentAuth.roleFetch} token={token} />}>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="filter-consignment-status">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search docket / invoice / customer…" className="border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-48" data-testid="search-consignments" />
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Search</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No consignments in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Docket</th>
                <th className="px-4 py-3 font-semibold">Route</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">Dispatch</th>
                <th className="px-4 py-3 font-semibold">ETA</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id} data-testid={`row-consignment-${c.id}`}>
                  <td className="px-4 py-3 font-mono font-semibold">{c.docketNumber}<div className="text-[11px] text-muted-foreground font-sans">{c.carrier || ""}</div></td>
                  <td className="px-4 py-3 text-xs">{c.origin} → {c.destination}</td>
                  <td className="px-4 py-3 text-xs">{c.customerName || "—"}<div className="text-muted-foreground">{c.customerPhone || ""}</div></td>
                  <td className="px-4 py-3 text-xs">{c.invoiceNumber || "—"}{c.invoiceAmount != null && <div className="text-muted-foreground">₹{Number(c.invoiceAmount).toLocaleString("en-IN")}</div>}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(c.dispatchDate)}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(c.etaDate)}</td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </RolePortalShell>
  );
}
