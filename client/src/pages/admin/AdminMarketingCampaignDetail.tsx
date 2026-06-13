import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Send, ArrowLeft } from "lucide-react";

interface Job {
  id: number;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_type: string | null;
  status: string;
  sent_at: number | null;
  error_message: string | null;
  log: Array<{ id: number; event: string; created_at: number }>;
}

function fmt(d: number | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const JOB_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  skipped: "bg-amber-100 text-amber-700",
};

export default function AdminMarketingCampaignDetail() {
  const [, params] = useRoute("/admin/marketing/campaigns/:id");
  const id = params?.id;
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data } = useQuery<{ campaign: any; jobSummary: Record<string, number> }>({
    queryKey: ["marketing-campaign", id],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/campaigns/${id}`); return r.ok ? r.json() : null; },
    enabled: !!token && !!id,
    refetchInterval: (q) => (q.state.data?.campaign?.status === "sending" ? 3000 : false),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["marketing-campaign-jobs", id],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/campaigns/${id}/jobs`); return r.ok ? r.json() : []; },
    enabled: !!token && !!id,
    refetchInterval: (q) => (data?.campaign?.status === "sending" ? 3000 : false),
  });

  const send = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/marketing/campaigns/${id}/send`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Send failed");
      return r.json();
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["marketing-campaign", id] });
      qc.invalidateQueries({ queryKey: ["marketing-campaign-jobs", id] });
      toast({ title: "Campaign sent", description: `Sent ${res.sent}, failed ${res.failed}, skipped ${res.skipped}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const c = data?.campaign;

  return (
    <AdminLayout title="Marketing — Campaign">
      <MarketingTabs active="campaigns" />
      <Link href="/admin/marketing/campaigns" className="text-sm text-slate-500 inline-flex items-center gap-1 mb-4 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Back to campaigns</Link>

      {!c ? (
        <div className="p-12 text-center text-slate-400">Loading…</div>
      ) : (
        <>
          <div className="bg-white border rounded-xl p-6 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{c.name}</h2>
                <div className="text-sm text-slate-500 mt-1 capitalize">{c.channel} · status: <span className="font-semibold">{c.status}</span></div>
                {c.email_subject && <div className="text-sm text-slate-600 mt-2"><span className="text-slate-400">Subject:</span> {c.email_subject}</div>}
              </div>
              {(c.status === "draft" || c.status === "scheduled") && (
                <button onClick={() => { if (confirm("Send now?")) send.mutate(); }} disabled={send.isPending} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" /> Send now</button>
              )}
            </div>
            {data?.jobSummary && Object.keys(data.jobSummary).length > 0 && (
              <div className="flex gap-2 mt-4">
                {Object.entries(data.jobSummary).map(([s, n]) => (
                  <span key={s} className={`text-xs px-2.5 py-1 rounded-full font-semibold ${JOB_STYLE[s] || "bg-slate-100"}`}>{s}: {n}</span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Recipient</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sent At</th>
                  <th className="text-left px-4 py-3">Events</th>
                  <th className="text-left px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No send jobs yet.</td></tr>
                ) : jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><div className="font-medium text-slate-900">{j.recipient_name || "—"}</div><div className="text-xs text-slate-500">{j.recipient_email || j.recipient_phone || ""}</div></td>
                    <td className="px-4 py-3 capitalize text-slate-600">{j.recipient_type}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${JOB_STYLE[j.status] || "bg-slate-100"}`}>{j.status}</span></td>
                    <td className="px-4 py-3 text-slate-600">{fmt(j.sent_at)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{j.log.map((l) => l.event).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-xs text-rose-600 max-w-xs truncate" title={j.error_message || ""}>{j.error_message || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
