import { products, contactSubmissions, settings, sitemapRuns } from '@shared/schema';
import type { Product, InsertProduct, Contact, InsertContact, Setting } from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, like, or } from "drizzle-orm";

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
`);

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
