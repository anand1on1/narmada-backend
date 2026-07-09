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
  // R10 — uploaded invoice / docket documents
  invoiceUrl: text("invoice_url"),
  docketUrl: text("docket_url"),
  // R27.13 T5 — where the consignment was dispatched from (e.g. "Delhi").
  dispatchOrigin: text("dispatch_origin"),
  // R27.27 Bug 1 — 1 = genuine Delhi→Patna inter-branch transfer (belongs in the
  // store's incoming list); 0 = delivery to a client (must NOT surface there).
  interBranchTransfer: integer("inter_branch_transfer").default(0),
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
  customerCode: text("customer_code"),  // NM/CUS/0001 style, optional unique
  defaultDiscountPct: real("default_discount_pct"),  // applied as discount% on each new quote line for this customer
  // R26.5 — sales rep ownership (links to data_team_users.id where role='sales').
  salesRepId: integer("sales_rep_id"),
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
  status: text("status").notNull(),        // 'sent' | 'failed' | 'skipped' | 'queued'
  errorMsg: text("error_msg"),
  metaJson: text("meta_json"),              // raw provider response (truncated) for delivery diagnostics
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
// PartSetu v1.4: added `data_center` — PartSetu + Products only, no delete.
// R27.32: added `procurement` + `finance` — Process Payment (admin/procurement/finance).
export type AdminRole = "admin" | "logistics" | "accounts" | "sales" | "data_center" | "procurement" | "finance";

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

// =============================================================
// SESSION C: Quoting Module + Data Team + Parts Master + Chat + Audit
// =============================================================

// -------- QUOTING COMPANIES --------
export const quotingCompanies = sqliteTable("quoting_companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  bankIfsc: text("bank_ifsc"),
  bankBranch: text("bank_branch"),
  logoUrl: text("logo_url"),
  signatureUrl: text("signature_url"),
  quotePrefix: text("quote_prefix").default("NM"),
  defaultTerms: text("default_terms"),
  active: integer("active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertQuotingCompanySchema = createInsertSchema(quotingCompanies).omit({ id: true, createdAt: true });
export type InsertQuotingCompany = z.infer<typeof insertQuotingCompanySchema>;
export type QuotingCompany = typeof quotingCompanies.$inferSelect;

// -------- DATA TEAM USERS --------
export const dataTeamUsers = sqliteTable("data_team_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  role: text("role").notNull().default("data_team"),
  active: integer("active", { mode: "boolean" }).default(true),
  lastLogin: integer("last_login"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  // R26.5 — soft-delete for user management.
  deletedAt: text("deleted_at"),
});
export type DataTeamUser = typeof dataTeamUsers.$inferSelect;

// -------- DATA TEAM SESSIONS --------
export const dataTeamSessions = sqliteTable("data_team_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type DataTeamSession = typeof dataTeamSessions.$inferSelect;

// -------- PARTS MASTER --------
export const partsMaster = sqliteTable("parts_master", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partNumber: text("part_number").notNull().unique(),
  name: text("name").notNull(),
  hsn: text("hsn"),
  gstRate: real("gst_rate"),
  brand: text("brand"),
  lastMrp: real("last_mrp"),
  lastSource: text("last_source"),   // manual | import | edukaan
  lastUpdated: integer("last_updated"),
  searchText: text("search_text"),   // lowercased partNumber+name for LIKE
  useCount: integer("use_count").default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertPartsMasterSchema = createInsertSchema(partsMaster).omit({ id: true, createdAt: true });
export type InsertPartsMaster = z.infer<typeof insertPartsMasterSchema>;
export type PartsMaster = typeof partsMaster.$inferSelect;

// -------- QUOTATIONS --------
export const quotations = sqliteTable("quotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteNo: text("quote_no").notNull().unique(),
  quotingCompanyId: integer("quoting_company_id"),
  companyId: integer("company_id"),
  customerId: integer("customer_id").notNull(),
  status: text("status").notNull().default("draft"),   // draft | sent | accepted | expired
  currency: text("currency").notNull().default("INR"), // INR | USD | EUR | AED
  fxRate: real("fx_rate").default(1),
  fxLockedAt: integer("fx_locked_at"),
  subtotal: real("subtotal").default(0),
  totalDiscount: real("total_discount").default(0),
  totalTax: real("total_tax").default(0),
  grandTotal: real("grand_total").default(0),
  validUntil: integer("valid_until"),
  notes: text("notes"),
  terms: text("terms"),
  createdByUserId: integer("created_by_user_id"),
  pdfUrl: text("pdf_url"),
  // Optional ship-to (one customer may have many sites)
  shippingName: text("shipping_name"),
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingState: text("shipping_state"),
  shippingPincode: text("shipping_pincode"),
  shippingPhone: text("shipping_phone"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});
export const insertQuotationSchema = createInsertSchema(quotations).omit({ id: true, createdAt: true, updatedAt: true, quoteNo: true });
export type InsertQuotation = z.infer<typeof insertQuotationSchema>;
export type Quotation = typeof quotations.$inferSelect;

// -------- QUOTATION ITEMS --------
export const quotationItems = sqliteTable("quotation_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quotationId: integer("quotation_id").notNull(),
  lineNo: integer("line_no").notNull().default(1),
  partNumber: text("part_number"),
  productName: text("product_name").notNull(),
  hsn: text("hsn"),
  brand: text("brand"),
  qty: real("qty").notNull().default(1),
  mrp: real("mrp").notNull().default(0),
  discount: real("discount").default(0),   // percentage
  gstPct: real("gst_pct").default(18),
  lineTotal: real("line_total").default(0),
  source: text("source").default("manual"), // manual | import | edukaan
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertQuotationItemSchema = createInsertSchema(quotationItems).omit({ id: true, createdAt: true });
export type InsertQuotationItem = z.infer<typeof insertQuotationItemSchema>;
export type QuotationItem = typeof quotationItems.$inferSelect;

// -------- AUDIT LOGS --------
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorType: text("actor_type").notNull(),  // admin | data_team | customer
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type AuditLog = typeof auditLogs.$inferSelect;

// -------- EMAIL INBOX --------
export const emailInbox = sqliteTable("email_inbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: text("message_id").notNull().unique(),
  fromEmail: text("from_email"),
  toEmail: text("to_email"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  receivedAt: integer("received_at"),
  processed: integer("processed", { mode: "boolean" }).default(false),
  processedAt: integer("processed_at"),
  rfqId: integer("rfq_id"),
  customerId: integer("customer_id"),
  error: text("error"),
});
export type EmailInboxRow = typeof emailInbox.$inferSelect;

// -------- FX RATES --------
export const fxRates = sqliteTable("fx_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  baseCurrency: text("base_currency").notNull(),
  targetCurrency: text("target_currency").notNull(),
  rate: real("rate").notNull(),
  fetchedAt: integer("fetched_at").notNull().$defaultFn(() => Date.now()),
});
export type FxRate = typeof fxRates.$inferSelect;

// -------- CUSTOMER CHAT MESSAGES --------
export const customerChatMessages = sqliteTable("customer_chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull(),
  role: text("role").notNull(),    // user | assistant
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type CustomerChatMessage = typeof customerChatMessages.$inferSelect;

// -------- ACCOUNT REQUESTS (public registration) --------
export const accountRequests = sqliteTable("account_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  gstin: text("gstin"),
  address: text("address"),
  status: text("status").notNull().default("pending"),  // pending | approved | rejected
  reviewedByAdminId: text("reviewed_by_admin_id"),
  reviewNotes: text("review_notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  reviewedAt: integer("reviewed_at"),
});
export const insertAccountRequestSchema = createInsertSchema(accountRequests).omit({ id: true, createdAt: true, reviewedAt: true, status: true });
export type InsertAccountRequest = z.infer<typeof insertAccountRequestSchema>;
export type AccountRequest = typeof accountRequests.$inferSelect;

// =====================================================================
// ROUNDS 4.4 → 7 — ADDITIVE TABLES (vendors, companies, POs, RFQs,
// warehouses, rate history, leads CRM, targets, announcements, tasks)
// =====================================================================

// -------- R4.4 AI LEDGER QUERIES --------
export const ledgerQueries = sqliteTable("ledger_queries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  question: text("question").notNull(),
  answer: text("answer"),
  sql: text("sql"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type LedgerQuery = typeof ledgerQueries.$inferSelect;

// -------- R5.1 VENDOR MASTER --------
export const vendors = sqliteTable("vendors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  paymentTerms: text("payment_terms"),
  brands: text("brands"),       // comma list or json
  categories: text("categories"),
  rating: integer("rating"),    // 1-5
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});
export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

export const vendorContacts = sqliteTable("vendor_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendorId: integer("vendor_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
});
export const insertVendorContactSchema = createInsertSchema(vendorContacts).omit({ id: true });
export type InsertVendorContact = z.infer<typeof insertVendorContactSchema>;
export type VendorContact = typeof vendorContacts.$inferSelect;

// -------- R5.1 COMPANY MASTER (multi-company billing) --------
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  bankName: text("bank_name"),
  bankBranch: text("bank_branch"),
  accountNo: text("account_no"),
  ifsc: text("ifsc"),
  beneficiaryName: text("beneficiary_name"),
  signatoryName: text("signatory_name"),
  signatoryPhone: text("signatory_phone"),
  signatoryEmail: text("signatory_email"),
  gstType: text("gst_type").notNull().default("regular"), // regular | composition | unregistered
  logoUrl: text("logo_url"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});
export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// -------- R5.1 PURCHASE ORDERS --------
export const purchaseOrdersV2 = sqliteTable("purchase_orders_v2", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  poNumber: text("po_number").notNull().unique(), // NM/PO/YY/0001
  quotationId: integer("quotation_id"),
  customerId: integer("customer_id"),
  companyId: integer("company_id"),
  status: text("status").notNull().default("draft"), // draft|sent|partial|fulfilled|cancelled
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
  // R8 additions
  customerPoNumber: text("customer_po_number"),
  customerPoUrl: text("customer_po_url"),
  customerPoParsedJson: text("customer_po_parsed_json"),
  dispatchRound: integer("dispatch_round").default(1),
  isFullyDispatched: integer("is_fully_dispatched").default(0),
  delhiSubmittedAt: integer("delhi_submitted_at"),
  shipToName: text("ship_to_name"),
  shipToAddress: text("ship_to_address"),
  shipToPhone: text("ship_to_phone"),
  notifiedDelhiAt: integer("notified_delhi_at"),
  // R9 addition — editable PO date (back/forward date)
  poDate: integer("po_date"),
  // R13.4 addition — soft-delete marker. NULL = active; a unix-ms timestamp = soft-deleted.
  // A partial unique index on po_number WHERE deleted_at IS NULL lets a po_number be reused
  // once the prior row is soft-deleted.
  deletedAt: integer("deleted_at"),
  // R21.7 additions — customer urgency tag + delivery deadline (set by Patna, shown to Delhi).
  urgency: text("urgency"), // urgent|normal|standby (default normal at read time)
  deliveryDeadline: integer("delivery_deadline"), // unix-ms; nullable
  // R22 additions — consignment view marker (independent of the PO lifecycle status).
  consignmentStatus: text("consignment_status"), // null|received|processing|completed
  consignmentReceivedAt: integer("consignment_received_at"),
  // R26.2 additions — Delhi docket upload (transport name, docket no, docket date, slip path).
  // docketDate stored as integer unix-ms to match this table's date convention (po_date etc.).
  docketTransport: text("docket_transport"),
  docketNumber: text("docket_number"),
  docketDate: integer("docket_date"),
  docketSlipPath: text("docket_slip_path"),
  // R26.2b — bundles count captured in the Delhi Edit Docket dialog (mirrors the dispatch modal).
  docketBundles: integer("docket_bundles"),
});
export const insertPurchaseOrderV2Schema = createInsertSchema(purchaseOrdersV2).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrderV2 = z.infer<typeof insertPurchaseOrderV2Schema>;
export type PurchaseOrderV2 = typeof purchaseOrdersV2.$inferSelect;

export const poItems = sqliteTable("po_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  poId: integer("po_id").notNull(),
  partNumber: text("part_number"),
  brand: text("brand"),
  description: text("description"),
  qty: real("qty").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
  discountPct: real("discount_pct").notNull().default(0),
  taxPct: real("tax_pct").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0),
  vendorId: integer("vendor_id"),
  purchaseCost: real("purchase_cost"),
  warehouseId: integer("warehouse_id"),
  // R5.7 fulfilment lifecycle
  fulfilStatus: text("fulfil_status").notNull().default("pending"), // pending|collected|packed|dispatched
  docketNo: text("docket_no"),
  courier: text("courier"),
  photoUrl: text("photo_url"),
  collectedAt: integer("collected_at"),
  packedAt: integer("packed_at"),
  dispatchedAt: integer("dispatched_at"),
  // R8 additions
  vendorRate: real("vendor_rate"),
  vendorName: text("vendor_name"),
  assignedAt: integer("assigned_at"),
  assignedBy: text("assigned_by"),
  shippedStatus: text("shipped_status").default("pending"),
  shippedAt: integer("shipped_at"),
  shippedBy: text("shipped_by"),
  dispatchRoundShipped: integer("dispatch_round_shipped"),
  // R9 additions — final approved vendor + winning quote for this line
  approvedVendorId: integer("approved_vendor_id"),
  approvedQuoteId: integer("approved_quote_id"),
  // R12 additions — per-line dispatch snapshot (PO-centric Delhi dispatch)
  docketNumber: text("docket_number"),
  docketSlipUrl: text("docket_slip_url"),
  carrier: text("carrier"),
  bundles: integer("bundles"),
  receivedAt: integer("received_at"),
  // R21.2 additions — qty deviation tracking (Delhi edits qty vs. what Patna ordered).
  originalQty: real("original_qty"),
  deviationReason: text("deviation_reason"),
  deviationAt: integer("deviation_at"),
  deviatedByUserId: integer("deviated_by_user_id"),
  isDeviated: integer("is_deviated").default(0),
  // R21.7.4 addition — per-line note from Patna shown to Delhi.
  patnaNote: text("patna_note"),
});
export const insertPoItemSchema = createInsertSchema(poItems).omit({ id: true });
export type InsertPoItem = z.infer<typeof insertPoItemSchema>;
export type PoItem = typeof poItems.$inferSelect;

// -------- R9 multi-vendor RFQ quotes / chat / payments --------
export const poItemVendorQuotes = sqliteTable("po_item_vendor_quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  poItemId: integer("po_item_id").notNull(),
  vendorId: integer("vendor_id"),
  vendorName: text("vendor_name"),
  vendorPhone: text("vendor_phone"),
  rate: real("rate"),
  taxInclusive: integer("tax_inclusive"),
  taxPercent: real("tax_percent"),
  status: text("status").notNull().default("requested"), // requested|received|approved|rejected|manual
  requestedAt: integer("requested_at").notNull().default(0),
  receivedAt: integer("received_at"),
  approvedAt: integer("approved_at"),
  notes: text("notes"),
});
export type PoItemVendorQuote = typeof poItemVendorQuotes.$inferSelect;

export const vendorRfqMessages = sqliteTable("vendor_rfq_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendorId: integer("vendor_id"),
  vendorPhone: text("vendor_phone"),
  direction: text("direction").notNull(), // out|in
  body: text("body"),
  aisensyMsgId: text("aisensy_msg_id"),
  createdAt: integer("created_at").notNull().default(0),
});
export type VendorRfqMessage = typeof vendorRfqMessages.$inferSelect;

export const vendorPayments = sqliteTable("vendor_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendorId: integer("vendor_id").notNull(),
  paidOn: integer("paid_on").notNull().default(0),
  amount: real("amount").notNull().default(0),
  method: text("method").notNull().default("bank"), // bank|upi|cash|cheque|other
  reference: text("reference"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull().default(0),
});
export type VendorPayment = typeof vendorPayments.$inferSelect;

// -------- R5.1 RFQs --------
export const rfqsV2 = sqliteTable("rfqs_v2", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqNumber: text("rfq_number").notNull().unique(), // NM/RFQ/YY/0001
  poId: integer("po_id"),
  status: text("status").notNull().default("draft"), // draft|sent|responses_in|decided|closed
  requestedBy: text("requested_by"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  closedAt: integer("closed_at"),
});
export const insertRfqV2Schema = createInsertSchema(rfqsV2).omit({ id: true, createdAt: true, closedAt: true });
export type InsertRfqV2 = z.infer<typeof insertRfqV2Schema>;
export type RfqV2 = typeof rfqsV2.$inferSelect;

export const rfqItems = sqliteTable("rfq_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  partNumber: text("part_number"),
  brand: text("brand"),
  description: text("description"),
  qty: real("qty").notNull().default(1),
  targetPrice: real("target_price"),
  notes: text("notes"),
});
export const insertRfqItemSchema = createInsertSchema(rfqItems).omit({ id: true });
export type InsertRfqItem = z.infer<typeof insertRfqItemSchema>;
export type RfqItem = typeof rfqItems.$inferSelect;

export const rfqVendors = sqliteTable("rfq_vendors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  sentAt: integer("sent_at"),
  status: text("status").notNull().default("pending"), // pending|responded|no_response
  whatsappMessageId: text("whatsapp_message_id"),
});
export const insertRfqVendorSchema = createInsertSchema(rfqVendors).omit({ id: true });
export type InsertRfqVendor = z.infer<typeof insertRfqVendorSchema>;
export type RfqVendor = typeof rfqVendors.$inferSelect;

export const rfqQuotes = sqliteTable("rfq_quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  itemId: integer("item_id"),
  rate: real("rate"),
  moq: real("moq"),
  leadTimeDays: integer("lead_time_days"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  rawMessage: text("raw_message"),
  extractedBy: text("extracted_by").notNull().default("manual"), // ai|manual
  isWinner: integer("is_winner", { mode: "boolean" }).notNull().default(false),
  receivedAt: integer("received_at").notNull().$defaultFn(() => Date.now()),
});
export const insertRfqQuoteSchema = createInsertSchema(rfqQuotes).omit({ id: true, receivedAt: true });
export type InsertRfqQuote = z.infer<typeof insertRfqQuoteSchema>;
export type RfqQuote = typeof rfqQuotes.$inferSelect;

// -------- R5.1 VENDOR CONVERSATIONS --------
export const vendorConversations = sqliteTable("vendor_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendorId: integer("vendor_id").notNull(),
  rfqId: integer("rfq_id"),
  direction: text("direction").notNull(), // in|out
  channel: text("channel").notNull().default("whatsapp"),
  messageText: text("message_text"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  whatsappMessageId: text("whatsapp_message_id"),
  sentBy: text("sent_by"),
  claudeExtracted: text("claude_extracted"), // json
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type VendorConversation = typeof vendorConversations.$inferSelect;

// -------- R5.1 WAREHOUSES --------
export const warehouses = sqliteTable("warehouses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  city: text("city"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertWarehouseSchema = createInsertSchema(warehouses).omit({ id: true, createdAt: true });
export type InsertWarehouse = z.infer<typeof insertWarehouseSchema>;
export type Warehouse = typeof warehouses.$inferSelect;

export const warehouseTransfers = sqliteTable("warehouse_transfers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromWarehouseId: integer("from_warehouse_id").notNull(),
  toWarehouseId: integer("to_warehouse_id").notNull(),
  partNumber: text("part_number"),
  qty: real("qty").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending|dispatched|received
  notes: text("notes"),
  dispatchedAt: integer("dispatched_at"),
  receivedAt: integer("received_at"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const insertWarehouseTransferSchema = createInsertSchema(warehouseTransfers).omit({ id: true, createdAt: true });
export type InsertWarehouseTransfer = z.infer<typeof insertWarehouseTransferSchema>;
export type WarehouseTransfer = typeof warehouseTransfers.$inferSelect;

// -------- R5.6 RATE HISTORY --------
export const rateHistory = sqliteTable("rate_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partNumber: text("part_number"),
  brand: text("brand"),
  vendorId: integer("vendor_id"),
  rate: real("rate"),
  moq: real("moq"),
  leadTimeDays: integer("lead_time_days"),
  source: text("source").notNull(), // rfq_quote|po|manual
  sourceId: integer("source_id"),
  recordedAt: integer("recorded_at").notNull().$defaultFn(() => Date.now()),
});
export type RateHistory = typeof rateHistory.$inferSelect;

// -------- R7 MARKETING CRM: LEADS --------
export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().default("manual"), // instagram|facebook|google_ads|whatsapp|manual|import
  name: text("name").notNull(),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  city: text("city"),
  state: text("state"),
  requirement: text("requirement"),
  stage: text("stage").notNull().default("new"), // new|contacted|qualified|quoted|won|lost
  ownerId: integer("owner_id"),
  score: integer("score").notNull().default(0), // 0-100
  tags: text("tags"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
  lastContactAt: integer("last_contact_at"),
  // R24 additions — Market Radar lead pipeline (status mirrors stage for the new UI, plus
  // free-text notes, assignment, and conversion link). Additive only.
  status: text("status"), // new|contacted|qualified|converted|lost
  notes: text("notes"),
  assignedToUserId: integer("assigned_to_user_id"),
  convertedToCustomerId: integer("converted_to_customer_id"),
  // R25a — link a lead to the vendor record it was converted into (Convert to Vendor action).
  convertedToVendorId: integer("converted_to_vendor_id"),
  // R26.5 — Leads V2 additive fields.
  contactPerson: text("contact_person"),
  address: text("address"),
  deletedAt: text("deleted_at"),
});
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export const leadActivities = sqliteTable("lead_activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  type: text("type").notNull(), // call|whatsapp|email|note|stage_change
  detail: text("detail"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

// R24 — marketing campaign send log (one row per lead per send). Fire-and-forget AiSensy.
export const marketingSends = sqliteTable("marketing_sends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id"),
  phone: text("phone"),
  template: text("template"),
  vars: text("vars"),
  status: text("status").notNull().default("queued"), // queued|sent|failed
  error: text("error"),
  sentBy: text("sent_by"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export type MarketingSend = typeof marketingSends.$inferSelect;
export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({ id: true, createdAt: true });
export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;
export type LeadActivity = typeof leadActivities.$inferSelect;

export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  period: text("period").notNull(), // month|quarter
  periodKey: text("period_key").notNull(), // 2026-06
  metric: text("metric").notNull(), // quotations|po_value|leads_won
  targetValue: real("target_value").notNull().default(0),
  currentValue: real("current_value").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});
export const insertTargetSchema = createInsertSchema(targets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTarget = z.infer<typeof insertTargetSchema>;
export type Target = typeof targets.$inferSelect;

export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  audience: text("audience").notNull().default("all"), // all|patna|delhi|admin
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  expiresAt: integer("expires_at"),
});
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true, createdAt: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

export const taskItems = sqliteTable("task_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: integer("assigned_to"),
  assignedBy: text("assigned_by"),
  dueDate: integer("due_date"),
  status: text("status").notNull().default("open"), // open|doing|done (R26.5 also: pending|processing|standby|complete)
  priority: text("priority").notNull().default("normal"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
  // R26.5 — Tasks V2 additive fields.
  fileUrl: text("file_url"),
  deadline: text("deadline"),
  assignedToUserId: integer("assigned_to_user_id"),
});
export const insertTaskItemSchema = createInsertSchema(taskItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaskItem = z.infer<typeof insertTaskItemSchema>;
export type TaskItem = typeof taskItems.$inferSelect;

// -------- R8: DISPATCHES --------
export const dispatches = sqliteTable("dispatches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  poId: integer("po_id").notNull(),
  roundNo: integer("round_no").notNull().default(1),
  docketNo: text("docket_no"),
  courierName: text("courier_name"),
  dispatchDate: integer("dispatch_date"),
  docketPhotoUrl: text("docket_photo_url"),
  pdfUrl: text("pdf_url"),
  bundles: integer("bundles"),
  submittedBy: text("submitted_by"),
  submittedAt: integer("submitted_at"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  // R21.6 addition — inter-branch transfer (Patna) dispatch with optional fields.
  isInternalTransfer: integer("is_internal_transfer").default(0),
});
export const insertDispatchSchema = createInsertSchema(dispatches).omit({ id: true, createdAt: true });
export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatches.$inferSelect;

// ============================================================================
// R26.5 — additive tables for Leads V2 stages, sales targets, attendance/visit
// check-ins, and cross-team notifications. Additive only.
// ============================================================================
export const leadStages = sqliteTable("lead_stages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: integer("created_at"),
});
export type LeadStage = typeof leadStages.$inferSelect;

export const salesTargets = sqliteTable("sales_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  salesRepUserId: integer("sales_rep_user_id"),
  targetType: text("target_type"),       // monthly|weekly|quarterly
  customerId: integer("customer_id"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  targetAmount: real("target_amount"),
  achievedAmount: real("achieved_amount").default(0),
  rolledOverFrom: integer("rolled_over_from"),
  status: text("status").default("active"), // active|completed|rolled_over
  createdAt: integer("created_at"),
});
export type SalesTarget = typeof salesTargets.$inferSelect;

export const targetAchievements = sqliteTable("target_achievements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetId: integer("target_id"),
  poId: integer("po_id"),
  customerId: integer("customer_id"),
  amount: real("amount"),
  verifiedBy: text("verified_by"),        // auto|admin
  adminApproved: integer("admin_approved").default(0),
  createdAt: integer("created_at"),
});
export type TargetAchievement = typeof targetAchievements.$inferSelect;

export const attendanceCheckins = sqliteTable("attendance_checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  salesRepUserId: integer("sales_rep_user_id"),
  date: text("date"),                     // YYYY-MM-DD
  checkinAt: text("checkin_at"),
  checkoutAt: text("checkout_at"),
  checkinMissed: integer("checkin_missed").default(0),
  checkoutMissed: integer("checkout_missed").default(0),
});
export type AttendanceCheckin = typeof attendanceCheckins.$inferSelect;

export const visitCheckins = sqliteTable("visit_checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  salesRepUserId: integer("sales_rep_user_id"),
  customerId: integer("customer_id"),
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: text("created_at"),
});
export type VisitCheckin = typeof visitCheckins.$inferSelect;

export const crossTeamEvents = sqliteTable("cross_team_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type"),
  payloadJson: text("payload_json"),
  targetUserId: integer("target_user_id"),
  targetRole: text("target_role"),
  readAt: text("read_at"),
  createdAt: text("created_at"),
});
export type CrossTeamEvent = typeof crossTeamEvents.$inferSelect;
