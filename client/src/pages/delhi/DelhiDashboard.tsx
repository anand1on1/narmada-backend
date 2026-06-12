/**
 * R12 — DelhiDashboard.tsx (PO-centric rebuild)
 * The old per-line pickup/pack/dispatch queue did not fit the PO-centric workflow. This
 * dashboard lists POs with a rolled-up line state and three interchangeable views:
 * Table / Kanban / Tabs (segmented switcher, persisted in localStorage). Filters: date range,
 * customer (multi-select), and status chips. All views share GET /api/delhi/pos/list.
 * Opening a PO routes to /delhi/po/:id (DelhiPODetail) for marking lines packed + dispatch.
 */
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";
import {
  LogOut, Megaphone, X, Table as TableIcon, Columns, LayoutList,
  Package, Search, ChevronDown,
} from "lucide-react";

type ViewMode = "table" | "kanban" | "tabs";
const VIEW_KEY = "delhi_view_mode";

// Buckets map to po_item fulfil_status stages rolled up per-PO.
const BUCKETS = [
  { key: "pending", label: "To Pick Up", color: "bg-slate-500/15 text-slate-700" },
  { key: "collected", label: "Received", color: "bg-blue-500/15 text-blue-700" },
  { key: "packed", label: "Packed", color: "bg-amber-500/15 text-amber-700" },
  { key: "dispatched", label: "Dispatched", color: "bg-emerald-500/15 text-emerald-700" },
] as const;
const TO_DISPATCH = { key: "to_dispatch", label: "To Dispatch", color: "bg-orange-500/15 text-orange-700" };

interface PoRow {
  id: number;
  po_number: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_po_number: string | null;
  created_at: number;
  po_date: number | null;
  status: string;
  bucket: string;
  counts: { pending: number; collected: number; packed: number; dispatched: number };
  packed_count: number;
  line_count: number;
  total_qty: number;
  is_fully_dispatched: number;
}
interface CustomerOpt { id: number; name: string; }

function fmt(d: number | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function bucketMeta(key: string) {
  return BUCKETS.find((b) => b.key === key) || { key, label: key, color: "bg-muted" };
}
function linesSummary(p: PoRow) {
  return `${p.packed_count}/${p.line_count} packed`;
}
function isoDay(ms: number) { return new Date(ms).toISOString().slice(0, 10); }

export default function DelhiDashboard() {
  const { token, user, clear, ready } = useTeamAuth();
  const [, navigate] = useLocation();

  const [view, setView] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as ViewMode) || "tabs"; } catch { return "tabs"; }
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch {} }, [view]);

  // ── Filters ──
  const now = Date.now();
  const [fromDate, setFromDate] = useState(() => isoDay(now - 30 * 24 * 60 * 60 * 1000));
  const [toDate, setToDate] = useState(() => isoDay(now));
  const [customerIds, setCustomerIds] = useState<number[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const [custSearch, setCustSearch] = useState("");
  // Status chips — default first 4 ON (incl. To Dispatch), Dispatched OFF.
  const [statusOn, setStatusOn] = useState<Record<string, boolean>>({
    pending: true, collected: true, packed: true, to_dispatch: true, dispatched: false,
  });

  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("delhi_announcement_dismissed") === "1"; } catch { return false; }
  });
  const [activeTab, setActiveTab] = useState<string>("pending");

  useEffect(() => { if (ready && !token) navigate("/delhi"); }, [ready, token, navigate]);

  const { data: announcement } = useQuery<{ id: number; title: string; body: string | null } | null>({
    queryKey: ["delhi-announcement"],
    queryFn: async () => {
      if (!token) return null;
      const r = await teamFetch(token, `/api/team/announcements`);
      if (!r.ok) return null;
      const arr = await r.json();
      return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    },
    enabled: !!token, staleTime: 60_000,
  });

  const { data: customers = [] } = useQuery<CustomerOpt[]>({
    queryKey: ["delhi-customers"],
    queryFn: async () => { const r = await teamFetch(token, `/api/delhi/customers`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const fromMs = useMemo(() => new Date(fromDate + "T00:00:00").getTime(), [fromDate]);
  const toMs = useMemo(() => new Date(toDate + "T23:59:59").getTime(), [toDate]);

  const { data: pos = [], isLoading } = useQuery<PoRow[]>({
    queryKey: ["delhi-pos-list", fromMs, toMs, customerIds.join(",")],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("from", String(fromMs));
      params.set("to", String(toMs));
      if (customerIds.length === 1) params.set("customer_id", String(customerIds[0]));
      const r = await teamFetch(token, `/api/delhi/pos/list?${params.toString()}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token, refetchInterval: 20_000,
  });

  // Client-side: multi-customer filter (server takes a single customer_id) + status chip filter.
  const filtered = useMemo(() => {
    return pos.filter((p) => {
      if (customerIds.length > 0 && (p.customer_id == null || !customerIds.includes(p.customer_id))) return false;
      // A PO matches if its bucket chip is ON. "to_dispatch" chip == bucket 'packed' that is ready to dispatch.
      const chipKey = p.bucket === "packed" ? (statusOn.packed || statusOn.to_dispatch ? p.bucket : null) : p.bucket;
      if (p.bucket === "packed") {
        if (!statusOn.packed && !statusOn.to_dispatch) return false;
        return true;
      }
      return !!statusOn[p.bucket];
    });
  }, [pos, customerIds, statusOn]);

  async function logout() {
    if (token) { try { await teamFetch(token, "/api/team/logout", { method: "POST" }); } catch {} }
    clear();
    navigate("/delhi");
  }
  function openPo(id: number) { navigate(`/delhi/po/${id}`); }
  function toggleCustomer(id: number) {
    setCustomerIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  }
  if (!token) return null;

  const filteredCustomers = customers.filter((c) => c.name.toLowerCase().includes(custSearch.toLowerCase()));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-card border-b sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold hidden sm:block">Delhi Warehouse</div>
          </div>
          <div className="flex items-center gap-3">
            {user && <div className="text-xs text-muted-foreground hidden sm:block">{user.name}</div>}
            <button onClick={logout} className="text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 text-red-600 inline-flex items-center gap-1.5">
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>
      </header>

      {announcement && !bannerDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
          <Megaphone className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{announcement.title}</span>
            {announcement.body && <span className="ml-2">{announcement.body}</span>}
          </div>
          <button onClick={() => { setBannerDismissed(true); try { sessionStorage.setItem("delhi_announcement_dismissed", "1"); } catch {} }}
            className="text-amber-500 hover:text-amber-700 flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        {/* Top bar: view switcher + filters */}
        <div className="bg-card border rounded-xl p-3 mb-5 flex flex-wrap items-center gap-3 shadow-sm">
          {/* View switcher (segmented) */}
          <div className="inline-flex rounded-lg border overflow-hidden">
            {([["table", TableIcon, "Table"], ["kanban", Columns, "Kanban"], ["tabs", LayoutList, "Tabs"]] as const).map(([key, Icon, label]) => (
              <button key={key} onClick={() => setView(key)}
                className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 transition ${view === key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="border rounded-lg px-2 py-1.5 bg-background" />
            <span className="text-muted-foreground">To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="border rounded-lg px-2 py-1.5 bg-background" />
          </div>

          {/* Customer multi-select */}
          <div className="relative">
            <button onClick={() => setCustOpen((o) => !o)}
              className="border rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted">
              {customerIds.length === 0 ? "All Customers" : `${customerIds.length} customer(s)`}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {custOpen && (
              <div className="absolute z-40 mt-1 w-64 bg-card border rounded-lg shadow-lg p-2">
                <div className="flex items-center gap-1.5 border rounded-lg px-2 py-1 mb-2">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search…"
                    className="text-xs bg-transparent outline-none flex-1" />
                </div>
                {customerIds.length > 0 && (
                  <button onClick={() => setCustomerIds([])} className="text-[11px] text-accent hover:underline mb-1">Clear all</button>
                )}
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {filteredCustomers.length === 0 ? <div className="text-xs text-muted-foreground px-2 py-1">No customers</div> :
                    filteredCustomers.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-xs">
                        <input type="checkbox" checked={customerIds.includes(c.id)} onChange={() => toggleCustomer(c.id)} />
                        <span className="truncate">{c.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[...BUCKETS.slice(0, 3), TO_DISPATCH, BUCKETS[3]].map((b) => (
              <button key={b.key} onClick={() => setStatusOn((s) => ({ ...s, [b.key]: !s[b.key] }))}
                className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border transition ${statusOn[b.key] ? `${b.color} border-transparent` : "bg-background text-muted-foreground border-border"}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-16">Loading POs…</div>
        ) : view === "table" ? (
          <TableView pos={filtered} onOpen={openPo} />
        ) : view === "kanban" ? (
          <KanbanView pos={filtered} onOpen={openPo} />
        ) : (
          <TabsView pos={filtered} onOpen={openPo} activeTab={activeTab} setActiveTab={setActiveTab} />
        )}
      </div>
    </div>
  );
}

// ─── Shared row layout for Table + Tabs ───
function PoTable({ pos, onOpen }: { pos: PoRow[]; onOpen: (id: number) => void }) {
  if (pos.length === 0) return <div className="p-12 text-center text-muted-foreground">No POs match these filters.</div>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-muted/50 text-left">
        <th className="px-3 py-3 font-semibold">PO #</th>
        <th className="px-3 py-3 font-semibold">Customer</th>
        <th className="px-3 py-3 font-semibold">Date</th>
        <th className="px-3 py-3 font-semibold">Status</th>
        <th className="px-3 py-3 font-semibold">Lines</th>
        <th className="px-3 py-3 font-semibold text-right">Total Qty</th>
        <th className="px-3 py-3 font-semibold text-right">Open</th>
      </tr></thead>
      <tbody className="divide-y">{pos.map((p) => {
        const m = bucketMeta(p.bucket);
        return (
          <tr key={p.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => onOpen(p.id)}>
            <td className="px-3 py-3 font-semibold">{p.po_number}</td>
            <td className="px-3 py-3">{p.customer_name || "—"}</td>
            <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(p.po_date || p.created_at)}</td>
            <td className="px-3 py-3"><span className={`text-xs font-bold rounded px-2 py-1 ${m.color}`}>{m.label}</span></td>
            <td className="px-3 py-3 text-xs">{linesSummary(p)}</td>
            <td className="px-3 py-3 text-right">{p.total_qty}</td>
            <td className="px-3 py-3 text-right">
              <button onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                className="text-accent font-semibold hover:underline text-xs inline-flex items-center gap-1">
                <Package className="w-3.5 h-3.5" /> Open
              </button>
            </td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function TableView({ pos, onOpen }: { pos: PoRow[]; onOpen: (id: number) => void }) {
  return <div className="bg-card border rounded-xl overflow-x-auto shadow-sm"><PoTable pos={pos} onOpen={onOpen} /></div>;
}

function TabsView({ pos, onOpen, activeTab, setActiveTab }: { pos: PoRow[]; onOpen: (id: number) => void; activeTab: string; setActiveTab: (s: string) => void; }) {
  const tabs = BUCKETS;
  const byBucket = (key: string) => pos.filter((p) => p.bucket === key);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => {
          const count = byBucket(t.key).length;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === t.key ? "bg-accent text-accent-foreground shadow-sm" : "bg-card border hover:bg-muted"}`}>
              {t.label} <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
        <PoTable pos={byBucket(activeTab)} onOpen={onOpen} />
      </div>
    </div>
  );
}

function KanbanView({ pos, onOpen }: { pos: PoRow[]; onOpen: (id: number) => void }) {
  const cols = [
    { key: "pending", label: "To Pick Up" },
    { key: "collected", label: "Received" },
    { key: "packed", label: "Packed" },
    { key: "packed_dispatch", label: "To Dispatch" },
  ];
  // "Packed" and "To Dispatch" both surface packed POs; To Dispatch highlights those with packed lines ready.
  function inCol(p: PoRow, key: string) {
    if (key === "packed") return p.bucket === "packed";
    if (key === "packed_dispatch") return p.packed_count > 0 && p.bucket !== "dispatched";
    return p.bucket === key;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cols.map((c) => {
        const items = pos.filter((p) => inCol(p, c.key));
        return (
          <div key={c.key} className="bg-muted/30 rounded-xl p-3">
            <div className="font-bold text-sm mb-3 flex items-center justify-between">
              <span>{c.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">Empty</div> :
                items.map((p) => {
                  const stateCount = c.key === "packed_dispatch" ? p.packed_count : (p.counts as any)[c.key === "packed" ? "packed" : c.key];
                  return (
                    <button key={p.id} onClick={() => onOpen(p.id)}
                      className="w-full text-left bg-card border rounded-lg p-3 shadow-sm hover:shadow transition">
                      <div className="font-semibold text-sm">{p.po_number}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{p.customer_name || "—"}</div>
                      <div className="text-xs mt-1.5 flex items-center justify-between">
                        <span>{linesSummary(p)}</span>
                        <span className="font-semibold text-accent">{stateCount} line(s)</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
