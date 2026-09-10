// R28.1 — Team Upload feature.
// Public, passcode-gated chassis upload endpoint. Sits parallel to (never
// replaces) the admin-gated /api/admin/chassis + /api/admin/chassis/:id/parts/
// bulk-upload path from R28 Session 2. Piyush shares the URL + passcode with
// the team on WhatsApp; team members fill a form on /team-upload and submit
// an .xlsx / .xls / .csv of parts.
//
// Verbatim user requirement:
//   "create a public url with safety net which I can share to my team to
//    upload chassis files with a single drop down to select brand which for
//    now only is tata"
//   "Everything that hackers can't exploit"
//
// Design notes (safety nets that the endpoint enforces):
//   1. Feature flag TEAM_UPLOAD_ENABLED default off. When off, returns 503
//      feature_disabled without writing an audit row (so a mistaken open port
//      doesn't fill the log with noise).
//   2. Rate limits — sliding-window in-memory:
//        - 5 uploads/hour per IP
//        - 20 uploads/day per IP
//        - 100 attempts/hour globally
//      (TODO: move to Redis if we ever scale horizontally on Render.)
//   3. Passcode compared with crypto.timingSafeEqual — never `===` — so an
//      attacker can't distinguish "first wrong char" from "last wrong char"
//      through response-time analysis.
//   4. File validation is layered:
//        - size cap (5 MB default)
//        - extension whitelist (.xlsx / .xls / .csv)
//        - magic-byte check on top of the extension (PK\x03\x04 ZIP header for
//          .xlsx, \xd0\xcf\x11\xe0 OLE header for old .xls, no-null-byte for
//          .csv). This is what defeats "PDF renamed to .xlsx" style attacks
//          that a naive .endsWith('.xlsx') check would let through.
//        - row cap (1000 rows) to bound worst-case memory usage.
//   5. IP is SHA-256(ip + TEAM_UPLOAD_IP_SALT) truncated to 16 hex — the raw
//      IP is NEVER stored anywhere (audit log, error message, or reply body).
//   6. The passcode itself is NEVER echoed back — not in the audit log,
//      not in error messages, not in the success payload.
//   7. Every request writes exactly one audit row to team_upload_log
//      (except the pre-flag 503, per point 1).
//   8. Fire-and-forget notification email to sales@narmadamobility.com on
//      success (no await — the response must not block on SMTP).
//
// The endpoint is idempotent by slug: if a team member uploads the same
// chassis twice (say to add missing parts), the second upload attaches to
// the existing chassis row instead of creating a duplicate.

import type { Express, Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { rawSqlite } from "./storage";
import { sendGenericSalesEmail } from "./email";

// ---------- Config helpers -------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isEnabled(): boolean {
  const v = String(process.env.TEAM_UPLOAD_ENABLED || "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_ROWS = 1000;

function getMaxBytes(): number { return envInt("TEAM_UPLOAD_MAX_FILE_BYTES", DEFAULT_MAX_BYTES); }
function getMaxRows(): number { return envInt("TEAM_UPLOAD_MAX_ROWS", DEFAULT_MAX_ROWS); }
function getPerIpHour(): number { return envInt("TEAM_UPLOAD_RATE_LIMIT_PER_IP_HOUR", 5); }
function getPerIpDay(): number { return envInt("TEAM_UPLOAD_RATE_LIMIT_PER_IP_DAY", 20); }
function getGlobalHour(): number { return envInt("TEAM_UPLOAD_GLOBAL_RATE_LIMIT_HOUR", 100); }

// ---------- IP hashing (never store raw) -----------------------------------

function extractIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined) || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || req.ip || "0.0.0.0";
}

function hashIp(ip: string): string {
  const salt = process.env.TEAM_UPLOAD_IP_SALT || "narmada-team-upload-default-salt-please-override";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 16);
}

// ---------- Rate limiter (in-memory sliding window) ------------------------
// TODO: move to Redis if scaling horizontally.
//
// Two per-IP buckets (hour / day) and one global bucket (hour). We prune
// entries older than the window on every check so memory stays bounded to
// active clients within the last 24 h.

const _ipHourBuckets = new Map<string, number[]>();
const _ipDayBuckets = new Map<string, number[]>();
const _globalHourBucket: number[] = [];

interface RateCheckResult {
  ok: boolean;
  retryAfterSeconds?: number;
  reason?: "per_ip_hour" | "per_ip_day" | "global_hour";
}

/**
 * Record a new attempt and check limits. Called BEFORE the request is
 * processed so a rate-limit rejection also writes an audit row.
 */
export function checkAndRecordRate(ipHash: string, now: number = Date.now()): RateCheckResult {
  const hourCutoff = now - 60 * 60 * 1000;
  const dayCutoff = now - 24 * 60 * 60 * 1000;

  // Prune global bucket in place.
  while (_globalHourBucket.length && _globalHourBucket[0] < hourCutoff) _globalHourBucket.shift();
  if (_globalHourBucket.length >= getGlobalHour()) {
    const oldest = _globalHourBucket[0];
    return { ok: false, reason: "global_hour", retryAfterSeconds: Math.max(1, Math.ceil((oldest + 3600_000 - now) / 1000)) };
  }

  // Per-IP hour bucket.
  const hourBucket = (_ipHourBuckets.get(ipHash) || []).filter((t) => t > hourCutoff);
  if (hourBucket.length >= getPerIpHour()) {
    _ipHourBuckets.set(ipHash, hourBucket);
    const oldest = hourBucket[0];
    return { ok: false, reason: "per_ip_hour", retryAfterSeconds: Math.max(1, Math.ceil((oldest + 3600_000 - now) / 1000)) };
  }

  // Per-IP day bucket.
  const dayBucket = (_ipDayBuckets.get(ipHash) || []).filter((t) => t > dayCutoff);
  if (dayBucket.length >= getPerIpDay()) {
    _ipDayBuckets.set(ipHash, dayBucket);
    const oldest = dayBucket[0];
    return { ok: false, reason: "per_ip_day", retryAfterSeconds: Math.max(1, Math.ceil((oldest + 86_400_000 - now) / 1000)) };
  }

  // All under limit — record.
  hourBucket.push(now);
  dayBucket.push(now);
  _globalHourBucket.push(now);
  _ipHourBuckets.set(ipHash, hourBucket);
  _ipDayBuckets.set(ipHash, dayBucket);

  return { ok: true };
}

/** Test-only helper: wipe every in-memory bucket between vitest cases. */
export function __resetRateLimiter(): void {
  _ipHourBuckets.clear();
  _ipDayBuckets.clear();
  _globalHourBucket.length = 0;
}

// ---------- Passcode (constant-time compare) -------------------------------

/**
 * Compare `provided` against `expected` in constant time. Returns false when
 * either input is empty or when the environment variable is unset — an unset
 * expected value must NOT accept an empty submitted passcode.
 */
export function verifyPasscode(provided: string, expected: string | undefined): boolean {
  if (!expected || typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  // timingSafeEqual requires equal length. Pad both sides to the max length so
  // comparing different-length strings still takes the same amount of work.
  const maxLen = Math.max(provided.length, expected.length);
  const a = Buffer.alloc(maxLen, 0);
  const b = Buffer.alloc(maxLen, 0);
  a.write(provided, 0, "utf8");
  b.write(expected, 0, "utf8");
  const equal = timingSafeEqual(a, b);
  return equal && provided.length === expected.length;
}

// ---------- Magic-byte file validation -------------------------------------

const XLSX_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const XLS_OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);   // OLE compound doc

export interface MagicByteCheck { ok: boolean; reason?: string; }

export function checkMagicBytes(buf: Buffer, ext: string): MagicByteCheck {
  const e = ext.toLowerCase();
  if (buf.length < 4) return { ok: false, reason: "file_too_small" };

  if (e === ".xlsx" || e === ".xls") {
    const head4 = buf.subarray(0, 4);
    if (head4.equals(XLSX_ZIP_MAGIC) || head4.equals(XLS_OLE_MAGIC)) return { ok: true };
    return { ok: false, reason: "excel_header_mismatch" };
  }

  if (e === ".csv") {
    // Reject if any null byte appears in the first KB — that is a very reliable
    // signal that a binary file was renamed .csv.
    const sample = buf.subarray(0, Math.min(1024, buf.length));
    for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return { ok: false, reason: "csv_has_null_byte" };
    return { ok: true };
  }

  return { ok: false, reason: "unsupported_extension" };
}

// ---------- Slugify --------------------------------------------------------

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------- Audit log helpers ---------------------------------------------

export interface TeamUploadLogRow {
  ip_hash: string;
  passcode_ok: 0 | 1;
  chassis_code?: string | null;
  chassis_display_name?: string | null;
  filename?: string | null;
  filesize_bytes?: number | null;
  parts_created?: number;
  parts_updated?: number;
  parts_errors?: number;
  status: "success" | "rejected_passcode" | "rejected_file" | "rejected_ratelimit" | "rejected_input" | "error";
  error_message?: string | null;
  user_agent?: string | null;
  chassis_id?: number | null;
}

function insertAuditRow(row: TeamUploadLogRow): void {
  try {
    rawSqlite
      .prepare(
        `INSERT INTO team_upload_log
          (ip_hash, passcode_ok, chassis_code, chassis_display_name, filename,
           filesize_bytes, parts_created, parts_updated, parts_errors, status,
           error_message, user_agent, chassis_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.ip_hash,
        row.passcode_ok,
        row.chassis_code ?? null,
        row.chassis_display_name ?? null,
        row.filename ?? null,
        row.filesize_bytes ?? null,
        row.parts_created ?? 0,
        row.parts_updated ?? 0,
        row.parts_errors ?? 0,
        row.status,
        row.error_message ?? null,
        row.user_agent ? String(row.user_agent).slice(0, 500) : null,
        row.chassis_id ?? null,
        Date.now(),
      );
  } catch (e: any) {
    // Audit failures must not crash the request. Log and move on.
    console.error("[team-upload] audit insert failed:", e?.message || e);
  }
}

// Exposed for the admin GET /api/admin/team-upload/log endpoint.
export function listTeamUploadLog(opts: {
  limit?: number; offset?: number; status?: string; days?: number;
} = {}): any[] {
  const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 500);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const clauses: string[] = [];
  const params: any[] = [];
  if (opts.status) { clauses.push("status = ?"); params.push(String(opts.status)); }
  if (opts.days && Number.isFinite(opts.days) && opts.days > 0) {
    clauses.push("created_at >= ?");
    params.push(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    return rawSqlite
      .prepare(`SELECT * FROM team_upload_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];
  } catch (e: any) {
    console.error("[team-upload] listTeamUploadLog failed:", e?.message || e);
    return [];
  }
}

// ---------- Multer + field validation --------------------------------------

// Bounded by getMaxBytes() at request time (multer's `limits` runs before our
// handler, so we set a generous ceiling here and re-check the actual buffer
// length inside the handler using the runtime env value).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // hard ceiling; env-tunable soft cap re-checked below
});

const ALLOWED_EXT = new Set([".xlsx", ".xls", ".csv"]);
const CHASSIS_CODE_RE = /^[A-Za-z0-9_-]{1,100}$/;

function fileExtension(filename: string | undefined): string {
  if (!filename) return "";
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

// ---------- Route registration ---------------------------------------------

export function registerTeamUploadRoutes(app: Express, opts: {
  requireAdminRole?: (req: Request, res: Response, next: NextFunction) => any;
} = {}): void {
  const requireAuth = opts.requireAdminRole || ((_req: Request, _res: Response, next: NextFunction) => next());

  // ---- Public: passcode-gated chassis upload ------------------------------
  app.post("/api/team-upload/chassis", (req: Request, res: Response, next: NextFunction) => {
    // Step 1 — feature flag. Do NOT audit-log a flag-off attempt.
    if (!isEnabled()) return res.status(503).json({ error: "feature_disabled" });
    return next();
  }, upload.single("file"), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const ua = (req.headers["user-agent"] as string | undefined) || "";
    const ipHash = hashIp(extractIp(req));

    // Step 2 — rate limit BEFORE parsing the body. Also audit.
    const rate = checkAndRecordRate(ipHash);
    if (!rate.ok) {
      insertAuditRow({
        ip_hash: ipHash,
        passcode_ok: 0,
        status: "rejected_ratelimit",
        error_message: rate.reason || "rate_limited",
        user_agent: ua,
      });
      res.setHeader("Retry-After", String(rate.retryAfterSeconds || 3600));
      return res.status(429).json({ error: "rate_limited", retry_after_seconds: rate.retryAfterSeconds });
    }

    // Step 3 — parse body fields (multer has already parsed multipart).
    const b: Record<string, string> = {};
    for (const k of ["passcode", "chassis_code", "chassis_display_name", "variant", "description"]) {
      const v = (req.body || {})[k];
      b[k] = typeof v === "string" ? v : "";
    }
    const file = (req as any).file as { originalname: string; buffer: Buffer; size: number } | undefined;

    // Field-length + shape validation. Never echo passcode.
    if (!b.passcode)                              return failInput(res, ipHash, ua, "passcode", "missing_field");
    if (!b.chassis_code)                          return failInput(res, ipHash, ua, "chassis_code", "missing_field");
    if (!b.chassis_display_name)                  return failInput(res, ipHash, ua, "chassis_display_name", "missing_field");
    if (b.chassis_code.length > 100)              return failInput(res, ipHash, ua, "chassis_code", "too_long", b.chassis_code, b.chassis_display_name);
    if (!CHASSIS_CODE_RE.test(b.chassis_code))    return failInput(res, ipHash, ua, "chassis_code", "invalid_format", b.chassis_code, b.chassis_display_name);
    if (b.chassis_display_name.length > 200)      return failInput(res, ipHash, ua, "chassis_display_name", "too_long", b.chassis_code, b.chassis_display_name);
    if (b.variant && b.variant.length > 100)      return failInput(res, ipHash, ua, "variant", "too_long", b.chassis_code, b.chassis_display_name);
    if (b.description && b.description.length > 1000) return failInput(res, ipHash, ua, "description", "too_long", b.chassis_code, b.chassis_display_name);
    if (!file || !file.buffer)                    return failInput(res, ipHash, ua, "file", "missing_field", b.chassis_code, b.chassis_display_name);

    // Step 4 — passcode check (constant time). Never echo attempted value.
    const expected = process.env.TEAM_UPLOAD_PASSCODE;
    const passcodeOk = verifyPasscode(b.passcode, expected);
    if (!passcodeOk) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 0,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file?.originalname || null, filesize_bytes: file?.size ?? null,
        status: "rejected_passcode", error_message: "invalid_passcode", user_agent: ua,
      });
      return res.status(401).json({ error: "invalid_passcode" });
    }

    // Step 5 — file validation.
    const maxBytes = getMaxBytes();
    if (file.size > maxBytes) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file.originalname, filesize_bytes: file.size,
        status: "rejected_file", error_message: "file_too_large", user_agent: ua,
      });
      return res.status(413).json({ error: "file_too_large", max_bytes: maxBytes });
    }

    const ext = fileExtension(file.originalname);
    if (!ALLOWED_EXT.has(ext)) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file.originalname, filesize_bytes: file.size,
        status: "rejected_file", error_message: "invalid_file_type", user_agent: ua,
      });
      return res.status(415).json({ error: "invalid_file_type" });
    }

    const magic = checkMagicBytes(file.buffer, ext);
    if (!magic.ok) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file.originalname, filesize_bytes: file.size,
        status: "rejected_file", error_message: `magic_byte_mismatch:${magic.reason || "unknown"}`, user_agent: ua,
      });
      return res.status(415).json({ error: "file_content_does_not_match_extension" });
    }

    // Parse rows via the same xlsx helper Session 2 uses.
    let rows: any[] = [];
    try {
      const wb = XLSX.read(file.buffer, { type: "buffer" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        insertAuditRow({
          ip_hash: ipHash, passcode_ok: 1,
          chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
          filename: file.originalname, filesize_bytes: file.size,
          status: "rejected_file", error_message: "no_sheet_in_file", user_agent: ua,
        });
        return res.status(400).json({ error: "no_sheet_in_file" });
      }
      const ws = wb.Sheets[firstSheet];
      rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }) as any[];
    } catch (e: any) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file.originalname, filesize_bytes: file.size,
        status: "rejected_file", error_message: `parse_failed: ${e?.message || e}`, user_agent: ua,
      });
      return res.status(400).json({ error: "parse_failed" });
    }

    const maxRows = getMaxRows();
    if (rows.length > maxRows) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: b.chassis_code, chassis_display_name: b.chassis_display_name,
        filename: file.originalname, filesize_bytes: file.size,
        status: "rejected_file", error_message: `too_many_rows:${rows.length}`, user_agent: ua,
      });
      return res.status(400).json({ error: "too_many_rows", max: maxRows });
    }

    // Step 6 — business logic. Force make='TATA' per user rule.
    const displayName = b.chassis_display_name.trim();
    const chassisCode = b.chassis_code.trim();
    const slug = toSlug(displayName) || toSlug(chassisCode) || `chassis-${Date.now()}`;
    const variant = (b.variant || "").trim() || null;
    const description = (b.description || "").trim() || null;

    let chassisId: number | null = null;
    try {
      const runTx = rawSqlite.transaction(() => {
        // Idempotent by slug — attach to existing row if this chassis was
        // uploaded before.
        const now = Date.now();
        const existing = rawSqlite.prepare(`SELECT id FROM chassis_catalog WHERE slug = ?`).get(slug) as any;
        if (existing?.id) {
          chassisId = Number(existing.id);
        } else {
          const info = rawSqlite
            .prepare(
              `INSERT INTO chassis_catalog
                (chassis_code, chassis_display_name, make, model, variant, slug,
                 description, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .run(
              chassisCode,
              displayName,
              "TATA",              // user rule: only tata for now
              displayName,          // model defaults to display name
              variant,
              slug,
              description,
              now,
              now,
            );
          chassisId = Number(info.lastInsertRowid);
        }
      });
      runTx();
    } catch (e: any) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: chassisCode, chassis_display_name: displayName,
        filename: file.originalname, filesize_bytes: file.size,
        status: "error", error_message: `chassis_create_failed: ${e?.message || e}`, user_agent: ua,
      });
      return res.status(500).json({ error: "chassis_create_failed" });
    }

    if (!chassisId) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: chassisCode, chassis_display_name: displayName,
        filename: file.originalname, filesize_bytes: file.size,
        status: "error", error_message: "chassis_id_missing_after_insert", user_agent: ua,
      });
      return res.status(500).json({ error: "chassis_create_failed" });
    }

    // Upsert parts. Mirrors the logic from Session 2's bulk-upload service
    // (server/routes-v2.ts /api/admin/chassis/:id/parts/bulk-upload) so this
    // endpoint stays consistent with the admin path.
    const normalize = (r: any) => {
      const out: any = {};
      for (const k of Object.keys(r || {})) out[String(k).trim().toLowerCase().replace(/\s+/g, "_")] = r[k];
      return out;
    };
    const toNum = (v: any): number | null => {
      if (v === "" || v == null) return null;
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const toInt = (v: any): number | null => {
      const n = toNum(v);
      return n == null ? null : Math.trunc(n);
    };

    const insertPart = rawSqlite.prepare(
      `INSERT INTO chassis_parts
        (chassis_id, part_number, oem_number, description, category, position_notes,
         purchase_price, sell_price, stock_qty, image_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(chassis_id, part_number) DO UPDATE SET
         oem_number      = excluded.oem_number,
         description     = excluded.description,
         category        = excluded.category,
         position_notes  = excluded.position_notes,
         purchase_price  = excluded.purchase_price,
         sell_price      = excluded.sell_price,
         stock_qty       = excluded.stock_qty,
         image_url       = excluded.image_url,
         is_active       = 1,
         updated_at      = excluded.updated_at
       RETURNING id, (created_at = updated_at) AS was_created`,
    );

    let created = 0;
    let updated = 0;
    const errorDetails: { row: number; error: string }[] = [];
    const insertRows = rawSqlite.transaction((list: any[]) => {
      for (let i = 0; i < list.length; i++) {
        const r = normalize(list[i]);
        try {
          const part_number = String(r.part_number || "").trim();
          if (!part_number) throw new Error("part_number is required");
          const desc = String(r.description || "").trim() || part_number;
          const now = Date.now();
          const result = insertPart.get(
            chassisId,
            part_number,
            String(r.oem_number || "").trim() || null,
            desc,
            String(r.category || "").trim() || null,
            String(r.position_notes || "").trim() || null,
            toNum(r.purchase_price),
            toNum(r.sell_price),
            toInt(r.stock_qty) ?? 0,
            String(r.image_url || "").trim() || null,
            now, now,
          ) as any;
          if (result && result.was_created) created++; else updated++;
        } catch (e: any) {
          errorDetails.push({ row: i + 2, error: e?.message || "unknown" });
        }
      }
    });

    try {
      insertRows(rows);
    } catch (e: any) {
      insertAuditRow({
        ip_hash: ipHash, passcode_ok: 1,
        chassis_code: chassisCode, chassis_display_name: displayName,
        filename: file.originalname, filesize_bytes: file.size,
        status: "error", error_message: `parts_insert_failed: ${e?.message || e}`,
        user_agent: ua, chassis_id: chassisId,
      });
      return res.status(500).json({ error: "parts_insert_failed" });
    }

    const processingMs = Date.now() - startedAt;

    insertAuditRow({
      ip_hash: ipHash, passcode_ok: 1,
      chassis_code: chassisCode, chassis_display_name: displayName,
      filename: file.originalname, filesize_bytes: file.size,
      parts_created: created, parts_updated: updated, parts_errors: errorDetails.length,
      status: "success", user_agent: ua, chassis_id: chassisId,
    });

    // Fire-and-forget email — NEVER await. The response must not block on SMTP.
    // sendGenericSalesEmail respects EMAIL_NOTIFICATIONS_ENABLED internally.
    void (async () => {
      try {
        const siteUrl = process.env.SITE_URL || "https://narmadamobility.com";
        const link = `${siteUrl}/#/admin/chassis/${chassisId}/parts`;
        const lines = [
          `A team member just uploaded a chassis catalog via the /team-upload portal.`,
          ``,
          `Chassis:  ${displayName}`,
          `Code:     ${chassisCode}`,
          `Variant:  ${variant || "(none)"}`,
          `Brand:    TATA`,
          ``,
          `Parts created:  ${created}`,
          `Parts updated:  ${updated}`,
          `Parts errored:  ${errorDetails.length}`,
          ``,
          `Review parts:  ${link}`,
        ].join("\n");
        await sendGenericSalesEmail({
          eventType: "team_upload_success",
          entityId: chassisId,
          subject: `[Team Upload] ${displayName} - ${created} parts added`,
          text: lines,
        });
      } catch (e: any) {
        console.error("[team-upload] notify email failed:", e?.message || e);
      }
    })();

    // Step 7 — success response.
    return res.status(200).json({
      ok: true,
      chassis: { id: chassisId, slug, display_name: displayName },
      parts: {
        created,
        updated,
        errors: errorDetails.length,
        error_details: errorDetails.slice(0, 50),  // cap detail list length
      },
      processing_ms: processingMs,
    });
  });

  // ---- Multer error handler (rejects size > 20 MB before our soft cap runs)
  // Wrap the endpoint's own error path so a multer LIMIT_FILE_SIZE surfaces as
  // 413 (matching our soft-cap behaviour) instead of a 500.
  app.use("/api/team-upload/chassis", (err: any, req: Request, res: Response, next: NextFunction) => {
    if (err && err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
      try {
        const ua = (req.headers["user-agent"] as string | undefined) || "";
        insertAuditRow({
          ip_hash: hashIp(extractIp(req)), passcode_ok: 0,
          status: "rejected_file", error_message: "file_too_large_multer", user_agent: ua,
        });
      } catch { /* ignore */ }
      return res.status(413).json({ error: "file_too_large", max_bytes: getMaxBytes() });
    }
    return next(err);
  });

  // ---- Admin: audit log listing ------------------------------------------
  app.get("/api/admin/team-upload/log", requireAuth, (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const status = req.query.status ? String(req.query.status) : undefined;
      const days = req.query.days ? Number(req.query.days) : undefined;
      const rows = listTeamUploadLog({ limit, offset, status, days });
      res.json({ ok: true, rows, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}

// ---------- small helpers for the endpoint ---------------------------------

function failInput(
  res: Response,
  ipHash: string,
  ua: string,
  field: string,
  reason: string,
  chassisCode?: string,
  displayName?: string,
): Response {
  insertAuditRow({
    ip_hash: ipHash, passcode_ok: 0,
    chassis_code: chassisCode || null, chassis_display_name: displayName || null,
    status: "rejected_input", error_message: `${field}:${reason}`, user_agent: ua,
  });
  return res.status(400).json({ error: "invalid_input", field });
}

// Utility: expose a randomly-generated 32-char salt suggestion for the deploy
// guide. Only used by the deploy-guide-generation script; never called at
// runtime.
export function suggestIpSalt(): string {
  return randomBytes(24).toString("base64").replace(/[+/=]/g, "").slice(0, 32);
}
