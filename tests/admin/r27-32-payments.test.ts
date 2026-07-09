// R27.32 — Process Payment backend.
//
// Exercises the pure logic layer in server/routes-payments.ts directly against a real
// SQLite DB (the project has no HTTP harness; existing suites test the same way):
// PO listing + filters, vendor aggregation from R9 quotes, batch generation with
// slip-number sequencing, the JPG/ZIP producer, the Assign-Payments mutations, and the
// role whitelist that authorizes the endpoints.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { isValidAdminRole } from "../../server/routes-v2";
import {
  hasPaymentAccess, PAYMENT_ROLES,
  formatINR,
  listPaymentPos, aggregateVendors,
  nextSlipNumber, generateBatch, generateBatchWithSlips,
  listBatchVendors, markPaid, markSkipped, bulkMarkPaid,
  type GenerateVendorInput, type Actor,
} from "../../server/routes-payments";

const ACTOR: Actor = { userId: null, userName: "Test Admin" };
const day = (d: string) => new Date(`${d}T09:00:00.000`).getTime();

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_32Migrations();
});

// Rebuild a clean fixture before every test so batch sequencing is deterministic.
function seedBase() {
  for (const t of ["payment_batch_items", "payment_batch_vendors", "payment_batches",
                   "po_item_vendor_quotes", "po_items", "purchase_orders_v2", "customers", "vendors"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(42, "SRSC INFRA", day("2026-06-21"));
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(43, "OTHER CLIENT", day("2026-05-01"));
  db.prepare(`INSERT INTO vendors (id, code, name, created_at) VALUES (?,?,?,?)`).run(1, "V-BOSCH", "Bosch India", 0);
  db.prepare(`INSERT INTO vendors (id, code, name, created_at) VALUES (?,?,?,?)`).run(2, "V-DELPHI", "Delphi", 0);

  const insPo = db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`);
  insPo.run(184, "NM/PO/26/0099", 42, "approved", 45000, day("2026-06-21"));
  insPo.run(185, "NM/PO/26/0102", 43, "draft", 5000, day("2026-05-01"));
  insPo.run(186, "NM/PO/26/0105", 42, "approved", 8000, day("2026-06-25"));

  const insItem = db.prepare(`INSERT INTO po_items (id, po_id, description, qty, purchase_cost) VALUES (?,?,?,?,?)`);
  insItem.run(601, 184, "Brake pad set", 2, 0);
  insItem.run(602, 184, "Oil filter", 1, 0);
  insItem.run(610, 185, "Clutch plate", 1, 0);
  insItem.run(620, 186, "Air filter", 4, 0);

  const insQuote = db.prepare(
    `INSERT INTO po_item_vendor_quotes (po_item_id, vendor_id, vendor_name, rate, status, received_at, approved_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  insQuote.run(601, 1, "Bosch India", 850, "approved", 1, 2);
  insQuote.run(602, 2, "Delphi", 300, "approved", 1, 2);
  insQuote.run(610, 1, "Bosch India", 5000, "approved", 1, 2);
  insQuote.run(620, 2, "Delphi", 200, "approved", 1, 2);
}

beforeEach(seedBase);

// Turn an aggregate() result into a generate() payload with rates locked at defaults.
function toGenerateInput(agg: { vendors: any[] }): GenerateVendorInput[] {
  return agg.vendors.map((v) => ({
    vendor_name: v.vendor_name,
    items: v.pos.flatMap((p: any) => p.items.map((it: any) => ({
      po_id: p.po_id,
      po_item_id: it.po_item_id,
      item_name: it.item_name,
      qty: it.qty,
      rate_locked: it.rate_default,
      amount_locked: it.amount,
    }))),
  }));
}

describe("R27.32 — rupee formatting", () => {
  it("formats with Indian grouping", () => {
    expect(formatINR(1700)).toBe("₹ 1,700.00");
    expect(formatINR(123456)).toBe("₹ 1,23,456.00");
    expect(formatINR(0)).toBe("₹ 0.00");
  });
});

describe("R27.32 — GET /api/payments/pos (listPaymentPos)", () => {
  it("(1) returns the PO list", () => {
    const rows = listPaymentPos(db);
    expect(rows.length).toBe(3);
    const po = rows.find((r) => r.id === 184)!;
    expect(po.po_number).toBe("NM/PO/26/0099");
    expect(po.client_name).toBe("SRSC INFRA");
    expect(po.total_amount).toBe(45000);
    expect(po.vendor_count).toBe(2);
    expect(po.already_in_batch).toBe(false);
  });

  it("(1b) filters by client_id", () => {
    const rows = listPaymentPos(db, { client_id: 42 });
    expect(rows.map((r) => r.id).sort()).toEqual([184, 186]);
  });

  it("(1c) filters by date range", () => {
    const rows = listPaymentPos(db, { date_from: "2026-06-01", date_to: "2026-06-30" });
    expect(rows.map((r) => r.id).sort()).toEqual([184, 186]);
  });

  it("(2) marks already_in_batch + last_batch_slip once a PO item is batched", () => {
    const agg = aggregateVendors(db, [184]);
    generateBatch(db, { vendors: toGenerateInput(agg) }, ACTOR);
    const rows = listPaymentPos(db);
    const po184 = rows.find((r) => r.id === 184)!;
    const po185 = rows.find((r) => r.id === 185)!;
    expect(po184.already_in_batch).toBe(true);
    expect(po184.last_batch_slip).toBe("PMT/2026/0001");
    expect(po185.already_in_batch).toBe(false);
    expect(po185.last_batch_slip).toBeNull();
  });
});

describe("R27.32 — POST /api/payments/aggregate", () => {
  it("(3) groups items by vendor + PO with R9 default rates", () => {
    const { vendors } = aggregateVendors(db, [184]);
    const bosch = vendors.find((v) => v.vendor_name === "Bosch India")!;
    const delphi = vendors.find((v) => v.vendor_name === "Delphi")!;
    expect(bosch.pos[0].po_number).toBe("NM/PO/26/0099");
    const brake = bosch.pos[0].items.find((i: any) => i.item_name === "Brake pad set");
    expect(brake.rate_default).toBe(850);
    expect(brake.amount).toBe(1700);
    expect(bosch.vendor_total).toBe(1700);
    expect(delphi.vendor_total).toBe(300);
    expect(bosch.already_processed).toBe(false);
  });

  it("(4) flags already_processed vendors with last_slip_number", () => {
    const agg = aggregateVendors(db, [184]);
    generateBatch(db, { vendors: toGenerateInput(agg) }, ACTOR);
    const { vendors } = aggregateVendors(db, [184]);
    const bosch = vendors.find((v) => v.vendor_name === "Bosch India")!;
    expect(bosch.already_processed).toBe(true);
    expect(bosch.last_slip_number).toBe("PMT/2026/0001");
    expect(bosch.last_batch_date).toBeTruthy();
  });
});

describe("R27.32 — POST /api/payments/generate", () => {
  it("(5) creates batch + item + vendor rows with slip PMT/2026/0001", () => {
    const agg = aggregateVendors(db, [184]);
    const res = generateBatch(db, { notes: "urgent", vendors: toGenerateInput(agg) }, ACTOR);
    expect(res.slip_number).toBe("PMT/2026/0001");

    const batch: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(batch.slip_number).toBe("PMT/2026/0001");
    expect(batch.notes).toBe("urgent");
    expect(batch.vendor_count).toBe(2);
    expect(batch.po_count).toBe(1);
    expect(batch.total_amount).toBe(2000); // 1700 + 300
    expect(batch.created_by_name).toBe("Test Admin");

    const items = db.prepare(`SELECT * FROM payment_batch_items WHERE batch_id = ?`).all(res.batch_id) as any[];
    expect(items.length).toBe(2);
    expect(items.every((i) => i.po_number === "NM/PO/26/0099")).toBe(true);

    const vendorRows = db.prepare(`SELECT * FROM payment_batch_vendors WHERE batch_id = ? ORDER BY vendor_name`).all(res.batch_id) as any[];
    expect(vendorRows.map((v) => v.vendor_name)).toEqual(["Bosch India", "Delphi"]);
    expect(vendorRows.every((v) => v.status === "pending")).toBe(true);
    expect(vendorRows[0].po_numbers).toBe("NM/PO/26/0099");
  });

  it("(6) slip number increments to 0002 on the second call in the same year", () => {
    const agg = aggregateVendors(db, [184]);
    const first = generateBatch(db, { vendors: toGenerateInput(agg) }, ACTOR);
    const second = generateBatch(db, { vendors: toGenerateInput(aggregateVendors(db, [185])) }, ACTOR);
    expect(first.slip_number).toBe("PMT/2026/0001");
    expect(second.slip_number).toBe("PMT/2026/0002");
    expect(nextSlipNumber(db)).toBe("PMT/2026/0003");
  });

  it("(7) generate produces a ZIP (PK header) with one JPG per vendor + correct names", () => {
    const agg = aggregateVendors(db, [184]);
    const { batch, files, zip } = generateBatchWithSlips(db, { vendors: toGenerateInput(agg) }, ACTOR);
    expect(files.length).toBe(2); // Bosch India + Delphi
    expect(files.map((f) => f.name).sort()).toEqual([
      "PMT-2026-0001_bosch-india.jpg",
      "PMT-2026-0001_delphi.jpg",
    ]);
    // Each entry is a real JPEG (SOI marker).
    expect(files[0].data.slice(0, 2).toString("hex")).toBe("ffd8");
    // ZIP local-file-header magic.
    expect(zip.slice(0, 2).toString("ascii")).toBe("PK");
    expect(batch.slip_number).toBe("PMT/2026/0001");
  });
});

describe("R27.32 — Assign Payments (batches queue)", () => {
  function makeBatch() {
    const agg = aggregateVendors(db, [184, 185]);
    return generateBatch(db, { vendors: toGenerateInput(agg) }, ACTOR);
  }

  it("(8) GET /api/payments/batches filters by status", () => {
    const res = makeBatch();
    const all = listBatchVendors(db, { status: "all" });
    expect(all.length).toBe(res.vendors.length);
    const bosch = res.vendors.find((v) => v.vendor_name === "Bosch India")!;
    markPaid(db, bosch.vendor_id, { paid_at: "2026-07-09" }, ACTOR);
    expect(listBatchVendors(db, { status: "paid" }).length).toBe(1);
    expect(listBatchVendors(db, { status: "pending" }).length).toBe(all.length - 1);
    // each row is joined with its slip number
    expect(all[0].slip_number).toBe("PMT/2026/0001");
  });

  it("(9) mark-paid updates status + paid_at", () => {
    const res = makeBatch();
    const v = res.vendors[0];
    const updated = markPaid(db, v.vendor_id, { paid_at: "2026-07-09", proof_url: "/uploads/x.jpg", notes: "done" }, ACTOR);
    expect(updated.status).toBe("paid");
    expect(updated.paid_at).toBe(new Date("2026-07-09T00:00:00.000").getTime());
    expect(updated.proof_url).toBe("/uploads/x.jpg");
    expect(updated.paid_by_name).toBe("Test Admin");
  });

  it("(10) mark-skipped requires a skip_reason", () => {
    const res = makeBatch();
    const v = res.vendors[0];
    expect(() => markSkipped(db, v.vendor_id, "")).toThrow(/skip_reason/i);
    const updated = markSkipped(db, v.vendor_id, "vendor disputed rate");
    expect(updated.status).toBe("skipped");
    expect(updated.skip_reason).toBe("vendor disputed rate");
  });

  it("(11) bulk-mark-paid marks multiple rows", () => {
    const res = makeBatch();
    const ids = res.vendors.map((v) => v.vendor_id);
    const n = bulkMarkPaid(db, ids, "2026-07-09", ACTOR);
    expect(n).toBe(ids.length);
    expect(listBatchVendors(db, { status: "paid" }).length).toBe(ids.length);
  });
});

describe("R27.32 — access control + finance role whitelist", () => {
  it("(12) sales role is denied payment access", () => {
    expect(hasPaymentAccess("sales")).toBe(false);
    expect(hasPaymentAccess("logistics")).toBe(false);
    expect(hasPaymentAccess(undefined)).toBe(false);
  });

  it("(13) admin + procurement + finance are granted payment access", () => {
    expect(hasPaymentAccess("admin")).toBe(true);
    expect(hasPaymentAccess("procurement")).toBe(true);
    expect(hasPaymentAccess("finance")).toBe(true);
    expect([...PAYMENT_ROLES].sort()).toEqual(["admin", "finance", "procurement"]);
  });

  it("(14) finance is accepted as a valid admin role + usable as a data_team_users.role", () => {
    expect(isValidAdminRole("finance")).toBe(true);
    expect(isValidAdminRole("procurement")).toBe(true);
    expect(isValidAdminRole("nonsense")).toBe(false);
    // free-text data_team_users.role accepts finance without a schema change
    db.prepare(
      `INSERT OR IGNORE INTO data_team_users (username, password_hash, name, role, active, created_at)
       VALUES (?,?,?,?,1,?)`,
    ).run("r2732_fin", "x:y", "Finance R2732", "finance", Date.now());
    const row: any = db.prepare(`SELECT role FROM data_team_users WHERE username = 'r2732_fin'`).get();
    expect(row.role).toBe("finance");
  });
});
