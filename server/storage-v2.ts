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
import { eq, desc, and, like, or, sql, gte, lte } from "drizzle-orm";
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
export async function updateCustomer(id: number, data: Partial<InsertCustomer>): Promise<Customer | undefined> {
  return db.update(customers).set(data).where(eq(customers.id, id)).returning().get();
}
export async function deleteCustomer(id: number): Promise<void> {
  db.delete(customers).where(eq(customers.id, id)).run();
}
export async function getCustomerConsignmentCount(id: number): Promise<number> {
  const row = sqlite.prepare("SELECT COUNT(*) AS c FROM consignments WHERE customer_id = ?").get(id) as any;
  return row?.c ?? 0;
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
  if (opts.from) conds.push(gte(ledgerEntries.entryDate, opts.from));
  if (opts.to) conds.push(lte(ledgerEntries.entryDate, opts.to));
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
}): Promise<DataTeamUser> {
  return db.insert(dataTeamUsers).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name || null,
    email: data.email || null,
    phone: data.phone || null,
    role: "data_team",
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
        SELECT c.code
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
      c.code            AS customerCode,
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
