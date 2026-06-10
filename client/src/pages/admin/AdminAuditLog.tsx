import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Search, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface AuditEntry {
  id: number;
  actorType: string;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  beforeJson: string | null;
  afterJson: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

interface AuditResponse {
  rows?: AuditEntry[];
  logs?: AuditEntry[];
  total: number;
  page?: number;
  pages?: number;
  pageSize?: number;
}

const AUDIT_PAGE_SIZE = 50;

const ACTOR_TYPES = ["", "admin", "data_team", "customer"];
const ACTIONS = [
  "", "create", "update", "delete", "login", "logout", "approve", "reject", "finalize", "duplicate",
];
const ENTITY_TYPES = [
  "", "quoting_company", "quotation", "customer", "account_request", "data_team_user",
  "rfq", "purchase_order", "consignment",
];

export default function AdminAuditLog() {
  const { token } = useAdminAuth();
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewEntry, setViewEntry] = useState<AuditEntry | null>(null);

  const params = new URLSearchParams();
  if (actor) params.set("actor", actor);
  if (action) params.set("action", action);
  if (entity) params.set("entity_type", entity);
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  params.set("page", String(page));

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["audit-logs", actor, action, entity, dateFrom, dateTo, page],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/audit-logs?${params}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  // Backend returns { rows, total }; tolerate legacy { logs, pages } too.
  const logs = data?.rows ?? data?.logs ?? [];
  const totalPages = data?.pages ?? Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? AUDIT_PAGE_SIZE)));

  const actorBadge = (type: string) => {
    const map: Record<string, string> = {
      admin: "bg-purple-500/15 text-purple-700",
      data_team: "bg-blue-500/15 text-blue-700",
      customer: "bg-emerald-500/15 text-emerald-700",
    };
    return map[type] || "bg-muted text-muted-foreground";
  };

  const actionBadge = (a: string) => {
    const map: Record<string, string> = {
      create: "bg-emerald-500/15 text-emerald-700",
      update: "bg-amber-500/15 text-amber-700",
      delete: "bg-red-500/15 text-red-600",
      approve: "bg-emerald-500/15 text-emerald-700",
      reject: "bg-red-500/15 text-red-600",
      finalize: "bg-blue-500/15 text-blue-700",
      login: "bg-slate-500/15 text-slate-600",
      logout: "bg-slate-500/15 text-slate-600",
    };
    return map[a] || "bg-muted text-muted-foreground";
  };

  function doSearch() {
    setPage(1);
  }

  return (
    <AdminLayout title="Audit Log">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={actor} onChange={(e) => setActor(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Actors</option>
          {ACTOR_TYPES.slice(1).map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Actions</option>
          {ACTIONS.slice(1).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entity} onChange={(e) => setEntity(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Entities</option>
          {ENTITY_TYPES.slice(1).map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm" title="From date" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm" title="To date" />
        <button onClick={doSearch}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Search className="w-4 h-4" /> Filter
        </button>
        {(actor || action || entity || dateFrom || dateTo) && (
          <button onClick={() => { setActor(""); setAction(""); setEntity(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="px-3 py-2 border rounded-lg text-sm text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No audit log entries found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">IP</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${actorBadge(e.actorType)}`}>
                      {e.actorType.replace("_", " ")}
                    </span>
                    {e.actorId && <span className="ml-1 text-xs text-muted-foreground">#{e.actorId}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${actionBadge(e.action)}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-medium">{e.entityType.replace(/_/g, " ")}</span>
                    {e.entityId && <span className="text-muted-foreground"> #{e.entityId}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{e.ip || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {(e.beforeJson || e.afterJson) && (
                      <button onClick={() => setViewEntry(e)}
                        className="p-2 hover:bg-muted rounded inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <Eye className="w-3 h-3" /> JSON
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="p-2 border rounded-lg disabled:opacity-40 hover:bg-muted">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="p-2 border rounded-lg disabled:opacity-40 hover:bg-muted">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* JSON viewer modal */}
      {viewEntry && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">
                {viewEntry.action} · {viewEntry.entityType} #{viewEntry.entityId}
              </h2>
              <button onClick={() => setViewEntry(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-4">
              {viewEntry.beforeJson && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2 text-muted-foreground">Before</div>
                  <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(viewEntry.beforeJson), null, 2)}
                  </pre>
                </div>
              )}
              {viewEntry.afterJson && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider mb-2 text-muted-foreground">After</div>
                  <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(viewEntry.afterJson), null, 2)}
                  </pre>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold">User-Agent:</span> {viewEntry.userAgent || "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
