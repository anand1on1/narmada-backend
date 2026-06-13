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

// -------- R9 additive migrations --------
// Multi-vendor RFQ quotes, embedded vendor chat, vendor payments/ledger, editable PO date,
// customer-PO search. Additive only. NOTE: the design doc references a `sellers` table — this
// codebase's vendor table is `vendors`, so vendor_id below references vendors.id.
export function runR9Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // po_item_vendor_quotes — one row per (line, vendor)
    {
      desc: "po_item_vendor_quotes table",
      sql: `CREATE TABLE IF NOT EXISTS po_item_vendor_quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_item_id INTEGER NOT NULL,
        vendor_id INTEGER,
        vendor_name TEXT,
        vendor_phone TEXT,
        rate REAL,
        tax_inclusive INTEGER,
        tax_percent REAL,
        status TEXT NOT NULL DEFAULT 'requested',
        requested_at INTEGER NOT NULL DEFAULT 0,
        received_at INTEGER,
        approved_at INTEGER,
        notes TEXT
      )`,
    },
    { desc: "uq_quote_item_vendor", sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_item_vendor ON po_item_vendor_quotes(po_item_id, vendor_id)` },
    { desc: "idx_quote_item", sql: `CREATE INDEX IF NOT EXISTS idx_quote_item ON po_item_vendor_quotes(po_item_id)` },
    // vendor_rfq_messages — embedded chat (out/in)
    {
      desc: "vendor_rfq_messages table",
      sql: `CREATE TABLE IF NOT EXISTS vendor_rfq_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER,
        vendor_phone TEXT,
        direction TEXT NOT NULL,
        body TEXT,
        aisensy_msg_id TEXT,
        created_at INTEGER NOT NULL DEFAULT 0
      )`,
    },
    { desc: "idx_rfq_msg_vendor", sql: `CREATE INDEX IF NOT EXISTS idx_rfq_msg_vendor ON vendor_rfq_messages(vendor_id, created_at DESC)` },
    // vendor_payments — manual ledger payments
    {
      desc: "vendor_payments table",
      sql: `CREATE TABLE IF NOT EXISTS vendor_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        paid_on INTEGER NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'bank',
        reference TEXT,
        notes TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT 0
      )`,
    },
    { desc: "idx_vendor_payments_vendor", sql: `CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments(vendor_id)` },
    // po_items: final chosen vendor + winning quote
    { desc: "po_items.approved_vendor_id", sql: `ALTER TABLE po_items ADD COLUMN approved_vendor_id INTEGER` },
    { desc: "po_items.approved_quote_id", sql: `ALTER TABLE po_items ADD COLUMN approved_quote_id INTEGER` },
    // purchase_orders_v2: editable PO date (customer_po_number already added in R8)
    { desc: "purchase_orders_v2.po_date", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN po_date INTEGER` },
    { desc: "idx_po_customer_po_number", sql: `CREATE INDEX IF NOT EXISTS idx_po_customer_po_number ON purchase_orders_v2(customer_po_number)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R9: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R9: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R9 tables/columns ensured");
}

export function runR10Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // consignments — uploaded invoice / docket documents
    { desc: "consignments.invoice_url", sql: `ALTER TABLE consignments ADD COLUMN invoice_url TEXT` },
    { desc: "consignments.docket_url", sql: `ALTER TABLE consignments ADD COLUMN docket_url TEXT` },
    // po_items — explicit customer rate column (data flow stays on unit_price)
    { desc: "po_items.customer_rate", sql: `ALTER TABLE po_items ADD COLUMN customer_rate REAL` },
    { desc: "po_items.customer_po_number", sql: `ALTER TABLE po_items ADD COLUMN customer_po_number TEXT` },
    { desc: "purchase_orders_v2.customer_po_number", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN customer_po_number TEXT` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R10: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R10: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R10 tables/columns ensured");
}

// -------- R11 additive migrations --------
// Workflow split (Notify vs Process), global Sonar search source tagging, pending-split linkage.
export function runR11Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // quote source: null/db (DB seller), 'global' (Perplexity), 'manual' (free-text)
    { desc: "po_item_vendor_quotes.source", sql: `ALTER TABLE po_item_vendor_quotes ADD COLUMN source TEXT` },
    // pending-split linkage: a split-off pending PO points back at its origin
    { desc: "purchase_orders_v2.parent_po_id", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN parent_po_id INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R11: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R11: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R11 tables/columns ensured");
}

// -------- R11.1 additive migrations --------
// Always-ingest chat transcripts + selection-based AI prompts. The vendor_rfq_messages
// schema (id, vendor_id, direction, body, aisensy_msg_id, created_at) already exists from
// R9, so no ALTERs are needed. We only ensure the explicit (vendor_id, created_at DESC)
// index requested by R11.1; an equivalent index from R9 may already cover this.
export function runR11_1Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "idx_vrm_vendor_created", sql: `CREATE INDEX IF NOT EXISTS idx_vrm_vendor_created ON vendor_rfq_messages (vendor_id, created_at DESC)` },
  ];
  for (const { desc, sql } of stmts) {
    try {
      sqlite.exec(sql);
      console.log(`[migrations] R11.1: ${desc}`);
    } catch (err: any) {
      console.log(`[migrations] R11.1: skipped ${desc} —`, err?.message || err);
    }
  }
  console.log("[migrations] R11.1: schema already good (no ALTERs needed)");
}

// -------- R12 additive migrations --------
// PO-centric Delhi dispatch: per-line dispatch snapshot columns + lifecycle timestamps,
// and a bundles count on the dispatch record. All additive; some columns may already exist
// from earlier rounds (docket_no/courier/packed_at/dispatched_at) so try/catch skips them.
export function runR12Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "po_items.docket_number", sql: `ALTER TABLE po_items ADD COLUMN docket_number TEXT` },
    { desc: "po_items.docket_slip_url", sql: `ALTER TABLE po_items ADD COLUMN docket_slip_url TEXT` },
    { desc: "po_items.carrier", sql: `ALTER TABLE po_items ADD COLUMN carrier TEXT` },
    { desc: "po_items.bundles", sql: `ALTER TABLE po_items ADD COLUMN bundles INTEGER` },
    { desc: "po_items.dispatched_at", sql: `ALTER TABLE po_items ADD COLUMN dispatched_at INTEGER` },
    { desc: "po_items.packed_at", sql: `ALTER TABLE po_items ADD COLUMN packed_at INTEGER` },
    { desc: "po_items.received_at", sql: `ALTER TABLE po_items ADD COLUMN received_at INTEGER` },
    { desc: "dispatches.bundles", sql: `ALTER TABLE dispatches ADD COLUMN bundles INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R12: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R12: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R12 tables/columns ensured");
}

// -------- R13 additive migrations --------
// Ordered-company picker: tag each PO and quotation with which of our billing entities
// (Narmada Motors, Narmada Mobility, …) the order belongs to. Additive only — the id is
// used to look up name/branding for PDFs/lists; no FK enforcement. purchase_orders_v2
// already carries company_id from an earlier round, so that ALTER is expected to skip.
export function runR13Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.company_id", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN company_id INTEGER` },
    { desc: "quotations.company_id", sql: `ALTER TABLE quotations ADD COLUMN company_id INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R13: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R13: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R13 tables/columns ensured");
}

// -------- R13.4 additive migrations --------
// Allow a po_number to be reused once the prior PO is soft-deleted. We add a soft-delete
// marker column and a PARTIAL unique index that only constrains active rows
// (deleted_at IS NULL). The legacy column-level UNIQUE on po_number is an SQLite
// auto-index that cannot be dropped without rebuilding the table (which the additive-only
// rule forbids); the defensive purge in createPurchaseOrderV2 covers reuse against that
// legacy constraint, while this partial index is the forward-looking guard. The DROP
// INDEX is attempted defensively in case a named (non-auto) unique index exists.
export function runR13_4Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.deleted_at", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN deleted_at INTEGER` },
    { desc: "drop legacy named unique index on po_number (if any)", sql: `DROP INDEX IF EXISTS purchase_orders_v2_po_number_unique` },
    { desc: "partial unique index po_number WHERE deleted_at IS NULL", sql: `CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_v2_po_number_active_uq ON purchase_orders_v2(po_number) WHERE deleted_at IS NULL` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R13.4: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R13.4: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R13.4 tables/columns ensured");
}

// -------- R18 additive migrations --------
// Part A (AiSensy webhook): track external message id (for idempotent inserts), delivery
// status, and a manual-intervention flag on the embedded-chat message table. Part B
// (AI accept/reject): a new ai_suggested_replies table holding fire-and-forget Claude
// drafts pending a human accept/reject. All additive — no drops/renames.
export function runR18Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // Part A — vendor_rfq_messages columns
    { desc: "vendor_rfq_messages.external_message_id", sql: `ALTER TABLE vendor_rfq_messages ADD COLUMN external_message_id TEXT` },
    { desc: "vendor_rfq_messages.status", sql: `ALTER TABLE vendor_rfq_messages ADD COLUMN status TEXT` },
    { desc: "vendor_rfq_messages.manually_handled", sql: `ALTER TABLE vendor_rfq_messages ADD COLUMN manually_handled INTEGER DEFAULT 0` },
    // Idempotency guard: partial unique index so dup webhook deliveries are silently skipped.
    { desc: "unique index on external_message_id", sql: `CREATE UNIQUE INDEX IF NOT EXISTS vendor_rfq_messages_external_id_uq ON vendor_rfq_messages(external_message_id) WHERE external_message_id IS NOT NULL` },
    // Part B — ai_suggested_replies table
    {
      desc: "ai_suggested_replies table",
      sql: `CREATE TABLE IF NOT EXISTS ai_suggested_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER,
        vendor_phone TEXT,
        po_id INTEGER,
        triggered_by_message_id INTEGER,
        suggested_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      )`,
    },
    { desc: "index ai_suggested_replies(vendor_id, status)", sql: `CREATE INDEX IF NOT EXISTS ai_suggested_replies_vendor_status_idx ON ai_suggested_replies(vendor_id, status)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R18: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R18: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R18 tables/columns ensured");
}

// -------- R20 additive migrations --------
// Quotation soft-delete: a deleted_at timestamp so LIST endpoints can filter out
// removed quotations without losing the row. Additive only — no drops/renames.
export function runR20Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "quotations.deleted_at", sql: `ALTER TABLE quotations ADD COLUMN deleted_at INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R20: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R20: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R20 tables/columns ensured");
}

// -------- R21 additive migrations --------
// Delhi rebuild: qty-deviation tracking on po_items, customer urgency + delivery
// deadline on purchase_orders_v2, per-line Patna notes, and an inter-branch
// transfer flag on dispatches. Additive only — no drops/renames.
export function runR21Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "po_items.original_qty", sql: `ALTER TABLE po_items ADD COLUMN original_qty REAL` },
    { desc: "po_items.deviation_reason", sql: `ALTER TABLE po_items ADD COLUMN deviation_reason TEXT` },
    { desc: "po_items.deviation_at", sql: `ALTER TABLE po_items ADD COLUMN deviation_at INTEGER` },
    { desc: "po_items.deviated_by_user_id", sql: `ALTER TABLE po_items ADD COLUMN deviated_by_user_id INTEGER` },
    { desc: "po_items.is_deviated", sql: `ALTER TABLE po_items ADD COLUMN is_deviated INTEGER DEFAULT 0` },
    { desc: "po_items.patna_note", sql: `ALTER TABLE po_items ADD COLUMN patna_note TEXT` },
    { desc: "purchase_orders_v2.urgency", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN urgency TEXT` },
    { desc: "purchase_orders_v2.delivery_deadline", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN delivery_deadline INTEGER` },
    { desc: "dispatches.is_internal_transfer", sql: `ALTER TABLE dispatches ADD COLUMN is_internal_transfer INTEGER DEFAULT 0` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R21: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      console.log(`[migrations] R21: skipped ${desc} —`, err?.message || err);
    }
  }

  console.log("[migrations] R21 tables/columns ensured");
}

// -------- R22 additive migrations --------
// Consignment visibility + ledger idempotency. We do NOT add a separate consignment portal;
// instead Delhi-dispatched POs (delhi_submitted_at set) become a visible category, and we add
// a consignment_status marker so a consignment view can mark rows received/processed without
// touching the PO lifecycle. Additive only — no drops/renames.
export function runR22Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.consignment_status", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN consignment_status TEXT` },
    { desc: "purchase_orders_v2.consignment_received_at", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN consignment_received_at INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R22: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R22: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R22 tables/columns ensured");
}

// -------- R23 additive migrations --------
// Command Center + bug bundle. ledger_entries gets a po_id + idempotency-friendly source so a
// fulfilled-PO transition can write exactly once. Additive only.
export function runR23Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    {
      // NOTE: distinct from the Session B customer `ledger_entries` table. This is a
      // separate, additive PO-fulfilment audit table keyed by (po_id, entry_type).
      desc: "po_fulfilment_ledger table (idempotent PO ledger)",
      sql: `CREATE TABLE IF NOT EXISTS po_fulfilment_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER,
        customer_id INTEGER,
        company_id INTEGER,
        entry_type TEXT NOT NULL,
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        reference TEXT,
        source TEXT,
        created_at INTEGER NOT NULL
      )`,
    },
    // Idempotency: at most one PO-fulfilment ledger entry per (po_id, entry_type).
    { desc: "uq po_fulfilment_ledger(po_id, entry_type)", sql: `CREATE UNIQUE INDEX IF NOT EXISTS po_fulfilment_ledger_po_type_uq ON po_fulfilment_ledger(po_id, entry_type) WHERE po_id IS NOT NULL` },
    { desc: "idx po_fulfilment_ledger(customer_id)", sql: `CREATE INDEX IF NOT EXISTS po_fulfilment_ledger_customer_idx ON po_fulfilment_ledger(customer_id)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R23: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R23: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R23 tables/columns ensured");
}

// -------- R24 additive migrations --------
// Market Radar: extend the existing leads table (status/notes/assignment/conversion) instead of
// creating a parallel table, and add marketing_sends for campaign tracking. Additive only.
export function runR24Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "leads.status", sql: `ALTER TABLE leads ADD COLUMN status TEXT` },
    { desc: "leads.notes", sql: `ALTER TABLE leads ADD COLUMN notes TEXT` },
    { desc: "leads.assigned_to_user_id", sql: `ALTER TABLE leads ADD COLUMN assigned_to_user_id INTEGER` },
    { desc: "leads.converted_to_customer_id", sql: `ALTER TABLE leads ADD COLUMN converted_to_customer_id INTEGER` },
    {
      desc: "marketing_sends table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER,
        phone TEXT,
        template TEXT,
        vars TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        sent_by TEXT,
        created_at INTEGER NOT NULL
      )`,
    },
    { desc: "idx marketing_sends(lead_id)", sql: `CREATE INDEX IF NOT EXISTS marketing_sends_lead_idx ON marketing_sends(lead_id)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R24: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R24: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R24 tables/columns ensured");
}

// -------- R25 additive migrations --------
// R25a: link a lead to the vendor it was converted into (Convert to Vendor action in the
// rebuilt Leads CRM). Additive only — no drops/renames.
export function runR25Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "leads.converted_to_vendor_id", sql: `ALTER TABLE leads ADD COLUMN converted_to_vendor_id INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R25: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R25: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R25 tables/columns ensured");
}

// -------- R26 additive migrations --------
// R26: consignment From-Delhi rebuild + vendor ledger export + command-center date range.
// No new tables/columns are required — consignment_status (R22) and dispatches.bundles already
// exist. These ALTERs are defensive/idempotent re-ensures so a fresh DB still has the columns
// the R26 features read. Failures (column exists) are swallowed, matching prior rounds.
export function runR26Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.consignment_status (re-ensure)", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN consignment_status TEXT` },
    { desc: "purchase_orders_v2.consignment_received_at (re-ensure)", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN consignment_received_at INTEGER` },
    { desc: "dispatches.bundles (re-ensure)", sql: `ALTER TABLE dispatches ADD COLUMN bundles INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R26 tables/columns ensured");
}

// -------- R26.2 additive migrations --------
// R26.2: Delhi docket upload — adds transport name, docket number, docket date, and the
// public-relative slip path to purchase_orders_v2 (the table the Delhi PO endpoints read).
// docket_date is INTEGER (unix-ms) to match this table's existing date convention (po_date,
// delivery_deadline, etc.). All ALTERs are idempotent — a duplicate-column failure is swallowed.
export function runR26_2Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.docket_transport", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN docket_transport TEXT` },
    { desc: "purchase_orders_v2.docket_number", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN docket_number TEXT` },
    { desc: "purchase_orders_v2.docket_date", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN docket_date INTEGER` },
    { desc: "purchase_orders_v2.docket_slip_path", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN docket_slip_path TEXT` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.2: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.2: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R26.2 tables/columns ensured");
}

// -------- R26.2b additive migrations --------
// R26.2b: Delhi "Edit Docket" dialog — the post-dispatch docket re-entry form mirrors the
// dispatch modal, which captures a bundles count. R26.2 only stored transport/number/date/slip
// on purchase_orders_v2, so add docket_bundles here. Idempotent — duplicate-column failure swallowed.
export function runR26_2bMigrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    { desc: "purchase_orders_v2.docket_bundles", sql: `ALTER TABLE purchase_orders_v2 ADD COLUMN docket_bundles INTEGER` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.2b: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.2b: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R26.2b tables/columns ensured");
}

// -------- R26.2f one-time cleanup --------
// R26.2f: prior AiSensy status receipts ("message.status.updated") slipped past the
// receipt filter and inserted blank inbound chat rows (empty body, vendor_phone of
// "API"/"USER"/"SYSTEM"/etc), polluting the vendor chat UI with phantom unread messages.
// Delete those clearly-junk rows. IDEMPOTENT — the WHERE clause only matches blank-body
// inbound rows with no real phone, so it is safe to run on every boot (deletes ~19 the
// first time, 0 thereafter). NEVER touches rows that carry a real body or phone number.
export function runR26_2fCleanup() {
  try {
    const info = sqlite
      .prepare(
        `DELETE FROM vendor_rfq_messages
         WHERE direction = 'in'
           AND (body IS NULL OR body = '')
           AND (vendor_phone IS NULL OR vendor_phone = ''
                OR vendor_phone IN ('API','USER','SYSTEM','BOT','TEST'))`,
      )
      .run();
    console.log(`[migrations] R26.2f: cleaned ${info.changes} blank aisensy row(s)`);
  } catch (e: any) {
    console.error("[migrations] R26.2f cleanup failed:", e?.message || e);
  }
}

// -------- R26.2g one-time backfill --------
// R26.2g: POs already notified to Delhi can show Rate/Line Total/Order Value = 0 even though
// the master line carries a customer rate, because line_total was never recomputed from
// unit_price*qty (and the header total stayed stale). In this schema procurement + Delhi share
// the SAME `po_items` table and the customer rate IS `po_items.unit_price` (the migration-added
// `customer_rate` column is unused/never populated), so the backfill = recompute each notified
// PO's line_total from unit_price*qty, then refresh the header total/subtotal from the new line
// totals. IDEMPOTENT — only touches lines where line_total disagrees with unit_price*qty, and
// only POs that have been notified to Delhi. Lines with unit_price = 0 correctly stay at 0.
export function runR26_2gBackfill() {
  try {
    // 1) Recompute stale line_totals on notified POs (unit_price = customer rate).
    const lineInfo = sqlite
      .prepare(
        `UPDATE po_items
         SET line_total = COALESCE(unit_price, 0) * COALESCE(qty, 0)
         WHERE po_id IN (SELECT id FROM purchase_orders_v2 WHERE notified_delhi_at IS NOT NULL)
           AND COALESCE(line_total, 0) <> COALESCE(unit_price, 0) * COALESCE(qty, 0)`,
      )
      .run();

    // 2) Refresh the Delhi PO header order value (total/subtotal) from the line totals.
    const headerInfo = sqlite
      .prepare(
        `UPDATE purchase_orders_v2
         SET subtotal = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0),
             total    = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)
         WHERE notified_delhi_at IS NOT NULL
           AND COALESCE(total, 0) <> COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)`,
      )
      .run();

    console.log(
      `[migrations] R26.2g: backfilled ${lineInfo.changes} Delhi line total(s), refreshed ${headerInfo.changes} PO header total(s)`,
    );
  } catch (e: any) {
    console.error("[migrations] R26.2g backfill failed:", e?.message || e);
  }
}

// -------- R26.2h one-time backfill --------
// R26.2h: POs that were converted from a quotation BEFORE the quotation's rates were filled in
// (e.g. AI autofill ran after conversion) carry po_items.unit_price = 0, so Cust. Rate / Line
// Total / Order Value all show 0 in both Procurement and Delhi views. The rate exists on the
// source quotation (quotation_items.mrp) but never propagated down. There is NO per-item FK
// between po_items and quotation_items; the only link is purchase_orders_v2.quotation_id. We
// therefore match po_items <-> quotation_items by part_number within the same quotation and copy
// mrp into unit_price + line_total, then refresh PO header totals. Runs BEFORE R26.2g so the
// recompute there sees the populated unit_prices. IDEMPOTENT — only touches po_items whose
// unit_price is 0/NULL and that have a matching priced quotation line; priced lines are untouched.
export function runR26_2hBackfill() {
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
         WHERE (po_items.unit_price IS NULL OR po_items.unit_price = 0)
           AND EXISTS (
             SELECT 1 FROM purchase_orders_v2 po
             WHERE po.id = po_items.po_id AND po.quotation_id IS NOT NULL
           )
           AND EXISTS (
             SELECT 1 FROM quotation_items qit
             WHERE qit.quotation_id = (SELECT quotation_id FROM purchase_orders_v2 WHERE id = po_items.po_id)
               AND qit.part_number IS NOT NULL
               AND qit.part_number = po_items.part_number
               AND qit.mrp > 0
           )`,
      )
      .run();

    const headerInfo = sqlite
      .prepare(
        `UPDATE purchase_orders_v2
         SET subtotal = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0),
             total    = COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)
         WHERE quotation_id IS NOT NULL
           AND COALESCE(total, 0) <> COALESCE((SELECT SUM(COALESCE(line_total, 0)) FROM po_items WHERE po_items.po_id = purchase_orders_v2.id), 0)`,
      )
      .run();

    console.log(
      `[migrations] R26.2h: backfilled ${lineInfo.changes} po_items unit_price from quotation mrp, refreshed ${headerInfo.changes} PO header total(s)`,
    );
  } catch (e: any) {
    console.error("[migrations] R26.2h backfill failed:", e?.message || e);
  }
}
