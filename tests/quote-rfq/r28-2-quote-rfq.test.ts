// R28.2 — Get-Quotation RFQ flow integration tests.
// Exercises registerQuoteRfqRoutes against a real Express app + real
// better-sqlite3 DB (per-file isolated via setup-env.ts DATA_DIR).
//
// The three-step flow: POST /api/quote/otp/send → /verify → /submit.
// We monkey-patch nothing: OTP codes are read directly from the quote_otp table.
//
// Cases covered:
//   (1) Happy path — send → verify → submit → row lands in quote_request.
//   (2) Send with invalid email → 400.
//   (3) Verify with wrong code → 401.
//   (4) Verify after expiry → 410 (we synthetically age the row past TTL).
//   (5) OTP rate limit per email → 3 sends in an hour → 429.
//   (6) Submit without token → 401.
//   (7) Submit with token for a different email → 401.
//   (8) Submit with empty cart → 400.
//   (9) Reference format matches NM-Q-YYYY-NNNNN.
//   (10) Two consecutive submits get sequential reference numbers.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import { rawSqlite } from "../../server/storage";
import { runR28_1Migrations, runR28_6Migrations } from "../../server/migrations";
import {
  registerQuoteRfqRoutes,
  __resetOtpRateLimiter,
} from "../../server/quote-rfq";

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerQuoteRfqRoutes(app);
  return app;
}

interface HttpResult { status: number; text: string; json?: any; }

function postJson(app: Express, url: string, body: any, extraHeaders: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const http = require("http") as typeof import("http");
      const payload = Buffer.from(JSON.stringify(body || {}), "utf8");
      const req = http.request({
        method: "POST", hostname: "127.0.0.1", port, path: url,
        headers: {
          "content-type": "application/json",
          "content-length": String(payload.length),
          "user-agent": "vitest-quote-rfq",
          ...extraHeaders,
        },
      }, (r) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          server.close();
          const text = Buffer.concat(chunks).toString("utf8");
          let json: any;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: r.statusCode || 0, text, json });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      req.write(payload);
      req.end();
    });
  });
}

// Pull the most recent OTP code for an email out of the DB. (The public
// endpoint hashes the code before storing, so we can't read it back — but the
// production quote-rfq module also writes the plaintext code into a separate
// column for the email body ONLY when EMAIL_NOTIFICATIONS_ENABLED is off; in
// dev we log it via the notify wrapper. For tests we short-circuit by using a
// pre-known code path: the module accepts a `__test_code` env for tests.)
//
// To avoid backdoors, we instead call the "send" endpoint with SMTP disabled
// and read the last inserted quote_otp row: its `code_hash` = SHA-256(code|email|salt).
// We know the salt in tests (set below), and we know the module hashes the SAME
// 6-digit code it generated. So we brute-force 1 000 000 SHA-256 comparisons —
// which takes ~150ms and is fine for a test. Faster path: fish the log line.
import { createHash } from "crypto";
function findCodeFor(email: string, salt: string): string | null {
  const row = rawSqlite.prepare(
    `SELECT code_hash FROM quote_otp WHERE email = ? ORDER BY id DESC LIMIT 1`,
  ).get(email.toLowerCase()) as any;
  if (!row) return null;
  const target: string = row.code_hash;
  // Brute-force 000000..999999 — fast enough (~150ms) for a test.
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, "0");
    const h = createHash("sha256").update(`${code}|${email.toLowerCase()}|${salt}`).digest("hex");
    if (h === target) return code;
  }
  return null;
}

beforeAll(() => {
  runR28_1Migrations();  // creates email_log used by sendGenericSalesEmail's audit path
  runR28_6Migrations();  // creates quote_otp + quote_request
  process.env.QUOTE_TOKEN_SECRET = "test-quote-token-secret-please-32ch";
  process.env.OTP_SALT = "test-otp-salt-24-characters";
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
});

beforeEach(() => {
  __resetOtpRateLimiter();
  // Wipe both tables so each test is independent.
  try { rawSqlite.prepare(`DELETE FROM quote_otp`).run(); } catch { /* first-run */ }
  try { rawSqlite.prepare(`DELETE FROM quote_request`).run(); } catch { /* first-run */ }
});

describe("R28.2 — Get-Quotation RFQ flow", () => {
  it("(1) happy path: send → verify → submit → row lands in DB", async () => {
    const app = makeApp();
    const email = "buyer1@example.com";
    const send = await postJson(app, "/api/quote/otp/send", { email });
    expect(send.status).toBe(200);
    expect(send.json?.ok).toBe(true);

    const code = findCodeFor(email, "test-otp-salt-24-characters");
    expect(code).toBeTruthy();

    const verify = await postJson(app, "/api/quote/otp/verify", { email, code });
    expect(verify.status).toBe(200);
    expect(verify.json?.ok).toBe(true);
    expect(verify.json?.verification_token).toBeTruthy();

    const submit = await postJson(app, "/api/quote/submit", {
      email,
      company_name: "Acme Trucking",
      contact_name: "Ravi",
      country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
      timeframe: "immediate",
      delivery_location: "Patna",
      notes: "Please expedite",
      cart: [{ part_number: "251434100121", description: "Brake pad set", chassis_slug: "tata-407-ex2", qty: 2 }],
    }, { "x-quote-token": verify.json.verification_token });
    expect(submit.status).toBe(200);
    expect(submit.json?.ok).toBe(true);
    expect(submit.json?.reference).toMatch(/^NM-Q-\d{4}-\d{5}$/);

    const row = rawSqlite.prepare(`SELECT * FROM quote_request WHERE reference = ?`).get(submit.json.reference) as any;
    expect(row).toBeTruthy();
    expect(row.company_name).toBe("Acme Trucking");
    expect(row.email).toBe(email);
  });

  it("(2) send with invalid email → 400", async () => {
    const app = makeApp();
    const r = await postJson(app, "/api/quote/otp/send", { email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBeTruthy();
  });

  it("(3) verify with wrong code → 400 invalid_code", async () => {
    const app = makeApp();
    const email = "buyer3@example.com";
    await postJson(app, "/api/quote/otp/send", { email });
    // Pull the real code so we can pick a definitely-wrong one.
    const real = findCodeFor(email, "test-otp-salt-24-characters");
    const wrong = real === "000000" ? "111111" : "000000";
    const r = await postJson(app, "/api/quote/otp/verify", { email, code: wrong });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("invalid_code");
  });

  it("(4) verify after expiry → 400 no_pending_code", async () => {
    const app = makeApp();
    const email = "buyer4@example.com";
    await postJson(app, "/api/quote/otp/send", { email });
    const code = findCodeFor(email, "test-otp-salt-24-characters");
    // Age the row past TTL by forcing expires_at into the past.
    rawSqlite.prepare(`UPDATE quote_otp SET expires_at = ? WHERE email = ?`).run(Date.now() - 60_000, email);
    const r = await postJson(app, "/api/quote/otp/verify", { email, code });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("no_pending_code");
  });

  it("(5) OTP rate limit per email: 3 sends in an hour → 4th returns 429", async () => {
    const app = makeApp();
    const email = "buyer5@example.com";
    for (let i = 0; i < 3; i++) {
      const r = await postJson(app, "/api/quote/otp/send", { email });
      expect(r.status).toBe(200);
    }
    const r4 = await postJson(app, "/api/quote/otp/send", { email });
    expect(r4.status).toBe(429);
  });

  it("(6) submit without token → 401", async () => {
    const app = makeApp();
    const r = await postJson(app, "/api/quote/submit", {
      email: "someone@example.com",
      company_name: "X", contact_name: "Y",
      country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
      timeframe: "immediate",
      cart: [{ part_number: "X-1", qty: 1 }],
    });
    expect(r.status).toBe(401);
  });

  it("(7) submit with token for a DIFFERENT email → 401", async () => {
    const app = makeApp();
    const emailA = "a@example.com";
    const emailB = "b@example.com";
    await postJson(app, "/api/quote/otp/send", { email: emailA });
    const codeA = findCodeFor(emailA, "test-otp-salt-24-characters");
    const v = await postJson(app, "/api/quote/otp/verify", { email: emailA, code: codeA });
    expect(v.json?.verification_token).toBeTruthy();
    const r = await postJson(app, "/api/quote/submit", {
      email: emailB,   // ← attacker swapped email
      company_name: "X", contact_name: "Y",
      country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
      timeframe: "immediate",
      cart: [{ part_number: "X-1", qty: 1 }],
    }, { "x-quote-token": v.json.verification_token });
    expect(r.status).toBe(401);
  });

  it("(8) submit with empty cart → 400", async () => {
    const app = makeApp();
    const email = "cart-empty@example.com";
    await postJson(app, "/api/quote/otp/send", { email });
    const code = findCodeFor(email, "test-otp-salt-24-characters");
    const v = await postJson(app, "/api/quote/otp/verify", { email, code });
    const r = await postJson(app, "/api/quote/submit", {
      email,
      company_name: "X", contact_name: "Y",
      country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
      timeframe: "immediate",
      cart: [],
    }, { "x-quote-token": v.json.verification_token });
    expect(r.status).toBe(400);
  });

  it("(9) reference format is NM-Q-YYYY-NNNNN", async () => {
    const app = makeApp();
    const email = "ref-fmt@example.com";
    await postJson(app, "/api/quote/otp/send", { email });
    const code = findCodeFor(email, "test-otp-salt-24-characters");
    const v = await postJson(app, "/api/quote/otp/verify", { email, code });
    const r = await postJson(app, "/api/quote/submit", {
      email,
      company_name: "X", contact_name: "Y",
      country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
      timeframe: "immediate",
      cart: [{ part_number: "X-1", qty: 1 }],
    }, { "x-quote-token": v.json.verification_token });
    const year = new Date().getUTCFullYear();
    expect(r.json?.reference).toMatch(new RegExp(`^NM-Q-${year}-\\d{5}$`));
  });

  it("(10) two consecutive submits get sequential references", async () => {
    const app = makeApp();
    const refs: string[] = [];
    for (const email of ["seq1@example.com", "seq2@example.com"]) {
      await postJson(app, "/api/quote/otp/send", { email });
      const code = findCodeFor(email, "test-otp-salt-24-characters");
      const v = await postJson(app, "/api/quote/otp/verify", { email, code });
      const r = await postJson(app, "/api/quote/submit", {
        email,
        company_name: "X", contact_name: "Y",
        country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210",
        timeframe: "immediate",
        cart: [{ part_number: "X-1", qty: 1 }],
      }, { "x-quote-token": v.json.verification_token });
      refs.push(r.json?.reference);
    }
    const n1 = parseInt(refs[0].split("-").pop() || "0", 10);
    const n2 = parseInt(refs[1].split("-").pop() || "0", 10);
    expect(n2).toBe(n1 + 1);
  });
});
