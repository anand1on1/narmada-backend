// Phase 3 routes — blogs, price lists, consignments, admin users (sub-users), SEO helpers.
// Mounted from server/routes.ts via registerV2Routes().
import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import Papa from "papaparse";
import { storage } from "./storage";
import * as v2 from "./storage-v2";
import {
  insertPostSchema, insertConsignmentSchema, insertPriceListSchema,
} from "@shared/schema";
import type { AdminUser } from "@shared/schema";

// ============================================================================
// AUTH / SESSIONS (Phase 3)
// We extend the in-memory token map from routes.ts via a shared registry passed in.
// Each token maps to { username, role, displayName }.
// ============================================================================

export interface TokenInfo {
  username: string;
  role: "admin" | "logistics";
  displayName?: string;
}
export type TokenMap = Map<string, TokenInfo>;

// Password hashing helpers (scrypt with random salt)
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const test = scryptSync(plain, salt, 64).toString("hex");
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch { return false; }
}

// Normalize date input — frontend may send YYYY-MM-DD or ISO strings; schema expects number (ms timestamp).
function normalizeDate(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const ts = new Date(v).getTime();
    if (!isNaN(ts)) return ts;
  }
  return undefined;
}

// Scan an object and convert any *Date / *At fields from strings to numbers.
function normalizeDateFields<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: any = { ...obj };
  for (const key of Object.keys(out)) {
    if (/(Date|At)$/.test(key) && typeof out[key] === "string") {
      const norm = normalizeDate(out[key]);
      if (norm !== undefined) out[key] = norm;
      else delete out[key]; // empty/invalid -> drop so schema's optional check passes
    }
  }
  return out;
}

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ============================================================================
// Sitemap rebuild trigger (auto-regen on product/post change + IndexNow ping)
// ============================================================================

// Triggered after product/blog changes — debounced 5 seconds so a bulk upload
// only regenerates once at the end.
let regenTimer: NodeJS.Timeout | null = null;
export function triggerSitemapRegen(regenFn: () => Promise<{ urlCount: number }>) {
  if (regenTimer) clearTimeout(regenTimer);
  regenTimer = setTimeout(async () => {
    try {
      const r = await regenFn();
      console.log("[sitemap] auto-regenerated", r.urlCount, "URLs");
      // ping IndexNow (Bing + Yandex) — free, no auth needed beyond a key file
      await pingIndexNow();
    } catch (e: any) { console.error("[sitemap] auto-regen failed:", e.message); }
  }, 5000);
}

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "narmada-mobility-indexnow-key-2026";
const SITE_HOST = process.env.SITE_HOST || "narmadamobility.com";

async function pingIndexNow() {
  try {
    const url = `https://api.indexnow.org/IndexNow?url=https://${SITE_HOST}/&key=${INDEXNOW_KEY}`;
    const res = await fetch(url);
    console.log("[indexnow] ping status:", res.status);
  } catch (e: any) { console.error("[indexnow] failed:", e.message); }
}

// ============================================================================
// REGISTER V2 ROUTES
// ============================================================================

export interface V2Context {
  tokenMap: TokenMap;           // shared with routes.ts
  primaryAdminUsername: string; // env-configured root admin
  primaryAdminPassword: string;
  regenSitemap: () => Promise<{ urlCount: number }>;
  uploadsDir: string;
}

export function registerV2Routes(app: Express, ctx: V2Context) {
  const { tokenMap, primaryAdminUsername, primaryAdminPassword, regenSitemap } = ctx;

  // Middleware: require any logged-in admin user
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.headers["x-admin-token"] as string | undefined;
    if (!token || !tokenMap.has(token)) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = tokenMap.get(token);
    next();
  }
  // Middleware: require admin role specifically (logistics not allowed)
  function requireAdminRole(req: Request, res: Response, next: NextFunction) {
    requireAuth(req, res, () => {
      const u = (req as any).user as TokenInfo;
      if (u.role !== "admin") return res.status(403).json({ error: "Admin role required" });
      next();
    });
  }

  // ============== LOGIN (extended — supports primary admin OR DB users) ==============
  // Replaces the original /api/admin/login behavior via shadow: if username matches
  // primary admin password, accept. Otherwise, check admin_users table.
  app.post("/api/v2/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "Username and password required" });

      let info: TokenInfo | null = null;

      // Primary admin (env-configured) — always available
      if (username === primaryAdminUsername && password === primaryAdminPassword) {
        info = { username, role: "admin", displayName: "Primary Administrator" };
      } else {
        // DB user
        const user = await v2.getAdminUserByUsername(username);
        if (user && user.active && verifyPassword(password, user.passwordHash)) {
          info = {
            username: user.username,
            role: user.role as "admin" | "logistics",
            displayName: user.displayName || user.username,
          };
        }
      }

      if (!info) return res.status(401).json({ error: "Invalid credentials" });
      const token = randomBytes(32).toString("hex");
      tokenMap.set(token, info);
      res.json({ token, user: info });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/v2/logout", requireAuth, (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    tokenMap.delete(token);
    res.json({ ok: true });
  });

  app.get("/api/v2/me", requireAuth, (req, res) => {
    res.json((req as any).user);
  });

  // ============== ADMIN USERS (sub-users) ==============
  app.get("/api/v2/admin/users", requireAdminRole, async (_req, res) => {
    const users = await v2.listAdminUsers();
    // Don't expose passwordHash
    res.json(users.map((u) => ({ ...u, passwordHash: undefined })));
  });

  app.post("/api/v2/admin/users", requireAdminRole, async (req, res) => {
    try {
      const { username, password, role, displayName } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      if (!["admin", "logistics"].includes(role)) return res.status(400).json({ error: "role must be admin or logistics" });
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      if (username === primaryAdminUsername) return res.status(400).json({ error: "This username is reserved" });
      const existing = await v2.getAdminUserByUsername(username);
      if (existing) return res.status(400).json({ error: "Username already taken" });
      const user = await v2.createAdminUser({
        username, passwordHash: hashPassword(password), role, displayName,
      });
      res.json({ ...user, passwordHash: undefined });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/v2/admin/users/:id", requireAdminRole, async (req, res) => {
    try {
      const updates: any = {};
      if (req.body.password) {
        if (req.body.password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
        updates.passwordHash = hashPassword(req.body.password);
      }
      if (req.body.role) updates.role = req.body.role;
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
      if (req.body.active !== undefined) updates.active = req.body.active;
      const user = await v2.updateAdminUser(parseInt(req.params.id, 10), updates);
      res.json({ ...user, passwordHash: undefined });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/v2/admin/users/:id", requireAdminRole, async (req, res) => {
    await v2.deleteAdminUser(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ============== BLOG / POSTS ==============
  // Public — only published posts
  app.get("/api/posts", async (req, res) => {
    const type = (req.query.type as string) || undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const list = await v2.listPosts({ publishedOnly: true, type, limit });
    res.json(list);
  });
  app.get("/api/posts/:slug", async (req, res) => {
    const post = await v2.getPostBySlug(req.params.slug);
    if (!post || !post.published) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  });

  // Admin
  app.get("/api/admin/posts", requireAdminRole, async (req, res) => {
    const type = (req.query.type as string) || undefined;
    const list = await v2.listPosts({ type });
    res.json(list);
  });
  app.get("/api/admin/posts/:id", requireAdminRole, async (req, res) => {
    const post = await v2.getPost(parseInt(req.params.id, 10));
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  });
  app.post("/api/admin/posts", requireAdminRole, async (req, res) => {
    try {
      const body = normalizeDateFields(req.body || {});
      if (!body.slug && body.title) body.slug = toSlug(body.title);
      const parsed = insertPostSchema.parse(body);
      const post = await v2.createPost(parsed);
      triggerSitemapRegen(regenSitemap);
      res.json(post);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/admin/posts/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const post = await v2.updatePost(id, normalizeDateFields(req.body || {}));
      triggerSitemapRegen(regenSitemap);
      res.json(post);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/posts/:id", requireAdminRole, async (req, res) => {
    await v2.deletePost(parseInt(req.params.id, 10));
    triggerSitemapRegen(regenSitemap);
    res.json({ ok: true });
  });

  // ============== PRICE LISTS ==============
  // Public — available brands
  app.get("/api/price-lists/brands", async (_req, res) => {
    const brands = await v2.getAvailableBrands();
    res.json(brands);
  });
  // Public — search by part number
  app.get("/api/price-lists/search", async (req, res) => {
    const partNumber = (req.query.part_number || req.query.q) as string;
    const brand = req.query.brand as string | undefined;
    if (!partNumber) return res.status(400).json({ error: "part_number required" });
    const results = await v2.searchPriceItems(partNumber, brand);
    res.json({ results, count: results.length });
  });

  // Admin
  app.get("/api/admin/price-lists", requireAdminRole, async (_req, res) => {
    const lists = await v2.listPriceLists();
    res.json(lists);
  });

  app.get("/api/admin/price-lists/template.csv", requireAdminRole, (_req, res) => {
    const headers = ["part_number", "description", "mrp", "dealer_price", "hsn_code", "gst_percent", "uom"];
    const rows = [
      ["278611200172", "Brake pad set (Tata Prima 2523 front)", "4500", "3825", "87083000", "28", "set"],
      ["6722500001", "Clutch plate 350mm (BharatBenz 2823C)", "18500", "15725", "87084000", "28", "pcs"],
      ["BS6-FF-AL-2024", "Fuel filter spin-on (Ashok Leyland Dost+)", "650", "552", "84212300", "18", "pcs"],
    ];
    const csv = Papa.unparse({ fields: headers, data: rows });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="narmada-price-list-template.csv"`);
    res.send(csv);
  });

  app.post("/api/admin/price-lists", requireAdminRole, async (req, res) => {
    try {
      const { brand, versionLabel, effectiveDate, notes, csv } = req.body || {};
      if (!brand) return res.status(400).json({ error: "brand is required" });
      if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv content required" });
      const meta = insertPriceListSchema.parse(normalizeDateFields({ brand, versionLabel, effectiveDate, notes }));
      const list = await v2.createPriceList(meta);

      const parsed = Papa.parse(csv.trim(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      const rows = (parsed.data as any[]) || [];

      const items: any[] = [];
      const errors: { row: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const partNumber = String(r.part_number || r.partnumber || r.part_no || "").trim();
        if (!partNumber) { errors.push({ row: i + 2, error: "part_number is empty" }); continue; }
        items.push({
          partNumber,
          description: String(r.description || "").trim() || null,
          mrp: parseFloat(String(r.mrp || "0").replace(/[^0-9.]/g, "")) || null,
          dealerPrice: parseFloat(String(r.dealer_price || r.dealerprice || "0").replace(/[^0-9.]/g, "")) || null,
          hsnCode: String(r.hsn_code || r.hsn || "").trim() || null,
          gstPercent: parseFloat(String(r.gst_percent || r.gst || "0").replace(/[^0-9.]/g, "")) || null,
          uom: String(r.uom || "").trim() || null,
        });
      }
      const inserted = await v2.bulkInsertPriceItems(brand, list.id, items);
      res.json({ ok: true, priceList: { ...list, itemCount: inserted }, inserted, errors });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/admin/price-lists/:id", requireAdminRole, async (req, res) => {
    await v2.deletePriceList(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ============== CONSIGNMENTS ==============
  // Public — track by docket number
  app.get("/api/track/:docket", async (req, res) => {
    const c = await v2.getConsignmentByDocket(req.params.docket);
    if (!c) return res.status(404).json({ error: "Consignment not found" });
    // Public payload — hide internal notes
    res.json({
      docketNumber: c.docketNumber,
      carrier: c.carrier,
      origin: c.origin,
      destination: c.destination,
      bundlesCount: c.bundlesCount,
      status: c.status,
      dispatchDate: c.dispatchDate,
      etaDate: c.etaDate,
      deliveredDate: c.deliveredDate,
      invoiceNumber: c.invoiceNumber,
    });
  });

  // Admin — list (both admin + logistics can read)
  app.get("/api/admin/consignments", requireAuth, async (req, res) => {
    const status = req.query.status as string | undefined;
    const q = req.query.q as string | undefined;
    const list = await v2.listConsignments({ status, q });
    res.json(list);
  });

  // Admin — create (both admin + logistics)
  app.post("/api/admin/consignments", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const parsed = insertConsignmentSchema.parse(normalizeDateFields(req.body || {}));
      const created = await v2.createConsignment(parsed, user.username);
      res.json(created);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });

  app.patch("/api/admin/consignments/:id", requireAuth, async (req, res) => {
    try {
      const updated = await v2.updateConsignment(parseInt(req.params.id, 10), normalizeDateFields(req.body || {}));
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/admin/consignments/:id", requireAdminRole, async (req, res) => {
    // Only full admin can delete
    await v2.deleteConsignment(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ============== DIRECT IMAGE UPLOAD ==============
  // Accepts multipart-encoded base64 (FormData with `file` blob via fetch).
  // The existing /api/admin/upload-image accepts base64 string; we leave it.
  // This route supports binary form-data via simple body-parser-raw with size limit.
  app.post("/api/v2/upload-image", requireAuth, async (req, res) => {
    try {
      const { dataUrl, filename } = req.body || {};
      if (!dataUrl) return res.status(400).json({ error: "dataUrl required" });
      const m = String(dataUrl).match(/^data:(image\/[a-zA-Z+-]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: "Invalid data URL" });
      const mime = m[1];
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Image too large (max 5MB)" });
      const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
      const safeName = String(filename || "image").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      const id = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}.${ext}`;
      const filePath = path.join(ctx.uploadsDir, id);
      fs.writeFileSync(filePath, buf);
      // Return absolute URL so frontend on different domain (GoDaddy) can load images from Render
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const host = req.get('host');
      const absoluteUrl = `${proto}://${host}/uploads/${id}`;
      res.json({ ok: true, url: absoluteUrl, path: `/uploads/${id}`, filename: id, size: buf.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============== SEO HELPERS ==============
  // JSON-LD Product schema for SSR-augmented HTML — useful even though SPA;
  // we expose it so frontend can inject into <head>.
  app.get("/api/seo/product/:slug.jsonld", async (req, res) => {
    const product = await storage.getProductBySlug(req.params.slug);
    if (!product) return res.status(404).json({ error: "Not found" });
    let images: string[] = [];
    try { images = JSON.parse(product.imageUrls || "[]"); } catch {}
    const jsonld = {
      "@context": "https://schema.org/",
      "@type": "Product",
      name: product.name,
      image: images,
      description: product.description,
      sku: product.partNumber || `NM-${product.id}`,
      brand: { "@type": "Brand", name: product.brand.charAt(0).toUpperCase() + product.brand.slice(1) },
      offers: {
        "@type": "Offer",
        url: `https://${SITE_HOST}/#/products/${product.slug}`,
        priceCurrency: "INR",
        price: product.priceInr,
        availability: (product.stockQty || 0) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        seller: { "@type": "Organization", name: "Narmada Mobility" },
      },
    };
    res.setHeader("Content-Type", "application/ld+json");
    res.json(jsonld);
  });

  // IndexNow key file (must be served at site root in production via GoDaddy too)
  app.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => {
    res.type("text/plain").send(INDEXNOW_KEY);
  });

  // Trigger IndexNow + sitemap regen manually
  app.post("/api/admin/seo/ping", requireAdminRole, async (_req, res) => {
    triggerSitemapRegen(regenSitemap);
    await pingIndexNow();
    res.json({ ok: true, message: "Sitemap regen + IndexNow ping queued" });
  });

  console.log("[v2] Phase 3 routes registered: blogs, price lists, consignments, sub-users, SEO helpers");
}
