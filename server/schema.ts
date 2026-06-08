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

// -------- CUSTOMERS (Phase 4) --------
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

// -------- ADMIN USERS (multi-role) --------
export const adminUsers = sqliteTable("admin_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),   // admin | logistics
  displayName: text("display_name"),
  active: integer("active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at").notNull(),
});
export type AdminUser = typeof adminUsers.$inferSelect;
