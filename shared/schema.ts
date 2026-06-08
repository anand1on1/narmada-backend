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
