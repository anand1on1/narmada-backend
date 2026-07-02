// R27.30 — Admin OTP login store (super-admin only).
// Raw better-sqlite3 against the shared handle. OTP hashing reuses Node scrypt
// (salt:hash) — the codebase has no bcrypt, and scrypt is what the existing admin
// password path uses, so we stay consistent rather than add a new dependency.
import { rawSqlite as sqlite } from "./storage";
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const nowIso = () => new Date().toISOString();

export const SUPER_ADMIN_USERNAME = "narmadamobility123";
export const SUPER_ADMIN_MOBILE = "+917909083806";
export const SUPER_ADMIN_MOBILE_MASKED = "+91 79****3806";
const OTP_TTL_SECONDS = 300;      // 5 minutes
const MAX_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;
const RESEND_WINDOW_SECONDS = 30;

export interface OtpChallengeRow {
  id: number;
  username: string;
  otp_hash: string;
  mobile: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  verified_at: string | null;
  challenge_token: string;
  ip: string | null;
  user_agent: string | null;
}

export function hashOtp(otp: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(otp, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyOtp(otp: string, stored: string): boolean {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(otp, salt, 64);
  const known = Buffer.from(hash, "hex");
  if (candidate.length !== known.length) return false;
  return timingSafeEqual(candidate, known);
}

export function generateOtp(): string {
  return String(randomInt(100000, 1000000)); // inclusive 100000..999999
}

// ---- Lockouts ----
export function getLockout(username: string): { locked_until: string; reason: string | null } | null {
  const row = sqlite.prepare(
    `SELECT locked_until, reason FROM admin_otp_lockouts WHERE username = ?`,
  ).get(username) as any;
  if (!row) return null;
  if (new Date(row.locked_until).getTime() <= Date.now()) {
    // expired lockout — clear it so future logins proceed
    sqlite.prepare(`DELETE FROM admin_otp_lockouts WHERE username = ?`).run(username);
    return null;
  }
  return row;
}

export function setLockout(username: string, minutes = LOCKOUT_MINUTES, reason = "too_many_otp_attempts"): string {
  const lockedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  sqlite.prepare(
    `INSERT INTO admin_otp_lockouts (username, locked_until, reason) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET locked_until = excluded.locked_until, reason = excluded.reason`,
  ).run(username, lockedUntil, reason);
  return lockedUntil;
}

// ---- Challenges ----
export function getActiveChallenge(username: string): OtpChallengeRow | null {
  // most recent unverified, unexpired challenge for this username
  const row = sqlite.prepare(
    `SELECT * FROM admin_otp_challenges
     WHERE username = ? AND verified_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(username, nowIso()) as any;
  return row || null;
}

export function getChallengeByToken(token: string): OtpChallengeRow | null {
  const row = sqlite.prepare(
    `SELECT * FROM admin_otp_challenges WHERE challenge_token = ?`,
  ).get(token) as any;
  return row || null;
}

// Returns an existing active challenge if one was created within the resend window
// (so a rapid re-request does not fire a duplicate WhatsApp). Otherwise creates a
// fresh challenge + OTP. The plaintext OTP is returned ONLY when newly generated
// (null when reusing) so the caller knows whether to (re)send WhatsApp.
export function createOrReuseChallenge(
  username: string,
  mobile: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): { challenge: OtpChallengeRow; otp: string | null; reused: boolean } {
  const existing = getActiveChallenge(username);
  if (existing) {
    const ageSec = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (ageSec < RESEND_WINDOW_SECONDS) {
      return { challenge: existing, otp: null, reused: true };
    }
  }
  const otp = generateOtp();
  const token = randomBytes(32).toString("hex");
  const created = nowIso();
  const expires = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  const info = sqlite.prepare(
    `INSERT INTO admin_otp_challenges (username, otp_hash, mobile, created_at, expires_at, attempts, challenge_token, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(username, hashOtp(otp), mobile, created, expires, token, meta.ip ?? null, meta.userAgent ?? null);
  const challenge = sqlite.prepare(`SELECT * FROM admin_otp_challenges WHERE id = ?`).get(info.lastInsertRowid) as any;
  return { challenge, otp, reused: false };
}

export function incrementAttempts(id: number): number {
  sqlite.prepare(`UPDATE admin_otp_challenges SET attempts = attempts + 1 WHERE id = ?`).run(id);
  const row = sqlite.prepare(`SELECT attempts FROM admin_otp_challenges WHERE id = ?`).get(id) as any;
  return row ? row.attempts : 0;
}

export function markChallengeVerified(id: number): void {
  sqlite.prepare(`UPDATE admin_otp_challenges SET verified_at = ? WHERE id = ?`).run(nowIso(), id);
}

// Invalidate every OTHER unverified challenge for a username (used after a success
// and after a lockout) by expiring them immediately.
export function invalidateOtherChallenges(username: string, keepId: number): void {
  sqlite.prepare(
    `UPDATE admin_otp_challenges SET expires_at = ? WHERE username = ? AND id != ? AND verified_at IS NULL`,
  ).run(new Date(Date.now() - 1000).toISOString(), username, keepId);
}

export function invalidateChallenge(id: number): void {
  sqlite.prepare(
    `UPDATE admin_otp_challenges SET expires_at = ? WHERE id = ?`,
  ).run(new Date(Date.now() - 1000).toISOString(), id);
}

export const OTP_CONSTANTS = { OTP_TTL_SECONDS, MAX_ATTEMPTS, LOCKOUT_MINUTES, RESEND_WINDOW_SECONDS };
