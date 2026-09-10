// R28.2 — Get-Quotation flow.
//
// Public 3-endpoint API that backs the /get-quote wizard on the frontend:
//   POST /api/quote/otp/send    → dispatch a 6-digit code to the caller's email
//   POST /api/quote/otp/verify  → exchange code for a short-lived verification token
//   POST /api/quote/submit      → persist the final RFQ (requires header X-Quote-Token)
//
// Everything additive. Reads/writes only the two R28.6-migration tables
// (quote_otp, quote_request). Uses the existing SMTP path (sendGenericSalesEmail
// in server/email.ts) so it inherits EMAIL_NOTIFICATIONS_ENABLED gating.
//
// Verbatim user directive covered here:
//   "mail otp has to be verified to proceed"
//   "Get quotation page shoudl be designed in a way client can enter all his
//    details ... once entered he can move to the next page"
//
// Security notes:
//   * OTP code is HMAC/SHA-256(code + email_lower + OTP_SALT). Raw code is
//     never stored; the response never echoes it back either.
//   * Verify uses timingSafeEqual on the hash → no timing side-channel.
//   * Verification token is HMAC-SHA256 over {email, verified_at, exp} with
//     QUOTE_TOKEN_SECRET. Base64url-encoded, opaque to the client. Not a full
//     JWT — no algorithm confusion possible because we only accept our own
//     format.
//   * Rate limits:
//       - /otp/send: 5/hour/IP + 3/hour/email (sliding window)
//       - /otp/verify: caps at 5 wrong attempts on the most-recent row before
//         it is invalidated
//   * Email existence is NEVER leaked — /otp/send always returns ok:true.
//   * The reference number `NM-Q-YYYY-NNNNN` is generated from a monotonic
//     per-year counter derived from MAX(id) inside a transaction so concurrent
//     submits cannot collide.

import type { Express, Request, Response } from "express";
import { createHash, createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { rawSqlite } from "./storage";
import { sendGenericSalesEmail } from "./email";

// -------------------- config helpers --------------------

const OTP_TTL_SECONDS = 600;                 // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const VERIFY_TOKEN_TTL_SECONDS = 30 * 60;    // 30 minutes
const IP_HOUR_LIMIT = 5;
const EMAIL_HOUR_LIMIT = 3;

function otpSalt(): string {
  // Never fall back to an empty string in production — but in the vitest
  // harness (setup-env.ts strips secrets) we still want deterministic hashing.
  return process.env.OTP_SALT || "narmada-r28.2-default-otp-salt-please-override";
}
function tokenSecret(): string {
  return process.env.QUOTE_TOKEN_SECRET || "narmada-r28.2-default-quote-token-secret-please-override";
}
function ipSalt(): string {
  // Reuse the team-upload salt if set so the two audit trails share a hash
  // (makes cross-referencing an abusive IP simpler in the log tables).
  return process.env.TEAM_UPLOAD_IP_SALT || "narmada-quote-default-ip-salt";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}|${ipSalt()}`).digest("hex").slice(0, 16);
}
function extractIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined) || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || req.ip || "0.0.0.0";
}

// Basic RFC-ish email regex. Rejects the obvious junk but doesn't try to be
// a full RFC 5322 parser — the OTP flow is the real validation.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export function isValidEmail(e: string): boolean {
  if (!e || e.length > 200) return false;
  return EMAIL_RE.test(e);
}

// -------------------- OTP hashing / signing --------------------

export function hashOtp(code: string, emailLower: string): string {
  return createHash("sha256").update(`${code}|${emailLower}|${otpSalt()}`).digest("hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

export interface VerificationTokenPayload {
  email: string;
  verified_at: number;
  exp: number;
}

/** Sign a short verification token. Format: `<b64url-payload>.<b64url-hmac>`. */
export function signVerificationToken(payload: VerificationTokenPayload): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", tokenSecret()).update(body).digest();
  return `${body}.${base64url(sig)}`;
}

/** Verify a token; returns the payload if valid + unexpired, else null. */
export function verifyVerificationToken(token: string, now: number = Date.now()): VerificationTokenPayload | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", tokenSecret()).update(body).digest();
  const actual = base64urlDecode(sig);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(body).toString("utf8")) as VerificationTokenPayload;
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.email !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

// -------------------- rate limiter --------------------
// In-memory sliding window — fine for a single Render instance. If we ever
// scale horizontally, port to Redis (see team-upload.ts for the same TODO).

const _ipHourBuckets = new Map<string, number[]>();
const _emailHourBuckets = new Map<string, number[]>();

/** True when the (ip, email) pair may send another OTP right now. */
export function checkOtpRate(ipHash: string, emailLower: string, now: number = Date.now()): { ok: boolean; reason?: "per_ip_hour" | "per_email_hour" } {
  const cutoff = now - 60 * 60 * 1000;
  const ipBucket = _ipHourBuckets.get(ipHash) || [];
  const prunedIp = ipBucket.filter((ts) => ts >= cutoff);
  if (prunedIp.length >= IP_HOUR_LIMIT) {
    _ipHourBuckets.set(ipHash, prunedIp);
    return { ok: false, reason: "per_ip_hour" };
  }
  const emBucket = _emailHourBuckets.get(emailLower) || [];
  const prunedEm = emBucket.filter((ts) => ts >= cutoff);
  if (prunedEm.length >= EMAIL_HOUR_LIMIT) {
    _emailHourBuckets.set(emailLower, prunedEm);
    return { ok: false, reason: "per_email_hour" };
  }
  prunedIp.push(now);
  prunedEm.push(now);
  _ipHourBuckets.set(ipHash, prunedIp);
  _emailHourBuckets.set(emailLower, prunedEm);
  return { ok: true };
}

/** Reset the in-memory rate-limit buckets. Test-only helper. */
export function __resetOtpRateLimiter(): void {
  _ipHourBuckets.clear();
  _emailHourBuckets.clear();
}

// -------------------- reference-number generator --------------------

function pad5(n: number): string {
  return String(n).padStart(5, "0");
}
export function generateReference(year: number, seq: number): string {
  return `NM-Q-${year}-${pad5(seq)}`;
}

// -------------------- OTP send/verify persistence --------------------

interface QuoteOtpRow {
  id: number;
  email: string;
  code_hash: string;
  attempts: number;
  verified: number;
  expires_at: number;
  ip_hash: string | null;
  created_at: number;
}

function insertOtp(email: string, codeHash: string, ipHash: string | null, now: number): number {
  const info = rawSqlite
    .prepare(`INSERT INTO quote_otp (email, code_hash, attempts, verified, expires_at, ip_hash, created_at)
              VALUES (?, ?, 0, 0, ?, ?, ?)`)
    .run(email, codeHash, now + OTP_TTL_SECONDS * 1000, ipHash, now);
  return Number(info.lastInsertRowid);
}

function findRecentOtp(email: string, now: number): QuoteOtpRow | undefined {
  return rawSqlite
    .prepare(
      `SELECT * FROM quote_otp
       WHERE email = ? AND verified = 0 AND expires_at > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(email, now) as QuoteOtpRow | undefined;
}

function bumpAttempts(id: number): number {
  const info = rawSqlite.prepare(`UPDATE quote_otp SET attempts = attempts + 1 WHERE id = ?`).run(id);
  return info.changes;
}

function markVerified(id: number): void {
  rawSqlite.prepare(`UPDATE quote_otp SET verified = 1 WHERE id = ?`).run(id);
}

function invalidateOtp(id: number): void {
  // Expire it immediately so no more attempts land against this row.
  rawSqlite.prepare(`UPDATE quote_otp SET expires_at = 0 WHERE id = ?`).run(id);
}

// -------------------- registration --------------------

export function registerQuoteRfqRoutes(app: Express): void {
  // ---- POST /api/quote/otp/send ------------------------------------------
  app.post("/api/quote/otp/send", async (req, res) => {
    try {
      const rawEmail = String(req.body?.email || "").trim();
      const email = rawEmail.toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "invalid_email" });
      }

      const ipHash = hashIp(extractIp(req));
      const rate = checkOtpRate(ipHash, email);
      if (!rate.ok) {
        // Still return 429 so the client shows the correct hint; we don't
        // leak whether the cap was per-IP or per-email.
        return res.status(429).json({ error: "rate_limited", ttl_seconds: OTP_TTL_SECONDS });
      }

      // 6-digit code, zero-padded. randomInt is crypto-strong.
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const now = Date.now();
      insertOtp(email, hashOtp(code, email), ipHash, now);

      // Fire-and-forget — response must not block on SMTP.
      const subject = `Your Narmada Mobility verification code: ${code}`;
      const text = [
        `Your Narmada Mobility verification code is: ${code}`,
        ``,
        `This code expires in 10 minutes. If you did not request it, you can safely ignore this email.`,
        ``,
        `— Narmada Mobility`,
      ].join("\n");
      const html = [
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#0a2540;">`,
        `<h2 style="margin:0 0 12px 0;font-weight:600;">Your Narmada Mobility verification code</h2>`,
        `<p style="margin:0 0 16px 0;color:#4a5568;">Enter this code on the Get Quotation page to continue:</p>`,
        `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;letter-spacing:8px;font-weight:700;background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 24px;text-align:center;">${code}</div>`,
        `<p style="margin:24px 0 0 0;color:#718096;font-size:13px;">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>`,
        `</div>`,
      ].join("");
      void sendGenericSalesEmail({
        eventType: "quote_otp",
        subject,
        text,
        html,
        to: rawEmail,
      }).catch((err) => console.error("[quote-rfq] otp email send failed:", err?.message || err));

      // Never disclose whether the email exists / whether SMTP is configured.
      return res.json({ ok: true, ttl_seconds: OTP_TTL_SECONDS });
    } catch (e: any) {
      // Same envelope on any unexpected failure — the client shouldn't be
      // able to poke at internals.
      console.error("[quote-rfq] otp/send failed:", e?.message || e);
      return res.status(500).json({ error: "otp_send_failed" });
    }
  });

  // ---- POST /api/quote/otp/verify ----------------------------------------
  app.post("/api/quote/otp/verify", async (req, res) => {
    try {
      const rawEmail = String(req.body?.email || "").trim();
      const email = rawEmail.toLowerCase();
      const code = String(req.body?.code || "").trim();

      if (!isValidEmail(email)) return res.status(400).json({ error: "invalid_email" });
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid_code_format" });

      const now = Date.now();
      const row = findRecentOtp(email, now);
      if (!row) return res.status(400).json({ error: "no_pending_code" });

      // Constant-time compare on the hex hash.
      const provided = Buffer.from(hashOtp(code, email), "hex");
      const stored = Buffer.from(row.code_hash, "hex");
      const match = provided.length === stored.length && timingSafeEqual(provided, stored);

      if (!match) {
        bumpAttempts(row.id);
        // +1 because the row we just read is pre-increment.
        if (row.attempts + 1 >= OTP_MAX_ATTEMPTS) {
          invalidateOtp(row.id);
          return res.status(400).json({ error: "too_many_attempts" });
        }
        return res.status(400).json({ error: "invalid_code", attempts_remaining: OTP_MAX_ATTEMPTS - (row.attempts + 1) });
      }

      markVerified(row.id);
      const token = signVerificationToken({
        email,
        verified_at: now,
        exp: now + VERIFY_TOKEN_TTL_SECONDS * 1000,
      });
      return res.json({ ok: true, verification_token: token, ttl_seconds: VERIFY_TOKEN_TTL_SECONDS });
    } catch (e: any) {
      console.error("[quote-rfq] otp/verify failed:", e?.message || e);
      return res.status(500).json({ error: "otp_verify_failed" });
    }
  });

  // ---- POST /api/quote/submit --------------------------------------------
  app.post("/api/quote/submit", async (req, res) => {
    try {
      const token = String(req.headers["x-quote-token"] || "").trim();
      if (!token) return res.status(401).json({ error: "missing_token" });

      const payload = verifyVerificationToken(token);
      if (!payload) return res.status(401).json({ error: "invalid_or_expired_token" });

      const b = req.body || {};
      const email = String(b.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) return res.status(400).json({ error: "invalid_email" });
      if (email !== payload.email) return res.status(401).json({ error: "token_email_mismatch" });

      const company_name = String(b.company_name || "").trim();
      const contact_name = String(b.contact_name || "").trim();
      const country = String(b.country || "").trim();
      const currency = String(b.currency || "").trim().toUpperCase();
      const country_code = String(b.country_code || "").trim();
      const mobile = String(b.mobile || "").trim();
      const timeframe = String(b.timeframe || "").trim();
      const delivery_location = String(b.delivery_location || "").trim() || null;
      const notes = String(b.notes || "").trim() || null;

      if (!company_name || company_name.length > 200) return res.status(400).json({ error: "invalid_company_name" });
      if (!contact_name || contact_name.length > 100) return res.status(400).json({ error: "invalid_contact_name" });
      if (!country) return res.status(400).json({ error: "invalid_country" });
      if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: "invalid_currency" });
      if (!country_code) return res.status(400).json({ error: "invalid_country_code" });
      if (!/^\d{6,15}$/.test(mobile.replace(/\D/g, ""))) return res.status(400).json({ error: "invalid_mobile" });
      if (!timeframe) return res.status(400).json({ error: "invalid_timeframe" });
      if (notes && notes.length > 2000) return res.status(400).json({ error: "notes_too_long" });

      const cart = Array.isArray(b.cart) ? b.cart : [];
      if (cart.length < 1) return res.status(400).json({ error: "cart_empty" });
      if (cart.length > 500) return res.status(400).json({ error: "cart_too_large" });

      // Serialize cart to a JSON blob after normalizing each row. Never trust
      // the raw client shape.
      type CartRow = {
        part_number: string;
        description: string;
        chassis_slug: string | null;
        qty: number;
      };
      const normalizedCart: CartRow[] = cart.map((row: any, idx: number) => ({
        part_number: String(row?.part_number || "").trim() || `unknown-${idx + 1}`,
        description: String(row?.description || "").trim(),
        chassis_slug: String(row?.chassis_slug || "").trim() || null,
        qty: Math.max(1, Math.min(9999, parseInt(String(row?.qty || 1), 10) || 1)),
      }));

      const ipHash = hashIp(extractIp(req));
      const ua = String(req.headers["user-agent"] || "").slice(0, 500);
      const now = Date.now();

      // Reference-number generation inside a transaction. The counter uses the
      // MAX(id) among rows for the current year (parsed out of the reference
      // string) so we never revisit an already-used number even across restarts.
      const year = new Date(now).getUTCFullYear();
      let reference = "";
      const tx = rawSqlite.transaction(() => {
        const prefix = `NM-Q-${year}-`;
        const row = rawSqlite.prepare(
          `SELECT reference FROM quote_request WHERE reference LIKE ? ORDER BY id DESC LIMIT 1`,
        ).get(`${prefix}%`) as any;
        let next = 1;
        if (row?.reference) {
          const tail = String(row.reference).slice(prefix.length);
          const n = parseInt(tail, 10);
          if (Number.isFinite(n) && n > 0) next = n + 1;
        }
        reference = generateReference(year, next);
        rawSqlite.prepare(
          `INSERT INTO quote_request
            (reference, company_name, contact_name, email, country, currency,
             country_code, mobile, cart_json, timeframe, delivery_location, notes,
             status, ip_hash, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
        ).run(
          reference, company_name, contact_name, email, country, currency,
          country_code, mobile, JSON.stringify(normalizedCart), timeframe,
          delivery_location, notes, ipHash, ua, now,
        );
      });
      tx();

      // Fire-and-forget notification to sales@ — never await.
      void (async () => {
        try {
          const cartTable = normalizedCart.map((r: CartRow, i: number) =>
            `${String(i + 1).padStart(2, "0")}. ${r.qty} \u00D7 ${r.part_number}${r.chassis_slug ? `  [${r.chassis_slug}]` : ""}${r.description ? `\n     ${r.description}` : ""}`,
          ).join("\n");
          const text = [
            `New RFQ received via /get-quote wizard.`,
            ``,
            `Reference:  ${reference}`,
            `Company:    ${company_name}`,
            `Contact:    ${contact_name} <${email}>`,
            `Country:    ${country}`,
            `Currency:   ${currency}`,
            `Phone:      ${country_code} ${mobile}`,
            `Timeframe:  ${timeframe}`,
            `Delivery:   ${delivery_location || "(not specified)"}`,
            ``,
            `Cart (${normalizedCart.length} item${normalizedCart.length === 1 ? "" : "s"}):`,
            cartTable,
            ``,
            notes ? `Notes:\n${notes}` : `Notes: (none)`,
          ].join("\n");
          const htmlRows = normalizedCart.map((r: CartRow, i: number) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#718096;font-family:ui-monospace,monospace;font-size:11px;">${i + 1}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:12px;font-weight:600;">${escapeHtml(r.part_number)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">${escapeHtml(r.description)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:11px;color:#718096;">${escapeHtml(r.chassis_slug || "—")}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${r.qty}</td>
            </tr>`).join("");
          const html = [
            `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#0a2540;max-width:720px;">`,
            `<h2 style="margin:0 0 4px 0;">New RFQ: ${escapeHtml(reference)}</h2>`,
            `<p style="margin:0 0 20px 0;color:#4a5568;">From <strong>${escapeHtml(company_name)}</strong> — ${escapeHtml(contact_name)} &lt;${escapeHtml(email)}&gt;</p>`,
            `<table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-size:13px;">`,
            `<tr><td style="padding:4px 8px;color:#718096;">Country</td><td style="padding:4px 8px;font-weight:500;">${escapeHtml(country)}</td>`,
            `<td style="padding:4px 8px;color:#718096;">Currency</td><td style="padding:4px 8px;font-weight:500;">${escapeHtml(currency)}</td></tr>`,
            `<tr><td style="padding:4px 8px;color:#718096;">Phone</td><td style="padding:4px 8px;font-weight:500;">${escapeHtml(country_code)} ${escapeHtml(mobile)}</td>`,
            `<td style="padding:4px 8px;color:#718096;">Timeframe</td><td style="padding:4px 8px;font-weight:500;">${escapeHtml(timeframe)}</td></tr>`,
            `<tr><td style="padding:4px 8px;color:#718096;">Delivery</td><td colspan="3" style="padding:4px 8px;">${escapeHtml(delivery_location || "(not specified)")}</td></tr>`,
            `</table>`,
            `<h3 style="margin:0 0 8px 0;font-size:14px;">Cart (${normalizedCart.length})</h3>`,
            `<table style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0;">`,
            `<thead><tr style="background:#f7fafc;"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#4a5568;">#</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#4a5568;">Part #</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#4a5568;">Description</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#4a5568;">Chassis</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#4a5568;">Qty</th></tr></thead>`,
            `<tbody>${htmlRows}</tbody>`,
            `</table>`,
            notes ? `<div style="margin-top:20px;padding:12px;background:#fffbeb;border-left:3px solid #f59e0b;"><strong>Notes:</strong><br/>${escapeHtml(notes).replace(/\n/g, "<br/>")}</div>` : "",
            `</div>`,
          ].join("");
          await sendGenericSalesEmail({
            eventType: "quote_submit",
            subject: `[RFQ ${reference}] ${company_name} - ${normalizedCart.length} item${normalizedCart.length === 1 ? "" : "s"}`,
            text,
            html,
          });
        } catch (err: any) {
          console.error("[quote-rfq] submit notification email failed:", err?.message || err);
        }
      })();

      return res.json({ ok: true, reference });
    } catch (e: any) {
      console.error("[quote-rfq] submit failed:", e?.message || e);
      return res.status(500).json({ error: "quote_submit_failed" });
    }
  });
}

// Small helper — avoid pulling in an HTML-escape lib.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
