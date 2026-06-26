// Phase 3 + Phase 4 storage methods — appended via mixin pattern.
// Imported and called by routes; uses the same `db` + sqlite handle as storage.ts.
import { db } from "./storage";
import {
  posts, priceLists, priceItems, consignments, adminUsers,
  customers, notificationTemplates, notificationLog,
  customerEmails, customerAddresses, customerLogins, customerSessions, otpCodes,
  ledgerEntries, rfqs, quotes, purchaseOrders, paymentRecords, fileUploads, bankDetails,
} from "@shared/schema";
import type {
  Post, InsertPost, PriceList, InsertPriceList, PriceItem,
  Consignment, InsertConsignment, AdminUser,
  Customer, InsertCustomer, NotificationTemplate, NotificationLog,
  CustomerEmail, CustomerAddress, CustomerLogin, CustomerSession, OtpCode,
  LedgerEntry, InsertLedgerEntry, Rfq, InsertRfq, Quote, InsertQuote,
  PurchaseOrder, InsertPurchaseOrder, PaymentRecord, InsertPaymentRecord,
  FileUpload, BankDetails, InsertBankDetails,
} from "@shared/schema";
import { eq, desc, and, like, or, sql, gte, lte, inArray } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const sqlite = new Database(join(DATA_DIR, "data.db"));

// -------- POSTS / BLOG --------
export async function listPosts(opts: { publishedOnly?: boolean; type?: string; limit?: number } = {}): Promise<Post[]> {
  const wheres: any[] = [];
  if (opts.publishedOnly) wheres.push(eq(posts.published, true));
  if (opts.type) wheres.push(eq(posts.type, opts.type));
  let q: any = db.select().from(posts);
  if (wheres.length) q = q.where(wheres.length === 1 ? wheres[0] : and(...wheres));
  q = q.orderBy(desc(posts.publishedAt), desc(posts.createdAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getPost(id: number) { return db.select().from(posts).where(eq(posts.id, id)).get(); }
export async function getPostBySlug(slug: string) { return db.select().from(posts).where(eq(posts.slug, slug)).get(); }
export async function createPost(p: InsertPost): Promise<Post> {
  const now = Date.now();
  const data: any = { ...p, createdAt: now, updatedAt: now };
  if (p.published && !p.publishedAt) data.publishedAt = now;
  return db.insert(posts).values(data).returning().get();
}
export async function updatePost(id: number, p: Partial<InsertPost>): Promise<Post | undefined> {
  const now = Date.now();
  const data: any = { ...p, updatedAt: now };
  if (p.published) {
    const existing = await getPost(id);
    if (existing && !existing.publishedAt) data.publishedAt = now;
  }
  return db.update(posts).set(data).where(eq(posts.id, id)).returning().get();
}
export async function deletePost(id: number) { db.delete(posts).where(eq(posts.id, id)).run(); }

// -------- PRICE LISTS --------
export async function listPriceLists(): Promise<PriceList[]> {
  return db.select().from(priceLists).orderBy(desc(priceLists.uploadedAt)).all();
}
export async function getAvailableBrands(): Promise<{ brand: string; count: number; lastUpdated: number; latestVersion: string | null }[]> {
  const rows: any[] = sqlite.prepare(`
    SELECT
      pl.brand AS brand,
      COUNT(DISTINCT pi.id) AS count,
      MAX(pl.uploaded_at) AS last_updated
    FROM price_lists pl
    LEFT JOIN price_items pi ON pi.brand = pl.brand
    GROUP BY pl.brand
    ORDER BY last_updated DESC
  `).all();
  // get latest version label per brand
  const labels: Record<string, string | null> = {};
  for (const r of rows) {
    const v = sqlite.prepare(`SELECT version_label FROM price_lists WHERE brand = ? ORDER BY uploaded_at DESC LIMIT 1`).get(r.brand) as any;
    labels[r.brand] = v?.version_label || null;
  }
  return rows.map((r) => ({ brand: r.brand, count: r.count, lastUpdated: r.last_updated, latestVersion: labels[r.brand] }));
}
export async function createPriceList(p: InsertPriceList): Promise<PriceList> {
  const data: any = { ...p, uploadedAt: Date.now(), itemCount: 0 };
  return db.insert(priceLists).values(data).returning().get();
}
export async function deletePriceList(id: number) {
  db.delete(priceItems).where(eq(priceItems.priceListId, id)).run();
  db.delete(priceLists).where(eq(priceLists.id, id)).run();
}
export async function bulkInsertPriceItems(brand: string, priceListId: number, items: any[]) {
  if (!items.length) return 0;
  const stmt = sqlite.prepare(`
    INSERT INTO price_items (brand, price_list_id, part_number, part_number_clean, description, mrp, dealer_price, hsn_code, gst_percent, uom)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = sqlite.transaction((rows: any[]) => {
    for (const r of rows) {
      const pn = String(r.partNumber || "").trim();
      const clean = pn.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!clean) continue;
      stmt.run(brand, priceListId, pn, clean, r.description || null, r.mrp ?? null, r.dealerPrice ?? null, r.hsnCode || null, r.gstPercent ?? null, r.uom || null);
    }
  });
  insertMany(items);
  const cnt = sqlite.prepare("SELECT COUNT(*) AS c FROM price_items WHERE price_list_id = ?").get(priceListId) as any;
  db.update(priceLists).set({ itemCount: cnt.c }).where(eq(priceLists.id, priceListId)).run();
  return cnt.c as number;
}
export async function searchPriceItems(partNumber: string, brand?: string): Promise<any[]> {
  const clean = String(partNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean) return [];
  let sqlStr = `
    SELECT pi.*, pl.uploaded_at AS uploadedAt, pl.version_label AS versionLabel
    FROM price_items pi
    LEFT JOIN price_lists pl ON pl.id = pi.price_list_id
    WHERE pi.part_number_clean LIKE ?
  `;
  const params: any[] = [clean + "%"];
  if (brand) { sqlStr += " AND pi.brand = ?"; params.push(brand); }
  sqlStr += " ORDER BY pl.uploaded_at DESC LIMIT 50";
  const rows = sqlite.prepare(sqlStr).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    priceListId: r.price_list_id,
    partNumber: r.part_number,
    description: r.description,
    mrp: r.mrp,
    dealerPrice: r.dealer_price,
    hsnCode: r.hsn_code,
    gstPercent: r.gst_percent,
    uom: r.uom,
    uploadedAt: r.uploadedAt,
    versionLabel: r.versionLabel,
  }));
}

/**
 * Exact case-insensitive part number lookup in price_items.
 * Used by the document import endpoint (Bug 4) to auto-fill MRP from the price list.
 * Returns the most recently uploaded row for each brand that matches.
 */
export function lookupPartNumberMrp(partNumber: string): { mrp: number; brand: string; hsnCode: string | null; gstPercent: number | null } | null {
  if (!partNumber) return null;
  const clean = String(partNumber).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean) return null;
  // Exact match on cleaned part number, pick the most recently uploaded entry
  const row = sqlite.prepare(`
    SELECT pi.mrp, pi.brand, pi.hsn_code AS hsnCode, pi.gst_percent AS gstPercent
    FROM price_items pi
    LEFT JOIN price_lists pl ON pl.id = pi.price_list_id
    WHERE pi.part_number_clean = ?
    ORDER BY pl.uploaded_at DESC
    LIMIT 1
  `).get(clean) as any;
  if (!row || row.mrp == null) return null;
  return {
    mrp: row.mrp as number,
    brand: row.brand as string,
    hsnCode: row.hsnCode || null,
    gstPercent: row.gstPercent != null ? Number(row.gstPercent) : null,
  };
}

// -------- CONSIGNMENTS --------
export async function listConsignments(opts: { status?: string; q?: string; limit?: number } = {}): Promise<Consignment[]> {
  const wheres: any[] = [];
  if (opts.status) wheres.push(eq(consignments.status, opts.status));
  if (opts.q) {
    const like_ = `%${opts.q}%`;
    wheres.push(or(
      like(consignments.docketNumber, like_),
      like(consignments.invoiceNumber, like_),
      like(consignments.customerName, like_),
      like(consignments.customerPhone, like_),
    ));
  }
  let q: any = db.select().from(consignments);
  if (wheres.length) q = q.where(wheres.length === 1 ? wheres[0] : and(...wheres));
  q = q.orderBy(desc(consignments.createdAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getConsignmentByDocket(docket: string) {
  return db.select().from(consignments).where(eq(consignments.docketNumber, docket.trim())).get();
}
export async function createConsignment(c: InsertConsignment, createdBy?: string): Promise<Consignment> {
  const now = Date.now();
  const data: any = { ...c, createdBy: createdBy || c.createdBy || null, createdAt: now, updatedAt: now };
  return db.insert(consignments).values(data).returning().get();
}
export async function updateConsignment(id: number, c: Partial<InsertConsignment>): Promise<Consignment | undefined> {
  const data: any = { ...c, updatedAt: Date.now() };
  if (c.status === "delivered" && !c.deliveredDate) data.deliveredDate = Date.now();
  return db.update(consignments).set(data).where(eq(consignments.id, id)).returning().get();
}
export async function deleteConsignment(id: number) { db.delete(consignments).where(eq(consignments.id, id)).run(); }
export async function getConsignmentById(id: number): Promise<Consignment | undefined> {
  return db.select().from(consignments).where(eq(consignments.id, id)).get();
}

// -------- ADMIN USERS --------
export async function listAdminUsers(): Promise<AdminUser[]> {
  return db.select().from(adminUsers).orderBy(desc(adminUsers.createdAt)).all();
}
export async function getAdminUserByUsername(username: string): Promise<AdminUser | undefined> {
  return db.select().from(adminUsers).where(eq(adminUsers.username, username)).get();
}
export async function createAdminUser(u: { username: string; passwordHash: string; role: string; displayName?: string }): Promise<AdminUser> {
  const data: any = { ...u, displayName: u.displayName || null, active: true, createdAt: Date.now() };
  return db.insert(adminUsers).values(data).returning().get();
}
export async function updateAdminUser(id: number, u: any) {
  return db.update(adminUsers).set(u).where(eq(adminUsers.id, id)).returning().get();
}
export async function deleteAdminUser(id: number) { db.delete(adminUsers).where(eq(adminUsers.id, id)).run(); }

// -------- CUSTOMERS (Phase 4) --------
export async function getCustomers(search?: string): Promise<Customer[]> {
  if (search) {
    const like_ = `%${search}%`;
    return db.select().from(customers).where(
      or(
        like(customers.name, like_),
        like(customers.phone, like_),
        like(customers.email, like_),
        like(customers.city, like_),
      )
    ).orderBy(desc(customers.createdAt)).all();
  }
  return db.select().from(customers).orderBy(desc(customers.createdAt)).all();
}
export async function getCustomer(id: number): Promise<Customer | undefined> {
  return db.select().from(customers).where(eq(customers.id, id)).get();
}
export async function createCustomer(data: InsertCustomer): Promise<Customer> {
  const row: any = { ...data, createdAt: Date.now() };
  return db.insert(customers).values(row).returning().get();
}
const CUSTOMER_EDITABLE_FIELDS = [
  "name", "phone", "email", "address", "city", "state", "pincode",
  "gstNumber", "notes", "contactPerson", "companyPan", "customerCode",
  "creditLimitInr", "openingBalanceInr", "paymentTermsDays", "defaultDiscountPct",
] as const;

export async function updateCustomer(id: number, data: Partial<InsertCustomer>): Promise<Customer | undefined> {
  const patch: Record<string, unknown> = {};
  for (const key of CUSTOMER_EDITABLE_FIELDS) {
    if (key in data && (data as any)[key] !== undefined) patch[key] = (data as any)[key];
  }
  if (Object.keys(patch).length === 0) return getCustomer(id);
  return db.update(customers).set(patch).where(eq(customers.id, id)).returning().get();
}
export async function deleteCustomer(id: number): Promise<void> {
  db.delete(customers).where(eq(customers.id, id)).run();
}
export async function getCustomerConsignmentCount(id: number): Promise<number> {
  const row = sqlite.prepare("SELECT COUNT(*) AS c FROM consignments WHERE customer_id = ?").get(id) as any;
  return row?.c ?? 0;
}
// R27.25 — batch replacement for the per-customer N+1 in GET /api/admin/customers.
// One grouped scan returns counts for every customer; callers look up by id.
export async function getCustomerConsignmentCounts(): Promise<Map<number, number>> {
  const rows = sqlite.prepare(
    "SELECT customer_id AS id, COUNT(*) AS c FROM consignments WHERE customer_id IS NOT NULL GROUP BY customer_id",
  ).all() as Array<{ id: number; c: number }>;
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.id, r.c);
  return m;
}
// R27.25 — batch customer fetch for the per-row getCustomer N+1 in the
// quotations list. One IN(...) query instead of one SELECT per customerId.
export async function getCustomersByIds(ids: number[]): Promise<Map<number, Customer>> {
  const m = new Map<number, Customer>();
  const clean = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));
  if (!clean.length) return m;
  const rows = db.select().from(customers).where(inArray(customers.id, clean)).all();
  for (const c of rows) m.set(c.id, c);
  return m;
}

// -------- NOTIFICATION TEMPLATES (Phase 4) --------
export async function getNotificationTemplates(): Promise<NotificationTemplate[]> {
  return db.select().from(notificationTemplates).orderBy(notificationTemplates.eventKey, notificationTemplates.channel).all();
}
export async function getTemplatesByEvent(eventKey: string): Promise<NotificationTemplate[]> {
  return db.select().from(notificationTemplates).where(eq(notificationTemplates.eventKey, eventKey)).all();
}
export async function updateNotificationTemplate(
  id: number,
  data: { subject?: string; body?: string; enabled?: boolean }
): Promise<NotificationTemplate> {
  const updated: any = { ...data, updatedAt: Date.now() };
  return db.update(notificationTemplates).set(updated).where(eq(notificationTemplates.id, id)).returning().get();
}

// -------- NOTIFICATION LOG (Phase 4) --------
export async function logNotification(data: {
  consignmentId: number | null;
  customerId: number | null;
  eventKey: string;
  channel: string;
  recipient: string;
  subject: string | null | undefined;
  body: string;
  status: string;
  errorMsg?: string | null;
}): Promise<NotificationLog> {
  const row: any = {
    consignmentId: data.consignmentId ?? null,
    customerId: data.customerId ?? null,
    eventKey: data.eventKey,
    channel: data.channel,
    recipient: data.recipient,
    subject: data.subject ?? null,
    body: data.body,
    status: data.status,
    errorMsg: data.errorMsg ?? null,
    sentAt: Date.now(),
  };
  return db.insert(notificationLog).values(row).returning().get();
}
export async function getNotificationLog(consignmentId: number): Promise<NotificationLog[]> {
  return db.select().from(notificationLog)
    .where(eq(notificationLog.consignmentId, consignmentId))
    .orderBy(desc(notificationLog.sentAt))
    .all();
}

export async function listNotifications(opts: {
  limit?: number;
  channel?: string;
  status?: string;
}): Promise<NotificationLog[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const conds: any[] = [];
  if (opts.channel) conds.push(eq(notificationLog.channel, opts.channel));
  if (opts.status) conds.push(eq(notificationLog.status, opts.status));
  let q: any = db.select().from(notificationLog);
  if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
  return q.orderBy(desc(notificationLog.sentAt)).limit(limit).all();
}

// -------- DEFAULT TEMPLATES SEED (Phase 4) --------
const DEFAULT_TEMPLATES = [
  {
    eventKey: "consignment_created", channel: "email",
    subject: "Order Received — Docket {docket}",
    body: "Dear {customerName},\n\nWe have received your order. Your consignment will be dispatched soon.\n\nDocket: {docket}\nInvoice: {invoiceNumber}\nInvoice Value: ₹{invoiceAmount}\nBundles: {bundlesCount}\nFrom: {origin}\nTo: {destination}\nCarrier: {carrier}\n\nYou can track your consignment anytime here:\n{trackingLink}\n\nThank you for choosing Narmada Mobility.\n\nRegards,\nNarmada Mobility\nsales@Narmadamobility.com\n+91 79090 83806",
  },
  {
    eventKey: "consignment_created", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\nYour order has been received.\n\n📦 Docket: {docket}\n🧾 Invoice: {invoiceNumber}\n💰 Invoice Value: ₹{invoiceAmount}\n📦 Bundles: {bundlesCount}\n🚚 {origin} → {destination}\n\nTrack live status: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "in_transit", channel: "email",
    subject: "Your consignment is in transit — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment is now in transit.\n\nDocket: {docket}\nInvoice: {invoiceNumber}\nInvoice Value: ₹{invoiceAmount}\nBundles: {bundlesCount}\nFrom: {origin}\nTo: {destination}\nCarrier: {carrier}\nETA: {etaDate}\n\nTrack live status:\n{trackingLink}\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "in_transit", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n🚚 Your order is in transit.\n\n📦 Docket: {docket}\n🧾 Invoice: {invoiceNumber}\n💰 ₹{invoiceAmount}\n📅 ETA: {etaDate}\n\nTrack: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "out_for_delivery", channel: "email",
    subject: "Out for delivery — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment is out for delivery today.\n\nDocket: {docket}\nInvoice: {invoiceNumber}\nInvoice Value: ₹{invoiceAmount}\nBundles: {bundlesCount}\nDestination: {destination}\n\nPlease ensure someone is available to receive it.\n\nTrack: {trackingLink}\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "out_for_delivery", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n🛵 Out for delivery today.\n\n📦 Docket: {docket}\n🧾 Invoice: {invoiceNumber}\n📍 {destination}\n\nPlease be available.\n\nTrack: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "delivered", channel: "email",
    subject: "Delivered — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment has been delivered. Thank you for choosing Narmada Mobility.\n\nDocket: {docket}\nInvoice: {invoiceNumber}\nInvoice Value: ₹{invoiceAmount}\nDelivered on: {deliveredDate}\n\nWe would love to hear your feedback. Reply to this email or WhatsApp us at +91 79090 83806.\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "delivered", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n✅ Your order has been delivered.\n\n📦 Docket: {docket}\n🧾 Invoice: {invoiceNumber}\n💰 ₹{invoiceAmount}\n📅 {deliveredDate}\n\nThank you for choosing Narmada Mobility. Reply with feedback!",
  },
];

// Seed default templates — INSERT OR IGNORE using the unique index on (event_key, channel)
(function seedDefaultTemplates() {
  try {
    const stmt = sqlite.prepare(`
      INSERT OR IGNORE INTO notification_templates (event_key, channel, subject, body, enabled, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    const now = Date.now();
    for (const t of DEFAULT_TEMPLATES) {
      stmt.run(t.eventKey, t.channel, t.subject ?? null, t.body, now);
    }
  } catch (e: any) {
    console.error("[storage-v2] Failed to seed default templates:", e.message);
  }
})();


// =============================================================
// SESSION B HELPERS
// =============================================================

// ---------- CUSTOMER EMAILS ----------
export async function listCustomerEmails(customerId: number): Promise<CustomerEmail[]> {
  return db.select().from(customerEmails).where(eq(customerEmails.customerId, customerId)).orderBy(desc(customerEmails.isPrimary), desc(customerEmails.createdAt)).all();
}
export async function addCustomerEmail(customerId: number, email: string, label?: string, isPrimary = false): Promise<CustomerEmail> {
  if (isPrimary) {
    db.update(customerEmails).set({ isPrimary: false }).where(eq(customerEmails.customerId, customerId)).run();
  }
  return db.insert(customerEmails).values({ customerId, email: email.trim().toLowerCase(), label, isPrimary, createdAt: Date.now() }).returning().get();
}
export async function deleteCustomerEmail(id: number): Promise<void> {
  db.delete(customerEmails).where(eq(customerEmails.id, id)).run();
}
export async function setPrimaryCustomerEmail(id: number): Promise<void> {
  const row = db.select().from(customerEmails).where(eq(customerEmails.id, id)).get();
  if (!row) return;
  db.update(customerEmails).set({ isPrimary: false }).where(eq(customerEmails.customerId, row.customerId)).run();
  db.update(customerEmails).set({ isPrimary: true }).where(eq(customerEmails.id, id)).run();
}

// ---------- CUSTOMER ADDRESSES ----------
export async function listCustomerAddresses(customerId: number): Promise<CustomerAddress[]> {
  return db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(desc(customerAddresses.createdAt)).all();
}
export async function addCustomerAddress(customerId: number, data: Omit<CustomerAddress, "id" | "customerId" | "createdAt">): Promise<CustomerAddress> {
  return db.insert(customerAddresses).values({ ...data, customerId, createdAt: Date.now() }).returning().get();
}
export async function updateCustomerAddress(id: number, data: Partial<Omit<CustomerAddress, "id" | "customerId" | "createdAt">>): Promise<CustomerAddress | undefined> {
  return db.update(customerAddresses).set(data).where(eq(customerAddresses.id, id)).returning().get();
}
export async function deleteCustomerAddress(id: number): Promise<void> {
  db.delete(customerAddresses).where(eq(customerAddresses.id, id)).run();
}
// Portal aliases (routes-v2 patched endpoints)
export async function getCustomerEmails(customerId: number): Promise<CustomerEmail[]> {
  return listCustomerEmails(customerId);
}
export async function getCustomerAddresses(customerId: number): Promise<CustomerAddress[]> {
  return listCustomerAddresses(customerId);
}

// ---------- CUSTOMER LOGINS + OTP + SESSIONS (customer portal auth) ----------
const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getCustomerLoginByEmail(email: string): Promise<CustomerLogin | undefined> {
  const normalized = email.trim().toLowerCase();
  return db.select().from(customerLogins).where(eq(customerLogins.email, normalized)).get();
}
export async function listCustomerLogins(): Promise<CustomerLogin[]> {
  return db.select().from(customerLogins).orderBy(desc(customerLogins.createdAt)).all();
}
export async function createCustomerLogin(customerId: number, email: string, opts: { creditLimitInr?: number; paymentTermsDays?: number } = {}): Promise<CustomerLogin> {
  const normalized = email.trim().toLowerCase();
  const existing = await getCustomerLoginByEmail(normalized);
  if (existing) {
    // Already exists -> update if pointed at different customer (rare). Return existing.
    return existing;
  }
  return db.insert(customerLogins).values({
    customerId,
    email: normalized,
    creditLimitInr: opts.creditLimitInr ?? 0,
    paymentTermsDays: opts.paymentTermsDays ?? 0,
    active: true,
    createdAt: Date.now(),
  }).returning().get();
}
export async function setCustomerLoginActive(id: number, active: boolean): Promise<void> {
  db.update(customerLogins).set({ active }).where(eq(customerLogins.id, id)).run();
}
export async function deleteCustomerLogin(id: number): Promise<void> {
  db.delete(customerLogins).where(eq(customerLogins.id, id)).run();
}

export async function generateOtp(email: string, purpose = "customer_login"): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  // Invalidate prior unused OTPs for the same email+purpose
  db.update(otpCodes).set({ used: true }).where(and(eq(otpCodes.email, normalized), eq(otpCodes.purpose, purpose), eq(otpCodes.used, false))!).run();
  db.insert(otpCodes).values({
    email: normalized, code, purpose, used: false,
    createdAt: now, expiresAt: now + OTP_TTL_MS,
  }).run();
  return code;
}
export async function verifyOtp(email: string, code: string, purpose = "customer_login"): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  const row = db.select().from(otpCodes)
    .where(and(eq(otpCodes.email, normalized), eq(otpCodes.code, code.trim()), eq(otpCodes.purpose, purpose), eq(otpCodes.used, false))!)
    .orderBy(desc(otpCodes.createdAt))
    .get();
  if (!row) return false;
  if (row.expiresAt < now) return false;
  db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, row.id)).run();
  return true;
}

export async function createCustomerSession(customerId: number, email: string): Promise<CustomerSession> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  return db.insert(customerSessions).values({
    token, customerId, email: email.trim().toLowerCase(),
    createdAt: now, lastSeenAt: now, expiresAt: now + CUSTOMER_SESSION_TTL_MS,
  }).returning().get();
}
export async function getCustomerSession(token: string): Promise<CustomerSession | undefined> {
  if (!token) return undefined;
  const now = Date.now();
  const row = db.select().from(customerSessions).where(eq(customerSessions.token, token)).get();
  if (!row) return undefined;
  if (row.expiresAt < now) {
    db.delete(customerSessions).where(eq(customerSessions.token, token)).run();
    return undefined;
  }
  // Sliding refresh: extend if older than 1 day since last seen
  if (now - row.lastSeenAt > 24 * 60 * 60 * 1000) {
    db.update(customerSessions).set({ lastSeenAt: now, expiresAt: now + CUSTOMER_SESSION_TTL_MS }).where(eq(customerSessions.token, token)).run();
  }
  return row;
}
export async function deleteCustomerSession(token: string): Promise<void> {
  db.delete(customerSessions).where(eq(customerSessions.token, token)).run();
}

// ---------- LEDGER ENTRIES ----------
function recomputeLedgerBalance(customerId: number): void {
  // Recompute running balance for ALL entries of this customer in chronological order.
  // Cheap for the volumes Narmada will see; safe and authoritative.
  const all = db.select().from(ledgerEntries).where(eq(ledgerEntries.customerId, customerId)).orderBy(ledgerEntries.entryDate, ledgerEntries.id).all();
  let bal = 0;
  for (const e of all) {
    bal += (e.debitInr || 0) - (e.creditInr || 0);
    db.update(ledgerEntries).set({ balanceInr: bal }).where(eq(ledgerEntries.id, e.id)).run();
  }
}

export async function listLedgerEntries(customerId: number, opts: { from?: number; to?: number; limit?: number } = {}): Promise<LedgerEntry[]> {
  const conds: any[] = [eq(ledgerEntries.customerId, customerId)];
  // R26.6a (3) — compare against COALESCE(entry_date, created_at) so rows with a
  // null/zero entry_date are not excluded by a date-range filter (they were silently
  // dropped, making Test Wagad / BSC ledgers look empty).
  const effDate = sql<number>`COALESCE(${ledgerEntries.entryDate}, ${ledgerEntries.createdAt})`;
  if (opts.from) conds.push(gte(effDate, opts.from));
  if (opts.to) conds.push(lte(effDate, opts.to));
  let q: any = db.select().from(ledgerEntries).where(and(...conds)!).orderBy(ledgerEntries.entryDate, ledgerEntries.id);
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getLedgerBalance(customerId: number): Promise<number> {
  const row = db.select({
    debit: sql<number>`COALESCE(SUM(${ledgerEntries.debitInr}), 0)`,
    credit: sql<number>`COALESCE(SUM(${ledgerEntries.creditInr}), 0)`,
  }).from(ledgerEntries).where(eq(ledgerEntries.customerId, customerId)).get();
  return (row?.debit || 0) - (row?.credit || 0);
}
export async function addLedgerEntry(data: InsertLedgerEntry & { createdBy?: string }): Promise<LedgerEntry> {
  const row = db.insert(ledgerEntries).values({ ...data, createdAt: Date.now() }).returning().get();
  recomputeLedgerBalance(data.customerId);
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.id, row.id)).get()!;
}
export async function bulkAddLedgerEntries(entries: (InsertLedgerEntry & { createdBy?: string })[]): Promise<number> {
  if (!entries.length) return 0;
  const now = Date.now();
  const customerIds = new Set<number>();
  const insert = db.insert(ledgerEntries);
  for (const e of entries) {
    insert.values({ ...e, createdAt: now }).run();
    customerIds.add(e.customerId);
  }
  customerIds.forEach((cid) => recomputeLedgerBalance(cid));
  return entries.length;
}
export async function deleteLedgerEntry(id: number): Promise<void> {
  const row = db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)).get();
  if (!row) return;
  db.delete(ledgerEntries).where(eq(ledgerEntries.id, id)).run();
  recomputeLedgerBalance(row.customerId);
}
export async function seedOpeningBalanceIfNeeded(customerId: number, openingBalanceInr: number): Promise<void> {
  if (!openingBalanceInr || openingBalanceInr === 0) return;
  const existing = db.select().from(ledgerEntries)
    .where(and(eq(ledgerEntries.customerId, customerId), eq(ledgerEntries.voucherType, "opening"))!)
    .get();
  if (existing) return; // already seeded
  await addLedgerEntry({
    customerId,
    entryDate: Date.now(),
    voucherType: "opening",
    voucherNo: "OB",
    description: "Opening balance",
    debitInr: openingBalanceInr > 0 ? openingBalanceInr : 0,
    creditInr: openingBalanceInr < 0 ? Math.abs(openingBalanceInr) : 0,
    referenceId: null,
    createdBy: "system",
  } as any);
}

// ---------- RFQS ----------
export async function listRfqs(opts: { status?: string; customerId?: number; limit?: number } = {}): Promise<Rfq[]> {
  const conds: any[] = [];
  if (opts.status) conds.push(eq(rfqs.status, opts.status));
  if (opts.customerId) conds.push(eq(rfqs.customerId, opts.customerId));
  let q: any = db.select().from(rfqs);
  if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
  q = q.orderBy(desc(rfqs.createdAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getRfq(id: number): Promise<Rfq | undefined> {
  return db.select().from(rfqs).where(eq(rfqs.id, id)).get();
}
export async function createRfq(data: InsertRfq): Promise<Rfq> {
  return db.insert(rfqs).values({ ...data, status: "open", createdAt: Date.now() } as any).returning().get();
}
export async function updateRfq(id: number, patch: Partial<Rfq>): Promise<Rfq | undefined> {
  return db.update(rfqs).set(patch).where(eq(rfqs.id, id)).returning().get();
}
export async function deleteRfq(id: number): Promise<void> {
  db.delete(rfqs).where(eq(rfqs.id, id)).run();
}

// ---------- QUOTES ----------
function generateQuoteNo(): string {
  // Format: QT-YYYYMM-XXXX (count-based per month)
  const d = new Date();
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `QT-${yyyymm}-`;
  const row = db.select({ c: sql<number>`COUNT(*)` }).from(quotes).where(like(quotes.quoteNo, `${prefix}%`)).get();
  const next = ((row?.c as number) || 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
export async function listQuotes(opts: { customerId?: number; rfqId?: number; status?: string; limit?: number } = {}): Promise<Quote[]> {
  const conds: any[] = [];
  if (opts.customerId) conds.push(eq(quotes.customerId, opts.customerId));
  if (opts.rfqId) conds.push(eq(quotes.rfqId, opts.rfqId));
  if (opts.status) conds.push(eq(quotes.status, opts.status));
  let q: any = db.select().from(quotes);
  if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
  q = q.orderBy(desc(quotes.createdAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getQuote(id: number): Promise<Quote | undefined> {
  return db.select().from(quotes).where(eq(quotes.id, id)).get();
}
export async function createQuote(data: InsertQuote & { createdBy?: string }): Promise<Quote> {
  const quoteNo = generateQuoteNo();
  const quote = db.insert(quotes).values({ ...data, quoteNo, status: "sent", createdAt: Date.now() } as any).returning().get();
  // If this quote is linked to an RFQ, mark RFQ as quoted + link
  if (data.rfqId) {
    db.update(rfqs).set({ status: "quoted", quotedAt: Date.now(), quoteId: quote.id }).where(eq(rfqs.id, data.rfqId)).run();
  }
  return quote;
}
export async function updateQuoteStatus(id: number, status: string): Promise<Quote | undefined> {
  return db.update(quotes).set({ status }).where(eq(quotes.id, id)).returning().get();
}
export async function deleteQuote(id: number): Promise<void> {
  db.delete(quotes).where(eq(quotes.id, id)).run();
}

// ---------- PURCHASE ORDERS ----------
export async function listPurchaseOrders(opts: { customerId?: number; status?: string; limit?: number } = {}): Promise<PurchaseOrder[]> {
  const conds: any[] = [];
  if (opts.customerId) conds.push(eq(purchaseOrders.customerId, opts.customerId));
  if (opts.status) conds.push(eq(purchaseOrders.status, opts.status));
  let q: any = db.select().from(purchaseOrders);
  if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
  q = q.orderBy(desc(purchaseOrders.createdAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined> {
  return db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
}
export async function createPurchaseOrder(data: InsertPurchaseOrder): Promise<PurchaseOrder> {
  return db.insert(purchaseOrders).values({ ...data, status: "pending", reminderCount: 0, createdAt: Date.now() } as any).returning().get();
}
export async function approvePurchaseOrder(id: number, approvedBy: string): Promise<PurchaseOrder | undefined> {
  const po = db.update(purchaseOrders).set({ status: "approved", approvedAt: Date.now(), approvedBy }).where(eq(purchaseOrders.id, id)).returning().get();
  if (po) {
    // Auto-post invoice entry to ledger as debit (amount customer owes us)
    await addLedgerEntry({
      customerId: po.customerId,
      entryDate: Date.now(),
      voucherType: "invoice",
      voucherNo: po.customerPoNumber,
      referenceId: po.id,
      description: `Invoice against PO ${po.customerPoNumber}`,
      debitInr: po.totalInr,
      creditInr: 0,
      createdBy: approvedBy,
    } as any);
  }
  return po;
}
export async function rejectPurchaseOrder(id: number, approvedBy: string, notes?: string): Promise<PurchaseOrder | undefined> {
  return db.update(purchaseOrders).set({ status: "rejected", approvedAt: Date.now(), approvedBy, notes: notes || null }).where(eq(purchaseOrders.id, id)).returning().get();
}
export async function deletePurchaseOrder(id: number): Promise<void> {
  db.delete(purchaseOrders).where(eq(purchaseOrders.id, id)).run();
}
export async function listPendingPurchaseOrdersOlderThan(days: number): Promise<PurchaseOrder[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.status, "pending"), lte(purchaseOrders.createdAt, cutoff))!)
    .all();
}
export async function bumpPoReminder(id: number): Promise<void> {
  const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!po) return;
  db.update(purchaseOrders).set({ reminderCount: (po.reminderCount || 0) + 1, lastRemindedAt: Date.now() }).where(eq(purchaseOrders.id, id)).run();
}

// ---------- PAYMENT RECORDS ----------
export async function listPayments(opts: { customerId?: number; from?: number; to?: number; limit?: number } = {}): Promise<PaymentRecord[]> {
  const conds: any[] = [];
  if (opts.customerId) conds.push(eq(paymentRecords.customerId, opts.customerId));
  if (opts.from) conds.push(gte(paymentRecords.paymentDate, opts.from));
  if (opts.to) conds.push(lte(paymentRecords.paymentDate, opts.to));
  let q: any = db.select().from(paymentRecords);
  if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
  q = q.orderBy(desc(paymentRecords.paymentDate));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function recordPayment(data: InsertPaymentRecord): Promise<PaymentRecord> {
  const row = db.insert(paymentRecords).values({ ...data, createdAt: Date.now() }).returning().get();
  // Auto-post credit entry to ledger
  await addLedgerEntry({
    customerId: row.customerId,
    entryDate: row.paymentDate,
    voucherType: "payment",
    voucherNo: row.referenceNo || `PAY-${row.id}`,
    referenceId: row.id,
    description: `Payment received (${row.paymentMode.toUpperCase()})`,
    debitInr: 0,
    creditInr: row.amountInr,
    createdBy: row.recordedBy || null,
  } as any);
  return row;
}
export async function deletePayment(id: number): Promise<void> {
  const row = db.select().from(paymentRecords).where(eq(paymentRecords.id, id)).get();
  if (!row) return;
  db.delete(paymentRecords).where(eq(paymentRecords.id, id)).run();
  // Remove matching ledger entry
  db.delete(ledgerEntries).where(and(eq(ledgerEntries.voucherType, "payment"), eq(ledgerEntries.referenceId, id))!).run();
  recomputeLedgerBalance(row.customerId);
}

// ---------- FILE UPLOADS ----------
export async function addFileUpload(data: Omit<FileUpload, "id" | "createdAt">): Promise<FileUpload> {
  return db.insert(fileUploads).values({ ...data, createdAt: Date.now() }).returning().get();
}
export async function listFileUploads(entityType: string, entityId: number): Promise<FileUpload[]> {
  return db.select().from(fileUploads).where(and(eq(fileUploads.entityType, entityType), eq(fileUploads.entityId, entityId))!).orderBy(desc(fileUploads.createdAt)).all();
}
export async function getFileUpload(id: number): Promise<FileUpload | undefined> {
  return db.select().from(fileUploads).where(eq(fileUploads.id, id)).get();
}
export async function deleteFileUpload(id: number): Promise<void> {
  db.delete(fileUploads).where(eq(fileUploads.id, id)).run();
}

// ---------- BANK DETAILS ----------
export async function listBankDetails(activeOnly = true): Promise<BankDetails[]> {
  if (activeOnly) {
    return db.select().from(bankDetails).where(eq(bankDetails.active, true)).orderBy(desc(bankDetails.isDefault), desc(bankDetails.createdAt)).all();
  }
  return db.select().from(bankDetails).orderBy(desc(bankDetails.isDefault), desc(bankDetails.createdAt)).all();
}
export async function getDefaultBank(): Promise<BankDetails | undefined> {
  return db.select().from(bankDetails).where(and(eq(bankDetails.isDefault, true), eq(bankDetails.active, true))!).get();
}
export async function createBankDetails(data: InsertBankDetails): Promise<BankDetails> {
  if (data.isDefault) {
    db.update(bankDetails).set({ isDefault: false }).run();
  }
  return db.insert(bankDetails).values({ ...data, createdAt: Date.now() }).returning().get();
}
export async function updateBankDetails(id: number, data: Partial<InsertBankDetails>): Promise<BankDetails | undefined> {
  if (data.isDefault) {
    db.update(bankDetails).set({ isDefault: false }).run();
  }
  return db.update(bankDetails).set(data).where(eq(bankDetails.id, id)).returning().get();
}
export async function deleteBankDetails(id: number): Promise<void> {
  db.delete(bankDetails).where(eq(bankDetails.id, id)).run();
}

// ---------- COUNTS FOR DASHBOARDS ----------
export async function getSessionBCounts() {
  const customerCount = db.select({ c: sql<number>`COUNT(*)` }).from(customers).get()?.c || 0;
  const openRfqs = db.select({ c: sql<number>`COUNT(*)` }).from(rfqs).where(eq(rfqs.status, "open")).get()?.c || 0;
  const pendingPos = db.select({ c: sql<number>`COUNT(*)` }).from(purchaseOrders).where(eq(purchaseOrders.status, "pending")).get()?.c || 0;
  const totalReceivable = db.select({ d: sql<number>`COALESCE(SUM(${ledgerEntries.debitInr}),0)`, c: sql<number>`COALESCE(SUM(${ledgerEntries.creditInr}),0)` }).from(ledgerEntries).get();
  return {
    customers: customerCount,
    openRfqs,
    pendingPos,
    totalReceivableInr: (totalReceivable?.d || 0) - (totalReceivable?.c || 0),
  };
}

// =============================================================
// SESSION C STORAGE METHODS
// =============================================================

import {
  quotingCompanies, dataTeamUsers, dataTeamSessions, partsMaster,
  quotations, quotationItems, auditLogs, emailInbox, fxRates,
  customerChatMessages, accountRequests,
} from "@shared/schema";
import type {
  QuotingCompany, InsertQuotingCompany,
  DataTeamUser, DataTeamSession,
  PartsMaster, InsertPartsMaster,
  Quotation, InsertQuotation,
  QuotationItem, InsertQuotationItem,
  AuditLog, EmailInboxRow, FxRate,
  CustomerChatMessage,
  AccountRequest, InsertAccountRequest,
} from "@shared/schema";

// -------- QUOTING COMPANIES --------
export async function listQuotingCompanies(activeOnly = false): Promise<QuotingCompany[]> {
  if (activeOnly) {
    return db.select().from(quotingCompanies).where(eq(quotingCompanies.active, true)).orderBy(quotingCompanies.name).all();
  }
  return db.select().from(quotingCompanies).orderBy(quotingCompanies.name).all();
}
export async function getQuotingCompany(id: number): Promise<QuotingCompany | undefined> {
  return db.select().from(quotingCompanies).where(eq(quotingCompanies.id, id)).get();
}
export async function createQuotingCompany(data: InsertQuotingCompany): Promise<QuotingCompany> {
  return db.insert(quotingCompanies).values({ ...data, createdAt: Date.now() } as any).returning().get();
}
export async function updateQuotingCompany(id: number, data: Partial<InsertQuotingCompany>): Promise<QuotingCompany | undefined> {
  return db.update(quotingCompanies).set(data).where(eq(quotingCompanies.id, id)).returning().get();
}
export async function deleteQuotingCompany(id: number): Promise<void> {
  db.delete(quotingCompanies).where(eq(quotingCompanies.id, id)).run();
}

// R27.15 — map a unified `companies` row into the legacy QuotingCompany response
// shape so both tables can be presented through one quoting-company picker. The id
// is negated to namespace company-sourced entries and avoid colliding with the
// positive ids of the legacy quoting_companies table.
function mapCompanyToQuotingCompany(row: Company): QuotingCompany & { _source: string } {
  return {
    id: -row.id,
    name: row.name,
    gstin: row.gstin ?? null,
    pan: row.pan ?? null,
    address: [row.addressLine1, row.addressLine2].filter(Boolean).join(", ") || null,
    city: row.city ?? null,
    state: row.state ?? null,
    pincode: row.pincode ?? null,
    phone: row.signatoryPhone ?? null,
    email: row.signatoryEmail ?? null,
    bankName: row.bankName ?? null,
    bankAccount: row.accountNo ?? null,
    bankIfsc: row.ifsc ?? null,
    bankBranch: row.bankBranch ?? null,
    logoUrl: row.logoUrl ?? null,
    signatureUrl: null,
    quotePrefix: (row.code || "NM").split("/")[0] || "NM",
    defaultTerms: null,
    active: row.isActive,
    createdAt: row.createdAt,
    _source: "companies",
  };
}

// R27.15 — UNION of the legacy quoting_companies table and the user-managed
// companies table (active only), so quotations created in the Admin "Companies"
// page are visible in the New Quotation wizard. Dedupe by GSTIN, with the
// companies row winning (it is the one the user actively maintains).
export async function listAllQuotingEntities(): Promise<QuotingCompany[]> {
  const qc = db.select().from(quotingCompanies).orderBy(quotingCompanies.name).all();
  const c = db.select().from(companies).where(eq(companies.isActive, true)).orderBy(companies.name).all();
  const cMapped = c.map(mapCompanyToQuotingCompany);
  const seenGstins = new Set(cMapped.filter((x) => x.gstin).map((x) => x.gstin!.trim().toUpperCase()));
  const qcFiltered = qc.filter((x) => !x.gstin || !seenGstins.has(x.gstin.trim().toUpperCase()));
  return [...cMapped, ...qcFiltered].sort((a, b) => a.name.localeCompare(b.name));
}

// R27.15 — resolve a quoting-company id from either source. Negative ids map to a
// companies-table row; positive ids hit the legacy quoting_companies table.
export async function resolveQuotingEntity(id: number): Promise<QuotingCompany | undefined> {
  if (id < 0) {
    const row = db.select().from(companies).where(eq(companies.id, -id)).get();
    return row ? mapCompanyToQuotingCompany(row) : undefined;
  }
  return getQuotingCompany(id);
}

// -------- DATA TEAM USERS --------
const DATA_TEAM_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function listDataTeamUsers(): Promise<Omit<DataTeamUser, "passwordHash">[]> {
  const rows = db.select().from(dataTeamUsers).orderBy(desc(dataTeamUsers.createdAt)).all();
  return rows.map(({ passwordHash: _ph, ...rest }) => rest);
}
export async function getDataTeamUser(id: number): Promise<DataTeamUser | undefined> {
  return db.select().from(dataTeamUsers).where(eq(dataTeamUsers.id, id)).get();
}
export async function getDataTeamUserByUsername(username: string): Promise<DataTeamUser | undefined> {
  return db.select().from(dataTeamUsers).where(eq(dataTeamUsers.username, username)).get();
}
export async function createDataTeamUser(data: {
  username: string;
  passwordHash: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
}): Promise<DataTeamUser> {
  return db.insert(dataTeamUsers).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name || null,
    email: data.email || null,
    phone: data.phone || null,
    // R26.5 (D1) — honor an explicit role; defaults to data_team for back-compat.
    role: data.role || "data_team",
    active: true,
    createdAt: Date.now(),
  } as any).returning().get();
}
export async function updateDataTeamUser(id: number, data: Partial<DataTeamUser>): Promise<DataTeamUser | undefined> {
  const { id: _id, createdAt: _ca, ...rest } = data as any;
  return db.update(dataTeamUsers).set(rest).where(eq(dataTeamUsers.id, id)).returning().get();
}
export async function createDataTeamSession(userId: number): Promise<DataTeamSession> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  return db.insert(dataTeamSessions).values({
    userId,
    token,
    expiresAt: now + DATA_TEAM_SESSION_TTL_MS,
    createdAt: now,
  }).returning().get();
}
export async function getDataTeamSession(token: string): Promise<DataTeamSession | undefined> {
  const row = db.select().from(dataTeamSessions).where(eq(dataTeamSessions.token, token)).get();
  if (!row) return undefined;
  if (row.expiresAt < Date.now()) {
    db.delete(dataTeamSessions).where(eq(dataTeamSessions.token, token)).run();
    return undefined;
  }
  return row;
}
export async function deleteDataTeamSession(token: string): Promise<void> {
  db.delete(dataTeamSessions).where(eq(dataTeamSessions.token, token)).run();
}
export async function touchDataTeamUserLogin(id: number): Promise<void> {
  db.update(dataTeamUsers).set({ lastLogin: Date.now() }).where(eq(dataTeamUsers.id, id)).run();
}

// -------- PARTS MASTER --------

// Round 4: enriched parts master row — adds brand/last-customer/last-discount/last-quoted-at by
// joining the latest matching quotation_items row per (partNumber, brand) combo. Used by the
// Parts Master page (TeamParts) and by Procurement when sourcing a part.
export interface EnrichedPartsMasterRow {
  id: number;
  partNumber: string;
  name: string;
  brand: string | null;
  hsn: string | null;
  gstRate: number | null;
  lastMrp: number | null;
  lastSource: string | null;
  lastUpdated: number | null;
  useCount: number | null;
  // enrichment
  lastDiscount: number | null;
  lastCustomerName: string | null;
  lastCustomerCode: string | null;
  lastQuotedAt: number | null;
  totalQuotesCount: number;
}

export function searchPartsEnriched(q: string, limit = 50): EnrichedPartsMasterRow[] {
  if (!q || q.length < 3) return [];
  const term = q.toLowerCase();
  const likeTerm = `%${term}%`;
  const rows = sqlite.prepare(`
    SELECT
      pm.id              AS id,
      pm.part_number     AS partNumber,
      pm.name            AS name,
      pm.brand           AS brand,
      pm.hsn             AS hsn,
      pm.gst_rate        AS gstRate,
      pm.last_mrp        AS lastMrp,
      pm.last_source     AS lastSource,
      pm.last_updated    AS lastUpdated,
      pm.use_count       AS useCount,
      (
        SELECT qi.discount
        FROM quotation_items qi
        WHERE LOWER(qi.part_number) = LOWER(pm.part_number)
        ORDER BY qi.created_at DESC LIMIT 1
      ) AS lastDiscount,
      (
        SELECT c.name
        FROM quotation_items qi
        LEFT JOIN quotations q ON q.id = qi.quotation_id
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE LOWER(qi.part_number) = LOWER(pm.part_number)
        ORDER BY qi.created_at DESC LIMIT 1
      ) AS lastCustomerName,
      (
        SELECT c.customer_code
        FROM quotation_items qi
        LEFT JOIN quotations q ON q.id = qi.quotation_id
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE LOWER(qi.part_number) = LOWER(pm.part_number)
        ORDER BY qi.created_at DESC LIMIT 1
      ) AS lastCustomerCode,
      (
        SELECT q.created_at
        FROM quotation_items qi
        LEFT JOIN quotations q ON q.id = qi.quotation_id
        WHERE LOWER(qi.part_number) = LOWER(pm.part_number)
        ORDER BY qi.created_at DESC LIMIT 1
      ) AS lastQuotedAt,
      (
        SELECT COUNT(*)
        FROM quotation_items qi
        WHERE LOWER(qi.part_number) = LOWER(pm.part_number)
      ) AS totalQuotesCount
    FROM parts_master pm
    WHERE LOWER(pm.search_text) LIKE ?
       OR LOWER(pm.part_number) LIKE ?
       OR LOWER(pm.name) LIKE ?
       OR LOWER(COALESCE(pm.brand, '')) LIKE ?
    ORDER BY pm.use_count DESC, pm.last_updated DESC
    LIMIT ?
  `).all(likeTerm, likeTerm, likeTerm, likeTerm, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    partNumber: r.partNumber,
    name: r.name,
    brand: r.brand || null,
    hsn: r.hsn || null,
    gstRate: r.gstRate != null ? Number(r.gstRate) : null,
    lastMrp: r.lastMrp != null ? Number(r.lastMrp) : null,
    lastSource: r.lastSource || null,
    lastUpdated: r.lastUpdated ? Number(r.lastUpdated) : null,
    useCount: r.useCount != null ? Number(r.useCount) : 0,
    lastDiscount: r.lastDiscount != null ? Number(r.lastDiscount) : null,
    lastCustomerName: r.lastCustomerName || null,
    lastCustomerCode: r.lastCustomerCode || null,
    lastQuotedAt: r.lastQuotedAt ? Number(r.lastQuotedAt) : null,
    totalQuotesCount: Number(r.totalQuotesCount || 0),
  }));
}

// Per-part quote history (used by the "Show history" expander on the Parts Master page).
export interface PartQuoteHistoryRow {
  quotationId: number;
  quoteNo: string;
  customerName: string | null;
  customerCode: string | null;
  brand: string | null;
  mrp: number | null;
  discount: number | null;
  qty: number | null;
  quotedAt: number | null;
}

export function getPartQuoteHistory(partNumber: string, limit = 10): PartQuoteHistoryRow[] {
  if (!partNumber) return [];
  const rows = sqlite.prepare(`
    SELECT
      q.id              AS quotationId,
      q.quote_no        AS quoteNo,
      c.name            AS customerName,
      c.customer_code   AS customerCode,
      qi.brand          AS brand,
      qi.mrp            AS mrp,
      qi.discount       AS discount,
      qi.qty            AS qty,
      q.created_at      AS quotedAt
    FROM quotation_items qi
    LEFT JOIN quotations q ON q.id = qi.quotation_id
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE LOWER(qi.part_number) = LOWER(?)
    ORDER BY q.created_at DESC
    LIMIT ?
  `).all(partNumber.trim(), limit) as any[];
  return rows.map((r) => ({
    quotationId: Number(r.quotationId),
    quoteNo: r.quoteNo || "",
    customerName: r.customerName || null,
    customerCode: r.customerCode || null,
    brand: r.brand || null,
    mrp: r.mrp != null ? Number(r.mrp) : null,
    discount: r.discount != null ? Number(r.discount) : null,
    qty: r.qty != null ? Number(r.qty) : null,
    quotedAt: r.quotedAt ? Number(r.quotedAt) : null,
  }));
}

export async function searchParts(q: string, limit = 20): Promise<PartsMaster[]> {
  if (!q || q.length < 3) return [];
  const searchQ = `%${q.toLowerCase()}%`;
  return db.select().from(partsMaster)
    .where(or(
      like(partsMaster.searchText, searchQ),
      like(partsMaster.partNumber, searchQ),
      like(partsMaster.name, searchQ),
    ))
    .orderBy(desc(partsMaster.useCount))
    .limit(limit)
    .all();
}
export async function getPartByNumber(partNumber: string): Promise<PartsMaster | undefined> {
  return db.select().from(partsMaster).where(eq(partsMaster.partNumber, partNumber.trim())).get();
}
export async function listParts(opts: { limit?: number; offset?: number } = {}): Promise<PartsMaster[]> {
  let q: any = db.select().from(partsMaster).orderBy(desc(partsMaster.useCount), desc(partsMaster.lastUpdated));
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.offset(opts.offset);
  return q.all();
}

// -------- QUOTATIONS --------
function generateQuotationNo(prefix = "NM"): string {
  const d = new Date();
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const pfx = `${prefix}-${yyyymm}-`;
  const row = db.select({ c: sql<number>`COUNT(*)` }).from(quotations).where(like(quotations.quoteNo, `${pfx}%`)).get();
  const next = ((row?.c as number) || 0) + 1;
  return `${pfx}${String(next).padStart(4, "0")}`;
}

export async function listQuotations(opts: {
  status?: string;
  customerId?: number;
  createdByUserId?: number;
  fromDate?: number; // unix ms
  toDate?: number;   // unix ms
  q?: string;        // search quote_no or notes
  page?: number;
  limit?: number;
} = {}): Promise<{ rows: Quotation[]; total: number }> {
  const conds: any[] = [];
  // R20.1: exclude soft-deleted quotations.
  conds.push(sql`deleted_at IS NULL`);
  if (opts.status) conds.push(eq(quotations.status, opts.status));
  if (opts.customerId) conds.push(eq(quotations.customerId, opts.customerId));
  if (opts.createdByUserId) conds.push(eq(quotations.createdByUserId, opts.createdByUserId));
  if (opts.fromDate) conds.push(sql`${quotations.createdAt} >= ${opts.fromDate}`);
  if (opts.toDate) conds.push(sql`${quotations.createdAt} <= ${opts.toDate}`);
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim().toLowerCase()}%`;
    conds.push(sql`(LOWER(${quotations.quoteNo}) LIKE ${term} OR LOWER(COALESCE(${quotations.notes}, '')) LIKE ${term})`);
  }

  let q: any = db.select().from(quotations);
  let countQ: any = db.select({ c: sql<number>`COUNT(*)` }).from(quotations);
  if (conds.length) {
    const where = conds.length === 1 ? conds[0] : and(...conds);
    q = q.where(where);
    countQ = countQ.where(where);
  }
  const total = (countQ.get()?.c as number) || 0;
  const limit = opts.limit || 20;
  const offset = ((opts.page || 1) - 1) * limit;
  q = q.orderBy(desc(quotations.createdAt)).limit(limit).offset(offset);
  return { rows: q.all(), total };
}
export async function getQuotation(id: number): Promise<Quotation | undefined> {
  return db.select().from(quotations).where(eq(quotations.id, id)).get();
}
export async function getQuotationWithItems(id: number): Promise<{ quotation: Quotation; items: QuotationItem[] } | undefined> {
  const quotation = await getQuotation(id);
  if (!quotation) return undefined;
  const items = db.select().from(quotationItems).where(eq(quotationItems.quotationId, id)).orderBy(quotationItems.lineNo).all();
  return { quotation, items };
}
/**
 * Round 3: Single source of truth for quotation totals.
 * Used on create + update so DB-stored values stay in sync with what's rendered
 * (PDF service + list endpoint use the same formula as a fallback).
 */
export function computeQuoteTotals(
  items: Array<{ qty?: number | null; mrp?: number | null; discount?: number | null; gstPct?: number | null }>,
): { subtotal: number; totalDiscount: number; totalTax: number; grandTotal: number } {
  let sub = 0, disc = 0, tax = 0, grand = 0;
  for (const it of items) {
    const qty = Number(it.qty || 0);
    const mrp = Number(it.mrp || 0);
    const dPct = Number(it.discount || 0);
    const gPct = Number(it.gstPct || 0);
    const lineGross = qty * mrp;
    const lineDisc = lineGross * (dPct / 100);
    const lineNet = lineGross - lineDisc;
    const lineTax = lineNet * (gPct / 100);
    sub += lineGross;
    disc += lineDisc;
    tax += lineTax;
    grand += lineNet + lineTax;
  }
  return {
    subtotal: Math.round(sub * 100) / 100,
    totalDiscount: Math.round(disc * 100) / 100,
    totalTax: Math.round(tax * 100) / 100,
    grandTotal: Math.round(grand * 100) / 100,
  };
}

export async function createQuotation(
  data: InsertQuotation,
  items: Omit<InsertQuotationItem, "quotationId">[],
  companyPrefix?: string,
): Promise<{ quotation: Quotation; items: QuotationItem[] }> {
  const quoteNo = generateQuotationNo(companyPrefix || "NM");
  const now = Date.now();
  // Persist computed totals so list / reports never show ₹0 for a real quote.
  const totals = computeQuoteTotals(items as any[]);
  const quotation = db.insert(quotations).values({
    ...data,
    quoteNo,
    status: data.status || "draft",
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    totalTax: totals.totalTax,
    grandTotal: totals.grandTotal,
    createdAt: now,
    updatedAt: now,
  } as any).returning().get();

  const savedItems: QuotationItem[] = [];
  for (const item of items) {
    const saved = db.insert(quotationItems).values({
      ...item,
      quotationId: quotation.id,
      createdAt: now,
    } as any).returning().get();
    savedItems.push(saved);
  }

  return { quotation, items: savedItems };
}
export async function updateQuotation(id: number, data: Partial<Quotation>): Promise<Quotation | undefined> {
  const { id: _id, createdAt: _ca, quoteNo: _qn, ...rest } = data as any;
  return db.update(quotations).set({ ...rest, updatedAt: Date.now() }).where(eq(quotations.id, id)).returning().get();
}
export async function updateQuotationItems(quotationId: number, items: Omit<InsertQuotationItem, "quotationId">[]): Promise<QuotationItem[]> {
  // Delete existing items and re-insert
  db.delete(quotationItems).where(eq(quotationItems.quotationId, quotationId)).run();
  const now = Date.now();
  const saved: QuotationItem[] = [];
  for (const item of items) {
    const s = db.insert(quotationItems).values({ ...item, quotationId, createdAt: now } as any).returning().get();
    saved.push(s);
  }
  // Round 3: also refresh the parent quotation's totals so the list view + reports stay accurate.
  const totals = computeQuoteTotals(items as any[]);
  db.update(quotations).set({
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    totalTax: totals.totalTax,
    grandTotal: totals.grandTotal,
    updatedAt: now,
  } as any).where(eq(quotations.id, quotationId)).run();
  return saved;
}
export async function deleteQuotation(id: number): Promise<void> {
  db.delete(quotationItems).where(eq(quotationItems.quotationId, id)).run();
  db.delete(quotations).where(eq(quotations.id, id)).run();
}
// R20.1: soft delete — keep the row but hide it from LIST endpoints.
export async function softDeleteQuotation(id: number): Promise<void> {
  const now = Date.now();
  sqlite.prepare(`UPDATE quotations SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
}
export async function duplicateQuotation(id: number): Promise<{ quotation: Quotation; items: QuotationItem[] } | undefined> {
  const result = await getQuotationWithItems(id);
  if (!result) return undefined;
  const { quotation, items } = result;
  const newItems = items.map((item) => {
    const { id: _id, quotationId: _qi, createdAt: _ca, ...rest } = item;
    return rest;
  });
  return createQuotation(
    {
      quotingCompanyId: quotation.quotingCompanyId,
      customerId: quotation.customerId,
      status: "draft",
      currency: quotation.currency,
      fxRate: quotation.fxRate,
      subtotal: quotation.subtotal,
      totalDiscount: quotation.totalDiscount,
      totalTax: quotation.totalTax,
      grandTotal: quotation.grandTotal,
      validUntil: quotation.validUntil,
      notes: quotation.notes,
      terms: quotation.terms,
      createdByUserId: quotation.createdByUserId,
    } as InsertQuotation,
    newItems,
  );
}

// -------- AUDIT LOGS --------
export async function writeAuditLog(data: {
  actorType: string;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  beforeJson?: string;
  afterJson?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    db.insert(auditLogs).values({ ...data, createdAt: Date.now() } as any).run();
  } catch (e: any) {
    console.error("[audit] write error:", e?.message);
  }
}
export async function listAuditLogs(opts: {
  actorType?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
} = {}): Promise<{ rows: AuditLog[]; total: number }> {
  const conds: any[] = [];
  if (opts.actorType) conds.push(eq(auditLogs.actorType, opts.actorType));
  if (opts.actorId) conds.push(eq(auditLogs.actorId, opts.actorId));
  if (opts.action) conds.push(like(auditLogs.action, `%${opts.action}%`));
  if (opts.entityType) conds.push(eq(auditLogs.entityType, opts.entityType));
  if (opts.fromDate) {
    const t = Date.parse(opts.fromDate);
    if (!Number.isNaN(t)) conds.push(gte(auditLogs.createdAt, t));
  }
  if (opts.toDate) {
    const t = Date.parse(opts.toDate);
    if (!Number.isNaN(t)) conds.push(lte(auditLogs.createdAt, t));
  }

  let q: any = db.select().from(auditLogs);
  let cq: any = db.select({ c: sql<number>`COUNT(*)` }).from(auditLogs);
  if (conds.length) {
    const where = conds.length === 1 ? conds[0] : and(...conds);
    q = q.where(where);
    cq = cq.where(where);
  }
  const total = (cq.get()?.c as number) || 0;
  const limit = opts.pageSize || opts.limit || 50;
  const offset = ((opts.page || 1) - 1) * limit;
  q = q.orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);
  return { rows: q.all(), total };
}

// -------- QUOTATION STATS --------
export async function getQuotationStats(): Promise<{ total: number; drafts: number; sentThisMonth: number; accepted: number }> {
  const total = (db.select({ c: sql<number>`COUNT(*)` }).from(quotations).get()?.c as number) || 0;
  const drafts = (db.select({ c: sql<number>`COUNT(*)` }).from(quotations).where(eq(quotations.status, "draft")).get()?.c as number) || 0;
  const accepted = (db.select({ c: sql<number>`COUNT(*)` }).from(quotations).where(eq(quotations.status, "accepted")).get()?.c as number) || 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sentThisMonth = (db.select({ c: sql<number>`COUNT(*)` }).from(quotations)
    .where(and(eq(quotations.status, "sent"), gte(quotations.createdAt, monthStart))).get()?.c as number) || 0;
  return { total, drafts, sentThisMonth, accepted };
}

// -------- EMAIL INBOX --------
export async function listEmailInbox(opts: { processed?: boolean; limit?: number } = {}): Promise<EmailInboxRow[]> {
  const conds: any[] = [];
  if (opts.processed !== undefined) conds.push(eq(emailInbox.processed, opts.processed));
  let q: any = db.select().from(emailInbox);
  if (conds.length) q = q.where(conds[0]);
  q = q.orderBy(desc(emailInbox.receivedAt));
  if (opts.limit) q = q.limit(opts.limit);
  return q.all();
}
export async function getEmailInboxRow(id: number): Promise<EmailInboxRow | undefined> {
  return db.select().from(emailInbox).where(eq(emailInbox.id, id)).get();
}
export async function markEmailProcessed(id: number, rfqId?: number): Promise<void> {
  db.update(emailInbox).set({ processed: true, processedAt: Date.now(), rfqId: rfqId || null }).where(eq(emailInbox.id, id)).run();
}

// -------- CUSTOMER CHAT --------
export async function getChatHistory(customerId: number, limit = 50): Promise<CustomerChatMessage[]> {
  return db.select().from(customerChatMessages)
    .where(eq(customerChatMessages.customerId, customerId))
    .orderBy(customerChatMessages.createdAt)
    .limit(limit)
    .all();
}
export async function saveChatMessage(customerId: number, role: "user" | "assistant", content: string): Promise<CustomerChatMessage> {
  return db.insert(customerChatMessages).values({
    customerId,
    role,
    content,
    createdAt: Date.now(),
  }).returning().get();
}

// -------- ACCOUNT REQUESTS --------
export async function listAccountRequests(status?: string): Promise<AccountRequest[]> {
  if (status) {
    return db.select().from(accountRequests).where(eq(accountRequests.status, status)).orderBy(desc(accountRequests.createdAt)).all();
  }
  return db.select().from(accountRequests).orderBy(desc(accountRequests.createdAt)).all();
}
export async function getAccountRequest(id: number): Promise<AccountRequest | undefined> {
  return db.select().from(accountRequests).where(eq(accountRequests.id, id)).get();
}
export async function createAccountRequest(data: InsertAccountRequest): Promise<AccountRequest> {
  return db.insert(accountRequests).values({ ...data, status: "pending", createdAt: Date.now() } as any).returning().get();
}
export async function updateAccountRequestStatus(
  id: number,
  status: "approved" | "rejected",
  reviewedByAdminId: string,
  reviewNotes?: string,
): Promise<AccountRequest | undefined> {
  return db.update(accountRequests)
    .set({ status, reviewedByAdminId, reviewNotes: reviewNotes || null, reviewedAt: Date.now() })
    .where(eq(accountRequests.id, id))
    .returning()
    .get();
}

// -------- FX RATES (storage for cache) --------
export async function getCachedFxRate(from: string, to: string, maxAgeMs: number): Promise<FxRate | undefined> {
  const minFetchedAt = Date.now() - maxAgeMs;
  return db.select().from(fxRates)
    .where(and(eq(fxRates.baseCurrency, from.toUpperCase()), eq(fxRates.targetCurrency, to.toUpperCase()), gte(fxRates.fetchedAt, minFetchedAt)))
    .orderBy(desc(fxRates.fetchedAt))
    .get();
}

// -------- ADMIN SEARCH (D2) --------
export async function globalSearch(q: string, types: string[]): Promise<Record<string, any[]>> {
  if (!q || q.trim().length < 2) return {};
  const like_ = `%${q}%`;
  const result: Record<string, any[]> = {};

  if (!types.length || types.includes("customers")) {
    result.customers = db.select().from(customers).where(
      or(like(customers.name, like_), like(customers.phone, like_), like(customers.email, like_))
    ).limit(10).all();
  }
  if (!types.length || types.includes("quotations")) {
    result.quotations = db.select().from(quotations).where(
      or(like(quotations.quoteNo, like_))
    ).limit(10).all();
  }
  if (!types.length || types.includes("rfqs")) {
    result.rfqs = db.select().from(rfqs).where(
      or(like(rfqs.notes, like_), like(rfqs.contactName, like_))
    ).limit(10).all();
  }
  if (!types.length || types.includes("pos")) {
    result.pos = db.select().from(purchaseOrders).where(
      or(like(purchaseOrders.customerPoNumber, like_))
    ).limit(10).all();
  }
  if (!types.length || types.includes("products")) {
    result.products = db.select().from(partsMaster).where(
      or(like(partsMaster.name, like_), like(partsMaster.partNumber, like_))
    ).limit(10).all();
  }

  return result;
}

// Alias functions that index.ts uses for PO reminder
export async function getStalePurchaseOrders(days: number): Promise<PurchaseOrder[]> {
  return listPendingPurchaseOrdersOlderThan(days);
}
export async function incrementPoReminder(id: number): Promise<void> {
  return bumpPoReminder(id);
}

// -------- PART SUGGESTIONS (Bug 3: autocomplete) --------
export interface PartSuggestion {
  partNumber: string;
  productName: string;
  brand: string | null;
  mrp: number | null;
  hsnCode: string | null;
  gstPercent: number | null;
  source: "price_list" | "past_entry";
  entryDate: number | null;
  // Round 3 enrichment: last time this part was quoted to a customer
  lastDiscount: number | null;
  lastCustomerName: string | null;
  lastQuotedAt: number | null;
}

/**
 * Returns up to `limit` part suggestions matching `q` in partNumber OR productName/description.
 * Sources searched:
 *   1. price_items (price_list table) — joined with price_lists for upload date
 *   2. quotation_items (past_entry) — most recent matching row per partNumber+brand combo
 *
 * Ordering: exact partNumber match first, prefix match next, then substring. Within each tier
 * most recent entry wins. Deduplication: by partNumber + brand combo (brand-level granularity).
 */
export function getPartSuggestions(q: string, limit = 10): PartSuggestion[] {
  const cap = Math.min(limit, 25);
  if (!q || q.trim().length < 2) return [];
  const term = q.trim().toLowerCase();
  const likeTerm = `%${term}%`;

  // ── Price list items ─────────────────────────────────────────────────────
  const priceRows = sqlite.prepare(`
    SELECT
      pi.part_number     AS partNumber,
      pi.description     AS productName,
      pi.brand           AS brand,
      pi.mrp             AS mrp,
      pi.hsn_code        AS hsnCode,
      pi.gst_percent     AS gstPercent,
      pl.uploaded_at     AS entryDate,
      CASE
        WHEN LOWER(pi.part_number) = ?         THEN 1
        WHEN LOWER(pi.part_number) LIKE ? || '%' THEN 2
        ELSE 3
      END AS tier
    FROM price_items pi
    LEFT JOIN price_lists pl ON pl.id = pi.price_list_id
    WHERE LOWER(pi.part_number) LIKE ? OR LOWER(pi.description) LIKE ?
    ORDER BY tier ASC, pl.uploaded_at DESC
    LIMIT ?
  `).all(term, term, likeTerm, likeTerm, cap * 3) as any[];

  // ── Past quotation items (enriched with last-quoted customer + discount) ─
  // Use a window function so we keep ALL columns from the most recent row per partNumber+brand
  // rather than MAX() over an arbitrary one. Last-quoted info comes from the latest quotation
  // for this part regardless of customer.
  const pastRows = sqlite.prepare(`
    SELECT * FROM (
      SELECT
        qi.part_number     AS partNumber,
        qi.product_name    AS productName,
        qi.brand           AS brand,
        qi.mrp             AS mrp,
        qi.hsn             AS hsnCode,
        qi.gst_pct         AS gstPercent,
        qi.discount        AS lastDiscount,
        c.name             AS lastCustomerName,
        q.created_at       AS lastQuotedAt,
        qi.created_at      AS entryDate,
        CASE
          WHEN LOWER(qi.part_number) = ?          THEN 1
          WHEN LOWER(qi.part_number) LIKE ? || '%' THEN 2
          ELSE 3
        END AS tier,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(qi.part_number), LOWER(COALESCE(qi.brand,''))
          ORDER BY qi.created_at DESC
        ) AS rn
      FROM quotation_items qi
      LEFT JOIN quotations q ON q.id = qi.quotation_id
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE qi.part_number IS NOT NULL
        AND (LOWER(qi.part_number) LIKE ? OR LOWER(qi.product_name) LIKE ?)
    )
    WHERE rn = 1
    ORDER BY tier ASC, entryDate DESC
    LIMIT ?
  `).all(term, term, likeTerm, likeTerm, cap * 3) as any[];

  // ── Merge and deduplicate by partNumber+brand combo ──────────────────────
  const seen = new Set<string>();
  const results: PartSuggestion[] = [];

  const addRow = (row: any, source: "price_list" | "past_entry") => {
    if (!row.partNumber) return;
    const key = `${String(row.partNumber).toLowerCase()}|${String(row.brand || "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      partNumber: row.partNumber,
      productName: row.productName || "",
      brand: row.brand || null,
      mrp: row.mrp != null ? Number(row.mrp) : null,
      hsnCode: row.hsnCode || null,
      gstPercent: row.gstPercent != null ? Number(row.gstPercent) : null,
      source,
      entryDate: row.entryDate ? Number(row.entryDate) : null,
      lastDiscount: row.lastDiscount != null ? Number(row.lastDiscount) : null,
      lastCustomerName: row.lastCustomerName || null,
      lastQuotedAt: row.lastQuotedAt ? Number(row.lastQuotedAt) : null,
    });
  };

  // Interleave by tier: exact first, then prefix, then substring
  for (let tier = 1; tier <= 3 && results.length < cap; tier++) {
    for (const r of priceRows.filter((x: any) => x.tier === tier)) { if (results.length >= cap) break; addRow(r, "price_list"); }
    for (const r of pastRows.filter((x: any) => x.tier === tier)) { if (results.length >= cap) break; addRow(r, "past_entry"); }
  }

  return results.slice(0, cap);
}

// =============================================================
// ROUNDS 4.4 → 7 STORAGE
// =============================================================
import {
  vendors, vendorContacts, companies, purchaseOrdersV2, poItems,
  rfqsV2, rfqItems, rfqVendors, rfqQuotes, vendorConversations,
  warehouses, warehouseTransfers, rateHistory, leads, leadActivities,
  targets, announcements, taskItems, ledgerQueries, dispatches,
  poItemVendorQuotes,
} from "@shared/schema";
import type {
  Vendor, InsertVendor, VendorContact,
  Company, InsertCompany,
  PurchaseOrderV2, InsertPurchaseOrderV2, PoItem, InsertPoItem,
  RfqV2, InsertRfqV2, RfqItem, RfqVendor, RfqQuote,
  VendorConversation, Warehouse, InsertWarehouse,
  WarehouseTransfer, InsertWarehouseTransfer, RateHistory,
  Lead, InsertLead, LeadActivity, Target, InsertTarget,
  Announcement, InsertAnnouncement, TaskItem, InsertTaskItem,
  InsertDispatch, Dispatch,
} from "@shared/schema";

function seqNumber(table: any, col: any, prefix: string): string {
  // Format: PREFIX/YY/0001  (e.g. NM/PO/26/0001)
  const yy = String(new Date().getFullYear()).slice(-2);
  const pfx = `${prefix}/${yy}/`;
  const row = db.select({ c: sql<number>`COUNT(*)` }).from(table).where(like(col, `${pfx}%`)).get();
  const next = ((row?.c as number) || 0) + 1;
  return `${pfx}${String(next).padStart(4, "0")}`;
}

// R13.6: robust PO-number generator. The legacy COUNT(*)+1 approach (seqNumber) collides
// whenever the row count differs from the highest sequence — e.g. one active PO numbered
// NM/PO/26/0002 makes COUNT=1 → next=0002, a duplicate. Instead we take MAX(sequence)+1
// over BOTH active AND soft-deleted rows (so a historically-used number is never reused),
// then defensively confirm the candidate is free, looping past any gaps/collisions.
// FY derivation is intentionally unchanged from seqNumber (calendar year, last 2 digits).
function nextPoNumber(prefix = "NM/PO"): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const pfx = `${prefix}/${yy}/`;
  // Highest existing sequence for this FY, considering active + soft-deleted rows.
  const maxRow = sqlite
    .prepare(
      `SELECT po_number FROM purchase_orders_v2
         WHERE po_number LIKE ?
         ORDER BY CAST(SUBSTR(po_number, -4) AS INTEGER) DESC
         LIMIT 1`,
    )
    .get(`${pfx}%`) as { po_number?: string } | undefined;
  const parseSeq = (n?: string): number => {
    if (!n) return 0;
    const seq = parseInt(n.slice(-4), 10);
    return Number.isFinite(seq) ? seq : 0;
  };
  let nextSeq = parseSeq(maxRow?.po_number) + 1;
  const existsStmt = sqlite.prepare(`SELECT 1 FROM purchase_orders_v2 WHERE po_number = ? LIMIT 1`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `${pfx}${String(nextSeq).padStart(4, "0")}`;
    if (!existsStmt.get(candidate)) return candidate;
    nextSeq++;
  }
  throw new Error(`nextPoNumber: could not allocate a free PO number for ${pfx} after 100 attempts`);
}

// R26.6k — MAX-based code generator for vendors/companies. The legacy COUNT(*)+1 (seqNumber)
// collides whenever a deletion leaves a gap (e.g. 43 vendors but max seq 0048 → COUNT+1=0044,
// a duplicate). Mirror nextPoNumber: take MAX(sequence)+1 over the matching prefix, then
// defensively confirm the candidate is free, looping past any gaps/collisions.
function nextSeqCode(tableName: string, columnName: string, prefix: string): string {
  const yy = String(new Date().getFullYear()).slice(-2);
  const pfx = `${prefix}/${yy}/`;
  const maxRow = sqlite
    .prepare(
      `SELECT ${columnName} AS code FROM ${tableName}
         WHERE ${columnName} LIKE ?
         ORDER BY CAST(SUBSTR(${columnName}, -4) AS INTEGER) DESC
         LIMIT 1`,
    )
    .get(`${pfx}%`) as { code?: string } | undefined;
  const parseSeq = (n?: string): number => {
    if (!n) return 0;
    const seq = parseInt(n.slice(-4), 10);
    return Number.isFinite(seq) ? seq : 0;
  };
  let nextSeq = parseSeq(maxRow?.code) + 1;
  const existsStmt = sqlite.prepare(`SELECT 1 FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `${pfx}${String(nextSeq).padStart(4, "0")}`;
    if (!existsStmt.get(candidate)) return candidate;
    nextSeq++;
  }
  throw new Error(`nextSeqCode: could not allocate a free code for ${pfx} after 100 attempts`);
}
function nextVendorCode(): string {
  return nextSeqCode("vendors", "code", "NM/V");
}
function nextCompanyCode(): string {
  return nextSeqCode("companies", "code", "NM/C");
}

// -------- VENDORS --------
export async function listVendors(opts: { q?: string; brand?: string; category?: string; activeOnly?: boolean } = {}): Promise<Vendor[]> {
  const conds: any[] = [];
  if (opts.activeOnly) conds.push(eq(vendors.isActive, true));
  if (opts.brand) conds.push(like(vendors.brands, `%${opts.brand}%`));
  if (opts.category) conds.push(like(vendors.categories, `%${opts.category}%`));
  if (opts.q) conds.push(or(like(vendors.name, `%${opts.q}%`), like(vendors.code, `%${opts.q}%`), like(vendors.city, `%${opts.q}%`), like(vendors.phone, `%${opts.q}%`)));
  const base = db.select().from(vendors);
  const rows = conds.length ? base.where(and(...conds)).orderBy(desc(vendors.createdAt)).all() : base.orderBy(desc(vendors.createdAt)).all();
  return rows;
}
export async function getVendor(id: number): Promise<Vendor | undefined> {
  return db.select().from(vendors).where(eq(vendors.id, id)).get();
}
export async function getVendorByPhone(phone: string): Promise<Vendor | undefined> {
  const norm = phone.replace(/[^0-9]/g, "");
  const all = db.select().from(vendors).all();
  return all.find((v) => (v.whatsapp || "").replace(/[^0-9]/g, "").endsWith(norm.slice(-10)) || (v.phone || "").replace(/[^0-9]/g, "").endsWith(norm.slice(-10)));
}
export async function createVendor(data: Partial<InsertVendor>): Promise<Vendor> {
  const code = data.code || nextVendorCode();
  const now = Date.now();
  return db.insert(vendors).values({ ...data, code, name: data.name || "Unnamed", createdAt: now, updatedAt: now } as any).returning().get();
}
export async function updateVendor(id: number, data: Partial<InsertVendor>): Promise<Vendor | undefined> {
  return db.update(vendors).set({ ...data, updatedAt: Date.now() }).where(eq(vendors.id, id)).returning().get();
}
export async function deleteVendor(id: number): Promise<void> {
  db.delete(vendors).where(eq(vendors.id, id)).run();
}
export function countSellerQuotes(vendorId: number): number {
  const rows = db.select().from(poItemVendorQuotes).where(eq(poItemVendorQuotes.vendorId, vendorId)).all();
  return rows.length;
}
export async function listVendorContacts(vendorId: number): Promise<VendorContact[]> {
  return db.select().from(vendorContacts).where(eq(vendorContacts.vendorId, vendorId)).all();
}

// -------- COMPANIES --------
export async function listCompanies(activeOnly = false): Promise<Company[]> {
  const base = db.select().from(companies);
  return activeOnly ? base.where(eq(companies.isActive, true)).orderBy(desc(companies.isDefault)).all() : base.orderBy(desc(companies.isDefault)).all();
}
export async function getCompany(id: number): Promise<Company | undefined> {
  return db.select().from(companies).where(eq(companies.id, id)).get();
}
export async function getDefaultCompany(): Promise<Company | undefined> {
  return db.select().from(companies).where(eq(companies.isDefault, true)).get() || db.select().from(companies).get();
}
export async function createCompany(data: Partial<InsertCompany>): Promise<Company> {
  const code = data.code || nextCompanyCode();
  const now = Date.now();
  return db.insert(companies).values({ ...data, code, name: data.name || "Company", createdAt: now, updatedAt: now } as any).returning().get();
}
export async function updateCompany(id: number, data: Partial<InsertCompany>): Promise<Company | undefined> {
  return db.update(companies).set({ ...data, updatedAt: Date.now() }).where(eq(companies.id, id)).returning().get();
}
export async function deleteCompany(id: number): Promise<void> {
  db.delete(companies).where(eq(companies.id, id)).run();
}
export async function setDefaultCompany(id: number): Promise<void> {
  db.update(companies).set({ isDefault: false }).run();
  db.update(companies).set({ isDefault: true, updatedAt: Date.now() }).where(eq(companies.id, id)).run();
}

// -------- WAREHOUSES --------
export async function listWarehouses(activeOnly = false): Promise<Warehouse[]> {
  const base = db.select().from(warehouses);
  return activeOnly ? base.where(eq(warehouses.isActive, true)).all() : base.all();
}
export async function getWarehouse(id: number): Promise<Warehouse | undefined> {
  return db.select().from(warehouses).where(eq(warehouses.id, id)).get();
}
export async function createWarehouse(data: Partial<InsertWarehouse>): Promise<Warehouse> {
  return db.insert(warehouses).values({ ...data, code: data.code || `WH${Date.now()}`, name: data.name || "Warehouse", createdAt: Date.now() } as any).returning().get();
}
export async function updateWarehouse(id: number, data: Partial<InsertWarehouse>): Promise<Warehouse | undefined> {
  return db.update(warehouses).set(data).where(eq(warehouses.id, id)).returning().get();
}
export async function listWarehouseTransfers(): Promise<WarehouseTransfer[]> {
  return db.select().from(warehouseTransfers).orderBy(desc(warehouseTransfers.createdAt)).all();
}
export async function createWarehouseTransfer(data: Partial<InsertWarehouseTransfer>): Promise<WarehouseTransfer> {
  return db.insert(warehouseTransfers).values({ ...data, createdAt: Date.now() } as any).returning().get();
}
export async function updateWarehouseTransfer(id: number, data: Partial<WarehouseTransfer>): Promise<WarehouseTransfer | undefined> {
  return db.update(warehouseTransfers).set(data).where(eq(warehouseTransfers.id, id)).returning().get();
}

// -------- PURCHASE ORDERS (v2) --------
export async function listPurchaseOrdersV2(opts: { status?: string; customerId?: number } = {}): Promise<PurchaseOrderV2[]> {
  const conds: any[] = [];
  if (opts.status) conds.push(eq(purchaseOrdersV2.status, opts.status));
  if (opts.customerId) conds.push(eq(purchaseOrdersV2.customerId, opts.customerId));
  // R27.13 T6 — order by the editable PO date (falling back to created_at) so that
  // updating a PO's date to today floats it to the top of the list, ahead of POs with
  // older dates, until a newer PO is created/dated.
  const order = sql`COALESCE(${purchaseOrdersV2.poDate}, ${purchaseOrdersV2.createdAt}) DESC`;
  const base = db.select().from(purchaseOrdersV2);
  return conds.length ? base.where(and(...conds)).orderBy(order).all() : base.orderBy(order).all();
}
// R10 — list with live customer/cost totals + customer name for the team PO list.
export async function listPurchaseOrdersV2WithTotals(opts: { status?: string; customerId?: number; q?: string; from?: string; to?: string } = {}): Promise<Array<PurchaseOrderV2 & { customerName: string | null; companyName: string | null; companyLogoUrl: string | null; custTotal: number; costTotal: number }>> {
  const rows = await listPurchaseOrdersV2(opts);
  const mapped = rows.map((po) => {
    const items = db.select().from(poItems).where(eq(poItems.poId, po.id)).all();
    const customer = po.customerId ? db.select().from(customers).where(eq(customers.id, po.customerId)).get() : undefined;
    const company = po.companyId ? db.select().from(companies).where(eq(companies.id, po.companyId)).get() : undefined;
    const { custTotal, costTotal } = computePoTotals(items);
    // R21.2 — surface qty-deviation rollup for the Patna PO list "Deviation" column.
    const deviationCount = items.filter((it: any) => Number((it as any).isDeviated) === 1).length;
    return {
      ...po, items, customerName: customer?.name ?? null, companyName: company?.name ?? null, companyLogoUrl: company?.logoUrl ?? null, custTotal, costTotal,
      hasDeviation: deviationCount > 0, deviationCount,
    };
  });
  // R27.0 — server-side PO search across PO number, customer/company name, and the
  // part numbers + vendor names of any line item. Done after mapping so item rows are
  // already loaded; keeps "hundreds of POs" filterable without scrolling.
  const q = (opts.q || "").trim().toLowerCase();
  const filtered = q
    ? mapped.filter((po: any) => {
        const haystack: string[] = [
          po.customerPoNumber, po.internalPoNumber, `po-${po.id}`,
          po.customerName, po.companyName,
        ].filter(Boolean) as string[];
        for (const it of (po.items || [])) {
          if (it.partNumber) haystack.push(it.partNumber);
          if (it.vendorName) haystack.push(it.vendorName);
          if (it.description) haystack.push(it.description);
        }
        return haystack.some((s) => String(s).toLowerCase().includes(q));
      })
    : mapped;
  // R27.1a BUG 7 — date-range filter on the effective PO date (po_date when set, else
  // created_at). from/to are YYYY-MM-DD; to is inclusive of the whole day.
  const fromMs = opts.from ? new Date(opts.from + "T00:00:00").getTime() : null;
  const toMs = opts.to ? new Date(opts.to + "T23:59:59.999").getTime() : null;
  const dated = (fromMs != null || toMs != null)
    ? filtered.filter((po: any) => {
        const ts = Number(po.poDate ?? po.createdAt ?? 0);
        if (fromMs != null && ts < fromMs) return false;
        if (toMs != null && ts > toMs) return false;
        return true;
      })
    : filtered;
  // Strip the line items we only needed for searching back off the list payload.
  return dated.map(({ items: _items, ...rest }: any) => rest);
}
// R13: has this quotation already been converted to a PO? Used to lock the quotation's
// ordered-company once it's downstream of a PO.
export async function quotationHasPO(quotationId: number): Promise<boolean> {
  return !!db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.quotationId, quotationId)).get();
}
export async function getPurchaseOrderV2(id: number): Promise<(PurchaseOrderV2 & { items: PoItem[]; customerName: string | null; company: { id: number; name: string; logo_url: string | null } | null; custTotal: number; costTotal: number }) | undefined> {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, id)).get();
  if (!po) return undefined;
  const items = db.select().from(poItems).where(eq(poItems.poId, id)).all();
  const customer = po.customerId ? db.select().from(customers).where(eq(customers.id, po.customerId)).get() : undefined;
  const companyRow = po.companyId ? db.select().from(companies).where(eq(companies.id, po.companyId)).get() : undefined;
  const { custTotal, costTotal } = computePoTotals(items);
  return {
    ...po, items, customerName: customer?.name ?? null,
    company: companyRow ? { id: companyRow.id, name: companyRow.name, logo_url: companyRow.logoUrl ?? null } : null,
    custTotal, costTotal,
  };
}

// R26.6a (5) — admin PO detail bundle: header + lines + dispatches + payments + customer + vendor.
// The View button on the admin POs list previously 404'd because no detail route/endpoint existed.
export async function getPurchaseOrderV2Detail(id: number): Promise<any | undefined> {
  const po = await getPurchaseOrderV2(id);
  if (!po) return undefined;
  const dispatches = sqlite.prepare(
    `SELECT id, round_no, docket_no, courier_name, dispatch_date, docket_photo_url, pdf_url, bundles, submitted_at
       FROM dispatches WHERE po_id = ? ORDER BY round_no ASC, id ASC`,
  ).all(id) as any[];
  // payment_records is customer-level (no po_id FK) — surface this customer's recent receipts.
  const payments = po.customerId
    ? sqlite.prepare(
        `SELECT id, amount_inr, payment_mode, reference_no, payment_date, notes
           FROM payment_records WHERE customer_id = ? ORDER BY payment_date DESC LIMIT 50`,
      ).all(po.customerId) as any[]
    : [];
  const customer = po.customerId
    ? sqlite.prepare(`SELECT id, name, phone, email, gst_number FROM customers WHERE id = ?`).get(po.customerId)
    : null;
  // No vendor FK on the PO header — vendors live per line. Derive the distinct vendor names.
  const vendorNames = Array.from(
    new Set((po.items || []).map((it: any) => it.vendorName).filter(Boolean)),
  );
  const vendor = vendorNames.length ? { names: vendorNames } : null;
  return { po, lines: po.items, dispatches, payments, customer, vendor };
}

// Live PO totals (R10): cost = Σ(approved vendor rate × qty); customer = Σ(customer rate × qty).
export function computePoTotals(items: PoItem[]): { custTotal: number; costTotal: number } {
  let custTotal = 0;
  let costTotal = 0;
  for (const it of items) {
    const qty = Number(it.qty ?? 0) || 0;
    const cust = it.unitPrice != null ? Number(it.unitPrice) : 0;
    custTotal += cust * qty;
    const cost = it.vendorRate != null ? Number(it.vendorRate) : (it.purchaseCost != null ? Number(it.purchaseCost) : 0);
    costTotal += cost * qty;
  }
  return { custTotal, costTotal };
}
export async function createPurchaseOrderV2(data: Partial<InsertPurchaseOrderV2>, items: Partial<InsertPoItem>[] = []): Promise<PurchaseOrderV2> {
  const now = Date.now();
  // R13.6: allocate the internal PO number with the robust MAX-based generator (handles
  // gaps + historically-used soft-deleted numbers) unless the caller supplied one. The
  // allocation + insert run inside one transaction below so the SELECT-then-INSERT is atomic.
  // R13.4: a soft-deleted PO still occupies po_number under the legacy UNIQUE constraint,
  // which blocks reuse. Purge any soft-deleted row carrying a caller-supplied po_number
  // (with its child rows) before inserting. Active (deleted_at IS NULL) duplicates are
  // intentionally left alone so the insert still fails for genuine active-duplicate attempts.
  const purgeSoftDeleted = (poNumber: string) => {
    const stale = sqlite
      .prepare(`SELECT id FROM purchase_orders_v2 WHERE po_number = ? AND deleted_at IS NOT NULL`)
      .all(poNumber) as Array<{ id: number }>;
    for (const row of stale) {
      const itemIds = sqlite.prepare(`SELECT id FROM po_items WHERE po_id = ?`).all(row.id) as Array<{ id: number }>;
      for (const it of itemIds) {
        sqlite.prepare(`DELETE FROM po_item_vendor_quotes WHERE po_item_id = ?`).run(it.id);
      }
      sqlite.prepare(`DELETE FROM po_items WHERE po_id = ?`).run(row.id);
      sqlite.prepare(`DELETE FROM dispatches WHERE po_id = ?`).run(row.id);
      sqlite.prepare(`DELETE FROM purchase_orders_v2 WHERE id = ?`).run(row.id);
      console.log(`[R13.4] Purged soft-deleted PO ${row.id} with po_number=${poNumber} before reuse`);
    }
  };
  const allocateAndInsert = sqlite.transaction(() => {
    const poNumber = data.poNumber || nextPoNumber("NM/PO");
    purgeSoftDeleted(poNumber);
    const created = db.insert(purchaseOrdersV2).values({ ...data, poNumber, createdAt: now, updatedAt: now } as any).returning().get();
    for (const it of items) {
      db.insert(poItems).values({ ...it, poId: created.id } as any).run();
    }
    return created;
  });
  const po = allocateAndInsert();
  return po;
}
export async function updatePurchaseOrderV2(id: number, data: Partial<InsertPurchaseOrderV2>): Promise<PurchaseOrderV2 | undefined> {
  return db.update(purchaseOrdersV2).set({ ...data, updatedAt: Date.now() }).where(eq(purchaseOrdersV2.id, id)).returning().get();
}

// R27.1 TASK 8 — duplicate a PO: copy header (customer/company/notes/totals) + all line
// items, allocate a fresh po_number, reset dates to NOW, status back to "draft". Does NOT
// copy dispatch/docket/consignment/delhi fields (those belong to the original fulfilment).
export async function duplicatePurchaseOrderV2(id: number): Promise<PurchaseOrderV2 | undefined> {
  const src = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(id) as any;
  if (!src) return undefined;
  const items = sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(id) as any[];
  const now = Date.now();
  const dup = await createPurchaseOrderV2(
    {
      customerId: src.customer_id ?? undefined,
      companyId: src.company_id ?? undefined,
      quotationId: src.quotation_id ?? undefined,
      status: "draft",
      subtotal: src.subtotal ?? 0,
      discount: src.discount ?? 0,
      tax: src.tax ?? 0,
      total: src.total ?? 0,
      notes: src.notes ?? undefined,
      poDate: now,
    } as any,
    items.map((it) => ({
      description: it.description, partNumber: it.part_number, brand: it.brand,
      qty: it.qty, unitPrice: it.unit_price, discountPct: it.discount_pct,
      taxPct: it.tax_pct, lineTotal: it.line_total, vendorId: it.vendor_id,
      purchaseCost: it.purchase_cost, vendorRate: it.vendor_rate, vendorName: it.vendor_name,
    })) as any,
  );
  return dup;
}
export async function getPoItem(id: number): Promise<PoItem | undefined> {
  return db.select().from(poItems).where(eq(poItems.id, id)).get();
}
export async function updatePoItem(id: number, data: Partial<PoItem>): Promise<PoItem | undefined> {
  return db.update(poItems).set(data).where(eq(poItems.id, id)).returning().get();
}
// R26.2h — When a quotation's line rates (quotation_items.mrp) change AFTER it has already
// been converted to a PO (e.g. AI autofill ran after conversion), the PO's po_items.unit_price
// can be stale/0. There is no per-item FK between po_items and quotation_items; the only link
// is purchase_orders_v2.quotation_id. We therefore match po_items <-> quotation_items by
// part_number within the same quotation and copy mrp into unit_price, then recompute line_total.
// Only lines whose unit_price is 0/NULL are touched, so a deliberately-priced PO line is never
// clobbered. Header subtotal/total are refreshed from the new line totals. IDEMPOTENT + safe.
export function propagateQuotationRatesToPoItems(quotationId: number): { lines: number; pos: number } {
  try {
    const lineInfo = sqlite
      .prepare(
        `UPDATE po_items
         SET unit_price = (
               SELECT qit.mrp FROM quotation_items qit
               WHERE qit.quotation_id = (SELECT quotation_id FROM purchase_orders_v2 WHERE id = po_items.po_id)
                 AND qit.part_number IS NOT NULL
                 AND qit.part_number = po_items.part_number
                 AND qit.mrp > 0
               ORDER BY qit.line_no LIMIT 1
             ),
             line_total = COALESCE(qty, 0) * (
               SELECT qit.mrp FROM quotation_items qit
               WHERE qit.quotation_id = (SELECT quotation_id FROM purchase_orders_v2 WHERE id = po_items.po_id)
                 AND qit.part_number IS NOT NULL
                 AND qit.part_number = po_items.part_number
                 AND qit.mrp > 0
               ORDER BY qit.line_no LIMIT 1
             )
         WHERE po_items.po_id IN (SELECT id FROM purchase_orders_v2 WHERE quotation_id = ?)
           AND (po_items.unit_price IS NULL OR po_items.unit_price = 0)
           AND EXISTS (
             SELECT 1 FROM quotation_items qit
             WHERE qit.quotation_id = (SELECT quotation_id FROM purchase_orders_v2 WHERE id = po_items.po_id)
               AND qit.part_number IS NOT NULL
               AND qit.part_number = po_items.part_number
               AND qit.mrp > 0
           )`,
      )
      .run(quotationId);
    const headerInfo = sqlite
      .prepare(
        `UPDATE purchase_orders_v2
         SET subtotal = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0),
             total    = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)
         WHERE quotation_id = ?`,
      )
      .run(quotationId);
    if (lineInfo.changes > 0) {
      console.log(`[R26.2h] propagated quotation ${quotationId} mrp into ${lineInfo.changes} po_items line(s), refreshed ${headerInfo.changes} PO header(s)`);
    }
    return { lines: lineInfo.changes, pos: headerInfo.changes };
  } catch (e: any) {
    console.error(`[R26.2h] propagateQuotationRatesToPoItems failed for quotation ${quotationId}:`, e?.message || e);
    return { lines: 0, pos: 0 };
  }
}
export async function assignVendorToPoItem(id: number, vendorId: number, purchaseCost?: number): Promise<PoItem | undefined> {
  const item = db.update(poItems).set({ vendorId, purchaseCost: purchaseCost ?? null }).where(eq(poItems.id, id)).returning().get();
  if (item && item.partNumber) {
    await recordRate({ partNumber: item.partNumber, brand: item.brand || undefined, vendorId, rate: purchaseCost, source: "po", sourceId: id });
  }
  return item;
}

// -------- RFQs (v2) --------
export async function listRfqsV2(opts: { status?: string } = {}): Promise<RfqV2[]> {
  const base = db.select().from(rfqsV2);
  return opts.status ? base.where(eq(rfqsV2.status, opts.status)).orderBy(desc(rfqsV2.createdAt)).all() : base.orderBy(desc(rfqsV2.createdAt)).all();
}
export async function getRfqV2(id: number): Promise<(RfqV2 & { items: RfqItem[]; vendors: RfqVendor[]; quotes: RfqQuote[] }) | undefined> {
  const rfq = db.select().from(rfqsV2).where(eq(rfqsV2.id, id)).get();
  if (!rfq) return undefined;
  const items = db.select().from(rfqItems).where(eq(rfqItems.rfqId, id)).all();
  const vnds = db.select().from(rfqVendors).where(eq(rfqVendors.rfqId, id)).all();
  const quotes = db.select().from(rfqQuotes).where(eq(rfqQuotes.rfqId, id)).all();
  return { ...rfq, items, vendors: vnds, quotes };
}
export async function createRfqV2(data: Partial<InsertRfqV2>, items: Partial<RfqItem>[] = [], vendorIds: number[] = []): Promise<RfqV2> {
  const rfqNumber = data.rfqNumber || seqNumber(rfqsV2, rfqsV2.rfqNumber, "NM/RFQ");
  const rfq = db.insert(rfqsV2).values({ ...data, rfqNumber, createdAt: Date.now() } as any).returning().get();
  for (const it of items) db.insert(rfqItems).values({ ...it, rfqId: rfq.id } as any).run();
  for (const vid of vendorIds) db.insert(rfqVendors).values({ rfqId: rfq.id, vendorId: vid, status: "pending" } as any).run();
  return rfq;
}
export async function updateRfqV2(id: number, data: Partial<InsertRfqV2>): Promise<RfqV2 | undefined> {
  return db.update(rfqsV2).set(data).where(eq(rfqsV2.id, id)).returning().get();
}
export async function listRfqVendorsForVendor(vendorId: number, statuses: string[] = ["pending", "responded"]): Promise<RfqVendor[]> {
  return db.select().from(rfqVendors).where(eq(rfqVendors.vendorId, vendorId)).all().filter((rv) => statuses.includes(rv.status));
}
export async function markRfqVendorSent(rfqId: number, vendorId: number, whatsappMessageId?: string): Promise<void> {
  db.update(rfqVendors).set({ sentAt: Date.now(), whatsappMessageId: whatsappMessageId ?? null })
    .where(and(eq(rfqVendors.rfqId, rfqId), eq(rfqVendors.vendorId, vendorId))).run();
}
export async function createRfqQuote(data: Partial<RfqQuote>): Promise<RfqQuote> {
  const q = db.insert(rfqQuotes).values({ ...data, receivedAt: Date.now() } as any).returning().get();
  // mark vendor responded
  if (data.rfqId && data.vendorId) {
    db.update(rfqVendors).set({ status: "responded" }).where(and(eq(rfqVendors.rfqId, data.rfqId), eq(rfqVendors.vendorId, data.vendorId))).run();
  }
  // record rate history
  const item = data.itemId ? db.select().from(rfqItems).where(eq(rfqItems.id, data.itemId)).get() : undefined;
  await recordRate({
    partNumber: item?.partNumber || undefined,
    brand: item?.brand || undefined,
    vendorId: data.vendorId,
    rate: data.rate ?? undefined,
    moq: data.moq ?? undefined,
    leadTimeDays: data.leadTimeDays ?? undefined,
    source: "rfq_quote",
    sourceId: q.id,
  });
  return q;
}
export async function selectRfqWinner(quoteId: number): Promise<void> {
  const quote = db.select().from(rfqQuotes).where(eq(rfqQuotes.id, quoteId)).get();
  if (!quote) return;
  // unset other winners for same item
  if (quote.itemId) db.update(rfqQuotes).set({ isWinner: false }).where(eq(rfqQuotes.itemId, quote.itemId)).run();
  db.update(rfqQuotes).set({ isWinner: true }).where(eq(rfqQuotes.id, quoteId)).run();
  db.update(rfqsV2).set({ status: "decided" }).where(eq(rfqsV2.id, quote.rfqId)).run();
}

// -------- VENDOR CONVERSATIONS --------
export async function addVendorConversation(data: Partial<VendorConversation>): Promise<VendorConversation> {
  return db.insert(vendorConversations).values({ ...data, createdAt: Date.now() } as any).returning().get();
}
export async function listVendorConversations(vendorId: number): Promise<VendorConversation[]> {
  return db.select().from(vendorConversations).where(eq(vendorConversations.vendorId, vendorId)).orderBy(vendorConversations.createdAt).all();
}
export async function listVendorInbox(): Promise<{ vendor: Vendor; latest: VendorConversation | null; count: number }[]> {
  const allVendors = db.select().from(vendors).all();
  const out: { vendor: Vendor; latest: VendorConversation | null; count: number }[] = [];
  for (const v of allVendors) {
    const convs = db.select().from(vendorConversations).where(eq(vendorConversations.vendorId, v.id)).orderBy(desc(vendorConversations.createdAt)).all();
    if (convs.length > 0) out.push({ vendor: v, latest: convs[0], count: convs.length });
  }
  out.sort((a, b) => (b.latest?.createdAt || 0) - (a.latest?.createdAt || 0));
  return out;
}

// -------- RATE HISTORY --------
export async function recordRate(data: { partNumber?: string; brand?: string; vendorId?: number; rate?: number; moq?: number; leadTimeDays?: number; source: string; sourceId?: number }): Promise<void> {
  if (!data.partNumber && !data.vendorId) return;
  db.insert(rateHistory).values({
    partNumber: data.partNumber ?? null, brand: data.brand ?? null, vendorId: data.vendorId ?? null,
    rate: data.rate ?? null, moq: data.moq ?? null, leadTimeDays: data.leadTimeDays ?? null,
    source: data.source, sourceId: data.sourceId ?? null, recordedAt: Date.now(),
  } as any).run();
}
export async function getPartRates(partNumber: string): Promise<{ vendorId: number | null; vendorName: string; rows: RateHistory[]; latest: number | null; avg: number | null; min: number | null; max: number | null; lastDate: number | null }[]> {
  const rows = db.select().from(rateHistory).where(eq(rateHistory.partNumber, partNumber)).orderBy(desc(rateHistory.recordedAt)).all();
  const byVendor = new Map<number | null, RateHistory[]>();
  for (const r of rows) {
    const k = r.vendorId ?? null;
    if (!byVendor.has(k)) byVendor.set(k, []);
    byVendor.get(k)!.push(r);
  }
  const out: any[] = [];
  for (const [vid, list] of Array.from(byVendor.entries())) {
    const rates = list.map((x: RateHistory) => x.rate).filter((x: number | null): x is number => x != null);
    const v = vid ? db.select().from(vendors).where(eq(vendors.id, vid)).get() : undefined;
    out.push({
      vendorId: vid, vendorName: v?.name || "—", rows: list,
      latest: list[0]?.rate ?? null,
      avg: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
      min: rates.length ? Math.min(...rates) : null,
      max: rates.length ? Math.max(...rates) : null,
      lastDate: list[0]?.recordedAt ?? null,
    });
  }
  return out;
}

// -------- DELHI WAREHOUSE QUEUE (R5.7) --------
export async function getDelhiQueue(): Promise<{ pickup: any[]; pack: any[]; dispatch: any[] }> {
  // PO items where vendor assigned; group by fulfil_status
  const items = db.select().from(poItems).where(sql`${poItems.vendorId} IS NOT NULL`).all();
  const enrich = async (it: PoItem) => {
    const vendor = it.vendorId ? db.select().from(vendors).where(eq(vendors.id, it.vendorId)).get() : undefined;
    const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, it.poId)).get();
    const customer = po?.customerId ? await getCustomer(po.customerId) : undefined;
    return {
      ...it,
      vendorName: vendor?.name || "—", vendorPhone: vendor?.phone || vendor?.whatsapp || "—", vendorAddress: vendor?.address || "—",
      clientName: customer?.name || "—", clientCity: (customer as any)?.city || "—",
      poNumber: po?.poNumber || "—",
    };
  };
  const pickup: any[] = [], pack: any[] = [], dispatch: any[] = [];
  for (const it of items) {
    const e = await enrich(it);
    if (it.fulfilStatus === "pending") pickup.push(e);
    else if (it.fulfilStatus === "collected") pack.push(e);
    else if (it.fulfilStatus === "packed") dispatch.push(e);
  }
  return { pickup, pack, dispatch };
}
export async function getStaleDelhiPickups(days = 2): Promise<PoItem[]> {
  const cutoff = Date.now() - days * 86400000;
  return db.select().from(poItems).where(and(eq(poItems.fulfilStatus, "pending"), sql`${poItems.vendorId} IS NOT NULL`)).all()
    .filter((it) => {
      const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, it.poId)).get();
      return po && (po.createdAt || 0) < cutoff;
    });
}

// -------- LEADS (R7) --------
export async function listLeads(opts: { stage?: string; source?: string; ownerId?: number; q?: string; page?: number; limit?: number } = {}): Promise<{ rows: Lead[]; total: number }> {
  const conds: any[] = [];
  if (opts.stage) conds.push(eq(leads.stage, opts.stage));
  if (opts.source) conds.push(eq(leads.source, opts.source));
  if (opts.ownerId) conds.push(eq(leads.ownerId, opts.ownerId));
  if (opts.q) conds.push(or(like(leads.name, `%${opts.q}%`), like(leads.phone, `%${opts.q}%`), like(leads.city, `%${opts.q}%`), like(leads.requirement, `%${opts.q}%`)));
  const where = conds.length ? and(...conds) : undefined;
  const totalRow = (where ? db.select({ c: sql<number>`COUNT(*)` }).from(leads).where(where) : db.select({ c: sql<number>`COUNT(*)` }).from(leads)).get();
  const limit = opts.limit || 500;
  const offset = ((opts.page || 1) - 1) * limit;
  const base = db.select().from(leads);
  const rows = (where ? base.where(where) : base).orderBy(desc(leads.createdAt)).limit(limit).offset(offset).all();
  return { rows, total: (totalRow?.c as number) || 0 };
}
export async function getLead(id: number): Promise<(Lead & { activities: LeadActivity[] }) | undefined> {
  const lead = db.select().from(leads).where(eq(leads.id, id)).get();
  if (!lead) return undefined;
  const activities = db.select().from(leadActivities).where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.createdAt)).all();
  return { ...lead, activities };
}
export async function createLead(data: Partial<InsertLead>): Promise<Lead> {
  const now = Date.now();
  return db.insert(leads).values({ ...data, name: data.name || "Lead", createdAt: now, updatedAt: now } as any).returning().get();
}
export async function updateLead(id: number, data: Partial<InsertLead>): Promise<Lead | undefined> {
  return db.update(leads).set({ ...data, updatedAt: Date.now() }).where(eq(leads.id, id)).returning().get();
}
export async function deleteLead(id: number): Promise<void> {
  db.delete(leads).where(eq(leads.id, id)).run();
}
export async function addLeadActivity(leadId: number, type: string, detail?: string, createdBy?: string): Promise<LeadActivity> {
  db.update(leads).set({ lastContactAt: Date.now(), updatedAt: Date.now() }).where(eq(leads.id, leadId)).run();
  return db.insert(leadActivities).values({ leadId, type, detail: detail ?? null, createdBy: createdBy ?? null, createdAt: Date.now() } as any).returning().get();
}
export async function bulkInsertLeads(rows: Partial<InsertLead>[]): Promise<number> {
  let n = 0;
  const now = Date.now();
  for (const r of rows) {
    if (!r.name && !r.phone) continue;
    db.insert(leads).values({ ...r, name: r.name || r.phone || "Lead", source: r.source || "import", createdAt: now, updatedAt: now } as any).run();
    n++;
  }
  return n;
}

// -------- TARGETS --------
export async function listTargets(opts: { userId?: number; periodKey?: string } = {}): Promise<Target[]> {
  const conds: any[] = [];
  if (opts.userId) conds.push(eq(targets.userId, opts.userId));
  if (opts.periodKey) conds.push(eq(targets.periodKey, opts.periodKey));
  const base = db.select().from(targets);
  return conds.length ? base.where(and(...conds)).all() : base.all();
}
export async function createTarget(data: Partial<InsertTarget>): Promise<Target> {
  const now = Date.now();
  return db.insert(targets).values({ ...data, createdAt: now, updatedAt: now } as any).returning().get();
}
export async function updateTarget(id: number, data: Partial<InsertTarget>): Promise<Target | undefined> {
  return db.update(targets).set({ ...data, updatedAt: Date.now() }).where(eq(targets.id, id)).returning().get();
}
export async function deleteTarget(id: number): Promise<void> {
  db.delete(targets).where(eq(targets.id, id)).run();
}

// -------- ANNOUNCEMENTS --------
export async function listAnnouncements(audience?: string): Promise<Announcement[]> {
  const now = Date.now();
  const all = db.select().from(announcements).orderBy(desc(announcements.createdAt)).all()
    .filter((a) => !a.expiresAt || a.expiresAt > now);
  if (!audience) return all;
  return all.filter((a) => a.audience === "all" || a.audience === audience);
}
export async function createAnnouncement(data: Partial<InsertAnnouncement>): Promise<Announcement> {
  return db.insert(announcements).values({ ...data, title: data.title || "Announcement", createdAt: Date.now() } as any).returning().get();
}
export async function deleteAnnouncement(id: number): Promise<void> {
  db.delete(announcements).where(eq(announcements.id, id)).run();
}

// -------- TASKS --------
export async function listTaskItems(opts: { assignedTo?: number; status?: string } = {}): Promise<TaskItem[]> {
  const conds: any[] = [];
  if (opts.assignedTo) conds.push(eq(taskItems.assignedTo, opts.assignedTo));
  if (opts.status) conds.push(eq(taskItems.status, opts.status));
  const base = db.select().from(taskItems);
  return conds.length ? base.where(and(...conds)).orderBy(desc(taskItems.createdAt)).all() : base.orderBy(desc(taskItems.createdAt)).all();
}
export async function createTaskItem(data: Partial<InsertTaskItem>): Promise<TaskItem> {
  const now = Date.now();
  return db.insert(taskItems).values({ ...data, title: data.title || "Task", createdAt: now, updatedAt: now } as any).returning().get();
}
export async function updateTaskItem(id: number, data: Partial<InsertTaskItem>): Promise<TaskItem | undefined> {
  return db.update(taskItems).set({ ...data, updatedAt: Date.now() }).where(eq(taskItems.id, id)).returning().get();
}
export async function deleteTaskItem(id: number): Promise<void> {
  db.delete(taskItems).where(eq(taskItems.id, id)).run();
}

// -------- LEDGER QUERIES LOG (R4.4) --------
export async function logLedgerQuery(data: { userId?: string; question: string; answer?: string; sql?: string }): Promise<void> {
  db.insert(ledgerQueries).values({ ...data, createdAt: Date.now() } as any).run();
}

// -------- R5.7 DELHI DISPATCH → CONSIGNMENT --------
// Creates a tracking consignment when a Delhi warehouse PO item is dispatched.
// Uses the CLIENT-facing rate (invoiceAmount), never the purchase cost.
export async function createConsignmentFromDispatch(input: {
  customerId?: number | null;
  partNumber?: string | null;
  qty?: number | null;
  rateInr?: number | null;
  docketNo?: string | null;
  courier?: string | null;
}): Promise<Consignment> {
  const now = Date.now();
  const customer = input.customerId ? await getCustomer(input.customerId) : undefined;
  const docket = (input.docketNo && String(input.docketNo).trim())
    || seqNumber(consignments, consignments.docketNumber, "NM/DKT");
  const qty = input.qty ?? 1;
  const amount = (input.rateInr ?? 0) * qty;
  return db.insert(consignments).values({
    docketNumber: docket,
    carrier: input.courier || null,
    origin: "Delhi",
    destination: (customer as any)?.city || (customer as any)?.state || "—",
    customerId: input.customerId ?? null,
    customerName: customer?.name || null,
    customerPhone: customer?.phone || null,
    customerEmail: customer?.email || null,
    bundlesCount: 1,
    invoiceAmount: amount,
    dispatchDate: now,
    status: "in_transit",
    notes: input.partNumber ? `Part ${input.partNumber} x${qty}` : null,
    createdBy: "delhi_warehouse",
    createdAt: now,
    updatedAt: now,
  } as any).returning().get();
}

// -------- R8: DISPATCHES --------
export async function createDispatch(data: Partial<InsertDispatch>): Promise<Dispatch> {
  const now = Date.now();
  return db.insert(dispatches).values({ ...data, createdAt: now } as any).returning().get();
}

export async function listDispatches(poId: number): Promise<Dispatch[]> {
  return db.select().from(dispatches).where(eq(dispatches.poId, poId)).orderBy(dispatches.roundNo).all();
}

export async function updateDispatch(id: number, data: Partial<InsertDispatch>): Promise<Dispatch | undefined> {
  return db.update(dispatches).set(data as any).where(eq(dispatches.id, id)).returning().get();
}

// ============================================================
// R12: PO-CENTRIC DELHI DISPATCH
// Lifecycle on po_items.fulfil_status: pending (To Pick Up) -> collected (Received)
//   -> packed (Packed) -> dispatched (Dispatched).
// "Mark Packed" auto-receives: any line below 'packed' jumps straight to 'packed'.
// Dispatch acts on the currently-'packed' lines only (partial dispatch); the rest stay.
// ============================================================

const PO_ITEM_STAGE_ORDER: Record<string, number> = { pending: 0, collected: 1, packed: 2, dispatched: 3 };

// Roll a PO's line statuses up to a single bucket = the EARLIEST (lowest) stage among any
// line that has not yet reached 'dispatched'. If every line is dispatched, bucket is
// 'dispatched'. Returns the bucket plus per-stage counts for the UI.
export function rollupPoLineStages(items: Array<{ fulfilStatus?: string | null }>): {
  bucket: string;
  counts: { pending: number; collected: number; packed: number; dispatched: number };
  packedCount: number;
  total: number;
} {
  const counts = { pending: 0, collected: 0, packed: 0, dispatched: 0 };
  for (const it of items) {
    const s = (it.fulfilStatus || "pending") as keyof typeof counts;
    if (s in counts) counts[s]++; else counts.pending++;
  }
  const total = items.length;
  let bucket = "dispatched";
  // earliest non-dispatched stage
  for (const stage of ["pending", "collected", "packed"] as const) {
    if (counts[stage] > 0) { bucket = stage; break; }
  }
  return { bucket, counts, packedCount: counts.packed, total };
}

// Delhi PO list with rolled-up line state + optional filters (from/to created_at,
// customer_id, status buckets). status is a comma list of buckets to keep.
export async function listDelhiPosWithRollup(opts: {
  from?: number; to?: number; customerId?: number; statuses?: string[]; q?: string;
} = {}): Promise<any[]> {
  const conds: string[] = ["po.status NOT IN ('draft','cancelled')"];
  const params: any[] = [];
  // R21.5 — `from`/`to` arrive as IST day-boundary ms already converted to UTC by the
  // route handler. `to` is an EXCLUSIVE upper bound (start of the day AFTER the range).
  if (opts.from != null) { conds.push("po.created_at >= ?"); params.push(opts.from); }
  if (opts.to != null) { conds.push("po.created_at < ?"); params.push(opts.to); }
  if (opts.customerId != null) { conds.push("po.customer_id = ?"); params.push(opts.customerId); }
  // R21.4 — free-text search across PO#, customer name, customer PO#, and part numbers.
  const q = (opts.q || "").trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conds.push(`(
      lower(po.po_number) LIKE ?
      OR lower(COALESCE(c.name,'')) LIKE ?
      OR lower(COALESCE(po.customer_po_number,'')) LIKE ?
      OR EXISTS (SELECT 1 FROM po_items pi WHERE pi.po_id = po.id AND lower(COALESCE(pi.part_number,'')) LIKE ?)
    )`);
    params.push(like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite.prepare(`
    SELECT po.id, po.po_number, po.status, po.created_at, po.po_date,
           po.customer_po_number, po.is_fully_dispatched, po.dispatch_round,
           po.ship_to_name, po.ship_to_address, po.ship_to_phone,
           po.urgency, po.delivery_deadline AS deliveryDeadline,
           c.name AS customer_name, c.id AS customer_id
    FROM purchase_orders_v2 po
    LEFT JOIN customers c ON c.id = po.customer_id
    ${where}
    ORDER BY po.created_at DESC
  `).all(...params) as any[];
  const keep = opts.statuses && opts.statuses.length ? new Set(opts.statuses) : null;
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const out: any[] = [];
  for (const po of rows) {
    // Only customer-safe columns are read here (qty + customer unit_price). Vendor
    // name / vendor rate / purchase cost are intentionally never selected.
    const items = sqlite.prepare(`SELECT fulfil_status AS fulfilStatus, qty, unit_price AS unitPrice, line_total AS lineTotal, is_deviated AS isDeviated FROM po_items WHERE po_id = ?`).all(po.id) as any[];
    if (items.length === 0) continue;
    const roll = rollupPoLineStages(items);
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const custTotal = items.reduce((s, it) => s + (it.lineTotal != null ? Number(it.lineTotal) : (Number(it.unitPrice) || 0) * (Number(it.qty) || 0)), 0);
    const hasPendingPickup = items.some((it) => (it.fulfilStatus || "pending") === "pending");
    const pickupPending = hasPendingPickup && po.created_at != null && Date.now() - Number(po.created_at) > TWO_DAYS;
    const row = {
      id: po.id,
      po_number: po.po_number,
      customer_id: po.customer_id,
      customer_name: po.customer_name,
      customer_po_number: po.customer_po_number,
      created_at: po.created_at,
      po_date: po.po_date,
      status: po.status,
      ship_to_name: po.ship_to_name ?? null,
      ship_to_address: po.ship_to_address ?? null,
      ship_to_phone: po.ship_to_phone ?? null,
      bucket: roll.bucket,
      counts: roll.counts,
      packed_count: roll.packedCount,
      line_count: roll.total,
      total_qty: totalQty,
      cust_total: custTotal,
      is_fully_dispatched: po.is_fully_dispatched,
      // R21.7 list-row enhancements.
      urgency: po.urgency ?? null,
      delivery_deadline: po.deliveryDeadline ?? null,
      pickup_pending_days: pickupPending ? Math.floor((Date.now() - Number(po.created_at)) / (24 * 60 * 60 * 1000)) : null,
      has_deviation: items.some((it) => Number(it.isDeviated) === 1),
    };
    if (keep && !keep.has(roll.bucket)) continue;
    out.push(row);
  }
  return out;
}

// Distinct list of customers that have at least one non-draft PO (for the Delhi filter).
export async function listDelhiCustomers(): Promise<Array<{ id: number; name: string }>> {
  return sqlite.prepare(`
    SELECT DISTINCT c.id, c.name
    FROM purchase_orders_v2 po
    JOIN customers c ON c.id = po.customer_id
    WHERE po.status NOT IN ('draft','cancelled')
    ORDER BY c.name COLLATE NOCASE ASC
  `).all() as any[];
}

// R14.1 / R17 — Customer-safe PO detail for Delhi. Surfaces customer name, customer PO#,
// full ship-to (name/address/phone), per-line customer rate + line total, the line
// fulfilment state, and (R17) the LOCKED SELLER NAME so Delhi knows who to pick up from.
// Vendor RATE / purchase cost / margin are NEVER included — stripped here at the storage
// layer, not just hidden in the UI. Vendor phone is intentionally omitted too (name only).
export async function getDelhiPoDetail(id: number): Promise<any | undefined> {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, id)).get();
  if (!po) return undefined;
  const customer = po.customerId ? db.select().from(customers).where(eq(customers.id, po.customerId)).get() : undefined;
  const items = db.select().from(poItems).where(eq(poItems.poId, id)).all();
  const roll = rollupPoLineStages(items as any);
  const safeItems = items.map((it) => ({
    id: it.id,
    part_number: it.partNumber ?? null,
    brand: it.brand ?? null,
    description: it.description ?? null,
    qty: it.qty ?? 0,
    rate: it.unitPrice ?? null,            // customer rate (what WE charge)
    line_total: it.lineTotal ?? ((it.unitPrice ?? 0) * (it.qty ?? 0)),
    // R17: locked seller NAME only — populated by approveQuote once a vendor is locked.
    // vendorRate / purchaseCost deliberately excluded.
    vendor_name: it.approvedQuoteId != null ? (it.vendorName ?? null) : null,
    fulfil_status: it.fulfilStatus ?? "pending",
    docket_number: it.docketNumber ?? null,
    carrier: it.carrier ?? null,
    bundles: it.bundles ?? null,
    // R21.2 / R21.7.4 — deviation + Patna line note (customer-safe; no vendor cost leaked).
    original_qty: (it as any).originalQty ?? null,
    is_deviated: Number((it as any).isDeviated) === 1 ? 1 : 0,
    deviation_reason: (it as any).deviationReason ?? null,
    patna_note: (it as any).patnaNote ?? null,
  }));
  const custTotal = safeItems.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
  // R21.7.6 — pickup-pending: any line still 'pending' AND PO created >2 days ago.
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const createdAt = po.createdAt ?? null;
  const hasPendingPickup = safeItems.some((it) => (it.fulfil_status || "pending") === "pending");
  const pickupPending = hasPendingPickup && createdAt != null && Date.now() - Number(createdAt) > TWO_DAYS;
  return {
    id: po.id,
    po_number: po.poNumber,
    customer_id: po.customerId ?? null,
    customer_name: customer?.name ?? null,
    customer_po_number: po.customerPoNumber ?? null,
    po_date: po.poDate ?? po.createdAt ?? null,
    created_at: createdAt,
    status: po.status,
    ship_to_name: po.shipToName ?? null,
    ship_to_address: po.shipToAddress ?? null,
    ship_to_phone: po.shipToPhone ?? null,
    bucket: roll.bucket,
    counts: roll.counts,
    packed_count: roll.packedCount,
    cust_total: custTotal,
    // R21.7 — customer urgency + delivery deadline (set by Patna).
    urgency: (po as any).urgency ?? null,
    delivery_deadline: (po as any).deliveryDeadline ?? null,
    pickup_pending_days: pickupPending && createdAt != null ? Math.floor((Date.now() - Number(createdAt)) / (24 * 60 * 60 * 1000)) : null,
    has_deviation: safeItems.some((it) => it.is_deviated === 1),
    // R26.2 — Delhi docket fields (so the PO detail can show what was uploaded).
    docket_transport: (po as any).docketTransport ?? null,
    docket_number: (po as any).docketNumber ?? null,
    docket_date: (po as any).docketDate ?? null,
    docket_slip_path: (po as any).docketSlipPath ?? null,
    items: safeItems,
  };
}

// R14.6 — Delhi dashboard pending buckets within a created_at window.
//  1. pendingDispatch: notified-to-Delhi / active POs not yet fully dispatched and
//     with no docket recorded (no dispatch row, no per-line docket number).
//  2. pendingPickup: line items still awaiting pickup (fulfil_status = 'pending').
//  3. pendingUploadDispatch: POs that are dispatched/packed but missing dispatch
//     details — either a packed PO with no dispatch row, or a dispatch row missing
//     docket / courier / bundles.
export function getDelhiDashboardPending(fromMs: number): {
  range_from: number;
  pending_dispatch: any[];
  pending_pickup: any[];
  pending_upload_dispatch: any[];
} {
  const pos = sqlite.prepare(`
    SELECT po.id, po.po_number, po.created_at, po.notified_delhi_at, po.po_date,
           po.customer_po_number, po.is_fully_dispatched, c.name AS customer_name
    FROM purchase_orders_v2 po
    LEFT JOIN customers c ON c.id = po.customer_id
    WHERE po.status NOT IN ('draft','cancelled')
      AND COALESCE(po.notified_delhi_at, po.created_at) >= ?
    ORDER BY COALESCE(po.notified_delhi_at, po.created_at) DESC
  `).all(fromMs) as any[];

  const pendingDispatch: any[] = [];
  const pendingUpload: any[] = [];
  const pendingPickup: any[] = [];

  for (const po of pos) {
    const items = sqlite.prepare(
      `SELECT fulfil_status AS fulfilStatus, qty, docket_number AS docketNumber, carrier, bundles, part_number AS partNumber, brand
         FROM po_items WHERE po_id = ?`,
    ).all(po.id) as any[];
    if (items.length === 0) continue;
    const roll = rollupPoLineStages(items as any);
    const dispatchRows = sqlite.prepare(`SELECT docket_no AS docketNo, courier_name AS courierName, bundles FROM dispatches WHERE po_id = ?`).all(po.id) as any[];
    const hasDispatchRow = dispatchRows.length > 0;
    const anyLineDocket = items.some((it) => it.docketNumber && String(it.docketNumber).trim());
    const meta = {
      id: po.id,
      po_number: po.po_number,
      customer_name: po.customer_name,
      customer_po_number: po.customer_po_number,
      created_at: po.created_at,
      notified_delhi_at: po.notified_delhi_at,
      po_date: po.po_date,
      bucket: roll.bucket,
      line_count: roll.total,
      packed_count: roll.packedCount,
    };

    // 1) Pending Dispatch — active, not fully dispatched, nothing dispatched yet.
    if (!po.is_fully_dispatched && roll.bucket !== "dispatched" && !hasDispatchRow && !anyLineDocket) {
      pendingDispatch.push(meta);
    }

    // 2) Pending Pickup — count lines still at 'pending' (awaiting pickup).
    const pickupLines = items.filter((it) => (it.fulfilStatus || "pending") === "pending");
    if (pickupLines.length > 0) {
      pendingPickup.push({ ...meta, pending_pickup_lines: pickupLines.length });
    }

    // 3) Pending Upload Dispatch-Details —
    //    (a) dispatched/has-dispatch-row but missing docket / courier / bundles, OR
    //    (b) packed lines exist but no dispatch row submitted yet.
    const dispatchMissingFields = dispatchRows.some(
      (d) => !d.docketNo || !String(d.docketNo).trim() || !d.courierName || !String(d.courierName).trim() || d.bundles == null,
    );
    const packedNoDispatch = roll.packedCount > 0 && !hasDispatchRow;
    if (dispatchMissingFields || packedNoDispatch) {
      pendingUpload.push({ ...meta, reason: packedNoDispatch ? "packed_not_dispatched" : "missing_dispatch_fields" });
    }
  }

  return {
    range_from: fromMs,
    pending_dispatch: pendingDispatch,
    pending_pickup: pendingPickup,
    pending_upload_dispatch: pendingUpload,
  };
}

// Distinct carriers used on past dispatches, for the dispatch-modal autocomplete.
export async function listDispatchCarriers(): Promise<string[]> {
  const rows = sqlite.prepare(
    `SELECT DISTINCT courier_name AS c FROM dispatches WHERE courier_name IS NOT NULL AND TRIM(courier_name) <> '' ORDER BY courier_name COLLATE NOCASE ASC`
  ).all() as any[];
  return rows.map((r) => r.c as string);
}

// Mark a single line packed. Auto-receives: any stage below 'packed' jumps to 'packed'
// and we backfill collected_at/received_at/packed_at as needed. Already dispatched lines
// are left untouched.
export async function markPoItemPacked(id: number): Promise<PoItem | undefined> {
  const item = db.select().from(poItems).where(eq(poItems.id, id)).get();
  if (!item) return undefined;
  const cur = item.fulfilStatus || "pending";
  if (cur === "dispatched" || cur === "packed") return item;
  const now = Date.now();
  const patch: any = { fulfilStatus: "packed", packedAt: now };
  if (!item.collectedAt) patch.collectedAt = now;
  if (!(item as any).receivedAt) patch.receivedAt = now;
  return db.update(poItems).set(patch).where(eq(poItems.id, id)).returning().get();
}

// R21.2 — Delhi edits a line's qty. Captures the original qty once (first deviation),
// flags is_deviated when the new qty differs from the original, recomputes line_total,
// and stamps who/when/why. Returns the updated item.
export async function deviatePoItemQty(
  id: number,
  newQty: number,
  reason: string | null,
  userId?: number | null,
): Promise<PoItem | undefined> {
  const item = db.select().from(poItems).where(eq(poItems.id, id)).get();
  if (!item) return undefined;
  const now = Date.now();
  // Original qty is whatever Patna placed — capture the first time we deviate.
  const original = (item as any).originalQty != null ? Number((item as any).originalQty) : Number(item.qty ?? 0);
  const rate = item.unitPrice != null ? Number(item.unitPrice) : 0;
  const deviated = Number(newQty) !== original;
  const patch: any = {
    qty: newQty,
    originalQty: original,
    lineTotal: rate * Number(newQty),
    isDeviated: deviated ? 1 : 0,
    deviationReason: deviated ? (reason ?? null) : null,
    deviationAt: now,
    deviatedByUserId: userId ?? null,
  };
  return db.update(poItems).set(patch).where(eq(poItems.id, id)).returning().get();
}

// R21.2 — Deviation summary for a PO: every line whose qty differs from the original.
export function getPoDeviations(poId: number): Array<{
  id: number; part_number: string | null; original_qty: number | null; new_qty: number;
  diff: number; reason: string | null; deviation_at: number | null; by: string | null;
}> {
  const rows = sqlite.prepare(
    `SELECT pi.id, pi.part_number AS partNumber, pi.qty, pi.original_qty AS originalQty,
            pi.deviation_reason AS reason, pi.deviation_at AS deviationAt,
            u.name AS byName, u.username AS byUsername
       FROM po_items pi
       LEFT JOIN data_team_users u ON u.id = pi.deviated_by_user_id
      WHERE pi.po_id = ? AND pi.is_deviated = 1`,
  ).all(poId) as any[];
  return rows.map((r) => ({
    id: r.id,
    part_number: r.partNumber ?? null,
    original_qty: r.originalQty != null ? Number(r.originalQty) : null,
    new_qty: Number(r.qty ?? 0),
    diff: Number(r.qty ?? 0) - (r.originalQty != null ? Number(r.originalQty) : 0),
    reason: r.reason ?? null,
    deviation_at: r.deviationAt ?? null,
    by: r.byName ?? r.byUsername ?? null,
  }));
}

export async function bulkMarkPoItemsPacked(ids: number[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await markPoItemPacked(id);
    if (r) n++;
  }
  return n;
}

// Dispatch the currently-'packed' lines of a PO. Stamps each with the dispatch snapshot
// (carrier, docket number, bundles, docket slip url) and flips status to 'dispatched'.
// Lines not in 'packed' are left in place (partial dispatch). Records a dispatch row and
// updates the PO status (fulfilled if all lines now dispatched, else partial).
export async function dispatchPackedLines(poId: number, data: {
  carrier: string; docketNumber: string; bundles: number; docketSlipUrl: string; submittedBy?: string;
  isInternalTransfer?: boolean;
}): Promise<{ dispatched_count: number; remaining_count: number; dispatchId: number }> {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, poId)).get();
  if (!po) throw new Error("PO not found");
  const items = db.select().from(poItems).where(eq(poItems.poId, poId)).all();
  const packed = items.filter((it) => (it.fulfilStatus || "pending") === "packed");
  if (packed.length === 0) throw new Error("No packed lines to dispatch");
  const now = Date.now();
  const round = (po as any).dispatchRound || 1;

  for (const it of packed) {
    db.update(poItems).set({
      fulfilStatus: "dispatched",
      dispatchedAt: now,
      carrier: data.carrier,
      courier: data.carrier,
      docketNumber: data.docketNumber,
      docketNo: data.docketNumber,
      bundles: data.bundles,
      docketSlipUrl: data.docketSlipUrl,
      shippedStatus: "shipped",
      shippedAt: now,
      dispatchRoundShipped: round,
    } as any).where(eq(poItems.id, it.id)).run();
  }

  const dispatch = db.insert(dispatches).values({
    poId,
    roundNo: round,
    docketNo: data.docketNumber || null,
    courierName: data.carrier || null,
    bundles: data.bundles || null,
    dispatchDate: now,
    docketPhotoUrl: data.docketSlipUrl || null,
    submittedBy: data.submittedBy || null,
    submittedAt: now,
    createdAt: now,
    isInternalTransfer: data.isInternalTransfer ? 1 : 0,
  } as any).returning().get();

  const after = db.select().from(poItems).where(eq(poItems.poId, poId)).all();
  const remaining = after.filter((it) => (it.fulfilStatus || "pending") !== "dispatched").length;
  const fullyDispatched = remaining === 0;
  db.update(purchaseOrdersV2).set({
    dispatchRound: round + 1,
    isFullyDispatched: fullyDispatched ? 1 : 0,
    delhiSubmittedAt: now,
    status: fullyDispatched ? "fulfilled" : "partial",
    updatedAt: now,
  } as any).where(eq(purchaseOrdersV2.id, poId)).run();

  return { dispatched_count: packed.length, remaining_count: remaining, dispatchId: dispatch.id };
}

// R26.2 — Delhi docket upload. A PO counts as "assigned to Delhi" once Patna has notified
// Delhi (notified_delhi_at IS NOT NULL); the same predicate gates every other Delhi endpoint.
// Returns { notFound } / { notDelhi } discriminators so the route can map to 404 / 403.
export function getDelhiPoForDocket(poId: number): { notFound: true } | { notDelhi: true } | { po: PurchaseOrderV2 } {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, poId)).get();
  if (!po || (po as any).deletedAt != null) return { notFound: true };
  if ((po as any).notifiedDelhiAt == null) return { notDelhi: true };
  return { po };
}

export function setDelhiPoDocket(poId: number, data: {
  docketTransport: string | null; docketNumber: string | null; docketDate: number | null;
  docketSlipPath?: string | null; docketBundles?: number | null;
  // R26.2c — absolute slip URL (https://host/uploads/...) for the LEGACY columns, which
  // historically store a full URL (the new docketSlipPath above stores a relative path).
  // Only present when a new file was uploaded in this request.
  docketSlipUrlAbsolute?: string | null;
}): PurchaseOrderV2 {
  const patch: any = {
    docketTransport: data.docketTransport,
    docketNumber: data.docketNumber,
    docketDate: data.docketDate,
    updatedAt: Date.now(),
  };
  // R26.2b — slip path / bundles are only overwritten when supplied, so a re-upload that omits
  // a new file (or bundles) keeps the previously stored value instead of nulling it.
  if (data.docketSlipPath !== undefined) patch.docketSlipPath = data.docketSlipPath;
  if (data.docketBundles !== undefined) patch.docketBundles = data.docketBundles;
  const updated = db.update(purchaseOrdersV2).set(patch).where(eq(purchaseOrdersV2.id, poId)).returning().get();

  // R26.2c — mirror the docket fields onto the LEGACY dispatch records that the Consignment
  // "From Delhi" view and the Team PO list/detail actually read (dispatches table + per-line
  // po_items snapshot). Without this, an Edit-Docket re-upload only refreshes the new R26.2
  // columns, leaving the legacy slip URL pointing at the old (wiped) file → ENOENT.
  // Each field is only written when supplied; dispatch_date / dispatched_at are NEVER touched
  // (they carry the semantic "when was this first dispatched").
  syncLegacyDispatchFromDocket(poId, {
    transport: data.docketTransport,
    docketNumber: data.docketNumber,
    bundles: data.docketBundles,
    slipUrlAbsolute: data.docketSlipUrlAbsolute,
  });

  return updated;
}

// R26.2c — write the Edit-Docket values back onto the legacy dispatch tables so every reader
// (Consignment, Team PO) shows the refreshed transport / docket# / bundles / slip image.
// Updates the LATEST dispatch round row (most recent by dispatch_date/id) and all dispatched
// po_items lines for the PO. A field whose value is undefined/null is skipped (preserves prior).
function syncLegacyDispatchFromDocket(poId: number, vals: {
  transport: string | null; docketNumber: string | null;
  bundles?: number | null; slipUrlAbsolute?: string | null;
}): void {
  // ----- dispatches: most recent round only -----
  const latest = sqlite.prepare(
    `SELECT id FROM dispatches WHERE po_id = ? ORDER BY dispatch_date DESC, id DESC LIMIT 1`
  ).get(poId) as any;
  if (latest) {
    const sets: string[] = [];
    const params: any[] = [];
    if (vals.transport != null) { sets.push("courier_name = ?"); params.push(vals.transport); }
    if (vals.docketNumber != null) { sets.push("docket_no = ?"); params.push(vals.docketNumber); }
    if (vals.bundles != null) { sets.push("bundles = ?"); params.push(vals.bundles); }
    if (vals.slipUrlAbsolute != null) { sets.push("docket_photo_url = ?"); params.push(vals.slipUrlAbsolute); }
    if (sets.length) {
      params.push(latest.id);
      sqlite.prepare(`UPDATE dispatches SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    }
  }

  // ----- po_items: every dispatched line for this PO -----
  const sets: string[] = [];
  const params: any[] = [];
  if (vals.transport != null) { sets.push("carrier = ?", "courier = ?"); params.push(vals.transport, vals.transport); }
  if (vals.docketNumber != null) { sets.push("docket_number = ?", "docket_no = ?"); params.push(vals.docketNumber, vals.docketNumber); }
  if (vals.bundles != null) { sets.push("bundles = ?"); params.push(vals.bundles); }
  if (vals.slipUrlAbsolute != null) { sets.push("docket_slip_url = ?"); params.push(vals.slipUrlAbsolute); }
  if (sets.length) {
    params.push(poId);
    sqlite.prepare(
      `UPDATE po_items SET ${sets.join(", ")} WHERE po_id = ? AND fulfil_status = 'dispatched'`
    ).run(...params);
  }
}

export function getDelhiPoDocket(poId: number): {
  docketTransport: string | null; docketNumber: string | null; docketDate: number | null;
  docketSlipPath: string | null; docketBundles: number | null;
} | undefined {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, poId)).get();
  if (!po) return undefined;
  // R26.2c — when the new R26.2 columns are NULL (PO dispatched before R26.2 and never
  // re-uploaded), fall back to the legacy dispatch record so the Edit Docket dialog pre-fills.
  // Legacy slip URL is an absolute URL; the dialog renders it verbatim, so no conversion needed.
  const legacy = sqlite.prepare(
    `SELECT docket_no, courier_name, bundles, docket_photo_url, dispatch_date
     FROM dispatches WHERE po_id = ? ORDER BY dispatch_date DESC, id DESC LIMIT 1`
  ).get(poId) as any;
  return {
    docketTransport: (po as any).docketTransport ?? legacy?.courier_name ?? null,
    docketNumber: (po as any).docketNumber ?? legacy?.docket_no ?? null,
    docketDate: (po as any).docketDate ?? legacy?.dispatch_date ?? null,
    docketSlipPath: (po as any).docketSlipPath ?? legacy?.docket_photo_url ?? null,
    docketBundles: (po as any).docketBundles ?? legacy?.bundles ?? null,
  };
}

// Hard-delete a PO and cascade po_items + po_item_vendor_quotes. Returns the po_number for
// the audit log / confirmation, or undefined if the PO does not exist.
export async function deletePoCascade(poId: number): Promise<{ poNumber: string } | undefined> {
  const po = db.select().from(purchaseOrdersV2).where(eq(purchaseOrdersV2.id, poId)).get();
  if (!po) return undefined;
  const items = sqlite.prepare(`SELECT id FROM po_items WHERE po_id = ?`).all(poId) as any[];
  const tx = sqlite.transaction(() => {
    for (const it of items) {
      sqlite.prepare(`DELETE FROM po_item_vendor_quotes WHERE po_item_id = ?`).run(it.id);
    }
    sqlite.prepare(`DELETE FROM po_items WHERE po_id = ?`).run(poId);
    sqlite.prepare(`DELETE FROM dispatches WHERE po_id = ?`).run(poId);
    sqlite.prepare(`DELETE FROM purchase_orders_v2 WHERE id = ?`).run(poId);
  });
  tx();
  return { poNumber: po.poNumber };
}

// R13.5: diagnostic — fetch the raw PO row for an EXACT po_number with no soft-delete
// filter, plus its line-item count. Returns the first matching row (there should be at
// most one active, but orphan/soft-deleted rows may coexist under the legacy unique).
export function getPoByNumberRaw(poNumber: string): { po: any | null; lineItemCount: number } {
  const po = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE po_number = ?`).get(poNumber) as any;
  if (!po) return { po: null, lineItemCount: 0 };
  const cnt = sqlite.prepare(`SELECT COUNT(*) AS c FROM po_items WHERE po_id = ?`).get(po.id) as any;
  return { po, lineItemCount: (cnt?.c as number) || 0 };
}

// R13.5: hard-delete EVERY PO row carrying a po_number (active OR soft-deleted), cascading
// po_items, po_item_vendor_quotes, and dispatches — mirroring the deletePoCascade pattern.
// Idempotent: returns purged=0 when nothing matches. Used to clear orphan rows that block
// po_number reuse but were not caught by the R13.4 deleted_at-only purge.
export function forcePurgePoByNumber(poNumber: string): { purged: number; poNumber: string } {
  const rows = sqlite.prepare(`SELECT id, deleted_at FROM purchase_orders_v2 WHERE po_number = ?`).all(poNumber) as any[];
  if (rows.length === 0) return { purged: 0, poNumber };
  const tx = sqlite.transaction(() => {
    for (const row of rows) {
      const items = sqlite.prepare(`SELECT id FROM po_items WHERE po_id = ?`).all(row.id) as any[];
      for (const it of items) {
        sqlite.prepare(`DELETE FROM po_item_vendor_quotes WHERE po_item_id = ?`).run(it.id);
      }
      sqlite.prepare(`DELETE FROM po_items WHERE po_id = ?`).run(row.id);
      sqlite.prepare(`DELETE FROM dispatches WHERE po_id = ?`).run(row.id);
      sqlite.prepare(`DELETE FROM purchase_orders_v2 WHERE id = ?`).run(row.id);
      console.log(`[R13.5] Force-purged PO id=${row.id} po_number=${poNumber} deleted_at=${row.deleted_at ?? "NULL"}`);
    }
  });
  tx();
  return { purged: rows.length, poNumber };
}

// Per-PO dispatch rollup for the data-team PO list. Returns a map poId -> aggregate.
export async function getDispatchSummaryForPOs(poIds: number[]): Promise<Record<number, {
  dispatches: Array<{ docket_number: string | null; docket_slip_url: string | null; carrier: string | null; bundles: number | null; dispatched_at: number | null; is_internal_transfer: number }>;
  carrier: string | null; bundles: number; docketNumbers: string[]; hasInternalTransfer: boolean;
}>> {
  const out: Record<number, any> = {};
  if (poIds.length === 0) return out;
  const placeholders = poIds.map(() => "?").join(",");
  const rows = sqlite.prepare(
    `SELECT po_id, docket_no, courier_name, bundles, docket_photo_url, dispatch_date, is_internal_transfer
     FROM dispatches WHERE po_id IN (${placeholders}) ORDER BY po_id, dispatch_date DESC, id DESC`
  ).all(...poIds) as any[];
  for (const r of rows) {
    if (!out[r.po_id]) out[r.po_id] = { dispatches: [], carrier: null, bundles: 0, docketNumbers: [], hasInternalTransfer: false };
    const bucket = out[r.po_id];
    const internal = Number(r.is_internal_transfer) === 1;
    bucket.dispatches.push({
      docket_number: r.docket_no, docket_slip_url: r.docket_photo_url,
      carrier: r.courier_name, bundles: r.bundles, dispatched_at: r.dispatch_date,
      is_internal_transfer: internal ? 1 : 0,
    });
    if (!bucket.carrier && r.courier_name) bucket.carrier = r.courier_name; // most recent
    bucket.bundles += Number(r.bundles) || 0;
    if (r.docket_no) bucket.docketNumbers.push(r.docket_no);
    if (internal) bucket.hasInternalTransfer = true;
  }
  return out;
}

// Vendors with chat activity in the trailing window (the data-team chat hub).
export async function listActiveVendorChats(sinceMs: number): Promise<Array<{
  vendor_id: number; vendor_name: string | null; last_message_at: number;
  last_message_body: string | null; message_count: number;
}>> {
  const rows = sqlite.prepare(`
    SELECT m.vendor_id AS vendor_id,
           v.name AS vendor_name,
           MAX(m.created_at) AS last_message_at,
           COUNT(m.id) AS message_count
    FROM vendor_rfq_messages m
    LEFT JOIN vendors v ON v.id = m.vendor_id
    WHERE m.vendor_id IS NOT NULL AND m.created_at >= ?
    GROUP BY m.vendor_id
    ORDER BY last_message_at DESC
  `).all(sinceMs) as any[];
  return rows.map((r) => {
    const last = sqlite.prepare(
      `SELECT body FROM vendor_rfq_messages WHERE vendor_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(r.vendor_id) as any;
    return {
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      last_message_at: r.last_message_at,
      last_message_body: last?.body ?? null,
      message_count: r.message_count,
    };
  });
}

// -------- R8: ASSIGN VENDOR TO PO ITEM (enhanced) --------
export async function assignVendorToPoItemR8(
  id: number,
  data: { vendorId?: number; vendorName?: string; vendorRate?: number; brand?: string; assignedBy?: string }
): Promise<(PoItem & { vendorName: string | null }) | undefined> {
  const now = Date.now();
  // Resolve a display name: explicit free-text wins, else look up the registered vendor.
  let resolvedName: string | null = data.vendorName?.trim() || null;
  if (!resolvedName && data.vendorId) {
    const v = await getVendor(data.vendorId);
    resolvedName = v?.name || null;
  }
  const setFields: any = {
    vendorRate: data.vendorRate ?? null,
    vendorName: resolvedName,
    assignedAt: now,
    assignedBy: data.assignedBy || null,
    purchaseCost: data.vendorRate ?? null,
  };
  if (data.vendorId != null) setFields.vendorId = data.vendorId;
  if (data.brand) setFields.brand = data.brand;
  const item = db.update(poItems)
    .set(setFields)
    .where(eq(poItems.id, id))
    .returning().get();
  if (item && item.partNumber && data.vendorId) {
    await recordRate({
      partNumber: item.partNumber,
      brand: item.brand || undefined,
      vendorId: data.vendorId,
      rate: data.vendorRate,
      source: "po",
      sourceId: id,
    });
  }
  if (!item) return undefined;
  return { ...item, vendorName: item.vendorName ?? resolvedName };
}

// -------- R8: PURCHASE HISTORY --------
export function listPurchaseHistory(opts: {
  q?: string;
  brand?: string;
  vendorId?: number;
  customerId?: number;
  fromDate?: number;
  toDate?: number;
  limit?: number;
  page?: number;
}): { rows: any[]; total: number } {
  const limit = Math.min(opts.limit || 50, 200);
  const offset = ((opts.page || 1) - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.q) {
    conditions.push(`(pi.part_number LIKE ? OR pi.description LIKE ?)`);
    const like = `%${opts.q}%`;
    params.push(like, like);
  }
  if (opts.brand) { conditions.push(`pi.brand LIKE ?`); params.push(`%${opts.brand}%`); }
  if (opts.vendorId) { conditions.push(`pi.vendor_id = ?`); params.push(opts.vendorId); }
  if (opts.customerId) { conditions.push(`po.customer_id = ?`); params.push(opts.customerId); }
  if (opts.fromDate) { conditions.push(`po.created_at >= ?`); params.push(opts.fromDate); }
  if (opts.toDate) { conditions.push(`po.created_at <= ?`); params.push(opts.toDate); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = sqlite.prepare(`
    SELECT
      pi.id, po.po_number, po.created_at AS po_date,
      c.name AS customer_name,
      pi.part_number, pi.brand, pi.qty,
      v.name AS vendor_name,
      COALESCE(pi.vendor_rate, pi.purchase_cost) AS vendor_rate,
      pi.line_total
    FROM po_items pi
    LEFT JOIN purchase_orders_v2 po ON po.id = pi.po_id
    LEFT JOIN customers c ON c.id = po.customer_id
    LEFT JOIN vendors v ON v.id = pi.vendor_id
    ${where}
    ORDER BY po.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM po_items pi
    LEFT JOIN purchase_orders_v2 po ON po.id = pi.po_id
    LEFT JOIN customers c ON c.id = po.customer_id
    LEFT JOIN vendors v ON v.id = pi.vendor_id
    ${where}
  `).get(...params) as any;

  return { rows, total: countRow?.cnt || 0 };
}

// -------- R8: DELHI PO LIST --------
export async function listDelhiActivePOs(opts: { includePending?: boolean } = {}): Promise<any[]> {
  // R11: Delhi sees ALL lines (the R8v2 vendor_id filter is reverted). Each PO carries an
  // awaiting_count so the UI can badge lines still awaiting a vendor lock. Status filter:
  // default excludes draft/cancelled and the split-off 'pending' POs unless includePending.
  const statusExclude = opts.includePending
    ? ['draft', 'cancelled']
    : ['draft', 'cancelled', 'pending'];
  const placeholders = statusExclude.map(() => "?").join(",");
  const rows = sqlite.prepare(`
    SELECT
      po.id, po.po_number, po.status, po.created_at,
      po.dispatch_round, po.is_fully_dispatched,
      po.ship_to_name, po.ship_to_address, po.ship_to_phone,
      c.name AS customer_name,
      COUNT(pi.id) AS item_count,
      SUM(CASE WHEN pi.shipped_status = 'shipped' THEN 1 ELSE 0 END) AS shipped_count,
      SUM(CASE WHEN pi.approved_quote_id IS NULL THEN 1 ELSE 0 END) AS awaiting_count
    FROM purchase_orders_v2 po
    LEFT JOIN customers c ON c.id = po.customer_id
    LEFT JOIN po_items pi ON pi.po_id = po.id
    WHERE po.is_fully_dispatched = 0 AND po.status NOT IN (${placeholders})
    GROUP BY po.id
    HAVING item_count > 0
    ORDER BY po.created_at DESC
  `).all(...statusExclude) as any[];
  return rows;
}

// ============================================================
// R9: MULTI-VENDOR RFQ QUOTES / CHAT / PAYMENTS / LEDGER
// Raw-SQL helpers (same `sqlite` handle as the rest of this file). vendor_id references
// the `vendors` table (the design doc's "sellers" maps to `vendors` here).
// ============================================================

// -------- Per-line vendor quotes --------
export function listQuotesForPoItem(poItemId: number): any[] {
  return sqlite.prepare(
    `SELECT * FROM po_item_vendor_quotes WHERE po_item_id = ? ORDER BY requested_at ASC, id ASC`
  ).all(poItemId) as any[];
}

export function getVendorQuote(id: number): any {
  return sqlite.prepare(`SELECT * FROM po_item_vendor_quotes WHERE id = ?`).get(id) as any;
}

export function addQuoteToPoItem(
  poItemId: number,
  data: { vendorId?: number | null; vendorName?: string | null; vendorPhone?: string | null; source?: string | null }
): any {
  const now = Date.now();
  // Enforce one quote row per (line, vendor) — for free-text vendors vendor_id is null and
  // the unique index permits multiple NULLs, which is intended.
  if (data.vendorId != null) {
    const existing = sqlite.prepare(
      `SELECT * FROM po_item_vendor_quotes WHERE po_item_id = ? AND vendor_id = ?`
    ).get(poItemId, data.vendorId) as any;
    if (existing) return existing;
  }
  const info = sqlite.prepare(
    `INSERT INTO po_item_vendor_quotes (po_item_id, vendor_id, vendor_name, vendor_phone, status, requested_at, source)
     VALUES (?, ?, ?, ?, 'requested', ?, ?)`
  ).run(poItemId, data.vendorId ?? null, data.vendorName ?? null, data.vendorPhone ?? null, now, data.source ?? null);
  return getVendorQuote(Number(info.lastInsertRowid));
}

export function deleteVendorQuote(id: number): boolean {
  const q = getVendorQuote(id);
  if (!q) return false;
  if (q.status === "approved") return false;
  sqlite.prepare(`DELETE FROM po_item_vendor_quotes WHERE id = ?`).run(id);
  return true;
}

export function setQuoteManualRate(
  id: number,
  data: { rate: number; taxInclusive?: number | null; taxPercent?: number | null; notes?: string | null }
): any {
  const now = Date.now();
  sqlite.prepare(
    `UPDATE po_item_vendor_quotes
     SET rate = ?, tax_inclusive = ?, tax_percent = ?, notes = ?, status = 'manual', received_at = COALESCE(received_at, ?)
     WHERE id = ?`
  ).run(data.rate, data.taxInclusive ?? null, data.taxPercent ?? null, data.notes ?? null, now, id);
  return getVendorQuote(id);
}

// Approve a quote as the winner for its PO line. Atomic: marks the quote approved,
// stamps po_items.approved_vendor_id / approved_quote_id / vendor_rate / vendor_name / vendor_id.
export function approveQuote(poItemId: number, quoteId: number): { item: any; quote: any; previousQuoteId: number | null } | null {
  const tx = sqlite.transaction(() => {
    const quote = sqlite.prepare(
      `SELECT * FROM po_item_vendor_quotes WHERE id = ? AND po_item_id = ?`
    ).get(quoteId, poItemId) as any;
    if (!quote) return null;
    const now = Date.now();
    // Tolerate an existing approval on this line: unlock the previous winner (back to a
    // received/manual-style state) so the new pick becomes the single locked vendor. Swap.
    const item0 = sqlite.prepare(`SELECT * FROM po_items WHERE id = ?`).get(poItemId) as any;
    let previousQuoteId: number | null = null;
    if (item0?.approved_quote_id && item0.approved_quote_id !== quoteId) {
      previousQuoteId = item0.approved_quote_id;
      const prev = sqlite.prepare(`SELECT * FROM po_item_vendor_quotes WHERE id = ?`).get(previousQuoteId) as any;
      const revertTo = prev && prev.rate != null ? "received" : "requested";
      sqlite.prepare(
        `UPDATE po_item_vendor_quotes SET status = ?, approved_at = NULL WHERE id = ?`
      ).run(revertTo, previousQuoteId);
    }
    sqlite.prepare(
      `UPDATE po_item_vendor_quotes SET status = 'approved', approved_at = ? WHERE id = ?`
    ).run(now, quoteId);
    // R26.2i — when a vendor quote is approved and the line has no customer rate yet
    // (unit_price 0/NULL), seed unit_price + line_total from the approved vendor_rate as a
    // safe baseline (Margin = 0). The CASE WHEN reads the PRE-update unit_price (SQLite SET
    // references resolve to old column values), so a deliberately-priced line is never
    // clobbered. unitPriceWasZero is captured before the UPDATE for logging.
    const vendorRate = quote.rate ?? null;
    const unitPriceWasZero = item0 == null || item0.unit_price == null || item0.unit_price === 0;
    sqlite.prepare(
      `UPDATE po_items
       SET approved_vendor_id = ?, approved_quote_id = ?, vendor_id = COALESCE(?, vendor_id),
           vendor_rate = ?, vendor_name = ?, purchase_cost = ?, assigned_at = ?,
           unit_price = CASE WHEN (unit_price IS NULL OR unit_price = 0) AND ? IS NOT NULL THEN ? ELSE unit_price END,
           line_total = CASE WHEN (unit_price IS NULL OR unit_price = 0) AND ? IS NOT NULL THEN ? * COALESCE(qty, 0) ELSE line_total END
       WHERE id = ?`
    ).run(
      quote.vendor_id ?? null, quoteId, quote.vendor_id ?? null,
      vendorRate, quote.vendor_name ?? null, vendorRate, now,
      vendorRate, vendorRate,
      vendorRate, vendorRate,
      poItemId
    );
    console.log(`[R26.2i approveQuote] po_id=${item0?.po_id} item_id=${poItemId} vendor_rate=${vendorRate} unit_price_set=${unitPriceWasZero && vendorRate != null}`);
    // R26.2i — refresh the PO header subtotal/total from the line totals (same shape as
    // R26.2h's propagate path) so customer-facing PO totals reflect the seeded unit_price.
    if (item0?.po_id != null) {
      sqlite.prepare(
        `UPDATE purchase_orders_v2
         SET subtotal = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0),
             total    = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)
         WHERE id = ?`
      ).run(item0.po_id);
    }
    const item = sqlite.prepare(`SELECT * FROM po_items WHERE id = ?`).get(poItemId) as any;
    return { item, quote: getVendorQuote(quoteId), previousQuoteId };
  });
  return tx();
}

export function unapprovePoItem(poItemId: number): boolean {
  const tx = sqlite.transaction(() => {
    const item = sqlite.prepare(`SELECT * FROM po_items WHERE id = ?`).get(poItemId) as any;
    if (!item) return false;
    if (item.approved_quote_id) {
      sqlite.prepare(
        `UPDATE po_item_vendor_quotes SET status = 'received', approved_at = NULL WHERE id = ?`
      ).run(item.approved_quote_id);
    }
    sqlite.prepare(
      `UPDATE po_items SET approved_vendor_id = NULL, approved_quote_id = NULL WHERE id = ?`
    ).run(poItemId);
    return true;
  });
  return tx();
}

// Collect outstanding (no-rate) quotes for a set of vendors across a set of POs, grouped by vendor.
// Used by the batched RFQ-fire endpoint to build one consolidated message per vendor.
export function collectPendingQuotesForFire(vendorIds: number[], poIds: number[]): Map<number, any[]> {
  const byVendor = new Map<number, any[]>();
  if (vendorIds.length === 0 || poIds.length === 0) return byVendor;
  const vPlace = vendorIds.map(() => "?").join(",");
  const pPlace = poIds.map(() => "?").join(",");
  const rows = sqlite.prepare(
    `SELECT q.*, pi.po_id, pi.part_number, pi.brand, pi.description, pi.qty,
            po.po_number
     FROM po_item_vendor_quotes q
     JOIN po_items pi ON pi.id = q.po_item_id
     JOIN purchase_orders_v2 po ON po.id = pi.po_id
     WHERE q.vendor_id IN (${vPlace})
       AND pi.po_id IN (${pPlace})
       AND q.status = 'requested'
       AND q.rate IS NULL
     ORDER BY q.vendor_id, pi.po_id, pi.id`
  ).all(...vendorIds, ...poIds) as any[];
  for (const r of rows) {
    if (!byVendor.has(r.vendor_id)) byVendor.set(r.vendor_id, []);
    byVendor.get(r.vendor_id)!.push(r);
  }
  return byVendor;
}

// R11: collect quotes for an explicit set of (seller_id, po_item_id) rows, grouped by vendor.
// Powers the flat-table Fire Rate Request modal's new request shape. Only DB sellers
// (vendor_id) can be addressed here; rows whose quote is already received/approved/manual are
// skipped so we never re-fire on an answered line.
export function collectPendingQuotesForFireRows(rows: Array<{ seller_id: number; po_item_id: number }>): Map<number, any[]> {
  const byVendor = new Map<number, any[]>();
  for (const { seller_id, po_item_id } of rows) {
    if (!seller_id || !po_item_id) continue;
    const q = sqlite.prepare(
      `SELECT q.*, pi.po_id, pi.part_number, pi.brand, pi.description, pi.qty, po.po_number
       FROM po_item_vendor_quotes q
       JOIN po_items pi ON pi.id = q.po_item_id
       JOIN purchase_orders_v2 po ON po.id = pi.po_id
       WHERE q.po_item_id = ? AND q.vendor_id = ?`
    ).get(po_item_id, seller_id) as any;
    if (!q) continue;
    if (["received", "approved", "manual"].includes(q.status)) continue;
    if (!byVendor.has(seller_id)) byVendor.set(seller_id, []);
    byVendor.get(seller_id)!.push(q);
  }
  return byVendor;
}

// R11: every (seller, item) pair across non-cancelled POs (optionally one PO), with quote
// status, for the flat Fire Rate Request table.
export function listSellerItemPairs(poId?: number): any[] {
  const conds = ["q.vendor_id IS NOT NULL", "po.status NOT IN ('cancelled')"];
  const params: any[] = [];
  if (poId != null) { conds.push("pi.po_id = ?"); params.push(poId); }
  return sqlite.prepare(
    `SELECT q.id AS quote_id, q.vendor_id AS seller_id, q.vendor_name AS seller_name,
            q.status, q.rate, pi.id AS po_item_id, pi.part_number, pi.brand, pi.qty,
            po.id AS po_id, po.po_number, po.customer_po_number
     FROM po_item_vendor_quotes q
     JOIN po_items pi ON pi.id = q.po_item_id
     JOIN purchase_orders_v2 po ON po.id = pi.po_id
     WHERE ${conds.join(" AND ")}
     ORDER BY q.vendor_name, po.created_at DESC, pi.id`
  ).all(...params) as any[];
}

// List vendors that currently have at least one pending (requested, no-rate) quote, with the
// open POs each is tagged on. Powers the Fire Rate Request modal.
export function listVendorsWithPendingQuotes(): any[] {
  const vendors = sqlite.prepare(
    `SELECT q.vendor_id, q.vendor_name, COUNT(*) AS pending_count
     FROM po_item_vendor_quotes q
     JOIN po_items pi ON pi.id = q.po_item_id
     JOIN purchase_orders_v2 po ON po.id = pi.po_id
     WHERE q.vendor_id IS NOT NULL AND q.status = 'requested' AND q.rate IS NULL
       AND po.status NOT IN ('cancelled')
     GROUP BY q.vendor_id
     ORDER BY pending_count DESC`
  ).all() as any[];
  for (const v of vendors) {
    v.pos = sqlite.prepare(
      `SELECT DISTINCT po.id AS po_id, po.po_number, po.customer_po_number
       FROM po_item_vendor_quotes q
       JOIN po_items pi ON pi.id = q.po_item_id
       JOIN purchase_orders_v2 po ON po.id = pi.po_id
       WHERE q.vendor_id = ? AND q.status = 'requested' AND q.rate IS NULL
       ORDER BY po.created_at DESC`
    ).all(v.vendor_id) as any[];
  }
  return vendors;
}

// -------- Vendor RFQ chat messages --------
export function addRfqMessage(data: {
  vendorId?: number | null; vendorPhone?: string | null; direction: "out" | "in";
  body?: string | null; aisensyMsgId?: string | null;
}): any {
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO vendor_rfq_messages (vendor_id, vendor_phone, direction, body, aisensy_msg_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(data.vendorId ?? null, data.vendorPhone ?? null, data.direction, data.body ?? null, data.aisensyMsgId ?? null, now);
  return sqlite.prepare(`SELECT * FROM vendor_rfq_messages WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listRfqMessages(vendorId: number, limit = 50): any[] {
  const rows = sqlite.prepare(
    `SELECT * FROM vendor_rfq_messages WHERE vendor_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(vendorId, limit) as any[];
  return rows.reverse(); // newest last
}

// Dedup guard for backfill: true if a message with this AiSensy id already exists.
export function rfqMessageExistsByAisensyId(aisensyMsgId: string): boolean {
  if (!aisensyMsgId) return false;
  const row = sqlite.prepare(
    `SELECT 1 FROM vendor_rfq_messages WHERE aisensy_msg_id = ? LIMIT 1`
  ).get(aisensyMsgId);
  return !!row;
}

// Fetch specific messages by id, scoped to a vendor (cross-vendor ids are excluded).
// Returns rows ordered oldest-first for stable prompt context.
export function getRfqMessagesByIds(vendorId: number, ids: number[]): any[] {
  const clean = (ids || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return [];
  const placeholders = clean.map(() => "?").join(",");
  const rows = sqlite.prepare(
    `SELECT * FROM vendor_rfq_messages WHERE vendor_id = ? AND id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
  ).all(vendorId, ...clean) as any[];
  return rows;
}

// -------- R18: AiSensy webhook message helpers --------
// True if a message with this external (AiSensy) id already exists — idempotency guard.
export function rfqMessageExistsByExternalId(externalId: string): boolean {
  if (!externalId) return false;
  const row = sqlite.prepare(
    `SELECT 1 FROM vendor_rfq_messages WHERE external_message_id = ? LIMIT 1`
  ).get(externalId);
  return !!row;
}

// Insert a chat message carrying an external (AiSensy) id + optional delivery status.
// Returns the inserted row, or null if the external id already existed (dup skipped).
export function addRfqMessageExternal(data: {
  vendorId?: number | null; vendorPhone?: string | null; direction: "out" | "in";
  body?: string | null; externalMessageId?: string | null; status?: string | null;
  // R27.4 BUG-16 — optional attachment carried on the message (image/pdf URL).
  attachmentUrl?: string | null; attachmentType?: string | null;
}): any | null {
  if (data.externalMessageId && rfqMessageExistsByExternalId(data.externalMessageId)) return null;
  const now = Date.now();
  try {
    const info = sqlite.prepare(
      `INSERT INTO vendor_rfq_messages (vendor_id, vendor_phone, direction, body, aisensy_msg_id, external_message_id, status, attachment_url, attachment_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.vendorId ?? null, data.vendorPhone ?? null, data.direction,
      data.body ?? null, data.externalMessageId ?? null,
      data.externalMessageId ?? null, data.status ?? null,
      data.attachmentUrl ?? null, data.attachmentType ?? null, now,
    );
    return sqlite.prepare(`SELECT * FROM vendor_rfq_messages WHERE id = ?`).get(Number(info.lastInsertRowid));
  } catch (e: any) {
    // Unique-index race: another delivery inserted the same external id first → treat as dup.
    if (String(e?.message || "").includes("UNIQUE")) return null;
    throw e;
  }
}

// R22.x webhook: apply an AI-extracted vendor rate to the most recent OPEN quote row
// for this vendor (status requested|received). Returns the updated quote row, or null if
// the vendor has no open quote line. Used by the inbound webhook so a WhatsApp rate reply
// flows straight into the procurement chat as a received quote. Additive — touches existing
// po_item_vendor_quotes only via UPDATE.
export function applyInboundRateToLatestQuote(
  vendorId: number,
  rate: number,
  notes?: string | null,
): any | null {
  if (vendorId == null || rate == null) return null;
  const open = sqlite.prepare(
    `SELECT * FROM po_item_vendor_quotes
     WHERE vendor_id = ? AND status IN ('requested','received')
     ORDER BY requested_at DESC, id DESC LIMIT 1`
  ).get(vendorId) as any;
  if (!open) return null;
  const now = Date.now();
  sqlite.prepare(
    `UPDATE po_item_vendor_quotes
     SET rate = ?, notes = COALESCE(?, notes), status = 'received',
         received_at = COALESCE(received_at, ?)
     WHERE id = ?`
  ).run(rate, notes ?? null, now, open.id);
  return getVendorQuote(open.id);
}

// Update delivery status for the message bearing this external id. No-op if not found.
export function updateRfqMessageStatusByExternalId(externalId: string, status: string): void {
  if (!externalId) return;
  sqlite.prepare(
    `UPDATE vendor_rfq_messages SET status = ? WHERE external_message_id = ?`
  ).run(status, externalId);
}

// Mark the most recent message for a phone as manually handled (operator intervened in chat).
export function markRfqChatManuallyHandled(vendorPhone: string): void {
  if (!vendorPhone) return;
  const norm = vendorPhone.replace(/[^0-9]/g, "").slice(-10);
  if (!norm) return;
  sqlite.prepare(
    `UPDATE vendor_rfq_messages SET manually_handled = 1
     WHERE id IN (
       SELECT id FROM vendor_rfq_messages
       WHERE REPLACE(REPLACE(vendor_phone,'+',''),' ','') LIKE ?
       ORDER BY created_at DESC, id DESC LIMIT 1
     )`
  ).run(`%${norm}`);
}

// -------- R18: AI suggested replies --------
export function createAiSuggestion(data: {
  vendorId?: number | null; vendorPhone?: string | null; poId?: number | null;
  triggeredByMessageId?: number | null; suggestedText: string;
}): any {
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO ai_suggested_replies (vendor_id, vendor_phone, po_id, triggered_by_message_id, suggested_text, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    data.vendorId ?? null, data.vendorPhone ?? null, data.poId ?? null,
    data.triggeredByMessageId ?? null, data.suggestedText, now,
  );
  return sqlite.prepare(`SELECT * FROM ai_suggested_replies WHERE id = ?`).get(Number(info.lastInsertRowid));
}

// Most recent pending suggestion for a vendor (newest first), default just the latest.
export function listPendingAiSuggestions(vendorId: number, limit = 1): any[] {
  return sqlite.prepare(
    `SELECT * FROM ai_suggested_replies WHERE vendor_id = ? AND status = 'pending' ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(vendorId, limit) as any[];
}

export function getAiSuggestion(id: number): any | undefined {
  return sqlite.prepare(`SELECT * FROM ai_suggested_replies WHERE id = ?`).get(id);
}

export function decideAiSuggestion(id: number, status: "accepted" | "rejected"): any | undefined {
  sqlite.prepare(
    `UPDATE ai_suggested_replies SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`
  ).run(status, Date.now(), id);
  return getAiSuggestion(id);
}

// -------- Vendor payments --------
export function addVendorPayment(data: {
  vendorId: number; paidOn: number; amount: number; method: string;
  reference?: string | null; notes?: string | null; createdBy?: string | null;
}): any {
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO vendor_payments (vendor_id, paid_on, amount, method, reference, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.vendorId, data.paidOn, data.amount, data.method, data.reference ?? null, data.notes ?? null, data.createdBy ?? null, now);
  return sqlite.prepare(`SELECT * FROM vendor_payments WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listVendorPayments(vendorId: number, from?: number, to?: number): any[] {
  const conds = ["vendor_id = ?"];
  const params: any[] = [vendorId];
  if (from != null) { conds.push("paid_on >= ?"); params.push(from); }
  if (to != null) { conds.push("paid_on <= ?"); params.push(to); }
  return sqlite.prepare(
    `SELECT * FROM vendor_payments WHERE ${conds.join(" AND ")} ORDER BY paid_on DESC, id DESC`
  ).all(...params) as any[];
}

// -------- Vendor ledger (one row per vendor) --------
// Approved value = sum over approved po_items of vendor_rate * qty. Paid = sum vendor_payments.
export function getVendorLedger(opts: { vendorId?: number; from?: number; to?: number; q?: string } = {}): any[] {
  const apprConds: string[] = ["pi.approved_vendor_id IS NOT NULL"];
  const apprParams: any[] = [];
  if (opts.vendorId != null) { apprConds.push("pi.approved_vendor_id = ?"); apprParams.push(opts.vendorId); }
  if (opts.from != null) { apprConds.push("pi.assigned_at >= ?"); apprParams.push(opts.from); }
  if (opts.to != null) { apprConds.push("pi.assigned_at <= ?"); apprParams.push(opts.to); }

  const approved = sqlite.prepare(
    `SELECT pi.approved_vendor_id AS vendor_id,
            COUNT(*) AS item_count,
            SUM(COALESCE(pi.vendor_rate, 0) * COALESCE(pi.qty, 1)) AS total_approved_value,
            MAX(pi.assigned_at) AS last_activity_at
     FROM po_items pi
     WHERE ${apprConds.join(" AND ")}
     GROUP BY pi.approved_vendor_id`
  ).all(...apprParams) as any[];

  const map = new Map<number, any>();
  for (const a of approved) {
    map.set(a.vendor_id, {
      vendor_id: a.vendor_id,
      item_count: a.item_count || 0,
      total_approved_value: a.total_approved_value || 0,
      total_paid: 0,
      last_activity_at: a.last_activity_at || 0,
    });
  }

  const payConds: string[] = ["1=1"];
  const payParams: any[] = [];
  if (opts.vendorId != null) { payConds.push("vendor_id = ?"); payParams.push(opts.vendorId); }
  if (opts.from != null) { payConds.push("paid_on >= ?"); payParams.push(opts.from); }
  if (opts.to != null) { payConds.push("paid_on <= ?"); payParams.push(opts.to); }
  const payments = sqlite.prepare(
    `SELECT vendor_id, SUM(amount) AS total_paid, MAX(paid_on) AS last_pay
     FROM vendor_payments WHERE ${payConds.join(" AND ")} GROUP BY vendor_id`
  ).all(...payParams) as any[];
  for (const p of payments) {
    if (!map.has(p.vendor_id)) {
      map.set(p.vendor_id, { vendor_id: p.vendor_id, item_count: 0, total_approved_value: 0, total_paid: 0, last_activity_at: 0 });
    }
    const row = map.get(p.vendor_id);
    row.total_paid = p.total_paid || 0;
    if ((p.last_pay || 0) > row.last_activity_at) row.last_activity_at = p.last_pay || 0;
  }

  let rows = Array.from(map.values());
  // Attach vendor name + phone + compute balance
  for (const r of rows) {
    const v = sqlite.prepare(`SELECT name, phone FROM vendors WHERE id = ?`).get(r.vendor_id) as any;
    r.vendor_name = v?.name || `Vendor #${r.vendor_id}`;
    r.vendor_phone = v?.phone ?? null;
    r.balance = (r.total_approved_value || 0) - (r.total_paid || 0);
  }
  // R26 — server-side search across vendor name + phone.
  const q = (opts.q || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      String(r.vendor_name || "").toLowerCase().includes(q) ||
      String(r.vendor_phone || "").toLowerCase().includes(q));
  }
  rows.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
  return rows;
}

export function getVendorLedgerDetails(vendorId: number, from?: number, to?: number): { items: any[]; payments: any[] } {
  const conds = ["pi.approved_vendor_id = ?"];
  const params: any[] = [vendorId];
  if (from != null) { conds.push("pi.assigned_at >= ?"); params.push(from); }
  if (to != null) { conds.push("pi.assigned_at <= ?"); params.push(to); }
  const items = sqlite.prepare(
    `SELECT po.po_number, pi.part_number AS part, pi.brand, pi.qty, pi.vendor_rate AS rate,
            (COALESCE(pi.vendor_rate, 0) * COALESCE(pi.qty, 1)) AS line_total, pi.assigned_at AS approved_at
     FROM po_items pi
     JOIN purchase_orders_v2 po ON po.id = pi.po_id
     WHERE ${conds.join(" AND ")}
     ORDER BY pi.assigned_at DESC`
  ).all(...params) as any[];
  const payments = listVendorPayments(vendorId, from, to);
  return { items, payments };
}

// -------- Outstanding today --------
export function getOutstandingToday(dayStart: number, dayEnd: number): any {
  const posCreated = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM purchase_orders_v2 WHERE created_at >= ? AND created_at <= ?`
  ).get(dayStart, dayEnd) as any).n || 0;

  const pos = sqlite.prepare(
    `SELECT id, po_number FROM purchase_orders_v2 WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC`
  ).all(dayStart, dayEnd) as any[];

  let itemsTotal = 0, ratesReceived = 0, ratesPending = 0;
  const breakdown: any[] = [];
  for (const po of pos) {
    const items = sqlite.prepare(`SELECT id FROM po_items WHERE po_id = ?`).all(po.id) as any[];
    let poPending = 0;
    for (const it of items) {
      const hasRate = (sqlite.prepare(
        `SELECT COUNT(*) AS n FROM po_item_vendor_quotes WHERE po_item_id = ? AND status IN ('received','approved','manual')`
      ).get(it.id) as any).n || 0;
      if (hasRate > 0) ratesReceived++; else { ratesPending++; poPending++; }
    }
    itemsTotal += items.length;
    breakdown.push({ po_id: po.id, po_number: po.po_number, items_total: items.length, pending: poPending });
  }
  return { pos_created: posCreated, items_total: itemsTotal, rates_received: ratesReceived, rates_pending: ratesPending, breakdown };
}

// -------- PO date + customer-PO search --------
export function updatePoDate(id: number, poDate: number): any {
  sqlite.prepare(`UPDATE purchase_orders_v2 SET po_date = ?, updated_at = ? WHERE id = ?`).run(poDate, Date.now(), id);
  return sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(id) as any;
}

export function searchPurchaseOrders(q: string): any[] {
  const like = `%${q}%`;
  return sqlite.prepare(
    `SELECT po.id, po.po_number, po.customer_po_number, po.status, po.total, po.created_at, po.po_date,
            c.name AS customer_name
     FROM purchase_orders_v2 po
     LEFT JOIN customers c ON c.id = po.customer_id
     WHERE po.po_number LIKE ? OR po.customer_po_number LIKE ?
     ORDER BY po.created_at DESC
     LIMIT 20`
  ).all(like, like) as any[];
}

// ============================================================
// R11: WORKFLOW SPLIT (Notify Delhi vs Process PO) + locked-vendor summary
// ============================================================

// Build a one-PO summary of confirmed (approved) lines for the rate-confirmed WhatsApp
// to a single seller: their locked items only, with our PO number and total.
export function getConfirmedItemsForVendorOnPo(poId: number, vendorId: number): {
  poNumber: string; itemsText: string; totalAmount: number; count: number;
} {
  const po = sqlite.prepare(`SELECT po_number FROM purchase_orders_v2 WHERE id = ?`).get(poId) as any;
  const rows = sqlite.prepare(
    `SELECT pi.part_number, pi.brand, pi.qty, pi.vendor_rate
     FROM po_items pi
     WHERE pi.po_id = ? AND pi.approved_vendor_id = ? AND pi.approved_quote_id IS NOT NULL
     ORDER BY pi.id`
  ).all(poId, vendorId) as any[];
  let total = 0;
  const itemsText = rows
    .map((r, i) => {
      const qty = Number(r.qty ?? 1) || 1;
      const rate = r.vendor_rate != null ? Number(r.vendor_rate) : 0;
      total += rate * qty;
      const label = [r.part_number, r.brand].filter(Boolean).join(" ");
      return `${i + 1}. ${label} x${qty}${rate ? ` @ ₹${rate}` : ""}`;
    })
    .join("\n");
  return { poNumber: po?.po_number || `PO#${poId}`, itemsText, totalAmount: total, count: rows.length };
}

// Find the PO id that owns a given po_item (used to scope the confirmed-rate WA).
export function getPoIdForItem(poItemId: number): number | null {
  const r = sqlite.prepare(`SELECT po_id FROM po_items WHERE id = ?`).get(poItemId) as any;
  return r?.po_id ?? null;
}

// Process a PO: split confirmed (approved) lines from the rest. Confirmed lines stay on the
// original PO (status -> 'processed'); unconfirmed lines move to a NEW pending PO that points
// back at the original via parent_po_id. Returns both PO summaries. Transactional.
export function processPurchaseOrder(poId: number): {
  original_po: { id: number; po_number: string; status: string; confirmed_count: number };
  pending_po: { id: number; po_number: string; status: string; moved_count: number } | null;
} {
  const tx = sqlite.transaction(() => {
    const orig = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(poId) as any;
    if (!orig) throw new Error("PO not found");

    const confirmed = sqlite.prepare(
      `SELECT * FROM po_items WHERE po_id = ? AND approved_quote_id IS NOT NULL`
    ).all(poId) as any[];
    const unconfirmed = sqlite.prepare(
      `SELECT * FROM po_items WHERE po_id = ? AND approved_quote_id IS NULL`
    ).all(poId) as any[];

    if (confirmed.length === 0) throw new Error("No confirmed lines to process");

    let pendingPo: any = null;
    if (unconfirmed.length > 0) {
      // New internal NM/PO number; keep the same customer PO number.
      // R16: use the robust MAX(seq)+1 allocator (R13.6) — the legacy COUNT(*)+1 here
      // collided (UNIQUE constraint failed) whenever the row count differed from the
      // highest sequence. Allocation runs inside this transaction, so SELECT-then-INSERT
      // stays atomic.
      const newPoNumber = nextPoNumber("NM/PO");
      const now = Date.now();
      const dateStr = new Date().toISOString().slice(0, 10);
      const notes = `Split from ${orig.po_number} on ${dateStr}`;
      const info = sqlite.prepare(
        `INSERT INTO purchase_orders_v2
           (po_number, quotation_id, customer_id, company_id, status, subtotal, discount, tax, total,
            notes, created_by, created_at, updated_at, customer_po_number, customer_po_url,
            ship_to_name, ship_to_address, ship_to_phone, po_date, parent_po_id)
         VALUES (?, ?, ?, ?, 'pending', 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newPoNumber, orig.quotation_id ?? null, orig.customer_id ?? null, orig.company_id ?? null,
        notes, orig.created_by ?? null, now, now,
        orig.customer_po_number ?? null, orig.customer_po_url ?? null,
        orig.ship_to_name ?? null, orig.ship_to_address ?? null, orig.ship_to_phone ?? null,
        orig.po_date ?? null, poId,
      );
      const newPoId = Number(info.lastInsertRowid);
      // Move unconfirmed lines (and their quote rows) to the new PO.
      for (const it of unconfirmed) {
        sqlite.prepare(`UPDATE po_items SET po_id = ? WHERE id = ?`).run(newPoId, it.id);
      }
      pendingPo = {
        id: newPoId, po_number: newPoNumber, status: "pending", moved_count: unconfirmed.length,
      };
    }

    sqlite.prepare(`UPDATE purchase_orders_v2 SET status = 'processed', updated_at = ? WHERE id = ?`)
      .run(Date.now(), poId);

    return {
      original_po: { id: poId, po_number: orig.po_number, status: "processed", confirmed_count: confirmed.length },
      pending_po: pendingPo,
    };
  });
  return tx();
}

// ============================================================
// R22 — Consignment: Delhi-dispatched POs visible category
// ============================================================
// POs Delhi has marked dispatched (delhi_submitted_at set) that are not yet completed in
// the consignment view. Returns lightweight rows with live totals for the "From Delhi" tab.
// R26 — From-Delhi list with optional status filter, date range (on delhi_submitted_at),
// server-side search, and a per-PO bundles count. All filters are optional and additive;
// crucially this NO LONGER hides processed/received/completed POs — every Delhi-dispatched
// PO is returned and the caller renders a status badge. (R26 Fix A.1)
// R26.6b — normalize a stored docket slip path into a browser-openable URL.
// New uploads store a server-relative "/uploads/..." path; some legacy rows store a full URL.
// R26.6k — `origin` (e.g. "https://host") prefixes relative paths so old rows that stored a
// server-relative "/uploads/..." path open from the prod frontend (GoDaddy) instead of 404ing.
function docketUrlFromPath(p: string | null | undefined, origin?: string | null): string | null {
  if (!p) return null;
  const s = String(p).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const rel = s.startsWith("/") ? s : `/uploads/${s}`;
  return origin ? `${origin.replace(/\/+$/, "")}${rel}` : rel;
}

export function listDelhiDispatchedForConsignment(opts: {
  status?: string; from?: number; to?: number; q?: string; origin?: string | null;
} = {}): any[] {
  const conds: string[] = ["delhi_submitted_at IS NOT NULL", "deleted_at IS NULL"];
  const params: any[] = [];
  // status filter: "pending" means no consignment_status; otherwise exact match.
  if (opts.status && opts.status !== "all") {
    if (opts.status === "pending") conds.push("consignment_status IS NULL");
    else { conds.push("consignment_status = ?"); params.push(opts.status); }
  }
  if (opts.from != null) { conds.push("delhi_submitted_at >= ?"); params.push(opts.from); }
  if (opts.to != null) { conds.push("delhi_submitted_at <= ?"); params.push(opts.to); }

  let rows = sqlite.prepare(
    `SELECT * FROM purchase_orders_v2
     WHERE ${conds.join(" AND ")}
     ORDER BY delhi_submitted_at DESC`
  ).all(...params) as any[];

  // Server-side search across PO#, customer name, line item description, brand.
  const q = (opts.q || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((po) => {
      if (String(po.po_number || "").toLowerCase().includes(q)) return true;
      const customer = po.customer_id
        ? (sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(po.customer_id) as any)
        : null;
      if (customer?.name && String(customer.name).toLowerCase().includes(q)) return true;
      const hit = sqlite.prepare(
        `SELECT 1 FROM po_items WHERE po_id = ?
         AND (LOWER(COALESCE(description,'')) LIKE ? OR LOWER(COALESCE(brand,'')) LIKE ?) LIMIT 1`
      ).get(po.id, `%${q}%`, `%${q}%`);
      return !!hit;
    });
  }

  return rows.map((po) => {
    const items = sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(po.id) as any[];
    const customer = po.customer_id
      ? (sqlite.prepare(`SELECT name, phone FROM customers WHERE id = ?`).get(po.customer_id) as any)
      : null;
    let custTotal = 0, costTotal = 0;
    for (const it of items) {
      const qty = Number(it.qty ?? 0) || 0;
      custTotal += (it.unit_price != null ? Number(it.unit_price) : 0) * qty;
      const cost = it.vendor_rate != null ? Number(it.vendor_rate) : (it.purchase_cost != null ? Number(it.purchase_cost) : 0);
      costTotal += cost * qty;
    }
    const bundlesRow = sqlite.prepare(
      `SELECT COALESCE(SUM(bundles), 0) AS total FROM dispatches WHERE po_id = ?`
    ).get(po.id) as any;
    // R27.1 TASK 0 — hydrate docket # / slip URL from the dispatch row when the PO-level
    // docket fields are empty (Delhi often records the docket only on the dispatch).
    const disp = sqlite.prepare(
      `SELECT docket_no AS docketNo, courier_name AS courier, docket_photo_url AS docketPhotoUrl
       FROM dispatches WHERE po_id = ? AND (docket_no IS NOT NULL OR docket_photo_url IS NOT NULL)
       ORDER BY round_no ASC LIMIT 1`
    ).get(po.id) as any;
    const docketUrl =
      docketUrlFromPath(po.docket_slip_path, opts.origin) ??
      docketUrlFromPath(disp?.docketPhotoUrl, opts.origin);
    const docketNumber = po.docket_number ?? disp?.docketNo ?? null;
    return {
      id: po.id, poNumber: po.po_number, customerId: po.customer_id,
      customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
      status: po.status, delhiSubmittedAt: po.delhi_submitted_at,
      consignmentStatus: po.consignment_status ?? null,
      consignmentReceivedAt: po.consignment_received_at ?? null,
      itemCount: items.length, custTotal, costTotal,
      totalBundles: Number(bundlesRow?.total ?? 0) || 0,
      carrier: disp?.courier ?? null,
      docketUrl,
      docketNumber,
    };
  });
}

// R26 — full detail for the "View" modal + PDF export of a From-Delhi PO.
export function getConsignmentDetail(poId: number, origin?: string | null): any | null {
  const po = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(poId) as any;
  if (!po) return null;
  const customer = po.customer_id
    ? (sqlite.prepare(`SELECT name, phone FROM customers WHERE id = ?`).get(po.customer_id) as any)
    : null;
  const items = (sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(po.id) as any[]).map((it) => {
    let vendorName = it.vendor_name || null;
    if (!vendorName) {
      const vid = it.approved_vendor_id ?? it.vendor_id;
      if (vid) {
        const v = sqlite.prepare(`SELECT name FROM vendors WHERE id = ?`).get(vid) as any;
        vendorName = v?.name ?? null;
      }
    }
    return {
      id: it.id,
      name: it.description || it.part_number || "—",
      partNumber: it.part_number ?? null,
      qty: Number(it.qty ?? 0) || 0,
      brand: it.brand ?? null,
      vendorName,
    };
  });
  const dispatches = sqlite.prepare(
    `SELECT docket_no AS docketNo, courier_name AS courier, bundles, dispatch_date AS dispatchDate, docket_photo_url AS docketPhotoUrl
     FROM dispatches WHERE po_id = ? ORDER BY round_no ASC`
  ).all(po.id) as any[];
  const totalBundles = dispatches.reduce((s, d) => s + (Number(d.bundles) || 0), 0);
  const carriers = Array.from(new Set(dispatches.map((d) => d.courier).filter(Boolean)));
  const dockets = dispatches.map((d) => d.docketNo).filter(Boolean);
  // R27.1 TASK 0 — defensive docket hydration: many From-Delhi POs have their docket
  // captured on the dispatch row (docket_no + docket_photo_url) but NOT mirrored onto
  // the PO-level docket_number / docket_slip_path. Fall back to the dispatch values so
  // the consignment portal shows the docket # and enables "View Docket".
  const firstDocketDispatch = dispatches.find((d) => d.docketNo || d.docketPhotoUrl) || null;
  const effDocketNumber = po.docket_number ?? firstDocketDispatch?.docketNo ?? null;
  const effDocketUrl =
    docketUrlFromPath(po.docket_slip_path, origin) ??
    docketUrlFromPath(firstDocketDispatch?.docketPhotoUrl, origin);
  return {
    id: po.id,
    poNumber: po.po_number,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone ?? null,
    delhiSubmittedAt: po.delhi_submitted_at ?? null,
    consignmentStatus: po.consignment_status ?? null,
    status: po.status,
    items,
    dispatches,
    totalItems: items.length,
    totalBundles,
    carrier: carriers.join(", ") || po.docket_transport || null,
    dockets,
    // R26.2 — Delhi docket fields stored on the PO (transport name + docket no/date + slip).
    docketTransport: po.docket_transport ?? firstDocketDispatch?.courier ?? null,
    docketNumber: effDocketNumber,
    docketDate: po.docket_date ?? firstDocketDispatch?.dispatchDate ?? null,
    docketSlipPath: po.docket_slip_path ?? null,
    docketUrl: effDocketUrl,
  };
}

// Set the consignment marker on a PO (received|processing|completed). Additive — does NOT
// touch the PO lifecycle status. Stamps consignment_received_at on first 'received'.
export function setConsignmentStatus(poId: number, status: string): any {
  const now = Date.now();
  const stampReceived = status === "received" ? now : null;
  sqlite.prepare(
    `UPDATE purchase_orders_v2
     SET consignment_status = ?,
         consignment_received_at = COALESCE(consignment_received_at, ?)
     WHERE id = ?`
  ).run(status, stampReceived, poId);
  return sqlite.prepare(`SELECT id, po_number, consignment_status, consignment_received_at FROM purchase_orders_v2 WHERE id = ?`).get(poId);
}

// ============================================================
// R23 — Command Center aggregates + ledger + margin
// ============================================================
// R26 — accepts an optional [fromMs, toMs] window. When omitted, defaults preserve the
// original behaviour (today for revenue, last 7d for quotations/rates, last 30d for tops).
// When supplied, ALL windowed widgets use the user range.
export function commandCenterWidgets(range?: { from?: number; to?: number }): any {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const hasRange = range && range.from != null && range.to != null;
  const todayMs = hasRange ? Number(range!.from) : dayStart.getTime();
  const rangeEnd = hasRange ? Number(range!.to) : Date.now();
  const weekAgo = hasRange ? Number(range!.from) : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = hasRange ? Number(range!.from) : Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Pull active POs once and compute totals in JS (mirrors computePoTotals).
  const activePos = sqlite.prepare(
    `SELECT * FROM purchase_orders_v2 WHERE deleted_at IS NULL`
  ).all() as any[];
  const itemsByPo = new Map<number, any[]>();
  const allItems = sqlite.prepare(`SELECT * FROM po_items`).all() as any[];
  for (const it of allItems) {
    if (!itemsByPo.has(it.po_id)) itemsByPo.set(it.po_id, []);
    itemsByPo.get(it.po_id)!.push(it);
  }
  const totalsFor = (poId: number) => {
    const items = itemsByPo.get(poId) || [];
    let cust = 0, cost = 0;
    for (const it of items) {
      const qty = Number(it.qty ?? 0) || 0;
      cust += (it.unit_price != null ? Number(it.unit_price) : 0) * qty;
      const c = it.vendor_rate != null ? Number(it.vendor_rate) : (it.purchase_cost != null ? Number(it.purchase_cost) : 0);
      cost += c * qty;
    }
    return { cust, cost };
  };

  // 1. Today's revenue (sum custTotal of POs created in window)
  let todayRevenue = 0;
  for (const po of activePos) {
    if (Number(po.created_at) >= todayMs && Number(po.created_at) <= rangeEnd) todayRevenue += totalsFor(po.id).cust;
  }
  // 2. Open POs
  const openPos = activePos.filter((p) => ["open", "draft", "processed", "sent", "partial"].includes(String(p.status)));
  let openValue = 0; for (const p of openPos) openValue += totalsFor(p.id).cust;
  // 3. Pending dispatches
  const pendingDispatch = activePos.filter((p) => Number(p.is_fully_dispatched) !== 1 && p.delhi_submitted_at == null);
  // 4. Low margin alerts (<5%)
  const lowMargin: any[] = [];
  for (const po of activePos) {
    const { cust, cost } = totalsFor(po.id);
    if (cust > 0) {
      const margin = (cust - cost) / cust;
      if (margin < 0.05) {
        const customer = po.customer_id ? (sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(po.customer_id) as any) : null;
        lowMargin.push({ id: po.id, poNumber: po.po_number, customerName: customer?.name ?? null, marginPct: Math.round(margin * 1000) / 10, custTotal: cust });
      }
    }
  }
  lowMargin.sort((a, b) => b.id - a.id);
  // 5. Recent vendor replies
  const recentReplies = (sqlite.prepare(
    `SELECT m.id, m.vendor_id, m.vendor_phone, m.body, m.created_at, v.name AS vendor_name
     FROM vendor_rfq_messages m LEFT JOIN vendors v ON v.id = m.vendor_id
     WHERE m.direction = 'in' ORDER BY m.created_at DESC LIMIT 5`
  ).all() as any[]).map((r) => ({
    id: r.id, vendorName: r.vendor_name || r.vendor_phone || "Unknown",
    snippet: String(r.body || "").slice(0, 80), createdAt: r.created_at,
  }));
  // 6. This week's quotations (sent + accepted) — windowed
  const quotesSent = (sqlite.prepare(`SELECT COUNT(*) AS n FROM quotations WHERE created_at >= ? AND created_at <= ? AND (deleted_at IS NULL)`).get(weekAgo, rangeEnd) as any)?.n ?? 0;
  let quotesAccepted = 0;
  try { quotesAccepted = (sqlite.prepare(`SELECT COUNT(*) AS n FROM quotations WHERE created_at >= ? AND created_at <= ? AND status = 'accepted' AND (deleted_at IS NULL)`).get(weekAgo, rangeEnd) as any)?.n ?? 0; } catch { /* status col may differ */ }
  // 7. Active RFQs awaiting rates — windowed
  const awaitingRates = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM po_item_vendor_quotes WHERE status = 'requested' AND rate IS NULL AND requested_at >= ? AND requested_at <= ?`
  ).get(weekAgo, rangeEnd) as any)?.n ?? 0;
  // 8. Top customers (30d)
  const topCustomers: any[] = [];
  {
    const byCust = new Map<number, number>();
    for (const po of activePos) {
      if (Number(po.created_at) >= monthAgo && Number(po.created_at) <= rangeEnd && po.customer_id) {
        byCust.set(po.customer_id, (byCust.get(po.customer_id) || 0) + totalsFor(po.id).cust);
      }
    }
    const sorted = Array.from(byCust.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [cid, total] of sorted) {
      const c = sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(cid) as any;
      topCustomers.push({ customerId: cid, customerName: c?.name ?? `#${cid}`, total: Math.round(total) });
    }
  }
  // 9. Top vendors by spend (30d) — vendor_rate * qty on po_items of recent POs
  const topVendors: any[] = [];
  {
    const byVendor = new Map<number, number>();
    for (const po of activePos) {
      if (Number(po.created_at) < monthAgo || Number(po.created_at) > rangeEnd) continue;
      for (const it of (itemsByPo.get(po.id) || [])) {
        if (it.vendor_id && it.vendor_rate != null) {
          byVendor.set(it.vendor_id, (byVendor.get(it.vendor_id) || 0) + Number(it.vendor_rate) * (Number(it.qty) || 0));
        }
      }
    }
    const sorted = Array.from(byVendor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [vid, spend] of sorted) {
      const v = sqlite.prepare(`SELECT name FROM vendors WHERE id = ?`).get(vid) as any;
      topVendors.push({ vendorId: vid, vendorName: v?.name ?? `#${vid}`, spend: Math.round(spend) });
    }
  }

  return {
    todayRevenue: Math.round(todayRevenue),
    openPos: { count: openPos.length, value: Math.round(openValue) },
    pendingDispatches: pendingDispatch.length,
    lowMarginAlerts: lowMargin.slice(0, 10),
    recentVendorReplies: recentReplies,
    weekQuotations: { sent: quotesSent, accepted: quotesAccepted },
    awaitingRates,
    topCustomers,
    topVendors,
  };
}

// R23 — margin summary over a window with per-company + per-customer breakdown.
export function marginSummary(fromMs: number, toMs: number): any {
  const pos = sqlite.prepare(
    `SELECT * FROM purchase_orders_v2 WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`
  ).all(fromMs, toMs) as any[];
  let revenue = 0, cost = 0;
  const byCompany = new Map<number, { revenue: number; cost: number }>();
  const byCustomer = new Map<number, { revenue: number; cost: number }>();
  for (const po of pos) {
    const items = sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(po.id) as any[];
    let cust = 0, cst = 0;
    for (const it of items) {
      const qty = Number(it.qty ?? 0) || 0;
      cust += (it.unit_price != null ? Number(it.unit_price) : 0) * qty;
      const c = it.vendor_rate != null ? Number(it.vendor_rate) : (it.purchase_cost != null ? Number(it.purchase_cost) : 0);
      cst += c * qty;
    }
    revenue += cust; cost += cst;
    if (po.company_id) {
      const e = byCompany.get(po.company_id) || { revenue: 0, cost: 0 };
      e.revenue += cust; e.cost += cst; byCompany.set(po.company_id, e);
    }
    if (po.customer_id) {
      const e = byCustomer.get(po.customer_id) || { revenue: 0, cost: 0 };
      e.revenue += cust; e.cost += cst; byCustomer.set(po.customer_id, e);
    }
  }
  const pct = (r: number, c: number) => (r > 0 ? Math.round(((r - c) / r) * 1000) / 10 : 0);
  const companies = Array.from(byCompany.entries()).map(([id, e]) => {
    const row = sqlite.prepare(`SELECT name FROM companies WHERE id = ?`).get(id) as any;
    return { companyId: id, name: row?.name ?? `#${id}`, revenue: Math.round(e.revenue), cost: Math.round(e.cost), marginPct: pct(e.revenue, e.cost) };
  }).sort((a, b) => b.revenue - a.revenue);
  const customersBd = Array.from(byCustomer.entries()).map(([id, e]) => {
    const row = sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(id) as any;
    return { customerId: id, name: row?.name ?? `#${id}`, revenue: Math.round(e.revenue), cost: Math.round(e.cost), marginPct: pct(e.revenue, e.cost) };
  }).sort((a, b) => b.revenue - a.revenue);
  return {
    totalRevenue: Math.round(revenue), totalCost: Math.round(cost),
    grossMarginPct: pct(revenue, cost),
    byCompany: companies, byCustomer: customersBd,
  };
}

// R23 — idempotent ledger write on PO fulfilment. Writes a customer debit + company credit
// keyed by (po_id, entry_type) so re-running is a no-op. Returns true if a NEW entry was made.
export function writePoFulfilmentLedger(poId: number): boolean {
  const po = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(poId) as any;
  if (!po) return false;
  const existing = sqlite.prepare(
    `SELECT id FROM po_fulfilment_ledger WHERE po_id = ? AND entry_type = 'po_fulfilment'`
  ).get(poId);
  if (existing) return false; // idempotent — already written
  const items = sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(poId) as any[];
  let custTotal = 0;
  for (const it of items) custTotal += (it.unit_price != null ? Number(it.unit_price) : 0) * (Number(it.qty) || 0);
  const now = Date.now();
  const ref = `PO ${po.po_number}`;
  sqlite.prepare(
    `INSERT INTO po_fulfilment_ledger (po_id, customer_id, company_id, entry_type, debit, credit, reference, source, created_at)
     VALUES (?, ?, ?, 'po_fulfilment', ?, ?, ?, 'po_fulfilment', ?)`
  ).run(poId, po.customer_id ?? null, po.company_id ?? null, custTotal, custTotal, ref, now);
  return true;
}

// ============================================================
// R24 — Market Radar: lead convert + marketing send log + chats
// ============================================================
export function convertLeadToCustomer(leadId: number): { customerId: number } | null {
  const lead = sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId) as any;
  if (!lead) return null;
  if (lead.converted_to_customer_id) return { customerId: lead.converted_to_customer_id };
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO customers (name, phone, email, city, state, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(lead.name, lead.phone ?? lead.whatsapp ?? null, lead.email ?? null, lead.city ?? null, lead.state ?? null, lead.notes ?? lead.requirement ?? null, now);
  const customerId = Number(info.lastInsertRowid);
  sqlite.prepare(
    `UPDATE leads SET converted_to_customer_id = ?, status = 'converted', stage = 'won', updated_at = ? WHERE id = ?`
  ).run(customerId, now, leadId);
  return { customerId };
}

// R25a — convert a lead into a vendor (seller) record, mirroring convertLeadToCustomer.
export function convertLeadToVendor(leadId: number): { vendorId: number } | null {
  const lead = sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId) as any;
  if (!lead) return null;
  if (lead.converted_to_vendor_id) return { vendorId: lead.converted_to_vendor_id };
  const now = Date.now();
  // Generate a vendor code in the same NM/V sequence used by createVendor.
  const last = sqlite.prepare(`SELECT code FROM vendors WHERE code LIKE 'NM/V%' ORDER BY id DESC LIMIT 1`).get() as any;
  let next = 1;
  if (last?.code) { const m = String(last.code).match(/(\d+)\s*$/); if (m) next = parseInt(m[1], 10) + 1; }
  const code = `NM/V${String(next).padStart(4, "0")}`;
  const info = sqlite.prepare(
    `INSERT INTO vendors (code, name, phone, whatsapp, city, state, notes, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(code, lead.name, lead.phone ?? lead.whatsapp ?? null, lead.whatsapp ?? lead.phone ?? null, lead.city ?? null, lead.state ?? null, lead.notes ?? lead.requirement ?? null, now, now);
  const vendorId = Number(info.lastInsertRowid);
  sqlite.prepare(
    `UPDATE leads SET converted_to_vendor_id = ?, status = 'converted', updated_at = ? WHERE id = ?`
  ).run(vendorId, now, leadId);
  return { vendorId };
}

// R25a — Leads CRM analytics row for the page header (counts + conversion + follow-ups).
export function leadAnalytics(): {
  total: number;
  byStage: Record<string, number>;
  conversionRate: number;
  thisWeek: number;
  pendingFollowUps: number;
} {
  const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM leads`).get() as any)?.c || 0;
  const stageRows = sqlite.prepare(`SELECT stage, COUNT(*) AS c FROM leads GROUP BY stage`).all() as any[];
  const byStage: Record<string, number> = { new: 0, contacted: 0, qualified: 0, quoted: 0, won: 0, lost: 0 };
  for (const r of stageRows) { byStage[String(r.stage)] = Number(r.c); }
  const won = byStage.won || 0;
  const conversionRate = total > 0 ? Math.round((won / total) * 1000) / 10 : 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = (sqlite.prepare(`SELECT COUNT(*) AS c FROM leads WHERE created_at >= ?`).get(weekAgo) as any)?.c || 0;
  // Pending follow-ups: contacted/qualified with no activity in 3+ days (last_contact_at old/null).
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const pendingFollowUps = (sqlite.prepare(
    `SELECT COUNT(*) AS c FROM leads WHERE stage IN ('contacted','qualified') AND (last_contact_at IS NULL OR last_contact_at < ?)`
  ).get(threeDaysAgo) as any)?.c || 0;
  return { total, byStage, conversionRate, thisWeek, pendingFollowUps };
}

export function logMarketingSend(data: { leadId?: number | null; phone?: string | null; template?: string | null; vars?: string | null; status: string; error?: string | null; sentBy?: string | null }): any {
  const info = sqlite.prepare(
    `INSERT INTO marketing_sends (lead_id, phone, template, vars, status, error, sent_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.leadId ?? null, data.phone ?? null, data.template ?? null, data.vars ?? null, data.status, data.error ?? null, data.sentBy ?? null, Date.now());
  return sqlite.prepare(`SELECT * FROM marketing_sends WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function updateMarketingSendStatus(id: number, status: string, error?: string | null): void {
  sqlite.prepare(`UPDATE marketing_sends SET status = ?, error = ? WHERE id = ?`).run(status, error ?? null, id);
}

// R24 — unified chat conversation list from vendor_rfq_messages: one row per vendor/phone
// with last message + unread (inbound, no later outbound) count.
export function listChatConversations(): any[] {
  const rows = sqlite.prepare(
    `SELECT m.vendor_id, m.vendor_phone,
            MAX(m.created_at) AS last_at,
            COUNT(*) AS msg_count
     FROM vendor_rfq_messages m
     GROUP BY COALESCE(m.vendor_id, m.vendor_phone)
     ORDER BY last_at DESC`
  ).all() as any[];
  return rows.map((r) => {
    const last = sqlite.prepare(
      `SELECT body, direction, created_at FROM vendor_rfq_messages
       WHERE (vendor_id IS ? OR vendor_phone IS ?) ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(r.vendor_id, r.vendor_phone) as any;
    const unread = (sqlite.prepare(
      `SELECT COUNT(*) AS n FROM vendor_rfq_messages
       WHERE (vendor_id IS ? OR vendor_phone IS ?) AND direction = 'in'
         AND created_at > COALESCE((SELECT MAX(created_at) FROM vendor_rfq_messages WHERE (vendor_id IS ? OR vendor_phone IS ?) AND direction = 'out'), 0)`
    ).get(r.vendor_id, r.vendor_phone, r.vendor_id, r.vendor_phone) as any)?.n ?? 0;
    const vendor = r.vendor_id ? (sqlite.prepare(`SELECT id, name, phone FROM vendors WHERE id = ?`).get(r.vendor_id) as any) : null;
    return {
      vendorId: r.vendor_id ?? null,
      phone: r.vendor_phone ?? vendor?.phone ?? null,
      name: vendor?.name ?? r.vendor_phone ?? "Unknown",
      lastMessage: String(last?.body || "").slice(0, 120),
      lastDirection: last?.direction ?? null,
      lastMessageAt: r.last_at,
      unreadCount: unread,
      messageCount: r.msg_count,
    };
  });
}

export function listChatThread(vendorId: number): any[] {
  // R27.4 BUG-16 — include attachment_url/attachment_type so the chat UI can render
  // image/pdf bubbles. COALESCE keeps it null-safe on rows predating the migration.
  return sqlite.prepare(
    `SELECT id, vendor_id, vendor_phone, direction, body, status, attachment_url, attachment_type, created_at
     FROM vendor_rfq_messages WHERE vendor_id = ? ORDER BY created_at ASC, id ASC`
  ).all(vendorId) as any[];
}

// R26.2g — On "Notify Delhi", sync the customer (selling) rate into the line snapshot the
// Delhi UI reads. In this schema procurement + Delhi share the SAME `po_items` table, and the
// customer rate lives in `po_items.unit_price` (computePoTotals + getDelhiPoDetail both read
// unit_price as the customer rate). So syncing = recomputing each line's `line_total` from the
// current `unit_price * qty` (the Delhi "Rate"/"Line Total" columns), then refreshing the PO
// header `total`/`subtotal` (Delhi "Order Value"). Idempotent — safe on repeated notify clicks.
// Lines with unit_price = 0 stay at 0 (correct: a draft PO without rates set yet); the notify
// flow is NOT blocked. Returns counts for logging.
export function syncDelhiLineRates(poId: number): { lines: number; zeroRateLines: number; total: number } {
  const tx = sqlite.transaction(() => {
    const items = sqlite
      .prepare(`SELECT id, qty, unit_price FROM po_items WHERE po_id = ?`)
      .all(poId) as Array<{ id: number; qty: number | null; unit_price: number | null }>;
    let total = 0;
    let zeroRateLines = 0;
    const upd = sqlite.prepare(`UPDATE po_items SET line_total = ? WHERE id = ?`);
    for (const it of items) {
      const qty = Number(it.qty ?? 0) || 0;
      const rate = Number(it.unit_price ?? 0) || 0;
      const lineTotal = rate * qty;
      if (rate <= 0) zeroRateLines++;
      total += lineTotal;
      upd.run(lineTotal, it.id);
    }
    // Refresh the PO header order value from the freshly-recomputed line totals.
    sqlite
      .prepare(`UPDATE purchase_orders_v2 SET subtotal = ?, total = ?, updated_at = ? WHERE id = ?`)
      .run(total, total, Date.now(), poId);
    return { lines: items.length, zeroRateLines, total };
  });
  return tx();
}

// ============================================================================
// R26.5 — additive storage helpers. Raw-sqlite backed (mirrors marginSummary
// style) for the new tables + admin mirrors. Additive only — never touches
// existing helpers.
// ============================================================================

// ---- A2. shipped-customer ledger view (PO/dispatch derived, read-only) ----
export function listShippedLedgerView(customerId: number, opts: { from?: number; to?: number } = {}): any[] {
  const conds: string[] = ["po.customer_id = ?", "po.deleted_at IS NULL", "po.delhi_submitted_at IS NOT NULL"];
  const args: any[] = [customerId];
  if (opts.from != null) { conds.push("po.delhi_submitted_at >= ?"); args.push(opts.from); }
  if (opts.to != null) { conds.push("po.delhi_submitted_at <= ?"); args.push(opts.to); }
  const rows = sqlite.prepare(
    `SELECT po.id AS po_id, po.customer_po_number, po.total, po.delhi_submitted_at,
            po.consignment_status, po.is_fully_dispatched,
            d.docket_no, d.courier_name, d.dispatch_date
       FROM purchase_orders_v2 po
       LEFT JOIN dispatches d ON d.po_id = po.id
      WHERE ${conds.join(" AND ")}
      ORDER BY po.delhi_submitted_at DESC`,
  ).all(...args) as any[];
  return rows.map((r) => ({
    poId: r.po_id,
    customerPoNumber: r.customer_po_number,
    amount: r.total ?? 0,
    shippedAt: r.delhi_submitted_at,
    consignmentStatus: r.consignment_status,
    isFullyDispatched: r.is_fully_dispatched,
    docketNo: r.docket_no,
    courier: r.courier_name,
    dispatchDate: r.dispatch_date,
  }));
}

// ---- A4. admin parts list (mirrors searchPartsEnriched) ----
export function adminListParts(q: string, limit = 50): EnrichedPartsMasterRow[] {
  return searchPartsEnriched(q, limit);
}

// R26.6a (4) — union of the seeded master catalog (parts_master) + DISTINCT parts that
// only appear on PO v2 line items (po_items). PO-derived rows are tagged source:'po' and
// excluded when their part_number already exists in parts_master (master row wins).
export function listPartsUnion(q: string, limit = 50): any[] {
  const master = searchPartsEnriched(q, limit);
  const masterPns = new Set(master.map((m) => String(m.partNumber || "").toLowerCase()));
  const term = (q || "").toLowerCase();
  const likeTerm = `%${term}%`;
  // DISTINCT part identity from PO line items, with the most-recent PO it was seen on.
  const poRows = sqlite.prepare(`
    SELECT pi.part_number  AS part_number,
           pi.description   AS part_name,
           pi.brand         AS brand,
           MAX(pi.po_id)    AS last_seen_po_id,
           MAX(po.created_at) AS last_seen_at
      FROM po_items pi
      LEFT JOIN purchase_orders_v2 po ON po.id = pi.po_id
     WHERE pi.part_number IS NOT NULL AND pi.part_number <> ''
       AND (LOWER(COALESCE(pi.part_number,'')) LIKE ?
            OR LOWER(COALESCE(pi.description,'')) LIKE ?
            OR LOWER(COALESCE(pi.brand,'')) LIKE ?)
     GROUP BY LOWER(pi.part_number)
     ORDER BY last_seen_at DESC
     LIMIT ?
  `).all(likeTerm, likeTerm, likeTerm, limit) as any[];
  const poParts = poRows
    .filter((r) => !masterPns.has(String(r.part_number || "").toLowerCase()))
    .map((r) => ({
      id: `po-${r.last_seen_po_id}`,
      partNumber: r.part_number,
      part_number: r.part_number,
      name: r.part_name || null,
      part_name: r.part_name || null,
      brand: r.brand || null,
      category: "PO History",
      source: "po",
      last_seen_po_id: r.last_seen_po_id,
      last_seen_at: r.last_seen_at ? Number(r.last_seen_at) : null,
    }));
  return [...master, ...poParts];
}
export function adminUpsertPart(data: { partNumber: string; name: string; hsn?: string; gstRate?: number; brand?: string; lastMrp?: number }): any {
  const now = Date.now();
  const searchText = `${data.partNumber} ${data.name} ${data.brand ?? ""}`.toLowerCase();
  sqlite.prepare(
    `INSERT INTO parts_master (part_number, name, hsn, gst_rate, brand, last_mrp, last_source, last_updated, search_text, use_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, 0, ?)
     ON CONFLICT(part_number) DO UPDATE SET
       name=excluded.name, hsn=excluded.hsn, gst_rate=excluded.gst_rate, brand=excluded.brand,
       last_mrp=excluded.last_mrp, last_source='manual', last_updated=excluded.last_updated, search_text=excluded.search_text`,
  ).run(data.partNumber, data.name, data.hsn ?? null, data.gstRate ?? null, data.brand ?? null, data.lastMrp ?? null, now, searchText, now);
  return sqlite.prepare(`SELECT * FROM parts_master WHERE part_number = ?`).get(data.partNumber);
}
export function adminDeletePart(partNumber: string): void {
  sqlite.prepare(`DELETE FROM parts_master WHERE part_number = ?`).run(partNumber);
}

// ---- B. Leads V2 ----
export function listLeadsV2(opts: { stage?: string; assignedTo?: number; search?: string } = {}): any[] {
  const conds: string[] = ["(deleted_at IS NULL)"];
  const args: any[] = [];
  if (opts.stage) { conds.push("stage = ?"); args.push(opts.stage); }
  if (opts.assignedTo != null) { conds.push("assigned_to_user_id = ?"); args.push(opts.assignedTo); }
  if (opts.search) {
    conds.push("(LOWER(name) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR LOWER(COALESCE(contact_person,'')) LIKE ?)");
    const s = `%${opts.search.toLowerCase()}%`;
    args.push(s, s, s, s);
  }
  return sqlite.prepare(`SELECT * FROM leads WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`).all(...args) as any[];
}
function normalizeLeadStage(input: any): string {
  const v = String(input ?? '').trim();
  if (!v) return 'New';
  try {
    const row = sqlite.prepare(`SELECT name FROM lead_stages WHERE LOWER(name) = LOWER(?) LIMIT 1`).get(v) as any;
    if (row?.name) return row.name;
  } catch {}
  return v; // fallback: keep what user passed
}
export function createLeadV2(data: any): any {
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO leads (source, name, phone, email, city, state, requirement, stage, contact_person, address, assigned_to_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.source || "manual", data.name || "Lead", data.phone ?? null, data.email ?? null,
    data.city ?? null, data.state ?? null, data.requirement ?? null, normalizeLeadStage(data.stage),
    data.contact_person ?? data.contactPerson ?? null, data.address ?? null,
    data.assigned_to_user_id ?? data.assignedToUserId ?? null, now, now,
  );
  return sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(info.lastInsertRowid);
}
export function updateLeadV2(id: number, data: any): any {
  const cols: string[] = [];
  const args: any[] = [];
  const map: Record<string, any> = {
    name: data.name, phone: data.phone, email: data.email, city: data.city, state: data.state,
    requirement: data.requirement, stage: data.stage != null ? normalizeLeadStage(data.stage) : undefined, source: data.source,
    contact_person: data.contact_person ?? data.contactPerson,
    address: data.address,
    assigned_to_user_id: data.assigned_to_user_id ?? data.assignedToUserId,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) { cols.push(`${k} = ?`); args.push(v); }
  }
  if (!cols.length) return sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  cols.push("updated_at = ?"); args.push(Date.now());
  args.push(id);
  sqlite.prepare(`UPDATE leads SET ${cols.join(", ")} WHERE id = ?`).run(...args);
  return sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
}
export function softDeleteLeadV2(id: number): void {
  sqlite.prepare(`UPDATE leads SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), Date.now(), id);
}
export function getLeadRow(id: number): any {
  return sqlite.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
}

// ---- B2. lead stages ----
export function listLeadStages(): any[] {
  return sqlite.prepare(`SELECT * FROM lead_stages ORDER BY position, id`).all() as any[];
}
export function createLeadStage(data: { name: string; position?: number }): any {
  const info = sqlite.prepare(
    `INSERT INTO lead_stages (name, position, is_default, created_at) VALUES (?, ?, 0, ?)`,
  ).run(data.name, data.position ?? 0, Date.now());
  return sqlite.prepare(`SELECT * FROM lead_stages WHERE id = ?`).get(info.lastInsertRowid);
}
export function updateLeadStage(id: number, data: { name?: string; position?: number }): any {
  const cols: string[] = []; const args: any[] = [];
  if (data.name !== undefined) { cols.push("name = ?"); args.push(data.name); }
  if (data.position !== undefined) { cols.push("position = ?"); args.push(data.position); }
  if (cols.length) { args.push(id); sqlite.prepare(`UPDATE lead_stages SET ${cols.join(", ")} WHERE id = ?`).run(...args); }
  return sqlite.prepare(`SELECT * FROM lead_stages WHERE id = ?`).get(id);
}
export function deleteLeadStage(id: number): void {
  // Never delete default stages — only custom ones.
  sqlite.prepare(`DELETE FROM lead_stages WHERE id = ? AND is_default = 0`).run(id);
}

// ---- G1. sales targets ----
export function listSalesTargets(opts: { repId?: number; status?: string; customerId?: number; metric?: string } = {}): any[] {
  const conds: string[] = []; const args: any[] = [];
  if (opts.repId != null) { conds.push("sales_rep_user_id = ?"); args.push(opts.repId); }
  if (opts.status) { conds.push("status = ?"); args.push(opts.status); }
  if (opts.customerId != null) { conds.push("customer_id = ?"); args.push(opts.customerId); }
  if (opts.metric) { conds.push("metric = ?"); args.push(opts.metric); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(`SELECT * FROM sales_targets ${where} ORDER BY created_at DESC`).all(...args) as any[];
}
export function getSalesTarget(id: number): any {
  return sqlite.prepare(`SELECT * FROM sales_targets WHERE id = ?`).get(id);
}
export function createSalesTarget(data: any): any {
  const info = sqlite.prepare(
    `INSERT INTO sales_targets (sales_rep_user_id, target_type, metric, customer_id, lead_id, period_start, period_end, target_amount, achieved_amount, rolled_over_from, status, onboarding_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.sales_rep_user_id ?? data.salesRepUserId ?? data.repId ?? data.rep_id ?? null, data.target_type ?? data.targetType ?? "monthly",
    data.metric ?? "po", data.customer_id ?? data.customerId ?? null, data.lead_id ?? data.leadId ?? null,
    data.period_start ?? data.periodStart ?? null,
    data.period_end ?? data.periodEnd ?? null, Number(data.target_amount ?? data.targetAmount ?? 0),
    Number(data.achieved_amount ?? 0), data.rolled_over_from ?? null, data.status ?? "active",
    (data.metric ?? "po") === "onboarding" ? "pending" : null, Date.now(),
  );
  return getSalesTarget(Number(info.lastInsertRowid));
}
// Create one onboarding target per lead. Returns the created rows.
export function createOnboardingTargets(data: any): any[] {
  const repId = data.sales_rep_user_id ?? data.salesRepUserId ?? data.repId ?? data.rep_id ?? null;
  const leadIds: number[] = Array.isArray(data.lead_ids) ? data.lead_ids
    : Array.isArray(data.leadIds) ? data.leadIds : [];
  const out: any[] = [];
  for (const lid of leadIds) {
    out.push(createSalesTarget({
      sales_rep_user_id: repId, target_type: data.target_type ?? "monthly", metric: "onboarding",
      lead_id: lid, period_start: data.period_start ?? null, period_end: data.period_end ?? null,
      target_amount: data.target_amount ?? 0,
    }));
  }
  return out;
}
export function updateSalesTarget(id: number, data: any): any {
  const map: Record<string, any> = {
    sales_rep_user_id: data.sales_rep_user_id ?? data.salesRepUserId,
    target_type: data.target_type ?? data.targetType,
    metric: data.metric,
    customer_id: data.customer_id ?? data.customerId,
    lead_id: data.lead_id ?? data.leadId,
    period_start: data.period_start ?? data.periodStart,
    period_end: data.period_end ?? data.periodEnd,
    target_amount: data.target_amount ?? data.targetAmount,
    achieved_amount: data.achieved_amount ?? data.achievedAmount,
    status: data.status,
    onboarding_status: data.onboarding_status,
  };
  const cols: string[] = []; const args: any[] = [];
  for (const [k, v] of Object.entries(map)) { if (v !== undefined) { cols.push(`${k} = ?`); args.push(v); } }
  if (cols.length) { args.push(id); sqlite.prepare(`UPDATE sales_targets SET ${cols.join(", ")} WHERE id = ?`).run(...args); }
  return getSalesTarget(id);
}
export function deleteSalesTarget(id: number): void {
  sqlite.prepare(`DELETE FROM sales_targets WHERE id = ?`).run(id);
}
export function listTargetAchievements(targetId: number): any[] {
  return sqlite.prepare(`SELECT * FROM target_achievements WHERE target_id = ? ORDER BY created_at DESC`).all(targetId) as any[];
}
export function getTargetAchievement(id: number): any {
  return sqlite.prepare(`SELECT * FROM target_achievements WHERE id = ?`).get(id);
}

// R26.6b — compute achieved amount on the fly per metric (po | quotation | payment).
// Attribution requires the target's customer match AND (for PO) the customer's sales_rep_id
// to equal the target's rep. Period is [period_start, period_end] inclusive (date strings).
// PO/quotation date columns are unix-ms integers; payments use payment_date (unix-ms).
function periodMsBounds(t: any): { startMs: number; endMs: number } {
  const startMs = t.period_start ? Date.parse(t.period_start) : 0;
  const endBase = t.period_end ? Date.parse(t.period_end) : Date.now();
  const endMs = Number.isNaN(endBase) ? Date.now() : endBase + (24 * 60 * 60 * 1000 - 1);
  return { startMs: Number.isNaN(startMs) ? 0 : startMs, endMs };
}
export function computeTargetAchieved(t: any): number {
  const metric = String(t.metric || "po");
  if (metric === "onboarding") return 0;

  // R26.6h — approved target_claims are explicit credits the rep submitted (PO/Payment).
  // computeTargetAchieved previously ignored them, so admin-approved claims never surfaced
  // on per-customer targets (no matching purchase_orders_v2 row → aggregate was 0).
  const claimsSum = (() => {
    try {
      const row = sqlite.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s
           FROM target_claims
          WHERE target_id = ? AND status = 'approved'`,
      ).get(t.id) as any;
      return Number(row?.s || 0);
    } catch { return 0; }
  })();

  if (!t.customer_id) {
    // Global target: stored achieved_amount already reflects approved claims (approveTargetClaim
    // writes to it). max() guards against the stored value drifting below the claim total.
    return Math.max(Number(t.achieved_amount || 0), claimsSum);
  }

  const { startMs, endMs } = periodMsBounds(t);
  let aggregate = 0;
  try {
    if (metric === "po") {
      const row = sqlite.prepare(
        `SELECT COALESCE(SUM(po.total),0) AS s
           FROM purchase_orders_v2 po
           JOIN customers c ON c.id = po.customer_id
          WHERE po.deleted_at IS NULL AND po.customer_id = ?
            AND c.sales_rep_id = ?
            AND COALESCE(po.po_date, po.created_at) BETWEEN ? AND ?`,
      ).get(t.customer_id, t.sales_rep_user_id, startMs, endMs) as any;
      aggregate = Number(row?.s || 0);
    } else if (metric === "quotation") {
      const row = sqlite.prepare(
        `SELECT COALESCE(SUM(grand_total),0) AS s FROM quotations
          WHERE customer_id = ? AND created_at BETWEEN ? AND ?`,
      ).get(t.customer_id, startMs, endMs) as any;
      aggregate = Number(row?.s || 0);
    } else if (metric === "payment") {
      const row = sqlite.prepare(
        `SELECT COALESCE(SUM(amount_inr),0) AS s FROM payment_records
          WHERE customer_id = ? AND payment_date BETWEEN ? AND ?`,
      ).get(t.customer_id, startMs, endMs) as any;
      aggregate = Number(row?.s || 0);
    }
  } catch {
    return Number(t.achieved_amount || 0);
  }

  if (metric === "payment") {
    // payment_records is rarely populated for these targets; approved claims are the canonical
    // source and never overlap with the aggregate, so add them outright.
    return aggregate + claimsSum;
  }
  if (metric === "po") {
    // Auto-approved PO claims matched a real purchase_orders_v2 row → already counted in `aggregate`.
    // Only add approved PO claims whose po_number is NULL or has no matching PO for this customer,
    // so admin-approved (PO-not-in-DB) claims surface without double-counting matched ones.
    try {
      const row = sqlite.prepare(
        `SELECT COALESCE(SUM(tc.amount), 0) AS s
           FROM target_claims tc
          WHERE tc.target_id = ? AND tc.status = 'approved' AND tc.type = 'po'
            AND (tc.po_number IS NULL OR NOT EXISTS (
              SELECT 1 FROM purchase_orders_v2 po
               WHERE po.deleted_at IS NULL
                 AND (LOWER(po.po_number) = LOWER(tc.po_number)
                      OR LOWER(COALESCE(po.customer_po_number,'')) = LOWER(tc.po_number))
                 AND po.customer_id = ?
            ))`,
      ).get(t.id, t.customer_id) as any;
      return aggregate + Number(row?.s || 0);
    } catch {
      return aggregate;
    }
  }
  // quotation: no claim path, aggregate is canonical.
  return aggregate;
}
// Enrich targets with computed achieved + customer/lead display info.
export function enrichTargets(rows: any[]): any[] {
  return rows.map((t) => {
    const computed = computeTargetAchieved(t);
    let customer_name: string | null = null;
    if (t.customer_id) {
      const c = sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(t.customer_id) as any;
      customer_name = c?.name ?? null;
    }
    if (t.lead_id) {
      const l = sqlite.prepare(`SELECT name, phone, email, contact_person FROM leads WHERE id = ?`).get(t.lead_id) as any;
      return { ...t, achieved_computed: computed, customer_name, lead_name: l?.name ?? null, lead_phone: l?.phone ?? null, lead_email: l?.email ?? null, lead_contact_person: l?.contact_person ?? null };
    }
    return { ...t, achieved_computed: computed, customer_name, lead_name: null };
  });
}
// Onboarding PO submission: verify PO number against purchase_orders_v2 + rep attribution.
export function submitOnboardingPo(targetId: number, repUserId: number, poNumber: string): { ok: boolean; error?: string; target?: any } {
  const target = getSalesTarget(targetId);
  if (!target) return { ok: false, error: "Target not found" };
  if (target.sales_rep_user_id !== repUserId) return { ok: false, error: "Target does not belong to this rep" };
  const pn = String(poNumber || "").trim();
  if (!pn) return { ok: false, error: "PO number required" };
  const po = sqlite.prepare(
    `SELECT * FROM purchase_orders_v2 WHERE deleted_at IS NULL AND (LOWER(po_number) = LOWER(?) OR LOWER(customer_po_number) = LOWER(?)) LIMIT 1`,
  ).get(pn, pn) as any;
  const now = new Date().toISOString();
  let verified = false;
  if (po && po.customer_id) {
    const cust = sqlite.prepare(`SELECT sales_rep_id FROM customers WHERE id = ?`).get(po.customer_id) as any;
    if (cust && cust.sales_rep_id === repUserId) verified = true;
  }
  if (verified) {
    sqlite.prepare(
      `UPDATE sales_targets SET onboarding_status = 'verified', submitted_po_number = ?, verified_by_user_id = ?, verified_at = ? WHERE id = ?`,
    ).run(pn, repUserId, now, targetId);
  } else {
    sqlite.prepare(
      `UPDATE sales_targets SET onboarding_status = 'po_submitted', submitted_po_number = ? WHERE id = ?`,
    ).run(pn, targetId);
  }
  return { ok: true, target: getSalesTarget(targetId) };
}
export function verifyOnboardingByAdmin(targetId: number, adminUserId: number): any {
  sqlite.prepare(
    `UPDATE sales_targets SET onboarding_status = 'verified', verified_by_user_id = ?, verified_at = ? WHERE id = ?`,
  ).run(adminUserId, new Date().toISOString(), targetId);
  return getSalesTarget(targetId);
}

// Claim a PO against a target. Returns { ok, error?, achievement? }. Verification:
// (1) PO customer.sales_rep_id == rep, (2) PO status shipped or later, (3) not already claimed.
export function claimPoForTarget(targetId: number, poId: number, repUserId: number): { ok: boolean; error?: string; achievement?: any } {
  const target = getSalesTarget(targetId);
  if (!target) return { ok: false, error: "Target not found" };
  if (target.sales_rep_user_id !== repUserId) return { ok: false, error: "Target does not belong to this rep" };
  const po = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ? AND deleted_at IS NULL`).get(poId) as any;
  if (!po) return { ok: false, error: "PO not found" };
  const cust = po.customer_id ? sqlite.prepare(`SELECT * FROM customers WHERE id = ?`).get(po.customer_id) as any : null;
  if (!cust || cust.sales_rep_id !== repUserId) return { ok: false, error: "PO customer is not assigned to this rep" };
  const shippedStatuses = new Set(["shipped", "dispatched", "fulfilled", "completed", "delivered"]);
  const isShipped = shippedStatuses.has(String(po.status || "").toLowerCase()) || po.is_fully_dispatched || po.delhi_submitted_at;
  if (!isShipped) return { ok: false, error: "PO is not shipped yet" };
  const existing = sqlite.prepare(`SELECT id FROM target_achievements WHERE po_id = ?`).get(poId) as any;
  if (existing) return { ok: false, error: "PO already claimed against a target" };
  const amount = Number(po.total ?? 0);
  const info = sqlite.prepare(
    `INSERT INTO target_achievements (target_id, po_id, customer_id, amount, verified_by, admin_approved, created_at)
     VALUES (?, ?, ?, ?, 'auto', 0, ?)`,
  ).run(targetId, poId, po.customer_id ?? null, amount, Date.now());
  // Tentatively increment achieved_amount (fail-safe: still awaiting admin approval).
  sqlite.prepare(`UPDATE sales_targets SET achieved_amount = COALESCE(achieved_amount,0) + ? WHERE id = ?`).run(amount, targetId);
  return { ok: true, achievement: getTargetAchievement(Number(info.lastInsertRowid)) };
}
export function approveTargetAchievement(achievementId: number): any {
  sqlite.prepare(`UPDATE target_achievements SET admin_approved = 1, verified_by = 'admin' WHERE id = ?`).run(achievementId);
  return getTargetAchievement(achievementId);
}

// ============================================================
// R26.6g — target_claims: PO + Payment claims with admin approval.
// PO claim: if the submitted po_number matches an existing PO → auto-approve and credit
// the target immediately. Otherwise create a pending claim for admin review.
// Payment claim: always pending_admin_approval (admin verifies the deposit).
// ============================================================
export function getTargetClaim(id: number): any {
  return sqlite.prepare(`SELECT * FROM target_claims WHERE id = ?`).get(id);
}
export function createTargetClaim(data: {
  targetId: number; repUserId: number; type: "po" | "payment";
  poNumber?: string | null; amount: number; referenceNo?: string | null;
  claimDate?: string | null; status: string;
}): any {
  const info = sqlite.prepare(
    `INSERT INTO target_claims (target_id, rep_user_id, type, po_number, amount, reference_no, claim_date, status, created_at, approved_at, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.targetId, data.repUserId, data.type, data.poNumber ?? null, Number(data.amount || 0),
    data.referenceNo ?? null, data.claimDate ?? null, data.status, Date.now(),
    data.status === "approved" ? Date.now() : null, null,
  );
  return getTargetClaim(Number(info.lastInsertRowid));
}
// Submit a claim against a target. Returns the created claim row + whether it auto-approved.
export function submitTargetClaim(
  targetId: number, repUserId: number,
  body: { po_number?: string; amount?: number | string; payment_date?: string; reference_no?: string; type?: string },
): { ok: boolean; error?: string; claim?: any; autoApproved?: boolean } {
  const target = getSalesTarget(targetId);
  if (!target) return { ok: false, error: "Target not found" };
  if (target.sales_rep_user_id !== repUserId) return { ok: false, error: "Target does not belong to this rep" };

  const isPayment = body.type === "payment" || String(target.metric || "") === "payment";
  const amount = Number(body.amount ?? 0);
  if (!amount || amount <= 0) return { ok: false, error: "Amount is required" };

  if (isPayment) {
    if (!body.payment_date) return { ok: false, error: "Payment date is required" };
    const claim = createTargetClaim({
      targetId, repUserId, type: "payment", amount,
      referenceNo: body.reference_no ?? null, claimDate: body.payment_date,
      status: "pending_admin_approval",
    });
    return { ok: true, claim, autoApproved: false };
  }

  // PO claim
  const poNumber = String(body.po_number || "").trim();
  if (!poNumber) return { ok: false, error: "PO number is required" };
  const po = sqlite.prepare(
    `SELECT * FROM purchase_orders_v2 WHERE deleted_at IS NULL AND (LOWER(po_number) = LOWER(?) OR LOWER(COALESCE(customer_po_number,'')) = LOWER(?)) LIMIT 1`,
  ).get(poNumber, poNumber) as any;

  if (po) {
    // PO exists → auto-approve and credit immediately.
    const claim = createTargetClaim({
      targetId, repUserId, type: "po", poNumber, amount, status: "approved",
    });
    sqlite.prepare(`UPDATE sales_targets SET achieved_amount = COALESCE(achieved_amount,0) + ? WHERE id = ?`).run(amount, targetId);
    return { ok: true, claim, autoApproved: true };
  }
  // PO not found → pending admin approval, no credit yet.
  const claim = createTargetClaim({
    targetId, repUserId, type: "po", poNumber, amount, status: "pending_admin_approval",
  });
  return { ok: true, claim, autoApproved: false };
}
export function listTargetClaimsForTarget(targetId: number): any[] {
  return sqlite.prepare(`SELECT * FROM target_claims WHERE target_id = ? ORDER BY created_at DESC`).all(targetId) as any[];
}
// Admin: list claims (optionally by status) enriched with rep + customer + target context.
export function listTargetClaimsAdmin(status?: string): any[] {
  const where = status ? `WHERE tc.status = ?` : "";
  const rows = sqlite.prepare(
    `SELECT tc.* FROM target_claims tc ${where} ORDER BY tc.created_at DESC`,
  ).all(...(status ? [status] : [])) as any[];
  return rows.map((c) => {
    const t = getSalesTarget(c.target_id);
    const rep = c.rep_user_id ? sqlite.prepare(`SELECT name, username FROM data_team_users WHERE id = ?`).get(c.rep_user_id) as any : null;
    const cust = t?.customer_id ? sqlite.prepare(`SELECT name FROM customers WHERE id = ?`).get(t.customer_id) as any : null;
    return {
      ...c,
      rep_name: rep?.name || rep?.username || (c.rep_user_id ? `#${c.rep_user_id}` : "—"),
      customer_name: cust?.name || null,
      target_metric: t?.metric || null,
      target_type: t?.target_type || null,
    };
  });
}
export function approveTargetClaim(id: number, adminUserId: number): { ok: boolean; error?: string; claim?: any } {
  const claim = getTargetClaim(id);
  if (!claim) return { ok: false, error: "Claim not found" };
  if (claim.status === "approved") return { ok: true, claim };
  sqlite.prepare(
    `UPDATE target_claims SET status = 'approved', approved_at = ?, approved_by = ?, reject_reason = NULL WHERE id = ?`,
  ).run(Date.now(), adminUserId, id);
  // Credit the target (only if it was not already credited at submit-time).
  sqlite.prepare(`UPDATE sales_targets SET achieved_amount = COALESCE(achieved_amount,0) + ? WHERE id = ?`).run(Number(claim.amount || 0), claim.target_id);
  return { ok: true, claim: getTargetClaim(id) };
}
export function rejectTargetClaim(id: number, adminUserId: number, reason?: string): { ok: boolean; error?: string; claim?: any } {
  const claim = getTargetClaim(id);
  if (!claim) return { ok: false, error: "Claim not found" };
  // If it had been auto-approved/credited, roll the credit back.
  if (claim.status === "approved") {
    sqlite.prepare(`UPDATE sales_targets SET achieved_amount = MAX(0, COALESCE(achieved_amount,0) - ?) WHERE id = ?`).run(Number(claim.amount || 0), claim.target_id);
  }
  sqlite.prepare(
    `UPDATE target_claims SET status = 'rejected', approved_at = ?, approved_by = ?, reject_reason = ? WHERE id = ?`,
  ).run(Date.now(), adminUserId, reason ?? null, id);
  return { ok: true, claim: getTargetClaim(id) };
}

// ============================================================
// R26.6g — task_remarks: per-task chronological update log.
// ============================================================
export function listTaskRemarks(taskId: number): any[] {
  return sqlite.prepare(`SELECT * FROM task_remarks WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as any[];
}
export function addTaskRemark(taskId: number, userId: number | null, userName: string | null, body: string): any {
  const info = sqlite.prepare(
    `INSERT INTO task_remarks (task_id, user_id, user_name, body, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(taskId, userId, userName, body, Date.now());
  // Bump the parent task's updated_at so admin "last update" reflects the remark.
  try { sqlite.prepare(`UPDATE task_items SET updated_at = ? WHERE id = ?`).run(Date.now(), taskId); } catch { /* best-effort */ }
  return sqlite.prepare(`SELECT * FROM task_remarks WHERE id = ?`).get(Number(info.lastInsertRowid));
}
export function latestTaskRemarkAt(taskId: number): number | null {
  const row = sqlite.prepare(`SELECT MAX(created_at) AS m FROM task_remarks WHERE task_id = ?`).get(taskId) as any;
  return row?.m ?? null;
}

// ============================================================
// R26.6g — A3: sync a freshly-created quotation into matching quotation-type targets.
// Best-effort; the caller wraps this in try/catch so it never breaks quotation create.
// ============================================================
export function syncQuotationToTargets(quotationId: number): void {
  const quote = sqlite.prepare(`SELECT * FROM quotations WHERE id = ?`).get(quotationId) as any;
  if (!quote) return;
  const amount = Number(quote.grand_total ?? 0);
  if (!amount) return;
  const createdAt = Number(quote.created_at ?? Date.now());
  // Active quotation-type targets whose period covers the quotation's created_at.
  const targets = sqlite.prepare(
    `SELECT * FROM sales_targets WHERE metric = 'quotation' AND status = 'active'`,
  ).all() as any[];
  for (const t of targets) {
    // Per-customer targets must match the quotation's customer.
    if (t.customer_id && quote.customer_id && t.customer_id !== quote.customer_id) continue;
    if (t.customer_id && !quote.customer_id) continue;
    const startMs = t.period_start ? Date.parse(t.period_start) : 0;
    const endBase = t.period_end ? Date.parse(t.period_end) : Date.now();
    const endMs = Number.isNaN(endBase) ? Date.now() : endBase + (24 * 60 * 60 * 1000 - 1);
    const okStart = Number.isNaN(startMs) ? true : createdAt >= startMs;
    if (!(okStart && createdAt <= endMs)) continue;
    sqlite.prepare(`UPDATE sales_targets SET achieved_amount = COALESCE(achieved_amount,0) + ? WHERE id = ?`).run(amount, t.id);
  }
}

// R26.6g — consignment-portal From-Delhi detail (extends getConsignmentDetail with
// per-line pricing + invoice URL so the portal modal can show items + downloads).
export function getConsignmentPortalDetail(poId: number, origin?: string | null): any | null {
  const base = getConsignmentDetail(poId, origin);
  if (!base) return null;
  const po = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(poId) as any;
  const items = (sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(poId) as any[]).map((it) => {
    const qty = Number(it.qty ?? 0) || 0;
    const unitPrice = it.unit_price != null ? Number(it.unit_price) : 0;
    return {
      id: it.id,
      name: it.description || it.part_number || "—",
      partNumber: it.part_number ?? null,
      brand: it.brand ?? null,
      qty, unitPrice, total: unitPrice * qty,
    };
  });
  const totalValue = items.reduce((s, it) => s + it.total, 0);
  return {
    ...base,
    origin: "Delhi",
    destination: "Patna",
    itemCount: items.length,
    items,
    totalValue,
    invoiceUrl: po?.customer_po_url || null,
    docketUrl: base.docketUrl || null,
  };
}

// Idempotent auto-rollover: expired active targets that fell short get marked rolled_over
// and a fresh target for the next equal-length period is created with the remaining amount.
export function autoRolloverTargets(repUserId: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const expired = sqlite.prepare(
    `SELECT * FROM sales_targets WHERE sales_rep_user_id = ? AND status = 'active' AND period_end IS NOT NULL AND period_end < ? AND COALESCE(achieved_amount,0) < COALESCE(target_amount,0)`,
  ).all(repUserId, today) as any[];
  for (const t of expired) {
    // Guard: skip if a rollover child already exists (idempotent).
    const child = sqlite.prepare(`SELECT id FROM sales_targets WHERE rolled_over_from = ?`).get(t.id) as any;
    sqlite.prepare(`UPDATE sales_targets SET status = 'rolled_over' WHERE id = ?`).run(t.id);
    if (child) continue;
    const remaining = Number(t.target_amount ?? 0) - Number(t.achieved_amount ?? 0);
    // Next period: same length, starting day after old period_end.
    let nextStart = t.period_end, nextEnd: string | null = null;
    try {
      const startMs = Date.parse(t.period_start);
      const endMs = Date.parse(t.period_end);
      const len = endMs - startMs;
      const ns = endMs + 24 * 60 * 60 * 1000;
      nextStart = new Date(ns).toISOString().slice(0, 10);
      nextEnd = new Date(ns + len).toISOString().slice(0, 10);
    } catch { /* keep best-effort */ }
    sqlite.prepare(
      `INSERT INTO sales_targets (sales_rep_user_id, target_type, customer_id, period_start, period_end, target_amount, achieved_amount, rolled_over_from, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)`,
    ).run(t.sales_rep_user_id, t.target_type, t.customer_id, nextStart, nextEnd, remaining, t.id, Date.now());
  }
}

// ---- G2. leads kanban ----
export function leadsKanbanForRep(repUserId: number): any {
  const stages = listLeadStages();
  const out: any[] = [];
  for (const st of stages) {
    const leadsForStage = sqlite.prepare(
      `SELECT * FROM leads
        WHERE deleted_at IS NULL
          AND assigned_to_user_id = ?
          AND LOWER(stage) = LOWER(?)
        ORDER BY created_at DESC`,
    ).all(repUserId, st.name) as any[];
    out.push({ stage_name: st.name, count: leadsForStage.length, leads: leadsForStage });
  }
  return { stages: out };
}

// ---- G3. attendance ----
export function getAttendanceToday(repUserId: number, date: string): any {
  return sqlite.prepare(`SELECT * FROM attendance_checkins WHERE sales_rep_user_id = ? AND date = ?`).get(repUserId, date);
}
export function attendanceCheckin(repUserId: number, date: string, nowIso: string, missed: boolean): any {
  const existing = getAttendanceToday(repUserId, date);
  if (existing) {
    sqlite.prepare(`UPDATE attendance_checkins SET checkin_at = ?, checkin_missed = ? WHERE id = ?`).run(nowIso, missed ? 1 : 0, existing.id);
    return getAttendanceToday(repUserId, date);
  }
  sqlite.prepare(
    `INSERT INTO attendance_checkins (sales_rep_user_id, date, checkin_at, checkin_missed) VALUES (?, ?, ?, ?)`,
  ).run(repUserId, date, nowIso, missed ? 1 : 0);
  return getAttendanceToday(repUserId, date);
}
export function attendanceCheckout(repUserId: number, date: string, nowIso: string, missed: boolean): any {
  const existing = getAttendanceToday(repUserId, date);
  if (existing) {
    sqlite.prepare(`UPDATE attendance_checkins SET checkout_at = ?, checkout_missed = ? WHERE id = ?`).run(nowIso, missed ? 1 : 0, existing.id);
    return getAttendanceToday(repUserId, date);
  }
  sqlite.prepare(
    `INSERT INTO attendance_checkins (sales_rep_user_id, date, checkout_at, checkout_missed) VALUES (?, ?, ?, ?)`,
  ).run(repUserId, date, nowIso, missed ? 1 : 0);
  return getAttendanceToday(repUserId, date);
}
export function listAttendance(opts: { date?: string; repId?: number } = {}): any[] {
  const conds: string[] = []; const args: any[] = [];
  if (opts.date) { conds.push("date = ?"); args.push(opts.date); }
  if (opts.repId != null) { conds.push("sales_rep_user_id = ?"); args.push(opts.repId); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(`SELECT * FROM attendance_checkins ${where} ORDER BY date DESC, id DESC`).all(...args) as any[];
}

// ---- G3. visits ----
export function createVisit(data: { repUserId: number; customerId?: number; gpsLat?: number; gpsLng?: number; photoUrl?: string; notes?: string }): any {
  const info = sqlite.prepare(
    `INSERT INTO visit_checkins (sales_rep_user_id, customer_id, gps_lat, gps_lng, photo_url, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(data.repUserId, data.customerId ?? null, data.gpsLat ?? null, data.gpsLng ?? null, data.photoUrl ?? null, data.notes ?? null, new Date().toISOString());
  return sqlite.prepare(`SELECT * FROM visit_checkins WHERE id = ?`).get(info.lastInsertRowid);
}
export function listVisits(opts: { repId?: number; date?: string } = {}): any[] {
  const conds: string[] = []; const args: any[] = [];
  if (opts.repId != null) { conds.push("sales_rep_user_id = ?"); args.push(opts.repId); }
  if (opts.date) { conds.push("substr(created_at,1,10) = ?"); args.push(opts.date); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(`SELECT * FROM visit_checkins ${where} ORDER BY created_at DESC`).all(...args) as any[];
}

// ---- H. cross-team notifications feed ----
export function listCrossTeamEvents(opts: { userId?: number; role?: string } = {}): any[] {
  const conds: string[] = []; const args: any[] = [];
  if (opts.userId != null && opts.role) { conds.push("(target_user_id = ? OR target_role = ?)"); args.push(opts.userId, opts.role); }
  else if (opts.userId != null) { conds.push("target_user_id = ?"); args.push(opts.userId); }
  else if (opts.role) { conds.push("target_role = ?"); args.push(opts.role); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(`SELECT * FROM cross_team_events ${where} ORDER BY created_at DESC LIMIT 200`).all(...args) as any[];
}
export function markCrossTeamEventRead(id: number): void {
  sqlite.prepare(`UPDATE cross_team_events SET read_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}
export function crossTeamUnreadCount(opts: { userId?: number; role?: string } = {}): number {
  const conds: string[] = ["read_at IS NULL"]; const args: any[] = [];
  if (opts.userId != null && opts.role) { conds.push("(target_user_id = ? OR target_role = ?)"); args.push(opts.userId, opts.role); }
  else if (opts.userId != null) { conds.push("target_user_id = ?"); args.push(opts.userId); }
  else if (opts.role) { conds.push("target_role = ?"); args.push(opts.role); }
  const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM cross_team_events WHERE ${conds.join(" AND ")}`).get(...args) as any;
  return Number(row?.c ?? 0);
}
// H E5 dedupe — has a deadline event already been emitted today for this target?
export function deadlineEventExistsToday(targetId: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const row = sqlite.prepare(
    `SELECT id FROM cross_team_events WHERE event_type = 'target_deadline_approaching' AND substr(created_at,1,10) = ? AND payload_json LIKE ?`,
  ).get(today, `%"target_id":${targetId}%`) as any;
  return !!row;
}

// ---- D. user management (mirrors over data_team_users with role + soft delete) ----
export function listUsersByRole(role?: string): any[] {
  const conds: string[] = ["deleted_at IS NULL"]; const args: any[] = [];
  if (role) { conds.push("role = ?"); args.push(role); }
  const rows = sqlite.prepare(`SELECT id, username, name, email, phone, role, active, last_login, created_at FROM data_team_users WHERE ${conds.join(" AND ")} ORDER BY id`).all(...args) as any[];
  return rows;
}
export function softDeleteUser(id: number): void {
  sqlite.prepare(`UPDATE data_team_users SET deleted_at = ?, active = 0 WHERE id = ?`).run(new Date().toISOString(), id);
}

// ---- I. marketing whatsapp templates CRUD ----
export function listMarketingWhatsappTemplates(): any[] {
  return sqlite.prepare(`SELECT * FROM marketing_whatsapp_templates ORDER BY id DESC`).all() as any[];
}
export function createMarketingWhatsappTemplate(data: any): any {
  const now = Date.now();
  const info = sqlite.prepare(
    `INSERT INTO marketing_whatsapp_templates
       (template_name, display_name, category, language, header_type, header_required, variable_count, variable_labels, buttons, status, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    data.name ?? data.template_name, data.display_name ?? data.name ?? data.template_name,
    data.category ?? "marketing", data.language ?? "en", data.header_type ?? "none", data.header_required ?? 0,
    data.variable_count ?? (data.variables_json ? (JSON.parse(data.variables_json) || []).length : 0),
    data.variable_labels ?? data.variables_json ?? "[]", data.buttons ?? data.buttons_json ?? "[]",
    data.status ?? "active", now, now,
  );
  return sqlite.prepare(`SELECT * FROM marketing_whatsapp_templates WHERE id = ?`).get(info.lastInsertRowid);
}
export function updateMarketingWhatsappTemplate(id: number, data: any): any {
  const map: Record<string, any> = {
    template_name: data.name ?? data.template_name,
    display_name: data.display_name,
    category: data.category,
    language: data.language,
    header_type: data.header_type,
    header_required: data.header_required,
    variable_count: data.variable_count,
    variable_labels: data.variable_labels ?? data.variables_json,
    buttons: data.buttons ?? data.buttons_json,
    status: data.status,
  };
  const cols: string[] = []; const args: any[] = [];
  for (const [k, v] of Object.entries(map)) { if (v !== undefined) { cols.push(`${k} = ?`); args.push(v); } }
  cols.push("updated_at = ?"); args.push(Date.now());
  args.push(id);
  sqlite.prepare(`UPDATE marketing_whatsapp_templates SET ${cols.join(", ")} WHERE id = ?`).run(...args);
  return sqlite.prepare(`SELECT * FROM marketing_whatsapp_templates WHERE id = ?`).get(id);
}
export function deleteMarketingWhatsappTemplate(id: number): void {
  sqlite.prepare(`DELETE FROM marketing_whatsapp_templates WHERE id = ?`).run(id);
}

// R26.6b — upsert a Meta/AiSensy template by template_name (idempotent re-sync).
// Inserts new rows or refreshes the synced metadata of existing ones; never duplicates.
export function upsertMarketingWhatsappTemplateByName(data: {
  template_name: string; display_name?: string; category?: string; language?: string;
  header_type?: string; variable_count?: number; variable_labels?: string; buttons?: string; status?: string;
}): { action: "inserted" | "updated"; row: any } {
  const now = Date.now();
  const existing = sqlite.prepare(`SELECT id FROM marketing_whatsapp_templates WHERE template_name = ?`).get(data.template_name) as any;
  if (existing) {
    sqlite.prepare(
      `UPDATE marketing_whatsapp_templates
         SET display_name = ?, category = ?, language = ?, header_type = ?,
             variable_count = ?, variable_labels = ?, buttons = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      data.display_name ?? data.template_name, data.category ?? "marketing", data.language ?? "en",
      data.header_type ?? "none", data.variable_count ?? 0, data.variable_labels ?? "[]",
      data.buttons ?? "[]", data.status ?? "active", now, existing.id,
    );
    return { action: "updated", row: sqlite.prepare(`SELECT * FROM marketing_whatsapp_templates WHERE id = ?`).get(existing.id) };
  }
  const info = sqlite.prepare(
    `INSERT INTO marketing_whatsapp_templates
       (template_name, display_name, category, language, header_type, header_required, variable_count, variable_labels, buttons, status, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    data.template_name, data.display_name ?? data.template_name, data.category ?? "marketing",
    data.language ?? "en", data.header_type ?? "none", data.variable_count ?? 0,
    data.variable_labels ?? "[]", data.buttons ?? "[]", data.status ?? "active", now, now,
  );
  return { action: "inserted", row: sqlite.prepare(`SELECT * FROM marketing_whatsapp_templates WHERE id = ?`).get(info.lastInsertRowid) };
}

// ---- I2. audience include/exclude preview ----
export function getAudienceRow(id: number): any {
  return sqlite.prepare(`SELECT * FROM marketing_audiences WHERE id = ?`).get(id);
}
export function updateAudienceIncludeExclude(id: number, includeIds?: number[], excludeIds?: number[], source?: string): any {
  const cols: string[] = []; const args: any[] = [];
  if (includeIds !== undefined) { cols.push("include_user_ids_json = ?"); args.push(JSON.stringify(includeIds)); }
  if (excludeIds !== undefined) { cols.push("exclude_user_ids_json = ?"); args.push(JSON.stringify(excludeIds)); }
  if (source !== undefined && ["customers", "vendors", "leads"].includes(source)) { cols.push("source = ?"); args.push(source); }
  if (cols.length) { args.push(id); sqlite.prepare(`UPDATE marketing_audiences SET ${cols.join(", ")} WHERE id = ?`).run(...args); }
  return getAudienceRow(id);
}

// R26.6b — resolve an audience's source table to its contact rows. Source switches the
// base table between customers / vendors / leads; all three expose id/name/phone/email/state.
export function audienceSourceTable(source?: string | null): "customers" | "vendors" | "leads" {
  const s = String(source || "customers").toLowerCase();
  return s === "vendors" || s === "leads" ? s : "customers";
}
export function materializeAudience(audienceId: number, limit?: number): { rows: any[]; summary: any } {
  const aud = getAudienceRow(audienceId);
  if (!aud) return { rows: [], summary: { matched: 0, included_extra: 0, excluded: 0, final_count: 0, source: "customers" } };
  const table = audienceSourceTable(aud.source);
  const base = sqlite.prepare(`SELECT id, name, phone, email, state FROM ${table}`).all() as any[];
  const includeIds: number[] = aud.include_user_ids_json ? JSON.parse(aud.include_user_ids_json) : [];
  const excludeIds: number[] = aud.exclude_user_ids_json ? JSON.parse(aud.exclude_user_ids_json) : [];
  const matched = new Set(base.map((c) => c.id));
  const includedExtra = includeIds.filter((cid) => !matched.has(cid));
  for (const cid of includeIds) matched.add(cid);
  for (const cid of excludeIds) matched.delete(cid);
  const ids = Array.from(matched);
  const sliced = limit != null ? ids.slice(0, limit) : ids;
  const rows = sliced.map((cid) => sqlite.prepare(`SELECT id, name, phone, email, state FROM ${table} WHERE id = ?`).get(cid)).filter(Boolean);
  return { rows, summary: { matched: base.length, included_extra: includedExtra.length, excluded: excludeIds.length, final_count: matched.size, source: table } };
}

// ==================== R27.0 — SALES EXPENSES ====================
// Sales reps submit travel expenses (hotel/train/flight/auto/meal/misc) for approval.
// Approval workflow (accounts dashboard) ships in R27.3; rows queue with status='pending'.
export function createSalesExpense(data: {
  salesUserId: number; expenseType: string; expenseDate: string; amount: number;
  fields?: any; proofUrl?: string | null; notes?: string | null;
}): any {
  const info = sqlite.prepare(
    `INSERT INTO sales_expenses (sales_user_id, expense_type, expense_date, amount, fields_json, proof_url, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    data.salesUserId, data.expenseType, data.expenseDate, Number(data.amount) || 0,
    data.fields != null ? JSON.stringify(data.fields) : null,
    data.proofUrl ?? null, data.notes ?? null,
  );
  return getSalesExpense(Number(info.lastInsertRowid));
}
export function getSalesExpense(id: number): any {
  const row = sqlite.prepare(`SELECT * FROM sales_expenses WHERE id = ?`).get(id) as any;
  if (row && row.fields_json) { try { row.fields = JSON.parse(row.fields_json); } catch { row.fields = null; } }
  return row;
}
export function listSalesExpenses(opts: { salesUserId?: number; status?: string } = {}): any[] {
  const conds: string[] = []; const args: any[] = [];
  if (opts.salesUserId != null) { conds.push("sales_user_id = ?"); args.push(opts.salesUserId); }
  if (opts.status) { conds.push("status = ?"); args.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite.prepare(`SELECT * FROM sales_expenses ${where} ORDER BY expense_date DESC, id DESC`).all(...args) as any[];
  for (const r of rows) { if (r.fields_json) { try { r.fields = JSON.parse(r.fields_json); } catch { r.fields = null; } } }
  return rows;
}
// Reps may delete only their own still-pending expenses.
export function deleteSalesExpense(id: number, salesUserId: number): { ok: boolean; error?: string } {
  const row = getSalesExpense(id);
  if (!row) return { ok: false, error: "Expense not found" };
  if (row.sales_user_id !== salesUserId) return { ok: false, error: "Not your expense" };
  if (row.status !== "pending") return { ok: false, error: "Only pending expenses can be deleted" };
  sqlite.prepare(`DELETE FROM sales_expenses WHERE id = ?`).run(id);
  return { ok: true };
}
