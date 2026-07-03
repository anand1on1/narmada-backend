// R27.30 — Admin OTP login store (super-admin only).
//
// Exercises the pure store layer in server/otp-store.ts: OTP generation/hashing,
// challenge create/reuse (30-sec resend window), attempt counting, verification,
// invalidation, and lockout create/expiry. The HTTP gate lives in routes.ts and
// is covered indirectly — these tests pin the primitives it depends on.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE, OTP_CONSTANTS,
  hashOtp, verifyOtp, generateOtp,
  getLockout, setLockout,
  getActiveChallenge, getChallengeByToken, createOrReuseChallenge,
  incrementAttempts, markChallengeVerified, invalidateOtherChallenges, invalidateChallenge,
} from "../../server/otp-store";
import { buildSitemapUrls, renderSitemapXml, sitemapCanonicalBase, ROBOTS_TXT } from "../../server/routes";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_30Migrations();
});

beforeEach(() => {
  db.exec(`DELETE FROM admin_otp_challenges`);
  db.exec(`DELETE FROM admin_otp_lockouts`);
});

describe("R27.30 — OTP primitives", () => {
  it("(1) generateOtp returns a 6-digit numeric string in 100000..999999", () => {
    for (let i = 0; i < 200; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^[0-9]{6}$/);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  it("(2) hashOtp/verifyOtp round-trips; wrong code fails; malformed stored fails", () => {
    const h = hashOtp("123456");
    expect(h).toContain(":");
    expect(verifyOtp("123456", h)).toBe(true);
    expect(verifyOtp("654321", h)).toBe(false);
    expect(verifyOtp("123456", "garbage")).toBe(false);
  });
});

describe("R27.30 — challenge lifecycle", () => {
  it("(3) createOrReuseChallenge (new) persists a challenge + returns plaintext OTP", () => {
    const { challenge, otp, reused } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    expect(reused).toBe(false);
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(challenge.username).toBe(SUPER_ADMIN_USERNAME);
    expect(challenge.mobile).toBe(SUPER_ADMIN_MOBILE);
    expect(challenge.attempts).toBe(0);
    expect(challenge.verified_at).toBeNull();
    expect(challenge.challenge_token).toMatch(/^[0-9a-f]{64}$/);
    // the stored hash verifies against the returned plaintext
    expect(verifyOtp(otp!, challenge.otp_hash)).toBe(true);
  });

  it("(4) a second request within the 30-sec resend window reuses the challenge (no new OTP)", () => {
    const first = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    const second = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    expect(second.reused).toBe(true);
    expect(second.otp).toBeNull();
    expect(second.challenge.id).toBe(first.challenge.id);
    const count = db.prepare(`SELECT COUNT(*) c FROM admin_otp_challenges`).get() as any;
    expect(count.c).toBe(1);
  });

  it("(5) once the prior challenge is older than the resend window, a fresh one is issued", () => {
    const first = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    // backdate the first challenge beyond the resend window
    const old = new Date(Date.now() - (OTP_CONSTANTS.RESEND_WINDOW_SECONDS + 5) * 1000).toISOString();
    db.prepare(`UPDATE admin_otp_challenges SET created_at = ? WHERE id = ?`).run(old, first.challenge.id);
    const second = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    expect(second.reused).toBe(false);
    expect(second.otp).toMatch(/^[0-9]{6}$/);
    expect(second.challenge.id).not.toBe(first.challenge.id);
  });

  it("(6) getActiveChallenge / getChallengeByToken locate the live challenge", () => {
    const { challenge } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    expect(getActiveChallenge(SUPER_ADMIN_USERNAME)?.id).toBe(challenge.id);
    expect(getChallengeByToken(challenge.challenge_token)?.id).toBe(challenge.id);
    expect(getChallengeByToken("no-such-token")).toBeNull();
  });

  it("(7) incrementAttempts bumps and returns the running count", () => {
    const { challenge } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    expect(incrementAttempts(challenge.id)).toBe(1);
    expect(incrementAttempts(challenge.id)).toBe(2);
    expect(incrementAttempts(challenge.id)).toBe(3);
  });

  it("(8) markChallengeVerified removes it from the active set", () => {
    const { challenge } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    markChallengeVerified(challenge.id);
    expect(getActiveChallenge(SUPER_ADMIN_USERNAME)).toBeNull();
    const row = db.prepare(`SELECT verified_at FROM admin_otp_challenges WHERE id = ?`).get(challenge.id) as any;
    expect(row.verified_at).toBeTruthy();
  });

  it("(9) an expired challenge is not returned as active", () => {
    const { challenge } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    db.prepare(`UPDATE admin_otp_challenges SET expires_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), challenge.id);
    expect(getActiveChallenge(SUPER_ADMIN_USERNAME)).toBeNull();
  });

  it("(10) invalidateOtherChallenges expires siblings but keeps the target", () => {
    const a = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE).challenge;
    // force a distinct second live challenge
    db.prepare(`UPDATE admin_otp_challenges SET created_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 60_000).toISOString(), a.id);
    const b = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE).challenge;
    invalidateOtherChallenges(SUPER_ADMIN_USERNAME, b.id);
    expect(getActiveChallenge(SUPER_ADMIN_USERNAME)?.id).toBe(b.id);
    // a is now expired
    const rowA = db.prepare(`SELECT expires_at FROM admin_otp_challenges WHERE id = ?`).get(a.id) as any;
    expect(new Date(rowA.expires_at).getTime()).toBeLessThan(Date.now());
  });

  it("(11) invalidateChallenge expires a single challenge", () => {
    const { challenge } = createOrReuseChallenge(SUPER_ADMIN_USERNAME, SUPER_ADMIN_MOBILE);
    invalidateChallenge(challenge.id);
    expect(getActiveChallenge(SUPER_ADMIN_USERNAME)).toBeNull();
  });
});

describe("R27.30 — lockouts", () => {
  it("(12) setLockout then getLockout returns an active lock", () => {
    setLockout(SUPER_ADMIN_USERNAME, OTP_CONSTANTS.LOCKOUT_MINUTES);
    const lock = getLockout(SUPER_ADMIN_USERNAME);
    expect(lock).not.toBeNull();
    expect(new Date(lock!.locked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("(13) an expired lockout auto-clears on read", () => {
    setLockout(SUPER_ADMIN_USERNAME, OTP_CONSTANTS.LOCKOUT_MINUTES);
    db.prepare(`UPDATE admin_otp_lockouts SET locked_until = ? WHERE username = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), SUPER_ADMIN_USERNAME);
    expect(getLockout(SUPER_ADMIN_USERNAME)).toBeNull();
    const remaining = db.prepare(`SELECT COUNT(*) c FROM admin_otp_lockouts WHERE username = ?`).get(SUPER_ADMIN_USERNAME) as any;
    expect(remaining.c).toBe(0);
  });

  it("(14) setLockout upserts (second call replaces the window)", () => {
    setLockout(SUPER_ADMIN_USERNAME, 5);
    setLockout(SUPER_ADMIN_USERNAME, 15, "again");
    const rows = db.prepare(`SELECT * FROM admin_otp_lockouts WHERE username = ?`).all(SUPER_ADMIN_USERNAME) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe("again");
  });
});

// R27.31 — dynamic sitemap.xml + robots.txt served from the backend. These pin the
// pure builders that the public GET /sitemap.xml + GET /robots.txt routes reuse (the
// same builder powers the /admin "Sitemap & SEO" URL count), so the served document
// always matches the dashboard and always advertises the canonical domain.
describe("R27.31 dynamic sitemap + robots", () => {
  const anyProduct = (o: any) => o as Awaited<ReturnType<typeof import("../../server/storage").storage.listProducts>>[number];

  it("(1) sitemap XML wraps the canonical URL set in a <urlset> root", () => {
    expect(sitemapCanonicalBase()).toBe("https://narmadamobility.com");
    const urls = buildSitemapUrls([], sitemapCanonicalBase());
    const xml = renderSitemapXml(urls);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(xml).toContain("<loc>https://narmadamobility.com/</loc>");
    expect(xml).toContain("<loc>https://narmadamobility.com/products</loc>");
    // Static (product-independent) URL count is stable: 10 fixed pages + 5 brands +
    // 15 categories + 5 brands × (37 states + 60 countries) = 515.
    expect(urls.length).toBe(515);
  });

  it("(2) product URLs are part-number-first, hash-routed, and skip inactive rows", () => {
    const base = buildSitemapUrls([], "https://narmadamobility.com").length;
    const products = [
      anyProduct({ active: true, slug: "brake-pad", partNumber: "BP 100/A" }),
      anyProduct({ active: true, slug: "oil-filter", part_number: null }),
      anyProduct({ active: false, slug: "hidden-part", partNumber: "ZZ9" }),
    ];
    const urls = buildSitemapUrls(products, "https://narmadamobility.com");
    expect(urls.length).toBe(base + 2); // inactive skipped
    expect(urls.some((u) => u.includes("/#/product/BP%20100%2FA/brake-pad"))).toBe(true);
    expect(urls.some((u) => u.includes("/#/product/oil-filter"))).toBe(true);
    expect(urls.some((u) => u.includes("hidden-part"))).toBe(false);
  });

  it("(3) robots.txt is a plain-text body advertising the canonical sitemap", () => {
    expect(ROBOTS_TXT.startsWith("User-agent: *")).toBe(true);
    expect(ROBOTS_TXT).toContain("Allow: /");
    expect(ROBOTS_TXT).toContain("Sitemap: https://narmadamobility.com/sitemap.xml");
    expect(ROBOTS_TXT).not.toContain("onrender.com");
  });
});
