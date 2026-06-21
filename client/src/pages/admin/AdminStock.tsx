import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Search, Boxes } from "lucide-react";

// R27.4 BUG-8 — admin stock view. Shows per-product per-branch stock (Delhi vs Patna)
// with search (part number / product name) and a branch filter. Reads GET /api/admin/stock.
interface StockRow {
  id: number;
  branch: string;
  product_id: number | null;
  productName: string | null;
  part_number: string | null;
  po_id: number | null;
  qty: number;
  rate: number | null;
  received_at: string | null;
  status: string;
}

const BRANCHES = ["all", "Delhi", "Patna"];
const STATUSES = ["in_stock", "dispatched", "all"];

export default function AdminStock() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("in_stock");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(id); }, [search]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams();
        if (branch !== "all") p.set("branch", branch);
        if (status !== "all") p.set("status", status);
        if (debounced) p.set("q", debounced);
        const r = await adminFetch(token, `/api/admin/stock?${p.toString()}`);
        const j = r.ok ? await r.json() : [];
        if (alive) setRows(Array.isArray(j) ? j : []);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token, branch, status, debounced]);

  const branchBadge = (b: string) =>
    b === "Delhi" ? "bg-blue-500/15 text-blue-700" : b === "Patna" ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-500/15 text-slate-700";

  return (
    <AdminLayout title="Stock">
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part number or product name…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" data-testid="input-stock-search" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="select-stock-branch">
            {BRANCHES.map((b) => <option key={b} value={b}>{b === "all" ? "All" : b}</option>)}
          </select>
          <label className="text-xs text-muted-foreground">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="select-stock-status">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All" : s === "in_stock" ? "In Stock" : "Dispatched"}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <Boxes className="w-10 h-10 opacity-30" />
            <span>No stock records{debounced ? " match your search." : "."}</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Branch</th>
                <th className="px-4 py-3 font-semibold">Part #</th>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold text-right">Qty</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
                <th className="px-4 py-3 font-semibold">Received</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.id} data-testid={`row-stock-${s.id}`}>
                  <td className="px-4 py-3"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${branchBadge(s.branch)}`}>{s.branch}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{s.part_number || "—"}</td>
                  <td className="px-4 py-3 text-xs">{s.productName || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{s.qty}</td>
                  <td className="px-4 py-3 text-right">{s.rate != null ? `₹${Number(s.rate).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.received_at ? new Date(s.received_at).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3 text-xs">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
