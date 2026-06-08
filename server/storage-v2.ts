// Phase 3 storage methods — appended via mixin pattern.
// Imported and called by routes; uses the same `db` + sqlite handle as storage.ts.
import { db } from "./storage";
import {
  posts, priceLists, priceItems, consignments, adminUsers,
} from "@shared/schema";
import type {
  Post, InsertPost, PriceList, InsertPriceList, PriceItem,
  Consignment, InsertConsignment, AdminUser,
} from "@shared/schema";
import { eq, desc, and, like, or } from "drizzle-orm";
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
