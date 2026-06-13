// R26.4 Marketing Hub — campaign runner.
// Executes one campaign end-to-end: resolve audience → materialize send_jobs → process them
// sequentially (email via gmail-sender; whatsapp skipped until R26.4b) with a Gmail-friendly
// delay between sends. Errors are caught per-recipient so one bad address never aborts the run.
// Audience is <50 so a synchronous sequential loop is fine — no queue infrastructure.
import { rawSqlite as sqlite } from "../storage";
import { resolveAudienceByJson, type Recipient } from "./audience-resolver";
import { sendMarketingEmail } from "./gmail-sender";

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
  status: string;
  created_by: string | null;
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

  for (const jobId of jobIds) {
    const job = sqlite.prepare(`SELECT * FROM marketing_send_jobs WHERE id = ?`).get(jobId) as any;
    const attemptedAt = Date.now();
    sqlite.prepare(`UPDATE marketing_send_jobs SET status = 'sending', attempted_at = ? WHERE id = ?`).run(attemptedAt, jobId);

    // WhatsApp / Both: WhatsApp leg is inactive until R26.4b — skip.
    const wantsEmail = channel === "email" || channel === "both";
    const wantsWhatsAppOnly = channel === "whatsapp";

    try {
      if (wantsWhatsAppOnly) {
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'skipped', error_message = ? WHERE id = ?`)
          .run("WhatsApp sending will activate in R26.4b", jobId);
        logEvent(jobId, "failed", { reason: "whatsapp_disabled_r26_4b" });
        skipped++;
      } else if (wantsEmail && job.recipient_email) {
        if (isUnsubscribed(job.recipient_email, job.recipient_phone)) {
          sqlite
            .prepare(`UPDATE marketing_send_jobs SET status = 'skipped', error_message = ? WHERE id = ?`)
            .run("Recipient has unsubscribed", jobId);
          logEvent(jobId, "failed", { reason: "unsubscribed" });
          skipped++;
        } else {
          const result = await sendMarketingEmail({
            to: job.recipient_email,
            subject: c.email_subject || "",
            fromName: c.email_from_name,
            replyTo: c.email_reply_to,
            bodyHtml: c.email_body_html || "",
            sendJobId: jobId,
          });
          if (result.success) {
            sqlite
              .prepare(`UPDATE marketing_send_jobs SET status = 'sent', sent_at = ?, gmail_message_id = ? WHERE id = ?`)
              .run(Date.now(), result.messageId || null, jobId);
            logEvent(jobId, "sent", { gmail_message_id: result.messageId });
            sent++;
          } else {
            sqlite
              .prepare(`UPDATE marketing_send_jobs SET status = 'failed', error_message = ? WHERE id = ?`)
              .run(result.error || "Unknown send error", jobId);
            logEvent(jobId, "failed", { error: result.error });
            failed++;
          }
          // Gmail-friendly pacing between real sends only.
          await sleep(SEND_DELAY_MS);
        }
      } else {
        // 'both'/'email' but no email address on this recipient.
        sqlite
          .prepare(`UPDATE marketing_send_jobs SET status = 'skipped', error_message = ? WHERE id = ?`)
          .run("No email address for recipient", jobId);
        logEvent(jobId, "failed", { reason: "no_email" });
        skipped++;
      }
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
