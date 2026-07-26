// R27.34b Feature 1 — quotation search. Before this release listQuotations({ q })
// matched only quote_no and notes, so a user hunting for a part number they had quoted
// got nothing back. It now also reaches the customer and the line items.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { listQuotations } from "../../server/storage-v2";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_34bMigrations();
});

const T0 = new Date("2026-03-10T10:00:00Z").getTime();
const T1 = new Date("2026-05-20T10:00:00Z").getTime();

function insertQuote(id: number, quoteNo: string, customerId: number, status: string, createdAt: number, notes?: string) {
  db.prepare(`INSERT INTO quotations (id, quote_no, customer_id, status, currency, subtotal, total_discount, total_tax, grand_total, notes, created_at, updated_at)
              VALUES (?,?,?,?,'INR',0,0,0,0,?,?,?)`)
    .run(id, quoteNo, customerId, status, notes ?? null, createdAt, createdAt);
}
function insertItem(quotationId: number, lineNo: number, partNumber: string | null, productName: string, brand?: string, hsn?: string) {
  db.prepare(`INSERT INTO quotation_items (quotation_id, line_no, part_number, product_name, brand, hsn, qty, mrp, discount, gst_pct, line_total, created_at)
              VALUES (?,?,?,?,?,?,1,100,0,18,100,?)`)
    .run(quotationId, lineNo, partNumber, productName, brand ?? null, hsn ?? null, Date.now());
}

beforeEach(() => {
  db.exec(`DELETE FROM quotation_items`);
  db.exec(`DELETE FROM quotations`);
  db.exec(`DELETE FROM customers`);
  db.prepare(`INSERT INTO customers (id, name, customer_code, created_at) VALUES (?,?,?,?)`)
    .run(701, "MONTE CARLO FASHIONS", "NM/CUS/0701", Date.now());
  db.prepare(`INSERT INTO customers (id, name, customer_code, created_at) VALUES (?,?,?,?)`)
    .run(702, "KALINGA COMMERCIAL CORPORATION", "NM/CUS/0702", Date.now());

  insertQuote(5001, "NM/Q/26/1234", 701, "sent", T0, "urgent replacement");
  insertItem(5001, 1, "TVS-BRK-9931", "Brake Shoe Assembly", "TVS", "87141090");

  insertQuote(5002, "NM/Q/26/5678", 702, "draft", T1);
  insertItem(5002, 1, "BOSCH-FLT-220", "Oil Filter Cartridge", "BOSCH", "84212300");
  insertItem(5002, 2, "TVS-CLT-1102", "Clutch Plate", "TVS");

  insertQuote(5003, "NM/Q/26/9999", 701, "accepted", T1);
  insertItem(5003, 1, null, "Miscellaneous hardware", null);
});

describe("R27.34b — quotation search", () => {
  it("matches on the quotation number", async () => {
    const { rows, total } = await listQuotations({ q: "26/5678" });
    expect(total).toBe(1);
    expect(rows[0].quoteNo).toBe("NM/Q/26/5678");
  });

  it("matches on the customer name, case-insensitively", async () => {
    const { rows } = await listQuotations({ q: "kalinga" });
    expect(rows.map((r) => r.quoteNo)).toEqual(["NM/Q/26/5678"]);
  });

  it("matches on the customer code", async () => {
    const { total } = await listQuotations({ q: "NM/CUS/0702" });
    expect(total).toBe(1);
  });

  it("matches on a line-item part number", async () => {
    const { rows } = await listQuotations({ q: "BOSCH-FLT-220" });
    expect(rows.map((r) => r.quoteNo)).toEqual(["NM/Q/26/5678"]);
  });

  it("matches on a line-item product name / description", async () => {
    const { rows } = await listQuotations({ q: "brake shoe" });
    expect(rows.map((r) => r.quoteNo)).toEqual(["NM/Q/26/1234"]);
  });

  it("matches on a line-item brand and HSN", async () => {
    expect((await listQuotations({ q: "87141090" })).total).toBe(1);
    // TVS appears on a line of both 5001 and 5002 — and 5002 has two TVS-ish lines,
    // which must not duplicate the row.
    const { rows, total } = await listQuotations({ q: "TVS" });
    expect(total).toBe(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("still matches on notes", async () => {
    expect((await listQuotations({ q: "urgent" })).total).toBe(1);
  });

  it("returns an empty set gracefully for a term nothing matches", async () => {
    const { rows, total, totalUnfiltered } = await listQuotations({ q: "zzz-no-such-part" });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(totalUnfiltered).toBe(3);
  });

  it("reports the unfiltered total for 'Showing X of Y'", async () => {
    const { total, totalUnfiltered } = await listQuotations({ q: "TVS" });
    expect(total).toBe(2);
    expect(totalUnfiltered).toBe(3);
  });

  it("combines text search with status, customer and date filters", async () => {
    // TVS matches 5001 (sent, Mar, MONTE CARLO) and 5002 (draft, May, KALINGA).
    expect((await listQuotations({ q: "TVS", status: "draft" })).total).toBe(1);
    expect((await listQuotations({ q: "TVS", customerId: 701 })).total).toBe(1);
    expect((await listQuotations({
      q: "TVS",
      fromDate: new Date("2026-05-01T00:00:00Z").getTime(),
      toDate: new Date("2026-05-31T23:59:59Z").getTime(),
    })).total).toBe(1);
    // All four at once, mutually consistent -> the one row.
    const { rows } = await listQuotations({
      q: "clutch", status: "draft", customerId: 702,
      fromDate: new Date("2026-05-01T00:00:00Z").getTime(),
      toDate: new Date("2026-05-31T23:59:59Z").getTime(),
    });
    expect(rows.map((r) => r.quoteNo)).toEqual(["NM/Q/26/5678"]);
    // Contradictory combination -> empty, not an error.
    expect((await listQuotations({ q: "clutch", status: "accepted" })).total).toBe(0);
  });

  it("filters without a search term exactly as before", async () => {
    expect((await listQuotations({})).total).toBe(3);
    expect((await listQuotations({ status: "sent" })).total).toBe(1);
    expect((await listQuotations({ customerId: 701 })).total).toBe(2);
  });

  it("excludes soft-deleted quotations from both the match and the denominator", async () => {
    db.prepare(`UPDATE quotations SET deleted_at = ? WHERE id = ?`).run(Date.now(), 5002);
    const { total, totalUnfiltered } = await listQuotations({ q: "TVS" });
    expect(total).toBe(1);
    expect(totalUnfiltered).toBe(2);
  });
});
