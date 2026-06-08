// Phase 3 + Phase 4 storage methods — appended via mixin pattern.
// Imported and called by routes; uses the same `db` + sqlite handle as storage.ts.
import { db } from "./storage";
import {
  posts, priceLists, priceItems, consignments, adminUsers,
  customers, notificationTemplates, notificationLog,
} from "@shared/schema";
import type {
  Post, InsertPost, PriceList, InsertPriceList, PriceItem,
  Consignment, InsertConsignment, AdminUser,
  Customer, InsertCustomer, NotificationTemplate, NotificationLog,
} from "@shared/schema";
import { eq, desc, and, like, or, sql } from "drizzle-orm";
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

// -------- DEFAULT TEMPLATES SEED (Phase 4) --------
const DEFAULT_TEMPLATES = [
  {
    eventKey: "consignment_created", channel: "email",
    subject: "Order Received — Docket {docket}",
    body: "Dear {customerName},\n\nWe have received your order. Your consignment will be dispatched soon.\n\nDocket: {docket}\nFrom: {origin}\nTo: {destination}\n\nYou can track your consignment anytime here:\n{trackingLink}\n\nThank you for choosing Narmada Mobility.\n\nRegards,\nNarmada Mobility\nsales@Narmadamobility.com\n+91 79090 83806",
  },
  {
    eventKey: "consignment_created", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\nYour order has been received. \n\n📦 Docket: {docket}\n🚚 {origin} → {destination}\n\nTrack live status: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "in_transit", channel: "email",
    subject: "Your consignment is in transit — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment is now in transit.\n\nDocket: {docket}\nFrom: {origin}\nTo: {destination}\nETA: {etaDate}\n\nTrack live status:\n{trackingLink}\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "in_transit", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n🚚 Your order is in transit.\n\n📦 Docket: {docket}\n📅 ETA: {etaDate}\n\nTrack: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "out_for_delivery", channel: "email",
    subject: "Out for delivery — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment is out for delivery today.\n\nDocket: {docket}\nDestination: {destination}\n\nPlease ensure someone is available to receive it.\n\nTrack: {trackingLink}\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "out_for_delivery", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n🛵 Out for delivery today.\n\n📦 Docket: {docket}\n📍 {destination}\n\nPlease be available.\n\nTrack: {trackingLink}\n\n— Narmada Mobility",
  },
  {
    eventKey: "delivered", channel: "email",
    subject: "Delivered — Docket {docket}",
    body: "Dear {customerName},\n\nYour consignment has been delivered. Thank you for choosing Narmada Mobility.\n\nDocket: {docket}\nDelivered on: {deliveredDate}\n\nWe would love to hear your feedback. Reply to this email or WhatsApp us at +91 79090 83806.\n\nRegards,\nNarmada Mobility",
  },
  {
    eventKey: "delivered", channel: "whatsapp",
    subject: null,
    body: "Hi {customerName},\n\n✅ Your order has been delivered.\n\n📦 Docket: {docket}\n📅 {deliveredDate}\n\nThank you for choosing Narmada Mobility. Reply with feedback!",
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
