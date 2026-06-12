/**
 * R14.6 — Delhi dashboard pending widgets.
 * Three at-a-glance buckets driven by a single date-range selector (1d/3d/7d/30d, default 7d):
 *   1. Pending Dispatch          — active POs notified to Delhi but nothing dispatched yet.
 *   2. Pending Pickup            — POs with line items still awaiting pickup.
 *   3. Pending Upload Dispatch   — dispatched/packed POs missing docket / courier / bundles.
 * All three come from GET /api/delhi/dashboard-pending?range=. This module is lazy-loaded by
 * DelhiDashboard so its query/render cost is only paid when the warehouse view mounts.
 */
import { useState } from "react";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { Truck, PackageOpen, FileUp, Loader2 } from "lucide-react";

interface PendingRow {
  id: number;
  po_number: string;
  customer_name: string | null;
  customer_po_number: string | null;
  created_at: number | null;
  notified_delhi_at: number | null;
  po_date: number | null;
  bucket: string;
  line_count: number;
  packed_count: number;
  pending_pickup_lines?: number;
  reason?: string;
}
interface PendingResp {
  range: string;
  range_from: number;
  pending_dispatch: PendingRow[];
  pending_pickup: PendingRow[];
  pending_upload_dispatch: PendingRow[];
}

const RANGES: Array<{ key: string; label: string }> = [
  { key: "1d", label: "1 day" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

function fmt(d: number | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function DelhiPendingWidgets({ onOpen }: { onOpen: (id: number) => void }) {
  const { token } = useTeamAuth();
  const [range, setRange] = useState<string>("7d");

  const { data, isLoading } = useQuery<PendingResp | null>({
    queryKey: ["delhi-dashboard-pending", range],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/delhi/dashboard-pending?range=${range}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const dispatch = data?.pending_dispatch || [];
  const pickup = data?.pending_pickup || [];
  const upload = data?.pending_upload_dispatch || [];

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-bold">Pending Work</div>
        <div className="inline-flex rounded-lg border overflow-hidden">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${range === r.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card border rounded-xl p-8 text-center text-muted-foreground shadow-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading pending work…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Widget title="Pending Dispatch" subtitle="Notified, nothing dispatched yet"
            icon={<Truck className="w-4 h-4" />} accent="text-orange-600" rows={dispatch} onOpen={onOpen} />
          <Widget title="Pending Pickup" subtitle="Lines still awaiting pickup"
            icon={<PackageOpen className="w-4 h-4" />} accent="text-blue-600" rows={pickup} onOpen={onOpen}
            badge={(r) => r.pending_pickup_lines != null ? `${r.pending_pickup_lines} line(s)` : null} />
          <Widget title="Pending Upload Dispatch-Details" subtitle="Missing docket / courier / bundles"
            icon={<FileUp className="w-4 h-4" />} accent="text-rose-600" rows={upload} onOpen={onOpen}
            badge={(r) => r.reason === "packed_not_dispatched" ? "packed, no dispatch" : "missing details"} />
        </div>
      )}
    </div>
  );
}

function Widget({ title, subtitle, icon, accent, rows, onOpen, badge }: {
  title: string; subtitle: string; icon: React.ReactNode; accent: string;
  rows: PendingRow[]; onOpen: (id: number) => void; badge?: (r: PendingRow) => string | null;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-sm flex flex-col">
      <div className="p-3 border-b">
        <div className={`flex items-center gap-2 font-bold text-sm ${accent}`}>{icon} {title}
          <span className="ml-auto text-xs rounded-full bg-muted px-2 py-0.5 text-foreground">{rows.length}</span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Nothing pending.</div>
        ) : rows.map((r) => {
          const b = badge?.(r);
          return (
            <button key={r.id} onClick={() => onOpen(r.id)}
              className="w-full text-left p-3 hover:bg-muted/40 transition">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{r.po_number}</span>
                <span className="text-[11px] text-muted-foreground">{fmt(r.notified_delhi_at || r.created_at)}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{r.customer_name || "—"}</div>
              {b && <div className="text-[11px] font-semibold mt-1 inline-block rounded bg-muted px-1.5 py-0.5">{b}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
