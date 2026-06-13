import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Mail, MessageCircle, Layers, Users, Send, Clock, Save, ChevronRight, ChevronLeft, AlertTriangle } from "lucide-react";

interface Audience { id: number; name: string; recipient_count: number; }
type Channel = "email" | "whatsapp" | "both";

const WHATSAPP_NOTE = "WhatsApp sending will activate in R26.4b — UI ready, but sends will skip.";

export default function AdminMarketingCampaignComposer() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [audienceId, setAudienceId] = useState<number | "">("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailFromName, setEmailFromName] = useState("Narmada Mobility");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [waTemplate, setWaTemplate] = useState("");
  const [waVars, setWaVars] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: audiences = [] } = useQuery<Audience[]>({
    queryKey: ["marketing-audiences"],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/audiences`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const { data: gmail } = useQuery<{ connected: boolean; email: string | null }>({
    queryKey: ["marketing-gmail-status"],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/gmail-status`); return r.ok ? r.json() : { connected: false, email: null }; },
    enabled: !!token,
  });

  const [preview, setPreview] = useState<{ total: number; sample: Array<{ name: string; email: string | null }> } | null>(null);
  const loadPreview = async (id: number) => {
    setPreview(null);
    const r = await adminFetch(token, `/api/marketing/audiences/${id}/preview`);
    if (r.ok) setPreview(await r.json());
  };

  const selectedAudience = audiences.find((a) => a.id === audienceId);

  async function createDraft(): Promise<number | null> {
    const r = await adminFetch(token, `/api/marketing/campaigns`, {
      method: "POST",
      body: JSON.stringify({
        name: name || "Untitled campaign",
        channel,
        audience_id: audienceId || null,
        email_subject: emailSubject,
        email_from_name: emailFromName,
        email_reply_to: emailReplyTo || gmail?.email || null,
        email_body_html: emailBody,
        whatsapp_template_name: waTemplate || null,
        whatsapp_variables: waVars ? safeJson(waVars) : null,
      }),
    });
    if (!r.ok) { toast({ title: "Save failed", variant: "destructive" }); return null; }
    const c = await r.json();
    return c.id;
  }

  async function handleSaveDraft() {
    setBusy(true);
    const id = await createDraft();
    setBusy(false);
    if (id) { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); toast({ title: "Draft saved" }); navigate(`/admin/marketing/campaigns/${id}`); }
  }

  async function handleSendNow() {
    if (!confirm(`Send this campaign now to ${selectedAudience?.recipient_count ?? "the selected"} recipients?`)) return;
    setBusy(true);
    const id = await createDraft();
    if (!id) { setBusy(false); return; }
    const r = await adminFetch(token, `/api/marketing/campaigns/${id}/send`, { method: "POST" });
    setBusy(false);
    if (r.ok) {
      const res = await r.json();
      qc.invalidateQueries({ queryKey: ["marketing-campaigns"] });
      toast({ title: "Campaign sent", description: `Sent ${res.sent}, failed ${res.failed}, skipped ${res.skipped}` });
      navigate(`/admin/marketing/campaigns/${id}`);
    } else {
      toast({ title: "Send failed", description: (await r.json().catch(() => ({}))).error, variant: "destructive" });
    }
  }

  async function handleSchedule() {
    if (!scheduledAt) { toast({ title: "Pick a date/time", variant: "destructive" }); return; }
    setBusy(true);
    const id = await createDraft();
    if (!id) { setBusy(false); return; }
    const r = await adminFetch(token, `/api/marketing/campaigns/${id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduled_at: new Date(scheduledAt).getTime() }),
    });
    setBusy(false);
    if (r.ok) { qc.invalidateQueries({ queryKey: ["marketing-campaigns"] }); toast({ title: "Campaign scheduled" }); navigate(`/admin/marketing/campaigns/${id}`); }
    else toast({ title: "Schedule failed", variant: "destructive" });
  }

  const showWaWarning = channel === "whatsapp" || channel === "both";

  return (
    <AdminLayout title="Marketing — New Campaign">
      <MarketingTabs active="campaigns" />

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {["Channel", "Audience", "Content", "Send"].map((label, i) => {
          const n = i + 1;
          return (
            <div key={label} className="flex items-center gap-2">
              <button onClick={() => setStep(n)} className={"w-8 h-8 rounded-full text-sm font-semibold flex items-center justify-center " + (step === n ? "bg-indigo-600 text-white" : step > n ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-400")}>{n}</button>
              <span className={"text-sm " + (step >= n ? "text-slate-900 font-medium" : "text-slate-400")}>{label}</span>
              {n < 4 && <ChevronRight className="w-4 h-4 text-slate-300" />}
            </div>
          );
        })}
      </div>

      <div className="bg-white border rounded-xl p-6 max-w-3xl">
        <label className="text-xs font-semibold block mb-4">Campaign name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. June parts promo" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
        </label>

        {step === 1 && (
          <div className="space-y-3">
            {(["email", "whatsapp", "both"] as Channel[]).map((c) => (
              <label key={c} className={"flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer " + (channel === c ? "border-indigo-500 bg-indigo-50" : "")}>
                <input type="radio" checked={channel === c} onChange={() => setChannel(c)} />
                {c === "email" ? <Mail className="w-5 h-5 text-indigo-600" /> : c === "whatsapp" ? <MessageCircle className="w-5 h-5 text-emerald-600" /> : <Layers className="w-5 h-5 text-purple-600" />}
                <span className="capitalize font-medium">{c}</span>
              </label>
            ))}
            {showWaWarning && (
              <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {WHATSAPP_NOTE}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <label className="text-xs font-semibold block">Saved audience
              <select value={audienceId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ""; setAudienceId(v); if (v) loadPreview(v as number); }} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
                <option value="">— Select an audience —</option>
                {audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.recipient_count})</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Need a custom audience? Build one in the <a href="/#/admin/marketing/audiences" className="text-indigo-600 underline">Audiences</a> tab, then pick it here.</p>
            {preview && (
              <div className="border rounded-lg p-4 bg-slate-50">
                <div className="text-sm font-semibold mb-2">{preview.total} recipient{preview.total === 1 ? "" : "s"}</div>
                <div className="text-xs text-slate-600 space-y-0.5">
                  {preview.sample.slice(0, 5).map((s, i) => <div key={i}>• {s.name || "(no name)"} {s.email ? `— ${s.email}` : ""}</div>)}
                  {preview.total > 5 && <div className="text-slate-400">…and {preview.total - 5} more</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-2 border-b mb-2">
              <span className="px-3 py-2 text-sm font-semibold border-b-2 border-indigo-600 text-indigo-700 inline-flex items-center gap-1"><Mail className="w-4 h-4" /> Email</span>
              <span className="px-3 py-2 text-sm text-slate-400 inline-flex items-center gap-1"><MessageCircle className="w-4 h-4" /> WhatsApp {channel === "email" ? "(n/a)" : "(R26.4b)"}</span>
            </div>
            <label className="text-xs font-semibold block">Subject
              <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold block">From name
                <input value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Reply-to
                <input value={emailReplyTo} onChange={(e) => setEmailReplyTo(e.target.value)} placeholder={gmail?.email || "your Gmail"} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
            </div>
            <label className="text-xs font-semibold block">Body (HTML)
              <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={10} placeholder="<p>Hello…</p>" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono" /></label>
            {emailBody && (
              <div className="border rounded-lg p-4">
                <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Preview</div>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: emailBody }} />
              </div>
            )}
            {(channel === "whatsapp" || channel === "both") && (
              <div className="border rounded-lg p-4 bg-slate-50 opacity-70">
                <div className="flex items-center gap-2 text-amber-800 text-xs mb-2"><AlertTriangle className="w-4 h-4" /> {WHATSAPP_NOTE}</div>
                <label className="text-xs font-semibold block mb-2">WhatsApp template name
                  <input value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} disabled className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal bg-slate-100" /></label>
                <label className="text-xs font-semibold block">Variables (JSON)
                  <input value={waVars} onChange={(e) => setWaVars(e.target.value)} disabled className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal bg-slate-100" /></label>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="border rounded-lg p-4 bg-slate-50 text-sm space-y-1">
              <div><span className="text-slate-500">Name:</span> <span className="font-medium">{name || "Untitled campaign"}</span></div>
              <div><span className="text-slate-500">Channel:</span> <span className="font-medium capitalize">{channel}</span></div>
              <div><span className="text-slate-500">Audience:</span> <span className="font-medium">{selectedAudience?.name || "—"} ({selectedAudience?.recipient_count ?? 0})</span></div>
              <div><span className="text-slate-500">Subject:</span> <span className="font-medium">{emailSubject || "—"}</span></div>
              {!gmail?.connected && <div className="flex items-center gap-2 text-rose-700 mt-2"><AlertTriangle className="w-4 h-4" /> Gmail not connected — email sends will fail. Connect in Integrations.</div>}
            </div>
            <label className="text-xs font-semibold block">Schedule for (optional)
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleSendNow} disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" /> Send now</button>
              <button onClick={handleSchedule} disabled={busy || !scheduledAt} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Clock className="w-4 h-4" /> Schedule</button>
              <button onClick={handleSaveDraft} disabled={busy} className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Save className="w-4 h-4" /> Save as draft</button>
            </div>
          </div>
        )}

        {/* Wizard nav */}
        <div className="flex justify-between mt-6 pt-4 border-t">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-1 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /> Back</button>
          {step < 4 && <button onClick={() => setStep((s) => Math.min(4, s + 1))} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm inline-flex items-center gap-1">Next <ChevronRight className="w-4 h-4" /></button>}
        </div>
      </div>
    </AdminLayout>
  );
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
