import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Plus, Eye, Copy, Trash2, Mail, MessageCircle, Layers, Users, Send, MessageSquareText } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  channel: string;
  status: string;
  audience_id: number | null;
  audience_name: string | null;
  recipient_count: number;
  sent_at: number | null;
  created_at: number;
  email_subject: string | null;
  email_from_name: string | null;
  email_reply_to: string | null;
  email_body_html: string | null;
}

function fmt(d: number | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-200 text-slate-700",
  scheduled: "bg-amber-100 text-amber-700",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
};

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "email") return <Mail className="w-4 h-4 text-indigo-600" />;
  if (channel === "whatsapp") return <MessageCircle className="w-4 h-4 text-emerald-600" />;
  return <Layers className="w-4 h-4 text-purple-600" />;
}

export default function AdminMarketingCampaigns() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["marketing-campaigns"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/marketing/campaigns`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/marketing/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); toast({ title: "Campaign deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const duplicate = useMutation({
    mutationFn: async (c: Campaign) => {
      const r = await adminFetch(token, `/api/marketing/campaigns`, {
        method: "POST",
        body: JSON.stringify({
          name: `${c.name} (copy)`,
          channel: c.channel,
          audience_id: c.audience_id,
          email_subject: c.email_subject,
          email_from_name: c.email_from_name,
          email_reply_to: c.email_reply_to,
          email_body_html: c.email_body_html,
        }),
      });
      if (!r.ok) throw new Error("Duplicate failed");
      return r.json();
    },
    onSuccess: (created: any) => { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); navigate(`/admin/marketing/campaigns/${created.id}`); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout title="Marketing — Campaigns">
      <MarketingTabs active="campaigns" />
      <div className="flex justify-end mb-4">
        <Link href="/admin/marketing/campaigns/new" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> New Campaign
        </Link>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Channel</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Audience</th>
              <th className="text-left px-4 py-3">Recipients</th>
              <th className="text-left px-4 py-3">Sent At</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No campaigns yet. Create your first one.</td></tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 capitalize"><ChannelIcon channel={c.channel} /> {c.channel}</span></td>
                  <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${STATUS_STYLE[c.status] || "bg-slate-100"}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-slate-600">{c.audience_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600"><span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{c.recipient_count}</span></td>
                  <td className="px-4 py-3 text-slate-600">{fmt(c.sent_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/admin/marketing/campaigns/${c.id}`} className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600" title="View"><Eye className="w-4 h-4" /></Link>
                      <button onClick={() => duplicate.mutate(c)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Duplicate"><Copy className="w-4 h-4" /></button>
                      {c.status === "draft" && (
                        <button onClick={() => { if (confirm("Delete this draft?")) del.mutate(c.id); }} className="p-1.5 rounded hover:bg-rose-50 text-rose-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

// Shared sub-nav used across all marketing pages.
export function MarketingTabs({ active }: { active: "campaigns" | "audiences" | "templates" | "custom-templates" }) {
  const tabs = [
    { key: "campaigns", label: "Campaigns", href: "/admin/marketing/campaigns", icon: Send },
    { key: "audiences", label: "Audiences", href: "/admin/marketing/audiences", icon: Users },
    { key: "templates", label: "Templates", href: "/admin/marketing/templates", icon: Layers },
    { key: "custom-templates", label: "Custom Templates", href: "/admin/marketing/custom-templates", icon: MessageSquareText },
  ];
  return (
    <div className="flex gap-1 mb-6 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            "px-4 py-2.5 text-sm font-medium inline-flex items-center gap-2 border-b-2 -mb-px transition " +
            (active === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800")
          }
        >
          <t.icon className="w-4 h-4" /> {t.label}
        </Link>
      ))}
    </div>
  );
}
