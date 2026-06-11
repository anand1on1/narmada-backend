// Rounds 4.4 → 7 additive migrations.
// Idempotent CREATE TABLE IF NOT EXISTS DDL run on boot from server/index.ts.
// NEVER drop or rename existing tables/columns — additive only.
import { rawSqlite as sqlite } from "./storage";

export function runR4toR7Migrations() {
  sqlite.exec(`
  -- R4.4 AI ledger queries
  CREATE TABLE IF NOT EXISTS ledger_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    question TEXT NOT NULL,
    answer TEXT,
    sql TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  -- R5.1 vendors
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gstin TEXT, pan TEXT, address TEXT, city TEXT, state TEXT, pincode TEXT,
    phone TEXT, whatsapp TEXT, email TEXT, payment_terms TEXT,
    brands TEXT, categories TEXT, rating INTEGER, notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vendor_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    name TEXT NOT NULL, role TEXT, phone TEXT, whatsapp TEXT, email TEXT
  );

  -- R5.1 companies (multi-company billing)
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gstin TEXT, pan TEXT,
    address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, pincode TEXT,
    bank_name TEXT, bank_branch TEXT, account_no TEXT, ifsc TEXT, beneficiary_name TEXT,
    signatory_name TEXT, signatory_phone TEXT, signatory_email TEXT,
    gst_type TEXT NOT NULL DEFAULT 'regular',
    logo_url TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  -- R5.1 purchase orders (v2)
  CREATE TABLE IF NOT EXISTS purchase_orders_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT NOT NULL UNIQUE,
    quotation_id INTEGER, customer_id INTEGER, company_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT, created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    part_number TEXT, brand TEXT, description TEXT,
    qty REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    discount_pct REAL NOT NULL DEFAULT 0,
    tax_pct REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    vendor_id INTEGER, purchase_cost REAL, warehouse_id INTEGER,
    fulfil_status TEXT NOT NULL DEFAULT 'pending',
    docket_no TEXT, courier TEXT, photo_url TEXT,
    collected_at INTEGER, packed_at INTEGER, dispatched_at INTEGER
  );

  -- R5.1 RFQs (v2)
  CREATE TABLE IF NOT EXISTS rfqs_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_number TEXT NOT NULL UNIQUE,
    po_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    requested_by TEXT, notes TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS rfq_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    part_number TEXT, brand TEXT, description TEXT,
    qty REAL NOT NULL DEFAULT 1,
    target_price REAL, notes TEXT
  );

  CREATE TABLE IF NOT EXISTS rfq_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    vendor_id INTEGER NOT NULL,
    sent_at INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    whatsapp_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS rfq_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    vendor_id INTEGER NOT NULL,
    item_id INTEGER,
    rate REAL, moq REAL, lead_time_days INTEGER,
    photo_url TEXT, notes TEXT, raw_message TEXT,
    extracted_by TEXT NOT NULL DEFAULT 'manual',
    is_winner INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL DEFAULT 0
  );

  -- R5.1 vendor conversations
  CREATE TABLE IF NOT EXISTS vendor_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    rfq_id INTEGER,
    direction TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    message_text TEXT, media_url TEXT, media_type TEXT,
    whatsapp_message_id TEXT, sent_by TEXT,
    claude_extracted TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  -- R5.1 warehouses
  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    city TEXT, address TEXT, contact_name TEXT, contact_phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS warehouse_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_warehouse_id INTEGER NOT NULL,
    to_warehouse_id INTEGER NOT NULL,
    part_number TEXT,
    qty REAL NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    dispatched_at INTEGER, received_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  -- R5.6 rate history
  CREATE TABLE IF NOT EXISTS rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_number TEXT, brand TEXT, vendor_id INTEGER,
    rate REAL, moq REAL, lead_time_days INTEGER,
    source TEXT NOT NULL, source_id INTEGER,
    recorded_at INTEGER NOT NULL DEFAULT 0
  );

  -- R7 leads CRM
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'manual',
    name TEXT NOT NULL,
    phone TEXT, whatsapp TEXT, email TEXT, city TEXT, state TEXT, requirement TEXT,
    stage TEXT NOT NULL DEFAULT 'new',
    owner_id INTEGER,
    score INTEGER NOT NULL DEFAULT 0,
    tags TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    last_contact_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS lead_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL, detail TEXT, created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    period TEXT NOT NULL, period_key TEXT NOT NULL,
    metric TEXT NOT NULL,
    target_value REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, body TEXT,
    audience TEXT NOT NULL DEFAULT 'all',
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS task_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    assigned_to INTEGER, assigned_by TEXT, due_date INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  -- Indexes (leads pipeline scales to 100k rows)
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
  CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
  CREATE INDEX IF NOT EXISTS idx_po_items_po ON po_items(po_id);
  CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq ON rfq_quotes(rfq_id);
  CREATE INDEX IF NOT EXISTS idx_vendor_conv_vendor ON vendor_conversations(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_rate_history_part ON rate_history(part_number);
  `);

  console.log("[migrations] R4.4→R7 tables ensured");
}

// -------- R8 additive migrations --------
export function runR8Migrations() {
  // Each statement is run in isolation so that a "duplicate column" (re-run) or any
  // other per-statement error is logged and skipped rather than stalling/aborting boot.
  const stmts: Array<{ desc: string; sql: string }> = [
    // purchase_orders_v2 new columns
    { desc: "purchase_orders_v2.customer_po_number", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN customer_po_number TEXT` },
    { desc: "purchase_orders_v2.customer_po_url", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN customer_po_url TEXT` },
    { desc: "purchase_orders_v2.customer_po_parsed_json", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN customer_po_parsed_json TEXT` },
    { desc: "purchase_orders_v2.dispatch_round", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN dispatch_round INTEGER DEFAULT 1` },
    { desc: "purchase_orders_v2.is_fully_dispatched", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN is_fully_dispatched INTEGER DEFAULT 0` },
    { desc: "purchase_orders_v2.delhi_submitted_at", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN delhi_submitted_at INTEGER` },
    { desc: "purchase_orders_v2.ship_to_name", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN ship_to_name TEXT` },
    { desc: "purchase_orders_v2.ship_to_address", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN ship_to_address TEXT` },
    { desc: "purchase_orders_v2.ship_to_phone", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN ship_to_phone TEXT` },
    { desc: "purchase_orders_v2.notified_delhi_at", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN notified_delhi_at INTEGER` },
    // po_items new columns
    { desc: "po_items.vendor_rate", sql: `ALTER TABLE po_items ADD COLUMN vendor_rate REAL` },
    { desc: "po_items.vendor_name", sql: `ALTER TABLE po_items ADD COLUMN vendor_name TEXT` },
    { desc: "po_items.assigned_at", sql: `ALTER TABLE po_items ADD COLUMN assigned_at INTEGER` },
    { desc: "po_items.assigned_by", sql: `ALTER TABLE po_items ADD COLUMN assigned_by TEXT` },
    { desc: "po_items.shipped_status", sql: `ALTER TABLE po_items ADD COLUMN shipped_status TEXT DEFAULT 'pending'` },
    { desc: "po_items.shipped_at", sql: `ALTER TABLE po_items ADD COLUMN shipped_at INTEGER` },
    { desc: "po_items.shipped_by", sql: `ALTER TABLE po_items ADD COLUMN shipped_by TEXT` },
    { desc: "po_items.dispatch_round_shipped", sql: `ALTER TABLE po_items ADD COLUMN dispatch_round_shipped INTEGER` },
    // dispatches table
    {
      desc: "dispatches table",
      sql: `CREATE TABLE IF NOT EXISTS dispatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL,
        round_no INTEGER NOT NULL DEFAULT 1,
        docket_no TEXT,
        courier_name TEXT,
        dispatch_date INTEGER,
        docket_photo_url TEXT,
        pdf_url TEXT,
        submitted_by TEXT,
        submitted_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT 0
      )`,
    },
    { desc: "idx_dispatches_po", sql: `CREATE INDEX IF NOT EXISTS idx_dispatches_po ON dispatches(po_id)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R8: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R8: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R8 tables/columns ensured");
}
