// R26.4 Marketing Hub — campaign runner.
// Executes one campaign end-to-end: resolve audience → materialize send_jobs → process them
// sequentially (email via gmail-sender; whatsapp via AiSensy — R26.4b) with a friendly delay
// between sends. Errors are caught per-recipient so one bad address never aborts the run.
// Audience is <50 so a synchronous sequential loop is fine — no queue infrastructure.
import { rawSqlite as sqlite } from "../storage";
import { resolveAudienceByJson, type Recipient } from "./audience-resolver";
import { sendMarketingEmail } from "./gmail-sender";
import { sendAisensyMarketing } from "./aisensy-sender";

const SEND_DELAY_MS = 1500;

interface CampaignRow {
  id: number;
  name: string;
  channel: string;
  audience_id: number | null;
  audience_snapshot: string | null;
  email_subject: string | null;
  email_from_name: string | null;
  email_reply_to: string | null;
  email_body_html: string | null;
  whatsapp_template_name: string | null;
  whatsapp_variables: string | null;
  status: string;
  created_by: string | null;
}

interface WhatsAppTemplateRow {
  template_name: string;
  display_name: string;
  header_type: string | null;
  header_required: number;
  variable_count: number;
  variable_labels: string | null;
  status: string;
}

const EMPTY_FALLBACK = "—";

function nonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    const s = (v == null ? "" : String(v)).trim();
    if (s) return s;
  }
  return "";
}

// Substitute per-recipient placeholders inside a campaign variable value. The user writes the
// campaign once with {first_name} / {name} / {company} etc. and we fill them per recipient at
// send time. Matching is case-insensitive. Each placeholder resolves through a multi-field
// fallback chain so a missing field on one recipient borrows from a related field rather than
// producing an empty value. Unknown placeholders are left untouched so literal braces in copy
// are not destroyed.
function applyPlaceholders(value: string, recipient: Recipient): string {
  if (!value || value.indexOf("{") === -1) return value;
  // Recipient (from audience-resolver) only carries id/name/email/phone/type, but ad-hoc
  // snapshots may carry richer fields — read them defensively.
  const r = recipient as Recipient & {
    first_name?: string | null;
    company?: string | null;
    business_name?: string | null;
  };
  const nameFirstWord = (r.name || "").trim().split(/\s+/)[0] || "";
  const map: Record<string, string> = {
    first_name: nonEmpty(r.first_name, nameFirstWord),
    name: nonEmpty(r.name, r.first_name, r.company),
    company: nonEmpty(r.company, r.business_name, r.name),
    phone: nonEmpty(r.phone),
    email: nonEmpty(r.email),
  };
  return value.replace(/\{(first_name|name|company|phone|email)\}/gi, (_m, k) => {
    const key = String(k).toLowerCase();
    return key in map ? map[key] : `{${k}}`;
  });
}

// Resolve a campaign's whatsapp_variables JSON ({"1":"...","2":"...","media_url":"..."}) into the
// positional templateParams array AiSensy expects, applying per-recipient placeholder substitution.
// Any positional value that resolves to empty/whitespace is replaced with the template's variable
// label (when available) or the literal em-dash, because Meta rejects empty template params.
function resolveTemplateParams(
  varsJson: string | null,
  variableCount: number,
  recipient: Recipient,
  variableLabelsJson: string | null,
  campaignId: number,
  recipientId: string,
): { params: string[]; mediaUrl: string | null } {
  let vars: Record<string, any> = {};
  try {
    vars = varsJson ? JSON.parse(varsJson) : {};
  } catch {
    vars = {};
  }
  let labels: string[] = [];
  try {
    const parsed = variableLabelsJson ? JSON.parse(variableLabelsJson) : [];
    if (Array.isArray(parsed)) labels = parsed.map((l) => String(l ?? ""));
  } catch {
    labels = [];
  }
  const params: string[] = [];
  for (let i = 1; i <= variableCount; i++) {
    const raw = vars[String(i)] != null ? String(vars[String(i)]) : "";
    const substituted = applyPlaceholders(raw, recipient).trim();
    if (substituted) {
      params.push(substituted);
    } else {
      const fallback = nonEmpty(labels[i - 1]) || EMPTY_FALLBACK;
      console.warn(
        `[marketing] WARN: variable ${i} for campaign ${campaignId} recipient ${recipientId} resolved empty, using fallback "${fallback}"`,
      );
      params.push(fallback);
    }
  }
  const mediaUrl = vars.media_url ? String(vars.media_url) : null;
  return { params, mediaUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logEvent(sendJobId: number, event: string, data?: unknown): void {
  try {
    sqlite
      .prepare(`INSERT INTO marketing_send_log (send_job_id, event, event_data, created_at) VALUES (?, ?, ?, ?)`)
      .run(sendJobId, event, data == null ? null : JSON.stringify(data), Date.now());
  } catch (e: any) {
    console.error("[marketing/runner] log insert failed:", e?.message || e);
  }
}

function isUnsubscribed(email: string | null, phone: string | null): boolean {
  if (!email && !phone) return false;
  try {
    const row = sqlite
      .prepare(
        `SELECT 1 FROM marketing_unsubscribes WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?) LIMIT 1`,
      )
      .get(email, phone);
    return !!row;
  } catch {
    return false;
  }
}

// Resolve the recipient list for a campaign. Prefer a stored audience_snapshot (recipient IDs
// captured at send time); otherwise resolve live from the linked audience's filter_json.
function resolveRecipientsForCampaign(c: CampaignRow): Recipient[] {
  if (c.audience_id != null) {
    const aud = sqlite.prepare(`SELECT filter_json FROM marketing_audiences WHERE id = ?`).get(c.audience_id) as
      | { filter_json: string }
      | undefined;
    if (aud) {
      return resolveAudienceByJson(aud.filter_json).recipients;
    }
  }
  // Ad-hoc: audience_snapshot may directly hold a recipient array.
  if (c.audience_snapshot) {
    try {
      const parsed = JSON.parse(c.audience_snapshot);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((r: any) => r && (r.email || r.phone))
          .map((r: any) => ({
            id: String(r.id ?? r.email ?? r.phone ?? "manual"),
            name: r.name || "",
            email: r.email || null,
            phone: r.phone || null,
            type: r.type || "manual",
          }));
      }
    } catch {
      /* ignore malformed snapshot */
    }
  }
  return [];
}

export async function runCampaign(campaignId: number): Promise<{ ok: boolean; sent: number; failed: number; skipped: number; total: number; error?: string }> {
  const c = sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(campaignId) as CampaignRow | undefined;
  if (!c) return { ok: false, sent: 0, failed: 0, skipped: 0, total: 0, error: "Campaign not found" };
  if (c.status === "sending" || c.status === "sent") {
    return { ok: false, sent: 0, failed: 0, skipped: 0, total: 0, error: `Campaign already ${c.status}` };
  }

  const now = Date.now();
  sqlite.prepare(`UPDATE marketing_campaigns SET status = 'sending', updated_at = ? WHERE id = ?`).run(now, campaignId);

  const recipients = resolveRecipientsForCampaign(c);

  // Persist the resolved audience snapshot for auditing/reproducibility.
  try {
    sqlite
      .prepare(`UPDATE marketing_campaigns SET audience_snapshot = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(recipients), Date.now(), campaignId);
  } catch {
    /* non-fatal */
  }

  const channel = c.channel; // 'email' | 'whatsapp' | 'both'
  const insertJob = sqlite.prepare(
    `INSERT INTO marketing_send_jobs
       (campaign_id, recipient_type, recipient_id, recipient_email, recipient_phone, recipient_name, channel, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );

  const jobIds: number[] = [];
  for (const r of recipients) {
    const info = insertJob.run(
      campaignId,
      r.type,
      r.id,
      r.email,
      r.phone,
      r.name,
      channel,
      Date.now(),
    );
    const jobId = Number(info.lastInsertRowid);
    jobIds.push(jobId);
    logEvent(jobId, "queued", { channel, type: r.type });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const wantsEmail = channel === "email" || channel === "both";
  const wantsWhatsApp = channel === "whatsapp" || channel === "both";

  // Resolve the WhatsApp template once for the whole run (it's the same for every recipient).
  // If the campaign wants WhatsApp but the template is missing/inactive, every WA leg skips.
  let waTemplate: WhatsAppTemplateRow | null = null;
  let waTemplateError: string | null = null;
  if (wantsWhatsApp) {
    if (!c.whatsapp_template_name) {
      waTemplateError = "no WhatsApp template selected";
    } else {
      const row = sqlite
        .prepare(`SELECT * FROM marketing_whatsapp_templates WHERE template_name = ?`)
        .get(c.whatsapp_template_name) as WhatsAppTemplateRow | undefined;
      if (!row) waTemplateError = "template not found";
      else if (row.status !== "active") waTemplateError = "template inactive";
      else waTemplate = row;
    }
  }

  for (const jobId of jobIds) {
    const job = sqlite.prepare(`SELECT * FROM marketing_send_jobs WHERE id = ?`).get(jobId) as any;
    const attemptedAt = Date.now();
    sqlite.prepare(`UPDATE marketing_send_jobs SET status = 'sending', attempted_at = ? WHERE id = ?`).run(attemptedAt, jobId);

    const recipient: Recipient = {
      id: String(job.recipient_id ?? jobId),
      name: job.recipient_name || "",
      email: job.recipient_email || null,
      phone: job.recipient_phone || null,
      type: (job.recipient_type as Recipient["type"]) || "customer",
    };

    // Per-recipient outcome across both legs. The send_job carries a single status, so we
    // promote to 'sent' if any leg sent, else 'failed' if any leg failed, else 'skipped'.
    let legSent = false;
    let legFailed = false;
    let didRealSend = false; // whether we actually hit a provider (for pacing)
    const errors: string[] = [];

    try {
      const unsub = isUnsubscribed(job.recipient_email, job.recipient_phone);
      if (unsub) {
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'skipped', error_message = ? WHERE id = ?`)
          .run("Recipient has unsubscribed", jobId);
        logEvent(jobId, "skipped", { reason: "unsubscribed" });
        skipped++;
        continue;
      }

      // ---- EMAIL leg ----
      if (wantsEmail) {
        if (!job.recipient_email) {
          errors.push("no email");
          logEvent(jobId, "skipped", { leg: "email", reason: "no_email" });
        } else {
          const result = await sendMarketingEmail({
            to: job.recipient_email,
            subject: c.email_subject || "",
            fromName: c.email_from_name,
            replyTo: c.email_reply_to,
            bodyHtml: c.email_body_html || "",
            sendJobId: jobId,
          });
          didRealSend = true;
          if (result.success) {
            sqlite
              .prepare(`UPDATE marketing_send_jobs SET gmail_message_id = ? WHERE id = ?`)
              .run(result.messageId || null, jobId);
            logEvent(jobId, "sent", { leg: "email", gmail_message_id: result.messageId });
            legSent = true;
          } else {
            errors.push(`email: ${result.error || "send failed"}`);
            logEvent(jobId, "failed", { leg: "email", error: result.error });
            legFailed = true;
          }
        }
      }

      // ---- WHATSAPP leg ----
      if (wantsWhatsApp) {
        if (!job.recipient_phone) {
          errors.push("no phone");
          logEvent(jobId, "skipped", { leg: "whatsapp", reason: "no_phone" });
        } else if (!waTemplate) {
          errors.push(`whatsapp: ${waTemplateError || "template not found or inactive"}`);
          logEvent(jobId, "skipped", { leg: "whatsapp", reason: waTemplateError || "template_unavailable" });
        } else {
          const { params, mediaUrl } = resolveTemplateParams(
            c.whatsapp_variables,
            waTemplate.variable_count,
            recipient,
            waTemplate.variable_labels,
            campaignId,
            recipient.id,
          );
          if (waTemplate.header_required && !mediaUrl) {
            errors.push("whatsapp: media required but missing");
            logEvent(jobId, "failed", { leg: "whatsapp", reason: "media_required" });
            legFailed = true;
          } else {
            console.log(
              `[aisensy-send] campaign=${campaignId} recipient=${job.recipient_phone} template=${waTemplate.template_name} params=${JSON.stringify(params)}`,
            );
            const result = await sendAisensyMarketing({
              templateName: waTemplate.template_name,
              phone: job.recipient_phone,
              userName: recipient.name || undefined,
              templateParams: params,
              mediaUrl,
            });
            didRealSend = true;
            if (result.messageId) {
              sqlite
                .prepare(`UPDATE marketing_send_jobs SET aisensy_message_id = ? WHERE id = ?`)
                .run(result.messageId, jobId);
            }
            if (result.status === "sent" || result.status === "queued") {
              logEvent(jobId, "sent", { leg: "whatsapp", aisensy_message_id: result.messageId, aisensy_status: result.status });
              legSent = true;
            } else {
              errors.push(`whatsapp: ${result.error || "send failed"}`);
              logEvent(jobId, "failed", { leg: "whatsapp", error: result.error });
              legFailed = true;
            }
          }
        }
      }

      // Promote per-recipient status from leg outcomes.
      const errMsg = errors.length ? errors.join("; ") : null;
      if (legSent) {
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'sent', sent_at = ?, error_message = ? WHERE id = ?`)
          .run(Date.now(), errMsg, jobId);
        sent++;
      } else if (legFailed) {
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'failed', error_message = ? WHERE id = ?`)
          .run(errMsg || "Send failed", jobId);
        failed++;
      } else {
        // No leg produced a real send (e.g. recipient lacked any usable contact field).
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'skipped', error_message = ? WHERE id = ?`)
          .run(errMsg || "No deliverable channel for recipient", jobId);
        skipped++;
      }

      // Friendly pacing between real provider sends only.
      if (didRealSend) await sleep(SEND_DELAY_MS);
    } catch (e: any) {
      sqlite
        .prepare(`UPDATE marketing_send_jobs SET status = 'failed', error_message = ? WHERE id = ?`)
        .run(e?.message || "Send threw", jobId);
      logEvent(jobId, "failed", { error: e?.message || String(e) });
      failed++;
    }
  }

  const finishedAt = Date.now();
  const finalStatus = jobIds.length > 0 && sent === 0 && failed > 0 ? "failed" : "sent";
  sqlite
    .prepare(`UPDATE marketing_campaigns SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?`)
    .run(finalStatus, finishedAt, finishedAt, campaignId);

  console.log(`[marketing/runner] campaign #${campaignId} done — sent=${sent} failed=${failed} skipped=${skipped} total=${jobIds.length}`);
  return { ok: true, sent, failed, skipped, total: jobIds.length };
}
