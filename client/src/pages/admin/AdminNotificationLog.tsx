import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface NotificationEntry {
  id: number;
  consignmentId: number | null;
  customerId: number | null;
  eventKey: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  errorMsg: string | null;
  sentAt: number;
}

interface NotificationResponse {
  entries: NotificationEntry[];
}

const CHANNELS = ["", "whatsapp", "email"];
const STATUSES = ["", "sent", "failed", "skipped"];

export default function AdminNotificationLog() {
  const { token } = useAdminAuth();
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  const params = new URLSearchParams();
  params.set("limit", "200");
  if (channel) params.set("channel", channel);
  if (status) params.set("status", status);

  const { data, isLoading, refetch, isFetching } = useQuery<NotificationResponse>({
    queryKey: ["notification-log", channel, status],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/notification-log?${params}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const entries = data?.entries ?? [];

  // Diagnostics banners — scan the most recent 50 whatsapp rows.
  const recentWa = entries.filter((e) => e.channel === "whatsapp").slice(0, 50);
  const planInactive = recentWa.some((e) => (e.errorMsg || "").includes("AISENSY_PLAN_INACTIVE"));
  const missingCampaigns = Array.from(
    new Set(
      recentWa
        .filter((e) => (e.errorMsg || "").includes("AISENSY_CAMPAIGN_MISSING"))
        // For whatsapp rows, eventKey holds the campaign name.
        .map((e) => e.eventKey)
        .filter(Boolean),
    ),
  );

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      sent: "bg-emerald-500/15 text-emerald-700",
      failed: "bg-red-500/15 text-red-600",
      skipped: "bg-muted text-muted-foreground",
    };
    return map[s] || "bg-muted text-muted-foreground";
  };

  const channelBadge = (c: string) => {
    const map: Record<string, string> = {
      whatsapp: "bg-emerald-500/15 text-emerald-700",
      email: "bg-blue-500/15 text-blue-700",
      sms: "bg-amber-500/15 text-amber-700",
    };
    return map[c] || "bg-muted text-muted-foreground";
  };

  return (
    <AdminLayout title="Notification Log">
      {planInactive && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>AiSensy plan inactive — upgrade at <strong>app.aisensy.com</strong></span>
        </div>
      )}
      {missingCampaigns.length > 0 && (
        <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Campaign(s) missing in AiSensy. Create these in dashboard:{" "}
            <strong>{missingCampaigns.join(", ")}</strong>
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select value={channel} onChange={(e) => setChannel(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Channels</option>
          {CHANNELS.slice(1).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 bg-background text-sm">
          <option value="">All Statuses</option>
          {STATUSES.slice(1).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => refetch()} disabled={isFetching}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No notification log entries found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Channel</th>
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold">Template/Subject</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30 align-top">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.sentAt).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${channelBadge(e.channel)}`}>
                      {e.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">{e.eventKey}</td>
                  <td className="px-4 py-3 text-xs font-mono break-all">{e.recipient || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground break-all">{e.subject || e.eventKey}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${statusBadge(e.status)}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-xs break-words">{e.errorMsg || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
