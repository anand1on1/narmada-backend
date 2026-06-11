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
  meta_json TEXT,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_log_sent_at ON notification_log(sent_at DESC);

-- Session A V2: admin_sessions (DB-backed auth, survives Render restarts)
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Session B foundation (additive stubs — no logic yet)
CREATE TABLE IF NOT EXISTS customer_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_emails_customer ON customer_emails(customer_id);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  label TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT DEFAULT 'India',
  gstin TEXT,
  is_billing INTEGER NOT NULL DEFAULT 0,
  is_shipping INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

CREATE TABLE IF NOT EXISTS customer_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  credit_limit_inr REAL DEFAULT 0,
  payment_terms_days INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes(email, purpose);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  entry_date INTEGER NOT NULL,
  voucher_type TEXT NOT NULL,
  voucher_no TEXT,
  reference_id INTEGER,
  description TEXT,
  debit_inr REAL NOT NULL DEFAULT 0,
  credit_inr REAL NOT NULL DEFAULT 0,
  balance_inr REAL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer_date ON ledger_entries(customer_id, entry_date);

CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  items TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  quoted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(status);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  customer_po_number TEXT NOT NULL,
  rfq_id INTEGER,
  items TEXT NOT NULL,
  total_inr REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at INTEGER,
  approved_at INTEGER,
  approved_by TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_customer ON purchase_orders(customer_id);

CREATE TABLE IF NOT EXISTS payment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  amount_inr REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  reference_no TEXT,
  payment_date INTEGER NOT NULL,
  notes TEXT,
  recorded_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payment_records(customer_id);

CREATE TABLE IF NOT EXISTS file_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  file_kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_entity ON file_uploads(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS bank_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch TEXT,
  account_type TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Session B: quotes table (RFQ -> Quote -> PO 3-state flow)
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  rfq_id INTEGER,
  customer_id INTEGER NOT NULL,
  items TEXT NOT NULL,
  subtotal_inr REAL NOT NULL DEFAULT 0,
  gst_inr REAL NOT NULL DEFAULT 0,
  total_inr REAL NOT NULL DEFAULT 0,
  valid_until INTEGER,
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  terms TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_rfq ON quotes(rfq_id);
`);

// Phase 4: Add new columns to consignments if not present (idempotent)
try { sqlite.exec(`ALTER TABLE consignments ADD COLUMN customer_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE consignments ADD COLUMN customer_email TEXT`); } catch {}

// Session B: Extend customers with credit/opening balance/contact person/payment terms (additive)
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN credit_limit_inr REAL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN opening_balance_inr REAL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN payment_terms_days INTEGER DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN contact_person TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN company_pan TEXT`); } catch {}

// Round 3: per-customer default discount (auto-applied to new quote line items)
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN default_discount_pct REAL`); } catch {}

// Round 3: per-quotation shipping address (single customer, multiple sites)
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_name TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_address TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_city TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_state TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_pincode TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE quotations ADD COLUMN shipping_phone TEXT`); } catch {}

// Session B: Link RFQ to quote (after quote is created)
try { sqlite.exec(`ALTER TABLE rfqs ADD COLUMN quote_id INTEGER`); } catch {}

// Session B: Link PO to quote (when customer accepts a quote and issues PO)
try { sqlite.exec(`ALTER TABLE purchase_orders ADD COLUMN quote_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE purchase_orders ADD COLUMN gst_inr REAL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE purchase_orders ADD COLUMN subtotal_inr REAL DEFAULT 0`); } catch {}

// Session C: New tables
sqlite.exec(`
CREATE TABLE IF NOT EXISTS quoting_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT,
  pan TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  phone TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_ifsc TEXT,
  bank_branch TEXT,
  logo_url TEXT,
  signature_url TEXT,
  quote_prefix TEXT DEFAULT 'NM',
  default_terms TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS data_team_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'data_team',
  active INTEGER DEFAULT 1,
  last_login INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS data_team_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS parts_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hsn TEXT,
  gst_rate REAL,
  brand TEXT,
  last_mrp REAL,
  last_source TEXT,
  last_updated INTEGER,
  search_text TEXT,
  use_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parts_search ON parts_master(search_text);
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  quoting_company_id INTEGER,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'INR',
  fx_rate REAL DEFAULT 1,
  fx_locked_at INTEGER,
  subtotal REAL DEFAULT 0,
  total_discount REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  valid_until INTEGER,
  notes TEXT,
  terms TEXT,
  created_by_user_id INTEGER,
  pdf_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL DEFAULT 1,
  part_number TEXT,
  product_name TEXT NOT NULL,
  hsn TEXT,
  brand TEXT,
  qty REAL NOT NULL DEFAULT 1,
  mrp REAL NOT NULL DEFAULT 0,
  discount REAL DEFAULT 0,
  gst_pct REAL DEFAULT 18,
  line_total REAL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quot ON quotation_items(quotation_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS email_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at INTEGER,
  processed INTEGER DEFAULT 0,
  processed_at INTEGER,
  rfq_id INTEGER,
  customer_id INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair ON fx_rates(base_currency, target_currency, fetched_at);
CREATE TABLE IF NOT EXISTS customer_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_customer ON customer_chat_messages(customer_id);
CREATE TABLE IF NOT EXISTS account_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  gstin TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id TEXT,
  review_notes TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
`);

// Session C: ALTER customers to add customer_code
try { sqlite.exec(`ALTER TABLE customers ADD COLUMN customer_code TEXT`); } catch {}

// Bug-fix session: store raw provider response on whatsapp notification rows for delivery diagnostics (additive)
try { sqlite.exec(`ALTER TABLE notification_log ADD COLUMN meta_json TEXT`); } catch {}

// Seed default USD/INR rate if missing
const existingRate = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get("usd_inr_rate");
if (!existingRate) {
  sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("usd_inr_rate", "83.5");
}

// Seed default ICICI bank details if no rows exist (Session A V2)
const bankRow = sqlite.prepare("SELECT id FROM bank_details LIMIT 1").get();
if (!bankRow) {
  sqlite.prepare(`INSERT INTO bank_details
    (label, account_name, account_no, ifsc, bank_name, branch, account_type, is_default, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`).run(
    "ICICI Primary",
    "NARMADA MOBILITY PRIVATE LIMITED",
    "625905053961",
    "ICIC0006259",
    "ICICI Bank",
    "Exhibition Road, Shahi Bhawan, Patna - 800001",
    "Current",
    Date.now()
  );
}

// Cleanup expired admin sessions on boot (Session A V2)
try {
  sqlite.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
} catch {}

export const db = drizzle(sqlite);
export const rawSqlite = sqlite;

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
