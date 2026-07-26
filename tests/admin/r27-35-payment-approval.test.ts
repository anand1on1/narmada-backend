// R27.35 — payment approval flow.
//
// Slips over ₹5,000 stop at pending_approval and cannot be marked paid until
// narmadamobility123 (hardcoded username, not a role) releases them. Everything under
// the threshold auto-approves at generation exactly as R27.32-R27.33a did.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import {
  generateBatch, markPaid, bulkMarkPaid, markSkipped,
  approveBatch, rejectBatch, listApprovalBatches, countPendingApprovals,
  readBatchApproval, canApprovePayments, APPROVAL_THRESHOLD, APPROVER_USERNAME,
  type Actor,
} from "../../server/routes-payments";

const day = (d: string) => new Date(`${d}T09:00:00.000`).getTime();

// The approver, another admin, and a data_team member. Only `username` decides.
const OWNER: Actor = { userId: null, userName: "Piyush Anand", username: APPROVER_USERNAME };
const OTHER_ADMIN: Actor = { userId: null, userName: "Second Admin", username: "admin2" };
const TEAM_USER: Actor = { userId: 7, userName: "Data Team Member", username: "dt_ravi" };

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_32Migrations();
  migrations.runR27_33Migrations();
  migrations.runR27_33aMigrations();
  migrations.runR27_35Migrations();
});

function seedBase() {
  for (const t of ["payment_batch_items", "payment_batch_vendors", "payment_batches",
                   "po_item_vendor_quotes", "po_items", "purchase_orders_v2", "customers", "vendors"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table optional */ }
  }
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(42, "SRSC INFRA", day("2026-07-10"));
  db.prepare(`INSERT INTO purchase_orders_v2 (id, po_number, customer_id, status, total, created_at) VALUES (?,?,?,?,?,?)`)
    .run(184, "NM/PO/26/0099", 42, "approved", 45000, day("2026-07-10"));
}
beforeEach(seedBase);

// Small slip: 4 × 1000 = 4000, under the threshold.
function smallBatch(actor: Actor = TEAM_USER) {
  return generateBatch(db, { vendors: [{
    vendor_name: "Sharma Auto", items: [
      { po_id: 184, po_item_id: 601, item_name: "Brake Shoe", qty: 4, rate_locked: 1000 },
    ],
  }] }, actor);
}
// Large slip: 10 × 1200 = 12000, over the threshold.
function largeBatch(actor: Actor = TEAM_USER) {
  return generateBatch(db, { vendors: [{
    vendor_name: "Delhi Spares", items: [
      { po_id: 184, po_item_id: 602, item_name: "Clutch Plate", qty: 10, rate_locked: 1200 },
    ],
  }] }, actor);
}
const vendorIdsOf = (batchId: number): number[] =>
  (db.prepare(`SELECT id FROM payment_batch_vendors WHERE batch_id = ?`).all(batchId) as any[]).map((r) => r.id);

describe("R27.35 — threshold at generation", () => {
  it("slip at ₹4,000 auto-approves with approved_by=system and approved_at set", () => {
    const res = smallBatch();
    expect(res.approval_status).toBe("auto_approved");
    expect(res.grand_total_snapshot).toBe(4000);
    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(row.approval_status).toBe("auto_approved");
    expect(row.approved_by).toBe("system");
    expect(row.approved_at).toBeGreaterThan(0);
    expect(row.grand_total_snapshot).toBe(4000);
  });

  it("slip at ₹12,000 enters pending_approval with approved_at null", () => {
    const res = largeBatch();
    expect(res.approval_status).toBe("pending_approval");
    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(res.batch_id);
    expect(row.approval_status).toBe("pending_approval");
    expect(row.approved_at).toBeNull();
    expect(row.approved_by).toBeNull();
    expect(row.grand_total_snapshot).toBe(12000);
  });

  it("exactly ₹5,000 auto-approves — the gate is strictly greater than", () => {
    const res = generateBatch(db, { vendors: [{
      vendor_name: "Edge Case Traders",
      items: [{ po_id: 184, po_item_id: 603, item_name: "Filter", qty: 5, rate_locked: 1000 }],
    }] }, TEAM_USER);
    expect(res.grand_total_snapshot).toBe(APPROVAL_THRESHOLD);
    expect(res.approval_status).toBe("auto_approved");
  });

  it("threshold is measured on the GST-inclusive grand total, not the pre-tax subtotal", () => {
    // 4,500 subtotal + 18% = 5,310 — under the line before GST, over it after.
    const res = generateBatch(db, { vendors: [{
      vendor_name: "GST Vendor", gst_percent: 18, gst_mode: "exclusive",
      items: [{ po_id: 184, po_item_id: 604, item_name: "Bearing", qty: 3, rate_locked: 1500 }],
    }] }, TEAM_USER);
    expect(res.vendors[0].subtotal).toBe(4500);
    expect(res.grand_total_snapshot).toBe(5310);
    expect(res.approval_status).toBe("pending_approval");
  });

  it("sums across every vendor in the batch, not per vendor", () => {
    const res = generateBatch(db, { vendors: [
      { vendor_name: "A", items: [{ po_id: 184, po_item_id: 605, item_name: "X", qty: 1, rate_locked: 3000 }] },
      { vendor_name: "B", items: [{ po_id: 184, po_item_id: 606, item_name: "Y", qty: 1, rate_locked: 3000 }] },
    ] }, TEAM_USER);
    expect(res.grand_total_snapshot).toBe(6000);
    expect(res.approval_status).toBe("pending_approval");
  });

  it("an admin generating a large slip is gated too — same rule for everyone", () => {
    const res = largeBatch(OWNER);
    expect(res.approval_status).toBe("pending_approval");
  });
});

describe("R27.35 — who may approve", () => {
  it("canApprovePayments matches only narmadamobility123, case-insensitively", () => {
    expect(canApprovePayments("narmadamobility123")).toBe(true);
    expect(canApprovePayments("  NarmadaMobility123 ")).toBe(true);
    expect(canApprovePayments("admin")).toBe(false);
    expect(canApprovePayments("narmadamobility1234")).toBe(false);
    expect(canApprovePayments(undefined)).toBe(false);
    expect(canApprovePayments("")).toBe(false);
  });

  it("narmadamobility123 approves — status, approver and timestamp all recorded", () => {
    const { batch_id } = largeBatch();
    const out = approveBatch(db, batch_id, OWNER);
    expect(out.approval_status).toBe("approved");
    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(batch_id);
    expect(row.approval_status).toBe("approved");
    expect(row.approved_by).toBe(APPROVER_USERNAME);
    expect(row.approved_at).toBeGreaterThan(0);
  });

  it("another admin gets 403 and the batch is untouched", () => {
    const { batch_id } = largeBatch();
    expect(() => approveBatch(db, batch_id, OTHER_ADMIN)).toThrowError(/Only narmadamobility123/);
    try { approveBatch(db, batch_id, OTHER_ADMIN); } catch (e: any) { expect(e.status).toBe(403); }
    expect(readBatchApproval(db, batch_id).approval_status).toBe("pending_approval");
  });

  it("a data_team user gets 403 on both approve and reject", () => {
    const { batch_id } = largeBatch();
    expect(() => approveBatch(db, batch_id, TEAM_USER)).toThrowError(/Only narmadamobility123/);
    expect(() => rejectBatch(db, batch_id, "rates look wrong", TEAM_USER)).toThrowError(/Only narmadamobility123/);
    expect(readBatchApproval(db, batch_id).approval_status).toBe("pending_approval");
  });

  it("a batch cannot be decided twice", () => {
    const { batch_id } = largeBatch();
    approveBatch(db, batch_id, OWNER);
    let status = 0;
    try { approveBatch(db, batch_id, OWNER); } catch (e: any) { status = e.status; }
    expect(status).toBe(409);
  });

  it("an auto-approved batch is not decidable — it never entered the queue", () => {
    const { batch_id } = smallBatch();
    expect(() => approveBatch(db, batch_id, OWNER)).toThrowError(/already auto approved/);
  });

  it("a missing batch is a 404", () => {
    let status = 0;
    try { approveBatch(db, 99999, OWNER); } catch (e: any) { status = e.status; }
    expect(status).toBe(404);
  });
});

describe("R27.35 — rejection", () => {
  it("a reason under 5 characters is rejected and the batch stays pending", () => {
    const { batch_id } = largeBatch();
    for (const bad of ["", "   ", "no", "bad"]) {
      expect(() => rejectBatch(db, batch_id, bad, OWNER)).toThrowError(/at least 5 characters/);
    }
    expect(readBatchApproval(db, batch_id).approval_status).toBe("pending_approval");
  });

  it("a valid reason sets status, rejection_reason and the deciding user", () => {
    const { batch_id } = largeBatch();
    const out = rejectBatch(db, batch_id, "  Vendor rate is above the approved quote  ", OWNER);
    expect(out.approval_status).toBe("rejected");
    expect(out.rejection_reason).toBe("Vendor rate is above the approved quote");
    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(batch_id);
    expect(row.rejection_reason).toBe("Vendor rate is above the approved quote");
    expect(row.approved_by).toBe(APPROVER_USERNAME);
    expect(row.approved_at).toBeGreaterThan(0);
  });
});

describe("R27.35 — mark-paid gate", () => {
  it("blocked while the batch is pending_approval", () => {
    const { batch_id } = largeBatch();
    const [vid] = vendorIdsOf(batch_id);
    let status = 0;
    try { markPaid(db, vid, {}, TEAM_USER); } catch (e: any) { status = e.status; }
    expect(status).toBe(403);
    expect(() => markPaid(db, vid, {}, TEAM_USER)).toThrowError(/pending approval/);
    const v: any = db.prepare(`SELECT status FROM payment_batch_vendors WHERE id = ?`).get(vid);
    expect(v.status).toBe("pending");
  });

  it("blocked after rejection, with the rejection wording", () => {
    const { batch_id } = largeBatch();
    rejectBatch(db, batch_id, "duplicate of PMT/2026/0004", OWNER);
    const [vid] = vendorIdsOf(batch_id);
    expect(() => markPaid(db, vid, {}, TEAM_USER)).toThrowError(/rejected/);
  });

  it("allowed once approved", () => {
    const { batch_id } = largeBatch();
    approveBatch(db, batch_id, OWNER);
    const [vid] = vendorIdsOf(batch_id);
    const out = markPaid(db, vid, { proof_url: "/uploads/p.jpg" }, TEAM_USER);
    expect(out.status).toBe("paid");
    expect(out.paid_at).toBeGreaterThan(0);
  });

  it("allowed on an auto-approved batch — the small-slip path is unchanged", () => {
    const { batch_id } = smallBatch();
    const [vid] = vendorIdsOf(batch_id);
    expect(markPaid(db, vid, {}, TEAM_USER).status).toBe("paid");
  });

  it("bulk-mark-paid is gated too, and leaves nothing half-written", () => {
    const pending = largeBatch();
    const ok = smallBatch();
    const ids = [...vendorIdsOf(ok.batch_id), ...vendorIdsOf(pending.batch_id)];
    expect(() => bulkMarkPaid(db, ids, undefined, TEAM_USER)).toThrowError(/pending approval/);
    // The whole call is one transaction, so the auto-approved vendor rolls back with it.
    const rows = db.prepare(`SELECT status FROM payment_batch_vendors`).all() as any[];
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("bulk-mark-paid succeeds when every batch in the selection is cleared", () => {
    const a = smallBatch();
    const b = largeBatch();
    approveBatch(db, b.batch_id, OWNER);
    const n = bulkMarkPaid(db, [...vendorIdsOf(a.batch_id), ...vendorIdsOf(b.batch_id)], undefined, TEAM_USER);
    expect(n).toBe(2);
  });

  it("mark-skipped stays open on a pending batch — skipping is not paying", () => {
    const { batch_id } = largeBatch();
    const [vid] = vendorIdsOf(batch_id);
    expect(markSkipped(db, vid, "vendor on hold").status).toBe("skipped");
  });
});

describe("R27.35 — admin queue", () => {
  it("lists only pending batches by default, with vendors and line items expanded", () => {
    smallBatch();
    const big = largeBatch();
    const pending = listApprovalBatches(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].batch_id).toBe(big.batch_id);
    expect(pending[0].grand_total_snapshot).toBe(12000);
    expect(pending[0].vendor_count).toBe(1);
    expect(pending[0].generated_by).toBe("Data Team Member");
    expect(pending[0].vendors[0].items).toEqual([
      { po_number: "NM/PO/26/0099", item_name: "Clutch Plate", qty: 10, rate: 1200, amount: 12000 },
    ]);
  });

  it("filters by decided status and by all", () => {
    smallBatch();
    const b = largeBatch();
    rejectBatch(db, b.batch_id, "wrong vendor assigned", OWNER);
    expect(listApprovalBatches(db, "pending_approval")).toHaveLength(0);
    expect(listApprovalBatches(db, "rejected")).toHaveLength(1);
    expect(listApprovalBatches(db, "auto_approved")).toHaveLength(1);
    expect(listApprovalBatches(db, "all")).toHaveLength(2);
  });

  it("countPendingApprovals drives the sidebar badge", () => {
    expect(countPendingApprovals(db)).toBe(0);
    largeBatch();
    largeBatch();
    expect(countPendingApprovals(db)).toBe(2);
    approveBatch(db, listApprovalBatches(db)[0].batch_id, OWNER);
    expect(countPendingApprovals(db)).toBe(1);
  });
});

describe("R27.35 — retroactive backfill", () => {
  it("pre-R27.35 batches with a null approval_status become auto_approved", () => {
    // Simulate an R27.33 row: written before the column existed, so NULL after the ALTER.
    const now = day("2026-05-02");
    db.prepare(
      `INSERT INTO payment_batches (id, slip_number, created_by_name, created_at, vendor_count, po_count, total_amount, approval_status, grand_total_snapshot)
       VALUES (?,?,?,?,?,?,?,NULL,0)`,
    ).run(9001, "PMT/2026/9001", "Legacy User", now, 1, 1, 8800);
    db.prepare(
      `INSERT INTO payment_batch_vendors (batch_id, vendor_name, total_amount, status, total_with_gst)
       VALUES (?,?,?,'paid',?)`,
    ).run(9001, "Legacy Vendor", 8800, 8800);

    migrations.runR27_35Migrations();

    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = 9001`).get();
    expect(row.approval_status).toBe("auto_approved");
    // Over the threshold, but retroactively cleared — it was already paid.
    expect(row.grand_total_snapshot).toBe(8800);
    expect(readBatchApproval(db, 9001).approval_status).toBe("auto_approved");
  });

  it("backfills grand_total_snapshot from total_with_gst summed across vendors", () => {
    db.prepare(
      `INSERT INTO payment_batches (id, slip_number, created_at, vendor_count, po_count, total_amount, approval_status, grand_total_snapshot)
       VALUES (?,?,?,?,?,?,'auto_approved',0)`,
    ).run(9002, "PMT/2026/9002", day("2026-05-03"), 2, 1, 0);
    const ins = db.prepare(
      `INSERT INTO payment_batch_vendors (batch_id, vendor_name, total_amount, status, total_with_gst) VALUES (?,?,?,'pending',?)`,
    );
    ins.run(9002, "V1", 1180, 1180);
    ins.run(9002, "V2", 2360, 2360);

    migrations.runR27_35Migrations();

    const row: any = db.prepare(`SELECT grand_total_snapshot FROM payment_batches WHERE id = 9002`).get();
    expect(row.grand_total_snapshot).toBe(3540);
  });

  it("falls back to total_amount for R27.32 rows that predate total_with_gst", () => {
    db.prepare(
      `INSERT INTO payment_batches (id, slip_number, created_at, vendor_count, po_count, total_amount, approval_status, grand_total_snapshot)
       VALUES (?,?,?,?,?,?,'auto_approved',0)`,
    ).run(9003, "PMT/2026/9003", day("2026-05-04"), 1, 1, 0);
    db.prepare(
      `INSERT INTO payment_batch_vendors (batch_id, vendor_name, total_amount, status, total_with_gst) VALUES (?,?,?,'pending',NULL)`,
    ).run(9003, "Old Vendor", 750);

    migrations.runR27_35Migrations();

    const row: any = db.prepare(`SELECT grand_total_snapshot FROM payment_batches WHERE id = 9003`).get();
    expect(row.grand_total_snapshot).toBe(750);
  });

  it("re-running the migration does not re-decide an already approved batch", () => {
    const { batch_id } = largeBatch();
    approveBatch(db, batch_id, OWNER);
    migrations.runR27_35Migrations();
    const row: any = db.prepare(`SELECT * FROM payment_batches WHERE id = ?`).get(batch_id);
    expect(row.approval_status).toBe("approved");
    expect(row.approved_by).toBe(APPROVER_USERNAME);
  });

  it("all five columns exist after the migration", () => {
    const cols = (db.prepare(`PRAGMA table_info(payment_batches)`).all() as any[]).map((r) => r.name);
    for (const c of ["approval_status", "approved_by", "approved_at", "rejection_reason", "grand_total_snapshot"]) {
      expect(cols).toContain(c);
    }
  });
});
