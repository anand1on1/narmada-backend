import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { loadImage } from "canvas";
import { rawSqlite as db, storage } from "../../server/storage";
import * as migrations from "../../server/migrations";
import * as v2 from "../../server/storage-v2";
import { requireDataTeam } from "../../server/routes-v2";
import { autoPublishFromPO } from "../../server/auto-publish";
import { parseProductPage, productsListHandler } from "../../server/product-pagination";
import { collectOrderSlips, buildOrderSlipZip, validateOrderSlipIds, renderOrderSlipImages, registerOrderSlipRoutes } from "../../server/order-slips";

vi.mock("../../server/part-image-gen", () => ({ getRepresentationalImage: vi.fn(async () => ({ url: "/images/placeholder-part.jpg", source: "placeholder" })) }));
vi.mock("../../server/email", () => ({ sendGenericSalesEmail: vi.fn(async () => ({})) }));
let server: Server, origin: string, token: string;
beforeAll(async () => {
  for (const [name, fn] of Object.entries(migrations)) {
    if (typeof fn === "function" && /^run/.test(name)) { try { (fn as () => void)(); } catch {} }
  }
  const user = await v2.createDataTeamUser({ username: "slip-test", passwordHash: "unused", name: "Fixture", role: "data_team" } as any);
  token = (await v2.createDataTeamSession(user.id)).token;
  const app = express(); app.use(express.json());
  app.get("/api/products", productsListHandler(storage));
  registerOrderSlipRoutes(app, db, requireDataTeam);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  process.env.AUTO_PUBLISH_ENABLED = "true";
  for (const table of ["auto_publish_log", "products", "po_item_vendor_quotes", "po_items", "purchase_orders_v2", "vendors"]) db.exec(`DELETE FROM ${table}`);
  db.prepare("INSERT INTO vendors (id,code,name,created_at) VALUES (1,'V1','Vendor / One',0),(2,'V2','Vendor - One',0)").run();
  db.prepare("INSERT INTO purchase_orders_v2 (id,po_number,status,created_at) VALUES (1,'SECRET/NM/2026/0123','draft',0),(2,'SECRET/NM/2026/0456','fulfilled',0)").run();
  db.prepare(`INSERT INTO po_items (id,po_id,part_number,description,qty,unit_price,purchase_cost,vendor_id,original_qty)
    VALUES (1,1,'TEST-1','Oil filter',2.5,100,80,1,99),(2,2,'TEST-2','Oil filter',3,100,80,1,NULL),
    (3,1,'TEST-3','Unassigned',1,100,80,NULL,NULL)`).run();
});
const exportRequest = (body: unknown, auth = token) => fetch(`${origin}/api/team/purchase-orders/order-slips`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { "x-team-token": auth } : {}) }, body: JSON.stringify(body),
});

describe("R28.17 sanitized order slips", () => {
  it("can search any PO by its stored PO number without a customer PO reference", async () => {
    expect((await v2.listPurchaseOrdersV2WithTotals({ q: "SECRET/NM/2026/0123" })).map(p => p.id)).toEqual([1]);
  });
  it("requires the real team session guard", async () => {
    expect((await exportRequest({ poIds: [1] }, "")).status).toBe(401);
    expect((await exportRequest({ poIds: [1] }, "invalid")).status).toBe(401);
    expect((await exportRequest({ poIds: [1] })).status).toBe(200);
  });
  it.each([[], [0], ["1"], [-1], [1.5], [null], Array(101).fill(1)])("rejects invalid/big batches %j", value => {
    expect(() => validateOrderSlipIds(value)).toThrow();
  });
  it("validates existence and rejects deleted POs", async () => {
    expect((await exportRequest({ poIds: [999] })).status).toBe(404);
    db.prepare("UPDATE purchase_orders_v2 SET deleted_at=1 WHERE id=1").run();
    expect((await exportRequest({ poIds: [1] })).status).toBe(404);
  });
  it("groups across all statuses without merging PO lines or inventing quantity", () => {
    const payload = collectOrderSlips(db, [1, 2, 1]);
    expect(payload.vendors).toEqual([{ vendorName: "Vendor / One", rows: [
      { productName: "Oil filter", poLastFour: "0123", quantity: 2.5 },
      { productName: "Oil filter", poLastFour: "0456", quantity: 3 },
    ] }]);
    expect(payload.warnings[0]).toContain("1 line(s) excluded");
    expect(JSON.stringify(payload)).not.toMatch(/SECRET|customer|address|rate|price|total|payment/i);
  });
  it("uses the approved vendor and excludes deleted lines", () => {
    db.exec("UPDATE po_items SET approved_vendor_id=2 WHERE id=1; UPDATE po_items SET deleted_at=1 WHERE id=2");
    expect(collectOrderSlips(db, [1, 2]).vendors.map(v => v.vendorName)).toEqual(["Vendor - One"]);
  });
  it("warns instead of guessing when vendor quantity is zero or negative", () => {
    db.exec("UPDATE po_items SET qty=0 WHERE id=1; UPDATE po_items SET qty=-1 WHERE id=2");
    const payload = collectOrderSlips(db, [1, 2]);
    expect(payload.vendors).toEqual([]);
    expect(payload.warnings.join(" ")).toContain("2 line(s) excluded: quantity");
  });
  it("exports unique safe filenames and leaves PO and payment state unchanged", async () => {
    db.exec("UPDATE po_items SET vendor_id=2 WHERE id=2");
    const before = db.prepare("SELECT * FROM purchase_orders_v2").all();
    const payload = collectOrderSlips(db, [1, 2]);
    const { files, zip } = buildOrderSlipZip(payload);
    expect(new Set(files.map(f => f.name)).size).toBe(files.length);
    expect(files.every(f => /^[a-z0-9.-]+$/.test(f.name))).toBe(true);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const response = await exportRequest({ poIds: [1, 2], format: "zip" });
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(db.prepare("SELECT * FROM purchase_orders_v2").all()).toEqual(before);
  });
  it("splits long vendor lists into bounded images without losing rows", async () => {
    const images = renderOrderSlipImages({ vendorName: "Vendor", rows: Array.from({ length: 100 }, () => ({
      productName: "Long filter name ".repeat(12), poLastFour: "0123", quantity: 4,
    })) });
    expect(images.length).toBeGreaterThan(2);
    for (const image of images) expect((await loadImage(image)).height).toBeLessThanOrEqual(1600);
  });
});

describe("R28.17 public SQL pagination", () => {
  beforeEach(() => {
    const insert = db.prepare(`INSERT INTO products (slug,name,brand,category,description,price_inr,active,created_at,oem_number) VALUES (?,?,?,'filter','description',?,1,0,?)`);
    for (let i = 0; i < 125; i++) insert.run(`fixture-${i}`, `Filter ${i}`, i % 2 ? "tata" : "volvo", i === 124 ? 0 : 100, `OEM-${i}`);
  });
  it.each(["0", "-1", "NaN", "Infinity", "2.5", "2oops", "1e3", "9007199254740992"])("rejects malformed page and limit %s", async value => {
    expect((await fetch(`${origin}/api/products?page=${value}`)).status).toBe(400);
    expect((await fetch(`${origin}/api/products?limit=${value}`)).status).toBe(400);
  });
  it("caps page size, rejects arrays/unsafe offsets", () => {
    expect(parseProductPage({ page: "1", limit: "999" })?.limit).toBe(100);
    expect(() => parseProductPage({ page: ["1"] })).toThrow();
    expect(() => parseProductPage({ page: "9007199254740991", limit: "100" })).toThrow();
  });
  it("bounds payloads with disjoint deterministic IDs, correct count, and zero prices visible", async () => {
    const unpaged = vi.spyOn(storage, "listProducts");
    const first = await (await fetch(`${origin}/api/products?page=1&limit=24`)).json();
    const second = await (await fetch(`${origin}/api/products?page=2&limit=24`)).json();
    expect(first.total).toBe(125); expect(first.pages).toBe(6);
    expect(first.products.length).toBe(24); expect(second.products.length).toBe(24);
    expect(first.products.some((p: any) => p.priceInr === 0)).toBe(true);
    expect(first.products.filter((p: any) => second.products.some((s: any) => p.id === s.id))).toEqual([]);
    expect(unpaged).not.toHaveBeenCalled();
    unpaged.mockRestore();
    console.log("PAGING PROOF", JSON.stringify({ total: first.total, count: first.products.length, bytes: JSON.stringify(first).length, firstIds: first.products.map((p: any) => p.id), secondIds: second.products.map((p: any) => p.id) }));
  });
  it("searches/filters across the whole catalog, reports empty/out-of-range pages", async () => {
    const filtered = await (await fetch(`${origin}/api/products?page=1&brand=tata`)).json();
    expect(filtered.total).toBe(62);
    const category = await (await fetch(`${origin}/api/products?page=1&category=filters`)).json();
    expect(category.total).toBe(125);
    const searched = await (await fetch(`${origin}/api/products?page=1&q=OEM-0`)).json();
    expect(searched.total).toBe(1);
    const empty = await (await fetch(`${origin}/api/products?page=999`)).json();
    expect(empty.products).toEqual([]); expect(empty.total).toBe(125);
  });
  it("preserves legacy public array callers", async () => {
    const legacy = await (await fetch(`${origin}/api/products`)).json();
    expect(Array.isArray(legacy)).toBe(true); expect(legacy.length).toBe(125);
  });
});

describe("R28.17 PO-only publication", () => {
  it.each([NaN, Infinity, -Infinity])("skips non-finite PO price %s without publishing", async price => {
    const read = vi.spyOn(v2, "getPurchaseOrderV2").mockResolvedValueOnce({ items: [{ partNumber: "BAD-PRICE", unitPrice: price, purchaseCost: 50 }] } as any);
    expect((await autoPublishFromPO(1)).details[0].status).toBe("skipped_price");
    expect(await storage.getProductByPartNumber("BAD-PRICE")).toBeUndefined();
    read.mockRestore();
  });
  it.each([0, -1, null])("skips invalid PO amount %s, remains retryable, then publishes once", async price => {
    // unit_price is NOT NULL in production; null maps to a missing/zero amount.
    db.prepare("UPDATE po_items SET unit_price=? WHERE id=1").run(price ?? 0);
    let result = await autoPublishFromPO(1);
    expect(result.details.find(d => d.part_number === "TEST-1")?.status).toBe("skipped_price");
    expect(await storage.getProductByPartNumber("TEST-1")).toBeUndefined();
    expect((db.prepare("SELECT status FROM auto_publish_log WHERE po_id=1 AND part_number='TEST-1'").get() as any).status).toBe("skipped_price");
    db.exec("UPDATE po_items SET unit_price=100 WHERE id=1");
    result = await autoPublishFromPO(1);
    expect(result.details.find(d => d.part_number === "TEST-1")?.status).toBe("published");
    expect((await storage.getProductByPartNumber("TEST-1"))?.priceInr).toBe(97.6);
    expect((await autoPublishFromPO(1)).details.find(d => d.part_number === "TEST-1")?.status).toBe("skipped_duplicate");
  });
  it("does not fall through a zero purchase price to positive unit price", async () => {
    db.exec("UPDATE po_items SET purchase_cost=0 WHERE id=1");
    await autoPublishFromPO(1);
    expect(await storage.getProductByPartNumber("TEST-1")).toBeUndefined();
  });
  it("leaves existing matching zero-price products entirely unchanged", async () => {
    db.prepare(`INSERT INTO products (slug,name,part_number,brand,category,description,price_inr,active,created_at,stock_qty)
      VALUES ('existing','Manual','TEST-1','tata','filter','Manual content',0,1,0,17)`).run();
    const before = await storage.getProductByPartNumber("TEST-1");
    expect((await autoPublishFromPO(1)).details.find(d => d.part_number === "TEST-1")?.status).toBe("skipped_existing");
    expect(await storage.getProductByPartNumber("TEST-1")).toEqual(before);
  });
  it("does not duplicate products on overlapping Notify Delhi publication runs", async () => {
    db.exec("UPDATE po_items SET part_number='TEST-1' WHERE id=2");
    await Promise.all([autoPublishFromPO(1), autoPublishFromPO(2)]);
    expect((db.prepare("SELECT count(*) AS n FROM products WHERE part_number='TEST-1'").get() as any).n).toBe(1);
  });
});
