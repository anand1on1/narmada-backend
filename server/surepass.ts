// =============================================================================
// R28 Session 2 — SurePass RC-V2 lookup module.
// -----------------------------------------------------------------------------
// Given a raw vehicle registration string, resolve the chassis (VIN) via
// SurePass's KYC RC-V2 API. Cached for 30 days on the registration number so
// repeat lookups don't re-charge the SurePass wallet.
//
// Env vars (all already set in Render — see SESSION-2-DEPLOY-GUIDE.md):
//   SUREPASS_API_TOKEN     — Bearer token
//   SUREPASS_BASE_URL      — https://kyc-api.surepass.app
//   SUREPASS_RC_ENDPOINT   — /api/v1/rc/rc-v2
//
// Never throws — every failure path logs to surepass_lookups and returns
// {ok:false, error}. Timeout: 15 s via AbortController.
// =============================================================================
import { rawSqlite } from "./storage";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TIMEOUT_MS = 15_000;

/** Normalize a reg number: uppercase, strip whitespace/hyphens. */
export function normalizeRegNumber(reg: string): string {
  return String(reg || "").toUpperCase().replace(/[\s\-]/g, "").trim();
}

/**
 * Lookup a vehicle registration via SurePass, using cached row if available.
 *
 * @param regNumber   raw customer input; will be normalized before lookup
 * @param requesterIp optional IP address for audit
 * @param userId      optional admin user id for audit
 */
export async function lookupRegistration(
  regNumber: string,
  requesterIp?: string,
  userId?: number
): Promise<{
  ok: boolean;
  chassis_number?: string;
  raw?: any;
  cached?: boolean;
  error?: string;
}> {
  const reg = normalizeRegNumber(regNumber);
  if (!reg || reg.length < 4) {
    return { ok: false, error: "invalid_reg_number" };
  }

  // ---- 30-day cache check ----
  try {
    const cutoff = Date.now() - CACHE_TTL_MS;
    const cached = rawSqlite
      .prepare(
        `SELECT reg_number, chassis_number, raw_response, status, created_at
         FROM surepass_lookups
         WHERE reg_number = ? AND status = 'success' AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(reg, cutoff) as
      | { reg_number: string; chassis_number: string | null; raw_response: string; status: string; created_at: number }
      | undefined;
    if (cached && cached.chassis_number) {
      let raw: any = null;
      try { raw = JSON.parse(cached.raw_response); } catch { /* keep raw null */ }
      return {
        ok: true,
        chassis_number: cached.chassis_number,
        raw,
        cached: true,
      };
    }
  } catch (e: any) {
    // Cache read failure is not fatal — continue to hit SurePass.
    console.warn("[surepass] cache read failed:", e?.message || e);
  }

  // ---- Hit SurePass ----
  const token = process.env.SUREPASS_API_TOKEN || "";
  const baseUrl = process.env.SUREPASS_BASE_URL || "https://kyc-api.surepass.app";
  const endpoint = process.env.SUREPASS_RC_ENDPOINT || "/api/v1/rc/rc-v2";
  if (!token) {
    const err = "surepass_token_missing";
    saveLookup({ regNumber: reg, chassisNumber: null, raw: { error: err }, status: "error", requesterIp, userId, costCharged: 0 });
    return { ok: false, error: err };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let httpStatus = 0;
  let bodyText = "";
  let parsed: any = null;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ id_number: reg }),
      signal: controller.signal,
    });
    httpStatus = resp.status;
    bodyText = await resp.text();
    try { parsed = JSON.parse(bodyText); } catch { parsed = { raw_body: bodyText }; }
  } catch (e: any) {
    clearTimeout(timer);
    const err = e?.name === "AbortError" ? "surepass_timeout" : (e?.message || "surepass_network_error");
    saveLookup({
      regNumber: reg, chassisNumber: null, raw: { error: err, http_status: httpStatus },
      status: "error", requesterIp, userId, costCharged: 0,
    });
    return { ok: false, error: err };
  } finally {
    clearTimeout(timer);
  }

  // Non-2xx = error. Save the raw body so ops can debug wallet / auth issues.
  if (httpStatus < 200 || httpStatus >= 300) {
    saveLookup({
      regNumber: reg, chassisNumber: null, raw: parsed,
      status: "error", requesterIp, userId, costCharged: 0,
    });
    return { ok: false, error: `surepass_http_${httpStatus}`, raw: parsed };
  }

  // SurePass returns { success: true/false, data: {...}, message: "..." }
  const success = !!(parsed && (parsed.success === true || parsed.status_code === 200));
  const data = parsed?.data || {};
  // `vehicle_chasi_number` is the field SurePass uses (note the misspelling — verified).
  const chassisNumber: string | null =
    data?.vehicle_chasi_number || data?.vehicle_chassi_number || data?.chassis_number || null;

  if (!success || !chassisNumber) {
    // API responded 200 but the vehicle wasn't found / partial data. Treat as not_found
    // and do not cache as success — but also do not charge (SurePass may bill anyway;
    // we conservatively record cost_charged=0 for cache-miss safety, adjust if wallet
    // billing patterns diverge in production).
    saveLookup({
      regNumber: reg, chassisNumber: chassisNumber, raw: parsed,
      status: chassisNumber ? "success" : "not_found",
      requesterIp, userId, costCharged: 0,
    });
    if (chassisNumber) {
      return { ok: true, chassis_number: chassisNumber, raw: parsed, cached: false };
    }
    return { ok: false, error: "not_found", raw: parsed };
  }

  // Fresh 200 with chassis — charge wallet cost=1.
  saveLookup({
    regNumber: reg, chassisNumber, raw: parsed,
    status: "success", requesterIp, userId, costCharged: 1,
  });
  return { ok: true, chassis_number: chassisNumber, raw: parsed, cached: false };
}

// -----------------------------------------------------------------------------
// Persistence helper. Uses UPSERT on reg_number so a repeat lookup replaces the
// prior row rather than accumulating history — the caller wants the "latest
// state" per reg for cache purposes. If you need historic audit, drop the
// UNIQUE constraint in a follow-up migration.
// -----------------------------------------------------------------------------
function saveLookup(row: {
  regNumber: string;
  chassisNumber: string | null;
  raw: any;
  status: "success" | "not_found" | "error";
  requesterIp?: string;
  userId?: number;
  costCharged: number;
}) {
  try {
    const now = Date.now();
    rawSqlite
      .prepare(
        `INSERT INTO surepass_lookups
          (reg_number, chassis_number, raw_response, status, requester_ip, requester_user_id, cost_charged, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(reg_number) DO UPDATE SET
           chassis_number = excluded.chassis_number,
           raw_response   = excluded.raw_response,
           status         = excluded.status,
           requester_ip   = excluded.requester_ip,
           requester_user_id = excluded.requester_user_id,
           cost_charged   = excluded.cost_charged,
           created_at     = excluded.created_at`
      )
      .run(
        row.regNumber,
        row.chassisNumber,
        JSON.stringify(row.raw ?? {}),
        row.status,
        row.requesterIp ?? null,
        row.userId ?? null,
        row.costCharged,
        now,
      );
  } catch (e: any) {
    // Never let audit writes crash the caller — they're not on the request path critical.
    console.error("[surepass] audit write failed:", e?.message || e);
  }
}
