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

// -------- R26.3 additive migrations (OAuth backend: Google + Meta) --------
// Additive only. SQLite-backed (this project uses better-sqlite3, not Postgres):
//   SERIAL  -> INTEGER PRIMARY KEY AUTOINCREMENT
//   JSONB   -> TEXT (JSON-stringified)
//   TIMESTAMP -> INTEGER (epoch ms)
//   BOOLEAN -> INTEGER (0/1)
// Creates oauth_tokens (provider connections) and meta_leads_inbox (raw Meta leadgen
// webhook payloads, processed in R26.4). Per-statement try/catch with [migrations] R26.3 markers.
export function runR26_3Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    {
      desc: "oauth_tokens table",
      sql: `CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        account_email TEXT,
        account_name TEXT,
        account_id TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at INTEGER,
        scopes TEXT,
        meta_pages TEXT,
        connected_at INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1
      )`,
    },
    {
      desc: "oauth_tokens unique (provider, account_id)",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_provider_account
            ON oauth_tokens (provider, account_id)`,
    },
    {
      desc: "meta_leads_inbox table",
      sql: `CREATE TABLE IF NOT EXISTS meta_leads_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_payload TEXT,
        received_at INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0
      )`,
    },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.3: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.3: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R26.3 tables/indexes ensured");
}

// -------- R26.4 additive migrations (Marketing Hub V1) --------
// Additive only — six new marketing_* tables. SQLite via better-sqlite3:
//   epoch ms for all timestamps (matching the project's INTEGER date convention),
//   JSON-as-TEXT for arrays/objects, BOOLEAN-as-INTEGER (0/1). Per-statement try/catch
//   with [migrations] R26.4: markers so a re-run (table exists) is logged and skipped,
//   never aborting boot. NEVER drops/renames existing tables. After the tables are ensured,
//   seed 4 default audiences ONLY if marketing_audiences is empty (idempotent first-boot seed).
export function runR26_4Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    {
      desc: "marketing_campaigns table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        channel TEXT NOT NULL,
        audience_id INTEGER,
        audience_snapshot TEXT,
        email_subject TEXT,
        email_from_name TEXT,
        email_reply_to TEXT,
        email_body_html TEXT,
        email_attachments TEXT,
        whatsapp_template_name TEXT,
        whatsapp_variables TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at INTEGER,
        sent_at INTEGER,
        created_by TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000),
        updated_at INTEGER
      )`,
    },
    { desc: "idx_marketing_campaigns_status", sql: `CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status)` },
    { desc: "idx_marketing_campaigns_scheduled", sql: `CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_scheduled ON marketing_campaigns(scheduled_at)` },
    {
      desc: "marketing_audiences table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_audiences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        filter_json TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )`,
    },
    {
      desc: "marketing_templates table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        channel TEXT NOT NULL,
        email_subject TEXT,
        email_body_html TEXT,
        whatsapp_template_name TEXT,
        whatsapp_variables TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`,
    },
    {
      desc: "marketing_send_jobs table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_send_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        recipient_type TEXT,
        recipient_id TEXT,
        recipient_email TEXT,
        recipient_phone TEXT,
        recipient_name TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempted_at INTEGER,
        sent_at INTEGER,
        error_message TEXT,
        gmail_message_id TEXT,
        created_at INTEGER
      )`,
    },
    { desc: "idx_marketing_send_jobs_campaign", sql: `CREATE INDEX IF NOT EXISTS idx_marketing_send_jobs_campaign ON marketing_send_jobs(campaign_id)` },
    {
      desc: "marketing_send_log table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_send_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        send_job_id INTEGER NOT NULL,
        event TEXT,
        event_data TEXT,
        created_at INTEGER
      )`,
    },
    { desc: "idx_marketing_send_log_job", sql: `CREATE INDEX IF NOT EXISTS idx_marketing_send_log_job ON marketing_send_log(send_job_id)` },
    {
      desc: "marketing_unsubscribes table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_unsubscribes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        phone TEXT,
        source_job_id INTEGER,
        unsubscribed_at INTEGER
      )`,
    },
    { desc: "idx_marketing_unsubscribes_email", sql: `CREATE INDEX IF NOT EXISTS idx_marketing_unsubscribes_email ON marketing_unsubscribes(email)` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.4: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.4: skipped ${desc} —`, err?.message || err); }
  }

  // Seed 4 default audiences ONLY on first boot (table empty). Idempotent.
  try {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM marketing_audiences`).get() as { n: number };
    if (!row || row.n === 0) {
      const now = Date.now();
      const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
      const seed = sqlite.prepare(
        `INSERT INTO marketing_audiences (name, description, filter_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const defaults: Array<{ name: string; description: string; filter: unknown }> = [
        { name: "All Customers", description: "Every customer on record", filter: { audience_type: "customers" } },
        { name: "Active Customers (90d)", description: "Customers with an order in the last 90 days", filter: { audience_type: "customers", filters: { last_order_after: ninetyDaysAgo } } },
        { name: "All Sellers", description: "Every seller on record", filter: { audience_type: "sellers" } },
        { name: "All Contacts (Customers + Sellers)", description: "Customers and sellers combined", filter: { audience_type: "all" } },
      ];
      for (const d of defaults) {
        seed.run(d.name, d.description, JSON.stringify(d.filter), now, now);
      }
      console.log(`[migrations] R26.4: seeded ${defaults.length} default audiences`);
    } else {
      console.log(`[migrations] R26.4: audiences already present (${row.n}) — seed skipped`);
    }
  } catch (err: any) {
    console.log(`[migrations] R26.4: audience seed failed —`, err?.message || err);
  }

  console.log("[migrations] R26.4 tables/indexes ensured");
}

// -------- R26.4b additive migrations (Marketing Hub — WhatsApp via AiSensy) --------
// Additive only — one new table (marketing_whatsapp_templates) + one new column on
// marketing_send_jobs (aisensy_message_id). Seeds the 5 Meta-approved marketing templates
// (idempotent via ON CONFLICT DO NOTHING on template_name). Per-statement try/catch with
// [migrations] R26.4b: markers so a re-run is logged and skipped, never aborting boot.
// NEVER drops/renames existing tables. The ALTER on marketing_send_jobs is wrapped so a
// "duplicate column" error on re-run is caught and ignored.
export function runR26_4bMigrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    {
      desc: "marketing_whatsapp_templates table",
      sql: `CREATE TABLE IF NOT EXISTS marketing_whatsapp_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        category TEXT,
        language TEXT DEFAULT 'en',
        header_type TEXT,
        header_required INTEGER DEFAULT 0,
        variable_count INTEGER NOT NULL,
        variable_labels TEXT,
        buttons TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        is_default INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000),
        updated_at INTEGER
      )`,
    },
    {
      desc: "idx_marketing_wa_templates_status",
      sql: `CREATE INDEX IF NOT EXISTS idx_marketing_wa_templates_status ON marketing_whatsapp_templates(status)`,
    },
    {
      desc: "marketing_send_jobs.aisensy_message_id column",
      sql: `ALTER TABLE marketing_send_jobs ADD COLUMN aisensy_message_id TEXT`,
    },
    {
      desc: "idx_marketing_send_jobs_aisensy_msg",
      sql: `CREATE INDEX IF NOT EXISTS idx_marketing_send_jobs_aisensy_msg ON marketing_send_jobs(aisensy_message_id)`,
    },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.4b: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      // Duplicate-column on ALTER re-run is expected and benign; CREATE IF NOT EXISTS is idempotent.
      console.log(`[migrations] R26.4b: skipped ${desc} —`, err?.message || err);
    }
  }

  // Seed the 5 Meta-approved marketing templates (idempotent — ON CONFLICT DO NOTHING by name).
  try {
    const seedTemplates = [
      {
        template_name: "narmada_marketing_v1",
        display_name: "General Promo (Text)",
        header_type: "none",
        header_required: 0,
        variable_count: 3,
        variable_labels: JSON.stringify(["Customer name", "Vehicle type", "Custom message"]),
        buttons: JSON.stringify([]),
        is_default: 1,
      },
      {
        template_name: "narmada_marketing_v1_cta",
        display_name: "General Promo with CTA",
        header_type: "none",
        header_required: 0,
        variable_count: 3,
        variable_labels: JSON.stringify(["Customer name", "Vehicle type", "Custom message"]),
        buttons: JSON.stringify([
          { type: "quick_reply", text: "Get Quotation" },
          { type: "quick_reply", text: "View Catalog" },
        ]),
        is_default: 0,
      },
      {
        template_name: "narmada_marketing_brochure",
        display_name: "Catalog/Brochure (PDF)",
        header_type: "document",
        header_required: 1,
        variable_count: 3,
        variable_labels: JSON.stringify(["Customer name", "Catalog scope", "Highlight line"]),
        buttons: JSON.stringify([
          { type: "quick_reply", text: "Request Pricing" },
          { type: "quick_reply", text: "Place Order" },
        ]),
        is_default: 0,
      },
      {
        template_name: "narmada_offer",
        display_name: "Limited-Time Offer",
        header_type: "none",
        header_required: 0,
        variable_count: 3,
        variable_labels: JSON.stringify(["Customer name", "Offer headline", "Expiry date"]),
        buttons: JSON.stringify([
          { type: "quick_reply", text: "Place Order" },
          { type: "quick_reply", text: "Talk to Sales" },
        ]),
        is_default: 0,
      },
      {
        template_name: "narmada_seller_invite",
        display_name: "Seller Onboarding Invite",
        header_type: "none",
        header_required: 0,
        variable_count: 3,
        variable_labels: JSON.stringify(["Dealer name", "Region", "Pitch line"]),
        buttons: JSON.stringify([
          { type: "quick_reply", text: "Join Now" },
          { type: "quick_reply", text: "Learn More" },
        ]),
        is_default: 0,
      },
    ];
    const now = Date.now();
    const insert = sqlite.prepare(
      `INSERT INTO marketing_whatsapp_templates
         (template_name, display_name, category, language, header_type, header_required,
          variable_count, variable_labels, buttons, status, is_default, created_at, updated_at)
       VALUES (?, ?, 'marketing', 'en', ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(template_name) DO NOTHING`,
    );
    let seeded = 0;
    for (const t of seedTemplates) {
      const info = insert.run(
        t.template_name,
        t.display_name,
        t.header_type,
        t.header_required,
        t.variable_count,
        t.variable_labels,
        t.buttons,
        t.is_default,
        now,
        now,
      );
      if (info.changes > 0) seeded++;
    }
    console.log(`[migrations] R26.4b: seeded ${seeded} whatsapp template(s) (existing left untouched)`);
  } catch (err: any) {
    console.log(`[migrations] R26.4b: template seed failed —`, err?.message || err);
  }

  console.log("[migrations] R26.4b tables/columns ensured");
}

// ============================================================================
// R26.5 — Sales/Finance/HR roles, Leads V2, Tasks V2, sales targets,
// attendance/visit check-ins, cross-team notifications, user management,
// marketing audience include/exclude, parts seed. Additive only.
// Per-statement try/catch with [migrations] R26.5: markers so a re-run
// (table/column exists) is logged and skipped, never aborting boot.
// ============================================================================
export function runR26_5Migrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // ---- B. Leads V2 additive columns ----
    { desc: "leads.contact_person", sql: `ALTER TABLE leads ADD COLUMN contact_person TEXT` },
    { desc: "leads.address", sql: `ALTER TABLE leads ADD COLUMN address TEXT` },
    { desc: "leads.deleted_at", sql: `ALTER TABLE leads ADD COLUMN deleted_at TEXT` },
    // (phone, email, stage, assigned_to_user_id already exist from earlier rounds)

    // ---- B2. lead_stages ----
    {
      desc: "lead_stages table",
      sql: `CREATE TABLE IF NOT EXISTS lead_stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        position INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000)
      )`,
    },

    // ---- C. Tasks V2 additive columns on task_items ----
    { desc: "task_items.file_url", sql: `ALTER TABLE task_items ADD COLUMN file_url TEXT` },
    { desc: "task_items.deadline", sql: `ALTER TABLE task_items ADD COLUMN deadline TEXT` },
    { desc: "task_items.assigned_to_user_id", sql: `ALTER TABLE task_items ADD COLUMN assigned_to_user_id INTEGER` },
    // (status already exists on task_items)

    // ---- D. User management ----
    { desc: "data_team_users.deleted_at", sql: `ALTER TABLE data_team_users ADD COLUMN deleted_at TEXT` },

    // ---- G4. customers.sales_rep_id ----
    { desc: "customers.sales_rep_id", sql: `ALTER TABLE customers ADD COLUMN sales_rep_id INTEGER` },

    // ---- G1. sales_targets ----
    {
      desc: "sales_targets table",
      sql: `CREATE TABLE IF NOT EXISTS sales_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_rep_user_id INTEGER,
        target_type TEXT,
        customer_id INTEGER,
        period_start TEXT,
        period_end TEXT,
        target_amount NUMERIC,
        achieved_amount NUMERIC DEFAULT 0,
        rolled_over_from INTEGER,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now')*1000)
      )`,
    },
    {
      desc: "target_achievements table",
      sql: `CREATE TABLE IF NOT EXISTS target_achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id INTEGER,
        po_id INTEGER,
        customer_id INTEGER,
        amount NUMERIC,
        verified_by TEXT,
        admin_approved INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now')*1000)
      )`,
    },
    { desc: "idx_sales_targets_rep", sql: `CREATE INDEX IF NOT EXISTS idx_sales_targets_rep ON sales_targets(sales_rep_user_id)` },
    { desc: "idx_target_achievements_target", sql: `CREATE INDEX IF NOT EXISTS idx_target_achievements_target ON target_achievements(target_id)` },

    // ---- G3. attendance + visit check-ins ----
    {
      desc: "attendance_checkins table",
      sql: `CREATE TABLE IF NOT EXISTS attendance_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_rep_user_id INTEGER,
        date TEXT,
        checkin_at TEXT,
        checkout_at TEXT,
        checkin_missed INTEGER DEFAULT 0,
        checkout_missed INTEGER DEFAULT 0
      )`,
    },
    { desc: "idx_attendance_rep_date", sql: `CREATE INDEX IF NOT EXISTS idx_attendance_rep_date ON attendance_checkins(sales_rep_user_id, date)` },
    {
      desc: "visit_checkins table",
      sql: `CREATE TABLE IF NOT EXISTS visit_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_rep_user_id INTEGER,
        customer_id INTEGER,
        gps_lat NUMERIC,
        gps_lng NUMERIC,
        photo_url TEXT,
        notes TEXT,
        created_at TEXT
      )`,
    },
    { desc: "idx_visit_rep", sql: `CREATE INDEX IF NOT EXISTS idx_visit_rep ON visit_checkins(sales_rep_user_id)` },

    // ---- H. cross_team_events ----
    {
      desc: "cross_team_events table",
      sql: `CREATE TABLE IF NOT EXISTS cross_team_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        payload_json TEXT,
        target_user_id INTEGER,
        target_role TEXT,
        read_at TEXT,
        created_at TEXT
      )`,
    },
    { desc: "idx_cross_team_target_user", sql: `CREATE INDEX IF NOT EXISTS idx_cross_team_target_user ON cross_team_events(target_user_id)` },
    { desc: "idx_cross_team_target_role", sql: `CREATE INDEX IF NOT EXISTS idx_cross_team_target_role ON cross_team_events(target_role)` },

    // ---- I2. audiences include/exclude (marketing_audiences) ----
    { desc: "marketing_audiences.include_user_ids_json", sql: `ALTER TABLE marketing_audiences ADD COLUMN include_user_ids_json TEXT` },
    { desc: "marketing_audiences.exclude_user_ids_json", sql: `ALTER TABLE marketing_audiences ADD COLUMN exclude_user_ids_json TEXT` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.5: ${desc}`);
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      // Duplicate-column on ALTER re-run is expected and benign; CREATE IF NOT EXISTS is idempotent.
      console.log(`[migrations] R26.5: skipped ${desc} —`, err?.message || err);
    }
  }

  // ---- B2. seed default lead stages (idempotent) ----
  try {
    const stages: Array<[string, number]> = [
      ["New", 1], ["Contacted", 2], ["Qualified", 3], ["Quoted", 4], ["Won", 5], ["Lost", 6],
    ];
    const ins = sqlite.prepare(
      `INSERT OR IGNORE INTO lead_stages (name, position, is_default, created_at) VALUES (?, ?, 1, ?)`,
    );
    const now = Date.now();
    let seeded = 0;
    for (const [name, pos] of stages) { if (ins.run(name, pos, now).changes > 0) seeded++; }
    console.log(`[migrations] R26.5: seeded ${seeded} lead stage(s)`);
  } catch (err: any) {
    console.log(`[migrations] R26.5: lead stage seed failed —`, err?.message || err);
  }

  // ---- E3. seed demo Sales/Finance/HR users (idempotent) ----
  // These live in data_team_users (same store Delhi uses) with role text column.
  // Password hashing mirrors server/routes-v2.ts hashPassword (scrypt salt:hash).
  try {
    const { scryptSync, randomBytes } = require("node:crypto");
    const hash = (plain: string) => {
      const salt = randomBytes(16).toString("hex");
      return `${salt}:${scryptSync(plain, salt, 64).toString("hex")}`;
    };
    const demoUsers: Array<{ username: string; password: string; role: string; name: string }> = [
      { username: "sales", password: "Sales@123", role: "sales", name: "Demo Sales Rep" },
      { username: "finance", password: "Finance@123", role: "finance", name: "Demo Finance" },
      { username: "hr", password: "HR@123", role: "hr", name: "Demo HR" },
    ];
    const ins = sqlite.prepare(
      `INSERT OR IGNORE INTO data_team_users (username, password_hash, name, role, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    const now = Date.now();
    let seeded = 0;
    for (const u of demoUsers) { if (ins.run(u.username, hash(u.password), u.name, u.role, now).changes > 0) seeded++; }
    console.log(`[migrations] R26.5: seeded ${seeded} role demo user(s)`);
  } catch (err: any) {
    console.log(`[migrations] R26.5: role user seed failed —`, err?.message || err);
  }

  // ---- A4. seed parts_master with ~30 Tata / Ashok Leyland parts (idempotent) ----
  try {
    const parts: Array<{ pn: string; name: string; brand: string; hsn: string; gst: number }> = [
      // Clutch
      { pn: "TML-CLT-3107", name: "Clutch Plate Assembly 310mm", brand: "Tata", hsn: "87089300", gst: 28 },
      { pn: "TML-CLT-3108", name: "Clutch Cover Pressure Plate", brand: "Tata", hsn: "87089300", gst: 28 },
      { pn: "AL-CLT-3520", name: "Clutch Release Bearing", brand: "Ashok Leyland", hsn: "87089300", gst: 28 },
      { pn: "AL-CLT-3521", name: "Clutch Master Cylinder", brand: "Ashok Leyland", hsn: "87089300", gst: 28 },
      { pn: "TML-CLT-3109", name: "Clutch Servo Booster", brand: "Tata", hsn: "87089300", gst: 28 },
      // Brake
      { pn: "TML-BRK-4201", name: "Brake Lining Set Front", brand: "Tata", hsn: "87083000", gst: 28 },
      { pn: "TML-BRK-4202", name: "Brake Drum Rear", brand: "Tata", hsn: "87083000", gst: 28 },
      { pn: "AL-BRK-4410", name: "Brake Chamber Type-24", brand: "Ashok Leyland", hsn: "87083000", gst: 28 },
      { pn: "AL-BRK-4411", name: "Brake Shoe Assembly", brand: "Ashok Leyland", hsn: "87083000", gst: 28 },
      { pn: "TML-BRK-4203", name: "Brake Valve Dual", brand: "Tata", hsn: "87083000", gst: 28 },
      { pn: "TML-BRK-4204", name: "Slack Adjuster Automatic", brand: "Tata", hsn: "87083000", gst: 28 },
      // Engine
      { pn: "TML-ENG-5101", name: "Piston Set 497 TCIC", brand: "Tata", hsn: "84099190", gst: 28 },
      { pn: "TML-ENG-5102", name: "Cylinder Head Gasket", brand: "Tata", hsn: "84099190", gst: 28 },
      { pn: "AL-ENG-5310", name: "Crankshaft H-Series", brand: "Ashok Leyland", hsn: "84099190", gst: 28 },
      { pn: "AL-ENG-5311", name: "Oil Pump Assembly", brand: "Ashok Leyland", hsn: "84099190", gst: 28 },
      { pn: "TML-ENG-5103", name: "Connecting Rod Set", brand: "Tata", hsn: "84099190", gst: 28 },
      { pn: "TML-ENG-5104", name: "Engine Valve Set Inlet/Exhaust", brand: "Tata", hsn: "84099190", gst: 28 },
      { pn: "AL-ENG-5312", name: "Water Pump Assembly", brand: "Ashok Leyland", hsn: "84099190", gst: 28 },
      // Suspension
      { pn: "TML-SUS-6201", name: "Leaf Spring Front 10-Leaf", brand: "Tata", hsn: "87088000", gst: 28 },
      { pn: "TML-SUS-6202", name: "Shock Absorber Front", brand: "Tata", hsn: "87088000", gst: 28 },
      { pn: "AL-SUS-6410", name: "Bogie Spring Rear", brand: "Ashok Leyland", hsn: "87088000", gst: 28 },
      { pn: "AL-SUS-6411", name: "Spring Pin & Bush Kit", brand: "Ashok Leyland", hsn: "87088000", gst: 28 },
      { pn: "TML-SUS-6203", name: "U-Bolt Set Rear", brand: "Tata", hsn: "87088000", gst: 28 },
      // Electrical
      { pn: "TML-ELE-7101", name: "Starter Motor 24V", brand: "Tata", hsn: "85114000", gst: 28 },
      { pn: "TML-ELE-7102", name: "Alternator 24V 55A", brand: "Tata", hsn: "85114000", gst: 28 },
      { pn: "AL-ELE-7310", name: "Headlamp Assembly RH", brand: "Ashok Leyland", hsn: "85122010", gst: 28 },
      { pn: "AL-ELE-7311", name: "Wiper Motor Assembly", brand: "Ashok Leyland", hsn: "85129000", gst: 28 },
      { pn: "TML-ELE-7103", name: "Combination Switch", brand: "Tata", hsn: "85365090", gst: 18 },
      { pn: "TML-ELE-7104", name: "Battery Relay 24V", brand: "Tata", hsn: "85364900", gst: 18 },
      { pn: "AL-ELE-7312", name: "Glow Plug Set", brand: "Ashok Leyland", hsn: "85119000", gst: 28 },
    ];
    const now = Date.now();
    const ins = sqlite.prepare(
      `INSERT OR IGNORE INTO parts_master
         (part_number, name, hsn, gst_rate, brand, last_source, last_updated, search_text, use_count, created_at)
       VALUES (?, ?, ?, ?, ?, 'seed', ?, ?, 0, ?)`,
    );
    let seeded = 0;
    for (const p of parts) {
      const searchText = `${p.pn} ${p.name} ${p.brand}`.toLowerCase();
      if (ins.run(p.pn, p.name, p.hsn, p.gst, p.brand, now, searchText, now).changes > 0) seeded++;
    }
    console.log(`[migrations] R26.5: seeded ${seeded} parts_master row(s)`);
  } catch (err: any) {
    console.log(`[migrations] R26.5: parts seed failed —`, err?.message || err);
  }

  console.log("[migrations] R26.5: complete");
}

// -------- R26.6a additive migrations (Bug fixes + UX polish) --------
// This round is logic-only on the client/server side (lead-card outreach buttons, OAuth
// status surfacing, ledger date-window fix, parts union, PO detail, sales-target admin UI,
// consignment docket column). It adds NO new columns or tables. The only schema concern is
// that the oauth_tokens table (introduced in R26.3) must exist, since the new
// /api/admin/oauth/status + DELETE /api/admin/oauth/:provider endpoints read/write it. We
// re-ensure it idempotently here so a DB that somehow predates R26.3 still boots cleanly.
// ADDITIVE ONLY — never drops/renames anything. Per-statement try/catch with R26.6a markers.
export function runR26_6aMigrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    {
      desc: "ensure oauth_tokens table (for OAuth status/disconnect)",
      sql: `CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        account_email TEXT,
        account_name TEXT,
        account_id TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at INTEGER,
        scopes TEXT,
        meta_pages TEXT,
        connected_at INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1
      )`,
    },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.6a: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.6a: skipped ${desc} —`, err?.message || err); }
  }
  console.log("[migrations] R26.6a: complete");
}

// -------- R26.6b additive migrations (customer-wise + onboarding targets, audience source) --------
// ADDITIVE ONLY. Adds columns to sales_targets (metric, lead_id, onboarding workflow) and
// audiences.source. Each ALTER wrapped in try/catch (duplicate-column on re-run is benign).
// Seeds ONE smoke target + ONE smoke task for the demo `sales` user so the portal shows data.
export function runR26_6bMigrations() {
  const stmts: Array<{ desc: string; sql: string }> = [
    // ---- sales_targets: metric + onboarding workflow ----
    { desc: "sales_targets.metric", sql: `ALTER TABLE sales_targets ADD COLUMN metric TEXT DEFAULT 'po'` },
    { desc: "sales_targets.lead_id", sql: `ALTER TABLE sales_targets ADD COLUMN lead_id INTEGER` },
    { desc: "sales_targets.onboarding_status", sql: `ALTER TABLE sales_targets ADD COLUMN onboarding_status TEXT DEFAULT 'pending'` },
    { desc: "sales_targets.submitted_po_number", sql: `ALTER TABLE sales_targets ADD COLUMN submitted_po_number TEXT` },
    { desc: "sales_targets.verified_by_user_id", sql: `ALTER TABLE sales_targets ADD COLUMN verified_by_user_id INTEGER` },
    { desc: "sales_targets.verified_at", sql: `ALTER TABLE sales_targets ADD COLUMN verified_at TEXT` },
    { desc: "idx_sales_targets_customer", sql: `CREATE INDEX IF NOT EXISTS idx_sales_targets_customer ON sales_targets(customer_id)` },
    { desc: "idx_sales_targets_lead", sql: `CREATE INDEX IF NOT EXISTS idx_sales_targets_lead ON sales_targets(lead_id)` },
    // ---- marketing_audiences: source switch (customers/vendors/leads) ----
    { desc: "marketing_audiences.source", sql: `ALTER TABLE marketing_audiences ADD COLUMN source TEXT DEFAULT 'customers'` },
  ];
  for (const { desc, sql } of stmts) {
    console.log(`[migrations] R26.6b: ${desc}`);
    try { sqlite.exec(sql); } catch (err: any) { console.log(`[migrations] R26.6b: skipped ${desc} —`, err?.message || err); }
  }

  // ---- seed: ONE smoke target + ONE smoke task for the demo `sales` user (idempotent) ----
  try {
    const salesUser = sqlite.prepare(`SELECT id FROM data_team_users WHERE username = 'sales' LIMIT 1`).get() as any;
    if (salesUser?.id) {
      const repId = salesUser.id;
      const now = Date.now();
      // Period = current calendar month.
      const d = new Date();
      const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const periodEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      // Idempotency marker: rolled_over_from = -26006 (an impossible real id) flags the seed row.
      const SEED_MARK = -26006;
      const existing = sqlite.prepare(`SELECT id FROM sales_targets WHERE rolled_over_from = ? LIMIT 1`).get(SEED_MARK) as any;
      if (!existing) {
        sqlite.prepare(
          `INSERT INTO sales_targets (sales_rep_user_id, target_type, metric, customer_id, period_start, period_end, target_amount, achieved_amount, status, rolled_over_from, created_at)
           VALUES (?, 'monthly', 'po', NULL, ?, ?, 100000, 0, 'active', ?, ?)`,
        ).run(repId, periodStart, periodEnd, SEED_MARK, now);
        console.log(`[migrations] R26.6b: seeded smoke sales target for rep ${repId}`);
      } else {
        console.log(`[migrations] R26.6b: smoke sales target already present`);
      }
      // Smoke task — keyed on a unique title marker, written to assigned_to (the column the
      // sales /api/sales/tasks list filters on via taskItems.assignedTo).
      const TASK_TITLE = "R26.6b smoke task";
      const existingTask = sqlite.prepare(`SELECT id FROM task_items WHERE title = ? LIMIT 1`).get(TASK_TITLE) as any;
      if (!existingTask) {
        sqlite.prepare(
          `INSERT INTO task_items (title, description, assigned_to, assigned_to_user_id, assigned_by, status, priority, created_at, updated_at)
           VALUES (?, 'Verify the sales portal can see assigned tasks.', ?, ?, 'system', 'pending', 'normal', ?, ?)`,
        ).run(TASK_TITLE, repId, repId, now, now);
        console.log(`[migrations] R26.6b: seeded smoke task for rep ${repId}`);
      } else {
        console.log(`[migrations] R26.6b: smoke task already present`);
      }
    } else {
      console.log(`[migrations] R26.6b: demo sales user not found — skipping smoke seed`);
    }
  } catch (err: any) {
    console.log(`[migrations] R26.6b: smoke seed failed —`, err?.message || err);
  }

  console.log("[migrations] R26.6b: complete");
}

// -------- R26.6c additive migrations (real-fix seeds: visible sales targets + consignments) --------
// ADDITIVE ONLY. No schema changes — pure idempotent seed so the Sales and Consignment
// portals show data out of the box. Resolves the demo `sales` user id via SELECT (never
// hard-coded), seeds three value targets (po | quotation | payment) plus an onboarding
// target, one task, two sample consignments, and ensures at least one customer exists.
// Idempotency: each row keyed on a unique marker (rolled_over_from sentinel / docket / title).
export function runR26_6cMigrations() {
  // ---- sales targets across all three metrics + onboarding (idempotent per metric) ----
  try {
    const salesUser = sqlite.prepare(
      `SELECT id FROM data_team_users WHERE username = 'sales' AND role = 'sales' LIMIT 1`,
    ).get() as any;
    if (salesUser?.id) {
      const repId = salesUser.id;
      const now = Date.now();
      const d = new Date();
      const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const periodEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      // Distinct sentinel markers (rolled_over_from) per seed row so each is idempotent.
      const seeds: Array<{ mark: number; metric: string; amount: number }> = [
        { mark: -26031, metric: "po", amount: 150000 },
        { mark: -26032, metric: "quotation", amount: 80000 },
        { mark: -26033, metric: "payment", amount: 120000 },
      ];
      const insTarget = sqlite.prepare(
        `INSERT INTO sales_targets (sales_rep_user_id, target_type, metric, customer_id, period_start, period_end, target_amount, achieved_amount, status, onboarding_status, rolled_over_from, created_at)
         VALUES (?, 'monthly', ?, NULL, ?, ?, ?, 0, 'active', NULL, ?, ?)`,
      );
      let seededTargets = 0;
      for (const s of seeds) {
        const existing = sqlite.prepare(`SELECT id FROM sales_targets WHERE rolled_over_from = ? LIMIT 1`).get(s.mark) as any;
        if (!existing) { insTarget.run(repId, s.metric, periodStart, periodEnd, s.amount, s.mark, now); seededTargets++; }
      }
      // One onboarding target (separate sub-card) keyed on its own sentinel.
      const ONBOARD_MARK = -26034;
      const onboardExisting = sqlite.prepare(`SELECT id FROM sales_targets WHERE rolled_over_from = ? LIMIT 1`).get(ONBOARD_MARK) as any;
      if (!onboardExisting) {
        sqlite.prepare(
          `INSERT INTO sales_targets (sales_rep_user_id, target_type, metric, customer_id, period_start, period_end, target_amount, achieved_amount, status, onboarding_status, rolled_over_from, created_at)
           VALUES (?, 'monthly', 'onboarding', NULL, ?, ?, 1, 0, 'active', 'pending', ?, ?)`,
        ).run(repId, periodStart, periodEnd, ONBOARD_MARK, now);
        seededTargets++;
      }
      console.log(`[migrations] R26.6c: seeded ${seededTargets} sales target(s) for rep ${repId}`);

      // One task assigned to the demo sales rep (assigned_to is the column the list filters on).
      const TASK_TITLE = "R26.6c follow-up call";
      const existingTask = sqlite.prepare(`SELECT id FROM task_items WHERE title = ? LIMIT 1`).get(TASK_TITLE) as any;
      if (!existingTask) {
        sqlite.prepare(
          `INSERT INTO task_items (title, description, assigned_to, assigned_to_user_id, assigned_by, status, priority, created_at, updated_at)
           VALUES (?, 'Call the new lead and confirm onboarding paperwork.', ?, ?, 'system', 'pending', 'high', ?, ?)`,
        ).run(TASK_TITLE, repId, repId, now, now);
        console.log(`[migrations] R26.6c: seeded sales task for rep ${repId}`);
      }
    } else {
      console.log("[migrations] R26.6c: demo sales user not found — skipping target/task seed");
    }
  } catch (err: any) {
    console.log("[migrations] R26.6c: sales seed failed —", err?.message || err);
  }

  // ---- ensure at least one customer + seed two sample consignments (idempotent) ----
  try {
    let custId: number | null = null;
    const anyCustomer = sqlite.prepare(`SELECT id FROM customers ORDER BY id LIMIT 1`).get() as any;
    if (anyCustomer?.id) {
      custId = anyCustomer.id;
    } else {
      const CUST_CODE = "NRM-DEMO-CUST";
      const existingDemo = sqlite.prepare(`SELECT id FROM customers WHERE customer_code = ? LIMIT 1`).get(CUST_CODE) as any;
      if (existingDemo?.id) {
        custId = existingDemo.id;
      } else {
        const info = sqlite.prepare(
          `INSERT INTO customers (name, phone, email, city, state, customer_code, created_at)
           VALUES ('Demo Logistics Pvt Ltd', '9000000001', 'demo@narmada.test', 'Patna', 'Bihar', ?, ?)`,
        ).run(CUST_CODE, Date.now());
        custId = Number(info.lastInsertRowid);
        console.log(`[migrations] R26.6c: seeded demo customer ${custId}`);
      }
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const consignmentSeeds: Array<{ docket: string; origin: string; dest: string; status: string; carrier: string; bundles: number; invNum: string; invAmt: number }> = [
      { docket: "NRM-DEMO-001", origin: "Patna", dest: "Delhi", status: "in_transit", carrier: "Narmada Express", bundles: 3, invNum: "INV-DEMO-001", invAmt: 45000 },
      { docket: "NRM-DEMO-002", origin: "Delhi", dest: "Mumbai", status: "pending", carrier: "Blue Dart", bundles: 1, invNum: "INV-DEMO-002", invAmt: 18500 },
    ];
    const insCon = sqlite.prepare(
      `INSERT INTO consignments (docket_number, carrier, origin, destination, customer_id, customer_name, customer_phone, bundles_count, invoice_number, invoice_amount, dispatch_date, eta_date, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?)`,
    );
    const cust = custId ? sqlite.prepare(`SELECT name, phone FROM customers WHERE id = ?`).get(custId) as any : null;
    let seededCon = 0;
    for (const c of consignmentSeeds) {
      const existing = sqlite.prepare(`SELECT id FROM consignments WHERE docket_number = ? LIMIT 1`).get(c.docket) as any;
      if (!existing) {
        insCon.run(
          c.docket, c.carrier, c.origin, c.dest, custId, cust?.name || "Demo Logistics Pvt Ltd",
          cust?.phone || "9000000001", c.bundles, c.invNum, c.invAmt, now, now + 3 * day, c.status, now, now,
        );
        seededCon++;
      }
    }
    console.log(`[migrations] R26.6c: seeded ${seededCon} consignment(s)`);
  } catch (err: any) {
    console.log("[migrations] R26.6c: consignment seed failed —", err?.message || err);
  }

  console.log("[migrations] R26.6c: complete");
}

// -------- R26.6d additive migrations (heal orphaned targets + consignment user) --------
// ADDITIVE ONLY. No schema changes. Two fixes for "sales/consignment not fetching
// previous created data":
//   1) Heal sales_targets whose sales_rep_user_id was stored NULL (admin form sent a
//      field name the backend didn't read) — reassign to the demo `sales` user so the
//      rep portal (/api/sales/targets, filtered by rep id) can see them.
//   2) Seed the demo `consignment` user — R26.5 only seeded sales/finance/hr, so the
//      consignment role login never existed and the portal could not authenticate.
export function runR26_6dMigrations() {
  // ---- 1. heal orphaned sales targets (null rep) ----
  try {
    const salesUser = sqlite.prepare(
      `SELECT id FROM data_team_users WHERE username = 'sales' AND role = 'sales' LIMIT 1`,
    ).get() as any;
    if (salesUser?.id) {
      const orphaned = sqlite.prepare(`SELECT COUNT(*) c FROM sales_targets WHERE sales_rep_user_id IS NULL`).get() as any;
      const info = sqlite.prepare(
        `UPDATE sales_targets SET sales_rep_user_id = ? WHERE sales_rep_user_id IS NULL`,
      ).run(salesUser.id);
      console.log(`[migrations] R26.6d: healed ${info.changes}/${orphaned?.c ?? 0} orphaned sales target(s) → rep ${salesUser.id}`);
    } else {
      console.log("[migrations] R26.6d: demo sales user not found — skipping target heal");
    }
  } catch (err: any) {
    console.log("[migrations] R26.6d: target heal failed —", err?.message || err);
  }

  // ---- 2. seed the demo consignment user (was never created by R26.5) ----
  try {
    const { scryptSync, randomBytes } = require("node:crypto");
    const hash = (plain: string) => {
      const salt = randomBytes(16).toString("hex");
      return `${salt}:${scryptSync(plain, salt, 64).toString("hex")}`;
    };
    const info = sqlite.prepare(
      `INSERT OR IGNORE INTO data_team_users (username, password_hash, name, role, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run("consignment", hash("Consignment@123"), "Consignment Demo", "consignment", Date.now());
    if (info.changes > 0) console.log("[migrations] R26.6d: seeded demo consignment user");
    else console.log("[migrations] R26.6d: consignment user already present");
  } catch (err: any) {
    console.log("[migrations] R26.6d: consignment user seed failed —", err?.message || err);
  }

  console.log("[migrations] R26.6d: complete");
}
