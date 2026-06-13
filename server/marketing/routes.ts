// R26.4 Marketing Hub — HTTP routes, mounted under /api/marketing.
// All endpoints require the admin token (x-admin-token) via the passed-in requireAdmin
// middleware, EXCEPT the open-tracking pixel and the unsubscribe endpoint (public, no auth).
// SQLite via better-sqlite3; timestamps are epoch ms. WhatsApp fields are accepted and stored
// but sends are skipped until R26.4b.
import type { Express, Request, Response, NextFunction } from "express";
import { rawSqlite as sqlite } from "../storage";
import { resolveAudienceByJson, parseFilter, resolveAudience } from "./audience-resolver";
import { runCampaign } from "./campaign-runner";
import { gmailConnectionStatus } from "./gmail-sender";

type Mw = (req: Request, res: Response, next: NextFunction) => void;

// 1x1 transparent PNG.
const TRACKING_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function now(): number {
  return Date.now();
}

export function registerMarketingRoutes(app: Express, requireAdmin: Mw): void {
  // ---------------- GMAIL STATUS (admin) ----------------
  app.get("/api/marketing/gmail-status", requireAdmin, (_req, res) => {
    res.json(gmailConnectionStatus());
  });

  // ======================= CAMPAIGNS =======================
  app.get("/api/marketing/campaigns", requireAdmin, (_req, res) => {
    try {
      const rows = sqlite
        .prepare(
          `SELECT c.*,
                  a.name AS audience_name,
                  (SELECT COUNT(*) FROM marketing_send_jobs j WHERE j.campaign_id = c.id) AS recipient_count
           FROM marketing_campaigns c
           LEFT JOIN marketing_audiences a ON a.id = c.audience_id
           ORDER BY c.created_at DESC`,
        )
        .all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing/campaigns", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      if (!b.name || !b.channel) return res.status(400).json({ error: "name and channel are required" });
      const ts = now();
      const info = sqlite
        .prepare(
          `INSERT INTO marketing_campaigns
             (name, channel, audience_id, email_subject, email_from_name, email_reply_to,
              email_body_html, email_attachments, whatsapp_template_name, whatsapp_variables,
              status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .run(
          b.name,
          b.channel,
          b.audience_id ?? null,
          b.email_subject ?? null,
          b.email_from_name ?? "Narmada Mobility",
          b.email_reply_to ?? null,
          b.email_body_html ?? null,
          b.email_attachments ? JSON.stringify(b.email_attachments) : null,
          b.whatsapp_template_name ?? null,
          b.whatsapp_variables ? JSON.stringify(b.whatsapp_variables) : null,
          (req as any).user?.username ?? null,
          ts,
          ts,
        );
      const row = sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(info.lastInsertRowid);
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/marketing/campaigns/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const campaign = sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(id);
      if (!campaign) return res.status(404).json({ error: "Not found" });
      const jobSummary = sqlite
        .prepare(
          `SELECT status, COUNT(*) AS n FROM marketing_send_jobs WHERE campaign_id = ? GROUP BY status`,
        )
        .all(id) as Array<{ status: string; n: number }>;
      const summary: Record<string, number> = {};
      for (const r of jobSummary) summary[r.status] = r.n;
      res.json({ campaign, jobSummary: summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/marketing/campaigns/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const existing = sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.status !== "draft" && existing.status !== "scheduled") {
        return res.status(400).json({ error: `Cannot edit a campaign with status '${existing.status}'` });
      }
      const b = req.body || {};
      const fields: Record<string, any> = {
        name: b.name,
        channel: b.channel,
        audience_id: b.audience_id,
        email_subject: b.email_subject,
        email_from_name: b.email_from_name,
        email_reply_to: b.email_reply_to,
        email_body_html: b.email_body_html,
        email_attachments: b.email_attachments != null ? JSON.stringify(b.email_attachments) : undefined,
        whatsapp_template_name: b.whatsapp_template_name,
        whatsapp_variables: b.whatsapp_variables != null ? JSON.stringify(b.whatsapp_variables) : undefined,
      };
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) {
          sets.push(`${k} = ?`);
          vals.push(v);
        }
      }
      sets.push("updated_at = ?");
      vals.push(now());
      vals.push(id);
      sqlite.prepare(`UPDATE marketing_campaigns SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      res.json(sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(id));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/marketing/campaigns/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const existing = sqlite.prepare(`SELECT status FROM marketing_campaigns WHERE id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.status !== "draft") return res.status(400).json({ error: "Only draft campaigns can be deleted" });
      sqlite.prepare(`DELETE FROM marketing_campaigns WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Send now — synchronous (audience < 50, completes in well under 90s).
  app.post("/api/marketing/campaigns/:id/send", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const existing = sqlite.prepare(`SELECT status FROM marketing_campaigns WHERE id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const result = await runCampaign(id);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing/campaigns/:id/schedule", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const scheduledAt = Number(req.body?.scheduled_at);
      if (!scheduledAt || Number.isNaN(scheduledAt)) return res.status(400).json({ error: "scheduled_at (epoch ms) required" });
      const existing = sqlite.prepare(`SELECT status FROM marketing_campaigns WHERE id = ?`).get(id) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.status === "sending" || existing.status === "sent") {
        return res.status(400).json({ error: `Cannot schedule a '${existing.status}' campaign` });
      }
      sqlite
        .prepare(`UPDATE marketing_campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?`)
        .run(scheduledAt, now(), id);
      res.json(sqlite.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`).get(id));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/marketing/campaigns/:id/jobs", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const jobs = sqlite
        .prepare(`SELECT * FROM marketing_send_jobs WHERE campaign_id = ? ORDER BY id ASC`)
        .all(id) as Array<{ id: number }>;
      const logsByJob: Record<number, any[]> = {};
      if (jobs.length > 0) {
        const allLogs = sqlite
          .prepare(
            `SELECT * FROM marketing_send_log WHERE send_job_id IN (${jobs.map(() => "?").join(",")}) ORDER BY created_at ASC`,
          )
          .all(...jobs.map((j) => j.id)) as Array<{ send_job_id: number }>;
        for (const l of allLogs) {
          (logsByJob[l.send_job_id] ||= []).push(l);
        }
      }
      res.json(jobs.map((j) => ({ ...j, log: logsByJob[j.id] || [] })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ======================= AUDIENCES =======================
  app.get("/api/marketing/audiences", requireAdmin, (_req, res) => {
    try {
      const rows = sqlite.prepare(`SELECT * FROM marketing_audiences ORDER BY id ASC`).all() as Array<{ id: number; filter_json: string }>;
      // Attach live recipient count for each.
      const withCounts = rows.map((r) => {
        let count = 0;
        try {
          count = resolveAudienceByJson(r.filter_json).total;
        } catch {
          count = 0;
        }
        return { ...r, recipient_count: count };
      });
      res.json(withCounts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing/audiences", requireAdmin, (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name required" });
      const filterJson = typeof b.filter_json === "string" ? b.filter_json : JSON.stringify(b.filter_json || { audience_type: "all" });
      const ts = now();
      const info = sqlite
        .prepare(`INSERT INTO marketing_audiences (name, description, filter_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(b.name, b.description ?? null, filterJson, ts, ts);
      res.json(sqlite.prepare(`SELECT * FROM marketing_audiences WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/marketing/audiences/:id/preview", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const aud = sqlite.prepare(`SELECT filter_json FROM marketing_audiences WHERE id = ?`).get(id) as any;
      if (!aud) return res.status(404).json({ error: "Not found" });
      const { recipients, total } = resolveAudienceByJson(aud.filter_json);
      res.json({ total, sample: recipients.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Preview an unsaved filter (composer "Build new" flow).
  app.post("/api/marketing/audiences/preview", requireAdmin, (req, res) => {
    try {
      const filter = typeof req.body?.filter === "string" ? parseFilter(req.body.filter) : req.body?.filter || { audience_type: "all" };
      const { recipients, total } = resolveAudience(filter);
      res.json({ total, sample: recipients.slice(0, 10) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/marketing/audiences/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const existing = sqlite.prepare(`SELECT * FROM marketing_audiences WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const sets: string[] = [];
      const vals: any[] = [];
      if (b.name !== undefined) { sets.push("name = ?"); vals.push(b.name); }
      if (b.description !== undefined) { sets.push("description = ?"); vals.push(b.description); }
      if (b.filter_json !== undefined) {
        sets.push("filter_json = ?");
        vals.push(typeof b.filter_json === "string" ? b.filter_json : JSON.stringify(b.filter_json));
      }
      sets.push("updated_at = ?");
      vals.push(now());
      vals.push(id);
      sqlite.prepare(`UPDATE marketing_audiences SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      res.json(sqlite.prepare(`SELECT * FROM marketing_audiences WHERE id = ?`).get(id));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/marketing/audiences/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      sqlite.prepare(`DELETE FROM marketing_audiences WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ======================= TEMPLATES =======================
  app.get("/api/marketing/templates", requireAdmin, (_req, res) => {
    try {
      res.json(sqlite.prepare(`SELECT * FROM marketing_templates ORDER BY id DESC`).all());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/marketing/templates", requireAdmin, (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name || !b.channel) return res.status(400).json({ error: "name and channel required" });
      const ts = now();
      const info = sqlite
        .prepare(
          `INSERT INTO marketing_templates
             (name, channel, email_subject, email_body_html, whatsapp_template_name, whatsapp_variables, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          b.name,
          b.channel,
          b.email_subject ?? null,
          b.email_body_html ?? null,
          b.whatsapp_template_name ?? null,
          b.whatsapp_variables ? JSON.stringify(b.whatsapp_variables) : null,
          ts,
          ts,
        );
      res.json(sqlite.prepare(`SELECT * FROM marketing_templates WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/marketing/templates/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const existing = sqlite.prepare(`SELECT * FROM marketing_templates WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const fields: Record<string, any> = {
        name: b.name,
        channel: b.channel,
        email_subject: b.email_subject,
        email_body_html: b.email_body_html,
        whatsapp_template_name: b.whatsapp_template_name,
        whatsapp_variables: b.whatsapp_variables != null ? JSON.stringify(b.whatsapp_variables) : undefined,
      };
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      sets.push("updated_at = ?");
      vals.push(now());
      vals.push(id);
      sqlite.prepare(`UPDATE marketing_templates SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      res.json(sqlite.prepare(`SELECT * FROM marketing_templates WHERE id = ?`).get(id));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/marketing/templates/:id", requireAdmin, (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      sqlite.prepare(`DELETE FROM marketing_templates WHERE id = ?`).run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ======================= TRACKING + UNSUBSCRIBE (PUBLIC) =======================
  // Open-tracking pixel — no auth. Logs an 'opened' event then returns a 1x1 PNG.
  app.get("/api/marketing/track/open/:job_id", (req, res) => {
    const jobId = parseInt(String(req.params.job_id), 10);
    if (!Number.isNaN(jobId)) {
      try {
        sqlite
          .prepare(`INSERT INTO marketing_send_log (send_job_id, event, event_data, created_at) VALUES (?, 'opened', ?, ?)`)
          .run(jobId, JSON.stringify({ ua: req.headers["user-agent"] || null }), now());
      } catch (e: any) {
        console.error("[marketing/track] open log failed:", e?.message || e);
      }
    }
    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    });
    res.end(TRACKING_PIXEL);
  });

  // Unsubscribe — no auth. Records the recipient into marketing_unsubscribes, then shows a page.
  app.get("/api/marketing/unsubscribe", (req, res) => {
    const jobId = req.query.j ? parseInt(String(req.query.j), 10) : NaN;
    let email: string | null = null;
    let phone: string | null = null;
    try {
      if (!Number.isNaN(jobId)) {
        const job = sqlite.prepare(`SELECT recipient_email, recipient_phone FROM marketing_send_jobs WHERE id = ?`).get(jobId) as any;
        email = job?.recipient_email || null;
        phone = job?.recipient_phone || null;
      }
      // Direct email query param fallback (frontend unsubscribe page may pass ?email=).
      if (!email && req.query.email) email = String(req.query.email);
      if (email || phone) {
        const dup = sqlite
          .prepare(`SELECT 1 FROM marketing_unsubscribes WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?) LIMIT 1`)
          .get(email, phone);
        if (!dup) {
          sqlite
            .prepare(`INSERT INTO marketing_unsubscribes (email, phone, source_job_id, unsubscribed_at) VALUES (?, ?, ?, ?)`)
            .run(email, phone, Number.isNaN(jobId) ? null : jobId, now());
        }
      }
    } catch (e: any) {
      console.error("[marketing/unsubscribe] failed:", e?.message || e);
    }
    const safeEmail = (email || "your address").replace(/[<>&]/g, "");
    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — Narmada Mobility</title>
<style>body{font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;font-size:14px;line-height:1.6}</style></head>
<body><div class="card"><h1>You're unsubscribed</h1>
<p>${safeEmail} will no longer receive marketing emails from Narmada Mobility.</p>
<p style="margin-top:20px;font-size:12px;color:#94a3b8">If this was a mistake, contact us at sales@narmadamobility.com.</p></div></body></html>`);
  });

  console.log("[R26.4] Marketing routes mounted under /api/marketing");
}
