import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { MarketingTabs } from "./AdminMarketingCampaigns";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Mail, MessageCircle, Layers, Users, Send, Clock, Save, ChevronRight, ChevronLeft, AlertTriangle, Upload, FileText } from "lucide-react";

interface Audience { id: number; name: string; recipient_count: number; }
type Channel = "email" | "whatsapp" | "both";

interface WaButton { type: string; text: string; }
interface WaTemplate {
  template_name: string;
  display_name: string;
  header_type: string | null;
  header_required: number;
  variable_count: number;
  variable_labels: string[];
  buttons: WaButton[];
}

const PLACEHOLDER_HINT = "You can use {first_name}, {name}, {company} — these are auto-filled per recipient.";

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
  // WhatsApp composer state: selected template + per-index variable values + optional media url.
  const [waTemplate, setWaTemplate] = useState("");
  const [waValues, setWaValues] = useState<Record<string, string>>({});
  const [waMediaUrl, setWaMediaUrl] = useState("");
  const [waMediaName, setWaMediaName] = useState("");
  const [waUploading, setWaUploading] = useState(false);
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
  const { data: waTemplates = [] } = useQuery<WaTemplate[]>({
    queryKey: ["marketing-wa-templates"],
    queryFn: async () => { const r = await adminFetch(token, `/api/marketing/whatsapp/templates`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  const selectedTemplate = waTemplates.find((t) => t.template_name === waTemplate) || null;

  const [preview, setPreview] = useState<{ total: number; sample: Array<{ name: string; email: string | null; phone?: string | null }> } | null>(null);
  const loadPreview = async (id: number) => {
    setPreview(null);
    const r = await adminFetch(token, `/api/marketing/audiences/${id}/preview`);
    if (r.ok) setPreview(await r.json());
  };

  const selectedAudience = audiences.find((a) => a.id === audienceId);

  // Build the whatsapp_variables payload: numeric keys "1".."n" plus optional media_url.
  function buildWaVariables(): Record<string, string> | null {
    if (channel === "email") return null;
    if (!selectedTemplate) return null;
    const out: Record<string, string> = {};
    for (let i = 1; i <= selectedTemplate.variable_count; i++) out[String(i)] = waValues[String(i)] || "";
    if (waMediaUrl) out.media_url = waMediaUrl;
    return out;
  }

  async function handleMediaUpload(file: File) {
    setWaUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await adminFetch(token, `/api/marketing/whatsapp/upload-media`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      if (r.ok) {
        const j = await r.json();
        setWaMediaUrl(j.url);
        setWaMediaName(file.name);
        toast({ title: "File uploaded", description: file.name });
      } else {
        toast({ title: "Upload failed", description: (await r.json().catch(() => ({}))).error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setWaUploading(false);
    }
  }

  // Live-substitute {placeholder} tokens using the first sampled recipient, mirroring the
  // backend's resolution + multi-field fallback chain so the admin sees what each variable will
  // actually resolve to. Empty results fall back to "—" (same as the backend send path).
  function resolvePlaceholders(value: string): { text: string; usedFallback: boolean } {
    if (!value || value.indexOf("{") === -1) return { text: value, usedFallback: false };
    const r = (preview?.sample?.[0] || {}) as { name?: string | null; email?: string | null; phone?: string | null };
    const pick = (...vals: Array<string | null | undefined>) => {
      for (const v of vals) { const s = (v == null ? "" : String(v)).trim(); if (s) return s; }
      return "";
    };
    const firstWord = (r.name || "").trim().split(/\s+/)[0] || "";
    const map: Record<string, string> = {
      first_name: pick(firstWord),
      name: pick(r.name),
      company: pick(r.name),
      phone: pick(r.phone),
      email: pick(r.email),
    };
    const text = value.replace(/\{(first_name|name|company|phone|email)\}/gi, (_m, k) => {
      const key = String(k).toLowerCase();
      return key in map ? map[key] : `{${k}}`;
    });
    const trimmed = text.trim();
    return trimmed ? { text: trimmed, usedFallback: false } : { text: "—", usedFallback: true };
  }

  // Render a WhatsApp message preview by substituting variable values into a numbered body.
  function previewBubble(): string {
    if (!selectedTemplate) return "";
    const lines = selectedTemplate.variable_labels.map((label, i) => {
      const v = waValues[String(i + 1)] || `{{${i + 1}}}`;
      return `${label}: ${v}`;
    });
    return lines.join("\n");
  }

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
        whatsapp_template_name: channel !== "email" ? waTemplate || null : null,
        whatsapp_variables: channel !== "email" ? buildWaVariables() : null,
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

  const includesWhatsApp = channel === "whatsapp" || channel === "both";

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
                {c === "both" && <span className="text-xs text-slate-400">— email if they have an address, WhatsApp if they have a phone</span>}
              </label>
            ))}
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
          <div className="space-y-6">
            {/* EMAIL CONTENT */}
            {(channel === "email" || channel === "both") && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700 border-b pb-2"><Mail className="w-4 h-4" /> Email content</div>
                <label className="text-xs font-semibold block">Subject
                  <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold block">From name
                    <input value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
                  <label className="text-xs font-semibold block">Reply-to
                    <input value={emailReplyTo} onChange={(e) => setEmailReplyTo(e.target.value)} placeholder={gmail?.email || "your Gmail"} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" /></label>
                </div>
                <label className="text-xs font-semibold block">Body (HTML)
                  <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={8} placeholder="<p>Hello…</p>" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-mono" /></label>
                {emailBody && (
                  <div className="border rounded-lg p-4">
                    <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Preview</div>
                    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: emailBody }} />
                  </div>
                )}
              </div>
            )}

            {/* WHATSAPP CONTENT */}
            {includesWhatsApp && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border-b pb-2"><MessageCircle className="w-4 h-4" /> WhatsApp content</div>
                <label className="text-xs font-semibold block">Template
                  <select value={waTemplate} onChange={(e) => { setWaTemplate(e.target.value); setWaValues({}); setWaMediaUrl(""); setWaMediaName(""); }} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal">
                    <option value="">— Select template —</option>
                    {waTemplates.map((t) => <option key={t.template_name} value={t.template_name}>{t.display_name}</option>)}
                  </select>
                </label>

                {selectedTemplate && (
                  <>
                    <p className="text-xs text-slate-500">{PLACEHOLDER_HINT}</p>
                    {selectedTemplate.variable_labels.map((label, i) => {
                      const key = String(i + 1);
                      const val = waValues[key] || "";
                      const hasPlaceholder = val.indexOf("{") !== -1;
                      const resolved = hasPlaceholder ? resolvePlaceholders(val) : null;
                      return (
                        <label key={key} className="text-xs font-semibold block">{`{{${i + 1}}} ${label}`}
                          <input value={val} onChange={(e) => setWaValues((v) => ({ ...v, [key]: e.target.value }))} placeholder={label} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal" />
                          {resolved && preview?.sample?.[0] && (
                            <span className="block mt-1 text-[11px] font-normal text-slate-500">
                              Preview with first recipient: "<span className="font-semibold text-slate-700">{resolved.text}</span>"
                              {resolved.usedFallback ? " — if blank, fallback “—” will be used" : ""}
                            </span>
                          )}
                        </label>
                      );
                    })}

                    {selectedTemplate.header_type === "document" && (
                      <div className="border rounded-lg p-3 bg-slate-50">
                        <div className="text-xs font-semibold mb-2 flex items-center gap-1"><FileText className="w-4 h-4" /> Header document (PDF) {selectedTemplate.header_required ? <span className="text-rose-600">*required</span> : null}</div>
                        <label className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer bg-white hover:bg-slate-50">
                          <Upload className="w-4 h-4" /> {waUploading ? "Uploading…" : "Choose PDF"}
                          <input type="file" accept="application/pdf,image/*" className="hidden" disabled={waUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMediaUpload(f); }} />
                        </label>
                        {waMediaUrl && <div className="text-xs text-emerald-700 mt-2 truncate">Uploaded: {waMediaName} (<a href={waMediaUrl} target="_blank" rel="noreferrer" className="underline">view</a>)</div>}
                      </div>
                    )}

                    {selectedTemplate.buttons.length > 0 && (
                      <div className="text-xs text-slate-500">This template has these buttons: <span className="font-medium text-slate-700">{selectedTemplate.buttons.map((b) => b.text).join(", ")}</span></div>
                    )}

                    {/* Live WhatsApp bubble preview */}
                    <div className="border rounded-lg p-4 bg-[#e5ddd5]">
                      <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Preview</div>
                      <div className="bg-white rounded-lg shadow-sm p-3 max-w-sm ml-auto text-sm whitespace-pre-wrap text-slate-800">
                        {selectedTemplate.header_type === "document" && waMediaName && (
                          <div className="flex items-center gap-2 text-xs text-slate-600 border-b pb-2 mb-2"><FileText className="w-4 h-4" /> {waMediaName}</div>
                        )}
                        {previewBubble() || <span className="text-slate-400">Fill the variables to see a preview…</span>}
                        {selectedTemplate.buttons.length > 0 && (
                          <div className="mt-2 pt-2 border-t flex flex-col gap-1">
                            {selectedTemplate.buttons.map((b, i) => <div key={i} className="text-center text-[#00a5f4] text-xs font-medium py-1">{b.text}</div>)}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
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
              {(channel === "email" || channel === "both") && <div><span className="text-slate-500">Subject:</span> <span className="font-medium">{emailSubject || "—"}</span></div>}
              {includesWhatsApp && <div><span className="text-slate-500">WhatsApp template:</span> <span className="font-medium">{selectedTemplate?.display_name || "— none selected —"}</span></div>}
              {includesWhatsApp && preview && (() => {
                const total = preview.total;
                const withPhone = preview.sample.filter((s) => s.phone).length;
                // sample is capped at 10 — only show exact counts when the whole audience fits the sample.
                if (total <= preview.sample.length) {
                  return <div className="text-emerald-700">{withPhone} of {total} recipients have phone numbers. {total - withPhone} will be skipped for WhatsApp.</div>;
                }
                return <div className="text-slate-500">WhatsApp will be sent to recipients that have a phone number; others are skipped.</div>;
              })()}
              {includesWhatsApp && selectedTemplate?.header_required && !waMediaUrl && <div className="flex items-center gap-2 text-rose-700 mt-2"><AlertTriangle className="w-4 h-4" /> This template requires a header document — upload a PDF in Content.</div>}
              {(channel === "email" || channel === "both") && !gmail?.connected && <div className="flex items-center gap-2 text-rose-700 mt-2"><AlertTriangle className="w-4 h-4" /> Gmail not connected — email sends will fail. Connect in Integrations.</div>}
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
