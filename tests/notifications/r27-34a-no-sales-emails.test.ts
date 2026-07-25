// R27.34a Bug 2 — no system-generated email may reach sales@narmadamobility.com.
// That inbox is human-only now; people reply from it manually. Customer, vendor and
// explicitly-configured admin recipients must keep working, and sales@ stays valid as
// the FROM address.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isSalesInbox, sendGenericEmail } from "../../server/notifications";
import { sendContactEmail } from "../../server/email";

const SALES = "sales@narmadamobility.com";

describe("isSalesInbox", () => {
  it("matches regardless of case or surrounding whitespace", () => {
    expect(isSalesInbox(SALES)).toBe(true);
    expect(isSalesInbox("sales@Narmadamobility.com")).toBe(true);
    expect(isSalesInbox("  SALES@NARMADAMOBILITY.COM  ")).toBe(true);
  });
  it("matches when sales@ is one of several recipients", () => {
    expect(isSalesInbox(["ops@narmadamobility.com", SALES])).toBe(true);
  });
  it("does not match other addresses", () => {
    expect(isSalesInbox("admin@narmadamobility.com")).toBe(false);
    expect(isSalesInbox("buyer@montecarlo.in")).toBe(false);
    expect(isSalesInbox(undefined)).toBe(false);
    expect(isSalesInbox([])).toBe(false);
  });
});

describe("sendGenericEmail drops sales@ before the transport", () => {
  const args = { subject: "Stale POs", html: "<p>x</p>", event: "po_reminder" };

  it("returns via:'disabled' for sales@", async () => {
    const r = await sendGenericEmail({ to: SALES, ...args });
    expect(r.ok).toBe(false);
    expect(r.via).toBe("disabled");
  });

  it("drops sales@ even when mixed with a valid recipient", async () => {
    const r = await sendGenericEmail({ to: ["admin@narmadamobility.com", SALES], ...args });
    expect(r.via).toBe("disabled");
  });

  it("does not write a notification log row for a dropped send", async () => {
    const { rawSqlite: db } = await import("../../server/storage");
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM notification_log`).get() as any).n;
    await sendGenericEmail({ to: SALES, ...args });
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM notification_log`).get() as any).n;
    expect(after).toBe(before);
  });

  it("leaves non-sales recipients on their normal path", async () => {
    // SMTP is unconfigured under test, so a permitted recipient reaches the transport
    // check and reports "smtp"/skipped — never the R27.34a "disabled" short-circuit.
    for (const to of ["buyer@montecarlo.in", "vendor@acme.co.in", "admin@narmadamobility.com"]) {
      const r = await sendGenericEmail({ to, ...args });
      expect(r.via).not.toBe("disabled");
    }
  });
});

describe("contact form no longer emails sales@", () => {
  const payload = {
    name: "Ravi Kumar", email: "ravi@example.com", phone: null, country: null,
    subject: "Spare parts quote", productInterest: null, message: "Need a quote.",
  };
  it("returns via:'disabled' and sends nothing", async () => {
    const r = await sendContactEmail(payload);
    expect(r.ok).toBe(false);
    expect(r.via).toBe("disabled");
  });
});

describe("no hardcoded sales@ fallback recipients remain", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("the admin sales digest has no default recipient", async () => {
    delete process.env.ADMIN_DIGEST_EMAIL;
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../server/sales-digest.ts", import.meta.url), "utf8"));
    expect(src).not.toMatch(/ADMIN_DIGEST_EMAIL\s*\|\|\s*["']sales@/i);
  });

  it("the ops reminder crons have no default recipient", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/ADMIN_REMINDER_EMAIL\s*=.*["']sales@/i);
  });

  it("the transfer-invoice admin mail has no default recipient", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../server/routes-v2.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/adminEmail\s*=.*["']sales@/i);
  });
});
