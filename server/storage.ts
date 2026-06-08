import {
  products, contactSubmissions, settings, sitemapRuns,
  posts, priceLists, priceItems, consignments, adminUsers,
} from '@shared/schema';
import type {
  Product, InsertProduct, Contact, InsertContact, Setting,
  Post, InsertPost, PriceList, InsertPriceList, PriceItem,
  Consignment, InsertConsignment, AdminUser,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, like, or, sql } from "drizzle-orm";

// SQLite path is configurable so Render can mount a persistent disk and point DATA_DIR at it.
// Locally / on shared hosting it defaults to ./data.db (project root).
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const DATA_DIR = process.env.DATA_DIR || ".";
if (DATA_DIR !== "." && !existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
const DB_PATH = join(DATA_DIR, "data.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Ensure tables exist (idempotent — Drizzle uses schema, but we create-if-missing for portability)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT,
  category TEXT NOT NULL,
  part_number TEXT,
  oem_number TEXT,
  description TEXT NOT NULL,
  short_description TEXT,
  price_inr REAL NOT NULL,
  stock_qty INTEGER DEFAULT 0,
  image_urls TEXT NOT NULL DEFAULT '[]',
  compatible_models TEXT DEFAULT '[]',
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  featured INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  product_interest TEXT,
  created_at INTEGER NOT NULL,
  status TEXT DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sitemap_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  cover_image_url TEXT,
  type TEXT NOT NULL DEFAULT 'blog',
  product_slug TEXT,
  author_name TEXT DEFAULT 'Narmada Mobility',
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  published INTEGER DEFAULT 0,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  version_label TEXT,
  item_count INTEGER DEFAULT 0,
  effective_date INTEGER,
  notes TEXT,
  uploaded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS price_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  price_list_id INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  part_number_clean TEXT NOT NULL,
  description TEXT,
  mrp REAL,
  dealer_price REAL,
  hsn_code TEXT,
  gst_percent REAL,
  uom TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_items_pn_clean ON price_items(part_number_clean);
CREATE INDEX IF NOT EXISTS idx_price_items_brand ON price_items(brand);
CREATE TABLE IF NOT EXISTS consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  docket_number TEXT NOT NULL UNIQUE,
  carrier TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  bundles_count INTEGER DEFAULT 1,
  invoice_number TEXT,
  invoice_amount REAL,
  dispatch_date INTEGER,
  eta_date INTEGER,
  delivered_date INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  display_name TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_templates_event_channel ON notification_templates(event_key, channel);
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER,
  customer_id INTEGER,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  error_msg TEXT,
  sent_at INTEGER NOT NULL
);
`);

// Phase 4: Add new columns to consignments if not present (idempotent)
try { sqlite.exec(`ALTER TABLE consignments ADD COLUMN customer_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE consignments ADD COLUMN customer_email TEXT`); } catch {}

// Seed default USD/INR rate if missing
const existingRate = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("usd_inr_rate");
if (!existingRate) {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("usd_inr_rate", "83.5");
}

export const db = drizzle(sqlite);

export interface IStorage {
  listProducts(filters?: { brand?: string; category?: string; q?: string; featured?: boolean; activeOnly?: boolean }): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  getProductBySlug(slug: string): Promise<Product | undefined>;
  createProduct(p: InsertProduct): Promise<Product>;
  updateProduct(id: number, p: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<void>;

  createContact(c: InsertContact): Promise<Contact>;
  listContacts(): Promise<Contact[]>;
  updateContactStatus(id: number, status: string): Promise<void>;

  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  logSitemapRun(urlCount: number): Promise<void>;
  getLatestSitemapRun(): Promise<{ urlCount: number; generatedAt: number } | undefined>;
}

export class DatabaseStorage implements IStorage {
  async listProducts(filters: { brand?: string; category?: string; q?: string; featured?: boolean; activeOnly?: boolean } = {}): Promise<Product[]> {
    const conditions = [];
    if (filters.brand) conditions.push(eq(products.brand, filters.brand));
    if (filters.category) conditions.push(eq(products.category, filters.category));
    if (filters.featured) conditions.push(eq(products.featured, true));
    if (filters.activeOnly) conditions.push(eq(products.active, true));
    if (filters.q) {
      const q = `%${filters.q.toLowerCase()}%`;
      conditions.push(or(like(products.name, q), like(products.description, q), like(products.model, q), like(products.partNumber, q)));
    }
    const where = conditions.length ? and(...conditions) : undefined;
    if (where) return db.select().from(products).where(where).orderBy(desc(products.createdAt)).all();
    return db.select().from(products).orderBy(desc(products.createdAt)).all();
  }
  async getProduct(id: number) { return db.select().from(products).where(eq(products.id, id)).get(); }
  async getProductBySlug(slug: string) { return db.select().from(products).where(eq(products.slug, slug)).get(); }
  async createProduct(p: InsertProduct) {
    return db.insert(products).values({ ...p, createdAt: Date.now() }).returning().get();
  }
  async updateProduct(id: number, p: Partial<InsertProduct>) {
    return db.update(products).set(p).where(eq(products.id, id)).returning().get();
  }
  async deleteProduct(id: number) {
    db.delete(products).where(eq(products.id, id)).run();
  }

  async createContact(c: InsertContact) {
    return db.insert(contactSubmissions).values({ ...c, createdAt: Date.now() }).returning().get();
  }
  async listContacts() { return db.select().from(contactSubmissions).orderBy(desc(contactSubmissions.createdAt)).all(); }
  async updateContactStatus(id: number, status: string) {
    db.update(contactSubmissions).set({ status }).where(eq(contactSubmissions.id, id)).run();
  }

  async getSetting(key: string) {
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value;
  }
  async setSetting(key: string, value: string) {
    const existing = await this.getSetting(key);
    if (existing !== undefined) {
      db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    } else {
      db.insert(settings).values({ key, value }).run();
    }
  }

  async logSitemapRun(urlCount: number) {
    db.insert(sitemapRuns).values({ urlCount, generatedAt: Date.now() }).run();
  }
  async getLatestSitemapRun() {
    const row = db.select().from(sitemapRuns).orderBy(desc(sitemapRuns.generatedAt)).limit(1).get();
    if (!row) return undefined;
    return { urlCount: row.urlCount, generatedAt: row.generatedAt };
  }
}

export const storage = new DatabaseStorage();
