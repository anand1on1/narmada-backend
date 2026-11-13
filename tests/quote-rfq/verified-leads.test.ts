import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
vi.mock("../../server/email", () => ({ sendGenericSalesEmail: vi.fn(async () => ({ ok: true })) }));
import { sendGenericSalesEmail } from "../../server/email";
import { rawSqlite } from "../../server/storage";
import { runR28_6Migrations } from "../../server/migrations";
import { registerQuoteRfqRoutes, hashOtp, __resetOtpRateLimiter } from "../../server/quote-rfq";
import { deliverQuoteLead, drainQuoteLeads, saveVerifiedQuoteLead } from "../../server/quote-leads";
import { QUOTE_RECIPIENTS } from "../../server/quote-delivery";
import { readFileSync } from "node:fs";

const mail = vi.mocked(sendGenericSalesEmail);
const email = "lead@example.test";
const code = "182947";
const contact = { company_name: "Example Fleet", contact_name: "Buyer", mobile: "9876543210",
  country_code: "+91", country: "IN", currency: "INR" };
let server: any, base: string;
async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json",
    ...(token ? { "x-quote-token": token } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as any };
}
function challenge(expires = Date.now() + 60000) {
  return Number(rawSqlite.prepare(`INSERT INTO quote_otp(email,code_hash,expires_at,created_at)
    VALUES(?,?,?,?)`).run(email, hashOtp(code, email), expires, Date.now()).lastInsertRowid);
}
const leads = () => rawSqlite.prepare("SELECT * FROM quote_lead").all() as any[];
const deliveries = () => rawSqlite.prepare("SELECT * FROM quote_lead_delivery ORDER BY recipient").all() as any[];
async function settled() {
  await vi.waitFor(() => expect(deliveries().every(x => x.state !== "sending")).toBe(true));
}
beforeAll(async () => {
  process.env.QUOTE_TOKEN_SECRET = "offline-lead-test-secret-at-least-32-characters";
  runR28_6Migrations();
  const app = express(); app.use(express.json()); registerQuoteRfqRoutes(app);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  rawSqlite.exec("DELETE FROM quote_lead_delivery; DELETE FROM quote_lead; DELETE FROM quote_delivery; DELETE FROM quote_request; DELETE FROM quote_otp;");
  __resetOtpRateLimiter(); mail.mockReset(); mail.mockResolvedValue({ ok: true });
});
afterAll(() => server.close());

describe("Verified quotation lead capture", () => {
  it("saves all contact fields and notifies both inboxes without final submission", async () => {
    challenge();
    const r = await post("/api/quote/otp/verify", { email: email.toUpperCase(), code,
      contact: { ...contact, email: "attacker@example.test", to: "attacker@example.test" } });
    expect(r.status).toBe(200); expect(r.data.verification_token).toBeTruthy();
    await settled();
    expect(leads()).toHaveLength(1);
    expect(leads()[0].email).toBe(email);
    expect(JSON.parse(leads()[0].contact_json)).toEqual(contact);
    expect(mail.mock.calls.map(c => c[0].to).sort()).toEqual([...QUOTE_RECIPIENTS].sort());
    expect(deliveries().map(x => x.state)).toEqual(["sent", "sent"]);
    for (const [message] of mail.mock.calls) {
      expect(message.eventType).toBe("quote_verified_lead");
      for (const field of Object.values(contact)) expect(message.text).toContain(field);
      expect(message.text).toContain(email);
      expect(message.text).not.toContain(code);
      expect(message.text).not.toContain(r.data.verification_token);
      expect(message.text).not.toContain("attacker");
    }
    expect(rawSqlite.prepare("SELECT count(*) n FROM quote_request").get()).toEqual({ n: 0 });
  });
  it("does not capture or forward contacts on OTP send, wrong code, or expired code", async () => {
    await post("/api/quote/otp/send", { email, contact });
    expect(leads()).toHaveLength(0);
    expect(mail.mock.calls.every(c => c[0].eventType === "quote_otp")).toBe(true);
    mail.mockClear(); challenge();
    expect((await post("/api/quote/otp/verify", { email, code: "000000", contact })).status).toBe(400);
    rawSqlite.exec("UPDATE quote_otp SET expires_at=0");
    expect((await post("/api/quote/otp/verify", { email, code, contact })).status).toBe(400);
    expect(leads()).toHaveLength(0); expect(mail).not.toHaveBeenCalled();
  });
  it("rejects malformed/oversized contacts without consuming a valid OTP", async () => {
    challenge();
    for (const value of [null, [], { ...contact, mobile: "x" }, { ...contact, company_name: "a".repeat(201) }]) {
      expect((await post("/api/quote/otp/verify", { email, code, contact: value })).status).toBe(400);
    }
    expect(leads()).toHaveLength(0); expect(mail).not.toHaveBeenCalled();
    expect((await post("/api/quote/otp/verify", { email, code, contact })).status).toBe(200);
    await settled();
  });
  it("is safe against concurrent verification and delivery replays", async () => {
    challenge();
    const requests = await Promise.all([1, 2].map(() => post("/api/quote/otp/verify", { email, code, contact })));
    expect(requests.map(x => x.status).sort()).toEqual([200, 400]);
    await settled();
    await Promise.all([deliverQuoteLead(leads()[0].id), drainQuoteLeads()]);
    expect(leads()).toHaveLength(1); expect(mail).toHaveBeenCalledTimes(2);
  });
  it("returns verification without waiting for SMTP and keeps the lead if mail fails", async () => {
    challenge();
    // Independent promises per recipient are resolved together below.
    const pending: Array<(value: { ok: boolean; error?: string }) => void> = [];
    mail.mockImplementation(() => new Promise(r => pending.push(r)));
    const r = await post("/api/quote/otp/verify", { email, code, contact });
    expect(r.status).toBe(200); expect(leads()).toHaveLength(1);
    expect(deliveries().map(x => x.state)).toEqual(["sending", "sending"]);
    pending.forEach(done => done({ ok: false, error: "SMTP disconnected" }));
    await settled();
    expect(deliveries().map(x => x.state)).toEqual(["unknown", "unknown"]);
    await drainQuoteLeads(); expect(mail).toHaveBeenCalledTimes(2);
  });
  it("recovers persisted pending deliveries after restart and limits known-unstarted retries", async () => {
    const otpId = challenge();
    saveVerifiedQuoteLead(otpId, email, contact, Date.now());
    mail.mockResolvedValue({ ok: false, error: "SMTP not configured" });
    await drainQuoteLeads(); expect(mail).toHaveBeenCalledTimes(2);
    await drainQuoteLeads(); expect(mail).toHaveBeenCalledTimes(2);
    for (let n = 0; n < 4; n++) {
      rawSqlite.exec("UPDATE quote_lead_delivery SET updated_at=0");
      await drainQuoteLeads();
    }
    expect(mail).toHaveBeenCalledTimes(6);
    expect(deliveries().map(x => x.attempts)).toEqual([3, 3]);
  });
  it("only retries the failed recipient; interrupted sends are marked unknown", async () => {
    const id = saveVerifiedQuoteLead(challenge(), email, contact, Date.now());
    mail.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "notifications disabled" });
    await deliverQuoteLead(id);
    rawSqlite.exec("UPDATE quote_lead_delivery SET updated_at=0");
    await drainQuoteLeads();
    expect(mail).toHaveBeenCalledTimes(3);
    expect(mail.mock.calls[2][0].to).toBe(QUOTE_RECIPIENTS[1]);
    rawSqlite.exec("UPDATE quote_lead_delivery SET state='sending',updated_at=0");
    await drainQuoteLeads();
    expect(deliveries().map(x => x.state)).toEqual(["unknown", "unknown"]);
    expect(mail).toHaveBeenCalledTimes(3);
  });
  it("rolls back OTP consumption if durable capture fails", async () => {
    challenge();
    rawSqlite.exec("CREATE TEMP TRIGGER fail_lead BEFORE INSERT ON quote_lead BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    try {
      expect((await post("/api/quote/otp/verify", { email, code, contact })).status).toBe(500);
      expect(rawSqlite.prepare("SELECT verified FROM quote_otp").get()).toEqual({ verified: 0 });
      expect(mail).not.toHaveBeenCalled();
    } finally { rawSqlite.exec("DROP TRIGGER fail_lead"); }
    expect((await post("/api/quote/otp/verify", { email, code, contact })).status).toBe(200);
    await settled();
  });
  it("keeps old clients compatible and labels their missing contact fields honestly", async () => {
    challenge();
    expect((await post("/api/quote/otp/verify", { email, code })).status).toBe(200);
    await settled();
    expect(leads()[0].contact_json).toBeNull();
    expect(mail.mock.calls[0][0].text).toContain("Not supplied by this client version");
  });
  it("still sends a separate completed quotation with parts after the lead email", async () => {
    challenge();
    const verified = await post("/api/quote/otp/verify", { email, code, contact }); await settled();
    const r = await post("/api/quote/submit", { ...contact, email, timeframe: "immediate",
      request_key: "verified-lead-completed-quote", cart: [{ part_number: "00017", description: "Seal", qty: 2 }] },
      verified.data.verification_token);
    expect(r.status).toBe(200); expect(r.data.reference).toMatch(/^NM-Q-/);
    expect(mail.mock.calls.map(c => c[0].eventType).sort()).toEqual(["quote_submit", "quote_submit", "quote_verified_lead", "quote_verified_lead"]);
  });
  it("migrations are additive/idempotent and frontend sends contact at verification with disclosure", () => {
    const id = saveVerifiedQuoteLead(challenge(), email, contact, Date.now());
    runR28_6Migrations();
    expect(leads()[0].id).toBe(id);
    const source = readFileSync("client/src/pages/GetQuote.tsx", "utf8");
    expect(source).toContain('{ email: sentTo, code, contact }');
    expect(source).toContain("even if you do not finish the quotation");
  });
});
