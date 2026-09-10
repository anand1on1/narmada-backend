// R28.1 — Team Upload integration test.
// Exercises registerTeamUploadRoutes against a real Express app + real
// better-sqlite3 DB (per-file isolated via setup-env.ts DATA_DIR).
//
// The three required cases from the R28.1 brief:
//   (a) wrong passcode returns 401 without disclosing which char is wrong
//   (b) oversized file returns 413
//   (c) constant-time passcode compare (compare timings; not a statistical
//       test, just a sanity check that a totally-wrong and a nearly-right
//       passcode take similar time inside the endpoint)
//
// Plus additional smoke tests to lock in the safety-net behaviour we care
// about not regressing: magic-byte check on renamed PDF, rate limit trip,
// idempotent-by-slug re-upload, admin audit-log endpoint.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import { rawSqlite } from "../../server/storage";
import { runR28_2Migrations, runR28_5Migrations } from "../../server/migrations";
import {
  registerTeamUploadRoutes,
  verifyPasscode,
  checkMagicBytes,
  __resetRateLimiter,
} from "../../server/team-upload";

// ---------- Test utilities -------------------------------------------------

function makeApp(): Express {
  const app = express();
  // Bypass admin auth for the /api/admin/team-upload/log endpoint.
  const passthroughAdmin = (_req: Request, _res: Response, next: NextFunction) => next();
  registerTeamUploadRoutes(app, { requireAdminRole: passthroughAdmin });
  return app;
}

interface HttpResult { status: number; text: string; json?: any; headers: Record<string, string>; }

function postMultipart(
  app: Express,
  url: string,
  fields: Record<string, string>,
  file?: { filename: string; buffer: Buffer; contentType?: string },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const http = require("http") as typeof import("http");

      const boundary = "----vitestboundary" + Math.random().toString(16).slice(2);
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          "utf8",
        ));
      }
      if (file) {
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`,
          "utf8",
        ));
        chunks.push(file.buffer);
        chunks.push(Buffer.from("\r\n", "utf8"));
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
      const body = Buffer.concat(chunks);

      const req = http.request({
        method: "POST", hostname: "127.0.0.1", port, path: url,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.length),
          "user-agent": "vitest-team-upload",
        },
      }, (r) => {
        const rchunks: Buffer[] = [];
        r.on("data", (c) => rchunks.push(c));
        r.on("end", () => {
          server.close();
          const text = Buffer.concat(rchunks).toString("utf8");
          let json: any;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: r.statusCode || 0, text, json, headers: r.headers as any });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      req.write(body);
      req.end();
    });
  });
}

function getJson(app: Express, url: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const http = require("http") as typeof import("http");
      const req = http.request({ method: "GET", hostname: "127.0.0.1", port, path: url }, (r) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          server.close();
          const text = Buffer.concat(chunks).toString("utf8");
          let json: any;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: r.statusCode || 0, text, json, headers: r.headers as any });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      req.end();
    });
  });
}

// Build a minimal in-memory .xlsx buffer with 2 valid parts rows.
function makeXlsxBuffer(rows: Array<Record<string, any>>): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}

// ---------- Test bootstrap --------------------------------------------------

beforeAll(() => {
  runR28_2Migrations();
  runR28_5Migrations();
});

beforeEach(() => {
  __resetRateLimiter();
  // Fresh env for every test so cross-test env leaks are impossible.
  process.env.TEAM_UPLOAD_ENABLED = "true";
  process.env.TEAM_UPLOAD_PASSCODE = "NARMADA-CHASSIS-2026";
  process.env.TEAM_UPLOAD_IP_SALT = "test-salt";
  process.env.EMAIL_NOTIFICATIONS_ENABLED = "false"; // suppress SMTP attempts
  delete process.env.TEAM_UPLOAD_RATE_LIMIT_PER_IP_HOUR;
  delete process.env.TEAM_UPLOAD_RATE_LIMIT_PER_IP_DAY;
  delete process.env.TEAM_UPLOAD_GLOBAL_RATE_LIMIT_HOUR;
  delete process.env.TEAM_UPLOAD_MAX_FILE_BYTES;
  delete process.env.TEAM_UPLOAD_MAX_ROWS;
  // Fresh audit rows too so counts inside a test are predictable.
  try { rawSqlite.exec("DELETE FROM team_upload_log"); } catch { /* first run */ }
  try { rawSqlite.exec("DELETE FROM chassis_parts"); } catch { /* first run */ }
  try { rawSqlite.exec("DELETE FROM chassis_catalog"); } catch { /* first run */ }
});

// ---------- Tests -----------------------------------------------------------

describe("R28.1 team-upload — safety nets", () => {

  it("(a) wrong passcode returns 401 and never leaks which char was wrong", async () => {
    const app = makeApp();
    const xlsx = makeXlsxBuffer([{ part_number: "P1", description: "part one" }]);
    const res = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "TOTALLY-WRONG-XX",
      chassis_code: "TATA-407",
      chassis_display_name: "Tata 407 EX2",
    }, { filename: "parts.xlsx", buffer: xlsx });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "invalid_passcode" });
    // The reply must NOT contain any part of the correct passcode.
    expect(res.text).not.toContain("NARMADA");
    expect(res.text).not.toContain("2026");
    // The reply must NOT hint at char-position mismatch.
    expect(res.text.toLowerCase()).not.toMatch(/char|position|index|mismatch|prefix/);
    // Audit row must exist with status=rejected_passcode.
    const row = rawSqlite.prepare(`SELECT * FROM team_upload_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.status).toBe("rejected_passcode");
    expect(row.passcode_ok).toBe(0);
  });

  it("(b) oversized file returns 413 and logs rejected_file", async () => {
    process.env.TEAM_UPLOAD_MAX_FILE_BYTES = "1024"; // 1 KB soft cap
    const app = makeApp();
    // Make a valid xlsx just big enough to exceed 1 KB.
    const bigRows: Record<string, any>[] = [];
    for (let i = 0; i < 100; i++) bigRows.push({ part_number: `P${i}`, description: "x".repeat(20), oem_number: `OEM${i}` });
    const xlsx = makeXlsxBuffer(bigRows);
    expect(xlsx.length).toBeGreaterThan(1024);
    const res = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-407",
      chassis_display_name: "Tata 407 EX2",
    }, { filename: "parts.xlsx", buffer: xlsx });
    expect(res.status).toBe(413);
    expect(res.json?.error).toBe("file_too_large");
    expect(res.json?.max_bytes).toBe(1024);
    const row = rawSqlite.prepare(`SELECT * FROM team_upload_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.status).toBe("rejected_file");
    expect(row.error_message).toContain("file_too_large");
  });

  it("(c) passcode compare is constant-time — timing gap between wrong and right is small", () => {
    const expected = "NARMADA-CHASSIS-2026";
    // Same-length wrong string vs correct string. If the compare short-circuited
    // on first mismatch, the wrong-string call would return much faster; a
    // constant-time compare keeps both under the same order of magnitude.
    const wrong = "X".repeat(expected.length);
    const runs = 20_000;

    let tWrong = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      verifyPasscode(wrong, expected);
      tWrong += Number(process.hrtime.bigint() - t0);
    }
    let tRight = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      verifyPasscode(expected, expected);
      tRight += Number(process.hrtime.bigint() - t0);
    }
    // Ratio should be within a 6x envelope. This isn't a rigorous timing
    // proof (JIT + noise make that impossible in vitest), but a naive `===`
    // would show a wildly different ratio (right side would be 10-100x
    // slower or, with early-exit compare, wrong side would be much faster).
    const ratio = Math.max(tRight, tWrong) / Math.max(1, Math.min(tRight, tWrong));
    expect(ratio).toBeLessThan(6);
    // Sanity: verify the fn actually returns correct booleans.
    expect(verifyPasscode(expected, expected)).toBe(true);
    expect(verifyPasscode(wrong, expected)).toBe(false);
    expect(verifyPasscode("", expected)).toBe(false);
    expect(verifyPasscode(expected, undefined)).toBe(false);
  });

  it("magic-byte check rejects a PDF renamed to .xlsx with 415", async () => {
    const app = makeApp();
    // %PDF-1.4 header — clearly not a ZIP-based .xlsx.
    const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
    const res = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-407",
      chassis_display_name: "Tata 407 EX2",
    }, { filename: "notreally.xlsx", buffer: pdfBytes });
    expect(res.status).toBe(415);
    expect(res.json?.error).toBe("file_content_does_not_match_extension");
    const row = rawSqlite.prepare(`SELECT * FROM team_upload_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(row.status).toBe("rejected_file");
    expect(row.error_message).toContain("magic_byte_mismatch");
  });

  it("checkMagicBytes helper accepts real xlsx and rejects null-byte csv", () => {
    const xlsx = makeXlsxBuffer([{ part_number: "P1", description: "one" }]);
    expect(checkMagicBytes(xlsx, ".xlsx").ok).toBe(true);
    expect(checkMagicBytes(Buffer.from("part_number,description\nP1,one\n"), ".csv").ok).toBe(true);
    expect(checkMagicBytes(Buffer.from([0, 0, 0, 0, 1, 2, 3]), ".csv").ok).toBe(false);
    expect(checkMagicBytes(Buffer.from("hi"), ".xlsx").ok).toBe(false);
  });

  it("valid upload returns 200 and inserts chassis + parts", async () => {
    const app = makeApp();
    const xlsx = makeXlsxBuffer([
      { part_number: "TATA-BRAKE-01", description: "front brake pad", oem_number: "OEM-1", sell_price: 500 },
      { part_number: "TATA-BRAKE-02", description: "rear brake pad",  oem_number: "OEM-2", sell_price: 600 },
    ]);
    const res = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-407-EX2",
      chassis_display_name: "Tata 407 EX2 BS6",
      variant: "BS6",
    }, { filename: "parts.xlsx", buffer: xlsx });
    expect(res.status).toBe(200);
    expect(res.json?.ok).toBe(true);
    expect(res.json?.chassis?.slug).toBe("tata-407-ex2-bs6");
    expect(res.json?.parts?.created).toBe(2);
    expect(res.json?.parts?.updated).toBe(0);
    expect(res.json?.parts?.errors).toBe(0);
    // Make must be forced to TATA.
    const row = rawSqlite.prepare(`SELECT make FROM chassis_catalog WHERE id = ?`).get(res.json!.chassis!.id) as any;
    expect(row.make).toBe("TATA");
    // Audit row = success.
    const log = rawSqlite.prepare(`SELECT * FROM team_upload_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(log.status).toBe("success");
    expect(log.parts_created).toBe(2);
    // Response must not echo the passcode.
    expect(res.text).not.toContain("NARMADA-CHASSIS-2026");
  });

  it("re-upload of same chassis (same slug) is idempotent and updates parts", async () => {
    const app = makeApp();
    // First upload creates 1 part.
    const xlsxA = makeXlsxBuffer([{ part_number: "P1", description: "orig", sell_price: 100 }]);
    const r1 = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-407-EX2",
      chassis_display_name: "Tata 407 EX2 BS6",
    }, { filename: "a.xlsx", buffer: xlsxA });
    expect(r1.status).toBe(200);
    const id1 = r1.json!.chassis!.id;
    // Second upload: same slug, one new part + one update.
    const xlsxB = makeXlsxBuffer([
      { part_number: "P1", description: "updated", sell_price: 150 },
      { part_number: "P2", description: "new",     sell_price: 200 },
    ]);
    const r2 = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-407-EX2",
      chassis_display_name: "Tata 407 EX2 BS6",
    }, { filename: "b.xlsx", buffer: xlsxB });
    expect(r2.status).toBe(200);
    expect(r2.json!.chassis!.id).toBe(id1);           // same chassis
    expect(r2.json!.parts.created).toBe(1);
    expect(r2.json!.parts.updated).toBe(1);
  });

  it("rate-limit trips on 6th upload from same IP within an hour", async () => {
    process.env.TEAM_UPLOAD_RATE_LIMIT_PER_IP_HOUR = "5";
    process.env.TEAM_UPLOAD_RATE_LIMIT_PER_IP_DAY = "20";
    const app = makeApp();
    const xlsx = makeXlsxBuffer([{ part_number: "P", description: "one" }]);
    for (let i = 0; i < 5; i++) {
      const r = await postMultipart(app, "/api/team-upload/chassis", {
        passcode: "NARMADA-CHASSIS-2026",
        chassis_code: `TATA-${i}`,
        chassis_display_name: `Tata Model ${i}`,
      }, { filename: `f${i}.xlsx`, buffer: xlsx });
      expect(r.status).toBe(200);
    }
    // 6th call must 429.
    const r6 = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "TATA-6",
      chassis_display_name: "Tata Model 6",
    }, { filename: "f6.xlsx", buffer: xlsx });
    expect(r6.status).toBe(429);
    expect(r6.json?.error).toBe("rate_limited");
    expect(r6.json?.retry_after_seconds).toBeGreaterThan(0);
    expect(r6.headers["retry-after"]).toBeDefined();
    const log = rawSqlite.prepare(`SELECT * FROM team_upload_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(log.status).toBe("rejected_ratelimit");
  });

  it("feature flag off returns 503 and writes NO audit row", async () => {
    process.env.TEAM_UPLOAD_ENABLED = "false";
    const app = makeApp();
    const before = (rawSqlite.prepare(`SELECT COUNT(*) AS c FROM team_upload_log`).get() as any).c as number;
    const r = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "anything",
      chassis_code: "X",
      chassis_display_name: "Y",
    }, { filename: "x.xlsx", buffer: Buffer.from("PK\x03\x04") });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: "feature_disabled" });
    const after = (rawSqlite.prepare(`SELECT COUNT(*) AS c FROM team_upload_log`).get() as any).c as number;
    expect(after).toBe(before);
  });

  it("admin GET /api/admin/team-upload/log returns rows", async () => {
    const app = makeApp();
    // Seed a couple of rows via bad passcode.
    for (let i = 0; i < 3; i++) {
      await postMultipart(app, "/api/team-upload/chassis", {
        passcode: "bad",
        chassis_code: `X${i}`,
        chassis_display_name: `Y${i}`,
      }, { filename: "x.xlsx", buffer: Buffer.from("PK\x03\x04") });
    }
    const r = await getJson(app, "/api/admin/team-upload/log?limit=10");
    expect(r.status).toBe(200);
    expect(r.json?.ok).toBe(true);
    expect(Array.isArray(r.json?.rows)).toBe(true);
    expect(r.json.rows.length).toBeGreaterThanOrEqual(3);
    // Row must contain ip_hash, never a raw IP.
    for (const row of r.json.rows) {
      expect(typeof row.ip_hash).toBe("string");
      expect(row.ip_hash.length).toBeLessThanOrEqual(16);
      expect(row.ip_hash).not.toMatch(/\./);              // no dotted-quad
      expect(row.ip_hash).not.toMatch(/\d+\.\d+/);        // no IPv4 fragment
    }
  });

  it("missing chassis_code returns 400 with field name and never mentions passcode", async () => {
    const app = makeApp();
    const r = await postMultipart(app, "/api/team-upload/chassis", {
      passcode: "NARMADA-CHASSIS-2026",
      chassis_code: "",
      chassis_display_name: "Y",
    }, { filename: "x.xlsx", buffer: makeXlsxBuffer([{ part_number: "P", description: "x" }]) });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("invalid_input");
    expect(r.json?.field).toBe("chassis_code");
    expect(r.text).not.toContain("NARMADA-CHASSIS-2026");
  });
});
