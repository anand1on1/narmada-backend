// R26.4 Marketing Hub — Gmail sender.
// Sends a single HTML email via the Gmail API using the OAuth connection stored in
// oauth_tokens (provider='google', is_active=1) by R26.3. Handles access-token refresh
// via the stored refresh_token + GOOGLE_CLIENT_ID/SECRET. Refresh writes the new token
// back through upsertOAuthToken so the row stays current. Never throws to the caller —
// returns { success, messageId?, error? } so the campaign runner can record per-recipient
// outcomes without aborting the whole send.
import { rawSqlite as sqlite } from "../storage";
import { upsertOAuthToken } from "../auth/passport";

const BACKEND_BASE = process.env.PUBLIC_BACKEND_URL || "https://narmada-backend.onrender.com";

interface GoogleTokenRow {
  id: number;
  account_id: string;
  account_email: string | null;
  account_name: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: number | null;
  scopes: string | null;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null; // overrides the connected Gmail address if provided
  replyTo?: string | null;
  bodyHtml: string;
  sendJobId?: number | null; // for tracking pixel + unsubscribe link
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function getActiveGoogleToken(): GoogleTokenRow | null {
  try {
    const row = sqlite
      .prepare(
        `SELECT id, account_id, account_email, account_name, access_token, refresh_token, token_expires_at, scopes
         FROM oauth_tokens
         WHERE provider = 'google' AND is_active = 1
         ORDER BY COALESCE(last_used_at, connected_at) DESC
         LIMIT 1`,
      )
      .get() as GoogleTokenRow | undefined;
    return row || null;
  } catch (e: any) {
    console.error("[marketing/gmail] token lookup failed:", e?.message || e);
    return null;
  }
}

// Refresh the access token using the refresh_token grant. Returns the new access token, or
// null if refresh is not possible (missing refresh token / client creds / provider error).
async function refreshAccessToken(row: GoogleTokenRow): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !row.refresh_token) return null;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
    });
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("[marketing/gmail] token refresh HTTP", resp.status, txt);
      return null;
    }
    const data = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    const newExpiry = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
    // Persist refreshed token (refresh_token unchanged — upsert keeps the existing one via COALESCE).
    upsertOAuthToken({
      provider: "google",
      accountEmail: row.account_email,
      accountName: row.account_name,
      accountId: row.account_id,
      accessToken: data.access_token,
      refreshToken: null,
      tokenExpiresAt: newExpiry,
      scopes: row.scopes,
    });
    return data.access_token;
  } catch (e: any) {
    console.error("[marketing/gmail] token refresh failed:", e?.message || e);
    return null;
  }
}

// Ensure we have a usable (non-expired) access token, refreshing if needed.
async function ensureAccessToken(row: GoogleTokenRow): Promise<string | null> {
  const now = Date.now();
  const expired = row.token_expires_at != null && row.token_expires_at < now + 60_000; // 60s skew
  if (!expired && row.access_token) return row.access_token;
  const refreshed = await refreshAccessToken(row);
  return refreshed || row.access_token || null;
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Encode a header value containing non-ASCII per RFC 2047 (UTF-8, base64).
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function buildTrackingPixel(sendJobId: number): string {
  return `<img src="${BACKEND_BASE}/api/marketing/track/open/${sendJobId}" width="1" height="1" style="display:none" alt="" />`;
}

function buildUnsubscribeFooter(sendJobId: number): string {
  return `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;font-family:Arial,sans-serif">
You are receiving this because you are a contact of Narmada Mobility.
<a href="${BACKEND_BASE}/api/marketing/unsubscribe?j=${sendJobId}" style="color:#94a3b8">Unsubscribe</a>
</div>`;
}

export async function sendMarketingEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const tokenRow = getActiveGoogleToken();
  if (!tokenRow) {
    return { success: false, error: "No active Google (Gmail) connection. Connect Gmail in Integrations first." };
  }
  const accessToken = await ensureAccessToken(tokenRow);
  if (!accessToken) {
    return { success: false, error: "Could not obtain a valid Gmail access token (refresh failed)." };
  }

  const fromEmail = params.fromEmail || tokenRow.account_email;
  if (!fromEmail) {
    return { success: false, error: "No sender email available on the Gmail connection." };
  }
  if (!params.to) {
    return { success: false, error: "Missing recipient email." };
  }

  const fromName = params.fromName || "Narmada Mobility";
  const fromHeader = `${encodeHeader(fromName)} <${fromEmail}>`;
  const replyTo = params.replyTo || fromEmail;

  let html = params.bodyHtml || "";
  if (params.sendJobId) {
    html += buildUnsubscribeFooter(params.sendJobId);
    html += buildTrackingPixel(params.sendJobId);
  }

  // RFC 2822 MIME message (HTML).
  const mime = [
    `From: ${fromHeader}`,
    `To: ${params.to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeHeader(params.subject || "(no subject)")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
  ].join("\r\n");

  const raw = base64Url(Buffer.from(mime, "utf-8"));

  try {
    const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return { success: false, error: `Gmail API ${resp.status}: ${txt.slice(0, 300)}` };
    }
    const data = (await resp.json()) as { id?: string };
    return { success: true, messageId: data.id };
  } catch (e: any) {
    return { success: false, error: e?.message || "Gmail send failed" };
  }
}

// Lightweight connection-status helper for the UI.
export function gmailConnectionStatus(): { connected: boolean; email: string | null } {
  const row = getActiveGoogleToken();
  return { connected: !!row, email: row?.account_email || null };
}
