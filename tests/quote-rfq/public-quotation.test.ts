import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
vi.mock("../../server/email", () => ({ sendGenericSalesEmail: vi.fn(async () => ({ ok: true })) }));
import { sendGenericSalesEmail } from "../../server/email";
import { rawSqlite } from "../../server/storage";
import { runR28_1Migrations, runR28_6Migrations } from "../../server/migrations";
import { registerQuoteRfqRoutes, __resetOtpRateLimiter } from "../../server/quote-rfq";
import { normalizeIndent, parseIndentSheet, __resetIndentLimits } from "../../server/quote-indent";
import { quoteDeliveryStatus, deliverQuote, QUOTE_RECIPIENTS } from "../../server/quote-delivery";
import { createHmac } from "node:crypto";

let server: any, base: string;
const email = "review@example.test";
const secret = "offline-quotation-test-secret-longer-than-32";
const mail = vi.mocked(sendGenericSalesEmail);
function token(address = email, exp = Date.now() + 60000) {
  const body = Buffer.from(JSON.stringify({ email: address, exp })).toString("base64url");
  return body + "." + createHmac("sha256", secret).update(body).digest("base64url");
}
const payload = (key = "idempotency-test-key-001") => ({ company_name: "Test company", contact_name: "Test contact", email,
  country: "IN", currency: "INR", country_code: "+91", mobile: "9876543210", timeframe: "immediate",
  request_key: key, cart: [{ part_number: "00120", description: "Filter", qty: 2 }] });
async function post(path: string, body: any, auth = token()) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": auth }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as any };
}
async function upload(name: string, bytes: Uint8Array, auth = token(), consent = true) {
  const data = new FormData(); if (consent) data.append("consent", "true"); data.append("file", new Blob([bytes]), name);
  const r = await fetch(base + "/api/quote/indent/parse", { method: "POST", headers: { "x-quote-token": auth }, body: data });
  return { status: r.status, data: await r.json() as any };
}
beforeAll(async () => {
  process.env.QUOTE_TOKEN_SECRET = secret; process.env.EMAIL_NOTIFICATIONS_ENABLED = "false";
  runR28_1Migrations(); runR28_6Migrations();
  const app = express(); app.set("trust proxy", 1); app.use(express.json({ limit: "1mb" })); registerQuoteRfqRoutes(app);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { __resetOtpRateLimiter(); __resetIndentLimits(); mail.mockReset(); mail.mockResolvedValue({ ok: true });
  rawSqlite.exec("DELETE FROM quote_delivery; DELETE FROM quote_request; DELETE FROM quote_otp;"); });
afterAll(() => server?.close());
describe("Bounded public quotation", () => {
  it("preserves exact strings, missing quantities, blank AI identifiers and scientific-number uncertainty", () => {
    const items = parseIndentSheet(Buffer.from("part_number,description,quantity\n00120,Filter,\n2.75225E+11,Pump,2"), "csv");
    expect(items[0]).toMatchObject({ part_number: "00120", qty: null, needs_review: true });
    expect(items[1]).toMatchObject({ part_number: "", qty: 2, needs_review: true });
    expect(normalizeIndent([{ part_number: null, name: "Valve", qty: null, price: 42 }])[0])
      .toEqual({ part_number: "", description: "Valve", qty: null, needs_review: true });
  });
  it("does not expand scientific XLSX cell formatting and rejects invalid UTF8 and row caps", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["part_number", "description", "quantity"], [275225000000, "Pump", 2]]);
    sheet.A2.z = "0.00000E+00";
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, "Items");
    expect(parseIndentSheet(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "xlsx")[0].part_number).toBe("");
    expect(() => parseIndentSheet(Buffer.from([255,254,0]), "csv")).toThrow(/UTF-8/);
    expect(() => parseIndentSheet(Buffer.from("part_number,qty\n" + "ABC,1\n".repeat(501)), "csv")).toThrow(/500/);
  });
  it("requires token and consent, accepts CSV/XLSX, rejects bytes and PDF page caps", async () => {
    const csv = Buffer.from("part_number,description,qty\n0007,Seal,3");
    expect((await upload("indent.csv", csv, "")).status).toBe(401);
    expect((await upload("indent.csv", csv, token(), false)).status).toBe(400);
    expect((await upload("indent.csv", csv)).data.items[0].part_number).toBe("0007");
    const pdf = await PDFDocument.create(); for (let i = 0; i < 6; i++) pdf.addPage();
    expect((await upload("indent.pdf", await pdf.save())).data.error).toMatch(/1 to 5/);
    expect((await upload("indent.jpg", csv)).status).toBe(400);
    expect((await upload("indent.csv", new Uint8Array(4 * 1024 * 1024 + 1), token("other@example.test"))).status).toBe(413);
    expect(mail).not.toHaveBeenCalled();
  });
  it("missing AI provider fails gracefully without paid calls and releases concurrency", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const r = await upload("indent.pdf", await pdf.save()); expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/manual|CSV|unavailable/i);
    expect((await upload("indent.csv", Buffer.from("part_number,qty\nA,1"))).status).toBe(200);
  });
  it("invalidates OTP after rejected or thrown send; never logs a code via API", async () => {
    mail.mockResolvedValueOnce({ ok: false, error: "SMTP not configured" });
    const r = await post("/api/quote/otp/send", { email }); expect(r.status).toBe(503);
    expect((rawSqlite.prepare("SELECT * FROM quote_otp").get() as any).expires_at).toBe(0);
    mail.mockRejectedValueOnce(new Error("offline transport exception"));
    expect((await post("/api/quote/otp/send", { email })).status).toBe(503);
    expect((rawSqlite.prepare("SELECT count(*) n FROM quote_otp WHERE verified=0 AND expires_at>0").get() as any).n).toBe(0);
    expect(JSON.stringify(r.data)).not.toMatch(/\b\d{6}\b/);
  });
  it("idempotently saves and sends ONLY fixed recipients; status polling never sends", async () => {
    const first = await post("/api/quote/submit", payload()); expect(first.status).toBe(200);
    expect(first.data.notification.state).toBe("sent");
    expect(mail.mock.calls.map(c => c[0].to)).toEqual([...QUOTE_RECIPIENTS]);
    const retry = await post("/api/quote/submit", payload()); expect(retry.data.reference).toBe(first.data.reference);
    const changed = payload(); changed.cart[0].qty = 3;
    expect((await post("/api/quote/submit", changed)).status).toBe(409);
    const id = (rawSqlite.prepare("SELECT id FROM quote_request").get() as any).id;
    quoteDeliveryStatus(id); quoteDeliveryStatus(id); await deliverQuote(id); expect(mail).toHaveBeenCalledTimes(2);
    expect((await fetch(base + `/api/quote/${first.data.reference}/status`, { headers: { "x-quote-token": token("wrong@example.test") } })).status).toBe(404);
  });
  it("saved requests survive SMTP exceptions and ambiguous sends are never resent", async () => {
    mail.mockRejectedValue(new Error("SMTP timeout"));
    const r = await post("/api/quote/submit", payload()); expect(r.status).toBe(200);
    expect(r.data.reference).toMatch(/^NM-Q-/); expect(r.data.notification.state).toBe("pending");
    const id = (rawSqlite.prepare("SELECT id FROM quote_request").get() as any).id;
    expect(quoteDeliveryStatus(id).recipients.map(r => r.state)).toEqual(["unknown", "unknown"]);
    await deliverQuote(id); expect(mail).toHaveBeenCalledTimes(2);
  });
  it("known unstarted sends have bounded retry cooldown and attempts", async () => {
    mail.mockResolvedValue({ ok: false, error: "SMTP not configured" });
    await post("/api/quote/submit", payload());
    const id = (rawSqlite.prepare("SELECT id FROM quote_request").get() as any).id;
    await deliverQuote(id); expect(mail).toHaveBeenCalledTimes(2);
    for (let i=0;i<4;i++) { rawSqlite.exec("UPDATE quote_delivery SET updated_at=0"); await deliverQuote(id); }
    expect(mail).toHaveBeenCalledTimes(6); expect(quoteDeliveryStatus(id).retryable).toBe(false);
  });
  it("requires valid token, quantities and bounded contact fields", async () => {
    expect((await post("/api/quote/submit", payload(), token(email, 1))).status).toBe(401);
    expect((await post("/api/quote/submit", { ...payload(), mobile: "x".repeat(10000) + "123456" })).status).toBe(400);
    expect((await post("/api/quote/submit", { ...payload(), country: "x".repeat(1000) })).status).toBe(400);
    expect((await post("/api/quote/submit", { ...payload(), cart: [{ part_number: "", description: "Seal", qty: 0 }] })).status).toBe(400);
    expect((await post("/api/quote/submit", { ...payload(), cart: [{ part_number: "", description: "Seal", qty: 2 }] })).status).toBe(200);
  });
});
