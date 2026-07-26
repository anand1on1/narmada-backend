// R27.34b Feature 2 — currency used to lock at save time. It is now switchable, which
// re-prices every line at the supplied rate and records who flipped it and when.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rawSqlite as db } from "../../server/storage";
import * as migrations from "../../server/migrations";
import { changeQuotationCurrency, getQuotationWithItems, convertAmount } from "../../server/storage-v2";

beforeAll(() => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) {
      try { (fn as () => void)(); } catch { /* later runners fill gaps */ }
    }
  }
  migrations.runR27_34bMigrations();
});

const QID = 7101;

beforeEach(() => {
  db.exec(`DELETE FROM quotation_items`);
  db.exec(`DELETE FROM quotations`);
  db.exec(`DELETE FROM customers`);
  db.prepare(`INSERT INTO customers (id, name, created_at) VALUES (?,?,?)`).run(901, "MONTE CARLO FASHIONS", Date.now());
  db.prepare(`INSERT INTO quotations (id, quote_no, customer_id, status, currency, fx_rate, subtotal, total_discount, total_tax, grand_total, created_at, updated_at)
              VALUES (?,?,?,?,'INR',1,10000,0,1800,11800,?,?)`)
    .run(QID, "NM/Q/26/7101", 901, "sent", Date.now(), Date.now());
  // One line: 1 x 10000 INR, no discount, 18% GST.
  db.prepare(`INSERT INTO quotation_items (quotation_id, line_no, part_number, product_name, qty, mrp, discount, gst_pct, line_total, created_at)
              VALUES (?,1,'TVS-BRK-9931','Brake Shoe Assembly',1,10000,0,18,10000,?)`).run(QID, Date.now());
});

describe("R27.34b — currency toggle on a saved quotation", () => {
  it("converts INR -> USD by dividing by the entered rate", async () => {
    const { quotation, items } = await changeQuotationCurrency(QID, "USD", 83.5, { type: "data_team", id: "4", name: "Ravi" });
    expect(quotation.currency).toBe("USD");
    expect(items[0].mrp).toBe(119.76);           // 10000 / 83.5
    expect(quotation.subtotal).toBe(119.76);
    expect(quotation.totalTax).toBe(21.56);      // 18%
    expect(quotation.grandTotal).toBe(141.32);
  });

  it("converts USD -> INR by multiplying by the entered rate", async () => {
    await changeQuotationCurrency(QID, "USD", 83.5);
    const back = await changeQuotationCurrency(QID, "INR", 83.5);
    expect(back.quotation.currency).toBe("INR");
    expect(back.items[0].mrp).toBe(9999.96);     // 119.76 * 83.5, rounding loss is real
    expect(back.quotation.grandTotal).toBe(11799.95);
  });

  it("stores the rate, the timestamp and the actor on the quotation", async () => {
    const before = Date.now() - 1;
    const { quotation } = await changeQuotationCurrency(QID, "USD", 83.5, { type: "data_team", id: "4", name: "Ravi" });
    expect(quotation.fxRate).toBe(83.5);
    expect(Number(quotation.currencyChangedAt)).toBeGreaterThanOrEqual(before);
    expect(quotation.currencyChangedBy).toBe("Ravi");
    // Switching back to INR neutralises the rate so the PDF drops the FX line.
    const back = await changeQuotationCurrency(QID, "INR", 83.5);
    expect(back.quotation.fxRate).toBe(1);
  });

  it("supports repeated changes, using the newest rate each time", async () => {
    await changeQuotationCurrency(QID, "USD", 100);
    let wi = await getQuotationWithItems(QID);
    expect(wi!.items[0].mrp).toBe(100);          // 10000 / 100

    await changeQuotationCurrency(QID, "INR", 100);
    wi = await getQuotationWithItems(QID);
    expect(wi!.items[0].mrp).toBe(10000);

    await changeQuotationCurrency(QID, "USD", 80);
    wi = await getQuotationWithItems(QID);
    expect(wi!.items[0].mrp).toBe(125);          // 10000 / 80
    expect(wi!.quotation.fxRate).toBe(80);
  });

  it("recalculates line totals as well as header totals", async () => {
    db.prepare(`UPDATE quotation_items SET discount = 10 WHERE quotation_id = ?`).run(QID);
    const { items, quotation } = await changeQuotationCurrency(QID, "USD", 83.5);
    expect(items[0].mrp).toBe(119.76);
    expect(items[0].lineTotal).toBe(107.78);     // 119.76 less 10%
    expect(quotation.totalDiscount).toBe(11.98);
  });

  it("converts every line of a multi-line quotation", async () => {
    db.prepare(`INSERT INTO quotation_items (quotation_id, line_no, part_number, product_name, qty, mrp, discount, gst_pct, line_total, created_at)
                VALUES (?,2,'BOSCH-FLT-220','Oil Filter',2,835,0,18,1670,?)`).run(QID, Date.now());
    const { items } = await changeQuotationCurrency(QID, "USD", 83.5);
    expect(items.map((i) => i.mrp)).toEqual([119.76, 10]);
  });

  it("rejects an invalid exchange rate", async () => {
    await expect(changeQuotationCurrency(QID, "USD", 0)).rejects.toThrow(/positive number/i);
    await expect(changeQuotationCurrency(QID, "USD", -5)).rejects.toThrow(/positive number/i);
    await expect(changeQuotationCurrency(QID, "USD", "abc" as any)).rejects.toThrow(/positive number/i);
    await expect(changeQuotationCurrency(QID, "USD", NaN)).rejects.toThrow(/positive number/i);
    // and nothing was written
    const wi = await getQuotationWithItems(QID);
    expect(wi!.quotation.currency).toBe("INR");
    expect(wi!.items[0].mrp).toBe(10000);
  });

  it("rejects an unsupported currency and a missing quotation", async () => {
    await expect(changeQuotationCurrency(QID, "GBP", 100)).rejects.toThrow(/Unsupported currency/i);
    await expect(changeQuotationCurrency(999999, "USD", 83.5)).rejects.toThrow(/not found/i);
  });

  it("writes an audit-log row for the change", async () => {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'quotation.change_currency'`).get() as any).n;
    await changeQuotationCurrency(QID, "USD", 83.5, { type: "data_team", id: "4", name: "Ravi" });
    const row = db.prepare(
      `SELECT * FROM audit_logs WHERE action = 'quotation.change_currency' ORDER BY id DESC LIMIT 1`).get() as any;
    expect((db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'quotation.change_currency'`).get() as any).n).toBe(before + 1);
    expect(row.entity_id).toBe(String(QID));
    expect(JSON.parse(row.before_json).currency).toBe("INR");
    expect(JSON.parse(row.after_json).currency).toBe("USD");
  });

  it("convertAmount is a no-op when the currency does not change", () => {
    expect(convertAmount(10000, "INR", "INR", 83.5)).toBe(10000);
  });
});
