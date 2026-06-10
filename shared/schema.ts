import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Products table
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  brand: text("brand").notNull(), // tata | bharatbenz | ashok-leyland | eicher | volvo | other
  model: text("model"), // e.g. "TATA 2523 PRIMA"
  category: text("category").notNull(), // engine | clutch | brake | suspension | electrical | filter | body | transmission | other
  partNumber: text("part_number"),
  oemNumber: text("oem_number"),
  description: text("description").notNull(),
  shortDescription: text("short_description"),
  priceInr: real("price_inr").notNull(), // base price in INR
  stockQty: integer("stock_qty").default(0),
  imageUrls: text("image_urls").notNull().default("[]"), // JSON array of URLs
  compatibleModels: text("compatible_models").default("[]"), // JSON array
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  metaKeywords: text("meta_keywords"),
  featured: integer("featured", { mode: "boolean" }).default(false),
  active: integer("active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at").notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// Contact submissions
export const contactSubmissions = sqliteTable("contact_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  country: text("country"),
  subject: text("subject"),
  message: text("message").notNull(),
  productInterest: text("product_interest"),
  createdAt: integer("created_at").notNull(),
  status: text("status").default("new"), // new | replied | archived
});

export const insertContactSchema = createInsertSchema(contactSubmissions).omit({
  id: true,
  createdAt: true,
  status: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactSubmissions.$inferSelect;

// Settings (USD/INR rate, etc.)
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export type Setting = typeof settings.$inferSelect;

// Sitemap log
export const sitemapRuns = sqliteTable("sitemap_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  urlCount: integer("url_count").notNull(),
  generatedAt: integer("generated_at").notNull(),
});

// -------- BLOG / CONTENT --------
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  content: text("content").notNull(),       // markdown / HTML
  coverImageUrl: text("cover_image_url"),
  type: text("type").notNull().default("blog"),   // blog | spotlight
  productSlug: text("product_slug"),         // when type=spotlight, links to product
  authorName: text("author_name").default("Narmada Mobility"),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  metaKeywords: text("meta_keywords"),
  published: integer("published", { mode: "boolean" }).default(false),
  publishedAt: integer("published_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const insertPostSchema = createInsertSchema(posts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof posts.$inferSelect;

// -------- PRICE LISTS --------
export const priceLists = sqliteTable("price_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),         // tata | bharatbenz | ashok-leyland | eicher | volvo | other
  versionLabel: text("version_label"),    // e.g. "Q2 2026", "April price update"
  itemCount: integer("item_count").default(0),
  effectiveDate: integer("effective_date"),  // when this price list becomes valid
  notes: text("notes"),
  uploadedAt: integer("uploaded_at").notNull(),
});
export const insertPriceListSchema = createInsertSchema(priceLists).omit({
  id: true,
  uploadedAt: true,
  itemCount: true,
});
export type InsertPriceList = z.infer<typeof insertPriceListSchema>;
export type PriceList = typeof priceLists.$inferSelect;

export const priceItems = sqliteTable("price_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brand: text("brand").notNull(),
  priceListId: integer("price_list_id").notNull(),
  partNumber: text("part_number").notNull(),
  partNumberClean: text("part_number_clean").notNull(),  // alphanumeric only, lowercase
  description: text("description"),
  mrp: real("mrp"),
  dealerPrice: real("dealer_price"),
  hsnCode: text("hsn_code"),
  gstPercent: real("gst_percent"),
  uom: text("uom"),    // unit of measure: pcs, set, kit
});
export type PriceItem = typeof priceItems.$inferSelect;

// -------- CONSIGNMENTS --------
export const consignments = sqliteTable("consignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  docketNumber: text("docket_number").notNull().unique(),
  carrier: text("carrier"),                // DTDC, Gati, BlueDart, etc.
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  customerId: integer("customer_id"),      // FK to customers (Phase 4)
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),   // Phase 4: for email notifications
  bundlesCount: integer("bundles_count").default(1),
  invoiceNumber: text("invoice_number"),
  invoiceAmount: real("invoice_amount"),
  dispatchDate: integer("dispatch_date"),
  etaDate: integer("eta_date"),
  deliveredDate: integer("delivered_date"),
  status: text("status").notNull().default("pending"), // pending | in_transit | out_for_delivery | delivered | cancelled
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const insertConsignmentSchema = createInsertSchema(consignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConsignment = z.infer<typeof insertConsignmentSchema>;
export type Consignment = typeof consignments.$inferSelect;

// -------- CUSTOMERS (Phase 4 + Session B extensions) --------
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  gstNumber: text("gst_number"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  creditLimitInr: real("credit_limit_inr").default(0),
  openingBalanceInr: real("opening_balance_inr").default(0),
  paymentTermsDays: integer("payment_terms_days").default(0),
  contactPerson: text("contact_person"),
  companyPan: text("company_pan"),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// -------- NOTIFICATION TEMPLATES (Phase 4) --------
export const notificationTemplates = sqliteTable("notification_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventKey: text("event_key").notNull(),   // 'consignment_created' | 'in_transit' | 'out_for_delivery' | 'delivered'
  channel: text("channel").notNull(),      // 'email' | 'whatsapp'
  subject: text("subject"),               // email only
  body: text("body").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, updatedAt: true });
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;

// -------- NOTIFICATION LOG (Phase 4) --------
export const notificationLog = sqliteTable("notification_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  consignmentId: integer("consignment_id"),
  customerId: integer("customer_id"),
  eventKey: text("event_key").notNull(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").notNull(),        // 'sent' | 'failed' | 'skipped'
  errorMsg: text("error_msg"),
  sentAt: integer("sent_at").notNull().$defaultFn(() => Date.now()),
});

export type NotificationLog = typeof notificationLog.$inferSelect;

// -------- ADMIN USERS (multi-role — Session A V2) --------
// Roles: admin (full access) | logistics (consignments only) | accounts (ledger/payments/customers) | sales (customers/RFQ/pricelist)
export const adminUsers = sqliteTable("admin_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),   // admin | logistics | accounts | sales
  displayName: text("display_name"),
  active: integer("active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at").notNull(),
});
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = "admin" | "logistics" | "accounts" | "sales";

// -------- ADMIN SESSIONS (Session A V2) --------
// DB-backed sessions survive Render restarts. Token map in memory is rehydrated from this table.
export const adminSessions = sqliteTable("admin_sessions", {
  token: text("token").primaryKey(),
  username: text("username").notNull(),
  role: text("role").notNull(),
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),  // 30 days from creation; refreshed on use
});
export type AdminSession = typeof adminSessions.$inferSelect;


// =============================================================
// SESSION B: Customer portal, ledger, RFQ/Quote/PO, payments
// =============================================================

// -------- CUSTOMER EMAILS (multi-email per customer; all CC'd) --------
export const customerEmails = sqliteTable("customer_emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  email: text("email").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  label: text("label"),
  createdAt: integer("created_at").notNull(),
});
export type CustomerEmail = typeof customerEmails.$inferSelect;

// -------- CUSTOMER ADDRESSES (multi-address: billing/shipping) --------
export const customerAddresses = sqliteTable("customer_addresses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  label: text("label"),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  country: text("country").default("India"),
  gstin: text("gstin"),
  isBilling: integer("is_billing", { mode: "boolean" }).notNull().default(false),
  isShipping: integer("is_shipping", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});
export type CustomerAddress = typeof customerAddresses.$inferSelect;

// -------- CUSTOMER LOGINS (one login per company) --------
export const customerLogins = sqliteTable("customer_logins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  creditLimitInr: real("credit_limit_inr").default(0),
  paymentTermsDays: integer("payment_terms_days").default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});
export type CustomerLogin = typeof customerLogins.$inferSelect;

// -------- CUSTOMER SESSIONS (30-day token, OTP-issued) --------
export const customerSessions = sqliteTable("customer_sessions", {
  token: text("token").primaryKey(),
  customerId: integer("customer_id").notNull(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export type CustomerSession = typeof customerSessions.$inferSelect;

// -------- OTP CODES (email-only, 6-digit, 10-minute expiry) --------
export const otpCodes = sqliteTable("otp_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  code: text("code").notNull(),
  purpose: text("purpose").notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export type OtpCode = typeof otpCodes.$inferSelect;

// -------- LEDGER ENTRIES --------
export const ledgerEntries = sqliteTable("ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  entryDate: integer("entry_date").notNull(),
  voucherType: text("voucher_type").notNull(),
  voucherNo: text("voucher_no"),
  referenceId: integer("reference_id"),
  description: text("description"),
  debitInr: real("debit_inr").notNull().default(0),
  creditInr: real("credit_inr").notNull().default(0),
  balanceInr: real("balance_inr"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
});
export const insertLedgerEntrySchema = createInsertSchema(ledgerEntries).omit({ id: true, createdAt: true, balanceInr: true });
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// -------- RFQ --------
export const rfqs = sqliteTable("rfqs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  items: text("items").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to"),
  quotedAt: integer("quoted_at"),
  quoteId: integer("quote_id"),
  createdAt: integer("created_at").notNull(),
});
export const insertRfqSchema = createInsertSchema(rfqs).omit({ id: true, createdAt: true, quotedAt: true, quoteId: true, status: true });
export type InsertRfq = z.infer<typeof insertRfqSchema>;
export type Rfq = typeof rfqs.$inferSelect;

// -------- QUOTES --------
export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteNo: text("quote_no").notNull().unique(),
  rfqId: integer("rfq_id"),
  customerId: integer("customer_id").notNull(),
  items: text("items").notNull(),
  subtotalInr: real("subtotal_inr").notNull().default(0),
  gstInr: real("gst_inr").notNull().default(0),
  totalInr: real("total_inr").notNull().default(0),
  validUntil: integer("valid_until"),
  status: text("status").notNull().default("sent"),
  notes: text("notes"),
  terms: text("terms"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
});
export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true, quoteNo: true, status: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

// -------- PURCHASE ORDERS --------
export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  customerPoNumber: text("customer_po_number").notNull(),
  rfqId: integer("rfq_id"),
  quoteId: integer("quote_id"),
  items: text("items").notNull(),
  subtotalInr: real("subtotal_inr").default(0),
  gstInr: real("gst_inr").default(0),
  totalInr: real("total_inr").notNull().default(0),
  status: text("status").notNull().default("pending"),
  reminderCount: integer("reminder_count").notNull().default(0),
  lastRemindedAt: integer("last_reminded_at"),
  approvedAt: integer("approved_at"),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true, createdAt: true, status: true, reminderCount: true, lastRemindedAt: true, approvedAt: true, approvedBy: true,
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// -------- PAYMENT RECORDS --------
export const paymentRecords = sqliteTable("payment_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  amountInr: real("amount_inr").notNull(),
  paymentMode: text("payment_mode").notNull(),
  referenceNo: text("reference_no"),
  paymentDate: integer("payment_date").notNull(),
  notes: text("notes"),
  recordedBy: text("recorded_by"),
  createdAt: integer("created_at").notNull(),
});
export const insertPaymentRecordSchema = createInsertSchema(paymentRecords).omit({ id: true, createdAt: true });
export type InsertPaymentRecord = z.infer<typeof insertPaymentRecordSchema>;
export type PaymentRecord = typeof paymentRecords.$inferSelect;

// -------- FILE UPLOADS (polymorphic) --------
export const fileUploads = sqliteTable("file_uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  fileKind: text("file_kind").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  storagePath: text("storage_path").notNull(),
  uploadedBy: text("uploaded_by"),
  createdAt: integer("created_at").notNull(),
});
export type FileUpload = typeof fileUploads.$inferSelect;

// -------- BANK DETAILS --------
export const bankDetails = sqliteTable("bank_details", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  accountName: text("account_name").notNull(),
  accountNo: text("account_no").notNull(),
  ifsc: text("ifsc").notNull(),
  bankName: text("bank_name").notNull(),
  branch: text("branch"),
  accountType: text("account_type"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});
export const insertBankDetailsSchema = createInsertSchema(bankDetails).omit({ id: true, createdAt: true });
export type InsertBankDetails = z.infer<typeof insertBankDetailsSchema>;
export type BankDetails = typeof bankDetails.$inferSelect;
