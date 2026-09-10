// R28 Session 1 — Admin Email Log page.
// Consumes /api/admin/email-log (list), .../:id/resend, .../test.
// Uses the shared adminFetch + AdminLayout so it sits behind existing admin auth.
import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Send, Eye, Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatTs } from "@/lib/r28-utils";

interface EmailLog {
  id: number;
  to?: string; toAddress?: string;
  subject?: string;
  event?: string; eventType?: string;
  status?: string;
  attempts?: number;
  bodyPreview?: string; body?: string;
  errorMessage?: string; errorMsg?: string;
  createdAt?: number; sentAt?: number;
}

const STATUSES = ["", "sent", "failed", "queued", "skipped"];
const EVENTS = ["", "rfq", "quote", "order", "notify-delhi", "expense", "test"];

export default function AdminEmailLog() {
  const { token } = useAdminAuth();
  const [status, setStatus] = useState("");
  const [event, setEvent] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [view, setView] = useState<EmailLog | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  const params = new URLSearchParams();
  params.set("limit", "200");
  if (status) params.set("status", status);
  if (event) params.set("event_type", event);

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["email-log", status, event],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/email-log?${params}`);
      if (!r.ok) throw new Error(`Failed to load: ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });

  const rowsRaw: any[] = Array.isArray(data) ? data : (data?.rows ?? data?.entries ?? data?.logs ?? []);
  // Client-side date filter (endpoint doesn't accept dates directly).
  const rows: EmailLog[] = rowsRaw.filter((r: any) => {
    if (!dateFrom && !dateTo) return true;
    const ts = Number(r.createdAt ?? r.sentAt ?? 0);
    if (!ts) return true;
    if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
    if (dateTo && ts > new Date(dateTo).getTime() + 86_400_000) return false;
    return true;
  });

  const statusBadgeClass = (s: string | undefined) => {
    const map: Record<string, string> = {
      sent: "bg-emerald-100 text-emerald-700",
      failed: "bg-red-100 text-red-700",
      queued: "bg-amber-100 text-amber-700",
      skipped: "bg-slate-100 text-slate-700",
    };
    return map[String(s || "").toLowerCase()] || "bg-slate-100 text-slate-600";
  };

  const resend = async (id: number) => {
    if (!confirm("Resend this email? A new send attempt will be recorded on the same row.")) return;
    try {
      const r = await adminFetch(token, `/api/admin/email-log/${id}/resend`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      toast({ title: "Resend triggered", description: data?.status || "See row for updated status" });
      refetch();
    } catch (e: any) {
      toast({ title: "Resend failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const sendTest = async () => {
    if (!testTo.trim()) return;
    try {
      const r = await adminFetch(token, `/api/admin/email-log/test`, {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      toast({ title: "Test email queued", description: `Sent to ${testTo}` });
      setTestDialogOpen(false);
      setTestTo("");
      refetch();
    } catch (e: any) {
      toast({ title: "Test failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="Email Log">
      <div className="space-y-4">
        {/* Header actions + flag note */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-slate-600">
            <Mail className="inline w-4 h-4 mr-1 text-indigo-500" />
            <span className="font-mono text-xs">EMAIL_NOTIFICATIONS_ENABLED</span> is toggled via Render env vars.
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setTestDialogOpen(true)}>
              <Send className="w-4 h-4 mr-1" /> Test send
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">Event</span>
            <select value={event} onChange={(e) => setEvent(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
              {EVENTS.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">From</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="text-xs flex flex-col">
            <span className="text-slate-500 mb-1">To</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" />
          </label>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">To</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Event</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Attempts</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No email log rows.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{formatTs(r.createdAt ?? r.sentAt)}</td>
                  <td className="px-3 py-2 text-xs">{r.to ?? r.toAddress ?? "—"}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={r.subject || ""}>{r.subject || "—"}</td>
                  <td className="px-3 py-2 text-xs"><Badge variant="secondary">{r.event ?? r.eventType ?? "—"}</Badge></td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(r.status)}`}>{r.status || "—"}</span></td>
                  <td className="px-3 py-2 text-xs">{r.attempts ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setView(r)}><Eye className="w-3 h-3 mr-1" /> View</Button>
                      <Button size="sm" variant="outline" onClick={() => resend(r.id)}><Send className="w-3 h-3 mr-1" /> Resend</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {isLoading && <div className="text-center text-slate-500 py-6">Loading…</div>}
          {!isLoading && rows.length === 0 && <div className="text-center text-slate-500 py-6">No email log rows.</div>}
          {rows.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border p-3 space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <div className="font-medium text-sm truncate">{r.subject || "(no subject)"}</div>
                <span className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${statusBadgeClass(r.status)}`}>{r.status || "—"}</span>
              </div>
              <div className="text-xs text-slate-600">To: {r.to ?? r.toAddress ?? "—"}</div>
              <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
                <span className="font-mono">{formatTs(r.createdAt ?? r.sentAt)}</span>
                <span>· {r.event ?? r.eventType ?? "—"}</span>
                <span>· {r.attempts ?? 0} attempt{(r.attempts ?? 0) === 1 ? "" : "s"}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setView(r)}><Eye className="w-3 h-3 mr-1" /> View</Button>
                <Button size="sm" variant="outline" onClick={() => resend(r.id)}><Send className="w-3 h-3 mr-1" /> Resend</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* View dialog */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Email log #{view?.id}</DialogTitle></DialogHeader>
          {view && (
            <div className="space-y-3 text-sm">
              <div><span className="text-slate-500 text-xs">To</span><div>{view.to ?? view.toAddress}</div></div>
              <div><span className="text-slate-500 text-xs">Subject</span><div>{view.subject}</div></div>
              <div className="flex gap-4 text-xs">
                <div><span className="text-slate-500">Status</span> <span className={`ml-1 px-2 py-0.5 rounded ${statusBadgeClass(view.status)}`}>{view.status}</span></div>
                <div><span className="text-slate-500">Attempts</span> <span className="ml-1">{view.attempts ?? 0}</span></div>
                <div><span className="text-slate-500">Event</span> <span className="ml-1">{view.event ?? view.eventType}</span></div>
              </div>
              {(view.errorMessage || view.errorMsg) && (
                <div className="border border-red-200 bg-red-50 text-red-700 rounded p-2 text-xs">
                  <div className="font-semibold mb-1">Error</div>
                  <pre className="whitespace-pre-wrap">{view.errorMessage || view.errorMsg}</pre>
                </div>
              )}
              <div>
                <div className="text-slate-500 text-xs mb-1">Body preview</div>
                <div className="border rounded p-2 text-xs max-h-72 overflow-y-auto whitespace-pre-wrap font-mono bg-slate-50">
                  {view.bodyPreview || view.body || "(no body captured)"}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Test send dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send test email</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="text-sm">
              Recipient email
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="mt-1" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTestDialogOpen(false)}>Cancel</Button>
              <Button onClick={sendTest} disabled={!testTo.trim()}>Send</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
