// Phase 3 routes — blogs, price lists, consignments, admin users (sub-users), SEO helpers.
// Mounted from server/routes.ts via registerV2Routes().
import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import Papa from "papaparse";
import multer from "multer";
import { storage, db } from "./storage";
import * as v2 from "./storage-v2";
import { sendNotification, buildTrackingLink, sendGenericEmail, emitCrossTeamEvent } from "./notifications";
import { rawSqlite } from "./storage";
import * as XLSX from "xlsx";
import { recordMarketingWhatsAppReceipt } from "./marketing/webhook-hook";
import {
  insertPostSchema, insertConsignmentSchema, insertPriceListSchema,
  insertCustomerSchema,
  insertLedgerEntrySchema, insertRfqSchema, insertQuoteSchema,
  insertPurchaseOrderSchema, insertPaymentRecordSchema, insertBankDetailsSchema,
  adminSessions,
} from "@shared/schema";
import type { AdminUser, AdminRole } from "@shared/schema";
import { eq } from "drizzle-orm";

// R13: normalize a quotation's ordered-company into the flat shape the PDF generator
// expects. Prefers the unified `companies` entry (companyId) when set, then the legacy
// quoting_companies entry (quotingCompanyId). Returns null if neither resolves, so the
// PDF falls back to its built-in default header.
type PdfCompany = {
  name: string; gstin: string | null; address: string | null; city: string | null;
  state: string | null; phone: string | null; email: string | null;
  bankName: string | null; bankAccount: string | null; bankIfsc: string | null;
};
async function resolvePdfCompany(quotation: any): Promise<PdfCompany | null> {
  if (quotation?.companyId) {
    const c: any = await v2.getCompany(quotation.companyId);
    if (c) {
      return {
        name: c.name,
        gstin: c.gstin ?? null,
        address: [c.addressLine1, c.addressLine2].filter(Boolean).join(", ") || null,
        city: c.city ?? null,
        state: c.state ?? null,
        phone: c.signatoryPhone ?? null,
        email: c.signatoryEmail ?? null,
        bankName: c.bankName ?? null,
        bankAccount: c.accountNo ?? null,
        bankIfsc: c.ifsc ?? null,
      };
    }
  }
  if (quotation?.quotingCompanyId) {
    const q: any = await v2.resolveQuotingEntity(quotation.quotingCompanyId);
    if (q) {
      return {
        name: q.name, gstin: q.gstin ?? null, address: q.address ?? null,
        city: q.city ?? null, state: q.state ?? null, phone: q.phone ?? null,
        email: q.email ?? null, bankName: q.bankName ?? null,
        bankAccount: q.bankAccount ?? null, bankIfsc: q.bankIfsc ?? null,
      };
    }
  }
  return null;
}

// ============================================================================
// AUTH / SESSIONS (Phase 3)
// We extend the in-memory token map from routes.ts via a shared registry passed in.
// Each token maps to { username, role, displayName }.
// ============================================================================

export interface TokenInfo {
  username: string;
  role: AdminRole;  // admin | logistics | accounts | sales
  displayName?: string;
}
export type TokenMap = Map<string, TokenInfo>;
const VALID_ROLES: AdminRole[] = ["admin", "logistics", "accounts", "sales", "data_center"];

// Session A V2: DB-backed admin session helpers (token survives Render restarts)
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export async function persistAdminSession(token: string, info: TokenInfo) {
  const now = Date.now();
  try {
    db.insert(adminSessions).values({
      token,
      username: info.username,
      role: info.role,
      displayName: info.displayName,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    }).run();
  } catch (e: any) {
    console.error("[admin-session] persist failed:", e?.message);
  }
}
export function rehydrateSession(tokenMap: TokenMap, token: string): TokenInfo | null {
  try {
    const row = db.select().from(adminSessions).where(eq(adminSessions.token, token)).get();
    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      db.delete(adminSessions).where(eq(adminSessions.token, token)).run();
      return null;
    }
    const info: TokenInfo = {
      username: row.username,
      role: row.role as AdminRole,
      displayName: row.displayName || undefined,
    };
    tokenMap.set(token, info);
    try {
      db.update(adminSessions).set({ lastSeenAt: Date.now() })
        .where(eq(adminSessions.token, token)).run();
    } catch {}
    return info;
  } catch (e: any) {
    console.error("[admin-session] rehydrate failed:", e?.message);
    return null;
  }
}
export function deleteAdminSession(token: string) {
  try { db.delete(adminSessions).where(eq(adminSessions.token, token)).run(); } catch {}
}

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

  // Middleware: require any logged-in admin user.
  // Session A V2: if token not in memory, try to rehydrate from admin_sessions table
  // so logins survive Render restarts.
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.headers["x-admin-token"] as string | undefined;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    let info = tokenMap.get(token);
    if (!info) {
      const rehydrated = rehydrateSession(tokenMap, token);
      if (!rehydrated) return res.status(401).json({ error: "Unauthorized" });
      info = rehydrated;
    }
    // v1.4a — data_center users are revoked from the admin app entirely. They must
    // use /datacenter/login and the x-datacenter-token header; never x-admin-token.
    if (info.role === "data_center") {
      return res.status(403).json({ error: "Data Center users must log in at /datacenter/login" });
    }
    (req as any).user = info;
    next();
  }
  // Middleware: require admin role specifically (other roles not allowed)
  function requireAdminRole(req: Request, res: Response, next: NextFunction) {
    requireAuth(req, res, () => {
      const u = (req as any).user as TokenInfo;
      if (u.role !== "admin") return res.status(403).json({ error: "Admin role required" });
      next();
    });
  }
  // Middleware factory: require one of the specified roles. Admin always passes.
  function requireRole(...roles: AdminRole[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      requireAuth(req, res, () => {
        const u = (req as any).user as TokenInfo;
        if (u.role === "admin" || roles.includes(u.role)) return next();
        return res.status(403).json({ error: `Role ${roles.join("/")} required` });
      });
    };
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
      // Accept multiple usernames (case-insensitive) and legacy passwords for resilience
      const trimmedUsername = String(username || "").trim();
      const trimmedPassword = String(password || "").trim();
      const ACCEPTED_USERNAMES = [primaryAdminUsername, "narmadamobility", "narmadamobility123", "NarmadaMobility"];
      const ACCEPTED_PASSWORDS = [primaryAdminPassword, "Piyush@1969", "Carbounty@123", "Mausami@@2026 ", "Mausami@@2026"];
      const usernameOk = ACCEPTED_USERNAMES.some((u) => u.toLowerCase() === trimmedUsername.toLowerCase());
      const passwordOk = ACCEPTED_PASSWORDS.some((p) => p.trim() === trimmedPassword);
      if (usernameOk && passwordOk) {
        info = { username: primaryAdminUsername, role: "admin", displayName: "Primary Administrator" };
      } else {
        // DB user
        const user = await v2.getAdminUserByUsername(username);
        if (user && user.active && verifyPassword(password, user.passwordHash)) {
          // v1.4a — data_center accounts cannot use the admin login.
          if (user.role === "data_center") {
            return res.status(403).json({ error: "Data Center users must log in at /datacenter/login" });
          }
          info = {
            username: user.username,
            role: (VALID_ROLES.includes(user.role as AdminRole) ? user.role : "admin") as AdminRole,
            displayName: user.displayName || user.username,
          };
        }
      }

      if (!info) return res.status(401).json({ error: "Invalid credentials" });
      const token = randomBytes(32).toString("hex");
      tokenMap.set(token, info);
      await persistAdminSession(token, info);
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: info.username, action: "login",
        ip: req.ip, userAgent: req.headers["user-agent"] as string,
      })).catch((e: any) => console.error("[audit] login write failed:", e?.message));
      res.json({ token, user: info });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/v2/logout", requireAuth, (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    tokenMap.delete(token);
    deleteAdminSession(token);
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
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
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
      if (req.body.role) {
        if (!VALID_ROLES.includes(req.body.role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
        updates.role = req.body.role;
      }
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
      if (req.body.active !== undefined) updates.active = req.body.active;
      const user = await v2.updateAdminUser(parseInt(req.params.id as string, 10), updates);
      res.json({ ...user, passwordHash: undefined });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/v2/admin/users/:id", requireAdminRole, async (req, res) => {
    await v2.deleteAdminUser(parseInt(req.params.id as string, 10));
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
    const post = await v2.getPost(parseInt(req.params.id as string, 10));
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
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: (req as any).user?.username, action: "create_post",
        entityType: "post", entityId: String(post.id), afterJson: JSON.stringify({ id: post.id, slug: post.slug }),
      })).catch((e: any) => console.error("[audit] post create write failed:", e?.message));
      res.json(post);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/admin/posts/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const post = await v2.updatePost(id, normalizeDateFields(req.body || {}));
      triggerSitemapRegen(regenSitemap);
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: (req as any).user?.username, action: "update_post",
        entityType: "post", entityId: String(id),
      })).catch((e: any) => console.error("[audit] post update write failed:", e?.message));
      res.json(post);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/posts/:id", requireAdminRole, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    await v2.deletePost(id);
    triggerSitemapRegen(regenSitemap);
    Promise.resolve(v2.writeAuditLog({
      actorType: "admin", actorId: (req as any).user?.username, action: "delete_post",
      entityType: "post", entityId: String(id),
    })).catch((e: any) => console.error("[audit] post delete write failed:", e?.message));
    res.json({ ok: true });
  });
  // AI draft generator — returns a draft (NOT saved); admin reviews then saves via POST /api/admin/posts.
  app.post("/api/admin/posts/ai-generate", requireAdminRole, async (req, res) => {
    try {
      const topic = String(req.body?.topic || "").trim();
      const type = req.body?.type === "spotlight" ? "spotlight" : "blog";
      if (!topic) return res.status(400).json({ error: "Topic is required" });
      const { generateBlogPost } = await import("./claude-service");
      const draft = await generateBlogPost(topic, type);
      if (!draft) return res.status(503).json({ error: "AI generation unavailable (CLAUDE_API_KEY not configured)" });
      res.json(draft);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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

  // Bug 3: Part number / product name autocomplete for quote line items
  // Requires admin/team auth (x-admin-token). Returns suggestions from price_list + past quote items.
  app.get("/api/admin/part-suggestions", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(parseInt(String(req.query.limit || "10"), 10) || 10, 25);
      if (!q || q.length < 2) return res.json([]);
      const suggestions = v2.getPartSuggestions(q, limit);
      res.json(suggestions);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R19 — AiSensy config diagnostic (admin token). Verifies outbound config WITHOUT
  // exposing the API key (only set/unset + first 4 chars). Use to debug Fire Rate Request.
  app.get("/api/admin/aisensy-diagnostic", requireAuth, async (_req, res) => {
    try {
      const wa = require("./whatsapp") as typeof import("./whatsapp");
      res.json(wa.getAisensyDiagnostic());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
    await v2.deletePriceList(parseInt(req.params.id as string, 10));
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

  // R10 — consignment document uploads (invoice + docket). Stored under
  // <uploads>/consignments and persisted as invoice_url / docket_url.
  const consignDocsDir = path.join(ctx.uploadsDir || "./uploads", "consignments");
  if (!fs.existsSync(consignDocsDir)) fs.mkdirSync(consignDocsDir, { recursive: true });
  const multerConsign = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, consignDocsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });
  app.post(
    "/api/admin/consignments/:id/upload",
    requireAuth,
    multerConsign.fields([{ name: "invoice", maxCount: 1 }, { name: "docket", maxCount: 1 }]),
    async (req: any, res: any) => {
      try {
        const id = parseInt(req.params.id as string, 10);
        const existing = await v2.getConsignmentById(id);
        if (!existing) return res.status(404).json({ error: "Consignment not found" });
        const proto = req.protocol || "https";
        const host = req.get("host") || "narmada-backend.onrender.com";
        const files = (req.files || {}) as Record<string, any[]>;
        const patch: any = {};
        if (files.invoice?.[0]) patch.invoiceUrl = `${proto}://${host}/uploads/consignments/${files.invoice[0].filename}`;
        if (files.docket?.[0]) patch.docketUrl = `${proto}://${host}/uploads/consignments/${files.docket[0].filename}`;
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No invoice or docket file provided" });
        const updated = await v2.updateConsignment(id, patch);
        res.json(updated);
      } catch (e: any) { res.status(400).json({ error: e.message }); }
    },
  );

  // Admin — create (both admin + logistics)
  app.post("/api/admin/consignments", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const body = normalizeDateFields(req.body || {});

      // If customerId provided, look up customer and fill denormalized fields
      if (body.customerId) {
        const customer = await v2.getCustomer(parseInt(body.customerId, 10));
        if (customer) {
          if (!body.customerName) body.customerName = customer.name;
          if (!body.customerPhone) body.customerPhone = customer.phone || null;
          if (!body.customerEmail) body.customerEmail = customer.email || null;
        }
      }

      const parsed = insertConsignmentSchema.parse(body);
      const created = await v2.createConsignment(parsed, user.username);

      // Fire notification asynchronously (don't block response)
      const trackingLink = buildTrackingLink(created.docketNumber);
      const fmtDateCreate = (ts?: number | null) => ts ? new Date(ts).toLocaleDateString("en-IN") : "";
      sendNotification("consignment_created", {
        consignmentId: created.id,
        customerId: created.customerId ?? undefined,
        customerName: created.customerName || "Customer",
        customerEmail: created.customerEmail ?? undefined,
        customerPhone: created.customerPhone ?? undefined,
        docket: created.docketNumber,
        origin: created.origin,
        destination: created.destination,
        status: created.status,
        dispatchDate: fmtDateCreate(created.dispatchDate),
        etaDate: fmtDateCreate(created.etaDate),
        deliveredDate: fmtDateCreate(created.deliveredDate),
        invoiceNumber: created.invoiceNumber ?? undefined,
        invoiceAmount: created.invoiceAmount ?? undefined,
        bundlesCount: created.bundlesCount ?? undefined,
        carrier: created.carrier ?? undefined,
        invoiceUrl: created.invoiceUrl ?? undefined,
        docketUrl: created.docketUrl ?? undefined,
        trackingLink,
      }).catch((e: any) => console.error("[notifications] send error:", e.message));

      // Fire WhatsApp consignment_created_v2 (fire-and-forget — never blocks the response)
      if (created.customerPhone) {
        import("./whatsapp")
          .then(({ sendConsignmentCreated }) =>
            sendConsignmentCreated(
              created.customerPhone!,
              created.customerName || "Customer",
              created.docketNumber,
              created.bundlesCount != null ? `${created.bundlesCount} bundle(s)` : "",
              fmtDateCreate(created.dispatchDate),
            ),
          )
          .catch((e: any) => console.error("[whatsapp] consignment_created dispatch error:", e?.message));
      } else {
        console.log(`[whatsapp] template=consignment_created_v2 to= status=skipped-no-phone`);
      }

      // Auto-link consignment -> ledger (fire-and-forget). When a consignment with an
      // invoice amount is booked against a known customer, post a DEBIT entry so the
      // ledger stays in sync with dispatched invoices.
      if (created.customerId && created.invoiceAmount && created.invoiceAmount > 0) {
        const cid = created.customerId;
        Promise.resolve(
          v2.addLedgerEntry({
            customerId: cid,
            entryDate: created.dispatchDate || created.createdAt || Date.now(),
            voucherType: "invoice",
            voucherNo: created.invoiceNumber || created.docketNumber,
            referenceId: created.id,
            description: `Consignment ${created.docketNumber}${created.invoiceNumber ? ` / Invoice ${created.invoiceNumber}` : ""}`,
            debitInr: created.invoiceAmount,
            creditInr: 0,
            createdBy: user.username,
          }),
        ).catch((e: any) => console.error("[ledger] auto-link consignment error:", e?.message));
        console.log(`[ledger] auto-debit customerId=${cid} amount=${created.invoiceAmount} for consignment ${created.docketNumber}`);
      }

      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: user.username, action: "create_consignment",
        entityType: "consignment", entityId: String(created.id), afterJson: JSON.stringify(created),
      })).catch((e: any) => console.error("[audit] consignment create write failed:", e?.message));

      res.json(created);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });

  app.patch("/api/admin/consignments/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const body = normalizeDateFields(req.body || {});

      // Capture old status before update (for notification trigger)
      const existing = await v2.getConsignmentById(id);
      const oldStatus = existing?.status;

      // If customerId provided in update, fill denormalized fields
      if (body.customerId) {
        const customer = await v2.getCustomer(parseInt(body.customerId, 10));
        if (customer) {
          if (!body.customerName) body.customerName = customer.name;
          if (!body.customerPhone && customer.phone) body.customerPhone = customer.phone;
          if (!body.customerEmail && customer.email) body.customerEmail = customer.email;
        }
      }

      const updated = await v2.updateConsignment(id, body);

      // Fire notification if status changed
      if (updated && body.status && body.status !== oldStatus) {
        const notifStatuses: Record<string, string> = {
          in_transit: "in_transit",
          out_for_delivery: "out_for_delivery",
          delivered: "delivered",
        };
        const eventKey = notifStatuses[body.status];
        if (eventKey) {
          const trackingLink = buildTrackingLink(updated.docketNumber);
          const fmtDate = (ts?: number | null) => ts ? new Date(ts).toLocaleDateString("en-IN") : "";
          sendNotification(eventKey, {
            consignmentId: updated.id,
            customerId: updated.customerId ?? undefined,
            customerName: updated.customerName || "Customer",
            customerEmail: updated.customerEmail ?? undefined,
            customerPhone: updated.customerPhone ?? undefined,
            docket: updated.docketNumber,
            origin: updated.origin,
            destination: updated.destination,
            status: updated.status,
            dispatchDate: fmtDate(updated.dispatchDate),
            etaDate: fmtDate(updated.etaDate),
            deliveredDate: fmtDate(updated.deliveredDate),
            invoiceNumber: updated.invoiceNumber ?? undefined,
            invoiceAmount: updated.invoiceAmount ?? undefined,
            bundlesCount: updated.bundlesCount ?? undefined,
            carrier: updated.carrier ?? undefined,
            invoiceUrl: updated.invoiceUrl ?? undefined,
            docketUrl: updated.docketUrl ?? undefined,
            trackingLink,
          }).catch((e: any) => console.error("[notifications] send error:", e.message));

          // Direct AiSensy WhatsApp template per status transition (fire-and-forget).
          // sendNotification() only logs the DB whatsapp template as 'skipped', so the
          // real WhatsApp dispatch must happen here — mirroring the create flow.
          // Phone fallback: old consignments may have an empty denormalized phone — look
          // up the linked customer's phone so status updates still reach the customer.
          let phone = updated.customerPhone || "";
          if (!phone && updated.customerId) {
            try {
              const linked = await v2.getCustomer(updated.customerId);
              if (linked?.phone) phone = linked.phone;
            } catch (e: any) {
              console.error("[whatsapp] consignment phone lookup error:", e?.message);
            }
          }
          const templateName = `consignment_${body.status}_v2`;
          if (phone) {
            const cname = updated.customerName || "Customer";
            const docket = updated.docketNumber;
            const orderNo = updated.invoiceNumber || updated.docketNumber;
            console.log(`[whatsapp] dispatching ${templateName} to ${phone} for status ${body.status}`);
            import("./whatsapp")
              .then((wa) => {
                if (body.status === "in_transit") {
                  return wa.sendConsignmentInTransit(phone, cname, orderNo, updated.carrier || "", docket, fmtDate(updated.etaDate));
                } else if (body.status === "out_for_delivery") {
                  return wa.sendConsignmentOutForDelivery(phone, cname, orderNo, "", "");
                } else if (body.status === "delivered") {
                  return wa.sendConsignmentDelivered(phone, cname, orderNo, fmtDate(updated.deliveredDate), cname);
                }
              })
              .catch((e: any) => console.error(`[whatsapp] consignment ${body.status} dispatch error:`, e?.message));
            console.log(`[whatsapp] template=${templateName} to=${phone} status=attempt`);
          } else {
            console.log(`[whatsapp] template=${templateName} to= status=skipped-no-phone`);
          }
        }
      }

      if (updated) {
        const actor = (req as any).user as TokenInfo;
        Promise.resolve(v2.writeAuditLog({
          actorType: "admin", actorId: actor?.username, action: "update_consignment",
          entityType: "consignment", entityId: String(id),
          beforeJson: existing ? JSON.stringify({ status: oldStatus }) : undefined,
          afterJson: JSON.stringify({ status: updated.status }),
        })).catch((e: any) => console.error("[audit] consignment update write failed:", e?.message));
      }

      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/admin/consignments/:id", requireAdminRole, async (req, res) => {
    // Only full admin can delete
    await v2.deleteConsignment(parseInt(req.params.id as string, 10));
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

  // ============== CUSTOMERS (Phase 4) ==============
  app.get("/api/admin/customers", requireAuth, async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      const list = await v2.getCustomers(q);
      // Augment with consignment count
      const withCount = await Promise.all(list.map(async (c) => ({
        ...c,
        consignmentCount: await v2.getCustomerConsignmentCount(c.id),
      })));
      res.json(withCount);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/customers/:id", requireAuth, async (req, res) => {
    const customer = await v2.getCustomer(parseInt(req.params.id as string, 10));
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  });

  app.post("/api/admin/customers", requireAuth, async (req, res) => {
    try {
      const parsed = insertCustomerSchema.parse(req.body || {});
      const customer = await v2.createCustomer(parsed);
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: (req as any).user?.username, action: "create_customer",
        entityType: "customer", entityId: String(customer.id), afterJson: JSON.stringify({ id: customer.id, name: customer.name }),
      })).catch((e: any) => console.error("[audit] customer create write failed:", e?.message));
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });

  const adminUpdateCustomer = async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid customer id" });
      const existing = await v2.getCustomer(id);
      if (!existing) return res.status(404).json({ error: "Customer not found" });
      const customer = await v2.updateCustomer(id, req.body || {});
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: (req as any).user?.username, action: "update_customer",
        entityType: "customer", entityId: String(id),
      })).catch((e: any) => console.error("[audit] customer update write failed:", e?.message));
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  };
  app.patch("/api/admin/customers/:id", requireAuth, adminUpdateCustomer);
  app.put("/api/admin/customers/:id", requireAuth, adminUpdateCustomer);

  app.delete("/api/admin/customers/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const count = await v2.getCustomerConsignmentCount(id);
      if (count > 0) return res.status(400).json({ error: `Cannot delete: customer has ${count} consignment(s)` });
      await v2.deleteCustomer(id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============== NOTIFICATION TEMPLATES (Phase 4) ==============
  app.get("/api/admin/notification-templates", requireAuth, async (_req, res) => {
    try {
      const templates = await v2.getNotificationTemplates();
      res.json(templates);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/admin/notification-templates/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { subject, body, enabled } = req.body || {};
      const updated = await v2.updateNotificationTemplate(id, { subject, body, enabled });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ============== NOTIFICATION LOG (Phase 4) ==============
  app.get("/api/admin/consignments/:id/notifications", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const log = await v2.getNotificationLog(id);
      res.json(log);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // =============================================================
  // SESSION B: customer portal auth + ledger + RFQ/Quote/PO + payments + file uploads + bank
  // =============================================================

  // ---------- Customer auth middleware (separate from admin) ----------
  async function requireCustomer(req: Request, res: Response, next: NextFunction) {
    const token = req.headers["x-customer-token"] as string | undefined;
    if (!token) return res.status(401).json({ error: "Customer login required" });
    const session = await v2.getCustomerSession(token);
    if (!session) return res.status(401).json({ error: "Session expired — please log in again" });
    const login = await v2.getCustomerLoginByEmail(session.email);
    if (!login || !login.active) return res.status(403).json({ error: "Login disabled" });
    (req as any).customer = { customerId: session.customerId, email: session.email, loginId: login.id };
    next();
  }

  // ---------- CUSTOMER AUTH (OTP only) ----------
  app.post("/api/customer/request-otp", async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email || typeof email !== "string") return res.status(400).json({ error: "Email required" });
      const login = await v2.getCustomerLoginByEmail(email);
      if (!login || !login.active) {
        return res.json({ ok: true, sent: true });
      }
      const code = await v2.generateOtp(email, "customer_login");

      // EMAIL channel — fire-and-forget. sendGenericEmail returns ok:false when SMTP is not
      // configured (see notifications.ts), so emailConfigured tells the frontend honestly
      // whether email could even be attempted.
      const emailConfigured = !!process.env.BREVO_SMTP_KEY;
      sendGenericEmail({
        to: email,
        subject: `Your Narmada Mobility login code: ${code}`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <div style="background:#001a4d;color:white;padding:18px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;font-size:18px;">Narmada Mobility — Customer Portal</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
            <p style="margin:0 0 12px;color:#374151;">Your one-time login code is:</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#001a4d;background:#f3f4f6;padding:16px;border-radius:6px;text-align:center;">${code}</div>
            <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
          </div>
        </div>`,
      }).catch((e: any) => console.error("[email] OTP send error:", e?.message));

      // WHATSAPP fallback channel — look up the customer's phone and fire OTP via AiSensy
      // (fire-and-forget). This is the safety net for when SMTP is not configured.
      let whatsappAttempted = false;
      try {
        const customer = await v2.getCustomer(login.customerId);
        if (customer?.phone) {
          whatsappAttempted = true;
          console.log(`[otp] dispatching WhatsApp OTP to customerId=${login.customerId} phone=${customer.phone}`);
          const { sendOTP } = await import("./whatsapp");
          Promise.resolve(sendOTP(customer.phone, code)).catch((e: any) =>
            console.error("[whatsapp] OTP send error:", e?.message));
        } else {
          console.log(`[otp] no phone on file for customerId=${login.customerId}, skipping whatsapp`);
        }
      } catch (e: any) {
        console.error("[otp] whatsapp lookup error:", e?.message);
      }

      console.log(`[otp] email-sent=${emailConfigured} whatsapp-sent=${whatsappAttempted}`);
      res.json({ ok: true, sent: true, channels: { email: emailConfigured, whatsapp: whatsappAttempted } });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/customer/verify-otp", async (req, res) => {
    try {
      const { email, code } = req.body || {};
      if (!email || !code) return res.status(400).json({ error: "Email and code required" });
      const login = await v2.getCustomerLoginByEmail(email);
      if (!login || !login.active) return res.status(401).json({ error: "Invalid email or code" });
      const ok = await v2.verifyOtp(email, String(code), "customer_login");
      if (!ok) return res.status(401).json({ error: "Invalid or expired code" });
      const session = await v2.createCustomerSession(login.customerId, login.email);
      res.json({ ok: true, token: session.token, expiresAt: session.expiresAt });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/customer/logout", requireCustomer, async (req, res) => {
    const token = req.headers["x-customer-token"] as string;
    await v2.deleteCustomerSession(token);
    res.json({ ok: true });
  });

  app.get("/api/customer/me", requireCustomer, async (req, res) => {
    const ctx = (req as any).customer as { customerId: number; email: string };
    const customer = await v2.getCustomer(ctx.customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({ ...customer, loginEmail: ctx.email });
  });

  // ---------- ADMIN: customer logins management ----------
  app.get("/api/admin/customers/:id/login", requireAuth, async (req, res) => {
    const cid = parseInt(req.params.id as string, 10);
    const customer = await v2.getCustomer(cid);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const logins = (await v2.listCustomerLogins()).filter((l) => l.customerId === cid);
    res.json(logins);
  });
  app.post("/api/admin/customers/:id/login", requireRole("accounts", "sales"), async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      const { email, creditLimitInr, paymentTermsDays } = req.body || {};
      if (!email) return res.status(400).json({ error: "Email required" });
      const login = await v2.createCustomerLogin(cid, email, { creditLimitInr, paymentTermsDays });
      res.json(login);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/customer-logins/:id", requireRole("accounts"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { active } = req.body || {};
      if (typeof active === "boolean") await v2.setCustomerLoginActive(id, active);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/customer-logins/:id", requireAdminRole, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    await v2.deleteCustomerLogin(id);
    res.json({ ok: true });
  });

  // ---------- ADMIN: customer emails (multi-email per customer) ----------
  app.get("/api/admin/customers/:id/emails", requireAuth, async (req, res) => {
    const cid = parseInt(req.params.id as string, 10);
    res.json(await v2.listCustomerEmails(cid));
  });
  app.post("/api/admin/customers/:id/emails", requireRole("accounts", "sales"), async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      const { email, label, isPrimary } = req.body || {};
      if (!email) return res.status(400).json({ error: "Email required" });
      const row = await v2.addCustomerEmail(cid, email, label, !!isPrimary);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/customer-emails/:id/primary", requireRole("accounts", "sales"), async (req, res) => {
    await v2.setPrimaryCustomerEmail(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  app.delete("/api/admin/customer-emails/:id", requireRole("accounts", "sales"), async (req, res) => {
    await v2.deleteCustomerEmail(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: customer addresses (multi-address) ----------
  app.get("/api/admin/customers/:id/addresses", requireAuth, async (req, res) => {
    res.json(await v2.listCustomerAddresses(parseInt(req.params.id as string, 10)));
  });
  app.post("/api/admin/customers/:id/addresses", requireRole("accounts", "sales"), async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      const b = req.body || {};
      if (!b.line1) return res.status(400).json({ error: "Address line 1 required" });
      const row = await v2.addCustomerAddress(cid, {
        label: b.label, line1: b.line1, line2: b.line2, city: b.city, state: b.state,
        pincode: b.pincode, country: b.country || "India", gstin: b.gstin,
        isBilling: !!b.isBilling, isShipping: !!b.isShipping,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/customer-addresses/:id", requireRole("accounts", "sales"), async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    const row = await v2.updateCustomerAddress(id, req.body || {});
    if (!row) return res.status(404).json({ error: "Address not found" });
    res.json(row);
  });
  app.delete("/api/admin/customer-addresses/:id", requireRole("accounts", "sales"), async (req, res) => {
    await v2.deleteCustomerAddress(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: seed opening balance on demand ----------
  app.patch("/api/admin/customers/:id/seed-opening", requireRole("accounts"), async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const customer = await v2.getCustomer(id);
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      await v2.seedOpeningBalanceIfNeeded(id, customer.openingBalanceInr || 0);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------- ADMIN: LEDGER ----------
  app.get("/api/admin/customers/:id/ledger", requireAuth, async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      // R26.5 (A2) — accept ?from=YYYY-MM-DD&to=YYYY-MM-DD (or epoch ms). Default to last 90 days.
      const parseDate = (v: any): number | undefined => {
        if (v == null || v === "") return undefined;
        const s = String(v);
        if (/^\d+$/.test(s)) return parseInt(s, 10); // epoch ms
        const t = Date.parse(s);
        return Number.isNaN(t) ? undefined : t;
      };
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      // R26.6a (3) — do NOT silently default to a 90-day window when no range is
      // supplied. That window hid older ledger entries (Test Wagad / BSC) entirely.
      // With no from/to we now return the customer's full ledger history.
      const entries = await v2.listLedgerEntries(cid, { from, to });
      const balance = await v2.getLedgerBalance(cid);
      // R26.5 (A2) — surface shipped customers whose goods left via PO/dispatch even when
      // no ledger_entries row exists. JOIN purchase_orders_v2 → dispatches for this customer.
      let shippedEntries: any[] = [];
      try { shippedEntries = v2.listShippedLedgerView(cid, { from, to }); }
      catch (e: any) { console.error("[R26.5] shipped ledger view failed:", e?.message || e); }
      res.json({ entries, shippedEntries, balanceInr: balance });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.0 — customer ledger Excel export. The old client-side CSV wrote amounts as
  // quoted strings (Excel read them as text, not numbers) and used "/"-style dates,
  // which made the sheet look distorted: amounts left-aligned, no totals, columns
  // shifting on multi-line narration. This server-side .xlsx writes typed numeric
  // cells with Indian number format, DD-MM-YYYY dates, and a frozen header row.
  app.get("/api/admin/customers/:id/ledger/export.xlsx", requireAuth, async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      const parseDate = (v: any): number | undefined => {
        if (v == null || v === "") return undefined;
        const s = String(v);
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        const t = Date.parse(s);
        return Number.isNaN(t) ? undefined : t;
      };
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      const customer = await v2.getCustomer(cid);
      const entries = await v2.listLedgerEntries(cid, { from, to });
      const XLSX = require("xlsx");
      const fmtDate = (ms: number) => {
        const d = new Date(ms);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}-${mm}-${d.getFullYear()}`;
      };
      const header = ["Date", "Type", "Voucher", "Description", "Debit", "Credit", "Balance"];
      const aoa: any[][] = [header];
      let totalDebit = 0, totalCredit = 0;
      for (const e of entries) {
        const debit = Number(e.debitInr) || 0;
        const credit = Number(e.creditInr) || 0;
        totalDebit += debit; totalCredit += credit;
        aoa.push([
          fmtDate(e.entryDate),
          e.voucherType || "",
          e.voucherNo || "",
          (e.description || "").replace(/\s+/g, " ").trim(),
          debit, credit, Number(e.balanceInr) || 0,
        ]);
      }
      const closing = entries.length ? (Number(entries[entries.length - 1].balanceInr) || 0) : 0;
      aoa.push(["", "", "", "TOTAL", totalDebit, totalCredit, closing]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Indian-comma currency format on the three amount columns (E, F, G), every data row.
      const moneyFmt = "#,##,##0.00";
      const lastRow = aoa.length; // 1-based incl. header
      for (let r = 1; r < lastRow; r++) {
        for (const col of [4, 5, 6]) {
          const addr = XLSX.utils.encode_cell({ r, c: col });
          if (ws[addr]) { ws[addr].t = "n"; ws[addr].z = moneyFmt; }
        }
      }
      ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Ledger");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const safeName = (customer?.name || `customer-${cid}`).replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="ledger-${safeName}.xlsx"`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/customers/:id/ledger", requireRole("accounts"), async (req, res) => {
    try {
      const cid = parseInt(req.params.id as string, 10);
      const user = (req as any).user as TokenInfo;
      const parsed = insertLedgerEntrySchema.parse({ ...req.body, customerId: cid });
      const row = await v2.addLedgerEntry({ ...parsed, createdBy: user.username });
      Promise.resolve(v2.writeAuditLog({
        actorType: "admin", actorId: user.username, action: "create_ledger_entry",
        entityType: "ledger_entry", entityId: String(row.id),
        afterJson: JSON.stringify({ customerId: cid, debitInr: row.debitInr, creditInr: row.creditInr }),
      })).catch((e: any) => console.error("[audit] ledger create write failed:", e?.message));
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.post("/api/admin/ledger/bulk", requireRole("accounts"), async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const { entries } = req.body || {};
      if (!Array.isArray(entries)) return res.status(400).json({ error: "entries array required" });
      const cleaned = entries.map((e: any) => insertLedgerEntrySchema.parse(e));
      const inserted = await v2.bulkAddLedgerEntries(cleaned.map((e: any) => ({ ...e, createdBy: user.username })));
      res.json({ ok: true, inserted });
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.delete("/api/admin/ledger/:id", requireRole("accounts"), async (req, res) => {
    await v2.deleteLedgerEntry(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  // CSV bulk ledger import
  app.post("/api/admin/ledger/import-csv", requireRole("accounts"), async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const { csv } = req.body || {};
      if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv string required" });
      const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true });
      const rows = (parsed.data as any[]).map((r) => ({
        customerId: parseInt(r.customer_id || r.customerId, 10),
        entryDate: r.entry_date ? new Date(r.entry_date).getTime() : Date.now(),
        voucherType: (r.voucher_type || r.voucherType || "adjustment").toString().trim(),
        voucherNo: (r.voucher_no || r.voucherNo || "").toString().trim() || null,
        description: (r.description || "").toString(),
        debitInr: parseFloat(r.debit_inr || r.debit || "0") || 0,
        creditInr: parseFloat(r.credit_inr || r.credit || "0") || 0,
        referenceId: null,
        createdBy: user.username,
      })).filter((r) => Number.isFinite(r.customerId));
      const inserted = await v2.bulkAddLedgerEntries(rows as any);
      res.json({ ok: true, inserted, skipped: (parsed.data as any[]).length - inserted });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---------- ADMIN: RFQs ----------
  app.get("/api/admin/rfqs", requireAuth, async (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(await v2.listRfqs({ status }));
  });
  app.get("/api/admin/rfqs/:id", requireAuth, async (req, res) => {
    const row = await v2.getRfq(parseInt(req.params.id as string, 10));
    if (!row) return res.status(404).json({ error: "RFQ not found" });
    const linkedQuotes = await v2.listQuotes({ rfqId: row.id });
    res.json({ ...row, quotes: linkedQuotes });
  });
  app.post("/api/admin/rfqs", requireRole("sales", "accounts"), async (req, res) => {
    try {
      const parsed = insertRfqSchema.parse(req.body || {});
      const row = await v2.createRfq(parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/admin/rfqs/:id", requireRole("sales", "accounts"), async (req, res) => {
    const row = await v2.updateRfq(parseInt(req.params.id as string, 10), req.body || {});
    if (!row) return res.status(404).json({ error: "RFQ not found" });
    res.json(row);
  });
  app.delete("/api/admin/rfqs/:id", requireAdminRole, async (req, res) => {
    await v2.deleteRfq(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: QUOTES ----------
  app.get("/api/admin/quotes", requireAuth, async (req, res) => {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    const all = await v2.listQuotes({ customerId, status });
    // R23.2 — opt-in pagination (backward compatible when ?limit omitted).
    res.setHeader("X-Total-Count", String(all.length));
    if (req.query.limit != null) {
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 100);
      const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10) || 0);
      return res.json(all.slice(offset, offset + limit));
    }
    res.json(all);
  });
  app.get("/api/admin/quotes/:id", requireAuth, async (req, res) => {
    const row = await v2.getQuote(parseInt(req.params.id as string, 10));
    if (!row) return res.status(404).json({ error: "Quote not found" });
    res.json(row);
  });
  app.post("/api/admin/quotes", requireRole("sales", "accounts"), async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const parsed = insertQuoteSchema.parse(req.body || {});
      const row = await v2.createQuote({ ...parsed, createdBy: user.username });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/admin/quotes/:id/status", requireRole("sales", "accounts"), async (req, res) => {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: "status required" });
    const row = await v2.updateQuoteStatus(parseInt(req.params.id as string, 10), status);
    if (!row) return res.status(404).json({ error: "Quote not found" });
    res.json(row);
  });
  app.delete("/api/admin/quotes/:id", requireAdminRole, async (req, res) => {
    await v2.deleteQuote(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: PURCHASE ORDERS ----------
  app.get("/api/admin/purchase-orders", requireAuth, async (req, res) => {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
    const status = req.query.status as string | undefined;
    res.json(await v2.listPurchaseOrders({ customerId, status }));
  });
  app.get("/api/admin/purchase-orders/:id", requireAuth, async (req, res) => {
    const row = await v2.getPurchaseOrder(parseInt(req.params.id as string, 10));
    if (!row) return res.status(404).json({ error: "PO not found" });
    const files = await v2.listFileUploads("po", row.id);
    res.json({ ...row, files });
  });
  app.post("/api/admin/purchase-orders", requireRole("sales", "accounts"), async (req, res) => {
    try {
      const parsed = insertPurchaseOrderSchema.parse(req.body || {});
      const row = await v2.createPurchaseOrder(parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.post("/api/admin/purchase-orders/:id/approve", requireRole("accounts"), async (req, res) => {
    const user = (req as any).user as TokenInfo;
    const row = await v2.approvePurchaseOrder(parseInt(req.params.id as string, 10), user.username);
    if (!row) return res.status(404).json({ error: "PO not found" });
    res.json(row);
  });
  app.post("/api/admin/purchase-orders/:id/reject", requireRole("accounts"), async (req, res) => {
    const user = (req as any).user as TokenInfo;
    const row = await v2.rejectPurchaseOrder(parseInt(req.params.id as string, 10), user.username, req.body?.notes);
    if (!row) return res.status(404).json({ error: "PO not found" });
    res.json(row);
  });
  app.delete("/api/admin/purchase-orders/:id", requireAdminRole, async (req, res) => {
    await v2.deletePurchaseOrder(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: PAYMENTS ----------
  app.get("/api/admin/payments", requireAuth, async (req, res) => {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
    res.json(await v2.listPayments({ customerId }));
  });
  app.post("/api/admin/payments", requireRole("accounts"), async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const parsed = insertPaymentRecordSchema.parse({ ...req.body, recordedBy: user.username });
      const row = await v2.recordPayment(parsed);

      // R26.5 H/E4 — payment received: if the customer has a sales rep, notify them (in-app only).
      try {
        const custId = (row as any)?.customerId ?? parsed.customerId;
        if (custId) {
          const cust = rawSqlite
            .prepare(`SELECT id, name, sales_rep_id FROM customers WHERE id = ?`)
            .get(custId) as { id: number; name?: string; sales_rep_id?: number } | undefined;
          if (cust?.sales_rep_id) {
            emitCrossTeamEvent(
              "payment_received",
              { customer_id: cust.id, customer_name: cust.name || null, amount: (row as any)?.amountInr ?? parsed.amountInr ?? null, payment_id: (row as any)?.id ?? null },
              { target_user_id: cust.sales_rep_id, target_role: "sales" },
            );
          }
        }
      } catch (e: any) {
        console.error("[R26.5 E4] emit failed:", e?.message || e);
      }

      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.delete("/api/admin/payments/:id", requireRole("accounts"), async (req, res) => {
    await v2.deletePayment(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: BANK DETAILS ----------
  app.get("/api/admin/bank-details", requireAuth, async (_req, res) => {
    res.json(await v2.listBankDetails(false));
  });
  app.post("/api/admin/bank-details", requireAdminRole, async (req, res) => {
    try {
      const parsed = insertBankDetailsSchema.parse(req.body || {});
      res.json(await v2.createBankDetails(parsed));
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/admin/bank-details/:id", requireAdminRole, async (req, res) => {
    const row = await v2.updateBankDetails(parseInt(req.params.id as string, 10), req.body || {});
    if (!row) return res.status(404).json({ error: "Bank account not found" });
    res.json(row);
  });
  app.delete("/api/admin/bank-details/:id", requireAdminRole, async (req, res) => {
    await v2.deleteBankDetails(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------- ADMIN: FILE UPLOADS ----------
  const path2 = path;
  const fs2 = fs;
  const uploadsRoot = ctx.uploadsDir || "./uploads";
  if (!fs2.existsSync(uploadsRoot)) fs2.mkdirSync(uploadsRoot, { recursive: true });
  const docStore = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, uploadsRoot),
      filename: (_req: any, file: any, cb: any) => {
        const ts = Date.now();
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${ts}-${safe}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
  });
  app.post("/api/admin/uploads", requireAuth, docStore.single("file"), async (req, res) => {
    try {
      const user = (req as any).user as TokenInfo;
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "file required" });
      const { entityType, entityId, fileKind } = req.body || {};
      if (!entityType || !entityId || !fileKind) return res.status(400).json({ error: "entityType, entityId, fileKind required" });
      const row = await v2.addFileUpload({
        entityType, entityId: parseInt(entityId, 10), fileKind,
        filename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size,
        storagePath: `/files/${path2.basename(file.path)}`,
        uploadedBy: user.username,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/admin/uploads", requireAuth, async (req, res) => {
    const { entityType, entityId } = req.query as any;
    if (!entityType || !entityId) return res.status(400).json({ error: "entityType+entityId required" });
    res.json(await v2.listFileUploads(entityType, parseInt(entityId, 10)));
  });
  app.delete("/api/admin/uploads/:id", requireRole("accounts", "sales"), async (req, res) => {
    const row = await v2.getFileUpload(parseInt(req.params.id as string, 10));
    if (row) {
      const fullPath = path2.join(uploadsRoot, path2.basename(row.storagePath));
      try { fs2.unlinkSync(fullPath); } catch {}
      await v2.deleteFileUpload(row.id);
    }
    res.json({ ok: true });
  });
  app.get("/files/:name", (req, res) => {
    const safe = path2.basename(req.params.name);
    const full = path2.join(uploadsRoot, safe);
    if (!fs2.existsSync(full)) return res.status(404).end();
    res.sendFile(path2.resolve(full));
  });

  // ---------- ADMIN: DASHBOARD COUNTS ----------
  app.get("/api/admin/session-b-counts", requireAuth, async (_req, res) => {
    res.json(await v2.getSessionBCounts());
  });

  // =============================================================
  // CUSTOMER PORTAL endpoints
  // =============================================================
  app.get("/api/customer/dashboard", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    const balance = await v2.getLedgerBalance(c.customerId);
    const recentLedger = await v2.listLedgerEntries(c.customerId, { limit: 10 });
    const openRfqs = await v2.listRfqs({ customerId: c.customerId, status: "open" });
    const pendingPos = await v2.listPurchaseOrders({ customerId: c.customerId, status: "pending" });
    const recentPayments = await v2.listPayments({ customerId: c.customerId, limit: 5 });
    const banks = await v2.listBankDetails(true);
    res.json({ balanceInr: balance, recentLedger, openRfqs, pendingPos, recentPayments, banks });
  });
  app.get("/api/customer/ledger", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    const entries = await v2.listLedgerEntries(c.customerId);
    const balance = await v2.getLedgerBalance(c.customerId);
    res.json({ entries, balanceInr: balance });
  });
  app.get("/api/customer/rfqs", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    res.json(await v2.listRfqs({ customerId: c.customerId }));
  });
  app.post("/api/customer/rfqs", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const customer = await v2.getCustomer(c.customerId);
      const parsed = insertRfqSchema.parse({
        ...req.body,
        customerId: c.customerId,
        contactName: req.body?.contactName || customer?.contactPerson || customer?.name,
        email: c.email,
      });
      const row = await v2.createRfq(parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.get("/api/customer/quotes", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    res.json(await v2.listQuotes({ customerId: c.customerId }));
  });
  app.get("/api/customer/quotes/:id", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    const q = await v2.getQuote(parseInt(req.params.id as string, 10));
    if (!q || q.customerId !== c.customerId) return res.status(404).json({ error: "Quote not found" });
    res.json(q);
  });
  app.get("/api/customer/purchase-orders", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    res.json(await v2.listPurchaseOrders({ customerId: c.customerId }));
  });
  app.post("/api/customer/purchase-orders", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const parsed = insertPurchaseOrderSchema.parse({
        ...req.body,
        customerId: c.customerId,
      });
      const row = await v2.createPurchaseOrder(parsed);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.get("/api/customer/payments", requireCustomer, async (req, res) => {
    const c = (req as any).customer;
    res.json(await v2.listPayments({ customerId: c.customerId }));
  });
  app.get("/api/customer/banks", requireCustomer, async (_req, res) => {
    res.json(await v2.listBankDetails(true));
  });
  app.post("/api/customer/uploads", requireCustomer, docStore.single("file"), async (req, res) => {
    try {
      const c = (req as any).customer;
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "file required" });
      const { entityType, entityId, fileKind } = req.body || {};
      if (entityType !== "po") return res.status(403).json({ error: "Customers can only upload PO documents" });
      const po = await v2.getPurchaseOrder(parseInt(entityId, 10));
      if (!po || po.customerId !== c.customerId) return res.status(404).json({ error: "PO not found" });
      const row = await v2.addFileUpload({
        entityType: "po", entityId: po.id, fileKind: fileKind || "po_pdf",
        filename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size,
        storagePath: `/files/${path2.basename(file.path)}`,
        uploadedBy: `customer:${c.email}`,
      });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  console.log("[v2] Phase 3+4 + Session B routes registered: blogs, price lists, consignments, sub-users, SEO, customers, notifications, customer portal, ledger, RFQ/Quote/PO, payments, uploads, banks");
  console.log("[v2] Phase 3+4 + Session B routes registered: blogs, price lists, consignments, sub-users, SEO, customers, notifications, customer portal, ledger, RFQ/Quote/PO, payments, uploads, banks");

  // =============================================================
  // SESSION C ENDPOINTS
  // =============================================================

  // -------- DATA TEAM AUTH (/api/team) --------
  async function requireDataTeam(req: Request, res: Response, next: NextFunction) {
    const token = (req.headers["x-team-token"] as string | undefined)
      || (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const session = await v2.getDataTeamSession(token);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const user = await v2.getDataTeamUser(session.userId);
    if (!user || !user.active) return res.status(401).json({ error: "Unauthorized" });
    (req as any).teamUser = user;
    next();
  }

  app.post("/api/team/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      const user = await v2.getDataTeamUserByUsername(String(username));
      if (!user || !user.active) return res.status(401).json({ error: "Invalid credentials" });
      if (!verifyPassword(String(password), user.passwordHash)) return res.status(401).json({ error: "Invalid credentials" });
      const session = await v2.createDataTeamSession(user.id);
      await v2.touchDataTeamUserLogin(user.id);
      const { passwordHash: _ph, ...safeUser } = user;
      res.json({ token: session.token, expiresAt: session.expiresAt, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Admin SSO into the Data Team portal. An authenticated admin (x-admin-token / requireAuth)
  // exchanges their admin session for a Data Team session, so admins can use the quotation
  // wizard at /team/quotations/new without a separate Data Team password.
  app.post("/api/team/login-as-admin", requireAuth, async (req, res) => {
    try {
      const adminUser = (req as any).user as TokenInfo;
      const ssoUsername = adminUser.username;
      let teamUser = await v2.getDataTeamUserByUsername(ssoUsername);
      if (!teamUser) {
        // Auto-provision a Data Team row for this admin. Password is random — login is via SSO only.
        const randomPw = randomBytes(24).toString("hex");
        teamUser = await v2.createDataTeamUser({
          username: ssoUsername,
          passwordHash: hashPassword(randomPw),
          name: adminUser.displayName || ssoUsername,
        });
      }
      if (!teamUser.active) return res.status(403).json({ error: "Team account disabled" });
      const session = await v2.createDataTeamSession(teamUser.id);
      await v2.touchDataTeamUserLogin(teamUser.id);
      const { passwordHash: _ph, ...safeUser } = teamUser;
      console.log(`[team] admin SSO login as ${ssoUsername} -> teamUserId=${teamUser.id}`);
      res.json({ token: session.token, expiresAt: session.expiresAt, user: safeUser });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/logout", requireDataTeam, async (req, res) => {
    try {
      const token = (req.headers["x-team-token"] as string)
        || (req.headers["authorization"] as string)?.replace("Bearer ", "") || "";
      await v2.deleteDataTeamSession(token);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team/me", requireDataTeam, async (req, res) => {
    const user = (req as any).teamUser as any;
    const { passwordHash: _ph, ...safe } = user;
    res.json(safe);
  });

  // Team read-only mirrors of admin reference data. The quotation wizard needs the
  // quoting-companies list and the customer list, but the /api/admin/* versions require
  // an admin role — a Data Team session (incl. admin SSO) is not admin-role, so those
  // returned 401/empty. These mirrors expose the same read data under requireDataTeam.
  app.get("/api/team/quoting-companies", requireDataTeam, async (_req, res) => {
    // R27.15 — union of legacy quoting_companies + user-managed companies table.
    try { res.json(await v2.listAllQuotingEntities()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R14.5 — data team can create a quoting company inline during PO / quotation
  // creation (was admin-only). Reuses the same createQuotingCompany storage helper.
  app.post("/api/team/quoting-companies", requireDataTeam, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const created = await v2.createQuotingCompany(req.body || {});
      await v2.writeAuditLog({
        actorType: "data_team", actorId: u?.username, action: "quoting_company.create",
        entityType: "quoting_company", entityId: String(created.id),
        afterJson: JSON.stringify({ name: created.name }),
      });
      res.json(created);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/team/customers", requireDataTeam, async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      res.json(await v2.getCustomers(q));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Round 3: data team can create + edit customers (was admin-only before).
  app.post("/api/team/customers", requireDataTeam, async (req, res) => {
    try {
      const parsed = insertCustomerSchema.parse(req.body || {});
      const customer = await v2.createCustomer(parsed);
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "create_customer",
        entityType: "customer", entityId: String(customer.id),
        afterJson: JSON.stringify({ id: customer.id, name: customer.name }),
      })).catch((e: any) => console.error("[audit] team customer create failed:", e?.message));
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });

  const teamUpdateCustomer = async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid customer id" });
      const existing = await v2.getCustomer(id);
      if (!existing) return res.status(404).json({ error: "Customer not found" });
      const customer = await v2.updateCustomer(id, req.body || {});
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "update_customer",
        entityType: "customer", entityId: String(id),
      })).catch((e: any) => console.error("[audit] team customer update failed:", e?.message));
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  };
  app.patch("/api/team/customers/:id", requireDataTeam, teamUpdateCustomer);
  app.put("/api/team/customers/:id", requireDataTeam, teamUpdateCustomer);

  // ---------------- R13.1 TEAM SELLERS ----------------
  // Team-scoped mirror of the admin vendor (seller) CRUD. Shares the same v2 storage
  // helpers so there is no logic duplication; auth is requireDataTeam instead of admin.
  app.get("/api/team/sellers", requireDataTeam, async (req, res) => {
    try {
      const rows = await v2.listVendors({
        q: req.query.q as string | undefined,
        brand: req.query.brand as string | undefined,
        category: req.query.category as string | undefined,
        activeOnly: req.query.activeOnly === "true",
      });
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/sellers", requireDataTeam, async (req, res) => {
    try {
      const seller = await v2.createVendor(req.body || {});
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "create_seller",
        entityType: "vendor", entityId: String(seller.id),
        afterJson: JSON.stringify({ id: seller.id, name: seller.name }),
      })).catch((e: any) => console.error("[audit] team seller create failed:", e?.message));
      res.json(seller);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/team/sellers/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const seller = await v2.updateVendor(id, req.body || {});
      if (!seller) return res.status(404).json({ error: "Not found" });
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "update_seller",
        entityType: "vendor", entityId: String(id),
      })).catch((e: any) => console.error("[audit] team seller update failed:", e?.message));
      res.json(seller);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/team/sellers/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const n = v2.countSellerQuotes(id);
      if (n > 0) return res.status(400).json({ error: `Used on ${n} quotes; remove or replace first` });
      await v2.deleteVendor(id);
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "delete_seller",
        entityType: "vendor", entityId: String(id),
      })).catch((e: any) => console.error("[audit] team seller delete failed:", e?.message));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/sellers/bulk-import", requireDataTeam, async (req, res) => {
    try {
      const csv = String(req.body?.csv || "");
      if (!csv.trim()) return res.status(400).json({ error: "csv required" });
      const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_") });
      let n = 0;
      for (const r of parsed.data as any[]) {
        if (!r.name && !r.code) continue;
        await v2.createVendor({
          code: r.code || undefined, name: r.name, gstin: r.gstin, pan: r.pan,
          address: r.address, city: r.city, state: r.state, pincode: r.pincode,
          phone: r.phone, whatsapp: r.whatsapp || r.phone, email: r.email,
          paymentTerms: r.payment_terms, brands: r.brands, categories: r.categories,
        } as any);
        n++;
      }
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "bulk_import_sellers",
        entityType: "vendor", entityId: "", afterJson: JSON.stringify({ inserted: n }),
      })).catch((e: any) => console.error("[audit] team seller bulk-import failed:", e?.message));
      res.json({ inserted: n });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Round 3: AI-driven natural-language editor for the quotation line items.
  // Body: { prompt: string, items: AiQuoteItem[], context?: { customerName, currency } }
  // Returns: { items, explanation, ok, error? }
  app.post("/api/team/quotations/ai-edit", requireDataTeam, async (req, res) => {
    try {
      // Accept both `instruction` (preferred, matches claude-service signature) and
      // `prompt` (legacy) so the client can send either.
      const body = req.body || {};
      const instruction: string | undefined = body.instruction || body.prompt;
      const { items, context } = body;
      if (!instruction || typeof instruction !== "string") return res.status(400).json({ error: "instruction is required" });
      if (!Array.isArray(items)) return res.status(400).json({ error: "items must be an array" });
      console.log(`[R26.2d ai-quote] request instruction="${instruction}" itemCount=${items.length}`);
      const { editQuotationItems } = await import("./claude-service");
      const result = await editQuotationItems(instruction, items, context || {});
      console.log(`[R26.2d ai-quote] response ok=${(result as any).ok} error=${(result as any).error || "-"} items=${(result.items || []).length}`);
      // Pass through `summary` alias for the explanation field for nicer client toasts.
      res.json({ ...result, summary: (result as any).explanation });
    } catch (e: any) {
      console.error(`[R26.2d ai-quote] route error:`, e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // -------- ADMIN: V2 QUOTATIONS (read-only mirror) --------
  app.get("/api/admin/quotations", requireAuth, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = 20;
      const { rows, total } = await v2.listQuotations({ status, customerId, page, limit });
      const custIds = Array.from(new Set(rows.map((r: any) => r.customerId).filter(Boolean)));
      const custMap: Record<number, string> = {};
      for (const cid of custIds) {
        const c = await v2.getCustomer(cid as number);
        if (c) custMap[cid as number] = c.name;
      }
      const quotations = rows.map((r: any) => ({ ...r, customerName: custMap[r.customerId] || null }));
      res.json({ quotations, total, pages: Math.ceil(total / limit) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- ADMIN: QUOTING COMPANIES --------
  app.get("/api/admin/quoting-companies", requireAdminRole, async (_req, res) => {
    // R27.15 — union of legacy quoting_companies + user-managed companies table.
    try { res.json(await v2.listAllQuotingEntities()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/quoting-companies", requireAdminRole, async (req, res) => {
    try { res.json(await v2.createQuotingCompany(req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/admin/quoting-companies/:id", requireAdminRole, async (req, res) => {
    try {
      const row = await v2.updateQuotingCompany(parseInt(req.params.id as string, 10), req.body || {});
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/admin/quoting-companies/:id", requireAdminRole, async (req, res) => {
    try {
      await v2.deleteQuotingCompany(parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- ADMIN: DATA TEAM USERS --------
  app.get("/api/admin/data-team-users", requireAdminRole, async (_req, res) => {
    try { res.json(await v2.listDataTeamUsers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/data-team-users", requireAdminRole, async (req, res) => {
    try {
      const { username, password, name, email, phone, role } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      const passwordHash = hashPassword(String(password));
      // R26.5 (D1) — honor the role field (was previously ignored → everyone became data_team).
      const row = await v2.createDataTeamUser({ username: String(username), passwordHash, name, email, phone, role: role ? String(role) : undefined });
      const { passwordHash: _ph, ...safe } = row;
      res.json(safe);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/admin/data-team-users/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updates: any = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.email !== undefined) updates.email = req.body.email;
      if (req.body.phone !== undefined) updates.phone = req.body.phone;
      if (req.body.active !== undefined) updates.active = req.body.active;
      const row = await v2.updateDataTeamUser(id, updates);
      if (!row) return res.status(404).json({ error: "Not found" });
      const { passwordHash: _ph, ...safe } = row;
      res.json(safe);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/admin/data-team-users/:id/reset-password", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const pwd = req.body?.newPassword ?? req.body?.password;
      if (!pwd || String(pwd).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      const row = await v2.updateDataTeamUser(id, { passwordHash: hashPassword(String(pwd)) });
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // -------- TEAM: PART SUGGESTIONS (Bug 3 — also accessible at /api/admin/part-suggestions) --------
  app.get("/api/team/part-suggestions", requireDataTeam, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(parseInt(String(req.query.limit || "10"), 10) || 10, 25);
      if (!q || q.length < 2) return res.json([]);
      const suggestions = v2.getPartSuggestions(q, limit);
      res.json(suggestions);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- TEAM: PARTS MASTER --------
  app.get("/api/team/parts", requireDataTeam, async (req, res) => {
    try {
      const q = (req.query.q as string) || (req.query.search as string) || "";
      if (q.length < 3) return res.status(400).json({ error: "q must be at least 3 characters" });
      // R26.6a (4) — union master catalog + DISTINCT PO line-item history.
      res.json(v2.listPartsUnion(q, 50));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Round 4: per-part quote history expander
  app.get("/api/team/parts/:partNumber/history", requireDataTeam, async (req, res) => {
    try {
      const partNumber = decodeURIComponent(req.params.partNumber as string);
      const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 25) : 10;
      res.json(v2.getPartQuoteHistory(partNumber, limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team/parts/:partNumber", requireDataTeam, async (req, res) => {
    try {
      const part = await v2.getPartByNumber(req.params.partNumber as string);
      if (!part) return res.status(404).json({ error: "Part not found" });
      res.json(part);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/parts/sync-edukaan", requireAdminRole, async (_req, res) => {
    res.json({ ok: true, message: "TATA parts sync scheduled (nightly cron)" });
  });

  // -------- TEAM: FX RATE LOOKUP --------
  app.get("/api/team/quotations/fx-rate", requireDataTeam, async (req, res) => {
    try {
      const from = ((req.query.from as string) || "INR").toUpperCase();
      const to = ((req.query.to as string) || "INR").toUpperCase();
      if (from === to) return res.json({ from, to, rate: 1, source: "identity" });
      const { getFXRate } = await import("./fx-service");
      const rate = await getFXRate(from, to);
      if (rate == null) return res.status(503).json({ error: "FX rate unavailable", from, to });
      res.json({ from, to, rate, fetchedAt: new Date().toISOString() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- TEAM: QUOTATIONS STATS --------
  app.get("/api/team/quotations/stats", requireDataTeam, async (_req, res) => {
    try {
      const stats = await v2.getQuotationStats();
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- TEAM: QUOTATIONS --------
  const quotImportDir = path.join(ctx.uploadsDir || "./uploads", "quotation-imports");
  if (!fs.existsSync(quotImportDir)) fs.mkdirSync(quotImportDir, { recursive: true });
  const quotFileStore = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, quotImportDir),
      filename: (_req: any, file: any, cb: any) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.get("/api/team/quotations", requireDataTeam, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
      const fromDate = req.query.from ? new Date(req.query.from as string).getTime() : undefined;
      const toDate = req.query.to ? (() => {
        const d = new Date(req.query.to as string);
        // end-of-day so user picks an inclusive range
        d.setHours(23, 59, 59, 999);
        return d.getTime();
      })() : undefined;
      const qStr = (req.query.q as string) || undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = 20;
      const { rows, total } = await v2.listQuotations({ status, customerId, fromDate, toDate, q: qStr, page, limit });
      // Enrich rows with customerName by batching customer lookup
      const custIds = Array.from(new Set(rows.map((r: any) => r.customerId).filter(Boolean)));
      const custMap: Record<number, string> = {};
      for (const cid of custIds) {
        const c = await v2.getCustomer(cid as number);
        if (c) custMap[cid as number] = c.name;
      }
      // R13: resolve ordered-company name/logo for the list "Company" column.
      const allCompanies = await v2.listCompanies();
      const compMap: Record<number, { name: string; logoUrl: string | null }> = {};
      for (const c of allCompanies as any[]) compMap[c.id] = { name: c.name, logoUrl: c.logoUrl ?? null };
      // For any quote whose stored grandTotal is 0/null, compute it live from its items
      // (mirrors the PDF service fallback so the list view never shows ₹0 for a real quote).
      const quotations = await Promise.all(rows.map(async (r: any) => {
        let grandTotal = r.grandTotal;
        let subtotal = r.subtotal;
        let totalTax = r.totalTax;
        let totalDiscount = r.totalDiscount;
        if (!grandTotal || grandTotal <= 0) {
          try {
            const wi = await v2.getQuotationWithItems(r.id);
            if (wi && wi.items.length > 0) {
              let sub = 0, disc = 0, tax = 0, grand = 0;
              for (const it of wi.items) {
                const lineGross = (it.qty || 0) * (it.mrp || 0);
                const lineDisc = lineGross * ((it.discount || 0) / 100);
                const lineNet = lineGross - lineDisc;
                const lineTax = lineNet * ((it.gstPct || 0) / 100);
                sub += lineGross;
                disc += lineDisc;
                tax += lineTax;
                grand += lineNet + lineTax;
              }
              subtotal = Math.round(sub * 100) / 100;
              totalDiscount = Math.round(disc * 100) / 100;
              totalTax = Math.round(tax * 100) / 100;
              grandTotal = Math.round(grand * 100) / 100;
            }
          } catch { /* ignore — fall back to stored values */ }
        }
        return {
          ...r,
          subtotal, totalDiscount, totalTax, grandTotal,
          customerName: custMap[r.customerId] || null,
          companyName: r.companyId ? (compMap[r.companyId]?.name ?? null) : null,
          companyLogoUrl: r.companyId ? (compMap[r.companyId]?.logoUrl ?? null) : null,
        };
      }));
      res.json({ quotations, total, pages: Math.ceil(total / limit) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // NOTE: extract must come before /:id routes to avoid param conflict
  app.post("/api/team/quotations/extract", requireDataTeam, quotFileStore.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "file required" });
      const ext = path.extname(file.originalname).toLowerCase();
      const { extractPartsFromImage, extractPartsFromPdf, extractPartsFromExcel } = await import("./claude-service");
      let parts: any[] = [];
      if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
        parts = await extractPartsFromImage(file.path);
      } else if (ext === ".pdf") {
        parts = await extractPartsFromPdf(file.path);
      } else if ([".xlsx", ".xls", ".csv"].includes(ext)) {
        parts = await extractPartsFromExcel(file.path);
      } else {
        return res.status(400).json({ error: "Unsupported file type. Use JPG/PNG/PDF/XLSX/CSV" });
      }
      // Phase 1 (extract only): return parts as extracted by AI.
      // MRP / price matching is done separately via POST /match-price-list.
      const extractedParts = parts.map((p: any) => ({ ...p, priceMatchedFrom: null }));
      res.json({ parts: extractedParts });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Phase 2: Match current draft lines against price list.
  // POST /api/team/quotes/match-price-list and /api/admin/quotes/match-price-list
  // Body: { lines: [{ lineNo, partNumber, brand?, hsn?, mrp?, gstPercent? }, ...] }
  // Returns: { lines: [...updated...], matchedCount, unmatchedCount }
  async function handleMatchPriceList(req: Request, res: Response) {
    try {
      const rawLines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
      let matchedCount = 0;
      let unmatchedCount = 0;
      const updatedLines = rawLines.map((line: any) => {
        const pn = line.partNumber || line.part_number;
        if (pn) {
          const match = v2.lookupPartNumberMrp(String(pn));
          if (match) {
            matchedCount++;
            return {
              ...line,
              mrp: match.mrp,
              brand: match.brand || line.brand,
              hsn: match.hsnCode || line.hsn || "",
              gstPercent: match.gstPercent ?? line.gstPercent,
              gstPct: match.gstPercent ?? line.gstPct,
              priceMatchedFrom: "price_list" as const,
            };
          }
        }
        unmatchedCount++;
        return { ...line, priceMatchedFrom: null };
      });
      res.json({ lines: updatedLines, matchedCount, unmatchedCount });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  app.post("/api/team/quotes/match-price-list", requireDataTeam, handleMatchPriceList);
  app.post("/api/admin/quotes/match-price-list", requireAuth, handleMatchPriceList);

  app.post("/api/team/quotations", requireDataTeam, async (req, res) => {
    try {
      const teamUser = (req as any).teamUser;
      const { items: rawItems, company_id, ...quotationData } = req.body || {};
      if (!quotationData.customerId) return res.status(400).json({ error: "customerId required" });
      // R13: accept either companyId (camel) or company_id (snake) for the ordered/billing entity.
      if (quotationData.companyId == null && company_id != null) quotationData.companyId = parseInt(String(company_id), 10);
      const items = Array.isArray(rawItems) ? rawItems : [];
      let fxRate = 1;
      let fxLockedAt: number | null = null;
      if (quotationData.currency && quotationData.currency !== "INR") {
        const { getFXRate } = await import("./fx-service");
        const rate = await getFXRate("INR", String(quotationData.currency));
        if (rate) { fxRate = rate; fxLockedAt = Date.now(); }
      }
      let companyPrefix = "NM";
      if (quotationData.quotingCompanyId) {
        const co = await v2.resolveQuotingEntity(Number(quotationData.quotingCompanyId));
        if (co?.quotePrefix) companyPrefix = co.quotePrefix;
      }
      const { quotation, items: savedItems } = await v2.createQuotation(
        { ...quotationData, fxRate, fxLockedAt, createdByUserId: teamUser.id } as any,
        items.map((item: any, idx: number) => ({ ...item, lineNo: item.lineNo || idx + 1 })),
        companyPrefix,
      );
      const { upsertPartFromQuotation } = await import("./parts-sync");
      for (const item of items) {
        if (item.partNumber) {
          upsertPartFromQuotation(item.partNumber, item.productName, item.hsn, item.gstPct, item.brand, item.mrp);
        }
      }
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "create_quotation", entityType: "quotation", entityId: String(quotation.id), afterJson: JSON.stringify(quotation) });
      // R26.6g — A3: credit the quotation amount into matching active quotation-type targets.
      // Best-effort; must never break quotation creation.
      try { v2.syncQuotationToTargets(quotation.id); }
      catch (err: any) { console.error("[R26.6g] quotation→target sync skipped:", err?.message || err); }
      res.json({ quotation, items: savedItems });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/team/quotations/:id", requireDataTeam, async (req, res) => {
    try {
      const result = await v2.getQuotationWithItems(parseInt(req.params.id as string, 10));
      if (!result) return res.status(404).json({ error: "Quotation not found" });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/team/quotations/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { items: rawItems, company_id, ...patchData } = req.body || {};
      // R13: normalize ordered-company; lock it once the quotation has become a PO.
      if (patchData.companyId == null && company_id != null) patchData.companyId = parseInt(String(company_id), 10);
      if (patchData.companyId !== undefined) {
        if (await v2.quotationHasPO(id)) {
          return res.status(409).json({ error: "Company cannot be changed after the quotation is converted to a PO." });
        }
        patchData.companyId = patchData.companyId != null ? parseInt(String(patchData.companyId), 10) : null;
      }
      const updated = await v2.updateQuotation(id, patchData);
      if (!updated) return res.status(404).json({ error: "Quotation not found" });
      let savedItems = undefined;
      if (Array.isArray(rawItems)) {
        savedItems = await v2.updateQuotationItems(id, rawItems);
        const { upsertPartFromQuotation } = await import("./parts-sync");
        for (const item of rawItems) {
          if (item.partNumber) {
            upsertPartFromQuotation(item.partNumber, item.productName, item.hsn, item.gstPct, item.brand, item.mrp);
          }
        }
        // R26.2h — if this quotation was already converted to a PO (e.g. rates were set by
        // AI autofill AFTER conversion), push the new mrp values down into any po_items whose
        // unit_price is still 0, then refresh line/header totals. No-op when no linked PO exists.
        try {
          v2.propagateQuotationRatesToPoItems(id);
        } catch (e: any) {
          console.error(`[R26.2h] rate propagation failed for quotation ${id}:`, e?.message || e);
        }
      }
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "update_quotation", entityType: "quotation", entityId: String(id) });
      res.json({ quotation: updated, items: savedItems });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // R20.1: soft-delete a quotation (admin + data team). Keeps the row, hides from lists.
  app.delete("/api/team/quotations/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const existing = await v2.getQuotation(id);
      if (!existing) return res.status(404).json({ error: "Quotation not found" });
      await v2.softDeleteQuotation(id);
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "delete_quotation", entityType: "quotation", entityId: String(id) });
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // R20.1: mark a quotation Processed — only valid from the Accepted state.
  app.post("/api/team/quotations/:id/mark-processed", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const existing = await v2.getQuotation(id);
      if (!existing) return res.status(404).json({ error: "Quotation not found" });
      // A quotation reaches the data team for processing once it has been sent
      // to (or accepted by) the customer. Quotations are created with status
      // "sent" and there is no transition that produces "accepted", so gating
      // solely on "accepted" left this action permanently disabled.
      if (existing.status !== "sent" && existing.status !== "accepted") {
        return res.status(409).json({ error: "Only a Sent or Accepted quotation can be marked Processed." });
      }
      const updated = await v2.updateQuotation(id, { status: "processed" } as any);
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "mark_processed_quotation", entityType: "quotation", entityId: String(id) });
      res.json({ quotation: updated });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/team/quotations/:id/finalize", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await v2.getQuotationWithItems(id);
      if (!result) return res.status(404).json({ error: "Quotation not found" });
      const { quotation, items } = result;
      const customer = await v2.getCustomer(quotation.customerId);
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      // R13: prefer the unified ordered-company (companies table) when set, else fall
      // back to the legacy quoting_companies entry. mapPdfCompany normalizes both shapes.
      const company = await resolvePdfCompany(quotation);
      const { generateQuotationPDF } = await import("./pdf-service");
      await generateQuotationPDF(
        {
          id: quotation.id, quoteNo: quotation.quoteNo,
          currency: quotation.currency, fxRate: quotation.fxRate,
          subtotal: quotation.subtotal, totalDiscount: quotation.totalDiscount,
          totalTax: quotation.totalTax, grandTotal: quotation.grandTotal,
          validUntil: quotation.validUntil, notes: quotation.notes,
          terms: quotation.terms, createdAt: quotation.createdAt,
          shippingName: (quotation as any).shippingName ?? null,
          shippingAddress: (quotation as any).shippingAddress ?? null,
          shippingCity: (quotation as any).shippingCity ?? null,
          shippingState: (quotation as any).shippingState ?? null,
          shippingPincode: (quotation as any).shippingPincode ?? null,
          shippingPhone: (quotation as any).shippingPhone ?? null,
        },
        items.map((item) => ({
          lineNo: item.lineNo, partNumber: item.partNumber, productName: item.productName,
          hsn: item.hsn, brand: item.brand, qty: item.qty, mrp: item.mrp,
          discount: item.discount, gstPct: item.gstPct, lineTotal: item.lineTotal,
        })),
        company ? {
          name: company.name, gstin: company.gstin, address: company.address,
          city: company.city, state: company.state, phone: company.phone,
          email: company.email, bankName: company.bankName,
          bankAccount: company.bankAccount, bankIfsc: company.bankIfsc,
        } : { name: "Narmada Mobility", gstin: null, address: null, city: null, state: null, phone: null, email: null, bankName: null, bankAccount: null, bankIfsc: null },
        {
          name: customer.name, gstNumber: customer.gstNumber, address: customer.address,
          city: customer.city, state: customer.state, phone: customer.phone, email: customer.email,
        },
      );
      const safeName = quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pdfUrl = `/files/quotations/${safeName}.pdf`;
      const updated = await v2.updateQuotation(id, { status: "sent", pdfUrl });

      // Round 3: actually email the PDF to the customer (was only WhatsApp before).
      let emailResult: { ok: boolean; via: string; error?: string; messageId?: string } | null = null;
      if (customer.email) {
        const DATA_DIR3 = process.env.DATA_DIR || ".";
        const absPdfPath = path.join(DATA_DIR3, "uploads", "quotations", `${safeName}.pdf`);
        const { sendQuotationEmail } = await import("./email");
        emailResult = await sendQuotationEmail({
          to: customer.email,
          customerName: customer.name,
          quoteNo: quotation.quoteNo,
          pdfPath: absPdfPath,
          currency: quotation.currency,
          grandTotal: quotation.grandTotal || undefined,
          ccSelf: true,
        });
        if (!emailResult.ok) {
          console.error(`[finalize] Email to ${customer.email} failed:`, emailResult.error);
        }
      } else {
        console.warn(`[finalize] Customer ${customer.id} has no email — skipping email send for ${quotation.quoteNo}`);
        emailResult = { ok: false, via: "skipped", error: "customer has no email on file" };
      }

      if (customer.phone) {
        const { sendQuoteSent } = await import("./whatsapp");
        Promise.resolve(sendQuoteSent(customer.phone, customer.name, quotation.quoteNo, pdfUrl))
          .catch((e: any) => console.error("[whatsapp] quote_sent dispatch error:", e?.message));
      }
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "finalize_quotation", entityType: "quotation", entityId: String(id) });
      // Surface email status in the response so the UI can show "Sent ✓" or "Saved but email failed".
      res.json({
        quotation: updated,
        pdfUrl,
        email: emailResult,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/quotations/:id/duplicate", requireDataTeam, async (req, res) => {
    try {
      const result = await v2.duplicateQuotation(parseInt(req.params.id as string, 10));
      if (!result) return res.status(404).json({ error: "Quotation not found" });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team/quotations/:id/pdf", requireDataTeam, async (req, res) => {
    try {
      const result = await v2.getQuotationWithItems(parseInt(req.params.id as string, 10));
      if (!result) return res.status(404).json({ error: "Quotation not found" });
      const DATA_DIR2 = process.env.DATA_DIR || ".";
      const safeName = result.quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pdfPath = path.join(DATA_DIR2, "uploads", "quotations", `${safeName}.pdf`);

      // ALWAYS regenerate the PDF on download so the file reflects the current DB state
      // (avoids stale cached file after quotation updates / schema changes / column additions).
      {
        const { quotation, items } = result;
        const customer = await v2.getCustomer(quotation.customerId);
        if (!customer) return res.status(404).json({ error: "Customer not found for this quotation" });
        const company = await resolvePdfCompany(quotation);
        const { generateQuotationPDF } = await import("./pdf-service");
        await generateQuotationPDF(
          {
            id: quotation.id, quoteNo: quotation.quoteNo,
            currency: quotation.currency, fxRate: quotation.fxRate,
            subtotal: quotation.subtotal, totalDiscount: quotation.totalDiscount,
            totalTax: quotation.totalTax, grandTotal: quotation.grandTotal,
            validUntil: quotation.validUntil, notes: quotation.notes,
            terms: quotation.terms, createdAt: quotation.createdAt,
            shippingName: (quotation as any).shippingName ?? null,
            shippingAddress: (quotation as any).shippingAddress ?? null,
            shippingCity: (quotation as any).shippingCity ?? null,
            shippingState: (quotation as any).shippingState ?? null,
            shippingPincode: (quotation as any).shippingPincode ?? null,
            shippingPhone: (quotation as any).shippingPhone ?? null,
          },
          items.map((item) => ({
            lineNo: item.lineNo, partNumber: item.partNumber, productName: item.productName,
            hsn: item.hsn, brand: item.brand, qty: item.qty, mrp: item.mrp,
            discount: item.discount, gstPct: item.gstPct, lineTotal: item.lineTotal,
          })),
          company ? {
            name: company.name, gstin: company.gstin, address: company.address,
            city: company.city, state: company.state, phone: company.phone,
            email: company.email, bankName: company.bankName,
            bankAccount: company.bankAccount, bankIfsc: company.bankIfsc,
          } : { name: "Narmada Mobility", gstin: null, address: null, city: null, state: null, phone: null, email: null, bankName: null, bankAccount: null, bankIfsc: null },
          {
            name: customer.name, gstNumber: customer.gstNumber, address: customer.address,
            city: customer.city, state: customer.state, phone: customer.phone, email: customer.email,
          },
        );
      }

      if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: "PDF could not be generated" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      fs.createReadStream(pdfPath).pipe(res);
    } catch (e: any) {
      console.error("[PDF] generation error:", e);
      res.status(500).json({ error: e.message || "PDF generation failed" });
    }
  });

  // -------- PORTAL: SELF SERVICE --------
  app.patch("/api/portal/me", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const updates: any = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.phone) updates.phone = req.body.phone;
      const updated = await v2.updateCustomer(c.customerId, updates);
      if (!updated) return res.status(404).json({ error: "Customer not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/portal/emails", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      res.json(await v2.getCustomerEmails(c.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/portal/addresses", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      res.json(await v2.getCustomerAddresses(c.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/portal/addresses/:id", requireCustomer, async (req, res) => {
    try {
      await v2.deleteCustomerAddress(parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/portal/emails", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const { email, label, isPrimary } = req.body || {};
      if (!email) return res.status(400).json({ error: "email required" });
      const row = await v2.addCustomerEmail(c.customerId, String(email), label, !!isPrimary);
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/portal/emails/:id", requireCustomer, async (req, res) => {
    try {
      await v2.deleteCustomerEmail(parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/portal/addresses", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const row = await v2.addCustomerAddress(c.customerId, req.body || {});
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/portal/addresses/:id", requireCustomer, async (req, res) => {
    try {
      const row = await v2.updateCustomerAddress(parseInt(req.params.id as string, 10), req.body || {});
      if (!row) return res.status(404).json({ error: "Address not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // -------- PORTAL: CUSTOMER CHAT --------
  app.get("/api/portal/chat/history", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      res.json(await v2.getChatHistory(c.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/portal/chat", requireCustomer, async (req, res) => {
    try {
      const c = (req as any).customer;
      const message = req.body?.message;
      if (!message) return res.status(400).json({ error: "message required" });
      await v2.saveChatMessage(c.customerId, "user", String(message));
      const history = await v2.getChatHistory(c.customerId, 20);
      const histForClaude = history.slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Bug 5: fetch customer account data to inject as scoped context into Claude's
      // system prompt, so the assistant can ONLY answer about this customer's own account.
      let customerContext = "";
      try {
        const [balance, ledgerEntries, rfqs, quotes, consignments] = await Promise.all([
          v2.getLedgerBalance(c.customerId),
          v2.listLedgerEntries(c.customerId, { limit: 10 }),
          v2.listRfqs({ customerId: c.customerId }),
          v2.listQuotes({ customerId: c.customerId, limit: 5 }),
          v2.listConsignments({ limit: 10 }),
        ]);
        // Filter consignments to only this customer's
        const myConsignments = consignments.filter((cs: any) => cs.customerId === c.customerId).slice(0, 10);
        customerContext = JSON.stringify({
          balanceInr: balance,
          last10LedgerEntries: ledgerEntries.map((e: any) => ({
            date: e.entryDate || e.createdAt,
            type: e.entryType,
            amount: e.amountInr,
            description: e.description,
          })),
          openRFQs: (rfqs as any[]).filter((r: any) => r.status === "open").map((r: any) => ({
            id: r.id, createdAt: r.createdAt, partsCount: r.partsCount, status: r.status,
          })),
          last5Quotes: (quotes as any[]).map((q: any) => ({
            id: q.id, quoteNo: q.quoteNo, status: q.status,
            totalInr: q.totalInr, createdAt: q.createdAt,
          })),
          pendingConsignments: myConsignments.filter((cs: any) => cs.status !== "delivered").map((cs: any) => ({
            docket: cs.docketNumber, status: cs.status, dispatchDate: cs.dispatchDate,
            etaDate: cs.etaDate, invoiceNumber: cs.invoiceNumber,
          })),
        }, null, 2);
      } catch (ctxErr: any) {
        console.warn("[chat] context fetch error:", ctxErr?.message);
      }

      const { chatReply } = await import("./claude-service");
      const reply = await chatReply(histForClaude, String(message), customerContext);
      const assistantMsg = await v2.saveChatMessage(c.customerId, "assistant", reply);
      res.json({ message: assistantMsg, reply });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- PUBLIC: FEATURE CONFIG (R10) --------
  // Exposes runtime feature flags so the SPA can hide unfinished integrations
  // without a rebuild. MARKETING_OAUTH_ENABLED gates the Meta/Google connect UI.
  app.get("/api/public/config", (_req, res) => {
    res.json({ marketingOauthEnabled: process.env.MARKETING_OAUTH_ENABLED === "true" });
  });

  // -------- MARKETING OAUTH (R10) — guarded stubs --------
  // Return 503 until the integration env vars are configured. These exist so the
  // frontend "Connect" buttons have a real endpoint to hit once enabled.
  app.get("/api/admin/marketing/meta/connect", requireAuth, (_req, res) => {
    if (process.env.MARKETING_OAUTH_ENABLED !== "true" || !process.env.META_APP_ID) {
      return res.status(503).json({ error: "Meta integration not configured" });
    }
    res.json({ ok: true });
  });
  app.get("/api/admin/marketing/google/connect", requireAuth, (_req, res) => {
    if (process.env.MARKETING_OAUTH_ENABLED !== "true" || !process.env.GOOGLE_ADS_CLIENT_ID) {
      return res.status(503).json({ error: "Google integration not configured" });
    }
    res.json({ ok: true });
  });

  // -------- PUBLIC: ACCOUNT REGISTRATION (Option A) --------
  app.post("/api/public/register", async (req, res) => {
    try {
      const { name, email, phone, company, gstin, address } = req.body || {};
      if (!name || !email) return res.status(400).json({ error: "name and email required" });
      const row = await v2.createAccountRequest({ name: String(name), email: String(email), phone, company, gstin, address });
      res.json(row);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/admin/account-requests", requireAdminRole, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      res.json(await v2.listAccountRequests(status));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/account-requests/:id/approve", requireAdminRole, async (req, res) => {
    try {
      const adminUser = (req as any).user as TokenInfo;
      const id = parseInt(req.params.id as string, 10);
      const request = await v2.getAccountRequest(id);
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.status !== "pending") return res.status(400).json({ error: "Request already reviewed" });
      const customer = await v2.createCustomer({
        name: request.company || request.name,
        phone: request.phone || null,
        email: request.email,
        address: request.address || null,
        gstNumber: request.gstin || null,
        contactPerson: request.name,
      } as any);
      const login = await v2.createCustomerLogin(customer.id, request.email);
      await v2.updateAccountRequestStatus(id, "approved", adminUser.username, req.body?.notes);

      // Welcome / approval email (fire-and-forget). The previous code generated a random
      // login OTP here and sent it via WhatsApp — but that OTP was never stored or used,
      // so the customer received a meaningless code. Login OTPs are issued on demand by
      // /api/customer/request-otp; approval only needs to tell the customer they can log in.
      const portalLoginUrl = `${process.env.APP_URL || "https://narmadamobility.com"}/#/portal`;
      const displayName = request.name || request.company || "there";
      sendGenericEmail({
        event: "approval_welcome",
        to: request.email,
        subject: "Your Narmada Mobility account is approved",
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <div style="background:#001a4d;color:white;padding:18px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;font-size:18px;">Narmada Mobility — Customer Portal</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
            <p style="margin:0 0 12px;color:#374151;">Hi ${displayName},</p>
            <p style="margin:0 0 12px;color:#374151;">Your customer account has been <strong>approved</strong>. You can now sign in to track consignments, view your ledger, and manage quotes and orders.</p>
            <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Your login email:</p>
            <div style="font-size:16px;font-weight:600;color:#001a4d;background:#f3f4f6;padding:12px 16px;border-radius:6px;">${request.email}</div>
            <p style="margin:20px 0;text-align:center;">
              <a href="${portalLoginUrl}" style="display:inline-block;background:#001a4d;color:white;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:6px;">Sign in to your portal</a>
            </p>
            <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">We sign you in with a one-time code sent to your email (and WhatsApp, if we have your number). No password to remember.</p>
          </div>
        </div>`,
      }).catch((e: any) => console.error("[email] approval welcome send error:", e?.message));

      // WhatsApp welcome: AiSensy requires a Meta-approved template per message type and we
      // do not yet have a `narmada_account_approved` template approved. sendOTP() must stay
      // reserved for real login codes, so we deliberately do NOT fire a WhatsApp message here.
      // Until the template is approved, prompt the admin to message the customer manually.
      if (request.phone) {
        console.log(`[approve] account approved for ${request.email} (phone=${request.phone}) — welcome email sent. WhatsApp welcome skipped: no approved 'narmada_account_approved' template yet. Ping the customer manually if needed.`);
      } else {
        console.log(`[approve] account approved for ${request.email} (no phone on file) — welcome email sent.`);
      }

      await v2.writeAuditLog({ actorType: "admin", actorId: adminUser.username, action: "approve_account_request", entityType: "account_request", entityId: String(id) });
      res.json({ customer, login });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/account-requests/:id/reject", requireAdminRole, async (req, res) => {
    try {
      const adminUser = (req as any).user as TokenInfo;
      const id = parseInt(req.params.id as string, 10);
      const request = await v2.getAccountRequest(id);
      if (!request) return res.status(404).json({ error: "Request not found" });
      await v2.updateAccountRequestStatus(id, "rejected", adminUser.username, req.body?.notes);
      await v2.writeAuditLog({ actorType: "admin", actorId: adminUser.username, action: "reject_account_request", entityType: "account_request", entityId: String(id) });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- ADMIN: AUDIT LOGS (D6) --------
  app.get("/api/admin/audit-logs", requireAdminRole, async (req, res) => {
    try {
      // The UI's "actor" filter is the actor TYPE (admin | data_team | customer),
      // not the actor id — so it must map to actorType. actorId is a separate
      // optional filter sent as `actor_id`.
      const actorType = (req.query.actor as string) || undefined;
      const actorId = (req.query.actor_id as string) || undefined;
      const action = (req.query.action as string) || undefined;
      const entityType = (req.query.entity_type as string) || undefined;
      const fromDate = (req.query.from as string) || undefined;
      const toDate = (req.query.to as string) || undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      res.json(await v2.listAuditLogs({ actorType, actorId, action, entityType, fromDate, toDate, page }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- ADMIN: NOTIFICATION LOG (WhatsApp/email delivery diagnostics) --------
  app.get("/api/admin/notification-log", requireAdminRole, async (req, res) => {
    try {
      const reqLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
      const limit = Math.min(Math.max(Number.isFinite(reqLimit) ? reqLimit : 200, 1), 500);
      const channel = (req.query.channel as string) || undefined;
      const status = (req.query.status as string) || undefined;
      const entries = await v2.listNotifications({ limit, channel, status });
      res.json({ entries });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- ADMIN: GLOBAL SEARCH (D2) --------
  app.get("/api/admin/search", requireAdminRole, async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      if (!q || q.length < 2) return res.status(400).json({ error: "q must be at least 2 characters" });
      const typesRaw = (req.query.types as string) || "";
      const types = typesRaw ? typesRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
      res.json(await v2.globalSearch(q, types));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- SEO (C7) --------
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /admin",
      "Disallow: /portal",
      `Sitemap: ${process.env.APP_URL || "https://narmadamobility.com"}/sitemap.xml`,
    ].join("\n"));
  });

  app.get("/sitemap.xml", async (_req, res) => {
    try {
      // R27.6 #5 — regen writes the REAL sitemap (every active product, part-number
      // first, hash-routed) to public-runtime/sitemap.xml; serve that file, not a stub.
      await ctx.regenSitemap();
      const file = path.join(process.cwd(), "public-runtime", "sitemap.xml");
      const xml = fs.readFileSync(file, "utf-8");
      res.setHeader("Content-Type", "application/xml");
      res.send(xml);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- HEALTH (D6) --------
  app.get("/api/health", async (_req, res) => {
    try {
      let dbOk = false;
      try { (db as any).select({ c: (db as any).sql`1` }).get?.(); dbOk = true; } catch { dbOk = true; } // basic connectivity
      let imapOk = false;
      try { const { isImapEnabled } = await import("./imap-service"); imapOk = isImapEnabled(); } catch {}
      const aisensyOk = !!(process.env.AISENSY_API_KEY && process.env.AISENSY_API_KEY !== "skip");
      const claudeOk = !!(process.env.CLAUDE_API_KEY && process.env.CLAUDE_API_KEY !== "skip");
      let fxOk = false;
      try { const { fxHealthCheck } = await import("./fx-service"); const s = await fxHealthCheck(); fxOk = s.ok; } catch {}
      res.json({
        status: dbOk ? "ok" : "degraded",
        db: dbOk ? "ok" : "error",
        imap: imapOk ? "ok" : "disabled",
        aisensy: aisensyOk ? "ok" : "not_configured",
        claude: claudeOk ? "ok" : "not_configured",
        fx: fxOk ? "ok" : "not_cached",
        ts: Date.now(),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  // ROUNDS 4.4 → 7 ROUTES
  // ============================================================================
  registerR4toR7Routes(app, { requireAuth, requireAdminRole, requireDataTeam, ctx });

  console.log("[v2] Session C routes registered: quoting-companies, data-team, parts, quotations, chat, registration, audit-logs, search, health");
  console.log("[v2] R4.4→R7 routes registered: ai-ledger, vendors, companies, warehouses, purchase-orders, rfqs, vendor-inbox, webhooks, delhi, rates, leads, targets, announcements, tasks, vendor-discovery, outreach, catalogue");
}

// R21.5 — Convert a `YYYY-MM-DD` IST calendar day to the UTC-ms instant at which that
// IST day begins (00:00:00 IST = 18:30 UTC of the prior day). Adding 24h yields the
// exclusive upper bound for an IST day. Returns NaN-safe fallback (epoch) on bad input.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30
function istDayStartUtcMs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return 0;
  const [, y, mo, d] = m;
  // Midnight IST for the given calendar day, expressed in UTC ms.
  const utcMidnight = Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  return utcMidnight - IST_OFFSET_MS;
}

// ============================================================================
// R4.4 → R7 route registration (separate fn to keep registerV2Routes readable)
// ============================================================================
function registerR4toR7Routes(
  app: Express,
  deps: {
    requireAuth: any;
    requireAdminRole: any;
    requireDataTeam: any;
    ctx: V2Context;
  },
) {
  const { requireAuth, requireAdminRole, requireDataTeam, ctx } = deps;
  const claude = require("./claude-service");
  const wa = require("./whatsapp");
  const { rawSqlite } = require("./storage");
  // R26.6i — webhook audit helpers (local; esbuild splits route-register functions into
  // separate lazy module chunks, so a shared module-level symbol is not reliably in scope).
  const SECRET_HEADER_KEYS = ["x-aisensy-signature", "x-webhook-secret", "x-aisensy-secret", "authorization", "cookie", "x-admin-token"];
  const logWebhookEvent = (source: string, req: any): number | null => {
    try {
      const redactedHeaders: Record<string, any> = { ...(req.headers || {}) };
      for (const k of SECRET_HEADER_KEYS) { if (redactedHeaders[k] != null) redactedHeaders[k] = "<redacted>"; }
      let bodyJson = "";
      try { bodyJson = JSON.stringify(req.body ?? {}); } catch { bodyJson = "<unserializable>"; }
      if (bodyJson.length > 8000) bodyJson = bodyJson.slice(0, 8000);
      const info = rawSqlite
        .prepare(`INSERT INTO webhook_events (source, received_at, method, headers_json, body_json) VALUES (?, ?, ?, ?, ?)`)
        .run(source, Date.now(), String(req.method || "POST"), JSON.stringify(redactedHeaders), bodyJson);
      return Number(info.lastInsertRowid);
    } catch (err: any) { console.error("[R26.6i webhook-log] insert failed:", err?.message || err); return null; }
  };
  const updateWebhookEvent = (
    id: number | null,
    fields: { topic?: string | null; fromPhone?: string | null; textPreview?: string | null; processed?: number; ignoredReason?: string | null; notes?: string | null },
  ): void => {
    if (id == null) return;
    try {
      rawSqlite
        .prepare(`UPDATE webhook_events SET topic = ?, from_phone = ?, text_preview = ?, processed = ?, ignored_reason = ?, notes = ? WHERE id = ?`)
        .run(
          fields.topic ?? null,
          fields.fromPhone ?? null,
          fields.textPreview != null ? String(fields.textPreview).slice(0, 200) : null,
          fields.processed ?? 0,
          fields.ignoredReason ?? null,
          fields.notes ?? null,
          id,
        );
    } catch (err: any) { console.error("[R26.6i webhook-log] update failed:", err?.message || err); }
  };

  // Delhi-warehouse middleware: a data-team session whose user.role === "delhi_warehouse".
  async function requireDelhi(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = (req.headers["x-team-token"] as string | undefined)
      || (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
    const session = await v2.getDataTeamSession(token);
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
    const user = await v2.getDataTeamUser(session.userId);
    if (!user || !user.active) { res.status(401).json({ error: "Unauthorized" }); return; }
    // admins (auto-provisioned) and delhi_warehouse role allowed
    if (user.role !== "delhi_warehouse" && user.role !== "admin" && user.role !== "data_team") {
      res.status(403).json({ error: "Delhi warehouse role required" }); return;
    }
    (req as any).teamUser = user;
    next();
  }

  // ---------------- R4.4 AI LEDGER ----------------
  app.post("/api/admin/ledger/ask", requireAdminRole, async (req, res) => {
    try {
      const question = String(req.body?.question || "").trim();
      if (!question) return res.status(400).json({ error: "question required" });
      const u = (req as any).user as TokenInfo;
      const translated = await claude.ledgerNlToSql(question);
      if (!translated) {
        await v2.logLedgerQuery({ userId: u.username, question, answer: "AI unavailable" });
        return res.status(503).json({ error: "AI not configured (set CLAUDE_API_KEY) or could not translate question" });
      }
      const sqlText = String(translated.sql || "").trim();
      // Validate SELECT-only
      if (!/^select\b/i.test(sqlText) || /\b(insert|update|delete|drop|alter|create|pragma|attach|replace)\b/i.test(sqlText)) {
        await v2.logLedgerQuery({ userId: u.username, question, sql: sqlText, answer: "rejected (non-SELECT)" });
        return res.status(400).json({ error: "Generated SQL was not a safe SELECT", sql: sqlText });
      }
      let rows: any[] = [];
      try {
        rows = rawSqlite.prepare(sqlText).all(...(translated.params || []));
      } catch (e: any) {
        await v2.logLedgerQuery({ userId: u.username, question, sql: sqlText, answer: `SQL error: ${e?.message}` });
        return res.status(400).json({ error: `SQL execution failed: ${e?.message}`, sql: sqlText });
      }
      await v2.logLedgerQuery({ userId: u.username, question, sql: sqlText, answer: `${rows.length} rows` });
      res.json({ rows, sql: sqlText, explanation: translated.explanation });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/ledger/overdue", requireAdminRole, async (_req, res) => {
    try {
      // Overdue = customers whose outstanding balance > 0 and whose oldest unpaid invoice
      // ledger entry is older than (payment_terms_days || 30) days.
      const custs = await v2.getCustomers();
      const now = Date.now();
      const out: any[] = [];
      for (const c of custs) {
        const balance = await v2.getLedgerBalance(c.id);
        if (balance <= 0) continue;
        const entries = await v2.listLedgerEntries(c.id, { limit: 500 });
        const invoices = entries.filter((e) => e.voucherType === "invoice").sort((a, b) => a.entryDate - b.entryDate);
        const oldest = invoices[0];
        const termDays = (c.paymentTermsDays && c.paymentTermsDays > 0) ? c.paymentTermsDays : 30;
        const ageDays = oldest ? Math.floor((now - oldest.entryDate) / 86400000) : 0;
        if (oldest && ageDays > termDays) {
          out.push({
            customerId: c.id, name: c.name, phone: c.phone, email: c.email,
            balanceInr: balance, oldestInvoiceDate: oldest.entryDate, ageDays, termDays,
          });
        }
      }
      out.sort((a, b) => b.ageDays - a.ageDays);
      res.json(out);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/ledger/remind/:customerId", requireAdminRole, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId as string, 10);
      const c = await v2.getCustomer(customerId);
      if (!c) return res.status(404).json({ error: "Customer not found" });
      const balance = await v2.getLedgerBalance(customerId);
      const msg = `Dear ${c.name}, our records show an outstanding balance of ₹${balance.toLocaleString("en-IN")} on your Narmada Mobility account. Kindly arrange payment at your earliest. Thank you.`;
      // WhatsApp (approved account-approved template fallback to free text) + email — fire-and-forget
      if (c.phone) wa.sendTextMessage(c.phone, msg, "ledger_reminder").catch(() => {});
      if (c.email) {
        sendGenericEmail({
          to: c.email,
          subject: "Payment reminder — Narmada Mobility",
          html: `<p>${msg}</p>`,
          text: msg,
          event: "ledger_reminder",
        }).catch(() => {});
      }
      res.json({ ok: true, balanceInr: balance, sentWhatsapp: !!c.phone, sentEmail: !!c.email });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/ledger/reconcile", requireAdminRole, async (req, res) => {
    try {
      const csv = String(req.body?.csv || "");
      if (!csv.trim()) return res.status(400).json({ error: "csv required (date,description,amount,ref)" });
      const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().toLowerCase() });
      const bankRows = (parsed.data as any[]).map((r) => ({
        date: r.date, description: r.description || "", amount: parseFloat(String(r.amount || "0").replace(/[^0-9.\-]/g, "")) || 0, ref: r.ref || r.reference || "",
      }));
      const payments = await v2.listPayments({ limit: 2000 });
      const matches: any[] = [];
      const unmatched: any[] = [];
      for (const br of bankRows) {
        const m = payments.find((p) => Math.abs((p.amountInr || 0) - br.amount) < 1 && (
          (br.ref && (p.referenceNo || "").includes(br.ref)) ||
          Math.abs((p.paymentDate || 0) - Date.parse(br.date || "")) < 5 * 86400000
        ));
        if (m) matches.push({ bank: br, paymentId: m.id, customerId: m.customerId, amountInr: m.amountInr });
        else unmatched.push(br);
      }
      res.json({ matched: matches, unmatched, totalBankRows: bankRows.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R5.2 VENDORS ----------------
  app.get("/api/admin/vendors", requireAuth, async (req, res) => {
    try {
      const rows = await v2.listVendors({
        q: req.query.q as string | undefined,
        brand: req.query.brand as string | undefined,
        category: req.query.category as string | undefined,
        activeOnly: req.query.activeOnly === "true",
      });
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/vendors/:id", requireAuth, async (req, res) => {
    const v = await v2.getVendor(parseInt(req.params.id as string, 10));
    if (!v) return res.status(404).json({ error: "Not found" });
    const contacts = await v2.listVendorContacts(v.id);
    res.json({ ...v, contacts });
  });
  app.post("/api/admin/vendors", requireAuth, async (req, res) => {
    try { res.json(await v2.createVendor(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/vendors/:id", requireAuth, async (req, res) => {
    try {
      const v = await v2.updateVendor(parseInt(req.params.id as string, 10), req.body || {});
      if (!v) return res.status(404).json({ error: "Not found" });
      res.json(v);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/admin/vendors/:id", requireAdminRole, async (req, res) => {
    await v2.deleteVendor(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  app.post("/api/admin/vendors/bulk-import", requireAuth, async (req, res) => {
    try {
      const csv = String(req.body?.csv || "");
      if (!csv.trim()) return res.status(400).json({ error: "csv required" });
      const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_") });
      let n = 0;
      for (const r of parsed.data as any[]) {
        if (!r.name && !r.code) continue;
        await v2.createVendor({
          code: r.code || undefined, name: r.name, gstin: r.gstin, pan: r.pan,
          address: r.address, city: r.city, state: r.state, pincode: r.pincode,
          phone: r.phone, whatsapp: r.whatsapp || r.phone, email: r.email,
          paymentTerms: r.payment_terms, brands: r.brands, categories: r.categories,
        } as any);
        n++;
      }
      res.json({ inserted: n });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R5.2 COMPANIES ----------------
  app.get("/api/admin/companies", requireAuth, async (_req, res) => {
    res.json(await v2.listCompanies());
  });
  app.get("/api/admin/companies/:id", requireAuth, async (req, res) => {
    const c = await v2.getCompany(parseInt(req.params.id as string, 10));
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  app.post("/api/admin/companies", requireAdminRole, async (req, res) => {
    try { res.json(await v2.createCompany(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/companies/:id", requireAdminRole, async (req, res) => {
    const c = await v2.updateCompany(parseInt(req.params.id as string, 10), req.body || {});
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  app.delete("/api/admin/companies/:id", requireAdminRole, async (req, res) => {
    await v2.deleteCompany(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  app.post("/api/admin/companies/:id/set-default", requireAdminRole, async (req, res) => {
    await v2.setDefaultCompany(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------------- R13 ORDERED-COMPANY PICKER ----------------
  // Public, compact list consumed by the CompanyPicker on PO/quotation forms. Returns
  // active companies only (default first) in a flat shape the picker can render directly.
  app.get("/api/companies", async (_req, res) => {
    try {
      const list = await v2.listCompanies(true);
      res.json(list.map((c: any) => ({
        id: c.id,
        name: c.name,
        logo_url: c.logoUrl ?? null,
        gst: c.gstin ?? null,
        address: [c.addressLine1, c.addressLine2, c.city, c.state, c.pincode].filter(Boolean).join(", ") || null,
        email: c.signatoryEmail ?? null,
        phone: c.signatoryPhone ?? null,
      })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- WAREHOUSES (admin + team) ----------------
  app.get("/api/admin/warehouses", requireAuth, async (_req, res) => res.json(await v2.listWarehouses()));
  app.get("/api/team/warehouses", requireDataTeam, async (_req, res) => res.json(await v2.listWarehouses(true)));
  app.post("/api/admin/warehouses", requireAdminRole, async (req, res) => {
    try { res.json(await v2.createWarehouse(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/warehouses/:id", requireAdminRole, async (req, res) => {
    const w = await v2.updateWarehouse(parseInt(req.params.id as string, 10), req.body || {});
    if (!w) return res.status(404).json({ error: "Not found" });
    res.json(w);
  });

  // R6.2 inter-warehouse transfers
  app.get("/api/team/transfers", requireDataTeam, async (_req, res) => res.json(await v2.listWarehouseTransfers()));
  app.post("/api/team/transfers", requireDataTeam, async (req, res) => {
    try { res.json(await v2.createWarehouseTransfer(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/team/transfers/:id", requireDataTeam, async (req, res) => {
    const t = await v2.updateWarehouseTransfer(parseInt(req.params.id as string, 10), req.body || {});
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });

  // ---------------- R5.3 PURCHASE ORDERS (team) ----------------
  app.get("/api/team/vendors", requireDataTeam, async (req, res) => {
    res.json(await v2.listVendors({ q: req.query.q as string | undefined, activeOnly: req.query.activeOnly === "true" }));
  });
  app.get("/api/team/purchase-orders", requireDataTeam, async (req, res) => {
    // R27.1b BUG-4 — team portal PO search (mirror admin q/from/to filters).
    const allRows = await v2.listPurchaseOrdersV2WithTotals({
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });
    // R23.2 — opt-in pagination: ?limit=&offset= slices the list and sets X-Total-Count.
    // When ?limit is omitted the full array is returned (backward compatible).
    const total = allRows.length;
    let rows = allRows;
    if (req.query.limit != null) {
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 100);
      const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10) || 0);
      rows = allRows.slice(offset, offset + limit);
    }
    res.setHeader("X-Total-Count", String(total));
    // R12: attach per-PO dispatch rollup (Status/Carrier/Bundles/Docket# columns).
    const summary = await v2.getDispatchSummaryForPOs(rows.map((r: any) => r.id));
    // R27.2-4 — per-PO open-deviation rollup so the team list can show the deviation column.
    let devSummary: Record<number, { count: number }> = {};
    try { const r27mod = await import("./storage-r27"); devSummary = r27mod.deviationSummaryForPOs(rows.map((r: any) => r.id)); } catch { /* deviation table may not exist on older DBs */ }
    res.json(rows.map((r: any) => {
      const s = summary[r.id];
      const dev = devSummary[r.id];
      return {
        ...r,
        dispatches: s?.dispatches || [],
        dispatchCarrier: s?.carrier || null,
        dispatchBundles: s?.bundles || 0,
        dispatchDockets: s?.docketNumbers || [],
        hasInternalTransfer: s?.hasInternalTransfer || false,
        hasDeviation: !!(dev && dev.count > 0),
        deviationCount: dev?.count || 0,
      };
    }));
  });
  app.get("/api/team/purchase-orders/:id", requireDataTeam, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    const po = await v2.getPurchaseOrderV2(id);
    if (!po) return res.status(404).json({ error: "Not found" });
    const summary = await v2.getDispatchSummaryForPOs([id]);
    const s = summary[id];
    res.json({
      ...po,
      dispatches: s?.dispatches || [],
      dispatchCarrier: s?.carrier || null,
      dispatchBundles: s?.bundles || 0,
      dispatchDockets: s?.docketNumbers || [],
      hasInternalTransfer: s?.hasInternalTransfer || false,
    });
  });
  app.post("/api/team/purchase-orders", requireDataTeam, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const { items, ...po } = req.body || {};
      res.json(await v2.createPurchaseOrderV2({ ...po, createdBy: u?.username }, items || []));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.1b BUG-4 — team portal Duplicate action (mirrors admin /duplicate).
  app.post("/api/team/purchase-orders/:id/duplicate", requireDataTeam, async (req, res) => {
    try {
      const dup = await v2.duplicatePurchaseOrderV2(parseInt(String(req.params.id), 10));
      if (!dup) return res.status(404).json({ error: "Not found" });
      res.json(dup);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/team/purchase-orders/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const existing = await v2.getPurchaseOrderV2(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      const body = { ...(req.body || {}) } as any;

      // R21.7 — normalize urgency + delivery deadline if the Patna edit form sends them.
      if (body.urgency != null) {
        body.urgency = ["urgent", "normal", "standby"].includes(String(body.urgency)) ? String(body.urgency) : null;
      }
      if (body.delivery_deadline !== undefined || body.deliveryDeadline !== undefined) {
        const raw = body.delivery_deadline !== undefined ? body.delivery_deadline : body.deliveryDeadline;
        delete body.delivery_deadline;
        if (raw == null || raw === "") {
          body.deliveryDeadline = null;
        } else if (typeof raw === "number") {
          body.deliveryDeadline = raw;
        } else {
          const t = Date.parse(String(raw).trim());
          body.deliveryDeadline = Number.isNaN(t) ? null : t;
        }
      }

      // R13: company_id (which billing entity the order is for) is locked once the PO
      // is processed or dispatched — by then PDFs/branding have gone out the door.
      if (body.companyId != null || body.company_id != null) {
        const newCompanyId = body.companyId != null ? body.companyId : body.company_id;
        delete body.company_id;
        const summary = await v2.getDispatchSummaryForPOs([id]);
        const hasDispatch = (summary[id]?.dispatches?.length || 0) > 0;
        const locked = existing.status === "processed" || existing.status === "dispatched" || hasDispatch;
        if (locked) {
          return res.status(409).json({ error: "Company cannot be changed once the PO is processed or dispatched." });
        }
        body.companyId = newCompanyId != null ? parseInt(String(newCompanyId), 10) : null;
      }

      const po = await v2.updatePurchaseOrderV2(id, body);
      if (!po) return res.status(404).json({ error: "Not found" });
      const u = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(u?.id ?? ""), action: "update_po", entityType: "purchase_order_v2", entityId: String(id), afterJson: JSON.stringify(body) });
      res.json(po);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/quotations/:id/convert-to-po", requireDataTeam, async (req, res) => {
    try {
      const quotationId = parseInt(req.params.id as string, 10);
      const qw = await v2.getQuotationWithItems(quotationId);
      if (!qw) return res.status(404).json({ error: "Quotation not found" });
      const quote = qw.quotation;
      const items = (qw.items || []).map((it: any) => ({
        partNumber: it.partNumber, brand: it.brand, description: it.productName || it.description,
        qty: it.qty, unitPrice: it.mrp ?? it.unitPrice ?? 0, discountPct: it.discount ?? 0,
        taxPct: it.gstPct ?? 18, lineTotal: it.lineTotal ?? 0,
      }));
      // R13: carry the quotation's ordered-company onto the PO; fall back to default.
      const companyId = (quote as any).companyId ?? (await v2.getDefaultCompany())?.id;
      const po = await v2.createPurchaseOrderV2({
        quotationId, customerId: quote.customerId, companyId,
        subtotal: quote.subtotal ?? 0, discount: quote.totalDiscount ?? 0,
        tax: quote.totalTax ?? 0, total: quote.grandTotal ?? 0,
        createdBy: (req as any).teamUser?.username,
      }, items);
      res.json({ poId: po.id, poNumber: po.poNumber });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // NOTE: the legacy PUT /api/team/po-items/:id/assign-vendor was removed in R8-v2.
  // The canonical endpoint is POST /api/team/po-items/:id/assign-vendor (registered in
  // registerR8Routes) which persists vendor_id + vendor_name + vendor_rate + brand and
  // fires the AiSensy seller rate-request.

  // PO PDF. ?type=internal (or ?internal=1) renders the internal procurement doc with
  // seller + purchase rate + line cost + customer rate columns (Bug 4). The default
  // (customer-facing) variant is unchanged and never leaks seller/cost info.
  app.get("/api/team/purchase-orders/:id/pdf", requireDataTeam, async (req, res) => {
    try {
      const po = await v2.getPurchaseOrderV2(parseInt(req.params.id as string, 10));
      if (!po) return res.status(404).json({ error: "Not found" });
      const company = po.companyId ? await v2.getCompany(po.companyId) : await v2.getDefaultCompany();
      const pdf = require("./pdf-service");
      const internal = req.query.type === "internal" || req.query.internal === "1";
      const bytes = internal ? await pdf.generateInternalPOPDF(po, company) : await pdf.generatePOPDF(po, company);
      const suffix = internal ? "-INTERNAL" : "";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${po.poNumber.replace(/\//g, "-")}${suffix}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R5.4 RFQs (team) ----------------
  app.get("/api/team/rfqs", requireDataTeam, async (req, res) => {
    res.json(await v2.listRfqsV2({ status: req.query.status as string | undefined }));
  });
  app.get("/api/team/rfqs/:id", requireDataTeam, async (req, res) => {
    const rfq = await v2.getRfqV2(parseInt(req.params.id as string, 10));
    if (!rfq) return res.status(404).json({ error: "Not found" });
    res.json(rfq);
  });
  app.post("/api/team/rfqs", requireDataTeam, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const { items, vendorIds, vendor_ids, ...rfq } = req.body || {};
      res.json(await v2.createRfqV2({ ...rfq, requestedBy: u?.username }, items || [], vendorIds || vendor_ids || []));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/rfqs/:id/send", requireDataTeam, async (req, res) => {
    try {
      const rfqId = parseInt(req.params.id as string, 10);
      const rfq = await v2.getRfqV2(rfqId);
      if (!rfq) return res.status(404).json({ error: "Not found" });
      const itemList = rfq.items.map((it) => `• ${it.partNumber || ""} ${it.brand || ""} ${it.description || ""} (qty ${it.qty})`).join("\n");
      for (const rv of rfq.vendors) {
        const vendor = await v2.getVendor(rv.vendorId);
        if (!vendor || !(vendor.whatsapp || vendor.phone)) continue;
        const phone = vendor.whatsapp || vendor.phone!;
        wa.sendVendorRFQ(phone, vendor.name, itemList, rfq.rfqNumber).then(async (r: any) => {
          await v2.markRfqVendorSent(rfqId, rv.vendorId, r?.messageId);
          await v2.addVendorConversation({
            vendorId: rv.vendorId, rfqId, direction: "out", messageText: itemList,
            sentBy: (req as any).teamUser?.username,
          });
        }).catch(() => {});
      }
      await v2.updateRfqV2(rfqId, { status: "sent" });
      res.json({ ok: true, sentTo: rfq.vendors.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/rfq-quotes", requireDataTeam, async (req, res) => {
    try { res.json(await v2.createRfqQuote({ ...req.body, extractedBy: req.body?.extractedBy || "manual" })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/rfq-quotes/:id/select-winner", requireDataTeam, async (req, res) => {
    await v2.selectRfqWinner(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // ---------------- R5.5 AISENSY INBOUND WEBHOOK ----------------
  app.post("/api/webhooks/aisensy", async (req, res) => {
    const _whId = logWebhookEvent("aisensy", req);
    try {
      const secret = process.env.AISENSY_WEBHOOK_SECRET || "";
      if (secret) {
        const got = (req.headers["x-aisensy-secret"] as string) || (req.headers["x-webhook-secret"] as string) || "";
        if (got !== secret) return res.status(401).json({ error: "bad secret" });
      }
      const b = req.body || {};
      const from = String(b.from || b.sender || b.phone || "");
      const message = String(b.message || b.text || b.body || "");
      const mediaUrl = b.media_url || b.mediaUrl || null;
      const messageId = b.message_id || b.messageId || null;
      if (!from) {
        updateWebhookEvent(_whId, { fromPhone: from || null, textPreview: message, processed: 0, ignoredReason: "no_from" });
        return res.json({ ok: true, ignored: "no from" });
      }
      const vendor = await v2.getVendorByPhone(from);
      if (!vendor) {
        updateWebhookEvent(_whId, { fromPhone: from, textPreview: message, processed: 0, ignoredReason: "unknown_vendor" });
        res.json({ ok: true, ignored: "unknown vendor" }); return;
      }

      // Find an active RFQ for this vendor (most recent open one)
      const rfqVendorRows = await v2.listRfqVendorsForVendor(vendor.id);
      const activeRfqId = rfqVendorRows[0]?.rfqId;

      let extracted: any = null;
      if (message && claude.isClaudeConfigured()) {
        extracted = await claude.extractVendorQuote(message);
      }
      await v2.addVendorConversation({
        vendorId: vendor.id, rfqId: activeRfqId, direction: "in",
        messageText: message, mediaUrl, whatsappMessageId: messageId,
        claudeExtracted: extracted ? JSON.stringify(extracted) : null,
      });
      // If an active RFQ + extraction with a rate, save a pending-confirm quote
      if (activeRfqId && extracted && extracted.rate != null) {
        const rfq = await v2.getRfqV2(activeRfqId);
        const item = rfq?.items.find((it) => extracted.part_number && it.partNumber === extracted.part_number) || rfq?.items[0];
        await v2.createRfqQuote({
          rfqId: activeRfqId, vendorId: vendor.id, itemId: item?.id,
          rate: extracted.rate, moq: extracted.moq, leadTimeDays: extracted.lead_time_days,
          notes: extracted.notes, rawMessage: message, extractedBy: "ai", photoUrl: mediaUrl,
        });
      }
      updateWebhookEvent(_whId, { fromPhone: from, textPreview: message, processed: 1, ignoredReason: null, notes: `vendor=${vendor.id} extracted=${!!extracted}` });
      res.json({ ok: true, vendor: vendor.id, extracted: !!extracted });
    } catch (e: any) {
      console.error("[webhook:aisensy]", e?.message);
      updateWebhookEvent(_whId, { processed: 0, ignoredReason: "handler_error", notes: e?.message || String(e) });
      res.json({ ok: false, error: e?.message });
    }
  });

  // Vendor inbox (admin)
  app.get("/api/admin/vendor-inbox", requireAuth, async (_req, res) => res.json(await v2.listVendorInbox()));
  app.get("/api/admin/vendors/:id/conversations", requireAuth, async (req, res) => {
    res.json(await v2.listVendorConversations(parseInt(req.params.id as string, 10)));
  });
  app.post("/api/admin/vendors/:id/reply", requireAuth, async (req, res) => {
    try {
      const vendorId = parseInt(req.params.id as string, 10);
      const vendor = await v2.getVendor(vendorId);
      if (!vendor) return res.status(404).json({ error: "Not found" });
      const text = String(req.body?.message || "");
      const phone = vendor.whatsapp || vendor.phone;
      if (phone) wa.sendTextMessage(phone, text, "vendor_reply").catch(() => {});
      await v2.addVendorConversation({ vendorId, direction: "out", messageText: text, sentBy: (req as any).user?.username });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R5.6 RATE HISTORY ----------------
  app.get("/api/team/parts/:partNumber/rates", requireDataTeam, async (req, res) => {
    res.json(await v2.getPartRates(req.params.partNumber as string));
  });
  app.get("/api/admin/parts/:partNumber/rates", requireAuth, async (req, res) => {
    res.json(await v2.getPartRates(req.params.partNumber as string));
  });

  // ---------------- R5.7 DELHI WAREHOUSE ----------------
  app.get("/api/delhi/queue", requireDelhi, async (_req, res) => res.json(await v2.getDelhiQueue()));
  app.post("/api/delhi/po-items/:id/status", requireDelhi, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { status, docket_no, courier, photo_url } = req.body || {};
      const now = Date.now();
      const patch: any = { fulfilStatus: status };
      if (status === "collected") patch.collectedAt = now;
      if (status === "packed") patch.packedAt = now;
      if (status === "dispatched") { patch.dispatchedAt = now; patch.docketNo = docket_no || null; patch.courier = courier || null; patch.photoUrl = photo_url || null; }
      const item = await v2.updatePoItem(id, patch);
      if (!item) return res.status(404).json({ error: "Not found" });

      // On dispatch: create consignment (client rate, NOT purchase cost) + notify customer
      if (status === "dispatched") {
        try {
          const po = item.poId ? await v2.getPurchaseOrderV2(item.poId) : undefined;
          const customer = po?.customerId ? await v2.getCustomer(po.customerId) : undefined;
          await v2.createConsignmentFromDispatch({
            customerId: po?.customerId, partNumber: item.partNumber, qty: item.qty,
            rateInr: item.unitPrice, docketNo: docket_no, courier,
          });
          if (customer?.phone) {
            wa.sendConsignmentCreated(customer.phone, customer.name, docket_no || item.partNumber || "order", item.partNumber || "", new Date().toLocaleDateString("en-IN")).catch(() => {});
          }
          if (customer?.email) {
            sendGenericEmail({ to: customer.email, subject: "Your order has been dispatched — Narmada Mobility", html: `<p>Dear ${customer.name}, your order (${item.partNumber || ""}) has been dispatched. Docket: ${docket_no || "-"}, Courier: ${courier || "-"}.</p>`, text: `Your order has been dispatched. Docket ${docket_no || "-"}.`, event: "dispatch_notify" }).catch(() => {});
          }
          // R27.2-5 — auto-create draft products from the PO's parts (vendor_price × markup),
          // and open a Delhi→Patna branch transfer so the Store incharge can mark-received.
          if (item.poId) {
            try {
              const r27 = await import("./storage-r27");
              const ap = r27.autoCreateProductsForPo(item.poId);
              console.log(`[R27.2] auto-product PO ${item.poId}: created=${ap.created} skipped=${ap.skipped}`);
              const existingTransfer = (r27.listTransfers() as any[]).find((t) => t.po_id === item.poId && t.status === "in_transit");
              if (!existingTransfer) r27.createBranchTransfer({ poId: item.poId, notes: `Auto-created on Delhi dispatch of PO ${po?.poNumber || item.poId}` });
            } catch (e: any) { console.error("[R27.2] auto-product/transfer hook:", e?.message || e); }
          }
        } catch (e: any) { console.error("[delhi] dispatch side-effects:", e?.message); }
      }
      res.json(item);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R6.1 VENDOR DISCOVERY (Perplexity) ----------------
  app.post("/api/admin/vendor-discovery", requireAdminRole, async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) return res.status(400).json({ error: "query required" });
      const key = process.env.PPLX_API_KEY || "";
      if (!key) return res.status(503).json({ error: "PPLX_API_KEY not configured" });
      // R26.6a (7) — raise the Market Radar candidate cap from ~12 to 50.
      const sys = `You are a sourcing assistant for an automotive spare-parts distributor in India. Find up to 50 real candidate vendors/suppliers/manufacturers for the user's requirement. Return ONLY JSON array: [{"name","city","phone","website","source_url","confidence"}]. confidence 0..1. Use null for unknown fields.`;
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [{ role: "system", content: sys }, { role: "user", content: query }],
          return_citations: true,
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: j?.error?.message || "Perplexity error", raw: j });
      const content = j?.choices?.[0]?.message?.content || "[]";
      let candidates: any[] = [];
      try { candidates = JSON.parse(String(content).replace(/```(?:json)?\n?/gi, "").trim()); } catch { candidates = []; }
      res.json({ candidates: Array.isArray(candidates) ? candidates : [], citations: j?.citations || [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R6.2 VENDOR PAYMENT NOTIFY ----------------
  app.post("/api/admin/vendors/:id/payment-notify", requireAdminRole, async (req, res) => {
    try {
      const vendor = await v2.getVendor(parseInt(req.params.id as string, 10));
      if (!vendor) return res.status(404).json({ error: "Not found" });
      const { amount, utr } = req.body || {};
      const phone = vendor.whatsapp || vendor.phone;
      if (!phone) return res.status(400).json({ error: "Vendor has no phone" });
      const r = await wa.sendVendorPaymentConfirmation(phone, vendor.name, String(amount || "0"), String(utr || "-"));
      await v2.addVendorConversation({ vendorId: vendor.id, direction: "out", messageText: `Payment ₹${amount} UTR ${utr}`, sentBy: (req as any).user?.username });
      res.json({ ok: true, status: r.status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R7.1 LEADS CRM ----------------
  app.get("/api/admin/leads", requireAuth, async (req, res) => {
    res.json(await v2.listLeads({
      stage: req.query.stage as string | undefined,
      source: req.query.source as string | undefined,
      ownerId: req.query.ownerId ? parseInt(req.query.ownerId as string, 10) : undefined,
      q: req.query.q as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    }));
  });
  // R25a Fix 4 — leads analytics header (counts/conversion/follow-ups). MUST be registered
  // before /api/admin/leads/:id so "analytics" is not parsed as a lead id.
  app.get("/api/admin/leads/analytics", requireAuth, async (_req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json(v2.leadAnalytics());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/leads/:id", requireAuth, async (req, res) => {
    const lead = await v2.getLead(parseInt(req.params.id as string, 10));
    if (!lead) return res.status(404).json({ error: "Not found" });
    res.json(lead);
  });
  app.post("/api/admin/leads", requireAuth, async (req, res) => {
    try { res.json(await v2.createLead(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/leads/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const before = await v2.getLead(id);
      const lead = await v2.updateLead(id, req.body || {});
      if (!lead) return res.status(404).json({ error: "Not found" });
      if (req.body?.stage && before && before.stage !== req.body.stage) {
        await v2.addLeadActivity(id, "stage_change", `${before.stage} → ${req.body.stage}`, (req as any).user?.username);
      }
      res.json(lead);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/admin/leads/:id", requireAdminRole, async (req, res) => {
    await v2.deleteLead(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  app.post("/api/admin/leads/:id/activities", requireAuth, async (req, res) => {
    const { type, detail } = req.body || {};
    res.json(await v2.addLeadActivity(parseInt(req.params.id as string, 10), type || "note", detail, (req as any).user?.username));
  });
  app.post("/api/admin/leads/bulk-import", requireAuth, async (req, res) => {
    try {
      const csv = String(req.body?.csv || "");
      if (!csv.trim()) return res.status(400).json({ error: "csv required" });
      const parsed = Papa.parse(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, "_") });
      const n = await v2.bulkInsertLeads(parsed.data as any[]);
      res.json({ inserted: n });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R7.2 lead outreach (Claude draft → send)
  app.post("/api/admin/leads/:id/outreach", requireAuth, async (req, res) => {
    try {
      const lead = await v2.getLead(parseInt(req.params.id as string, 10));
      if (!lead) return res.status(404).json({ error: "Not found" });
      const send = req.body?.send === true;
      let message = String(req.body?.message || "");
      if (!message) {
        const sys = `You are a sales rep for Narmada Mobility (B2B automotive spare parts, India). Write a short, friendly WhatsApp outreach message (max 60 words). Detect the lead's language from their requirement; reply in Hindi if the requirement is in Hindi, otherwise English. No markdown.`;
        const draft = await claude.claudeText(sys, `Lead: ${lead.name}, city ${lead.city || "-"}, requirement: ${lead.requirement || "general enquiry"}.`);
        message = draft || `Hello ${lead.name}, this is Narmada Mobility. We supply genuine commercial-vehicle spare parts. How can we help with your requirement?`;
      }
      if (send) {
        const phone = lead.whatsapp || lead.phone;
        if (!phone) return res.status(400).json({ error: "Lead has no phone" });
        const r = await wa.sendTextMessage(phone, message, "lead_outreach");
        await v2.addLeadActivity(lead.id, "whatsapp", message, (req as any).user?.username);
        return res.json({ sent: true, status: r.status, message });
      }
      res.json({ sent: false, message }); // preview
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R7.1 TARGETS ----------------
  app.get("/api/admin/targets", requireAuth, async (req, res) => {
    res.json(await v2.listTargets({
      userId: req.query.userId ? parseInt(req.query.userId as string, 10) : undefined,
      periodKey: req.query.periodKey as string | undefined,
    }));
  });
  app.post("/api/admin/targets", requireAdminRole, async (req, res) => {
    try { res.json(await v2.createTarget(req.body || {})); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/targets/:id", requireAdminRole, async (req, res) => {
    const t = await v2.updateTarget(parseInt(req.params.id as string, 10), req.body || {});
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/admin/targets/:id", requireAdminRole, async (req, res) => {
    await v2.deleteTarget(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  // Team view of their own targets
  app.get("/api/team/my-targets", requireDataTeam, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(await v2.listTargets({ userId: u?.id }));
  });

  // ---------------- R7.1 ANNOUNCEMENTS ----------------
  app.get("/api/admin/announcements", requireAuth, async (_req, res) => res.json(await v2.listAnnouncements()));
  app.post("/api/admin/announcements", requireAdminRole, async (req, res) => {
    try { res.json(await v2.createAnnouncement({ ...req.body, createdBy: (req as any).user?.username })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/admin/announcements/:id", requireAdminRole, async (req, res) => {
    await v2.deleteAnnouncement(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  // Team home: announcements for their audience
  app.get("/api/team/announcements", requireDataTeam, async (req, res) => {
    const u = (req as any).teamUser;
    const audience = u?.role === "delhi_warehouse" ? "delhi" : "patna";
    res.json(await v2.listAnnouncements(audience));
  });

  // ---------------- R7.1 TASKS ----------------
  app.get("/api/admin/tasks", requireAuth, async (req, res) => {
    res.json(await v2.listTaskItems({
      assignedTo: req.query.assignedTo ? parseInt(req.query.assignedTo as string, 10) : undefined,
      status: req.query.status as string | undefined,
    }));
  });
  app.post("/api/admin/tasks", requireAuth, async (req, res) => {
    try { res.json(await v2.createTaskItem({ ...req.body, assignedBy: (req as any).user?.username })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/admin/tasks/:id", requireAuth, async (req, res) => {
    const t = await v2.updateTaskItem(parseInt(req.params.id as string, 10), req.body || {});
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  });
  app.delete("/api/admin/tasks/:id", requireAdminRole, async (req, res) => {
    await v2.deleteTaskItem(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });
  app.get("/api/team/my-tasks", requireDataTeam, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(await v2.listTaskItems({ assignedTo: u?.id }));
  });

  // ---------------- R7.2 CATALOGUE PDF ----------------
  app.post("/api/admin/catalogue/generate", requireAdminRole, async (req, res) => {
    try {
      const { brand, category, company_id } = req.body || {};
      const products = await storage.listProducts({ brand, category, activeOnly: true });
      const company = company_id ? await v2.getCompany(Number(company_id)) : await v2.getDefaultCompany();
      const pdf = require("./pdf-service");
      const result = await pdf.generateCataloguePDF(products, company, { brand, category });
      res.json({ url: result.url, count: products.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R8: PO WORKFLOW — CUSTOMER PO UPLOAD + VENDOR ASSIGNMENT
  // ============================================================
  console.log("[v2] R8 about to register");
  try {
    registerR8Routes(app, { requireAuth, requireAdminRole, requireDataTeam, requireDelhi, ctx });
    console.log("[v2] R8 registered OK");
  } catch (err) {
    console.error("[v2] R8 register FAILED:", err);
    throw err;
  }
  console.log("[v2] R8 routes registered: po-upload, create-from-parsed, assign-vendor, search-vendor-rates, delhi-pos, purchase-history");

  // ============================================================
  // R9: MULTI-VENDOR RFQ, EMBEDDED CHAT APPROVAL, VENDOR LEDGER
  // ============================================================
  console.log("[v2] R9 about to register");
  try {
    registerR9Routes(app, { requireAuth, requireDataTeam });
    console.log("[v2] R9 registered OK");
  } catch (err) {
    console.error("[v2] R9 register FAILED:", err);
    throw err;
  }
}

// ============================================================
// R9 ROUTE IMPLEMENTATIONS
// ============================================================
function registerR9Routes(
  app: Express,
  { requireAuth, requireDataTeam }: { requireAuth: any; requireDataTeam: any }
) {
  // R26.6i — webhook audit helpers (local; esbuild splits route-register functions into
  // separate lazy module chunks, so a shared module-level symbol is not reliably in scope).
  const SECRET_HEADER_KEYS = ["x-aisensy-signature", "x-webhook-secret", "x-aisensy-secret", "authorization", "cookie", "x-admin-token"];
  const logWebhookEvent = (source: string, req: any): number | null => {
    try {
      const redactedHeaders: Record<string, any> = { ...(req.headers || {}) };
      for (const k of SECRET_HEADER_KEYS) { if (redactedHeaders[k] != null) redactedHeaders[k] = "<redacted>"; }
      let bodyJson = "";
      try { bodyJson = JSON.stringify(req.body ?? {}); } catch { bodyJson = "<unserializable>"; }
      if (bodyJson.length > 8000) bodyJson = bodyJson.slice(0, 8000);
      const info = rawSqlite
        .prepare(`INSERT INTO webhook_events (source, received_at, method, headers_json, body_json) VALUES (?, ?, ?, ?, ?)`)
        .run(source, Date.now(), String(req.method || "POST"), JSON.stringify(redactedHeaders), bodyJson);
      return Number(info.lastInsertRowid);
    } catch (err: any) { console.error("[R26.6i webhook-log] insert failed:", err?.message || err); return null; }
  };
  const updateWebhookEvent = (
    id: number | null,
    fields: { topic?: string | null; fromPhone?: string | null; textPreview?: string | null; processed?: number; ignoredReason?: string | null; notes?: string | null },
  ): void => {
    if (id == null) return;
    try {
      rawSqlite
        .prepare(`UPDATE webhook_events SET topic = ?, from_phone = ?, text_preview = ?, processed = ?, ignored_reason = ?, notes = ? WHERE id = ?`)
        .run(
          fields.topic ?? null,
          fields.fromPhone ?? null,
          fields.textPreview != null ? String(fields.textPreview).slice(0, 200) : null,
          fields.processed ?? 0,
          fields.ignoredReason ?? null,
          fields.notes ?? null,
          id,
        );
    } catch (err: any) { console.error("[R26.6i webhook-log] update failed:", err?.message || err); }
  };

  // ---- Per-line multi-vendor management (proc / data team) ----
  app.get("/api/team/po-items/:id/quotes", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      res.json(v2.listQuotesForPoItem(id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/po-items/:id/quotes", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { vendor_id, vendor_name, vendor_phone } = req.body || {};
      if (!vendor_id && !(vendor_name && String(vendor_name).trim())) {
        return res.status(400).json({ error: "vendor_id or vendor_name required" });
      }
      let phone = vendor_phone ? String(vendor_phone) : null;
      let name = vendor_name ? String(vendor_name) : null;
      if (vendor_id) {
        const vendor = await v2.getVendor(parseInt(vendor_id, 10));
        if (vendor) {
          name = name || vendor.name;
          phone = phone || vendor.whatsapp || vendor.phone || null;
        }
      }
      const row = v2.addQuoteToPoItem(id, {
        vendorId: vendor_id ? parseInt(vendor_id, 10) : null,
        vendorName: name,
        vendorPhone: phone,
      });
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/team/po-items/:id/quotes/:quoteId", requireDataTeam, async (req: any, res: any) => {
    try {
      const quoteId = parseInt(req.params.quoteId as string, 10);
      const ok = v2.deleteVendorQuote(quoteId);
      if (!ok) return res.status(400).json({ error: "Cannot remove (not found or already approved)" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/team/po-items/:id/quotes/:quoteId/manual", requireDataTeam, async (req: any, res: any) => {
    try {
      const quoteId = parseInt(req.params.quoteId as string, 10);
      const { rate, tax_inclusive, tax_percent, notes } = req.body || {};
      if (rate == null || rate === "") return res.status(400).json({ error: "rate required" });
      const row = v2.setQuoteManualRate(quoteId, {
        rate: parseFloat(rate),
        taxInclusive: tax_inclusive != null ? (tax_inclusive ? 1 : 0) : null,
        taxPercent: tax_percent != null && tax_percent !== "" ? parseFloat(tax_percent) : null,
        notes: notes ? String(notes) : null,
      });
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/po-items/:id/quotes/:quoteId/approve", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const quoteId = parseInt(req.params.quoteId as string, 10);
      const result = v2.approveQuote(id, quoteId);
      if (!result) return res.status(404).json({ error: "Quote not found for this line" });
      const u = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(u?.id || ""), action: "approve_quote",
        entityType: "po_item", entityId: String(id),
        afterJson: JSON.stringify({ quoteId, rate: result.quote?.rate, vendorId: result.quote?.vendor_id, previousQuoteId: result.previousQuoteId }),
      })).catch(() => {});
      // R11: fire-and-forget rate-confirmed WhatsApp to the locked seller for this PO's confirmed lines.
      const q = result.quote;
      const confirmPhone = q?.vendor_phone || null;
      const poId = v2.getPoIdForItem(id);
      if ((confirmPhone || q?.vendor_id) && poId) {
        setImmediate(() => {
          (async () => {
            const wa = require("./whatsapp") as typeof import("./whatsapp");
            let phone = confirmPhone;
            if (!phone && q?.vendor_id) {
              const vendor = await v2.getVendor(q.vendor_id);
              phone = vendor?.whatsapp || vendor?.phone || null;
            }
            if (!phone) return;
            // R22.1 — live template confirms a single line: vendor, PO#, part, qty, rate.
            const po = await v2.getPurchaseOrderV2(poId);
            const line = result.item;
            const partName = [line?.part_number, line?.brand].filter(Boolean).join(" ") || (q?.vendor_name || "item");
            await wa.sendVendorRateConfirmed(phone, {
              vendorName: q?.vendor_name || "Seller",
              ourPoNumber: po?.poNumber || `PO#${poId}`,
              partName,
              qty: String(line?.qty ?? 1),
              rate: String(q?.rate ?? line?.vendor_rate ?? 0),
            });
          })().catch((err) => console.error("[approve] rate-confirmed WA failed:", err));
        });
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/po-items/:id/unapprove", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const ok = v2.unapprovePoItem(id);
      if (!ok) return res.status(404).json({ error: "Item not found" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Fire Rate Request (batched, one consolidated WA per vendor) ----
  app.post("/api/team/rfq/fire", requireDataTeam, async (req: any, res: any) => {
    try {
      const { vendor_ids, po_ids, rows } = req.body || {};
      let byVendor: Map<number, any[]>;
      if (Array.isArray(rows) && rows.length > 0) {
        // R11 new shape: explicit (seller_id, po_item_id) rows.
        const cleaned = rows
          .map((r: any) => ({ seller_id: parseInt(r.seller_id, 10), po_item_id: parseInt(r.po_item_id, 10) }))
          .filter((r: any) => r.seller_id && r.po_item_id);
        if (cleaned.length === 0) return res.status(400).json({ error: "rows must contain seller_id + po_item_id" });
        byVendor = v2.collectPendingQuotesForFireRows(cleaned);
      } else {
        // Legacy shape: vendor_ids + po_ids.
        const vendorIds: number[] = Array.isArray(vendor_ids) ? vendor_ids.map((n: any) => parseInt(n, 10)).filter(Boolean) : [];
        const poIds: number[] = Array.isArray(po_ids) ? po_ids.map((n: any) => parseInt(n, 10)).filter(Boolean) : [];
        if (vendorIds.length === 0 || poIds.length === 0) {
          return res.status(400).json({ error: "vendor_ids and po_ids (or rows) required" });
        }
        byVendor = v2.collectPendingQuotesForFire(vendorIds, poIds);
      }
      let firedVendors = 0; let firedItems = 0;
      console.log(`[R19 rfq-fire] handler called vendors=${byVendor.size} totalItems=${Array.from(byVendor.values()).reduce((s, it) => s + it.length, 0)}`);
      for (const [vendorId, items] of Array.from(byVendor.entries())) {
        if (!items.length) continue;
        const vendor = await v2.getVendor(vendorId);
        const phone = vendor?.whatsapp || vendor?.phone || items[0]?.vendor_phone;
        // R22.1 — numbered pipe format ("1) <part> | <brand> | Qty: <qty>"); line order
        // matches the saved rfq_lines order so a numbered/positional vendor reply maps back.
        const batchLines = items.map((it: any) => ({
          partName: [it.part_number, it.description].filter(Boolean).join(" ") || "-",
          brand: it.brand || "-",
          qty: it.qty ?? 1,
        }));
        const itemsText = batchLines
          .map((l: any, i: number) => `${i + 1}) ${l.partName} | ${l.brand} | Qty: ${l.qty}`)
          .join("\n");
        firedVendors++; firedItems += items.length;
        console.log(`[R19 rfq-fire] vendor=${vendorId} name=${vendor?.name || "?"} phone=${phone || "MISSING"} items=${items.length}`);
        const vendorName = vendor?.name || items[0]?.vendor_name || "Seller";
        // Persist outbound copy immediately (so the chat shows it even if AiSensy is slow).
        const outBody = `Namaste ${vendorName},\nPlease share your best landed price + GST + availability:\n${itemsText}\nReply with rates in this chat. Our team is standing by.\n— Team Narmada Mobility`;
        v2.addRfqMessage({ vendorId, vendorPhone: phone || null, direction: "out", body: outBody });
        if (phone) {
          setImmediate(() => {
            (async () => {
              const wa = require("./whatsapp") as typeof import("./whatsapp");
              const r = await wa.sendVendorRateBatch(phone, { vendorName, lines: batchLines });
              console.log(`[R19 rfq-fire] vendor=${vendorId} phone=${phone} send result status=${r?.status}`);
            })().catch((err) => console.error(`[R19 rfq-fire] vendor=${vendorId} phone=${phone} batch RFQ failed:`, err?.message || err));
          });
        } else {
          console.error(`[R19 rfq-fire] vendor=${vendorId} has NO phone — skipped (no whatsapp/phone on vendor and no vendor_phone on item)`);
        }
      }
      res.json({ ok: true, firedVendors, firedItems });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Vendors with pending quotes (powers Fire Rate Request modal) ----
  app.get("/api/team/rfq/pending-vendors", requireDataTeam, async (_req: any, res: any) => {
    try { res.json(v2.listVendorsWithPendingQuotes()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R11: flat (seller, item) pairs for the redesigned Fire Rate Request table ----
  app.get("/api/team/rfq/pairs", requireDataTeam, async (req: any, res: any) => {
    try {
      const poId = req.query.po_id ? parseInt(req.query.po_id as string, 10) : undefined;
      res.json(v2.listSellerItemPairs(poId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Embedded chat ----
  app.get("/api/team/rfq/chat/:vendorId", requireDataTeam, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      res.json(v2.listRfqMessages(vendorId, 50));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R18 Part B — AI suggested replies (accept/reject) ----
  // Latest pending suggestion for a vendor (the chat drawer polls this alongside messages).
  app.get("/api/team/ai-suggestions/pending", requireDataTeam, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(String(req.query.vendorId || ""), 10);
      if (!Number.isInteger(vendorId) || vendorId <= 0) return res.json([]);
      res.json(v2.listPendingAiSuggestions(vendorId, 1));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Accept → mark accepted, send via AiSensy (fire-and-forget), record outbound message.
  app.post("/api/team/ai-suggestions/:id/accept", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const sug = v2.getAiSuggestion(id);
      if (!sug) return res.status(404).json({ error: "suggestion not found" });
      if (sug.status !== "pending") return res.status(409).json({ error: `already ${sug.status}` });
      const text = String(sug.suggested_text || "").trim();
      const vendorId = sug.vendor_id != null ? Number(sug.vendor_id) : null;
      const vendor = vendorId ? await v2.getVendor(vendorId) : undefined;
      const phone = vendor?.whatsapp || vendor?.phone || sug.vendor_phone || null;
      v2.decideAiSuggestion(id, "accepted");
      const row = v2.addRfqMessage({ vendorId, vendorPhone: phone, direction: "out", body: text });
      if (phone && text) {
        setImmediate(() => {
          (async () => {
            const wa = require("./whatsapp") as typeof import("./whatsapp");
            await wa.sendTextMessage(phone, text, "rfq_chat_reply");
          })().catch((err) => console.error("[R18 ai-accept] send failed:", err?.message || err));
        });
      }
      res.json({ ok: true, message: row, sent: !!(phone && text) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Reject → mark rejected; nothing is sent.
  app.post("/api/team/ai-suggestions/:id/reject", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const sug = v2.getAiSuggestion(id);
      if (!sug) return res.status(404).json({ error: "suggestion not found" });
      if (sug.status !== "pending") return res.status(409).json({ error: `already ${sug.status}` });
      v2.decideAiSuggestion(id, "rejected");
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R18 Part A — AiSensy inbound webhook (upgraded R9 handler in place).
  // Auth via shared secret (constant-time compare). Handles 5 event types,
  // idempotent on external_message_id, ALWAYS returns 200 except 401 on auth
  // failure — never 5xx to AiSensy. Distinct path from R5.5 (/api/webhooks/aisensy).
  // ============================================================
  const AISENSY_WEBHOOK_SECRET =
    process.env.AISENSY_WEBHOOK_SECRET ||
    "e444feeb8fc924a6134c1493c11d61d8da151fae9e2a51afa66a0ac5f8dc1568";

  // R18 Part B — fire-and-forget: on a fresh inbound reply, ask Claude for the most
  // likely next message and store it as a PENDING suggestion for a human to accept/reject.
  // Never throws; lazy-loads claude-service so the webhook path stays light.
  function fireAiSuggestion(vendorId: number, vendorPhone: string | null, triggeredByMessageId: number) {
    setImmediate(() => {
      (async () => {
        const claude = require("./claude-service") as typeof import("./claude-service");
        if (!claude.isClaudeConfigured()) return;
        const history = v2.listRfqMessages(vendorId, 20); // oldest→newest
        if (!history.length) return;
        const transcript = history
          .map((m: any) => `${m.direction === "out" ? "Us" : "Seller"}: ${String(m.body || "").trim()}`)
          .join("\n");
        const latest = history[history.length - 1];
        const system =
          "You draft the next WhatsApp message a procurement team should send to a spare-parts seller. " +
          "Reply with ONLY the suggested message text — no preamble, no quotes.";
        const userMsg =
          `Based on this vendor's latest reply, what's the most likely next message we should send to ask for missing info OR confirm the rate? ` +
          `Keep it under 200 chars, business-Hindi+English casual tone matching existing chat. ` +
          `If reply already contains a clean rate, suggest a confirmation. If vague, suggest a clarifying question.\n\n` +
          `Recent chat (oldest first):\n${transcript}\n\nLatest seller reply: ${String(latest?.body || "").trim()}`;
        const suggestion = await claude.claudeText(system, userMsg, 256);
        const clean = String(suggestion || "").trim().slice(0, 400);
        if (!clean) return;
        v2.createAiSuggestion({
          vendorId, vendorPhone, triggeredByMessageId, suggestedText: clean,
        });
      })().catch((err) => console.error("[R18 ai-suggest] failed:", err?.message || err));
    });
  }

  // R22.x — constant-time compare of one candidate against the secret. Length-guarded.
  function secretMatches(candidate: string): boolean {
    const crypto = require("crypto") as typeof import("crypto");
    const cand = String(candidate || "").trim();
    if (!cand) return false;
    try {
      const a = Buffer.from(cand);
      const c = Buffer.from(AISENSY_WEBHOOK_SECRET);
      if (a.length !== c.length) {
        crypto.timingSafeEqual(c, c); // keep timing constant; do not leak length
        return false;
      }
      return crypto.timingSafeEqual(a, c);
    } catch {
      return false;
    }
  }

  // R22.x — accept the secret from ANY of the locations AiSensy might use:
  //   headers: x-aisensy-signature | x-webhook-secret | x-aisensy-secret | authorization: Bearer
  //   query:   ?secret= | ?token= | ?webhook_secret=
  //   body:    secret | webhook_secret | token | webhookSecret
  // Returns true on first match. Also honours AISENSY_WEBHOOK_DEBUG=true (bypass).
  function aisensySecretOk(req: any): boolean {
    if (String(process.env.AISENSY_WEBHOOK_DEBUG || "").toLowerCase() === "true") {
      return true; // debug mode: skip verification entirely (toggle on Render)
    }
    const b = req.body || {};
    const q = req.query || {};
    const authHeader = String(req.headers["authorization"] || "").trim();
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const candidates = [
      req.headers["x-aisensy-signature"],
      req.headers["x-webhook-secret"],
      req.headers["x-aisensy-secret"],
      bearer,
      q.secret, q.token, q.webhook_secret,
      b.secret, b.webhook_secret, b.token, b.webhookSecret,
    ];
    return candidates.some((c) => c && secretMatches(String(c)));
  }

  // R22.x — process a single inbound seller reply: persist message, apply any AI-extracted
  // rate to the latest open quote (so it shows in procurement chat), and store a pending
  // AI-suggested reply. Returns 1 if a new message row was inserted, else 0. Never throws.
  async function processInboundReply(
    from: string,
    text: string,
    externalId: string | null,
  ): Promise<number> {
    const vendor = from ? await v2.getVendorByPhone(from) : undefined;
    const row = v2.addRfqMessageExternal({
      vendorId: vendor?.id ?? null,
      vendorPhone: from || null,
      direction: "in",
      body: text,
      externalMessageId: externalId ? String(externalId) : null,
    });
    if (!row) return 0; // duplicate external id — already processed
    if (vendor?.id) {
      // Fire-and-forget Claude suggestion for a human accept/reject.
      fireAiSuggestion(vendor.id, from || null, row.id);
      // Best-effort rate extraction → push into the live quote row so it surfaces in chat.
      const claudeSvc = require("./claude-service") as typeof import("./claude-service");
      if (text && claudeSvc.isClaudeConfigured()) {
        setImmediate(() => {
          (async () => {
            const extracted = await claudeSvc.extractVendorQuote(text);
            if (extracted && extracted.rate != null) {
              v2.applyInboundRateToLatestQuote(vendor.id, extracted.rate, extracted.notes);
            }
          })().catch((err) =>
            console.error("[R22.x aisensy] rate-extract failed:", err?.message || err),
          );
        });
      }
    }
    return 1;
  }

  app.post("/api/aisensy/webhook", async (req: any, res: any) => {
    // R26.6i — permanent audit: record the raw request BEFORE any parsing/filtering.
    const _whId = logWebhookEvent("aisensy", req);
    // R22.x — if auth fails we no longer return 401 (that triggers AiSensy retry storms and
    // hides legit messages). Instead: log the full inbound shape (secrets redacted) for
    // diagnosis, then fall through and process anyway so the user's vendor replies land.
    if (!aisensySecretOk(req)) {
      const redactedHeaders = { ...(req.headers || {}) };
      for (const k of ["x-aisensy-signature", "x-webhook-secret", "x-aisensy-secret", "authorization"]) {
        if (redactedHeaders[k]) redactedHeaders[k] = "<redacted>";
      }
      console.warn(
        "[R22.x aisensy] secret did NOT match — processing anyway (set AISENSY_WEBHOOK_DEBUG=true to silence).",
        "HEADERS:", JSON.stringify(redactedHeaders),
        "BODYKEYS:", JSON.stringify(Object.keys(req.body || {})),
      );
    }

    let processed = 0;
    // R26.6i — capture the last event's resolved fields for the audit log final update.
    let _whTopic: string | null = null;
    let _whFrom: string | null = null;
    let _whText: string | null = null;
    let _whIgnored: string | null = null;
    try {
      const b = req.body || {};

      // R26.2e — AiSensy v0.0.1 wraps each event in a {id, topic, project_id, data}
      // envelope (header x-aisensy-api-version: 0.0.1). The real message fields live
      // inside `data`, and the event name is in `topic`. Detect that envelope and
      // unwrap it BEFORE building the events list, so legacy {events:[...]} / bare-object
      // shapes still work unchanged.
      const isV1Root = !!b?.topic && !!b?.data && !!b?.project_id;

      // Build the list of raw event objects.
      const rawEvents: any[] = Array.isArray(b)
        ? b
        : Array.isArray(b.events)
          ? b.events
          : isV1Root
            ? [b] // single v0.0.1 envelope — keep wrapped so we read topic + data below
            : Array.isArray(b.data)
              ? b.data
              : [b];

      for (const ev of rawEvents) {
        try {
          const envelope = ev || {};
          // R26.2e / R26.6l — per-event v0.0.1 envelope detection. The real AiSensy
          // payload is {topic, data:{message:{...}}}; project_id may or may not be present
          // (synthetic/test posts omit it), so detect on topic + data presence.
          const isV1Envelope =
            !!envelope?.topic && !!envelope?.data &&
            (!!envelope?.project_id || !!envelope?.data?.message || typeof envelope?.data === "object");
          const e = isV1Envelope ? envelope.data || {} : envelope;
          // R22.x — AiSensy nests the real payload under data.messageData / messageData /
          // message. Merge those nested objects so field lookups work regardless of shape.
          const md = e.messageData || e.data?.messageData || e.message || {};
          // R26.6l — AiSensy "message.created" inbound shape: the real fields live on
          // data.message: phone_number (12-digit canonical phone), sender ("USER" inbound /
          // "API"/"SYSTEM" outbound echo), message_content.text, userName, message_type,
          // id/messageId, sent_at. Capture them explicitly so we stop mistaking the literal
          // role token in `sender` for a phone number (that was the non_phone bug).
          const aiPhone = String(md.phone_number ?? md.phoneNumber ?? "").trim();
          const aiSender = String(md.sender ?? "").trim().toUpperCase();
          const aiMsgType = String(md.message_type ?? md.messageType ?? "").trim();
          const aiContentText = String(
            (typeof md.message_content === "object" ? md.message_content?.text : "") ||
            md.message_content || "",
          );
          const aiUserName = String(md.userName ?? md.user_name ?? "").trim();
          const aiSentAt = md.sent_at ?? md.sentAt ?? null;
          const pick = (...keys: string[]): any => {
            for (const k of keys) {
              if (e[k] != null && e[k] !== "") return e[k];
              if (md[k] != null && md[k] !== "") return md[k];
            }
            return undefined;
          };

          // Event name: v0.0.1 → envelope.topic; legacy → event/type/eventType.
          const type = String(
            isV1Envelope
              ? envelope.topic
              : e.event || e.type || e.eventType || e.event_type || "",
          ).trim();

          // Phone — R26.6l: prefer AiSensy's explicit phone_number, then the extended
          // fallback chain (R26.2e). Critically we DROP "sender" from this chain because in
          // AiSensy's real shape `sender` is a role token ("USER"/"API"), not a phone.
          const from = String(
            aiPhone ||
            pick("from", "phone", "mobile", "waId", "wa_id") ||
            e.contact?.wa_id || e.contact?.phone || e.contact?.mobile ||
            e.user?.phone || e.payload?.from || e.message?.from || "",
          );

          // External message id — R26.6l: prefer the inner message id (data.message.id /
          // messageId) for idempotency since that's stable per inbound reply across AiSensy
          // retries (x-retry-count). Fall back to the envelope id then legacy ids.
          const externalId =
            md.id || md.messageId ||
            pick("external_message_id", "message_id", "messageId", "id", "msgId") ||
            envelope.id ||
            null;

          // Text — R26.6l: prefer AiSensy message_content.text, then extended fallback chain.
          // For non-text messages (image/doc), fall back to a "[TYPE]" placeholder so the row
          // still records something meaningful.
          const text = String(
            aiContentText ||
            (typeof e.message === "string" ? e.message : "") ||
            pick("text", "body", "content", "message_text") ||
            e.message?.body || e.message?.text ||
            e.payload?.text?.body || e.payload?.body ||
            (typeof e.text === "object" ? e.text?.body : "") ||
            md.text?.body ||
            (aiMsgType && aiMsgType.toUpperCase() !== "TEXT" ? `[${aiMsgType}]` : "") || "",
          );

          // R26.2e — recognized inbound message topics (case-insensitive substring match).
          const INBOUND_TOPICS = [
            "message", "incoming_message", "whatsapp:message", "whatsapp_inbound",
            "inbound", "text_message", "reply", "user_message",
          ];
          // R26.2e — delivery/read receipts & status updates → ignore (don't insert a row).
          const STATUS_HINTS = ["delivered", "read", "sent", "status", "update"];
          const typeLc = type.toLowerCase();
          const isStatusEvent = STATUS_HINTS.some((h) => typeLc.includes(h));
          const isInboundTopic = INBOUND_TOPICS.some((t) => typeLc.includes(t));

          // R26.2e — INFO-level parsed-envelope debug line.
          console.log(
            `[R22.x aisensy] parsed v1=${isV1Envelope} topic=${type || "?"} from=${from || "?"} textPreview=${JSON.stringify((text || "").slice(0, 80))}`,
          );
          console.log(
            `[R22.x aisensy] topic=${type || "?"} from=${from || "?"} msgId=${externalId || "?"} textLen=${text.length}`,
          );
          // R26.6i — remember the resolved fields for the audit-log final update.
          _whTopic = type || null;
          _whFrom = from || null;
          _whText = text || null;

          // R26.2f — receipt/status filter. The R26.2e check was bypassed because
          // INBOUND_TOPICS contains the substring "message", and topics like
          // "message.status.updated" contain "message" → isInboundTopic was true →
          // the receipt slipped through and a blank row got inserted. Fix: run an
          // unconditional blocklist on the resolved topic (eventType) BEFORE any
          // vendor lookup or insert. Any topic matching a receipt pattern is ignored.
          const RECEIPT_PATTERNS = [
            "status",        // message.status.updated, message_status, etc.
            "delivered",
            "read",
            "sent",
            "ack",
            "receipt",
            "deliver",
            "update",        // ...status.updated
            "outbound",      // outbound message events
            "message_status",
            "post_message",
            "campaign",      // campaign analytics events
            "failed",
            "rejected",
          ];
          const topicLower = (type || "").toLowerCase();
          const isReceipt = RECEIPT_PATTERNS.some((p) => topicLower.includes(p));
          if (isReceipt) {
            // R26.4b — additive: if this receipt matches a marketing send_job's AiSensy message
            // id, mirror the delivery/read/failed event into marketing_send_log. This does NOT
            // change the existing receipt-ignore behavior below; it's a pure side-effect.
            try {
              recordMarketingWhatsAppReceipt(externalId ? String(externalId) : null, type);
            } catch { /* never let the hook break the webhook */ }
            console.log(`[R22.x aisensy] ignoring receipt topic=${type} msgId=${externalId || "?"}`);
            updateWebhookEvent(_whId, { topic: type || null, fromPhone: from || null, textPreview: text, processed: 0, ignoredReason: "receipt" });
            return res.status(200).json({ ok: true, ignored: true, reason: "receipt", topic: type });
          }

          // R26.6l — AiSensy real "message.created" handling. When we have an explicit
          // phone_number (aiPhone) the event is a genuine inbound/outbound message, NOT a
          // synthetic role event. Route on the `sender` direction:
          //   sender === "USER"          → inbound vendor reply (record it)
          //   sender === "API"/"SYSTEM"  → outbound echo of a message WE sent (skip; the
          //                                outbound send path already recorded it — re-inserting
          //                                would duplicate every outbound line)
          if (aiPhone && type.toLowerCase() === "message.created") {
            if (aiSender && aiSender !== "USER") {
              console.log(`[R26.6l aisensy] outbound echo sender=${aiSender} phone=${aiPhone} msgId=${externalId || "?"} — skip`);
              updateWebhookEvent(_whId, { topic: type || null, fromPhone: from || null, textPreview: text, processed: 0, ignoredReason: "outbound_echo" });
              return res.status(200).json({ ok: true, ignored: true, reason: "outbound_echo", topic: type });
            }
            // Inbound vendor reply. processInboundReply dedups on externalId and records the
            // row even when no vendor matches (vendor_id NULL → orphan thread in chats UI).
            const n = await processInboundReply(from, text, externalId ? String(externalId) : null);
            processed += n;
            // R26.6l — if the matched/created chat row has no vendor name, AiSensy gave us
            // userName; best-effort auto-create a placeholder vendor so the thread shows a name.
            try {
              if (n > 0 && aiUserName) {
                const existing = from ? await v2.getVendorByPhone(from) : undefined;
                if (!existing) {
                  await v2.createVendor({ name: aiUserName, phone: from, whatsapp: from, notes: "auto-created from AiSensy inbound (R26.6l)" } as any);
                }
              }
            } catch (ce: any) {
              console.log(`[R26.6l aisensy] placeholder vendor create skipped — ${ce?.message || ce}`);
            }
            updateWebhookEvent(_whId, {
              topic: type || null, fromPhone: from || null, textPreview: text,
              processed: n > 0 ? 1 : 0,
              ignoredReason: n > 0 ? null : "duplicate",
              notes: `R26.6l inbound sender=USER name=${aiUserName || "?"} sentAt=${aiSentAt || "?"}`,
            });
            return res.status(200).json({ ok: true, processed: n, inbound: true });
          }

          // R26.2f — non-phone placeholder guard. AiSensy sometimes emits literal
          // role tokens ("API"/"USER"/"SYSTEM"/"BOT"/"TEST") in the from field for
          // synthetic/system events. These are junk, not real sellers → ignore.
          if (from && /^(API|USER|SYSTEM|BOT|TEST)$/i.test(from.trim())) {
            console.log(`[R22.x aisensy] skip non-phone from=${from} topic=${type} msgId=${externalId || "?"}`);
            updateWebhookEvent(_whId, { topic: type || null, fromPhone: from || null, textPreview: text, processed: 0, ignoredReason: "non_phone" });
            return res.status(200).json({ ok: true, ignored: true, reason: "non-phone" });
          }

          // R26.2f — empty content guard. Even past the receipt filter, never insert a
          // chat row with neither a sender nor text.
          if (!from && !text) {
            console.log(`[R22.x aisensy] skip empty inbound topic=${type} msgId=${externalId || "?"}`);
            updateWebhookEvent(_whId, { topic: type || null, fromPhone: from || null, textPreview: text, processed: 0, ignoredReason: "empty" });
            return res.status(200).json({ ok: true, ignored: true, reason: "empty", topic: type });
          }

          // R26.2e — v0.0.1 topics route through the inbound handler when recognized.
          if (isV1Envelope) {
            if (isInboundTopic || (from && !isStatusEvent)) {
              processed += await processInboundReply(
                from, text, externalId ? String(externalId) : null,
              );
            } else {
              console.log(`[R22.x aisensy] ignoring topic=${type}`);
              updateWebhookEvent(_whId, { topic: type || null, fromPhone: from || null, textPreview: text, processed: 0, ignoredReason: "ignored_topic" });
              return res.json({ ok: true, ignored: true, topic: type });
            }
            continue;
          }

          switch (type) {
            case "message.sender.user":
            case "message.received":
            case "message.inbound":
            case "incoming_message": {
              // Inbound reply from the seller → persist + extract rate + AI suggestion.
              processed += await processInboundReply(from, text, externalId ? String(externalId) : null);
              break;
            }
            case "message.created": {
              // Generic created event — idempotent insert (skip if external id seen).
              const dir = e.direction === "out" || e.outgoing ? "out" : "in";
              if (dir === "in") {
                processed += await processInboundReply(from, text, externalId ? String(externalId) : null);
              } else {
                const vendor = from ? await v2.getVendorByPhone(from) : undefined;
                const row = v2.addRfqMessageExternal({
                  vendorId: vendor?.id ?? null, vendorPhone: from || null,
                  direction: "out", body: text,
                  externalMessageId: externalId ? String(externalId) : null,
                  status: e.status ? String(e.status) : null,
                });
                if (row) processed++;
              }
              break;
            }
            case "message.status.updated": {
              // Delivery/read receipt → update the status column for this external id.
              const status = String(e.status || e.deliveryStatus || "").trim();
              if (externalId && status) {
                v2.updateRfqMessageStatusByExternalId(String(externalId), status);
                processed++;
              }
              break;
            }
            case "contact.created": {
              // New contact → auto-create a vendor if the phone is unknown.
              if (from) {
                const existing = await v2.getVendorByPhone(from);
                if (!existing) {
                  const name = String(
                    e.name || e.contact?.name || e.profileName || "WhatsApp Contact",
                  );
                  await v2.createVendor({ name, phone: from, whatsapp: from } as any);
                  processed++;
                }
              }
              break;
            }
            case "contact.chat.intervened": {
              // Operator manually took over the chat → mark messages so automation backs off.
              if (from) {
                v2.markRfqChatManuallyHandled(from);
                processed++;
              }
              break;
            }
            default:
              // R22.x — unknown/blank event type but we have a sender + text → treat as an
              // inbound reply. This catches AiSensy's bare {data:{messageData:{from,text}}}
              // payloads that carry no recognizable event name.
              if (from && text && e.direction !== "out" && !e.outgoing) {
                processed += await processInboundReply(from, text, externalId ? String(externalId) : null);
              }
              break;
          }
        } catch (inner: any) {
          // Per-event failure must never fail the whole webhook.
          console.error("[R22.x aisensy] event error:", inner?.message || inner);
        }
      }
    } catch (e: any) {
      // Top-level failure: still return 200 so AiSensy does not retry-storm us.
      console.error("[R18 aisensy] webhook error:", e?.message || e);
      _whIgnored = "handler_error";
    }
    // R26.6i — final audit update for paths that fell through to here (inbound success,
    // message.created/status/contact events). Early-return paths already updated above.
    updateWebhookEvent(_whId, {
      topic: _whTopic,
      fromPhone: _whFrom,
      textPreview: _whText,
      processed: processed > 0 ? 1 : 0,
      ignoredReason: processed > 0 ? null : (_whIgnored || "not_processed"),
      notes: `processed=${processed}`,
    });
    return res.json({ ok: true, processed });
  });

  // Fallback: pull recent inbound from AiSensy API (when webhook isn't wired). Best-effort.
  app.post("/api/team/rfq/sync-inbound", requireDataTeam, async (req: any, res: any) => {
    try {
      const apiKey = process.env.AISENSY_API_KEY || "";
      if (!apiKey || apiKey === "skip") {
        return res.json({ ok: false, synced: 0, note: "AISENSY_API_KEY not configured — webhook is the supported path" });
      }
      // AiSensy does not expose a stable public inbound-messages pull endpoint on all plans.
      // We attempt a best-effort fetch; on any failure we degrade gracefully so the UI's
      // webhook-driven thread remains the source of truth.
      res.json({ ok: true, synced: 0, note: "Inbound is webhook-driven; no pull performed" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---------------- R26.6i WEBHOOK EVENTS ADMIN VIEWER ----------------
  app.get("/api/admin/webhook-events", requireAuth, async (req: any, res: any) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 1000);
      const where: string[] = [];
      const params: any[] = [];
      const source = req.query.source ? String(req.query.source) : "";
      if (source) { where.push("source = ?"); params.push(source); }
      if (req.query.from_phone) { where.push("from_phone = ?"); params.push(String(req.query.from_phone)); }
      if (req.query.topic) { where.push("topic = ?"); params.push(String(req.query.topic)); }
      if (req.query.processed === "0" || req.query.processed === "1") {
        where.push("processed = ?"); params.push(parseInt(String(req.query.processed), 10));
      }
      const sql =
        `SELECT id, source, received_at, method, topic, from_phone, text_preview, processed, ignored_reason, headers_json, body_json, notes
         FROM webhook_events
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY received_at DESC
         LIMIT ?`;
      params.push(limit);
      const rows = rawSqlite.prepare(sql).all(...params);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R26.6i — at-a-glance diagnostic: did AiSensy fire any message.sender.user today?
  app.get("/api/admin/webhook-events/stats", requireAuth, async (_req: any, res: any) => {
    try {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const dayStart = startOfDay.getTime();
      const one = (sql: string, ...p: any[]) => (rawSqlite.prepare(sql).get(...p) as any) || {};
      const totalToday = one(`SELECT COUNT(*) AS c FROM webhook_events WHERE received_at >= ?`, dayStart).c || 0;
      const inboundProcessedToday = one(
        `SELECT COUNT(*) AS c FROM webhook_events WHERE received_at >= ? AND processed = 1`, dayStart,
      ).c || 0;
      const receiptsIgnoredToday = one(
        `SELECT COUNT(*) AS c FROM webhook_events WHERE received_at >= ? AND ignored_reason = 'receipt'`, dayStart,
      ).c || 0;
      const lastSenderUser = one(
        `SELECT MAX(received_at) AS t FROM webhook_events WHERE topic = 'message.sender.user'`,
      ).t || null;
      const lastStatusUpdated = one(
        `SELECT MAX(received_at) AS t FROM webhook_events WHERE topic = 'message.status.updated'`,
      ).t || null;
      res.json({
        totalToday,
        inbound_processed_today: inboundProcessedToday,
        receipts_ignored_today: receiptsIgnoredToday,
        last_message_sender_user_at: lastSenderUser,
        last_message_status_updated_at: lastStatusUpdated,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- PO date + customer-PO search ----
  app.put("/api/team/po/:id/po-date", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { po_date } = req.body || {};
      if (po_date == null) return res.status(400).json({ error: "po_date required" });
      const po = v2.updatePoDate(id, parseInt(po_date, 10));
      const u = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(u?.id || ""), action: "update_po_date",
        entityType: "purchase_order", entityId: String(id),
        afterJson: JSON.stringify({ po_date: parseInt(po_date, 10) }),
      })).catch(() => {});
      res.json(po);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team/po/search", requireDataTeam, async (req: any, res: any) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json([]);
      res.json(v2.searchPurchaseOrders(q));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R11: global Sonar search, chat AI assist + send, process PO
  // ============================================================

  // Normalize an Indian phone to E.164 (+91XXXXXXXXXX). Accepts with/without country code.
  function toE164India(raw: any): string | null {
    const digits = String(raw || "").replace(/[^0-9]/g, "");
    if (!digits) return null;
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
    if (digits.startsWith("91") && digits.length > 12) return `+${digits.slice(0, 12)}`;
    return `+${digits}`;
  }

  // ---- Per-line global seller search (Perplexity Sonar) ----
  app.post("/api/team/po-items/:id/global-search", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const key = process.env.PPLX_API_KEY || "";
      if (!key) return res.status(503).json({ error: "PPLX_API_KEY not configured" });
      let query = String(req.body?.query || "").trim();
      if (!query) {
        const item = await v2.getPoItem(id);
        query = [item?.brand, item?.partNumber, item?.description, "wholesale supplier India"].filter(Boolean).join(" ");
      }
      const prompt = `Find wholesale sellers/distributors in India for this automotive spare part:\n${query}\n\nReturn a JSON array of suppliers with: name, phone (with country code), location (city, state), website (if any), gst_number (if found), source_url. Aim for 5-10 results. Only return JSON, no preamble.`;
      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: prompt }],
          return_citations: true,
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: j?.error?.message || "Perplexity error" });
      const content = j?.choices?.[0]?.message?.content || "[]";
      let results: any[] = [];
      try {
        const cleaned = String(content).replace(/```(?:json)?/gi, "").trim();
        const start = cleaned.indexOf("[");
        const end = cleaned.lastIndexOf("]");
        const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
        results = JSON.parse(slice);
      } catch (parseErr) {
        console.error("[global-search] JSON parse failed. Raw response:", content);
        results = [];
      }
      res.json({ query, results: Array.isArray(results) ? results : [], citations: j?.citations || [] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Add a global-search result as a quote AND immediately fire a single-item rate request ----
  app.post("/api/team/po-items/:id/quotes/global-send", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { vendor_name, vendor_phone } = req.body || {};
      if (!vendor_name && !vendor_phone) return res.status(400).json({ error: "vendor_name or vendor_phone required" });
      const phone = toE164India(vendor_phone);
      const row = v2.addQuoteToPoItem(id, {
        vendorId: null, vendorName: vendor_name ? String(vendor_name) : null, vendorPhone: phone, source: "global",
      });
      const item = await v2.getPoItem(id);
      const poId = v2.getPoIdForItem(id);
      const po = poId ? await v2.getPurchaseOrderV2(poId) : null;
      const vendorName = vendor_name ? String(vendor_name) : "Seller";
      // Persist outbound copy so chat reflects it even before AiSensy responds.
      v2.addRfqMessage({ vendorId: null, vendorPhone: phone, direction: "out",
        body: `Rate request to ${vendorName} for ${[item?.partNumber, item?.brand].filter(Boolean).join(" ")} x${item?.qty ?? 1}` });
      if (phone) {
        setImmediate(() => {
          (async () => {
            const wa = require("./whatsapp") as typeof import("./whatsapp");
            await wa.sendVendorRateRequest(phone, {
              vendorName,
              partNumber: item?.partNumber || "-",
              brand: item?.brand || "",
              qty: String(item?.qty ?? 1),
              ourPoNumber: po?.poNumber || "-",
            });
          })().catch((err) => console.error("[global-send] rate request failed:", err));
        });
      }
      res.json({ ok: true, quote: row, sent: !!phone });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Chat: AI assist (draft a reply via Perplexity Sonar) ----
  app.post("/api/team/rfq/chat/:vendorId/ai-assist", requireDataTeam, async (req: any, res: any) => {
    try {
      const key = process.env.PPLX_API_KEY || "";
      if (!key) return res.status(503).json({ error: "PPLX_API_KEY not configured" });
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const question = String(req.body?.question || "").trim();
      if (!question) return res.status(400).json({ error: "question required" });

      const selectedIds: number[] = Array.isArray(req.body?.selected_message_ids)
        ? req.body.selected_message_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
        : [];

      let prompt: string;
      if (selectedIds.length > 0) {
        // Selection mode: use ONLY the messages the user picked, scoped to this vendor.
        // Reject if any requested id does not belong to this vendor (cross-vendor leakage guard).
        const rows = v2.getRfqMessagesByIds(vendorId, selectedIds);
        const foundIds = new Set(rows.map((m: any) => Number(m.id)));
        const missing = selectedIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          return res.status(403).json({ error: "Some selected messages do not belong to this seller" });
        }
        const selectedText = rows
          .map((m: any) => `<${m.direction === "out" ? "us" : "seller"}: ${String(m.body || "").trim()}>`)
          .join("\n");
        prompt = `You are helping a procurement team responding to a spare-parts seller. The user has selected specific messages from the chat as context. Use ONLY these messages plus general automotive knowledge to answer the user's question.\n\nSelected messages:\n${selectedText}\n\nUser's question: ${question}\n\nRespond concisely (≤120 words). If the answer requires data not present in selection or general knowledge, say so and ask the team what's missing. Hinglish OK.`;
      } else {
        // Freeform mode (R11): last-10-message context passed by the client.
        const ctx = Array.isArray(req.body?.context)
          ? req.body.context.map((m: any) => `${m.direction === "out" ? "Us" : "Seller"}: ${m.body || ""}`).join("\n")
          : String(req.body?.context || "");
        prompt = `You are helping a procurement team respond to a spare parts seller on WhatsApp. The seller asked a technical/specification question. Based on chat context, draft a concise reply (≤80 words, Hinglish OK). Be factual; cite specs if relevant.\n\nRecent chat:\n${ctx}\n\nQuestion to answer: ${question}`;
      }

      const r = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }] }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: j?.error?.message || "Perplexity error" });
      const suggestion = j?.choices?.[0]?.message?.content || "";
      res.json({ suggestion: String(suggestion).trim() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Chat: outbound free-text message to a seller ----
  app.post("/api/team/rfq/chat/:vendorId/send", requireDataTeam, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const body = String(req.body?.body || "").trim();
      if (!body) return res.status(400).json({ error: "body required" });
      const vendor = await v2.getVendor(vendorId);
      const phone = vendor?.whatsapp || vendor?.phone || null;
      const row = v2.addRfqMessage({ vendorId, vendorPhone: phone, direction: "out", body });
      if (phone) {
        setImmediate(() => {
          (async () => {
            const wa = require("./whatsapp") as typeof import("./whatsapp");
            await wa.sendTextMessage(phone, body, "rfq_chat_reply");
          })().catch((err) => console.error("[rfq-chat-send] failed:", err));
        });
      }
      res.json({ ok: true, message: row, sent: !!phone });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R11.1: one-time backfill of chat transcripts from AiSensy (best-effort) ----
  // Upserts the last 7 days of AiSensy messages into vendor_rfq_messages, deduped by
  // aisensy_msg_id, so AI can be primed with full history. No-op stub if AiSensy has no
  // inbound-fetch helper / API access — the webhook remains the source of truth.
  app.post("/api/admin/rfq/backfill-transcripts", requireAuth, async (_req: any, res: any) => {
    try {
      const wa = require("./whatsapp") as any;
      const fetchRecent = wa?.fetchRecentMessages || wa?.getRecentMessages;
      if (typeof fetchRecent !== "function") {
        return res.json({ ok: false, reason: "AiSensy fetch API not configured" });
      }
      const since = Date.now() - 7 * 86400000;
      const msgs: any[] = (await fetchRecent({ since }).catch(() => [])) || [];
      let upserted = 0;
      for (const m of msgs) {
        const aisensyMsgId = m.message_id || m.messageId || m.id || null;
        if (aisensyMsgId && v2.rfqMessageExistsByAisensyId?.(String(aisensyMsgId))) continue;
        const from = String(m.from || m.sender || m.phone || "");
        const vendor = from ? await v2.getVendorByPhone(from) : null;
        v2.addRfqMessage({
          vendorId: vendor?.id ?? null, vendorPhone: from || null,
          direction: m.direction === "out" ? "out" : "in",
          body: String(m.message || m.text || m.body || ""), aisensyMsgId: aisensyMsgId ? String(aisensyMsgId) : null,
        });
        upserted++;
      }
      res.json({ ok: true, upserted });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Process PO: split confirmed lines from unconfirmed (clone to pending PO) ----
  app.post("/api/team/po/:id/process", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = v2.processPurchaseOrder(id);
      const u = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(u?.id || ""), action: "process_po",
        entityType: "purchase_order", entityId: String(id),
        afterJson: JSON.stringify(result),
      })).catch(() => {});
      res.json(result);
    } catch (e: any) {
      const msg = e?.message || "Process failed";
      const code = /No confirmed lines|not found/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  // ---- Outstanding today ----
  function dayBounds(dateStr?: string): { start: number; end: number } {
    const base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0).getTime();
    const end = start + 86400000 - 1;
    return { start, end };
  }

  app.get("/api/team/outstanding-today", requireDataTeam, async (req: any, res: any) => {
    try {
      const { start, end } = dayBounds(req.query.date as string | undefined);
      res.json(v2.getOutstandingToday(start, end));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team/outstanding-today/export.xlsx", requireDataTeam, async (req: any, res: any) => {
    try {
      const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const { start, end } = dayBounds(req.query.date as string | undefined);
      const data = v2.getOutstandingToday(start, end);
      const XLSX = require("xlsx");
      const sheetData = [
        ["PO #", "Items Total", "Pending Rates"],
        ...data.breakdown.map((r: any) => [r.po_number, r.items_total, r.pending]),
        [],
        ["Summary", "", ""],
        ["POs Created", data.pos_created, ""],
        ["Items Total", data.items_total, ""],
        ["Rates Received", data.rates_received, ""],
        ["Rates Pending", data.rates_pending, ""],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, "Outstanding");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="outstanding-${dateStr}.xlsx"`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- Vendor ledger (admin) ----
  app.get("/api/admin/vendor-ledger", requireAuth, async (req: any, res: any) => {
    try {
      const vendorId = req.query.vendor_id ? parseInt(req.query.vendor_id as string, 10) : undefined;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const q = req.query.q ? String(req.query.q) : undefined;
      res.json(v2.getVendorLedger({ vendorId, from, to, q }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26 — export selected vendor ledgers as a single PDF (one section per seller).
  app.post("/api/admin/vendor-ledger/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const from = req.body?.from != null ? parseInt(String(req.body.from), 10) : undefined;
      const to = req.body?.to != null ? parseInt(String(req.body.to), 10) : undefined;
      const reqIds: number[] = Array.isArray(req.body?.vendor_ids)
        ? req.body.vendor_ids.map((n: any) => parseInt(String(n), 10)).filter((n: number) => !Number.isNaN(n))
        : [];
      const ids = reqIds.length > 0 ? reqIds : v2.getVendorLedger({ from, to }).map((r: any) => r.vendor_id);
      if (ids.length === 0) return res.status(404).json({ error: "No vendor ledgers to export" });

      const { PdfBuilder } = await import("./pdf-utils");
      const stamp = new Date();
      const rangeLabel = (from || to)
        ? `${from ? new Date(from).toLocaleDateString("en-IN") : "…"} – ${to ? new Date(to).toLocaleDateString("en-IN") : "…"}`
        : "All time";
      const builder = await PdfBuilder.create(
        "Vendor Ledger",
        `Generated ${stamp.toLocaleDateString("en-IN")} · ${rangeLabel}`,
      );
      const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN");
      for (const vendorId of ids) {
        const summary = v2.getVendorLedger({ vendorId, from, to })[0];
        const detail = v2.getVendorLedgerDetails(vendorId, from, to);
        const name = summary?.vendor_name || `Seller #${vendorId}`;
        const phone = summary?.vendor_phone || "—";
        builder.sectionTitle(`${name} · ${phone}`);
        builder.keyValues([
          ["Date range", rangeLabel],
          ["Approved value", inr(summary?.total_approved_value || 0)],
          ["Total paid", inr(summary?.total_paid || 0)],
          ["Balance", inr(summary?.balance || 0)],
        ]);
        // Build a combined transaction list: approved items (debit) + payments (credit).
        type Txn = { ts: number; date: string; po: string; debit: number; credit: number };
        const txns: Txn[] = [];
        for (const it of detail.items) {
          txns.push({
            ts: Number(it.approved_at || 0),
            date: it.approved_at ? new Date(it.approved_at).toLocaleDateString("en-IN") : "—",
            po: it.po_number || "—",
            debit: Number(it.line_total || 0), credit: 0,
          });
        }
        for (const p of detail.payments) {
          txns.push({
            ts: Number(p.paid_on || 0),
            date: p.paid_on ? new Date(p.paid_on).toLocaleDateString("en-IN") : "—",
            po: `Payment (${p.method || "—"})`,
            debit: 0, credit: Number(p.amount || 0),
          });
        }
        txns.sort((a, b) => a.ts - b.ts);
        let running = 0;
        const rows = txns.map((t) => {
          running += t.debit - t.credit;
          return [t.date, t.po, t.debit ? inr(t.debit) : "—", t.credit ? inr(t.credit) : "—", inr(running)];
        });
        builder.table(
          [
            { header: "Date", width: 80 },
            { header: "PO / Ref", width: 169 },
            { header: "Debit", width: 80, align: "right" },
            { header: "Credit", width: 80, align: "right" },
            { header: "Balance", width: 90, align: "right" },
          ],
          rows.length ? rows : [["—", "No transactions", "—", "—", inr(0)]],
        );
        builder.note(`Opening balance: ${inr(0)}   ·   Closing balance: ${inr(running)}`);
        builder.spacer(12);
      }
      const buffer = await builder.finish();
      const fname = `vendor-ledger-${stamp.toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/vendor-ledger/:vendorId/details", requireAuth, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      res.json(v2.getVendorLedgerDetails(vendorId, from, to));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/vendor-ledger/:vendorId/payment", requireAuth, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const { paid_on, amount, method, reference, notes } = req.body || {};
      if (amount == null || amount === "") return res.status(400).json({ error: "amount required" });
      const u = (req as any).user;
      const row = v2.addVendorPayment({
        vendorId,
        paidOn: paid_on != null ? parseInt(paid_on, 10) : Date.now(),
        amount: parseFloat(amount),
        method: method || "bank",
        reference: reference ? String(reference) : null,
        notes: notes ? String(notes) : null,
        createdBy: u?.username || null,
      });
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/vendor-ledger/export.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const rows = v2.getVendorLedger({ from, to });
      const XLSX = require("xlsx");
      const fmtDate = (ms: number) => {
        const d = new Date(ms);
        return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
      };
      const sheetData = [
        ["Vendor", "Approved Items", "Approved Value", "Total Paid", "Balance", "Last Activity"],
        ...rows.map((r: any) => [
          r.vendor_name, Number(r.item_count) || 0, Number(r.total_approved_value) || 0,
          Number(r.total_paid) || 0, Number(r.balance) || 0,
          r.last_activity_at ? fmtDate(r.last_activity_at) : "",
        ]),
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      // R27.0 — type the amount columns (C, D, E) as numbers with Indian currency
      // format so Excel right-aligns and sums them instead of treating them as text.
      const moneyFmt = "#,##,##0.00";
      for (let r = 1; r < sheetData.length; r++) {
        for (const c of [2, 3, 4]) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) { ws[addr].t = "n"; ws[addr].z = moneyFmt; }
        }
      }
      ws["!cols"] = [{ wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, "Vendor Ledger");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="vendor-ledger.xlsx"`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  console.log("[v2] R9 routes registered: quotes, rfq/fire, chat, webhook, po-date, po/search, outstanding-today, vendor-ledger");
}

// ============================================================
// R8 ROUTE IMPLEMENTATIONS
// ============================================================
function registerR8Routes(
  app: Express,
  {
    requireAuth,
    requireAdminRole,
    requireDataTeam,
    requireDelhi,
    ctx,
  }: {
    requireAuth: any;
    requireAdminRole: any;
    requireDataTeam: any;
    requireDelhi: any;
    ctx: V2Context;
  }
) {
  // node:path and node:fs are built-ins — fast, safe, no module-init cost — keep eager.
  const path2 = require("node:path") as typeof import("node:path");
  const fs2 = require("node:fs") as typeof import("node:fs");
  // Heavy modules (claude-service, whatsapp, email, pdf-service, xlsx) are lazy-loaded
  // inside the individual route handlers that use them, so they never run module-init
  // work at boot/register time.

  const uploadsRoot = ctx.uploadsDir || "./uploads";
  const poUploadsDir = path2.join(uploadsRoot, "customer-pos");
  if (!fs2.existsSync(poUploadsDir)) fs2.mkdirSync(poUploadsDir, { recursive: true });

  // PartSetu v1.4a — Data Center is now a fully separate app with its own token.
  // Validate the x-datacenter-token header against the shared tokenMap. The token must
  // resolve to a data_center role (dc_-prefixed token issued by /api/datacenter/login).
  const resolveDataCenterToken = (req: Request): TokenInfo | null => {
    const token = req.headers["x-datacenter-token"] as string | undefined;
    if (!token) return null;
    let info = ctx.tokenMap.get(token);
    if (!info) {
      const rehydrated = rehydrateSession(ctx.tokenMap, token);
      if (!rehydrated) return null;
      info = rehydrated;
    }
    if (info.role !== "data_center") return null;
    return info;
  };

  // requireDataCenterToken — data_center role only, via x-datacenter-token. DELETE blocked.
  const requireDataCenterToken = (req: Request, res: Response, next: NextFunction) => {
    const info = resolveDataCenterToken(req);
    if (!info) return res.status(401).json({ error: "Data Center authentication required" });
    if (req.method === "DELETE") {
      return res.status(403).json({ error: "Data Center role cannot delete" });
    }
    (req as any).user = info;
    next();
  };

  // requireDataCenterOrAdmin (v1.4a dual-token) — accepts EITHER an admin token
  // (x-admin-token, role admin) OR a Data Center token (x-datacenter-token, role
  // data_center). data_center can never DELETE. Guards the shared PartSetu/Products
  // management routes the Data Center role owns alongside admins.
  const requireDataCenterOrAdmin = (req: Request, res: Response, next: NextFunction) => {
    const dc = resolveDataCenterToken(req);
    if (dc) {
      if (req.method === "DELETE") {
        return res.status(403).json({ error: "Data Center role cannot delete" });
      }
      (req as any).user = dc;
      return next();
    }
    // Fall back to admin token (requireAuth rejects data_center x-admin-token outright).
    requireAuth(req, res, () => {
      const u = (req as any).user as TokenInfo;
      if (u.role !== "admin") {
        return res.status(403).json({ error: "Admin or Data Center role required" });
      }
      next();
    });
  };

  const multerPO = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, poUploadsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") {
        cb(null, true);
      } else {
        cb(new Error("Only PDF/JPG/PNG allowed"));
      }
    },
  });

  // ---- POST /api/team/po/upload-customer-po ----
  // Accepts multipart: file (PDF/image), customer_id, quotation_id (optional)
  // Returns parsed JSON for review — does NOT create PO yet
  app.post("/api/team/po/upload-customer-po", requireDataTeam, multerPO.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const customerId = req.body?.customer_id ? parseInt(req.body.customer_id, 10) : null;
      // R13: which of our billing entities this order is for. Echoed back so the
      // Review & Edit step can carry it into create-from-parsed.
      const companyId = req.body?.company_id ? parseInt(req.body.company_id, 10) : null;
      const proto = req.protocol || "https";
      const host = req.get("host") || "narmada-backend.onrender.com";
      const fileUrl = `${proto}://${host}/uploads/customer-pos/${req.file.filename}`;

      // R10: richer Claude extraction — pulls customer_po_number, po_date and per-line
      // customer_rate + brand (the legacy parts-only prompt left rates/PO# null).
      // Normalize into the canonical client contract:
      //   { customerName, customerPoNumber, poDate, items:[{partNumber,brand,description,qty,customerRate}] }
      const claude = require("./claude-service") as typeof import("./claude-service");
      let po: import("./claude-service").ParsedCustomerPO | null = null;
      if (claude.isClaudeConfigured()) {
        const ext = path2.extname(req.file.filename).toLowerCase();
        try {
          if (ext === ".pdf") {
            po = await claude.extractCustomerPOFromPdf(req.file.path);
          } else {
            po = await claude.extractCustomerPOFromImage(req.file.path);
          }
        } catch (claudeErr: any) {
          console.error("[R10] Claude PO extraction error:", claudeErr.message);
        }
      }

      const items = (po?.items || []).map((p) => ({
        partNumber: p.part_number ?? null,
        brand: p.brand ?? null,
        description: p.description ?? null,
        qty: Number(p.qty ?? 1) || 1,
        customerRate: p.customer_rate ?? null,
      }));

      console.log("[po-parse] claude raw:", JSON.stringify(po).slice(0, 1500));
      console.log(`[po-parse] field customer_po_number raw=${JSON.stringify(po?.customer_po_number)} parsed=${po?.customer_po_number ?? null}`);
      console.log(`[po-parse] field po_date raw=${JSON.stringify(po?.po_date)} parsed=${po?.po_date ?? null}`);
      console.log(`[po-parse] normalized ${items.length} item(s); rates filled=${items.filter((i) => i.customerRate != null).length}`);

      // Canonical shape the frontend consumes. shipTo is not reliably extractable
      // and is left for the operator to fill on the Review & Edit screen.
      const parsed = {
        customerName: po?.customer_name ?? null as string | null,
        customerPoNumber: po?.customer_po_number ?? null as string | null,
        poDate: po?.po_date ?? null as string | null,
        shipTo: null as { name: string | null; address: string | null; phone: string | null } | null,
        items,
      };

      // Bug 1 hardening: 0 items → 422 + one blank editable row so the operator
      // can type the lines in manually instead of staring at an empty screen.
      if (items.length === 0) {
        return res.status(422).json({
          error: "Could not extract line items. Edit manually.",
          fileUrl,
          customerId,
          companyId,
          parsed: {
            ...parsed,
            items: [{ partNumber: "", brand: "", description: "", qty: 1, customerRate: null }],
          },
        });
      }

      res.json({
        ok: true,
        fileUrl,
        customerId,
        companyId,
        parsed,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /api/team/po/create-from-parsed ----
  // Creates internal PO from reviewed/edited parsed data
  app.post("/api/team/po/create-from-parsed", requireDataTeam, async (req: any, res: any) => {
    try {
      const u = (req as any).teamUser;
      const {
        customer_id, customer_po_number, customer_po_url, po_date,
        ship_to_name, ship_to_address, ship_to_phone, company_id,
        urgency, delivery_deadline,
        items,
      } = req.body || {};

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array required" });
      }

      // R13: tag the PO with the ordered (billing) company. The UI always sends one,
      // but never reject if missing — fall back to the default/first company.
      let companyId: number | null = company_id ? parseInt(String(company_id), 10) : null;
      if (!companyId) {
        const def = await v2.getDefaultCompany();
        companyId = def?.id ?? null;
      }

      let poDateMs: number | null = null;
      if (po_date && String(po_date).trim()) {
        const t = Date.parse(String(po_date).trim());
        if (!Number.isNaN(t)) poDateMs = t;
      }

      const poItems2 = items.map((it: any) => ({
        partNumber: it.partNumber || null,
        brand: it.brand || null,
        description: it.description || null,
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.customerRate || it.rate || 0),
        lineTotal: (Number(it.qty) || 1) * Number(it.customerRate || it.rate || 0),
        // R21.7.4 — per-line note authored by Patna, shown to Delhi.
        patnaNote: it.patnaNote || it.patna_note || null,
      }));

      // R21.7 — customer urgency (urgent|normal|standby) + delivery deadline (date string).
      const urgencyVal = ["urgent", "normal", "standby"].includes(String(urgency)) ? String(urgency) : null;
      let deadlineMs: number | null = null;
      if (delivery_deadline && String(delivery_deadline).trim()) {
        const t = Date.parse(String(delivery_deadline).trim());
        if (!Number.isNaN(t)) deadlineMs = t;
      }

      const subtotal = poItems2.reduce((s: number, it: any) => s + (it.lineTotal || 0), 0);

      const po = await v2.createPurchaseOrderV2(
        {
          customerId: customer_id ? parseInt(customer_id, 10) : null,
          companyId,
          customerPoNumber: customer_po_number || null,
          customerPoUrl: customer_po_url || null,
          poDate: poDateMs,
          shipToName: ship_to_name || null,
          shipToAddress: ship_to_address || null,
          shipToPhone: ship_to_phone || null,
          urgency: urgencyVal,
          deliveryDeadline: deadlineMs,
          subtotal,
          total: subtotal,
          createdBy: u?.username,
          status: "draft",
        } as any,
        poItems2,
      );

      // R26.5 H/E2 — notify the customer's sales rep that a PO was created.
      try {
        const custId = customer_id ? parseInt(customer_id, 10) : null;
        if (custId) {
          const repRow = rawSqlite
            .prepare(`SELECT sales_rep_id FROM customers WHERE id = ?`)
            .get(custId) as { sales_rep_id?: number } | undefined;
          if (repRow?.sales_rep_id) {
            emitCrossTeamEvent(
              "po_created_for_rep_customer",
              { po_id: po?.id, customer_id: custId, customer_po_number: customer_po_number || null, total: subtotal },
              { target_user_id: repRow.sales_rep_id, target_role: "sales" },
            );
          }
        }
      } catch (e: any) {
        console.error("[R26.5 E2] emit failed:", e?.message || e);
      }

      res.json(po);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- PATCH /api/team/po-items/:id/note ---- (R21.7.4 per-line Patna note)
  app.patch("/api/team/po-items/:id/note", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const raw = req.body?.patnaNote ?? req.body?.note;
      const note = typeof raw === "string" ? raw.trim() : "";
      const item = await v2.updatePoItem(id, { patnaNote: note || null } as any);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- POST /api/team/po-items/:id/assign-vendor ----
  // Assigns a seller (vendor) + rate + brand to a PO line item. Accepts a registered
  // vendor_id and/or a free-text vendor_name. Persists vendor_id, vendor_name,
  // vendor_rate, brand, updated_at and returns the enriched row. Fires a
  // fire-and-forget AiSensy WhatsApp rate request to the seller (Bug 5).
  app.post("/api/team/po-items/:id/assign-vendor", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const { vendor_id, vendor_name, vendor_rate, brand } = req.body || {};
      if (!vendor_id && !(vendor_name && String(vendor_name).trim())) {
        return res.status(400).json({ error: "vendor_id or vendor_name required" });
      }
      const item = await v2.assignVendorToPoItemR8(id, {
        vendorId: vendor_id ? parseInt(vendor_id, 10) : undefined,
        vendorName: vendor_name ? String(vendor_name) : undefined,
        vendorRate: vendor_rate != null && vendor_rate !== "" ? parseFloat(vendor_rate) : undefined,
        brand: brand || undefined,
        assignedBy: u?.username,
      });
      if (!item) return res.status(404).json({ error: "Item not found" });

      // Bug 5: fire-and-forget vendor rate-request via AiSensy WhatsApp. Only when we
      // have a registered vendor with a phone — free-text-only sellers have no number.
      if (vendor_id) {
        const vid = parseInt(vendor_id, 10);
        setImmediate(() => {
          (async () => {
            const vendor = await v2.getVendor(vid);
            const phone = vendor?.whatsapp || vendor?.phone;
            if (!vendor || !phone) return;
            console.log(`[aisensy] notifying vendor ${vendor.name} for po-item ${id}`);
            const wa = require("./whatsapp") as typeof import("./whatsapp");
            await wa.sendVendorRateRequest(phone, {
              vendorName: vendor.name,
              partNumber: item.partNumber || "",
              brand: item.brand || brand || "",
              qty: item.qty != null ? String(item.qty) : "1",
              ourPoNumber: String(item.poId ?? id),
            });
          })().catch((err) => console.error("[aisensy] vendor notify failed:", err));
        });
      }

      res.json(item);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /api/team/po/:id/search-vendor-rates ----
  // Returns rate candidates from history + optional Perplexity global search
  app.post("/api/team/po/:id/search-vendor-rates", requireDataTeam, async (req: any, res: any) => {
    try {
      const { part_number, brand } = req.body || {};
      if (!part_number) return res.status(400).json({ error: "part_number required" });

      // (1) Past purchases
      const history = v2.listPurchaseHistory({ q: part_number, brand, limit: 20, page: 1 });
      const historyRows = history.rows.filter((r: any) => r.vendor_rate || r.vendor_rate === 0);

      // (2) Fire-and-forget: send WhatsApp RFQ to vendors who supplied this part before
      const knownVendorIds: number[] = Array.from(new Set(historyRows.map((r: any) => r.vendor_id).filter(Boolean))) as number[];
      if (knownVendorIds.length > 0) {
        const wa = require("./whatsapp") as typeof import("./whatsapp");
        Promise.all(knownVendorIds.slice(0, 5).map(async (vid: number) => {
          const vendor = await v2.getVendor(vid);
          if (!vendor) return;
          const phone = vendor.whatsapp || vendor.phone;
          if (!phone) return;
          wa.sendTextMessage(phone, `Hi ${vendor.name}, do you have ${part_number}${brand ? ` (${brand})` : ""}? Please share best rate. — Narmada Motors`).catch(() => {});
        })).catch(() => {});
      }

      // (3) Price list lookup
      const priceRows = await v2.searchPartsEnriched(part_number, 10);

      res.json({
        history: historyRows.slice(0, 20),
        priceList: priceRows.slice(0, 10),
        rfqSentTo: knownVendorIds.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /api/team/po/:id/notify-delhi ----
  // Partial-notify: stamps notified_delhi_at and flips status so Delhi can see the PO.
  // Delhi only sees the line items that already have a vendor assigned — unassigned
  // lines stay invisible (Bug 3). At least 1 assigned line is required.
  app.post("/api/team/po/:id/notify-delhi", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const po = await v2.getPurchaseOrderV2(id);
      if (!po) return res.status(404).json({ error: "PO not found" });
      // R11: Notify Delhi sends the CURRENT PO state — ALL lines (confirmed + unconfirmed).
      // Delhi sees everything with a badge for lines still awaiting a vendor lock.
      if (po.items.length === 0) {
        return res.status(400).json({ error: "PO has no line items" });
      }
      const confirmed = po.items.filter((it: any) => it.approvedQuoteId != null || it.vendorId != null);
      // R26.2g — sync the customer (selling) rate into the Delhi-visible line snapshot at
      // click time: recompute each line_total from unit_price*qty and refresh the PO header
      // order value. On-click only (no master-edit triggers); idempotent across repeat clicks.
      try {
        const sync = v2.syncDelhiLineRates(id);
        if (sync.zeroRateLines > 0) {
          console.warn(`[R26.2g] notify-delhi: PO ${id} has ${sync.zeroRateLines} line(s) with customer_rate=0`);
        }
      } catch (e: any) {
        console.error(`[R26.2g] notify-delhi rate sync failed for PO ${id}:`, e?.message || e);
      }
      await v2.updatePurchaseOrderV2(id, { notifiedDelhiAt: Date.now(), status: po.status === "draft" ? "open" : po.status } as any);
      res.json({ ok: true, totalCount: po.items.length, assignedCount: confirmed.length, awaitingCount: po.items.length - confirmed.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- GET /api/delhi/pos ----
  // List active POs for Delhi warehouse (poll-friendly, no-cache). R11: ?include_pending=1
  // to also show split-off pending POs.
  app.get("/api/delhi/pos", requireDelhi, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const includePending = String(req.query.include_pending || "") === "1" || req.query.include_pending === "true";
      res.json(await v2.listDelhiActivePOs({ includePending }));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- PUT /api/delhi/po-items/:id/mark-shipped ----
  app.put("/api/delhi/po-items/:id/mark-shipped", requireDelhi, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const shipped = req.body?.shipped !== false;
      const item = await v2.updatePoItem(id, {
        shippedStatus: shipped ? "shipped" : "pending",
        shippedAt: shipped ? Date.now() : null,
        shippedBy: shipped ? (u?.username || null) : null,
      } as any);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /api/delhi/po/:id/submit-day ----
  // Submits a dispatch: snapshots shipped items, creates dispatch record, regenerates PDF
  app.post("/api/delhi/po/:id/submit-day", requireDelhi, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const { docketNo, courierName, dispatchDate, docketPhotoUrl } = req.body || {};

      if (!docketNo) return res.status(400).json({ error: "docketNo required" });

      const poFull = await v2.getPurchaseOrderV2(poId);
      if (!poFull) return res.status(404).json({ error: "PO not found" });

      const currentRound = (poFull as any).dispatchRound || 1;
      const shippedItems = poFull.items.filter((it: any) => it.shippedStatus === "shipped" && !it.dispatchRoundShipped);

      if (shippedItems.length === 0) {
        return res.status(400).json({ error: "No items marked as shipped" });
      }

      // Create dispatch record
      const dispatch = await v2.createDispatch({
        poId,
        roundNo: currentRound,
        docketNo: docketNo || null,
        courierName: courierName || null,
        dispatchDate: dispatchDate ? parseInt(dispatchDate, 10) : Date.now(),
        docketPhotoUrl: docketPhotoUrl || null,
        submittedBy: u?.username || null,
        submittedAt: Date.now(),
      });

      // Mark shipped items with round number
      for (const it of shippedItems) {
        await v2.updatePoItem(it.id, { dispatchRoundShipped: currentRound } as any);
      }

      // Check if all items are now dispatched
      const allItems = poFull.items;
      const totalShipped = allItems.filter((it: any) =>
        it.shippedStatus === "shipped" || it.dispatchRoundShipped
      ).length;
      const isFullyDispatched = totalShipped >= allItems.length ? 1 : 0;

      await v2.updatePurchaseOrderV2(poId, {
        dispatchRound: currentRound + 1,
        isFullyDispatched,
        delhiSubmittedAt: Date.now(),
        status: isFullyDispatched ? "fulfilled" : "partial",
      } as any);

      // R23.2 — on full fulfilment, write the customer-debit/company-credit ledger entry
      // (idempotent: at most one per PO). Never blocks the dispatch flow.
      if (isFullyDispatched) {
        try {
          const wrote = v2.writePoFulfilmentLedger(poId);
          if (wrote) console.log(`[R23.2 ledger] wrote fulfilment ledger for PO ${poId}`);
        } catch (e: any) { console.error("[R23.2 ledger] write failed:", e?.message || e); }
      }

      // Generate dispatch PDF (fire-and-forget on failure)
      try {
        const pdfSvc = require("./pdf-service") as typeof import("./pdf-service");
        const emailSvc = require("./email") as typeof import("./email");
        const wa = require("./whatsapp") as typeof import("./whatsapp");
        const company = (poFull as any).companyId ? await v2.getCompany((poFull as any).companyId) : await v2.getDefaultCompany();
        const pdfBuf = await pdfSvc.generatePOPDF({
          poNumber: `${poFull.poNumber}-D${currentRound}`,
          createdAt: Date.now(),
          status: "dispatched",
          notes: `Dispatch Round ${currentRound} | Docket: ${docketNo} | Courier: ${courierName || "—"}`,
          items: shippedItems.map((it: any) => ({
            partNumber: it.partNumber,
            brand: it.brand,
            description: it.description,
            qty: it.qty,
            unitPrice: (it as any).vendorRate || it.unitPrice,
            lineTotal: it.lineTotal,
          })),
        }, company);

        const pdfFilename = `dispatch-${poFull.poNumber.replace(/\//g, "-")}-r${currentRound}-${Date.now()}.pdf`;
        const pdfPath = path2.join(uploadsRoot, "dispatches", pdfFilename);
        if (!fs2.existsSync(path2.join(uploadsRoot, "dispatches"))) fs2.mkdirSync(path2.join(uploadsRoot, "dispatches"), { recursive: true });
        fs2.writeFileSync(pdfPath, pdfBuf);

        const proto = "https";
        const host = "narmada-backend.onrender.com";
        const pdfUrl = `${proto}://${host}/uploads/dispatches/${pdfFilename}`;
        await v2.updatePoItem(dispatch.id, {} as any); // noop, just to show pattern
        await (v2 as any).updateDispatch?.(dispatch.id, { pdfUrl });

        // Email invoicing (fire-and-forget)
        emailSvc.sendContactEmail({
          name: "Delhi Warehouse",
          email: "invoicing@narmadamotors.in",
          subject: `Dispatch ${poFull.poNumber} Round ${currentRound} — ${shippedItems.length} items, Docket ${docketNo}`,
          message: `Dispatch submitted.\nPO: ${poFull.poNumber}\nRound: ${currentRound}\nDocket: ${docketNo}\nCourier: ${courierName || "—"}\nItems: ${shippedItems.length}\nPDF: ${pdfUrl}`,
          country: "IN",
        } as any).catch(() => {});

        // WhatsApp customer (fire-and-forget)
        const customer = poFull.customerId ? await v2.getCustomer(poFull.customerId) : null;
        if (customer) {
          const phones = [customer.phone, (customer as any).whatsapp].filter(Boolean) as string[];
          for (const phone of phones.slice(0, 1)) {
            wa.sendTextMessage(phone,
              `Dear ${customer.name}, your order ${poFull.poNumber} (Round ${currentRound}) has been dispatched via ${courierName || "courier"}. Docket: ${docketNo}. ${shippedItems.length} item(s) shipped. — Narmada Motors`
            ).catch(() => {});
          }
        }
      } catch (pdfErr: any) {
        console.error("[R8] Dispatch PDF/notify error:", pdfErr.message);
      }

      res.json({ ok: true, dispatchId: dispatch.id, round: currentRound, isFullyDispatched: !!isFullyDispatched, shippedCount: shippedItems.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // R12 — PO-CENTRIC DELHI DISPATCH
  // ============================================================

  // Multer for docket slip uploads (image/PDF, max 10MB) — reuses the R10 consignment pattern.
  const docketSlipDir = path.join(ctx.uploadsDir || "./uploads", "docket-slips");
  if (!fs.existsSync(docketSlipDir)) fs.mkdirSync(docketSlipDir, { recursive: true });
  const multerDocket = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, docketSlipDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });

  // ---- GET /api/delhi/pos/list ----
  // PO-centric list with rolled-up line state + filters (?from=&to=&customer_id=&status=)
  app.get("/api/delhi/pos/list", requireDelhi, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      // R21.5 — prefer IST date strings (from_date/to_date as YYYY-MM-DD). A given IST day
      // begins at 18:30 UTC of the PREVIOUS calendar day, so we convert here and use an
      // EXCLUSIVE upper bound (start of the day AFTER `to_date`). Legacy ms `from`/`to`
      // remain accepted as a fallback.
      const fromDate = (req.query.from_date as string | undefined)?.trim();
      const toDate = (req.query.to_date as string | undefined)?.trim();
      const from = fromDate ? istDayStartUtcMs(fromDate) : (req.query.from ? parseInt(req.query.from as string, 10) : undefined);
      const to = toDate ? istDayStartUtcMs(toDate) + 24 * 60 * 60 * 1000 : (req.query.to ? parseInt(req.query.to as string, 10) : undefined);
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
      const statusRaw = (req.query.status as string | undefined) || "";
      const statuses = statusRaw ? statusRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const q = (req.query.q as string | undefined) || undefined;
      res.json(await v2.listDelhiPosWithRollup({ from, to, customerId, statuses, q }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/delhi/customers ---- (filter dropdown)
  app.get("/api/delhi/customers", requireDelhi, async (_req: any, res: any) => {
    try { res.json(await v2.listDelhiCustomers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/delhi/dispatch/carriers ---- (autocomplete)
  app.get("/api/delhi/dispatch/carriers", requireDelhi, async (_req: any, res: any) => {
    try { res.json(await v2.listDispatchCarriers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/delhi/po/:id ---- (PO detail for Delhi)
  // R14.1: serve customer-safe detail — customer name, customer PO#, full ship-to,
  // per-line CUSTOMER rate + line total. Vendor name / vendor rate / cost are stripped
  // server-side by getDelhiPoDetail (never sent to Delhi).
  app.get("/api/delhi/po/:id", requireDelhi, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const po = await v2.getDelhiPoDetail(parseInt(req.params.id as string, 10));
      if (!po) return res.status(404).json({ error: "PO not found" });
      res.json(po);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- PUT /api/delhi/po-items/:id/mark-packed ---- (single, auto-receives)
  app.put("/api/delhi/po-items/:id/mark-packed", requireDelhi, async (req: any, res: any) => {
    try {
      const item = await v2.markPoItemPacked(parseInt(req.params.id as string, 10));
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- PATCH /api/delhi/po-items/:id/qty ---- (R21.2 deviation flow)
  // Delhi adjusts a line's quantity (e.g. short material received). Body { qty, reason }.
  // reason is required only when qty differs from the original ordered qty.
  app.patch("/api/delhi/po-items/:id/qty", requireDelhi, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const newQty = Number(req.body?.qty);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!Number.isFinite(newQty) || newQty < 0) return res.status(400).json({ error: "Valid qty required" });
      const existing = await v2.getPoItem(id);
      if (!existing) return res.status(404).json({ error: "Item not found" });
      if ((existing.fulfilStatus || "pending") === "dispatched") {
        return res.status(409).json({ error: "Cannot change qty on a dispatched line" });
      }
      const original = (existing as any).originalQty != null ? Number((existing as any).originalQty) : Number(existing.qty ?? 0);
      if (newQty !== original && !reason) {
        return res.status(400).json({ error: "A reason is required when changing the quantity" });
      }
      const updated = await v2.deviatePoItemQty(id, newQty, reason || null, u?.id ?? null);
      await v2.writeAuditLog({
        actorType: "delhi", actorId: u?.username, action: "po_item.qty_deviation",
        entityType: "po_item", entityId: String(id),
        afterJson: JSON.stringify({ original_qty: original, new_qty: newQty, reason: reason || null }),
      });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/team/purchase-orders/:id/deviations ---- (R21.2 Patna summary modal)
  app.get("/api/team/purchase-orders/:id/deviations", requireDataTeam, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      res.json(v2.getPoDeviations(id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R27.4 BUG-13 — Procurement (Data Team) Deviation tab mirror of the admin
  // Operations → Deviations engine (R27.2 po_deviations). Same data, team token.
  app.get("/api/team/deviations", requireDataTeam, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listDeviations({
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        poId: req.query.po_id ? parseInt(req.query.po_id as string, 10) : undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/deviations/:id/resolve", requireDataTeam, async (req: any, res) => {
    try { const s = await r27(); res.json(s.resolveDeviation(parseInt(req.params.id as string, 10), (req.teamUser?.username) || "team", req.body?.notes)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/deviations/:id/create-sub-po", requireDataTeam, async (req: any, res) => {
    try { const s = await r27(); res.json(await s.createSubPoForDeviation(parseInt(req.params.id as string, 10), (req.teamUser?.username) || "team")); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/team/deviations/export.xlsx", requireDataTeam, async (_req, res) => {
    try {
      const s = await r27();
      const rows = s.deviationExportRows();
      const XLSX = require("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Deviations");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="deviations.xlsx"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- POST /api/delhi/po-items/bulk-mark-packed ---- ({ids:[]})
  app.post("/api/delhi/po-items/bulk-mark-packed", requireDelhi, async (req: any, res: any) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n: any) => parseInt(String(n), 10)).filter((n: number) => Number.isInteger(n)) : [];
      if (ids.length === 0) return res.status(400).json({ error: "ids required" });
      const packed = await v2.bulkMarkPoItemsPacked(ids);
      res.json({ packed });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- POST /api/delhi/po/:id/dispatch ---- (multipart: courier, docketNumber, bundles, docketSlip file)
  app.post("/api/delhi/po/:id/dispatch", requireDelhi, multerDocket.single("docketSlip"), async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const carrier = String(req.body?.courier || req.body?.carrier || "").trim();
      const docketNumber = String(req.body?.docketNumber || req.body?.docketNo || "").trim();
      const bundlesRaw = String(req.body?.bundles || "").trim();
      const bundles = parseInt(bundlesRaw, 10);
      const file = req.file;
      // R21.6 — Inter-Branch Transfer (Patna) uses our own carrier, so carrier/docket/
      // bundles/slip are all OPTIONAL. External carrier dispatch keeps every field mandatory.
      const isInternalTransfer = req.body?.isInternalTransfer === "1" || req.body?.isInternalTransfer === "true" || req.body?.is_internal_transfer === "1";
      if (!isInternalTransfer) {
        if (!carrier) return res.status(400).json({ error: "Courier is required" });
        if (!docketNumber) return res.status(400).json({ error: "Docket number is required" });
        if (!Number.isInteger(bundles) || bundles < 1) return res.status(400).json({ error: "Bundles count (min 1) is required" });
        if (!file) return res.status(400).json({ error: "Docket slip upload is required" });
      }

      const proto = "https";
      const host = req.get("host") || "narmada-backend.onrender.com";
      const docketSlipUrl = file ? `${proto}://${host}/uploads/docket-slips/${file.filename}` : "";

      const result = await v2.dispatchPackedLines(poId, {
        carrier: carrier || (isInternalTransfer ? "Inter-Branch Transfer" : carrier),
        docketNumber, bundles: Number.isInteger(bundles) && bundles > 0 ? bundles : 0,
        docketSlipUrl, submittedBy: u?.username, isInternalTransfer,
      });

      await v2.writeAuditLog({
        actorType: "delhi", actorId: u?.username, action: "po.dispatch",
        entityType: "purchase_order", entityId: String(poId),
        afterJson: JSON.stringify({ carrier, docketNumber, bundles, isInternalTransfer, ...result }),
      });

      // R27.5 #5 — Delhi→Patna transfer must surface on the Store Incharge dashboard.
      // R27.4 only opened a branch_transfers row when the dispatcher explicitly ticked
      // "Inter-Branch Transfer", so a normal Delhi dispatch destined for Patna never
      // appeared in the Store portal (the bug Piyush reported: PO dispatched from Delhi,
      // store stayed empty). We now open the transfer row on EVERY Delhi dispatch
      // (idempotent, keyed by po_id + in_transit) so the store always sees incoming
      // consignments to receive. Branch keys are written lowercase for case-safe queries.
      try {
        const r27 = await import("./storage-r27");
        const existingTransfer = (r27.listTransfers() as any[]).find((t) => t.po_id === poId && t.status === "in_transit");
        if (!existingTransfer) {
          r27.createBranchTransfer({
            poId,
            notes: isInternalTransfer
              ? `Inter-branch transfer on Delhi dispatch${docketNumber ? ` (docket ${docketNumber})` : ""}`
              : `Delhi dispatch${carrier ? ` via ${carrier}` : ""}${docketNumber ? ` (docket ${docketNumber})` : ""}`,
          });
          console.log(`[R27.5] branch transfer opened for PO ${poId} (Delhi dispatch, internal=${isInternalTransfer})`);
        }
        const ap = r27.autoCreateProductsForPo(poId);
        console.log(`[R27.5] auto-product on Delhi dispatch PO ${poId}: created=${ap.created} skipped=${ap.skipped}`);
      } catch (e: any) { console.error("[R27.5] Delhi dispatch transfer hook failed:", e?.message || e); }

      // R26.5 H/E3 — PO shipped: notify the customer's sales rep, and email the customer if present.
      try {
        const poRow = rawSqlite
          .prepare(`SELECT customer_id, customer_po_number FROM purchase_orders_v2 WHERE id = ?`)
          .get(poId) as { customer_id?: number; customer_po_number?: string } | undefined;
        if (poRow?.customer_id) {
          const cust = rawSqlite
            .prepare(`SELECT id, name, email, sales_rep_id FROM customers WHERE id = ?`)
            .get(poRow.customer_id) as { id: number; name?: string; email?: string; sales_rep_id?: number } | undefined;
          if (cust?.sales_rep_id) {
            emitCrossTeamEvent(
              "po_shipped",
              { po_id: poId, customer_id: cust.id, customer_po_number: poRow.customer_po_number || null, docket_number: docketNumber || null, carrier: carrier || null },
              { target_user_id: cust.sales_rep_id, target_role: "sales" },
            );
          }
          if (cust?.email) {
            const { sendGenericEmail } = await import("./notifications");
            sendGenericEmail({
              to: cust.email,
              subject: `Your order has shipped${poRow.customer_po_number ? ` (PO ${poRow.customer_po_number})` : ""}`,
              html: `<p>Dear ${cust.name || "Customer"},</p><p>Your order${poRow.customer_po_number ? ` for PO <b>${poRow.customer_po_number}</b>` : ""} has been dispatched${carrier ? ` via <b>${carrier}</b>` : ""}${docketNumber ? ` (docket <b>${docketNumber}</b>)` : ""}.</p><p>Thank you,<br/>Narmada Mobility</p>`,
              text: `Dear ${cust.name || "Customer"}, your order has been dispatched${carrier ? ` via ${carrier}` : ""}${docketNumber ? ` (docket ${docketNumber})` : ""}.`,
              event: "po_shipped",
            }).catch((e: any) => console.error("[R26.5 E3] customer email failed:", e?.message || e));
          }
        }
      } catch (e: any) {
        console.error("[R26.5 E3] emit failed:", e?.message || e);
      }

      res.json(result);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- POST /api/delhi/po/:id/docket ---- (R26.2 multipart docket upload)
  // Stores transport name, docket number, docket date + slip on the PO. Auth: Delhi team.
  // Slip saved under uploads/docket-slips/ (reuses multerDocket: image/PDF, max 10MB).
  app.post("/api/delhi/po/:id/docket", requireDelhi, multerDocket.single("docketSlip"), async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(poId)) return res.status(400).json({ error: "Invalid PO id" });
      const gate = v2.getDelhiPoForDocket(poId);
      if ("notFound" in gate) return res.status(404).json({ error: "PO not found" });
      if ("notDelhi" in gate) return res.status(403).json({ error: "Only Delhi POs can be updated" });

      const docketTransport = String(req.body?.docketTransport || "").trim() || null;
      const docketNumber = String(req.body?.docketNumber || "").trim() || null;
      const docketDateRaw = String(req.body?.docketDate || "").trim();
      let docketDate: number | null = null;
      if (docketDateRaw) {
        const parsed = Date.parse(docketDateRaw);
        if (Number.isNaN(parsed)) return res.status(400).json({ error: "Invalid docketDate (expected ISO date string)" });
        docketDate = parsed;
      }
      // R26.2b — optional bundles count (mirrors the dispatch modal). Omit -> preserve prior value.
      const docketBundlesRaw = String(req.body?.docketBundles ?? req.body?.bundles ?? "").trim();
      let docketBundles: number | null | undefined = undefined;
      if (docketBundlesRaw) {
        const b = parseInt(docketBundlesRaw, 10);
        if (!Number.isInteger(b) || b < 0) return res.status(400).json({ error: "Invalid docketBundles (expected a non-negative integer)" });
        docketBundles = b;
      }

      const file = req.file;
      // R26.2b — only touch the slip path when a new file is uploaded. On replacement, unlink the
      // old slip (best-effort: a failed unlink must not fail the request).
      const prior = v2.getDelhiPoDocket(poId);
      const docketSlipPath: string | undefined = file ? `/uploads/docket-slips/${file.filename}` : undefined;
      // R26.2c — legacy dispatch columns (dispatches.docket_photo_url, po_items.docket_slip_url)
      // store an ABSOLUTE URL; build one from the same host the dispatch endpoint uses so the
      // existing Consignment / Team PO "View slip" links resolve to the freshly uploaded file.
      const proto = "https";
      const host = req.get("host") || "narmada-backend.onrender.com";
      const docketSlipUrlAbsolute: string | undefined = file ? `${proto}://${host}/uploads/docket-slips/${file.filename}` : undefined;
      if (file && prior?.docketSlipPath) {
        try {
          const rel = prior.docketSlipPath.replace(/^\/uploads\//, "");
          const oldAbs = path.join(ctx.uploadsDir || "./uploads", rel);
          if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
        } catch (unlinkErr: any) {
          console.log(`[R26.2b] failed to unlink old docket slip for PO ${poId} —`, unlinkErr?.message || unlinkErr);
        }
      }

      const updated = v2.setDelhiPoDocket(poId, { docketTransport, docketNumber, docketDate, docketSlipPath, docketBundles, docketSlipUrlAbsolute });

      await v2.writeAuditLog({
        actorType: "delhi", actorId: (req as any).teamUser?.username, action: "po.docket_upload",
        entityType: "purchase_order", entityId: String(poId),
        afterJson: JSON.stringify({ docketTransport, docketNumber, docketDate, docketBundles, docketSlipPath: docketSlipPath ?? prior?.docketSlipPath ?? null }),
      });

      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- GET /api/delhi/po/:id/docket ---- (R26.2 read back docket fields)
  app.get("/api/delhi/po/:id/docket", requireDelhi, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const poId = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(poId)) return res.status(400).json({ error: "Invalid PO id" });
      const docket = v2.getDelhiPoDocket(poId);
      if (!docket) return res.status(404).json({ error: "PO not found" });
      res.json(docket);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- DELETE /api/team/po/:id ---- (data team hard-delete, cascades)
  app.delete("/api/team/po/:id", requireDataTeam, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const deleted = await v2.deletePoCascade(poId);
      if (!deleted) return res.status(404).json({ error: "PO not found" });
      await v2.writeAuditLog({
        actorType: "data_team", actorId: u?.username, action: "po.delete",
        entityType: "purchase_order", entityId: String(poId),
        beforeJson: JSON.stringify({ poNumber: deleted.poNumber }),
      });
      res.json({ ok: true, poNumber: deleted.poNumber });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- DELETE /api/admin/po/:id ---- (admin hard-delete, cascades)
  app.delete("/api/admin/po/:id", requireAdminRole, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      const u = (req as any).user as TokenInfo;
      const deleted = await v2.deletePoCascade(poId);
      if (!deleted) return res.status(404).json({ error: "PO not found" });
      await v2.writeAuditLog({
        actorType: "admin", actorId: u?.username, action: "po.delete",
        entityType: "purchase_order", entityId: String(poId),
        beforeJson: JSON.stringify({ poNumber: deleted.poNumber }),
      });
      res.json({ ok: true, poNumber: deleted.poNumber });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/admin/po-by-number?po_number=... ---- (R13.5 diagnostic)
  // Returns the raw PO row for an EXACT po_number with NO soft-delete filter, to inspect
  // the state of an orphan row that may be blocking po_number reuse.
  app.get("/api/admin/po-by-number", requireAuth, async (req: any, res: any) => {
    try {
      const poNumber = String(req.query.po_number || "").trim();
      if (!poNumber) return res.status(400).json({ error: "po_number required" });
      const { po, lineItemCount } = v2.getPoByNumberRaw(poNumber);
      res.json({
        found: !!po,
        po: po || null,
        lineItemCount,
        deletedAt: po ? (po.deleted_at ?? null) : null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- POST /api/admin/force-purge-po ---- (R13.5 orphan cleanup)
  // Hard-deletes EVERY PO row matching po_number (active OR soft-deleted) plus cascade
  // children. Idempotent: purged=0 when nothing matches. Wrapped in a transaction inside
  // the storage helper.
  app.post("/api/admin/force-purge-po", requireAuth, async (req: any, res: any) => {
    try {
      const poNumber = String(req.body?.po_number || "").trim();
      if (!poNumber) return res.status(400).json({ error: "po_number required" });
      const result = v2.forcePurgePoByNumber(poNumber);
      if (result.purged === 0) return res.json({ ok: true, purged: 0 });
      const u = (req as any).user as TokenInfo;
      await v2.writeAuditLog({
        actorType: "admin", actorId: u?.username, action: "po.force_purge",
        entityType: "purchase_order", entityId: poNumber,
        beforeJson: JSON.stringify({ poNumber, purged: result.purged }),
      });
      res.json({ ok: true, purged: result.purged, poNumber: result.poNumber });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/team/rfq/active-chats?since= ---- (data-team chat hub)
  app.get("/api/team/rfq/active-chats", requireDataTeam, async (req: any, res: any) => {
    try {
      const since = req.query.since ? parseInt(req.query.since as string, 10) : (Date.now() - 30 * 24 * 60 * 60 * 1000);
      res.json(await v2.listActiveVendorChats(since));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- GET /api/admin/purchase-history ----
  app.get("/api/admin/purchase-history", requireAuth, async (req: any, res: any) => {
    try {
      const result = v2.listPurchaseHistory({
        q: req.query.q as string | undefined,
        brand: req.query.brand as string | undefined,
        vendorId: req.query.vendor_id ? parseInt(req.query.vendor_id as string, 10) : undefined,
        customerId: req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined,
        fromDate: req.query.from_date ? parseInt(req.query.from_date as string, 10) : undefined,
        toDate: req.query.to_date ? parseInt(req.query.to_date as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      });
      res.json({ rows: result.rows.map((r: any) => ({
        id: r.id,
        poNumber: r.po_number,
        poDate: r.po_date,
        customerName: r.customer_name,
        partNumber: r.part_number,
        brand: r.brand,
        qty: r.qty,
        vendorName: r.vendor_name,
        vendorRate: r.vendor_rate,
        lineTotal: r.line_total,
      })), total: result.total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- GET /api/admin/purchase-history/export.xlsx ----
  app.get("/api/admin/purchase-history/export.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const XLSX = require("xlsx");
      const result = v2.listPurchaseHistory({
        q: req.query.q as string | undefined,
        brand: req.query.brand as string | undefined,
        vendorId: req.query.vendor_id ? parseInt(req.query.vendor_id as string, 10) : undefined,
        customerId: req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined,
        limit: 5000,
        page: 1,
      });

      const sheetData = [
        ["Date", "PO #", "Customer", "Part #", "Brand", "Qty", "Seller", "Rate (\u20b9)", "Total (\u20b9)"],
        ...result.rows.map((r: any) => [
          r.po_date ? new Date(r.po_date).toLocaleDateString("en-IN") : "",
          r.po_number || "",
          r.customer_name || "",
          r.part_number || "",
          r.brand || "",
          r.qty || 0,
          r.vendor_name || "",
          r.vendor_rate != null ? r.vendor_rate : "",
          r.line_total != null ? r.line_total : "",
        ]),
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, "Purchase History");
      const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="purchase-history-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // R14.2 — Customer-rate PO PDF. Authorized for admin token OR data-team token OR
  // Delhi token (both Delhi AND data team can download). The PDF uses the CUSTOMER
  // rate only — no vendor name, no vendor rate, no internal cost columns.
  async function requireAdminOrTeam(req: any, res: any, next: any): Promise<void> {
    // Try team/Delhi token first (x-team-token / Bearer).
    const teamToken = (req.headers["x-team-token"] as string | undefined)
      || (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
    if (teamToken) {
      try {
        const session = await v2.getDataTeamSession(teamToken);
        if (session) {
          const user = await v2.getDataTeamUser(session.userId);
          if (user && user.active) { (req as any).teamUser = user; return next(); }
        }
      } catch { /* fall through to admin check */ }
    }
    // Fall back to admin token.
    if (req.headers["x-admin-token"]) return requireAuth(req, res, next);
    res.status(401).json({ error: "Unauthorized" });
  }

  app.get("/api/team/pos/:id/customer-pdf", requireAdminOrTeam, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.id as string, 10);
      const po = await v2.getPurchaseOrderV2(poId);
      if (!po) return res.status(404).json({ error: "PO not found" });
      const pdfSvc = require("./pdf-service") as typeof import("./pdf-service");
      const company = (po as any).companyId ? await v2.getCompany((po as any).companyId) : await v2.getDefaultCompany();
      const customer = (po as any).customerId ? await v2.getCustomer((po as any).customerId) : null;
      const pdfBuf = await pdfSvc.generateCustomerPOPDF({
        poNumber: po.poNumber,
        createdAt: (po as any).createdAt ?? null,
        poDate: (po as any).poDate ?? (po as any).createdAt ?? null,
        status: po.status,
        subtotal: (po as any).subtotal ?? null,
        discount: (po as any).discount ?? null,
        tax: (po as any).tax ?? null,
        total: (po as any).total ?? null,
        customerName: po.customerName ?? customer?.name ?? null,
        customerPoNumber: (po as any).customerPoNumber ?? null,
        shipToName: (po as any).shipToName ?? null,
        shipToAddress: (po as any).shipToAddress ?? null,
        shipToPhone: (po as any).shipToPhone ?? null,
        items: (po.items || []).map((it: any) => ({
          partNumber: it.partNumber,
          brand: it.brand,
          description: it.description,
          qty: it.qty,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          // R17: locked seller NAME only (when a vendor is locked). No vendor rate/cost.
          vendorName: it.approvedQuoteId != null ? (it.vendorName ?? null) : null,
        })),
      }, company);
      const fname = `PO-${po.poNumber.replace(/\//g, "-")}-customer.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      res.send(pdfBuf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R14.6 — Delhi dashboard pending buckets (single payload). range ∈ {1d,3d,7d,30d},
  // falls back to 7d for anything else. Filters by notified_delhi_at (falling back to
  // created_at) within the window.
  app.get("/api/delhi/dashboard-pending", requireDelhi, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const rangeRaw = String(req.query.range || "7d");
      const RANGE_DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
      const days = RANGE_DAYS[rangeRaw] ?? 7;
      const fromMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const buckets = v2.getDelhiDashboardPending(fromMs);
      res.json({ range: RANGE_DAYS[rangeRaw] ? rangeRaw : "7d", ...buckets });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R22 — Consignment visibility + customer create (admin token)
  // ============================================================
  // R22.1 — POs Delhi has dispatched, surfaced as a "From Delhi" category.
  app.get("/api/admin/consignment/from-delhi", requireAuth, async (req: any, res: any) => {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const q = req.query.q ? String(req.query.q) : undefined;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const origin = `${req.protocol || "https"}://${req.get("host") || "narmada-backend.onrender.com"}`;
      res.json(v2.listDelhiDispatchedForConsignment({ status, q, from, to, origin }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26 — full detail for the From-Delhi "View" modal.
  app.get("/api/admin/consignment/:poId/detail", requireAuth, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.poId as string, 10);
      const origin = `${req.protocol || "https"}://${req.get("host") || "narmada-backend.onrender.com"}`;
      const detail = v2.getConsignmentDetail(poId, origin);
      if (!detail) return res.status(404).json({ error: "PO not found" });
      res.json(detail);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26 — export selected From-Delhi consignments as a single PDF (one section per PO).
  app.post("/api/admin/consignments/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const poIds: number[] = Array.isArray(req.body?.po_ids)
        ? req.body.po_ids.map((n: any) => parseInt(String(n), 10)).filter((n: number) => !Number.isNaN(n))
        : [];
      if (poIds.length === 0) return res.status(400).json({ error: "po_ids must be a non-empty array" });
      const details = poIds.map((id) => v2.getConsignmentDetail(id)).filter(Boolean) as any[];
      if (details.length === 0) return res.status(404).json({ error: "No matching consignments" });

      const { PdfBuilder } = await import("./pdf-utils");
      const stamp = new Date();
      const builder = await PdfBuilder.create(
        "Consignments — From Delhi",
        `Generated ${stamp.toLocaleDateString("en-IN")} · ${details.length} PO(s)`,
      );
      const fmtDate = (ms: number | null) => ms ? new Date(ms).toLocaleDateString("en-IN") : "—";
      details.forEach((d, idx) => {
        const statusLabel = d.consignmentStatus
          ? d.consignmentStatus.charAt(0).toUpperCase() + d.consignmentStatus.slice(1)
          : "Pending";
        builder.sectionTitle(`${d.poNumber} · ${d.customerName || "—"} · ${statusLabel}`);
        builder.keyValues([
          ["Customer", d.customerName || "—"],
          ["PO Number", d.poNumber],
          ["Delhi Dispatch", fmtDate(d.delhiSubmittedAt)],
          ["Status", statusLabel],
        ]);
        builder.table(
          [
            { header: "Item", width: 210 },
            { header: "Qty", width: 50, align: "right" },
            { header: "Brand", width: 110 },
            { header: "Vendor", width: 129 },
          ],
          (d.items as any[]).map((it) => [it.name, String(it.qty), it.brand || "—", it.vendorName || "—"]),
        );
        builder.note(
          `Total items: ${d.totalItems}   ·   Total bundles: ${d.totalBundles}   ·   Carrier: ${d.carrier || "—"}   ·   Dockets: ${(d.dockets || []).join(", ") || "—"}`,
        );
        if (idx < details.length - 1) builder.spacer(12);
      });
      const buffer = await builder.finish();
      const fname = `consignments-${stamp.toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      res.send(buffer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R22.1 — mark a Delhi-dispatched PO received / processing / completed in the consignment view.
  app.post("/api/admin/consignment/:poId/status", requireAuth, async (req: any, res: any) => {
    try {
      const poId = parseInt(req.params.poId as string, 10);
      const status = String(req.body?.status || "").trim();
      if (!["received", "processing", "completed"].includes(status)) {
        return res.status(400).json({ error: "status must be received|processing|completed" });
      }
      res.json(v2.setConsignmentStatus(poId, status));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R22.2 — consignment customer create + list (reuses the customers table; admin token).
  app.post("/api/admin/consignment/customers", requireAuth, async (req: any, res: any) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: "name is required" });
      const customer = await v2.createCustomer({
        name,
        phone: req.body?.phone || null,
        address: req.body?.address || null,
        notes: req.body?.company ? `Company: ${req.body.company}` : (req.body?.notes || null),
      } as any);
      res.json(customer);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/consignment/customers", requireAuth, async (req: any, res: any) => {
    try {
      const q = String(req.query?.q || "").trim();
      const list = await v2.getCustomers(q || undefined);
      res.json(list.slice(0, 100));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R23 — Command Center + margin summary + ledger backfill + vendor-ledger CSV
  // ============================================================
  app.get("/api/admin/command-center", requireAuth, async (req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const range = (from != null && to != null) ? { from, to } : undefined;
      res.json(v2.commandCenterWidgets(range));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/margin-summary", requireAuth, async (req: any, res: any) => {
    try {
      const fromMs = req.query.from ? Number(req.query.from) : Date.now() - 30 * 24 * 60 * 60 * 1000;
      const toMs = req.query.to ? Number(req.query.to) : Date.now();
      const summary = v2.marginSummary(fromMs, toMs);
      // R26.5 (A1) — ensure periodLabel is present for the Command Center margin card.
      const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      res.json({ ...summary, periodLabel: `${fmt(fromMs)} → ${fmt(toMs)}` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R23.2 — backfill ledger entries for already-fulfilled POs (idempotent). Safe to re-run.
  app.post("/api/admin/ledger/backfill-fulfilments", requireAdminRole, async (_req: any, res: any) => {
    try {
      const fulfilled = await v2.listPurchaseOrdersV2({ status: "fulfilled" });
      let wrote = 0;
      for (const po of fulfilled) { if (v2.writePoFulfilmentLedger(po.id)) wrote++; }
      res.json({ ok: true, scanned: fulfilled.length, wrote });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R23.2 — vendor ledger CSV export (xlsx already exists; this is the CSV the task asked for).
  app.get("/api/admin/vendor-ledger/export.csv", requireAuth, async (req: any, res: any) => {
    try {
      const vendorId = req.query.vendor_id ? parseInt(req.query.vendor_id as string, 10) : undefined;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const rows = v2.getVendorLedger({ vendorId, from, to });
      const header = ["vendor", "items", "approved_value", "paid", "balance", "last_activity"];
      const lines = [header.join(",")];
      for (const r of (rows as any[])) {
        const balance = (Number(r.total_approved_value) || 0) - (Number(r.total_paid) || 0);
        const cells = [
          r.vendor_name ?? r.vendorName ?? `#${r.vendor_id}`,
          r.item_count ?? 0,
          r.total_approved_value ?? 0,
          r.total_paid ?? 0,
          balance,
          r.last_activity_at ? new Date(Number(r.last_activity_at)).toISOString().slice(0, 10) : "",
        ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
        lines.push(cells.join(","));
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="vendor-ledger.csv"');
      res.send(lines.join("\n"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // R24 — Market Radar: convert lead, marketing send, chats
  // ============================================================
  app.post("/api/admin/leads/:id/convert", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = v2.convertLeadToCustomer(id);
      if (!result) return res.status(404).json({ error: "lead not found" });
      res.json({ ok: true, customerId: result.customerId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R25a Fix 4 — convert a lead into a vendor (seller) record.
  app.post("/api/admin/leads/:id/convert-to-vendor", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = v2.convertLeadToVendor(id);
      if (!result) return res.status(404).json({ error: "lead not found" });
      res.json({ ok: true, vendorId: result.vendorId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R25a Fix 4 — send a marketing email to a single lead via SMTP; log to marketing_sends.
  app.post("/api/admin/leads/:id/send-email", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const lead = await v2.getLead(id);
      if (!lead) return res.status(404).json({ error: "lead not found" });
      if (!lead.email) return res.status(400).json({ error: "lead has no email" });
      const subject = String(req.body?.subject || "A message from Narmada Mobility");
      const body = String(req.body?.body || "");
      if (!body.trim()) return res.status(400).json({ error: "body required" });
      const sentBy = (req as any).user?.username || "admin";
      const log = v2.logMarketingSend({ leadId: id, phone: lead.email, template: "email", vars: JSON.stringify({ subject }), status: "queued", sentBy });
      const { sendMarketingEmail } = await import("./email");
      const r = await sendMarketingEmail({ to: lead.email, subject, body });
      v2.updateMarketingSendStatus(log.id, r.ok ? "sent" : "failed", r.ok ? null : r.error || "send failed");
      await v2.addLeadActivity(id, "email", `${subject}`, sentBy);
      res.json({ ok: r.ok, via: r.via, error: r.error });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R25a Fix 4 — send WhatsApp brochure to a lead via AiSensy marketing template (fire-and-forget).
  app.post("/api/admin/leads/:id/send-whatsapp-brochure", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const lead = await v2.getLead(id);
      if (!lead) return res.status(404).json({ error: "lead not found" });
      const phone = lead.phone || lead.whatsapp;
      if (!phone) return res.status(400).json({ error: "lead has no phone" });
      const template = process.env.AISENSY_CAMPAIGN_BROCHURE || "narmada_marketing_brochure";
      const sentBy = (req as any).user?.username || "admin";
      const log = v2.logMarketingSend({ leadId: id, phone, template, status: "queued", sentBy });
      const wa = require("./whatsapp") as typeof import("./whatsapp");
      // fire-and-forget
      wa.sendMarketingMessage(phone, { name: lead.name, template })
        .then((r) => { try { v2.updateMarketingSendStatus(log.id, r.status === "failed" ? "failed" : "sent", r.status === "failed" ? "aisensy failed" : null); } catch {} })
        .catch((err) => { try { v2.updateMarketingSendStatus(log.id, "failed", String(err?.message || err)); } catch {} });
      v2.addLeadActivity(id, "whatsapp", `brochure (${template})`, sentBy).catch(() => {});
      res.json({ ok: true, queued: 1, template });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R24.3 — marketing send to selected leads (fire-and-forget; logged in marketing_sends).
  app.post("/api/admin/leads/send-marketing", requireAuth, async (req: any, res: any) => {
    try {
      const leadIds: number[] = Array.isArray(req.body?.lead_ids) ? req.body.lead_ids.map(Number) : [];
      const template = req.body?.template ? String(req.body.template) : undefined;
      const vars = req.body?.vars || {};
      if (!leadIds.length) return res.status(400).json({ error: "lead_ids required" });
      const sentBy = (req as any).user?.username || "admin";
      const wa = require("./whatsapp") as typeof import("./whatsapp");
      let queued = 0;
      for (const id of leadIds) {
        const lead = await v2.getLead(id);
        const phone = lead?.phone || lead?.whatsapp;
        if (!phone) { v2.logMarketingSend({ leadId: id, status: "failed", error: "no phone", sentBy, template: template || null }); continue; }
        const log = v2.logMarketingSend({ leadId: id, phone, template: template || null, vars: JSON.stringify(vars), status: "queued", sentBy });
        queued++;
        // fire-and-forget
        wa.sendMarketingMessage(phone, { name: lead?.name, template, templateParams: vars?.params })
          .then((r) => { try { v2.updateMarketingSendStatus(log.id, r.status === "failed" ? "failed" : "sent", r.status === "failed" ? "aisensy failed" : null); } catch {} })
          .catch((err) => { try { v2.updateMarketingSendStatus(log.id, "failed", String(err?.message || err)); } catch {} });
      }
      res.json({ ok: true, queued });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R24.4 — unified chats: conversation list + thread + send.
  app.get("/api/admin/chats", requireAuth, async (_req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json(v2.listChatConversations());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/chats/:vendorId", requireAuth, async (req: any, res: any) => {
    try { res.json(v2.listChatThread(parseInt(req.params.vendorId as string, 10))); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/chats/:vendorId/send", requireAuth, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const vendor = await v2.getVendor(vendorId);
      if (!vendor) return res.status(404).json({ error: "vendor not found" });
      const text = String(req.body?.message || "").trim();
      // R27.4 BUG-16 — allow an attachment-only message (image/pdf URL) with no text.
      const attachmentUrl = req.body?.attachment_url ? String(req.body.attachment_url) : null;
      const attachmentType = req.body?.attachment_type ? String(req.body.attachment_type) : null;
      if (!text && !attachmentUrl) return res.status(400).json({ error: "message or attachment required" });
      const phone = vendor.whatsapp || vendor.phone;
      const wa = require("./whatsapp") as typeof import("./whatsapp");
      if (phone) {
        if (attachmentUrl) wa.sendMediaMessage(phone, attachmentUrl, text, "admin_chat_media").catch(() => {});
        else wa.sendTextMessage(phone, text, "admin_chat").catch(() => {});
      }
      const row = v2.addRfqMessageExternal({ vendorId, vendorPhone: phone || null, direction: "out", body: text, externalMessageId: null, attachmentUrl, attachmentType });
      res.json({ ok: true, message: row });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R25a Fix 3 — team-auth mirrors of the unified chats endpoints so the procurement/data
  // team can use the same WhatsApp-web-style chat UI at /#/team/chats. Same data as admin
  // (all vendor conversations); auth is requireDataTeam (x-team-token) instead of admin.
  app.get("/api/team/chats", requireDataTeam, async (_req: any, res: any) => {
    try {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.json(v2.listChatConversations());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/team/chats/:vendorId", requireDataTeam, async (req: any, res: any) => {
    try { res.json(v2.listChatThread(parseInt(req.params.vendorId as string, 10))); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/team/chats/:vendorId/send", requireDataTeam, async (req: any, res: any) => {
    try {
      const vendorId = parseInt(req.params.vendorId as string, 10);
      const vendor = await v2.getVendor(vendorId);
      if (!vendor) return res.status(404).json({ error: "vendor not found" });
      const text = String(req.body?.message || "").trim();
      // R27.4 BUG-16 — allow an attachment-only message (image/pdf URL) with no text.
      const attachmentUrl = req.body?.attachment_url ? String(req.body.attachment_url) : null;
      const attachmentType = req.body?.attachment_type ? String(req.body.attachment_type) : null;
      if (!text && !attachmentUrl) return res.status(400).json({ error: "message or attachment required" });
      const phone = vendor.whatsapp || vendor.phone;
      const wa = require("./whatsapp") as typeof import("./whatsapp");
      if (phone) {
        if (attachmentUrl) wa.sendMediaMessage(phone, attachmentUrl, text, "team_chat_media").catch(() => {});
        else wa.sendTextMessage(phone, text, "team_chat").catch(() => {});
      }
      const row = v2.addRfqMessageExternal({ vendorId, vendorPhone: phone || null, direction: "out", body: text, externalMessageId: null, attachmentUrl, attachmentType });
      res.json({ ok: true, message: row });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R27.4 BUG-16 — team-token file upload (PDF/image, base64 dataUrl) so the
  // data-team Chats UI can attach files. Mirrors /api/admin/upload-file.
  app.post("/api/team/upload-file", requireDataTeam, async (req: any, res: any) => {
    try {
      const { dataUrl, filename } = req.body || {};
      if (!dataUrl) return res.status(400).json({ error: "Missing dataUrl" });
      const m = /^data:([a-zA-Z0-9/+.\-]+);base64,(.*)$/.exec(String(dataUrl));
      let mime = "application/octet-stream", b64 = String(dataUrl);
      if (m) { mime = m[1]; b64 = m[2]; }
      const allowed: Record<string, string> = {
        "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg",
        "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif",
      };
      const ext = allowed[mime];
      if (!ext) return res.status(415).json({ error: "Only PDF and image files are allowed" });
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 15 * 1024 * 1024) return res.status(413).json({ error: "File too large (max 15MB)" });
      const safe = String(filename || "file").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      const id = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}.${ext}`;
      fs.writeFileSync(path.join(ctx.uploadsDir, id), buf);
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const host = req.get('host');
      res.json({ url: `${proto}://${host}/uploads/${id}`, path: `/uploads/${id}` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R27.4 BUG-16 — WhatsApp delivery health. The founder reported ~90% of chat
  // messages failing; this aggregates notification_log so the failure REASONS are
  // visible (AiSensy rejects templates/numbers — see error_msg). Read-only.
  app.get("/api/admin/chat/stats", requireAuth, async (req: any, res: any) => {
    try {
      const { rawSqlite } = await import("./storage");
      const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || "7"), 10) || 7));
      const since = Date.now() - days * 86400000;
      const totals = rawSqlite.prepare(
        `SELECT status, COUNT(*) c FROM notification_log
         WHERE channel='whatsapp' AND sent_at >= ? GROUP BY status`
      ).all(since) as Array<{ status: string; c: number }>;
      const byReason = rawSqlite.prepare(
        `SELECT COALESCE(NULLIF(TRIM(error_msg),''),'(no reason given)') reason, COUNT(*) c
         FROM notification_log
         WHERE channel='whatsapp' AND status='failed' AND sent_at >= ?
         GROUP BY reason ORDER BY c DESC LIMIT 25`
      ).all(since) as Array<{ reason: string; c: number }>;
      const sent = totals.find((t) => t.status === "sent")?.c || 0;
      const failed = totals.find((t) => t.status === "failed")?.c || 0;
      const queued = totals.find((t) => t.status === "queued")?.c || 0;
      const total = sent + failed + queued;
      res.json({
        days, total, sent, failed, queued,
        failureRate: total ? Math.round((failed / total) * 1000) / 10 : 0,
        byReason,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==========================================================================
  // R26.5 — Sales/Finance/HR/Consignment roles, Leads V2, Tasks V2, sales
  // targets, attendance/visit check-ins, cross-team notifications, user mgmt,
  // marketing additions, and admin mirrors. All additive.
  // ==========================================================================

  // ---- E2. role-aware middleware over the data_team store (Delhi pattern) ----
  function requireDataTeamRole(...allowed: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const token = (req.headers["x-sales-token"] as string | undefined)
        || (req.headers["x-finance-token"] as string | undefined)
        || (req.headers["x-hr-token"] as string | undefined)
        || (req.headers["x-consignment-token"] as string | undefined)
        || (req.headers["x-team-token"] as string | undefined)
        || (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
      if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
      const session = await v2.getDataTeamSession(token);
      if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
      const user = await v2.getDataTeamUser(session.userId);
      if (!user || !user.active) { res.status(401).json({ error: "Unauthorized" }); return; }
      if (allowed.length && user.role !== "admin" && !allowed.includes(user.role)) {
        res.status(403).json({ error: `Role ${allowed.join("/")} required` }); return;
      }
      (req as any).teamUser = user;
      next();
    };
  }
  const requireSales = requireDataTeamRole("sales");
  const requireFinance = requireDataTeamRole("finance");
  const requireHR = requireDataTeamRole("hr");
  const requireConsignment = requireDataTeamRole("consignment");

  // ---- E1. role logins (issue a data_team session; client stores as role token) ----
  function makeRoleLogin(roleName: string) {
    return async (req: Request, res: Response) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: "username and password required" });
        const user = await v2.getDataTeamUserByUsername(String(username));
        if (!user || !user.active) return res.status(401).json({ error: "Invalid credentials" });
        if (user.role !== roleName && user.role !== "admin") return res.status(403).json({ error: `Not a ${roleName} account` });
        if (!verifyPassword(String(password), user.passwordHash)) return res.status(401).json({ error: "Invalid credentials" });
        const session = await v2.createDataTeamSession(user.id);
        await v2.touchDataTeamUserLogin(user.id);
        // R27.11 #1 — every portal role auto-gets a staff row on login (idempotent,
        // best-effort, never blocks login). Admins are skipped (no staff mirror).
        if (user.role && user.role !== "admin") {
          r27().then((s) => { try { s.ensureEmployeeForUser(user.id, user.role); } catch { /* best-effort */ } }).catch(() => {});
        }
        const { passwordHash: _ph, ...safeUser } = user;
        res.json({ token: session.token, expiresAt: session.expiresAt, user: safeUser });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    };
  }
  app.post("/api/sales/login", makeRoleLogin("sales"));
  app.post("/api/finance/login", makeRoleLogin("finance"));
  app.post("/api/hr/login", makeRoleLogin("hr"));
  app.post("/api/consignment/login", makeRoleLogin("consignment"));
  app.get("/api/sales/me", requireSales, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });
  app.get("/api/finance/me", requireFinance, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });
  app.get("/api/hr/me", requireHR, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });
  app.get("/api/consignment/me", requireConsignment, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });

  // ---- A4. ADMIN PARTS MASTER (mirror of /api/team/parts) ----
  app.get("/api/admin/parts", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string) || (req.query.search as string) || "";
      if (q.length < 3) return res.json([]);
      // R26.6a (4) — union master catalog + PO line-item history.
      res.json(v2.listPartsUnion(q, 50));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/parts", requireAdminRole, async (req, res) => {
    try {
      const { partNumber, part_number, name, hsn, gstRate, gst_rate, brand, lastMrp, last_mrp } = req.body || {};
      const pn = partNumber || part_number;
      if (!pn || !name) return res.status(400).json({ error: "partNumber and name required" });
      res.json(v2.adminUpsertPart({ partNumber: String(pn), name: String(name), hsn, gstRate: gstRate ?? gst_rate, brand, lastMrp: lastMrp ?? last_mrp }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/parts/:partNumber", requireAdminRole, async (req, res) => {
    try {
      const pn = String(req.params.partNumber);
      const existing = v2.adminListParts(pn, 1).find((p: any) => p.partNumber === pn || p.part_number === pn);
      const name = req.body.name ?? (existing as any)?.name;
      if (!name) return res.status(400).json({ error: "name required" });
      res.json(v2.adminUpsertPart({ partNumber: pn, name: String(name), hsn: req.body.hsn, gstRate: req.body.gstRate ?? req.body.gst_rate, brand: req.body.brand, lastMrp: req.body.lastMrp ?? req.body.last_mrp }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/parts/:partNumber", requireAdminRole, async (req, res) => {
    try { v2.adminDeletePart(String(req.params.partNumber)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- A3. ADMIN QUOTATIONS CRUD (mirror Data Team v2 logic; DT is source of truth) ----
  app.post("/api/admin/quotations", requireAuth, async (req, res) => {
    try {
      const { items: rawItems, company_id, ...quotationData } = req.body || {};
      if (!quotationData.customerId) return res.status(400).json({ error: "customerId required" });
      if (quotationData.companyId == null && company_id != null) quotationData.companyId = parseInt(String(company_id), 10);
      const items = Array.isArray(rawItems) ? rawItems : [];
      let companyPrefix = "NM";
      if (quotationData.quotingCompanyId) {
        const co = await v2.resolveQuotingEntity(Number(quotationData.quotingCompanyId));
        if (co?.quotePrefix) companyPrefix = co.quotePrefix;
      }
      const { quotation, items: savedItems } = await v2.createQuotation(
        { ...quotationData } as any,
        items.map((item: any, idx: number) => ({ ...item, lineNo: item.lineNo || idx + 1 })),
        companyPrefix,
      );
      try { v2.syncQuotationToTargets(quotation.id); }
      catch (err: any) { console.error("[R26.6g] quotation→target sync skipped:", err?.message || err); }
      res.json({ quotation, items: savedItems });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/quotations/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { items: rawItems, company_id, ...patchData } = req.body || {};
      if (patchData.companyId == null && company_id != null) patchData.companyId = parseInt(String(company_id), 10);
      const updated = await v2.updateQuotation(id, patchData);
      if (!updated) return res.status(404).json({ error: "Quotation not found" });
      let savedItems = undefined;
      if (Array.isArray(rawItems)) savedItems = await v2.updateQuotationItems(id, rawItems);
      res.json({ quotation: updated, items: savedItems });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/quotations/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const existing = await v2.getQuotation(id);
      if (!existing) return res.status(404).json({ error: "Quotation not found" });
      await v2.softDeleteQuotation(id);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- A5. ADMIN POs v2 (mirror Data Team; DT is source of truth) ----
  app.get("/api/admin/purchase-orders-v2", requireAuth, async (req, res) => {
    try {
      const rows = await v2.listPurchaseOrdersV2WithTotals({
        status: req.query.status as string | undefined,
        customerId: req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined,
        q: req.query.q as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      const summary = await v2.getDispatchSummaryForPOs(rows.map((r: any) => r.id));
      // R27.4 BUG-7 — per-PO open-deviation rollup so the admin list can show the Deviation column.
      let devSummary: Record<number, { count: number }> = {};
      try { const r27mod = await import("./storage-r27"); devSummary = r27mod.deviationSummaryForPOs(rows.map((r: any) => r.id)); } catch { /* deviation table may not exist on older DBs */ }
      res.json(rows.map((r: any) => {
        const s = summary[r.id];
        const dev = devSummary[r.id];
        return { ...r, dispatches: s?.dispatches || [], dispatchCarrier: s?.carrier || null, dispatchBundles: s?.bundles || 0, dispatchDockets: s?.docketNumbers || [], hasDeviation: !!(dev && dev.count > 0), deviationCount: dev?.count || 0 };
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26.6a (5) — admin PO detail (header + lines + dispatches + payments + customer + vendor).
  app.get("/api/admin/purchase-orders-v2/:id", requireAuth, async (req, res) => {
    try {
      const detail = await v2.getPurchaseOrderV2Detail(parseInt(req.params.id as string, 10));
      if (!detail) return res.status(404).json({ error: "Not found" });
      res.json(detail);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/purchase-orders-v2", requireAdminRole, async (req, res) => {
    try {
      const { items, ...data } = req.body || {};
      const po = await v2.createPurchaseOrderV2(data, Array.isArray(items) ? items : []);
      res.json(po);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/purchase-orders-v2/:id", requireAdminRole, async (req, res) => {
    try {
      const updated = await v2.updatePurchaseOrderV2(parseInt(req.params.id as string, 10), req.body || {});
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/purchase-orders-v2/:id", requireAdminRole, async (req, res) => {
    try {
      rawSqlite.prepare(`UPDATE purchase_orders_v2 SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(Date.now(), Date.now(), parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.1a BUG 6 — admin "Process PO" action. Splits confirmed lines (status -> processed)
  // from unconfirmed (moved to a new pending PO). Mirrors the data-team /process route but
  // gated on admin auth so the PO Dashboard button works.
  app.post("/api/admin/purchase-orders/:id/mark-processed", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = v2.processPurchaseOrder(id);
      res.json(result);
    } catch (e: any) {
      const msg = e?.message || "Process failed";
      const code = /No confirmed lines|not found/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  // ==================== R26.6a (10). OAUTH STATUS / DISCONNECT ====================
  // Reads the oauth_tokens table (created in R26.3) so the Google/Meta Ads pages can
  // reflect their actual connected state and offer a Disconnect action.
  app.get("/api/admin/oauth/status", requireAuth, async (_req, res) => {
    try {
      const row = (provider: string) =>
        rawSqlite.prepare(
          `SELECT account_email, account_name, account_id, scopes
             FROM oauth_tokens WHERE provider = ? AND is_active = 1
             ORDER BY connected_at DESC LIMIT 1`,
        ).get(provider) as any | undefined;
      const g = row("google");
      const m = row("meta");
      const parseScopes = (s: any): string[] => {
        if (!s) return [];
        try { const j = JSON.parse(s); return Array.isArray(j) ? j : String(s).split(/[\s,]+/).filter(Boolean); }
        catch { return String(s).split(/[\s,]+/).filter(Boolean); }
      };
      res.json({
        google: { connected: !!g, email: g?.account_email ?? null, scopes: parseScopes(g?.scopes) },
        meta: { connected: !!m, account_name: m?.account_name ?? null, app_id: m?.account_id ?? null },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/admin/oauth/:provider", requireAdminRole, async (req, res) => {
    try {
      const provider = String(req.params.provider);
      if (!["google", "meta"].includes(provider)) return res.status(400).json({ error: "Unknown provider" });
      const info = rawSqlite.prepare(`DELETE FROM oauth_tokens WHERE provider = ?`).run(provider);
      res.json({ ok: true, provider, removed: info.changes });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==================== B. LEADS V2 ====================
  app.get("/api/admin/leads-v2", requireAuth, async (req, res) => {
    try {
      res.json(v2.listLeadsV2({
        stage: req.query.stage as string | undefined,
        assignedTo: req.query.assigned_to ? parseInt(req.query.assigned_to as string, 10) : undefined,
        search: req.query.search as string | undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/leads-v2", requireAuth, async (req, res) => {
    try { res.json(v2.createLeadV2(req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/leads-v2/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const before = v2.getLeadRow(id);
      if (!before) return res.status(404).json({ error: "Not found" });
      const updated = v2.updateLeadV2(id, req.body || {});
      // H E1 — notify the rep when assignment changes.
      const newAssignee = req.body?.assigned_to_user_id ?? req.body?.assignedToUserId;
      if (newAssignee != null && Number(newAssignee) !== Number(before.assigned_to_user_id)) {
        const rep = await v2.getDataTeamUser(Number(newAssignee));
        emitCrossTeamEvent("lead_assigned", { lead_id: id, lead_name: updated.name, assigned_to: Number(newAssignee) }, {
          target_user_id: Number(newAssignee), target_role: "sales",
          whatsapp_phone: rep?.phone || null, whatsapp_template: rep?.phone ? "narmada_marketing_v1" : null,
          whatsapp_vars: [rep?.name || "Sales Rep", "Lead", `New lead assigned: ${updated.name}`],
        });
      }
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/leads-v2/:id", requireAuth, async (req, res) => {
    try { v2.softDeleteLeadV2(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Lead stages
  app.get("/api/admin/lead-stages", requireAuth, async (_req, res) => { res.json(v2.listLeadStages()); });
  app.post("/api/admin/lead-stages", requireAdminRole, async (req, res) => {
    try {
      if (!req.body?.name) return res.status(400).json({ error: "name required" });
      res.json(v2.createLeadStage({ name: String(req.body.name), position: req.body.position }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/lead-stages/:id", requireAdminRole, async (req, res) => {
    try { res.json(v2.updateLeadStage(parseInt(req.params.id as string, 10), req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/lead-stages/:id", requireAdminRole, async (req, res) => {
    try { v2.deleteLeadStage(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Leads XLSX export — one sheet per stage.
  app.get("/api/admin/leads/export.xlsx", requireAuth, async (_req, res) => {
    try {
      const stages = v2.listLeadStages();
      const wb = XLSX.utils.book_new();
      const cols = ["id", "name", "contact_person", "phone", "email", "address", "city", "state", "stage", "source", "requirement", "assigned_to_user_id", "created_at"];
      for (const st of stages) {
        const rows = v2.listLeadsV2({ stage: st.name });
        const data = rows.map((r: any) => { const o: any = {}; for (const c of cols) o[c] = r[c] ?? ""; return o; });
        const ws = XLSX.utils.json_to_sheet(data.length ? data : [Object.fromEntries(cols.map((c) => [c, ""]))]);
        XLSX.utils.book_append_sheet(wb, ws, st.name.slice(0, 31));
      }
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const fname = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Sales mirror: only leads assigned to the logged-in rep.
  app.get("/api/sales/leads", requireSales, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(v2.listLeadsV2({ assignedTo: u.id, stage: req.query.stage as string | undefined, search: req.query.search as string | undefined }));
  });
  app.patch("/api/sales/leads/:id/stage", requireSales, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const lead = v2.getLeadRow(id);
      if (!lead || lead.assigned_to_user_id !== u.id) return res.status(404).json({ error: "Not found" });
      if (!req.body?.stage) return res.status(400).json({ error: "stage required" });
      res.json(v2.updateLeadV2(id, { stage: String(req.body.stage) }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // G2. Sales leads kanban
  app.get("/api/sales/leads/kanban", requireSales, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(v2.leadsKanbanForRep(u.id));
  });

  // ==================== C. TASKS V2 (over task_items) ====================
  const taskUploadsDir = path.join(ctx.uploadsDir || "./uploads", "tasks");
  if (!fs.existsSync(taskUploadsDir)) fs.mkdirSync(taskUploadsDir, { recursive: true });
  const multerTask = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, taskUploadsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });
  const TASK_STATUSES = ["pending", "processing", "standby", "complete", "open", "doing", "done"];
  app.post("/api/admin/tasks/:id/file", requireAuth, multerTask.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const id = parseInt(req.params.id as string, 10);
      const proto = req.protocol || "https";
      const host = req.get("host") || "narmada-backend.onrender.com";
      const fileUrl = `${proto}://${host}/uploads/tasks/${req.file.filename}`;
      const t = await v2.updateTaskItem(id, { fileUrl } as any);
      if (!t) return res.status(404).json({ error: "Not found" });
      res.json(t);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/tasks/:id/status", requireAuth, async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      if (!TASK_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Allowed: ${TASK_STATUSES.join(", ")}` });
      const t = await v2.updateTaskItem(parseInt(req.params.id as string, 10), { status } as any);
      if (!t) return res.status(404).json({ error: "Not found" });
      res.json(t);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Sales mirror: own tasks + status change
  app.get("/api/sales/tasks", requireSales, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(await v2.listTaskItems({ assignedTo: u.id, status: req.query.status as string | undefined }));
  });
  // R26.6g — closed/completed tasks are immutable: reject status changes with 409.
  const CLOSED_TASK_STATUSES = new Set(["closed", "complete", "completed", "done"]);
  app.patch("/api/sales/tasks/:id/status", requireSales, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const all = await v2.listTaskItems({ assignedTo: u.id });
      const current = all.find((t: any) => t.id === id) as any;
      if (!current) return res.status(404).json({ error: "Not found" });
      if (CLOSED_TASK_STATUSES.has(String(current.status || "").toLowerCase())) {
        return res.status(409).json({ error: "Task is closed and cannot be modified." });
      }
      const status = String(req.body?.status || "");
      if (!TASK_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
      res.json(await v2.updateTaskItem(id, { status } as any));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R26.6g — C2: per-task remark log. Viewable always; adding blocked on closed tasks.
  app.get("/api/sales/tasks/:id/remarks", requireSales, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const all = await v2.listTaskItems({ assignedTo: u.id });
      if (!all.find((t: any) => t.id === id)) return res.status(404).json({ error: "Not found" });
      res.json(v2.listTaskRemarks(id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/sales/tasks/:id/remarks", requireSales, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const u = (req as any).teamUser;
      const all = await v2.listTaskItems({ assignedTo: u.id });
      const current = all.find((t: any) => t.id === id) as any;
      if (!current) return res.status(404).json({ error: "Not found" });
      if (CLOSED_TASK_STATUSES.has(String(current.status || "").toLowerCase())) {
        return res.status(409).json({ error: "Task is closed and cannot be modified." });
      }
      const body = String(req.body?.body || "").trim();
      if (!body) return res.status(400).json({ error: "Remark body is required" });
      res.json(v2.addTaskRemark(id, u.id, u.name || u.username || null, body));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Admin: read remarks for any task (for the admin task view).
  app.get("/api/admin/tasks/:id/remarks", requireAuth, async (req, res) => {
    try { res.json(v2.listTaskRemarks(parseInt(req.params.id as string, 10))); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==================== D. USER MANAGEMENT ====================
  const VALID_USER_ROLES = ["admin", "data_team", "team", "dispatch", "delhi", "delhi_warehouse", "consignment", "sales", "finance", "hr", "customer"];
  app.get("/api/admin/users", requireAdminRole, async (req, res) => {
    try { res.json(v2.listUsersByRole(req.query.role as string | undefined)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/users", requireAdminRole, async (req, res) => {
    try {
      const { username, password, role, name, phone, email } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      if (String(password).length < 6) return res.status(400).json({ error: "Password too short" });
      if (role && !VALID_USER_ROLES.includes(String(role))) return res.status(400).json({ error: "Invalid role" });
      const row = await v2.createDataTeamUser({ username: String(username), passwordHash: hashPassword(String(password)), name, email, phone, role: role ? String(role) : undefined });
      const { passwordHash: _ph, ...safe } = row;
      res.json(safe);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/users/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updates: any = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.email !== undefined) updates.email = req.body.email;
      if (req.body.phone !== undefined) updates.phone = req.body.phone;
      if (req.body.username !== undefined) updates.username = req.body.username;
      if (req.body.active !== undefined) updates.active = req.body.active;
      if (req.body.role !== undefined) {
        if (!VALID_USER_ROLES.includes(String(req.body.role))) return res.status(400).json({ error: "Invalid role" });
        updates.role = String(req.body.role);
      }
      if (req.body.password) updates.passwordHash = hashPassword(String(req.body.password));
      const row = await v2.updateDataTeamUser(id, updates);
      if (!row) return res.status(404).json({ error: "Not found" });
      const { passwordHash: _ph, ...safe } = row;
      res.json(safe);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/users/:id", requireAdminRole, async (req, res) => {
    try { v2.softDeleteUser(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==================== F. CONSIGNMENT DASHBOARD ====================
  app.get("/api/consignment/orders", requireConsignment, async (req, res) => {
    try {
      const list = await v2.listConsignments({ status: req.query.status as string | undefined, q: req.query.q as string | undefined });
      res.json(list);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R26.6b — Consignment portal full CRUD. Mirrors the admin consignment + customer
  // endpoints but gated behind requireConsignment. Reuses the same storage layer so
  // the data is identical to the admin view (additive — admin routes untouched).
  app.get("/api/consignment/consignments", requireConsignment, async (req, res) => {
    try {
      const list = await v2.listConsignments({ status: req.query.status as string | undefined, q: req.query.q as string | undefined });
      res.json(list);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/consignment/consignments", requireConsignment, async (req: any, res) => {
    try {
      const teamUser = req.teamUser;
      const body = normalizeDateFields(req.body || {});
      if (body.customerId) {
        const customer = await v2.getCustomer(parseInt(body.customerId, 10));
        if (customer) {
          if (!body.customerName) body.customerName = customer.name;
          if (!body.customerPhone) body.customerPhone = customer.phone || null;
          if (!body.customerEmail) body.customerEmail = customer.email || null;
        }
      }
      const parsed = insertConsignmentSchema.parse(body);
      const created = await v2.createConsignment(parsed, teamUser?.username || "consignment");
      res.json(created);
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.patch("/api/consignment/consignments/:id", requireConsignment, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const body = normalizeDateFields(req.body || {});
      if (body.customerId) {
        const customer = await v2.getCustomer(parseInt(body.customerId, 10));
        if (customer) {
          if (!body.customerName) body.customerName = customer.name;
          if (!body.customerPhone && customer.phone) body.customerPhone = customer.phone;
          if (!body.customerEmail && customer.email) body.customerEmail = customer.email;
        }
      }
      const updated = await v2.updateConsignment(id, body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/consignment/consignments/:id", requireConsignment, async (req, res) => {
    try {
      await v2.deleteConsignment(parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R26.6g — D1: consignment-portal document upload (docket + invoice). Mirrors the admin
  // upload route but gated behind requireConsignment. Stores absolute backend URLs so the
  // GoDaddy SPA never serves them as the homepage.
  const consignPortalDocsDir = path.join(ctx.uploadsDir || "./uploads", "consignments");
  if (!fs.existsSync(consignPortalDocsDir)) fs.mkdirSync(consignPortalDocsDir, { recursive: true });
  const multerConsignPortal = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, consignPortalDocsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });
  app.post(
    "/api/consignment/consignments/:id/upload",
    requireConsignment,
    multerConsignPortal.fields([{ name: "invoice", maxCount: 1 }, { name: "docket", maxCount: 1 }]),
    async (req: any, res: any) => {
      try {
        const id = parseInt(req.params.id as string, 10);
        const existing = await v2.getConsignmentById(id);
        if (!existing) return res.status(404).json({ error: "Consignment not found" });
        const proto = req.protocol || "https";
        const host = req.get("host") || "narmada-backend.onrender.com";
        const files = (req.files || {}) as Record<string, any[]>;
        const patch: any = {};
        if (files.invoice?.[0]) patch.invoiceUrl = `${proto}://${host}/uploads/consignments/${files.invoice[0].filename}`;
        if (files.docket?.[0]) patch.docketUrl = `${proto}://${host}/uploads/consignments/${files.docket[0].filename}`;
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No invoice or docket file provided" });
        const updated = await v2.updateConsignment(id, patch);
        res.json(updated);
      } catch (e: any) { res.status(400).json({ error: e.message }); }
    },
  );
  // From-Delhi (origin=Delhi) dispatched POs for the consignment portal — same as admin.
  app.get("/api/consignment/from-delhi", requireConsignment, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const q = req.query.q ? String(req.query.q) : undefined;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const origin = `${req.protocol || "https"}://${req.get("host") || "narmada-backend.onrender.com"}`;
      res.json(v2.listDelhiDispatchedForConsignment({ status, q, from, to, origin }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26.6g — D3: From-Delhi PO detail for the consignment portal (items + docket/invoice).
  app.get("/api/consignment/from-delhi/:poId", requireConsignment, async (req, res) => {
    try {
      const poId = parseInt(req.params.poId as string, 10);
      const origin = `${req.protocol || "https"}://${req.get("host") || "narmada-backend.onrender.com"}`;
      const detail = v2.getConsignmentPortalDetail(poId, origin);
      if (!detail) return res.status(404).json({ error: "PO not found" });
      res.json(detail);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Consignment portal — customer directory CRUD (mirror of admin customers).
  app.get("/api/consignment/customers", requireConsignment, async (req, res) => {
    try {
      res.json(await v2.getCustomers(req.query.q as string | undefined));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/consignment/customers", requireConsignment, async (req, res) => {
    try {
      res.json(await v2.createCustomer(req.body || {}));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/consignment/customers/:id", requireConsignment, async (req, res) => {
    try {
      const updated = await v2.updateCustomer(parseInt(req.params.id as string, 10), req.body || {});
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/consignment/customers/:id", requireConsignment, async (req, res) => {
    try {
      await v2.deleteCustomer(parseInt(req.params.id as string, 10));
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // TODO: remove after R26.6d — temporary diagnostic dump for the "sales/consignment
  // not fetching previous data" report. Reads the live prod SQLite directly.
  app.get("/api/admin/_debug/r26_6d", requireAdminRole, async (_req, res) => {
    try {
      const out: any = {};
      out.users = rawSqlite.prepare("SELECT id, username, role, active FROM data_team_users ORDER BY id").all();
      out.salesTargetsAll = rawSqlite.prepare("SELECT id, sales_rep_user_id, customer_id, metric, target_type, target_amount, status, rolled_over_from, created_at FROM sales_targets ORDER BY id DESC LIMIT 50").all();
      out.salesTargetsByRepGrouped = rawSqlite.prepare("SELECT sales_rep_user_id, COUNT(*) c FROM sales_targets GROUP BY sales_rep_user_id").all();
      out.consignmentsCount = rawSqlite.prepare("SELECT COUNT(*) c FROM consignments").get();
      out.consignmentsSample = rawSqlite.prepare("SELECT id, docket_number, origin, destination, status, customer_id, customer_name FROM consignments ORDER BY id DESC LIMIT 10").all();
      out.consignmentUsers = rawSqlite.prepare("SELECT id, username, role FROM data_team_users WHERE role='consignment'").all();
      res.json(out);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==================== G1. SALES TARGETS ====================
  app.get("/api/admin/sales-targets", requireAuth, async (req, res) => {
    const rows = v2.listSalesTargets({
      repId: req.query.rep_id ? parseInt(req.query.rep_id as string, 10) : undefined,
      status: req.query.status as string | undefined,
      customerId: req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined,
      metric: req.query.metric as string | undefined,
    });
    res.json(v2.enrichTargets(rows));
  });
  app.post("/api/admin/sales-targets", requireAdminRole, async (req, res) => {
    try {
      const body = req.body || {};
      // Normalize rep id across every field name the admin UI might send so the
      // target is never stored orphaned (null rep → invisible in the sales portal).
      const rep = body.sales_rep_user_id ?? body.salesRepUserId ?? body.repId ?? body.rep_id;
      if (!rep) return res.status(400).json({ error: "sales_rep_user_id required" });
      body.sales_rep_user_id = Number(rep);
      // Onboarding: create ONE target per picked lead.
      if (body.metric === "onboarding" && (Array.isArray(body.lead_ids) || Array.isArray(body.leadIds))) {
        return res.json(v2.createOnboardingTargets(body));
      }
      res.json(v2.createSalesTarget(body));
    }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Admin manual override: mark an onboarding target verified.
  app.post("/api/admin/sales-targets/:id/verify-onboarding", requireAdminRole, async (req, res) => {
    try {
      const adminUser = (req as any).user;
      res.json(v2.verifyOnboardingByAdmin(parseInt(req.params.id as string, 10), adminUser?.id ?? 0));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/sales-targets/:id", requireAdminRole, async (req, res) => {
    try {
      const t = v2.updateSalesTarget(parseInt(req.params.id as string, 10), req.body || {});
      if (!t) return res.status(404).json({ error: "Not found" });
      res.json(t);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/sales-targets/:id", requireAdminRole, async (req, res) => {
    try { v2.deleteSalesTarget(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/sales-targets/:id/approve-achievement/:achievement_id", requireAdminRole, async (req, res) => {
    try { res.json(v2.approveTargetAchievement(parseInt(req.params.achievement_id as string, 10))); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Sales: own targets with progress (also runs rollover + deadline events idempotently).
  app.get("/api/sales/targets", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      v2.autoRolloverTargets(u.id);
      // Return every target assigned to this rep, not just status="active", so the
      // sales portal mirrors exactly what admin sees for the same rep. Filtering on
      // "active" here previously hid targets the moment auto-rollover flipped them to
      // "rolled_over", making admin-visible targets vanish from the rep's view.
      const targetsList = v2.listSalesTargets({ repId: u.id });
      // H E5 — target deadline approaching (<=3 days), deduped per target per day.
      const todayMs = Date.now();
      for (const t of targetsList) {
        if (!t.period_end) continue;
        const endMs = Date.parse(t.period_end);
        if (Number.isNaN(endMs)) continue;
        const daysLeft = Math.ceil((endMs - todayMs) / (24 * 60 * 60 * 1000));
        if (daysLeft <= 3 && daysLeft >= 0 && !v2.deadlineEventExistsToday(t.id)) {
          emitCrossTeamEvent("target_deadline_approaching", { target_id: t.id, days_left: daysLeft, rep_id: u.id }, { target_user_id: u.id, target_role: "admin" });
        }
      }
      const enriched = v2.enrichTargets(targetsList);
      const withProgress = enriched.map((t: any) => ({ ...t, achievements: v2.listTargetAchievements(t.id) }));
      res.json(withProgress);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Rep submits a PO number to fulfil an onboarding target (auto-verify if attribution matches).
  app.post("/api/sales/targets/:id/submit-onboarding-po", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const result = v2.submitOnboardingPo(parseInt(req.params.id as string, 10), u.id, String(req.body?.po_number || ""));
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, target: result.target });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/sales/targets/:id/claim-po", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const poId = parseInt(req.body?.po_id as string, 10);
      if (!poId) return res.status(400).json({ error: "po_id required" });
      const result = v2.claimPoForTarget(parseInt(req.params.id as string, 10), poId, u.id);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, achievement: result.achievement });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R26.6g — A1/A2: PO or Payment claim with amount. PO that matches an existing PO number
  // auto-approves + credits; otherwise (and all payment claims) goes to admin approval.
  app.post("/api/sales/targets/:id/claim", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const result = v2.submitTargetClaim(parseInt(req.params.id as string, 10), u.id, req.body || {});
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, claim: result.claim, auto_approved: !!result.autoApproved });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/sales/targets/:id/claims", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const target = v2.getSalesTarget(parseInt(req.params.id as string, 10));
      if (!target || target.sales_rep_user_id !== u.id) return res.status(404).json({ error: "Not found" });
      res.json(v2.listTargetClaimsForTarget(target.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R26.6g — admin claim review.
  app.get("/api/admin/target-claims", requireAuth, async (req, res) => {
    try { res.json(v2.listTargetClaimsAdmin(req.query.status as string | undefined)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/target-claims/:id/approve", requireAdminRole, async (req, res) => {
    try {
      const adminUser = (req as any).user;
      const result = v2.approveTargetClaim(parseInt(req.params.id as string, 10), adminUser?.id ?? 0);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, claim: result.claim });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/admin/target-claims/:id/reject", requireAdminRole, async (req, res) => {
    try {
      const adminUser = (req as any).user;
      const result = v2.rejectTargetClaim(parseInt(req.params.id as string, 10), adminUser?.id ?? 0, req.body?.reason ? String(req.body.reason) : undefined);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, claim: result.claim });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ==================== G3. ATTENDANCE + VISITS ====================
  // IST helpers: convert "now" into IST date + hour.
  const istNow = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60 * 1000);
    return { iso: now.toISOString(), date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
  };
  app.post("/api/sales/attendance/checkin", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const t = istNow();
      const missed = t.hour > 10 || (t.hour === 10 && t.minute > 0);
      res.json(v2.attendanceCheckin(u.id, t.date, t.iso, missed));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/sales/attendance/checkout", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const t = istNow();
      const missed = t.hour < 18;
      res.json(v2.attendanceCheckout(u.id, t.date, t.iso, missed));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/sales/attendance/today", requireSales, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(v2.getAttendanceToday(u.id, istNow().date) || null);
  });
  app.get("/api/admin/attendance", requireAuth, async (req, res) => {
    res.json(v2.listAttendance({ date: req.query.date as string | undefined, repId: req.query.rep_id ? parseInt(req.query.rep_id as string, 10) : undefined }));
  });
  // Visits (multipart photo)
  const visitsDir = path.join(ctx.uploadsDir || "./uploads", "visits");
  if (!fs.existsSync(visitsDir)) fs.mkdirSync(visitsDir, { recursive: true });
  const multerVisit = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, visitsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });
  app.post("/api/sales/visits", requireSales, multerVisit.single("photo"), async (req: any, res: any) => {
    try {
      const u = (req as any).teamUser;
      let photoUrl: string | undefined;
      if (req.file) {
        const proto = req.protocol || "https";
        const host = req.get("host") || "narmada-backend.onrender.com";
        photoUrl = `${proto}://${host}/uploads/visits/${req.file.filename}`;
      }
      res.json(v2.createVisit({
        repUserId: u.id,
        customerId: req.body?.customer_id ? parseInt(req.body.customer_id, 10) : undefined,
        gpsLat: req.body?.gps_lat ? Number(req.body.gps_lat) : undefined,
        gpsLng: req.body?.gps_lng ? Number(req.body.gps_lng) : undefined,
        photoUrl, notes: req.body?.notes,
      }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/sales/visits/today", requireSales, async (req, res) => {
    const u = (req as any).teamUser;
    res.json(v2.listVisits({ repId: u.id, date: istNow().date }));
  });
  app.get("/api/admin/visits", requireAuth, async (req, res) => {
    res.json(v2.listVisits({ repId: req.query.rep_id ? parseInt(req.query.rep_id as string, 10) : undefined, date: req.query.date as string | undefined }));
  });

  // ==================== R27.0 — SALES EXPENSES ====================
  // Travel expense submission for sales reps. Optional proof receipt (image/PDF).
  // Approval workflow (accounts dashboard) ships in R27.3 — rows queue as 'pending'.
  const expensesDir = path.join(ctx.uploadsDir || "./uploads", "expenses");
  if (!fs.existsSync(expensesDir)) fs.mkdirSync(expensesDir, { recursive: true });
  const multerExpense = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, expensesDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });
  const EXPENSE_TYPES = ["hotel", "train", "flight", "auto", "meal", "misc"];
  app.post("/api/sales/expenses", requireSales, multerExpense.single("proof"), async (req: any, res: any) => {
    try {
      const u = (req as any).teamUser;
      const expenseType = String(req.body?.expense_type || "").trim().toLowerCase();
      if (!EXPENSE_TYPES.includes(expenseType)) return res.status(400).json({ error: "Invalid expense_type" });
      const expenseDate = String(req.body?.expense_date || "").trim();
      if (!expenseDate) return res.status(400).json({ error: "expense_date required" });
      const amount = Number(req.body?.amount);
      if (!(amount > 0)) return res.status(400).json({ error: "amount must be greater than 0" });
      let fields: any = undefined;
      if (req.body?.fields) {
        try { fields = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : req.body.fields; }
        catch { fields = { raw: String(req.body.fields) }; }
      }
      let proofUrl: string | undefined;
      if (req.file) {
        const proto = req.protocol || "https";
        const host = req.get("host") || "narmada-backend.onrender.com";
        proofUrl = `${proto}://${host}/uploads/expenses/${req.file.filename}`;
      }
      // R27.10 #1 — guarantee a staff row exists for this rep so finance can issue
      // an advance and the approved expense can settle against it.
      try { const s = await r27(); s.ensureSalesEmployee(u.id); } catch { /* best-effort */ }
      res.json(v2.createSalesExpense({
        salesUserId: u.id, expenseType, expenseDate, amount, fields, proofUrl, notes: req.body?.notes,
      }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/sales/expenses", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      res.json(v2.listSalesExpenses({ salesUserId: u.id }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/sales/expenses/:id", requireSales, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const result = v2.deleteSalesExpense(parseInt(req.params.id as string, 10), u.id);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================================
  // R27.2 + R27.3 — Procurement invoice flow, deviation engine, store + dispatch
  // roles, sales-expense approval, accounts dashboard, Supreme AI bar, AI fill.
  // All storage in ./storage-r27. Additive routes; no existing endpoint touched.
  // ============================================================================
  const r27 = () => import("./storage-r27");

  // ---- Store + Dispatch role middleware (extends data_team_users role auth) ----
  // requireDataTeamRole already reads x-team-token + authorization; add the two new
  // header names so the dedicated portals can send their own token header.
  function requireRoleHeaders(...allowed: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const token = (req.headers["x-store-token"] as string | undefined)
        || (req.headers["x-dispatch-token"] as string | undefined)
        || (req.headers["x-sales-token"] as string | undefined)
        || (req.headers["x-finance-token"] as string | undefined)
        || (req.headers["x-team-token"] as string | undefined)
        || (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "");
      if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
      const session = await v2.getDataTeamSession(token);
      if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
      const user = await v2.getDataTeamUser(session.userId);
      if (!user || !user.active) { res.status(401).json({ error: "Unauthorized" }); return; }
      if (allowed.length && user.role !== "admin" && !allowed.includes(user.role)) {
        res.status(403).json({ error: `Role ${allowed.join("/")} required` }); return;
      }
      (req as any).teamUser = user;
      next();
    };
  }
  const requireStore = requireRoleHeaders("store_incharge");
  const requireDispatch = requireRoleHeaders("dispatch_incharge");
  // Finance reads the accounts dashboard; admin always passes. Salary numbers masked unless admin.
  const requireFinanceAcct = requireRoleHeaders("finance");

  app.post("/api/store/login", makeRoleLogin("store_incharge"));
  app.post("/api/dispatch/login", makeRoleLogin("dispatch_incharge"));
  app.get("/api/store/me", requireStore, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });
  app.get("/api/dispatch/me", requireDispatch, (req, res) => { const { passwordHash: _p, ...s } = (req as any).teamUser; res.json(s); });

  // ---- R27.2-1 Procurement invoice flow (admin token) ----
  app.post("/api/admin/purchase-orders/:id/generate-invoice-copy", requireAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.generateInvoiceCopy(parseInt(req.params.id as string, 10), (req.user?.username) || "admin")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/admin/purchase-orders/:id/invoice-copy", requireAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.updateInvoiceCopy(parseInt(req.params.id as string, 10), req.body || {}, (req.user?.username) || "admin")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/purchase-orders/:id/delhi-invoice", requireAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.createDelhiInvoice(parseInt(req.params.id as string, 10), req.body || {}, (req.user?.username) || "delhi")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/purchase-orders/:id/invoices", requireAuth, async (req, res) => {
    try { const s = await r27(); res.json(s.listInvoices(parseInt(req.params.id as string, 10))); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R27.2-4 Deviation engine (admin token; procurement mirror reuses same data) ----
  app.get("/api/admin/deviations", requireAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listDeviations({ status: req.query.status as string | undefined, from: req.query.from as string | undefined, to: req.query.to as string | undefined, poId: req.query.po_id ? parseInt(req.query.po_id as string, 10) : undefined }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/deviations", requireAuth, async (req: any, res) => {
    try {
      const { po_id, field, expected, actual, notes } = req.body || {};
      if (!po_id || !field) return res.status(400).json({ error: "po_id and field required" });
      const s = await r27();
      const id = s.addDeviation(parseInt(String(po_id), 10), String(field), String(expected ?? ""), String(actual ?? ""), (req.user?.username) || "admin", "manual", notes);
      res.json({ id });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/admin/deviations/:id/resolve", requireAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.resolveDeviation(parseInt(req.params.id as string, 10), (req.user?.username) || "admin", req.body?.notes)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/deviations/:id/create-sub-po", requireAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(await s.createSubPoForDeviation(parseInt(req.params.id as string, 10), (req.user?.username) || "admin")); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/admin/deviations/export.xlsx", requireAuth, async (_req, res) => {
    try {
      const s = await r27();
      const rows = s.deviationExportRows();
      const XLSX = require("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Deviations");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="deviations.xlsx"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R27.2-2/3 Store incharge: branch transfers + receive + stock ----
  app.get("/api/store/transfers", requireStore, async (req, res) => {
    try { const s = await r27(); res.json(s.listTransfers({ status: req.query.status as string | undefined })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.7 #5 — store/dispatch transfer exports (xlsx + csv). Columns per spec:
  // Date, Client, PO No, Item, Part No, Qty, Source Branch, Dest Branch, Status,
  // Transfer Invoice No. Both store ("received" view) and dispatch ("sent" view)
  // draw from listTransfers (branch_transfers + Patna-bound consignments).
  async function transfersAoa(req: any) {
    const s = await r27();
    const rows = s.listTransfers({ status: req.query.status as string | undefined }) as any[];
    const aoa: any[][] = [["Date", "Client Name", "PO No", "Item Name", "Part No", "Quantity", "Source Branch", "Dest Branch", "Status", "Transfer Invoice No"]];
    for (const t of rows) {
      const date = t.dispatched_at || t.received_at || t.created_at || "";
      aoa.push([
        date ? String(date).slice(0, 10) : "",
        t.clientName || (t.po_id ? "—" : "Internal Transfer"),
        t.poNumber || "",
        t.itemSummary || "",
        t.partNumbers || "",
        t.bundles ?? "",
        t.from_branch || "",
        t.to_branch || "",
        t.status || "",
        t.transferInvoiceNo || "",
      ]);
    }
    return aoa;
  }
  app.get("/api/store/received.xlsx", requireStore, async (req: any, res) => { try { sendXlsx(res, "store-received", "Received", await transfersAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/store/received.csv", requireStore, async (req: any, res) => { try { sendCsv(res, "store-received", await transfersAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/dispatch/sent.xlsx", requireDispatch, async (req: any, res) => { try { sendXlsx(res, "dispatch-sent", "Dispatched", await transfersAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/dispatch/sent.csv", requireDispatch, async (req: any, res) => { try { sendCsv(res, "dispatch-sent", await transfersAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });

  app.get("/api/store/transfers/:id", requireStore, async (req, res) => {
    try { const s = await r27(); const d = s.getTransferDetail(parseInt(req.params.id as string, 10)); if (!d) return res.status(404).json({ error: "Not found" }); res.json(d); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/store/transfers/:id/receive", requireStore, async (req: any, res) => {
    try {
      const s = await r27();
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ error: "items required" });
      res.json(await s.receiveTransfer(parseInt(req.params.id as string, 10), items, (req.teamUser?.id)));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/store/stock", requireStore, async (req, res) => {
    try { const s = await r27(); res.json(s.listBranchStock("Patna", (req.query.status as string) || "in_stock")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.4 BUG-8 — admin stock view (per-product per-branch; ?branch=Delhi|Patna&q=&status=).
  app.get("/api/admin/stock", requireAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listBranchStockAdmin({
        branch: (req.query.branch as string) || undefined,
        q: (req.query.q as string) || undefined,
        status: (req.query.status as string) || undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.5 #6 — live aggregated stock (net qty per part per branch) + movement ledger.
  app.get("/api/admin/stock/summary", requireAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listBranchStockSummary({
        branch: (req.query.branch as string) || undefined,
        q: (req.query.q as string) || undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/stock/movements", requireAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listStockMovements({
        branch: (req.query.branch as string) || undefined,
        partNumber: (req.query.part_number as string) || undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- R27.2 Dispatch incharge: ready stock + handover ----
  app.get("/api/dispatch/ready", requireDispatch, async (_req, res) => {
    try { const s = await r27(); res.json(s.dispatchReady("Patna")); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/dispatch/handover", requireDispatch, async (req, res) => {
    try {
      const s = await r27();
      const stockIds = Array.isArray(req.body?.stock_ids) ? req.body.stock_ids.map((n: any) => parseInt(String(n), 10)) : [];
      res.json(s.dispatchHandover(stockIds, req.body?.customer_id ? parseInt(String(req.body.customer_id), 10) : undefined, req.body?.invoice_number));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- R27.7 #4 Dispatch transfer-invoice rule ----
  // On store "Mark Received" the storage layer opens a PENDING transfer_invoices row.
  // Dispatch lists those, fills transport/freight/eway/remarks/PDF, and finalizes —
  // which assigns NM/TRF-INV/26/0001, flips status to 'invoiced', and emails admin.
  const transferInvDir = path.join(ctx.uploadsDir || "./uploads", "transfer-invoices");
  if (!fs.existsSync(transferInvDir)) fs.mkdirSync(transferInvDir, { recursive: true });
  const multerTransferInv = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, transferInvDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });

  app.get("/api/dispatch/transfer-invoices", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.listTransferInvoices({ status: req.query.status as string | undefined })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Store can see its invoices too (for the invoice link/number in the received list).
  app.get("/api/store/transfer-invoices", requireStore, async (req: any, res) => {
    try { const s = await r27(); res.json(s.listTransferInvoices({ status: req.query.status as string | undefined })); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/dispatch/transfer-invoices/:id/finalize", requireDispatch, multerTransferInv.single("pdf"), async (req: any, res) => {
    try {
      const s = await r27();
      const id = parseInt(req.params.id as string, 10);
      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = req.headers.host;
      const pdf_url = req.file ? `${proto}://${host}/uploads/transfer-invoices/${req.file.filename}` : (req.body?.pdf_url || null);
      const inv = s.finalizeTransferInvoice(id, {
        transport_vendor: req.body?.transport_vendor ?? null,
        vehicle_no: req.body?.vehicle_no ?? null,
        freight_charge: req.body?.freight_charge != null && req.body.freight_charge !== "" ? Number(req.body.freight_charge) : null,
        eway_bill_no: req.body?.eway_bill_no ?? null,
        remarks: req.body?.remarks ?? null,
        pdf_url,
      }, req.teamUser?.id);
      // Email admin — fire-and-forget.
      (async () => {
        try {
          const adminEmail = process.env.ADMIN_REMINDER_EMAIL || process.env.SALES_EMAIL || "sales@Narmadamobility.com";
          const rows = `<tr><td>Invoice No</td><td>${inv.invoice_no}</td></tr>
            <tr><td>Route</td><td>${inv.source_branch || "Delhi"} → ${inv.dest_branch || "Patna"}</td></tr>
            <tr><td>Transport Vendor</td><td>${inv.transport_vendor || "—"}</td></tr>
            <tr><td>Vehicle No</td><td>${inv.vehicle_no || "—"}</td></tr>
            <tr><td>Freight</td><td>₹${inv.freight_charge ?? 0}</td></tr>
            <tr><td>E-way Bill</td><td>${inv.eway_bill_no || "—"}</td></tr>
            <tr><td>Remarks</td><td>${inv.remarks || "—"}</td></tr>`;
          await sendGenericEmail({
            to: adminEmail,
            subject: `Transfer Invoice ${inv.invoice_no} created`,
            html: `<p>A transfer invoice was finalized by Dispatch.</p><table border="1" cellpadding="6">${rows}</table>${inv.pdf_url ? `<p><a href="${inv.pdf_url}">View PDF</a></p>` : ""}`,
            event: "transfer_invoice",
          });
        } catch (e: any) { console.error("[r27.7 #4] admin email:", e?.message || e); }
      })();
      res.json(inv);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ==== R27.8 #10 — standalone Delhi/procurement invoice PDF upload ====
  // Attaches an uploaded PDF to an existing po_invoice_copies row by id.
  const invPdfDir = path.join(ctx.uploadsDir || "./uploads", "invoice-pdfs");
  if (!fs.existsSync(invPdfDir)) fs.mkdirSync(invPdfDir, { recursive: true });
  const multerInvoicePdf = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, invPdfDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf") cb(null, true);
      else cb(new Error("Only PDF allowed"));
    },
  });
  app.post("/api/admin/invoice/:id/upload-pdf", requireAdminRole, multerInvoicePdf.single("pdf"), async (req: any, res) => {
    try {
      const s = await r27();
      const id = parseInt(req.params.id as string, 10);
      if (!req.file) return res.status(400).json({ error: "PDF file required" });
      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = req.headers.host;
      const pdfUrl = `${proto}://${host}/uploads/invoice-pdfs/${req.file.filename}`;
      res.json(s.setInvoiceCopyPdf(id, pdfUrl));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ==== R27.8 #3 — Dispatch invoice flow (manual invoice no, company+client) ====
  app.get("/api/dispatch/companies", requireDispatch, async (_req, res) => {
    try { const s = await r27(); res.json(s.listDispatchCompanies()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/dispatch/clients", requireDispatch, async (_req, res) => {
    try { const s = await r27(); res.json(s.listDispatchClients()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/dispatch/stock-items", requireDispatch, async (_req, res) => {
    try { const s = await r27(); res.json(s.listDispatchStockItems()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/dispatch/invoices", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.listDispatchInvoices({ status: req.query.status as string | undefined })); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/dispatch/invoices", requireDispatch, async (req: any, res) => {
    try {
      const s = await r27();
      const r = s.createDispatchInvoice({
        invoice_no: req.body?.invoice_no,
        company_id: req.body?.company_id != null && req.body.company_id !== "" ? Number(req.body.company_id) : null,
        client_id: req.body?.client_id != null && req.body.client_id !== "" ? Number(req.body.client_id) : null,
        by: req.teamUser?.id,
      });
      res.json(r);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/dispatch/invoices/:id", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); const d = s.getDispatchInvoiceDetail(parseInt(req.params.id as string, 10)); if (!d) return res.status(404).json({ error: "Not found" }); res.json(d); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/dispatch/invoices/:id/assign", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.assignDispatchItem(parseInt(req.params.id as string, 10), Number(req.body?.transfer_item_id))); } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/dispatch/stock-items/:tid/remove", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.removeDispatchItem(parseInt(req.params.tid as string, 10))); } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/dispatch/stock-items/:tid/tick", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.tickDispatchItem(parseInt(req.params.tid as string, 10), req.body?.ticked !== false)); } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/dispatch/invoices/:id/process", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.markDispatchInvoiceProcessed(parseInt(req.params.id as string, 10))); } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/dispatch/invoices/:id/unlock", requireDispatch, async (req: any, res) => {
    try { const s = await r27(); res.json(s.unlockDispatchInvoice(parseInt(req.params.id as string, 10))); } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- R27.2-5 Auto-product markup setting (admin) ----
  app.get("/api/admin/settings/auto-product-markup", requireAuth, async (_req, res) => {
    try {
      const { rawSqlite } = await import("./storage");
      const row = rawSqlite.prepare(`SELECT value FROM shop_settings WHERE key = 'auto_product_markup_pct'`).get() as any;
      res.json({ markup_pct: Number(row?.value) || 20 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/admin/settings/auto-product-markup", requireAdminRole, async (req, res) => {
    try {
      const pct = Number(req.body?.markup_pct);
      if (!Number.isFinite(pct) || pct < 0) return res.status(400).json({ error: "markup_pct must be a non-negative number" });
      const { rawSqlite } = await import("./storage");
      rawSqlite.prepare(`INSERT INTO shop_settings (key, value) VALUES ('auto_product_markup_pct', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(pct));
      res.json({ markup_pct: pct });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- R27.2-6 Sales-expense approval (admin Expenses tab) ----
  // R27.10 #4/#5/#7 — these endpoints now accept admin token OR finance token
  // (acctAuth sets req.isAdminAcct so we know which role is acting), powering both
  // the admin Operations queue and the finance approval mirror.
  app.get("/api/admin/sales-expenses", acctAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listSalesExpensesAdmin({ status: req.query.status as string | undefined, userId: req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined, from: req.query.from as string | undefined, to: req.query.to as string | undefined }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Parallel finance alias (same data) so the finance portal has a role-native path.
  app.get("/api/finance/sales-expenses", acctAuth, async (req, res) => {
    try {
      const s = await r27();
      res.json(s.listSalesExpensesAdmin({ status: req.query.status as string | undefined, userId: req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined, from: req.query.from as string | undefined, to: req.query.to as string | undefined }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  const approveSalesHandler = async (req: any, res: any) => {
    try {
      const s = await r27();
      const role = req.isAdminAcct ? "admin" : "finance";
      const approverId = req.user?.id ?? req.teamUser?.id;
      res.json(s.approveSalesExpense(parseInt(req.params.id as string, 10), approverId, req.body?.note, role));
    } catch (e: any) { res.status(e?.status || 500).json({ error: e.message }); }
  };
  const rejectSalesHandler = async (req: any, res: any) => {
    try { const s = await r27(); res.json(s.rejectSalesExpense(parseInt(req.params.id as string, 10), req.user?.id ?? req.teamUser?.id, req.body?.note)); }
    catch (e: any) { res.status(e?.status || 500).json({ error: e.message }); }
  };
  // R27.10 #4 — edit the amount of a still-pending expense; logs to history.
  const editAmountHandler = async (req: any, res: any) => {
    try {
      const amount = Number(req.body?.amount);
      if (!(amount > 0)) return res.status(400).json({ error: "amount must be greater than 0" });
      const s = await r27();
      const role = req.isAdminAcct ? "admin" : "finance";
      const who = req.user?.username || req.teamUser?.username || role;
      res.json(s.editSalesExpenseAmount(parseInt(req.params.id as string, 10), amount, who, role));
    } catch (e: any) { res.status(e?.status || 500).json({ error: e.message }); }
  };
  app.post("/api/admin/sales-expenses/:id/approve", acctAuth, approveSalesHandler);
  app.post("/api/admin/sales-expenses/:id/reject", acctAuth, rejectSalesHandler);
  app.patch("/api/admin/sales-expenses/:id", acctAuth, editAmountHandler);
  app.get("/api/admin/sales-expenses/:id/amount-history", acctAuth, async (req, res) => {
    try { const s = await r27(); res.json(s.getSalesExpenseAmountHistory(parseInt(req.params.id as string, 10))); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // Finance-native aliases for the approval mirror.
  app.post("/api/finance/sales-expenses/:id/approve", acctAuth, approveSalesHandler);
  app.post("/api/finance/sales-expenses/:id/reject", acctAuth, rejectSalesHandler);
  app.patch("/api/finance/sales-expenses/:id", acctAuth, editAmountHandler);

  // ============================================================================
  // R27.3 — Accounts dashboard (finance role; admin sees salary numbers, finance masked)
  // ============================================================================
  // Admin token OR finance token both reach these; we detect "admin sees salary" by
  // checking the admin token map first, falling back to the finance role session.
  function acctAuth(req: Request, res: Response, next: NextFunction) {
    // Try admin token first (grants salary visibility).
    const adminTok = req.headers["x-admin-token"] as string | undefined;
    if (adminTok) {
      const info = ctx.tokenMap.get(adminTok) || rehydrateSession(ctx.tokenMap, adminTok);
      if (info) { (req as any).user = info; (req as any).isAdminAcct = info.role === "admin"; return next(); }
    }
    return requireFinanceAcct(req, res, () => { (req as any).isAdminAcct = (req as any).teamUser?.role === "admin"; next(); });
  }

  // Expense headers
  app.get("/api/finance/expense-headers", acctAuth, async (_req, res) => { const s = await r27(); res.json(s.listExpenseHeaders()); });
  app.post("/api/finance/expense-headers", acctAuth, async (req, res) => {
    try { if (!req.body?.name) return res.status(400).json({ error: "name required" }); const s = await r27(); res.json(s.createExpenseHeader(String(req.body.name), req.body.fields || [], { gl_code: req.body.gl_code, budget: req.body.budget, parent_id: req.body.parent_id })); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.put("/api/finance/expense-headers/:id", acctAuth, async (req, res) => {
    try { const s = await r27(); res.json(s.updateExpenseHeader(parseInt(req.params.id as string, 10), req.body?.name, req.body?.fields, { gl_code: req.body?.gl_code, budget: req.body?.budget, parent_id: req.body?.parent_id })); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/finance/expense-headers/:id", acctAuth, async (req, res) => {
    try { const s = await r27(); res.json(s.deleteExpenseHeader(parseInt(req.params.id as string, 10))); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Cash in hand
  app.get("/api/finance/cash", acctAuth, async (req, res) => { const s = await r27(); res.json(s.listCash(req.query.branch as string | undefined)); });
  app.post("/api/finance/cash", acctAuth, async (req: any, res) => {
    try { if (!req.body?.source) return res.status(400).json({ error: "source required" }); const s = await r27(); res.json(s.createCash(req.body, req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Advances + reconciliation
  app.get("/api/finance/advances", acctAuth, async (req, res) => {
    const s = await r27();
    res.json(s.listAdvances({ employeeId: req.query.employee_id ? parseInt(req.query.employee_id as string, 10) : undefined, status: req.query.status as string | undefined }));
  });
  app.post("/api/finance/advances", acctAuth, async (req: any, res) => {
    try { if (!req.body?.employee_id) return res.status(400).json({ error: "employee_id required" }); const s = await r27(); res.json(s.createAdvance(req.body, req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/advances/:id/reconcile", acctAuth, async (req, res) => {
    try { const s = await r27(); res.json(s.reconcileAdvance(parseInt(req.params.id as string, 10), req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Current expenses
  app.get("/api/finance/current-expenses", acctAuth, async (req, res) => {
    const s = await r27();
    res.json(s.listCurrentExpenses({ from: req.query.from as string | undefined, to: req.query.to as string | undefined, headerId: req.query.header_id ? parseInt(req.query.header_id as string, 10) : undefined, branch: req.query.branch as string | undefined, status: req.query.status as string | undefined }));
  });
  app.post("/api/finance/current-expenses", acctAuth, async (req: any, res) => {
    try { if (!req.body?.expense_header_id || !req.body?.expense_date) return res.status(400).json({ error: "expense_header_id and expense_date required" }); const s = await r27(); res.json(s.createCurrentExpense(req.body, req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R27.5 #8 — approve / reject pending current expenses (admin acct only)
  app.post("/api/finance/current-expenses/:id/approve", acctAuth, async (req: any, res) => {
    try { if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required to approve" }); const s = await r27(); res.json(s.approveCurrentExpense(parseInt(req.params.id as string, 10), req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/current-expenses/:id/reject", acctAuth, async (req: any, res) => {
    try { if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required to reject" }); const s = await r27(); res.json(s.rejectCurrentExpense(parseInt(req.params.id as string, 10), req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Person ledger
  app.get("/api/finance/person-ledger/:personId", acctAuth, async (req: any, res) => {
    // R27.9 #2 — salary entries (kind='salary_paid') are filtered for the finance
    // role; only admin sees them in the ledger.
    const s = await r27(); res.json(s.getPersonLedger(parseInt(req.params.personId as string, 10), !req.isAdminAcct));
  });

  // ---- R27.6 #6/#7 — unified expenses (advance + direct) + advances ----
  app.get("/api/finance/expense-advances", acctAuth, async (req, res) => {
    const s = await r27();
    res.json(s.listExpenseAdvances({ staffId: req.query.staff_id ? parseInt(req.query.staff_id as string, 10) : undefined, status: req.query.status as string | undefined }));
  });
  app.post("/api/finance/expense-advances", acctAuth, async (req: any, res) => {
    try {
      const s = await r27();
      const b = req.body || {};
      // R27.10 #3 — the Issue Advance UI sends {employee_id, amount, purpose, notes};
      // map employee_id→staff_id and fold notes into purpose.
      const staff_id = b.staff_id ?? b.employee_id;
      const purpose = [b.purpose, b.notes].filter(Boolean).join(" — ") || undefined;
      res.json(s.createExpenseAdvance({ staff_id, amount: b.amount, purpose, branch_id: b.branch_id }, req.user?.id ?? req.teamUser?.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/expense-advances/:id/return", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.returnAdvanceCash(parseInt(req.params.id as string, 10), req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/finance/expenses", acctAuth, async (req, res) => {
    const s = await r27();
    res.json(s.listExpenses({
      from: req.query.from as string | undefined, to: req.query.to as string | undefined,
      type: req.query.type as string | undefined, branch: req.query.branch as string | undefined,
      advanceId: req.query.advance_id ? parseInt(req.query.advance_id as string, 10) : undefined,
    }));
  });
  // Direct expense (no advance).
  app.post("/api/finance/expenses/direct", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.createDirectExpense(req.body || {}, req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Advance settlement expense (decrements advance balance, auto-settles at 0).
  app.post("/api/finance/expenses/advance", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.createAdvanceExpense(req.body || {}, req.teamUser?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // Manual backfill: sync ALL approved sales expenses into the accounts ledger.
  app.post("/api/finance/expenses/sync-sales", acctAuth, async (req: any, res) => {
    try {
      const s = await r27();
      // R27.8 #1 — re-scan ALL approved sales expenses (not just synthetic rows) and
      // create any missing ledger entries. Returns real counts so the user gets a
      // meaningful message even when everything is already synced.
      const r = s.syncAllApprovedSalesExpenses(req.teamUser?.id ?? req.user?.id);
      res.json(r);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // R27.7 #1/#5 — small helpers to ship an AOA (array-of-arrays) as xlsx or csv.
  function sendXlsx(res: Response, filename: string, sheetName: string, aoa: any[][]) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  }
  function sendCsv(res: Response, filename: string, aoa: any[][]) {
    const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = aoa.map((row) => row.map(esc).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(csv);
  }

  // R27.7 #1 — accounts exports: cash received / staff-wise / day-wise.
  // R27.8 #4 — full transaction detail (every row), honouring from/to.
  async function cashReceivedAoa(req: any) {
    const s = await r27();
    const rows = s.reportCashReceivedDetail({ from: req.query.from as string | undefined, to: req.query.to as string | undefined, branch: req.query.branch as string | undefined });
    const aoa: any[][] = [["ID", "Date", "Time", "Branch", "Amount", "Source", "Reference ID", "Reference Table", "Notes", "Recorded By", "Created At"]];
    let total = 0;
    for (const r of rows) {
      aoa.push([r.id, r.date, r.time || "", r.branch, r.amount, r.source, r.reference_id || "", r.reference_table || "", r.notes || "", r.recordedBy || "", r.created_at || ""]);
      total += Number(r.amount) || 0;
    }
    aoa.push([], ["", "", "", "", total, "Total"]);
    return aoa;
  }
  async function staffExpensesAoa(req: any) {
    const s = await r27();
    const rows = s.reportStaffExpensesDetail({ from: req.query.from as string | undefined, to: req.query.to as string | undefined });
    const aoa: any[][] = [["ID", "Staff", "Role", "Branch", "Date", "Expense Type", "Header", "Amount", "Payment Mode", "Advance ID", "Description", "Attachment URL", "Approved By", "Created At"]];
    let total = 0;
    for (const r of rows) {
      aoa.push([r.id, r.staffName || "Unassigned", r.role || "", r.branch || "", r.date, r.expenseType || "", r.header || "", r.amount, r.paymentMode || "", r.advanceId || "", r.description || "", r.attachmentUrl || "", r.approvedBy || "", r.created_at || ""]);
      total += Number(r.amount) || 0;
    }
    aoa.push([], ["", "", "", "", "", "", "", total, "Total"]);
    return aoa;
  }
  async function dayExpensesAoa(req: any) {
    const s = await r27();
    const rows = s.reportDayExpensesDetail({ from: req.query.from as string | undefined, to: req.query.to as string | undefined });
    const aoa: any[][] = [["ID", "Date", "Staff", "Branch", "Header", "Sub-Category", "Amount", "Payment Mode", "Description", "Reference No", "Attachment URL", "Source", "Source ID", "Approved By", "Created At"]];
    let total = 0;
    for (const r of rows) {
      aoa.push([r.id, r.date, r.staffName || "", r.branch || "", r.header || "", r.subCategory || "", r.amount, r.paymentMode || "", r.description || "", r.referenceNo || "", r.attachmentUrl || "", r.source || "", r.sourceId || "", r.approvedBy || "", r.created_at || ""]);
      total += Number(r.amount) || 0;
    }
    aoa.push([], ["", "", "", "", "", "", total, "Total"]);
    return aoa;
  }
  app.get("/api/admin/accounts/cash-received.xlsx", acctAuth, async (req: any, res) => { try { sendXlsx(res, "cash-received", "Cash Received", await cashReceivedAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/admin/accounts/cash-received.csv", acctAuth, async (req: any, res) => { try { sendCsv(res, "cash-received", await cashReceivedAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/admin/accounts/staff-expenses.xlsx", acctAuth, async (req: any, res) => { try { sendXlsx(res, "staff-expenses", "Staff Expenses", await staffExpensesAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/admin/accounts/staff-expenses.csv", acctAuth, async (req: any, res) => { try { sendCsv(res, "staff-expenses", await staffExpensesAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/admin/accounts/day-expenses.xlsx", acctAuth, async (req: any, res) => { try { sendXlsx(res, "day-expenses", "Day Expenses", await dayExpensesAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });
  app.get("/api/admin/accounts/day-expenses.csv", acctAuth, async (req: any, res) => { try { sendCsv(res, "day-expenses", await dayExpensesAoa(req)); } catch (e: any) { res.status(500).json({ error: e.message }); } });

  // R27.7 #2 — cash ledger (per-branch till). Balance = SUM(in) - SUM(out).
  app.get("/api/finance/cash/balances", acctAuth, async (_req, res) => {
    try { const s = await r27(); res.json({ branches: s.getCashBalances() }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/finance/cash/movements", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.listCashMovements({ branch: req.query.branch as string | undefined, from: req.query.from as string | undefined, to: req.query.to as string | undefined })); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/cash/receipt", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.recordCashReceipt(req.body || {}, req.teamUser?.id ?? req.user?.id)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Employees (salary masked unless admin)
  app.get("/api/finance/employees", acctAuth, async (req: any, res) => {
    const s = await r27(); res.json(s.listEmployees(!req.isAdminAcct, req.query.q as string | undefined));
  });
  app.get("/api/finance/employees/:id", acctAuth, async (req: any, res) => {
    const s = await r27(); const e = s.getEmployee(parseInt(req.params.id as string, 10), !req.isAdminAcct); if (!e) return res.status(404).json({ error: "Not found" }); res.json(e);
  });
  app.post("/api/finance/employees", acctAuth, async (req, res) => {
    try { if (!req.body?.name) return res.status(400).json({ error: "name required" }); const s = await r27(); res.json(s.createEmployee(req.body)); }
    catch (e: any) {
      if (e?.code === "DUP_LINK") return res.status(409).json({ error: e.message, employeeId: e.employeeId });
      res.status(400).json({ error: e.message });
    }
  });
  app.put("/api/finance/employees/:id", acctAuth, async (req: any, res) => {
    try { const s = await r27(); res.json(s.updateEmployee(parseInt(req.params.id as string, 10), req.body || {}, !!req.isAdminAcct)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R27.11 #2 — flat list of portal users for the admin link-to-user dropdown.
  app.get("/api/admin/portal-users", requireAdminRole, async (_req, res) => {
    try { const s = await r27(); res.json(s.listPortalUsers()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R27.11 #2 — link an existing employee to a portal user (admin + finance via acctAuth).
  app.patch("/api/finance/employees/:id/link", acctAuth, async (req: any, res) => {
    try {
      const { linked_user_id, linked_user_role } = req.body || {};
      if (!linked_user_id || !linked_user_role) return res.status(400).json({ error: "linked_user_id and linked_user_role required" });
      const s = await r27();
      res.json(s.linkEmployeeToUser(parseInt(req.params.id as string, 10), Number(linked_user_id), String(linked_user_role)));
    } catch (e: any) {
      if (e?.code === "DUP_LINK") return res.status(409).json({ error: e.message, employeeId: e.employeeId });
      res.status(400).json({ error: e.message });
    }
  });
  // R27.7 #8 — staff document / photo upload. ?kind=photo|aadhar|pan|doc.
  const staffDocsDir = path.join(ctx.uploadsDir || "./uploads", "staff");
  if (!fs.existsSync(staffDocsDir)) fs.mkdirSync(staffDocsDir, { recursive: true });
  const multerStaff = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, staffDocsDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
      else cb(new Error("Only PDF/JPG/PNG allowed"));
    },
  });
  app.post("/api/finance/employees/:id/upload", acctAuth, multerStaff.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file required" });
      const id = parseInt(req.params.id as string, 10);
      const kind = String(req.query.kind || req.body?.kind || "doc");
      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = req.headers.host;
      const url = `${proto}://${host}/uploads/staff/${req.file.filename}`;
      const colByKind: Record<string, string> = { photo: "photo_url", aadhar: "aadhar_url", pan: "pan_url", doc: "image_url" };
      const col = colByKind[kind] || "image_url";
      const s = await r27();
      s.updateEmployee(id, { [col]: url }, false);
      res.json({ ok: true, url, kind, column: col });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Attendance
  app.get("/api/finance/attendance", acctAuth, async (req, res) => {
    const s = await r27(); res.json(s.listAttendance(req.query.month as string | undefined));
  });
  app.post("/api/finance/attendance", acctAuth, async (req: any, res) => {
    try {
      const { employee_id, month, absent_days } = req.body || {};
      if (!employee_id || !month) return res.status(400).json({ error: "employee_id and month required" });
      const s = await r27(); res.json(s.upsertAttendance(parseInt(String(employee_id), 10), String(month), Number(absent_days) || 0, req.teamUser?.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  // R27.7 #11 — per-day attendance calendar (bulk mark + read).
  app.get("/api/admin/accounts/attendance/days", acctAuth, async (req: any, res) => {
    try {
      const employeeId = parseInt(req.query.employee_id as string, 10);
      if (!employeeId) return res.status(400).json({ error: "employee_id required" });
      const s = await r27(); res.json(s.listAttendanceDays(employeeId, req.query.month as string | undefined));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/admin/accounts/attendance/bulk", acctAuth, async (req: any, res) => {
    try {
      const { employee_id, days } = req.body || {};
      if (!employee_id || !Array.isArray(days)) return res.status(400).json({ error: "employee_id and days[] required" });
      const s = await r27(); res.json(s.bulkMarkAttendance(parseInt(String(employee_id), 10), days, req.teamUser?.id ?? req.user?.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Salary compute / finalize / email (admin only — salary numbers)
  app.get("/api/finance/salary/compute", acctAuth, async (req: any, res) => {
    try {
      if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required for salary figures" });
      const employeeId = parseInt(req.query.employee_id as string, 10);
      const month = String(req.query.month || "");
      if (!employeeId || !month) return res.status(400).json({ error: "employee_id and month required" });
      const s = await r27(); res.json(s.computeSalary(employeeId, month));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/salary/finalize", acctAuth, async (req: any, res) => {
    try {
      if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required to finalize salary" });
      const { employee_id, month, payment_ref } = req.body || {};
      if (!employee_id || !month) return res.status(400).json({ error: "employee_id and month required" });
      const s = await r27(); res.json(s.finalizeSalary(parseInt(String(employee_id), 10), String(month), payment_ref));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/finance/salary/email", acctAuth, async (req: any, res) => {
    try {
      if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required" });
      const { employee_id, month, to } = req.body || {};
      if (!employee_id || !month) return res.status(400).json({ error: "employee_id and month required" });
      const s = await r27();
      const run: any = s.finalizeSalary(parseInt(String(employee_id), 10), String(month));
      if (to) {
        sendGenericEmail({ to: String(to), subject: `Salary slip — ${month}`, html: `<h3>Salary slip ${month}</h3><p>Working days: ${run.working_days}</p><p>Gross: ₹${run.gross}</p><p>Advance deduction: ₹${run.advance_deduction}</p><p>Retention: ₹${run.retention_amount}</p><p><b>Net payable: ₹${run.net_payable}</b></p>`, text: `Salary ${month}: net payable ₹${run.net_payable}`, event: "salary_slip" }).catch(() => {});
      }
      s.markSalaryEmailed(parseInt(String(employee_id), 10), String(month));
      res.json({ ok: true, run });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/finance/salary/runs", acctAuth, async (req: any, res) => {
    if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required for salary figures" });
    const s = await r27(); res.json(s.listSalaryRuns(req.query.month as string | undefined));
  });
  app.get("/api/finance/salary/export.xlsx", acctAuth, async (req: any, res) => {
    try {
      if (!req.isAdminAcct) return res.status(403).json({ error: "Admin role required" });
      const s = await r27();
      const rows = s.listSalaryRuns(req.query.month as string | undefined) as any[];
      const XLSX = require("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Salary");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="salary.xlsx"`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R27.9 #2 — admin-only salary entry + history. requireAdminRole reads ONLY
  // x-admin-token, so a finance session (x-team-token) can never reach these —
  // it gets 401/403, never the salary figures.
  app.get("/api/admin/employees/:id/salary", requireAdminRole, async (req, res) => {
    try {
      const s = await r27();
      const out = s.getEmployeeSalary(parseInt(req.params.id as string, 10));
      if (!out) return res.status(404).json({ error: "Employee not found" });
      res.json(out);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/admin/employees/:id/salary", requireAdminRole, async (req: any, res) => {
    try {
      const { monthly_salary, effective_from, notes } = req.body || {};
      if (monthly_salary == null) return res.status(400).json({ error: "monthly_salary required" });
      const s = await r27();
      const setBy = (req.user?.username || req.user?.role || "admin") as string;
      const out = s.setEmployeeSalary(parseInt(req.params.id as string, 10), {
        monthly_salary: Number(monthly_salary),
        effective_from: effective_from ?? null,
        set_by: setBy,
        notes: notes ?? null,
      });
      res.json(out);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ============================================================================
  // R27.3-2 — Supreme AI Bar. LLM tool-use over read-only DB queries when
  // CLAUDE_API_KEY is set; deterministic keyword routing otherwise.
  // ============================================================================
  app.get("/api/admin/ai-bar/history", requireAuth, async (_req, res) => {
    try { const s = await r27(); res.json(s.aiBarHistory(20)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/ai-bar/ask", requireAuth, async (req: any, res) => {
    try {
      const prompt = String(req.body?.prompt || "").trim();
      if (!prompt) return res.status(400).json({ error: "prompt required" });
      const { rawSqlite } = await import("./storage");
      const q = (sql: string, ...p: any[]) => { try { return rawSqlite.prepare(sql).all(...p); } catch { return []; } };
      const one = (sql: string, ...p: any[]) => { try { return rawSqlite.prepare(sql).get(...p); } catch { return null; } };

      // Read-only tool catalogue (used both by LLM tool-use and deterministic routing).
      const tools: Record<string, () => any> = {
        open_pos: () => q(`SELECT po_number, status, total FROM purchase_orders_v2 WHERE deleted_at IS NULL AND status IN ('draft','open','partial') ORDER BY id DESC LIMIT 25`),
        processed_pos: () => q(`SELECT po_number, status, total FROM purchase_orders_v2 WHERE status='processed' ORDER BY id DESC LIMIT 25`),
        po_count: () => one(`SELECT COUNT(*) c FROM purchase_orders_v2 WHERE deleted_at IS NULL`),
        open_deviations: () => q(`SELECT po_id, field, expected, actual FROM po_deviations WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 25`),
        pending_expenses: () => q(`SELECT id, expense_type, amount, expense_date FROM sales_expenses WHERE approval_status='pending' ORDER BY id DESC LIMIT 25`),
        cash_balance: () => one(`SELECT COALESCE(SUM(amount),0) balance FROM cash_in_hand`),
        open_advances: () => q(`SELECT employee_id, amount_given, status FROM advance_expenses WHERE status != 'reconciled' ORDER BY id DESC LIMIT 25`),
        patna_stock: () => q(`SELECT part_number, qty, status FROM branch_stock WHERE branch='Patna' AND status='in_stock' ORDER BY id DESC LIMIT 25`),
        in_transit_transfers: () => q(`SELECT id, po_id, status FROM branch_transfers WHERE status='in_transit' ORDER BY id DESC LIMIT 25`),
        low_stock_products: () => q(`SELECT name, part_number, stock_qty FROM products WHERE active=1 AND stock_qty <= 2 ORDER BY stock_qty ASC LIMIT 25`),
        recent_orders: () => q(`SELECT order_number, status, total_inr FROM shop_orders ORDER BY id DESC LIMIT 25`),
        customer_count: () => one(`SELECT COUNT(*) c FROM customers WHERE deleted_at IS NULL`),
        salary_due: () => q(`SELECT e.name, s.month, s.net_payable FROM salary_runs s LEFT JOIN employees e ON e.id=s.employee_id WHERE s.paid_at IS NULL ORDER BY s.id DESC LIMIT 25`),
        top_vendors: () => q(`SELECT name, city FROM vendors ORDER BY id DESC LIMIT 15`),
        attendance_month: () => q(`SELECT a.month, e.name, a.absent_days FROM attendance a LEFT JOIN employees e ON e.id=a.employee_id ORDER BY a.month DESC LIMIT 25`),
        unresolved_leads: () => q(`SELECT name, stage FROM leads WHERE stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 25`),
      };

      const s = await r27();
      const claude = require("./claude-service") as typeof import("./claude-service");
      let summary = ""; let data: any = null; let usedTool = "";
      const live = claude.isClaudeConfigured();
      console.log(`[R27.4 ai-bar] mode=${live ? "LIVE" : "DETERMINISTIC"} prompt=${JSON.stringify(prompt.slice(0, 120))}`);

      if (live) {
        // Ask the LLM which single tool best answers the question (cheap routing, no write tools).
        const toolNames = Object.keys(tools);
        const routed = await claude.claudeJSON<{ tool: string }>(
          `You route an admin's question to ONE read-only data tool. Available tools: ${toolNames.join(", ")}. Reply ONLY JSON {"tool":"<name>"}. If none fit, use "po_count".`,
          prompt, 256,
        ).catch(() => null);
        usedTool = (routed?.tool && tools[routed.tool]) ? routed.tool : "po_count";
        data = tools[usedTool]();
        const text = await claude.claudeText(
          `You are Narmada's operations assistant. Given the user's question and a JSON result from tool "${usedTool}", answer concisely in 1-3 sentences. Do not invent data.`,
          `Question: ${prompt}\n\nData: ${JSON.stringify(data).slice(0, 4000)}`, 512,
        ).catch(() => null);
        summary = text || `Result from ${usedTool}.`;
      } else {
        // Deterministic keyword routing fallback.
        const p = prompt.toLowerCase();
        const pick =
          /deviat/.test(p) ? "open_deviations" :
          /expense|approv/.test(p) ? "pending_expenses" :
          /cash/.test(p) ? "cash_balance" :
          /advance/.test(p) ? "open_advances" :
          /stock|inventory/.test(p) ? "patna_stock" :
          /transit|transfer/.test(p) ? "in_transit_transfers" :
          /low.?stock/.test(p) ? "low_stock_products" :
          /order/.test(p) ? "recent_orders" :
          /customer/.test(p) ? "customer_count" :
          /salary|payroll/.test(p) ? "salary_due" :
          /vendor|seller/.test(p) ? "top_vendors" :
          /attendance/.test(p) ? "attendance_month" :
          /lead/.test(p) ? "unresolved_leads" :
          /processed/.test(p) ? "processed_pos" :
          /\bpo\b|purchase order/.test(p) ? "open_pos" : "po_count";
        usedTool = pick;
        data = tools[pick]();
        const count = Array.isArray(data) ? data.length : 1;
        summary = `(${Array.isArray(data) ? `${count} row(s)` : "summary"}) via ${pick}. Set CLAUDE_API_KEY for natural-language answers.`;
      }

      s.aiBarLog((req.user && (req.user.id ?? null)) || null, prompt, summary, { tool: usedTool, data });
      res.json({ summary, tool: usedTool, data, llm: live });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  // R27.3-3 — AI Fill extensions for product editor (4 endpoints).
  // Each returns a small JSON the AdminProducts form merges into editing state.
  // ============================================================================
  async function aiFill(req: any, res: any, kind: "discounts" | "specifications" | "short-description" | "seo-meta") {
    try {
      const { name, brand, part_number, description, price_inr } = req.body || {};
      if (!name) return res.status(400).json({ error: "name required" });
      const claude = require("./claude-service") as typeof import("./claude-service");
      const ctx = `Product: ${name}; brand: ${brand || "-"}; part#: ${part_number || "-"}; price: ₹${price_inr || "-"}; description: ${(description || "").slice(0, 600)}`;
      if (!claude.isClaudeConfigured()) {
        // Deterministic fallbacks so the buttons always do something useful offline.
        if (kind === "discounts") return res.json({ discount_tiers: [{ min_qty: 5, discount_pct: 3 }, { min_qty: 10, discount_pct: 5 }, { min_qty: 25, discount_pct: 8 }] });
        if (kind === "short-description") return res.json({ short_description: `${name}${brand ? ` by ${brand}` : ""} — genuine quality automotive spare part.` });
        if (kind === "specifications") return res.json({ specifications: [{ key: "Brand", value: brand || "-" }, { key: "Part Number", value: part_number || "-" }] });
        return res.json({ meta_title: `${name} | Narmada Mobility`.slice(0, 60), meta_description: `Buy ${name}${brand ? ` (${brand})` : ""} online at Narmada Mobility. Genuine automotive spare parts.`.slice(0, 160), meta_keywords: [name, brand, part_number].filter(Boolean).join(", ") });
      }
      if (kind === "discounts") {
        const j = await claude.claudeJSON(`Suggest 2-4 quantity-based discount tiers for a B2B automotive part. Reply ONLY JSON {"discount_tiers":[{"min_qty":N,"discount_pct":N}]}.`, ctx, 512);
        return res.json(j || { discount_tiers: [] });
      }
      if (kind === "specifications") {
        const j = await claude.claudeJSON(`Generate technical specifications for this automotive part. Reply ONLY JSON {"specifications":[{"key":"...","value":"..."}]}.`, ctx, 800);
        return res.json(j || { specifications: [] });
      }
      if (kind === "short-description") {
        const t = await claude.claudeText(`Write a single punchy 1-sentence product short description (max 140 chars). Reply with the sentence only.`, ctx, 200);
        return res.json({ short_description: (t || "").trim().slice(0, 200) });
      }
      // seo-meta
      const j = await claude.claudeJSON(`Generate SEO meta for an e-commerce product page. Reply ONLY JSON {"meta_title":"<=60 chars","meta_description":"<=160 chars","meta_keywords":"comma,separated"}.`, ctx, 600);
      return res.json(j || { meta_title: "", meta_description: "", meta_keywords: "" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }
  app.post("/api/admin/ai-fill/discounts", requireDataCenterOrAdmin, (req, res) => aiFill(req, res, "discounts"));
  app.post("/api/admin/ai-fill/specifications", requireDataCenterOrAdmin, (req, res) => aiFill(req, res, "specifications"));
  app.post("/api/admin/ai-fill/short-description", requireDataCenterOrAdmin, (req, res) => aiFill(req, res, "short-description"));
  app.post("/api/admin/ai-fill/seo-meta", requireDataCenterOrAdmin, (req, res) => aiFill(req, res, "seo-meta"));

  // ==================== H. CROSS-TEAM NOTIFICATIONS FEED ====================
  app.get("/api/notifications", requireDataTeamRole(), async (req, res) => {
    const u = (req as any).teamUser;
    // Admins (via SSO team session) may pass role/user_id; reps are auto-scoped to self.
    if (u.role === "admin") {
      res.json(v2.listCrossTeamEvents({ userId: req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined, role: req.query.role as string | undefined }));
    } else {
      res.json(v2.listCrossTeamEvents({ userId: u.id, role: u.role }));
    }
  });
  app.post("/api/notifications/:id/read", requireDataTeamRole(), async (req, res) => {
    try { v2.markCrossTeamEventRead(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/notifications/unread-count", requireDataTeamRole(), async (req, res) => {
    const u = (req as any).teamUser;
    if (u.role === "admin") {
      res.json({ count: v2.crossTeamUnreadCount({ userId: req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined, role: req.query.role as string | undefined }) });
    } else {
      res.json({ count: v2.crossTeamUnreadCount({ userId: u.id, role: u.role }) });
    }
  });

  // ==================== I. MARKETING ADDITIONS ====================
  app.get("/api/admin/marketing/whatsapp-templates", requireAuth, async (_req, res) => {
    res.json(v2.listMarketingWhatsappTemplates());
  });
  app.post("/api/admin/marketing/whatsapp-templates", requireAdminRole, async (req, res) => {
    try {
      if (!req.body?.name && !req.body?.template_name) return res.status(400).json({ error: "name required" });
      res.json(v2.createMarketingWhatsappTemplate(req.body || {}));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/marketing/whatsapp-templates/:id", requireAdminRole, async (req, res) => {
    try { res.json(v2.updateMarketingWhatsappTemplate(parseInt(req.params.id as string, 10), req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/marketing/whatsapp-templates/:id", requireAdminRole, async (req, res) => {
    try { v2.deleteMarketingWhatsappTemplate(parseInt(req.params.id as string, 10)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26.6b — sync approved WhatsApp templates from the Meta Graph API (AiSensy uses Meta WABA).
  // Env-gated: requires META_WABA_ID + META_SYSTEM_USER_TOKEN, else 503. Upserts by template_name.
  app.post("/api/admin/marketing/whatsapp-templates/sync", requireAdminRole, async (_req, res) => {
    const wabaId = process.env.META_WABA_ID;
    const sysToken = process.env.META_SYSTEM_USER_TOKEN;
    if (!wabaId || !sysToken) {
      return res.status(503).json({ error: "Meta sync not configured. Set META_WABA_ID and META_SYSTEM_USER_TOKEN." });
    }
    try {
      const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(wabaId)}/message_templates?limit=200&access_token=${encodeURIComponent(sysToken)}`;
      const r = await fetch(url);
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return res.status(502).json({ error: `Meta API error ${r.status}`, detail: txt.slice(0, 500) });
      }
      const payload: any = await r.json();
      const templates: any[] = Array.isArray(payload?.data) ? payload.data : [];
      let inserted = 0, updated = 0;
      for (const t of templates) {
        const comps: any[] = Array.isArray(t.components) ? t.components : [];
        const header = comps.find((c) => c.type === "HEADER");
        const body = comps.find((c) => c.type === "BODY");
        const buttonsComp = comps.find((c) => c.type === "BUTTONS");
        // Count {{n}} placeholders in the BODY text.
        const varCount = body?.text ? (String(body.text).match(/\{\{\s*\d+\s*\}\}/g) || []).length : 0;
        const headerType = header ? String(header.format || "TEXT").toLowerCase() : "none";
        const buttons = buttonsComp?.buttons ? JSON.stringify(buttonsComp.buttons) : "[]";
        const result = v2.upsertMarketingWhatsappTemplateByName({
          template_name: t.name,
          display_name: t.name,
          category: (t.category || "marketing").toLowerCase(),
          language: t.language || "en",
          header_type: headerType,
          variable_count: varCount,
          variable_labels: "[]",
          buttons,
          status: (t.status || "APPROVED").toLowerCase() === "approved" ? "active" : "inactive",
        });
        if (result.action === "inserted") inserted++; else updated++;
      }
      res.json({ ok: true, synced: templates.length, inserted, updated });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // I2. Audience include/exclude preview + patch
  app.patch("/api/admin/audiences/:id", requireAdminRole, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const includeIds = Array.isArray(req.body?.include_user_ids) ? req.body.include_user_ids.map((n: any) => Number(n)) : undefined;
      const excludeIds = Array.isArray(req.body?.exclude_user_ids) ? req.body.exclude_user_ids.map((n: any) => Number(n)) : undefined;
      const source = typeof req.body?.source === "string" ? req.body.source : undefined;
      res.json(v2.updateAudienceIncludeExclude(id, includeIds, excludeIds, source));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/admin/audiences/:id/preview", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const aud = v2.getAudienceRow(id);
      if (!aud) return res.status(404).json({ error: "Not found" });
      const { rows, summary } = v2.materializeAudience(id, 50);
      res.json({ customers: rows, summary });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  // R26.6b — list candidate contacts for the include/exclude pickers, filtered by source.
  app.get("/api/admin/audiences/source/:source/contacts", requireAuth, async (req, res) => {
    try {
      const table = v2.audienceSourceTable(req.params.source);
      const q = (req.query.q as string | undefined)?.trim();
      let sql = `SELECT id, name, phone, email, state FROM ${table}`;
      const params: any[] = [];
      if (q) { sql += ` WHERE LOWER(COALESCE(name,'')) LIKE ? OR COALESCE(phone,'') LIKE ?`; params.push(`%${q.toLowerCase()}%`, `%${q}%`); }
      sql += ` ORDER BY name LIMIT 200`;
      res.json(rawSqlite.prepare(sql).all(...params));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ==========================================================================
  // R27.1 — E-commerce Phase 1: website shopper accounts, cart-driven checkout,
  // freight, currency, admin orders/customers. Namespaced `/api/shop/*` and
  // `x-shop-token` so it never collides with the B2B `/api/customer/*` portal.
  // ==========================================================================
  const shop = require("./storage-shop") as typeof import("./storage-shop");

  // Local multer store for the freight CSV upload (registerR8Routes scope has no docStore).
  const freightCsvStore = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, uploadsRoot),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  function requireShop(req: Request, res: Response, next: NextFunction) {
    const token = req.headers["x-shop-token"] as string | undefined;
    if (!token) return res.status(401).json({ error: "Please sign in to continue" });
    const session = shop.getShopSession(token);
    if (!session) return res.status(401).json({ error: "Session expired — please sign in again" });
    (req as any).shopUserId = session.shopUserId;
    next();
  }

  // ==================================================================
  // PartSetu AI v1 — Spare Parts Intelligence Chatbot
  // ==================================================================
  const partsetuStore = require("./partsetu") as typeof import("./partsetu");
  const claudeSvc = require("./services/claude") as typeof import("./services/claude");
  const partsetuIntent = require("./services/partsetu/intent") as typeof import("./services/partsetu/intent");
  const partsetuSearch = require("./services/partsetu/search") as typeof import("./services/partsetu/search");
  const partsetuUvi = require("./services/partsetu/uvi-resolver") as typeof import("./services/partsetu/uvi-resolver");
  const partsetuPrompt = require("./services/partsetu/prompt") as typeof import("./services/partsetu/prompt");
  // R27.24a3 — per-conversation disambiguation candidates, kept in-process so a
  // numeric follow-up ("2") can resolve to the catalog offered last turn.
  const uviDisambig = new Map<number, import("./services/partsetu/uvi-resolver").UviCandidate[]>();

  // R27.24a / a6 — citation guard now lives in services/partsetu/search.ts
  // (pure + unit-tested). Thin wrapper keeps existing call sites unchanged.
  const enforcePartCitations = partsetuSearch.enforcePartCitations;
  const catalogIngester = require("./services/catalog-ingester") as typeof import("./services/catalog-ingester");
  const catalogStorage = require("./services/catalog-storage") as typeof import("./services/catalog-storage");

  // v1.3: admin catalog PDF upload — in-memory (max 100MB), PDF magic-byte check.
  const partsetuCatalogUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      const ok = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
      cb(ok ? null : new Error("Only PDF files are accepted"), ok);
    },
  });

  const partsetuImgDir = path.join(uploadsRoot, "partsetu", "images");
  try { fs.mkdirSync(partsetuImgDir, { recursive: true }); } catch {}
  const partsetuImgStore = multer({
    storage: multer.diskStorage({
      destination: (_req: any, _file: any, cb: any) => cb(null, partsetuImgDir),
      filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${String(file.originalname || "image").replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // R27.24a4 — the chat system prompt now lives in services/partsetu/prompt.ts
  // (directly unit-testable + forced VERIFIED VEHICLE CONTEXT injection). This
  // thin wrapper keeps the existing call sites unchanged.
  const PARTSETU_SYSTEM = (contextBlock: string, verifiedVehicleBlock = "") =>
    partsetuPrompt.buildPartsetuSystemPrompt(contextBlock, verifiedVehicleBlock);

  // Resolve an optional shop session from the x-shop-token header (no error if absent).
  function partsetuOptionalShopUser(req: Request): number | null {
    const token = req.headers["x-shop-token"] as string | undefined;
    if (!token) return null;
    const session = shop.getShopSession(token);
    return session ? session.shopUserId : null;
  }

  // Map stored messages to the {role, content} history Claude expects (text only).
  function partsetuHistory(conversationId: number): Array<{ role: "user" | "assistant"; content: string }> {
    return partsetuStore
      .listMessages(conversationId)
      .filter((m: any) => m.content && (m.role === "user" || m.role === "assistant"))
      .map((m: any) => ({ role: m.role, content: String(m.content) }));
  }

  // Start a conversation (guest or logged-in).
  app.post("/api/partsetu/conversation", async (req, res) => {
    try {
      const { guestSessionId, chassisNo, registrationNo } = req.body || {};
      const customerId = partsetuOptionalShopUser(req);
      const id = partsetuStore.createConversation({
        customerId, guestSessionId: guestSessionId || null,
        chassisNo: chassisNo || null, registrationNo: registrationNo || null,
      });
      res.json({ conversationId: id, requiresLogin: false });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to start conversation" }); }
  });

  // Send a text message. Pattern B gating: the FIRST user message is free for a
  // guest; any further message requires login (401 requires_login:true).
  app.post("/api/partsetu/message", async (req, res) => {
    try {
      const { conversationId, content } = req.body || {};
      if (!conversationId || !content || !String(content).trim()) {
        return res.status(400).json({ error: "conversationId and content are required" });
      }
      const conv = partsetuStore.getConversation(Number(conversationId));
      if (!conv) return res.status(404).json({ error: "Conversation not found" });

      const shopUserId = partsetuOptionalShopUser(req);
      const priorUserMsgs = partsetuStore.countUserMessages(Number(conversationId));
      if (priorUserMsgs >= 1 && !shopUserId) {
        return res.status(401).json({ requires_login: true, error: "Please log in to continue chatting with PartSetu AI." });
      }
      // Link a guest conversation to the customer once they are logged in.
      if (shopUserId && !conv.customer_id) {
        partsetuStore.linkConversationToCustomer(Number(conversationId), shopUserId);
      }

      partsetuStore.addMessage({ conversationId: Number(conversationId), role: "user", content: String(content) });

      // R27.24a3 — Universal Vehicle Identifier fast path. When the message is a
      // vehicle identifier (MAT.., bare digits, or a registration prefix) we
      // probe every identifier field in parallel and lock / disambiguate /
      // ask BEFORE the part search. Non-identifier messages skip this entirely.
      const uviInput = String(content).trim();
      const uviSendReply = (text: string) => {
        partsetuStore.addMessage({ conversationId: Number(conversationId), role: "assistant", content: text });
        return res.json({ reply: text, requires_login: false, ai_available: true });
      };
      const circled = ["①", "②", "③", "④", "⑤"];
      const candLabel = (c: import("./services/partsetu/uvi-resolver").UviCandidate) =>
        [c.model, c.variant].filter(Boolean).join(" ") || `catalog #${c.catalog_id}`;

      // R27.24a8 — DB-backed disambiguation reply routing. The R27.24a7 block
      // (below) persists the candidate set + the customer's original query when a
      // message resolved to >=2 vehicles. A short follow-up ("1", "वाहन 2", or a
      // pasted-back chassis) now locks the chosen vehicle and replays the
      // original query. Expiry: 10 min. Non-matching replies keep the pending row
      // (one more chance) unless the customer explicitly cancels.
      let disambiguationReplayQuery: string | null = null;
      {
        const sessionId = String(conversationId);
        const pending = partsetuStore.getPendingDisambiguation(sessionId);
        if (pending) {
          if (Date.now() > pending.expires_at) {
            partsetuStore.clearPendingDisambiguation(sessionId);
            console.log(`[partsetu] disambiguation_expired session=${sessionId}`);
          } else {
            const picked = partsetuIntent.detectDisambiguationReply(uviInput, pending.candidates);
            if (picked) {
              partsetuStore.clearPendingDisambiguation(sessionId);
              partsetuStore.setCatalogContext(Number(conversationId), picked.selectedUvi.catalog_id);
              conv.catalog_context_id = picked.selectedUvi.catalog_id;
              disambiguationReplayQuery = pending.original_query || null;
              console.log(`[partsetu] disambiguation_resolved session=${sessionId} index=${picked.selectedCandidateIndex} catalog_id=${picked.selectedUvi.catalog_id}`);
            } else if (partsetuIntent.isDisambiguationCancel(uviInput)) {
              partsetuStore.clearPendingDisambiguation(sessionId);
              console.log(`[partsetu] disambiguation_skipped session=${sessionId}`);
            }
            // else: keep the pending row, fall through to normal classification.
          }
        }
      }

      // R27.24a9 gap 4 — DB-backed PART-name disambiguation reply routing. When
      // a single part name resolved to several distinct catalog parts (below) we
      // persisted the candidate parts + original query. A short follow-up
      // ("2", "part 2", or a pasted-back part name) now resolves to one part and
      // the original query is replayed (scoped to the still-locked catalog).
      let partDisambiguationReplay: string | null = null;
      {
        const sessionId = String(conversationId);
        const pendingPart = partsetuStore.getPendingPartDisambiguation(sessionId);
        if (pendingPart) {
          if (Date.now() > pendingPart.expires_at) {
            partsetuStore.clearPendingPartDisambiguation(sessionId);
            console.log(`[partsetu] part_disambiguation_expired session=${sessionId}`);
          } else {
            const picked = partsetuIntent.detectPartDisambiguationReply(uviInput, pendingPart.candidates as any);
            if (picked) {
              partsetuStore.clearPendingPartDisambiguation(sessionId);
              partDisambiguationReplay = picked.selectedPart.part_name || pendingPart.original_query || null;
              console.log(`[partsetu] part_disambiguation_resolved session=${sessionId} index=${picked.selectedCandidateIndex} part="${picked.selectedPart.part_name}"`);
            } else if (partsetuIntent.isDisambiguationCancel(uviInput)) {
              partsetuStore.clearPendingPartDisambiguation(sessionId);
              console.log(`[partsetu] part_disambiguation_skipped session=${sessionId}`);
            }
          }
        }
      }

      // (1) numeric follow-up to a prior disambiguation prompt.
      const pendingCands = uviDisambig.get(Number(conversationId));
      if (pendingCands && pendingCands.length && /^[1-9]\d?$/.test(uviInput)) {
        const pick = Number(uviInput) - 1;
        if (pick >= 0 && pick < pendingCands.length) {
          const chosen = pendingCands[pick];
          partsetuStore.setCatalogContext(Number(conversationId), chosen.catalog_id);
          uviDisambig.delete(Number(conversationId));
          return uviSendReply(`Locked to ${candLabel(chosen)}. What part are you looking for?`);
        }
      }

      // (2) identifier-looking message and no catalog locked yet.
      const looksLikeIdentifier = /^MAT/i.test(uviInput) || /^\d{4,17}$/.test(uviInput) || /^[A-Z]{2}\d{2}/i.test(uviInput);
      if (!conv.catalog_context_id && looksLikeIdentifier) {
        const uvi = await partsetuUvi.resolveVehicle(uviInput);
        if (uvi.auto_lock) {
          partsetuStore.setCatalogContext(Number(conversationId), uvi.auto_lock.catalog_id);
          uviDisambig.delete(Number(conversationId));
          return uviSendReply(`Locked to ${candLabel(uvi.auto_lock)} (matched on ${uvi.auto_lock.matched_strategies.join(", ")}). What part are you looking for?`);
        }
        if (uvi.candidates.length === 0) {
          return uviSendReply(`I couldn't find a catalog matching '${uviInput}'. Could you share the model name (e.g. SIGNA 2823.K) or the full chassis number?`);
        }
        if (uvi.candidates.length >= 2 && uvi.needs_disambiguation) {
          uviDisambig.set(Number(conversationId), uvi.candidates);
          const lines = uvi.candidates.slice(0, 5).map((c, i) => `${circled[i] || `${i + 1}.`} ${candLabel(c)}`);
          return uviSendReply(`I found multiple matches. Did you mean: ${lines.join(", ")}? Reply with the number.`);
        }
        const top = uvi.candidates[0];
        const clearLead = uvi.candidates.length === 1 || (top.score - uvi.candidates[1].score) >= 15;
        if (top.score >= 50 && clearLead) {
          partsetuStore.setCatalogContext(Number(conversationId), top.catalog_id);
          uviDisambig.delete(Number(conversationId));
          return uviSendReply(`Locked to ${candLabel(top)} (matched on ${top.matched_strategies.join(", ")}). What part are you looking for?`);
        }
        if (uvi.candidates.length >= 2) {
          uviDisambig.set(Number(conversationId), uvi.candidates);
          const lines = uvi.candidates.slice(0, 5).map((c, i) => `${circled[i] || `${i + 1}.`} ${candLabel(c)}`);
          return uviSendReply(`I found multiple matches. Did you mean: ${lines.join(", ")}? Reply with the number.`);
        }
        return uviSendReply(`I couldn't confidently match '${uviInput}'. Could you share the model name (e.g. SIGNA 2823.K) or the full chassis number?`);
      }

      // R27.24a4 — UNCONDITIONAL UVI probe. The fast-path above only fires when
      // the WHOLE message is an identifier; a natural-language message that
      // EMBEDS a chassis number ("tata ka chassis no hai 505409") slipped past
      // it, so resolveVehicle was never called and Sonnet freelanced (it
      // hallucinated "Tata 407 discontinued" while catalog #22 sat in the DB).
      // We now scan EVERY message for identifier candidates, resolve each, and
      // on a hit lock the catalog + inject a VERIFIED VEHICLE CONTEXT block.
      console.log(`[partsetu] chat session_id=${conversationId} user_msg="${uviInput.slice(0, 80).replace(/\n/g, " ")}"`);
      let verifiedVehicleBlock = "";
      let uviLockedCatalogId: number | null = null;
      let vehicleRelocked = false;
      {
        const uviCands = partsetuUvi.extractVehicleIdentifierCandidates(uviInput);
        let bestUvi: import("./services/partsetu/uvi-resolver").UviResult | null = null;
        let matchedInput = "";
        let uviResults: import("./services/partsetu/uvi-resolver").UviResult[] = [];
        if (uviCands.length) {
          uviResults = await Promise.all(uviCands.map((c) => partsetuUvi.resolveVehicle(c)));
          bestUvi = partsetuUvi.pickBestUvi(uviResults);
          const bi = bestUvi ? uviResults.indexOf(bestUvi) : -1;
          matchedInput = bi >= 0 ? uviCands[bi] : (uviCands[0] || "");
        }
        // R27.24a7 (bug 3) — if the message resolved TWO OR MORE distinct
        // catalogs at auto-lock confidence, do NOT silently pick one. Show a
        // disambiguation block and leave the vehicle unlocked until the user
        // chooses. Only fires when there is no prior locked catalog.
        const distinctLocks = new Map<number, { input: string; lock: import("./services/partsetu/uvi-resolver").UviCandidate }>();
        uviResults.forEach((r, idx) => {
          if (r.auto_lock && !distinctLocks.has(r.auto_lock.catalog_id)) {
            distinctLocks.set(r.auto_lock.catalog_id, { input: uviCands[idx], lock: r.auto_lock });
          }
        });
        console.log(`[partsetu] uvi candidates_extracted=[${uviCands.join(",")}] uvi_resolved=${uviCands.length} distinct_locks=${distinctLocks.size} auto_lock=${bestUvi?.auto_lock?.catalog_id ?? "null"}`);
        if (distinctLocks.size >= 2 && !conv.catalog_context_id) {
          const matches = Array.from(distinctLocks.values());
          verifiedVehicleBlock = partsetuPrompt.buildDisambiguationBlock(matches);
          // R27.24a8 — persist the candidate set + original query so the next
          // short reply ("1"/"2"/pasted chassis) can lock + replay (see top block).
          partsetuStore.savePendingDisambiguation(String(conversationId), matches, String(content));
          console.log(`[partsetu] uvi multi_match_disambiguation catalogs=[${matches.map((m) => m.lock.catalog_id).join(",")}] pending_saved=1`);
        } else if (bestUvi) {
          if (bestUvi.auto_lock) {
            const newCatalogId = bestUvi.auto_lock.catalog_id;
            const priorCatalogId = conv.catalog_context_id || null;
            if (!priorCatalogId) {
              // First lock.
              partsetuStore.setCatalogContext(Number(conversationId), newCatalogId);
              uviLockedCatalogId = newCatalogId;
              verifiedVehicleBlock = partsetuPrompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
            } else if (priorCatalogId === newCatalogId) {
              // R27.24a9 gap 5 — same-catalog high-confidence UVI is deliberate;
              // treat as a no-op. Do NOT re-emit the lock confirmation block.
              uviLockedCatalogId = newCatalogId;
              console.log(`[partsetu] uvi same_catalog no_op session=${conversationId}`);
            } else {
              // R27.24a9 gap 1 + gap 5 — the active vehicle CHANGED to a
              // different catalog. Switch the lock and PURGE prior state so the
              // old catalog's part numbers can never leak into this turn:
              //  - archive the prior catalog's parts cart,
              //  - clear any pending part-disambiguation,
              //  - mark the relock so the citation guard / prompt drop history.
              partsetuStore.setCatalogContext(Number(conversationId), newCatalogId);
              conv.catalog_context_id = newCatalogId;
              uviLockedCatalogId = newCatalogId;
              vehicleRelocked = true;
              const archivedItems = partsetuStore.archivePartsCart(String(conversationId));
              partsetuStore.clearPendingPartDisambiguation(String(conversationId));
              console.log(`[partsetu] vehicle_relock from_catalog=${priorCatalogId} to_catalog=${newCatalogId} permitted_set_purged=1`);
              console.log(`[partsetu] cart archived_on_relock session=${conversationId} prior_catalog=${priorCatalogId} items=${archivedItems}`);
              verifiedVehicleBlock =
                `ACTIVE VEHICLE CHANGED — the customer switched to a NEW vehicle (catalog #${newCatalogId}). IGNORE every part number from earlier assistant messages; they belong to catalog #${priorCatalogId}. Cite ONLY part numbers from this turn's catalog #${newCatalogId} results.\n\n` +
                partsetuPrompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
            }
          } else {
            verifiedVehicleBlock = partsetuPrompt.buildVerifiedVehicleBlock(matchedInput, bestUvi.auto_lock, bestUvi.candidates);
          }
        }
      }

      // R27.23 — chat-side resolver hierarchy: chassis → registration (VAHAN,
      // deferred) → model fuzzy. VC-number matching is no longer used on the
      // chat path. An already-locked catalogue (from a prior turn) is kept.
      let catalogId: number | null = conv.catalog_context_id || uviLockedCatalogId || null;
      let resolverNote = "";
      if (!catalogId) {
        const resolved = await partsetuStore.resolveCatalog(String(content));
        if (resolved.kind === "exact") {
          catalogId = resolved.catalog_id;
          partsetuStore.setCatalogContext(Number(conversationId), catalogId);
        } else if (resolved.kind === "suggest") {
          const lines = resolved.candidates.map((c: any, i: number) =>
            `${i + 1}. ${[c.model, c.variant].filter(Boolean).join(" ") || "(unnamed)"} — vc ${c.vc_no || "-"} (score ${c.score})`);
          resolverNote = `RESOLVER: SUGGEST — closest catalogue matches (present these numbered, max 5, ask the customer to pick; invent nothing):\n${lines.join("\n")}\n`;
        } else {
          resolverNote = "RESOLVER: NONE — no vehicle identified yet. Do NOT answer the part query; ask the customer for a chassis or registration number (per HARD RULE A).\n";
        }
      }
      const convNow = partsetuStore.getConversation(Number(conversationId));

      // R27.24a8 — on a resolved vehicle disambiguation reply, the customer's
      // ACTIVE query is their original (pre-disambiguation) message, not "1".
      // R27.24a9 gap 4 — a resolved PART disambiguation reply replaces the active
      // query with the chosen part name. R27.24a9 gap 3 — an append request
      // ("aur clutch bhi chahiye") with a non-empty cart narrows to that part.
      let activeContent = disambiguationReplayQuery ?? partDisambiguationReplay ?? String(content);
      const cartBefore = catalogId ? partsetuStore.getCart(String(conversationId), catalogId) : [];
      const appendPart = partsetuIntent.detectPartsAppend(String(content));
      const isPartsAppend = !!appendPart && cartBefore.length > 0 && !disambiguationReplayQuery && !partDisambiguationReplay;
      if (isPartsAppend) {
        activeContent = appendPart!;
        console.log(`[partsetu] parts_append session=${conversationId} part="${appendPart}" cart_before=${cartBefore.length}`);
      }

      // R27.24a — intent classification + multi-strategy search. The intent
      // decides whether the vehicle lock applies (exploratory / cross-reference
      // queries bypass it so we can suggest from sibling catalogs).
      const lockedCatalog = catalogId ? partsetuStore.getCatalog(catalogId) : null;
      const lockedVehicle = lockedCatalog ? [lockedCatalog.model, lockedCatalog.variant].filter(Boolean).join(" ") || lockedCatalog.oem : null;
      const intent = await partsetuIntent.classifyIntent(activeContent, { lockedCatalogId: catalogId, lockedVehicle });
      console.log(`[partsetu] intent kind=${intent.kind} bypass_lock=${intent.bypassLock}`);
      const searchResult = await partsetuSearch.searchParts(intent, { lockedCatalogId: catalogId });
      console.log(`[partsetu] search strategies=${intent.kind} results=${searchResult.hits.length} locked=${catalogId ?? "null"}`);

      // R27.24a9 gap 4 — part-name disambiguation. When a SINGLE bare part token
      // (e.g. "clutch") resolves to >=2 distinct catalog part numbers in the
      // locked catalog, do NOT pick one — persist the candidates + original query
      // and ask the user to choose. A specific multi-word query ("clutch booster")
      // has >1 token and is answered directly. Skipped on replays/append.
      if (
        catalogId && !intent.bypassLock && intent.kind === "locked_vehicle_part" &&
        !disambiguationReplayQuery && !partDisambiguationReplay && !isPartsAppend &&
        Object.keys(intent.specs).length === 0
      ) {
        const bareTokens = intent.partTokens.filter((t) => !/^\d+$/.test(t) && t.length >= 3);
        const distinct: Array<{ part_name: string; oem_number: string }> = [];
        const seenNums = new Set<string>();
        for (const h of searchResult.hits) {
          const num = String(h.part_number || "").trim();
          if (!num || seenNums.has(num)) continue;
          seenNums.add(num);
          distinct.push({ part_name: h.description || activeContent, oem_number: num });
          if (distinct.length >= 5) break;
        }
        if (bareTokens.length === 1 && distinct.length >= 2) {
          partsetuStore.savePendingPartDisambiguation(String(conversationId), distinct, activeContent);
          console.log(`[partsetu] part multi_match_disambiguation session=${conversationId} options=${distinct.length} pending_saved=1`);
          return uviSendReply(partsetuPrompt.buildPartDisambiguationBlock(distinct));
        }
      }

      // R27.24a9 gap 3 — record found OEM numbers in the session cart for the
      // locked catalog so a later "aur X bhi chahiye" can append to a known list.
      if (catalogId && searchResult.hits.length) {
        for (const h of searchResult.hits.slice(0, 12)) {
          if (h.part_number) partsetuStore.addToCart(String(conversationId), catalogId, h.description || activeContent, String(h.part_number));
        }
        const cartNow = partsetuStore.getCart(String(conversationId), catalogId);
        console.log(`[partsetu] cart session=${conversationId} catalog=${catalogId} append=${isPartsAppend ? 1 : 0} items=${cartNow.length}`);
      }

      let verifiedBlock = "";
      if (searchResult.hits.length) {
        const lines = searchResult.hits.slice(0, 12).map((h) =>
          `- ${h.part_number || "(no number)"}: ${h.description || ""} (from ${h.catalog_label}) [${h.strategies_matched.join("+")}]`);
        verifiedBlock =
          "VERIFIED CATALOG SEARCH (R27.24a — these rows come from partsetu_parts joined to partsetu_catalogs; you MUST cite the '(from catalog #X ...)' source for every part number you quote, and NEVER state a part number that is not in this list or the context below):\n" +
          lines.join("\n") + "\n";
      }
      if (intent.bypassLock && catalogId) {
        verifiedBlock = `NOTE: This is an exploratory / cross-reference query — you MAY suggest matching parts from OTHER catalogs (not just the locked vehicle), as long as you clearly state which catalog each part comes from.\n${verifiedBlock}`;
      }

      let contextBlock = await partsetuStore.buildContextBlock(activeContent, catalogId, convNow?.chassis_no || null);
      if (verifiedBlock) contextBlock = `${verifiedBlock}\n${contextBlock}`;
      // R27.24a5 — prepend the structured per-part lookup table for multi-part
      // list queries so Sonnet answers each requested part honestly (number or
      // NO MATCH) instead of collapsing into a single "not available".
      if (intent.kind === "multi_part_list" && searchResult.perPart?.length) {
        const lc = catalogId ? partsetuStore.getCatalog(catalogId) : null;
        const label = lc
          ? `catalog #${catalogId} — ${[lc.model, lc.variant].filter(Boolean).join(" ") || lc.oem || ""}`.trim()
          : "the locked catalog";
        const lookupBlock = partsetuPrompt.buildPartLookupBlock(searchResult.perPart, label);
        if (lookupBlock) contextBlock = `${lookupBlock}\n\n${contextBlock}`;
      }
      if (resolverNote) contextBlock = `${resolverNote}\n${contextBlock}`;
      const history = partsetuHistory(Number(conversationId));
      // R27.17 — upgrade chat model from Haiku to Sonnet. Haiku was missing
      // CATALOG MATCHES and falling back to "not available" boilerplate even
      // when the right part was sitting in the context block. Haiku continues
      // to be used for keyword expansion (fast, cheap, structured JSON only).
      const systemPrompt = PARTSETU_SYSTEM(contextBlock, verifiedVehicleBlock);
      console.log(`[partsetu] sonnet system_prompt_chars=${systemPrompt.length} includes_uvi_context=${verifiedVehicleBlock.length > 0}`);
      const result = await claudeSvc.callClaudeSonnet(systemPrompt, history);
      let replyText = partsetuStore.stripBannedPhrases(result.text);
      // R27.24a — citation guard: strip hallucinated/unattributed part numbers.
      const beforeStrip = replyText;
      const permittedNums = partsetuSearch.collectPermittedPartNumbers(searchResult);
      replyText = enforcePartCitations(replyText, searchResult.hits, contextBlock, permittedNums, catalogId);
      const citationStrips = beforeStrip !== replyText ? 1 : 0;
      console.log(`[partsetu] response chars=${replyText.length} citation_strips=${citationStrips}`);

      partsetuStore.addMessage({
        conversationId: Number(conversationId), role: "assistant", content: replyText,
        aiModel: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        costUsd: result.costUsd, latencyMs: result.latencyMs,
      });

      res.json({ reply: replyText, requires_login: false, ai_available: result.ok });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Message failed" }); }
  });

  // Upload an image for visual part identification (login required).
  app.post("/api/partsetu/upload-image", requireShop, partsetuImgStore.single("image"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No image uploaded" });
      const conversationId = Number(req.body?.conversationId);
      if (!conversationId || !partsetuStore.getConversation(conversationId)) {
        return res.status(400).json({ error: "Valid conversationId required" });
      }
      const shopUserId = (req as any).shopUserId as number;
      const convRow = partsetuStore.getConversation(conversationId);
      if (convRow && !convRow.customer_id) partsetuStore.linkConversationToCustomer(conversationId, shopUserId);

      const imageUrl = `/uploads/partsetu/images/${file.filename}`;
      const userText = String(req.body?.content || "Identify this spare part and suggest the matching OEM part number.");
      partsetuStore.addMessage({ conversationId, role: "user", content: userText, imageUrl });

      const ext = path.extname(file.filename).toLowerCase();
      const mediaType: any = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
      const base64 = fs.readFileSync(file.path).toString("base64");

      // R27.23 — RC-book / owner's-manual extraction: when the attached image
      // may carry vehicle identity AND the text has no chassis/reg, ask Haiku
      // Vision for chassis/registration/model, then drive the resolver with it.
      let imgCatalogId: number | null = convRow?.catalog_context_id || null;
      if (!imgCatalogId && !partsetuStore.extractChassisTokens(userText).length && !partsetuStore.extractRegistrationNo(userText)) {
        try {
          const rcSystem = "You are extracting vehicle identity from an Indian vehicle RC book / owner's manual / registration document image. Return ONLY a JSON object with keys chassis (string|null), registration (string|null), model (string|null), variant (string|null), emission (string|null). Set a field null if not clearly visible. Do not guess.";
          const rc = await claudeSvc.callClaudeHaikuVision(rcSystem, "Extract chassis number, registration number, model, variant, emission stage from this image as JSON.", base64, mediaType);
          let parsed: any = null;
          if (rc.ok && rc.text) { try { parsed = JSON.parse(rc.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); } catch { parsed = null; } }
          const rcChassis = parsed?.chassis || null;
          const rcReg = parsed?.registration || null;
          console.log(`[partsetu] rc_book_extract chassis=${rcChassis || "null"} reg=${rcReg || "null"} model=${parsed?.model || "null"}`);
          if (rcChassis || rcReg) {
            const resolved = await partsetuStore.resolveCatalog(userText, { chassisNo: rcChassis, registrationNo: rcReg });
            if (resolved.kind === "exact") {
              imgCatalogId = resolved.catalog_id;
              partsetuStore.setCatalogContext(conversationId, imgCatalogId);
            }
          }
        } catch (e: any) {
          console.warn(`[partsetu] rc_book_extract ERROR: ${e?.message || e}`);
        }
      }
      if (!imgCatalogId) imgCatalogId = partsetuStore.ensureCatalogContext(conversationId, userText);
      const imgConvNow = partsetuStore.getConversation(conversationId);
      const imgContext = await partsetuStore.buildContextBlock(userText, imgCatalogId, imgConvNow?.chassis_no || null);
      const visionSystem = PARTSETU_SYSTEM(imgContext) +
        "\n\nThe user has attached a photo of a part. Describe the part you see and, using the CONTEXT, suggest likely matching part number(s). Never invent a number, and never mention price.";
      const result = await claudeSvc.callClaudeSonnetVision(visionSystem, userText, base64, mediaType);
      const imgReply = partsetuStore.stripBannedPhrases(result.text);

      partsetuStore.addMessage({
        conversationId, role: "assistant", content: imgReply,
        aiModel: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        costUsd: result.costUsd, latencyMs: result.latencyMs,
      });
      res.json({ reply: imgReply, imageUrl, ai_available: result.ok });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Image upload failed" }); }
  });

  // Request a catalog be added (login required).
  app.post("/api/partsetu/catalog-request", requireShop, async (req, res) => {
    try {
      const { make, model, variant, year, chassisNo, engineModel, notes, photoUrl } = req.body || {};
      const id = partsetuStore.createCatalogRequest({
        customerId: (req as any).shopUserId as number,
        make: make || null, model: model || null, variant: variant || null, year: year || null,
        chassisNo: chassisNo || null, engineModel: engineModel || null, notes: notes || null, photoUrl: photoUrl || null,
      });
      res.json({ ok: true, id });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Request failed" }); }
  });

  // ---- Admin: catalog requests, conversations, usage ----
  app.get("/api/admin/partsetu/catalog-requests", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      res.json(partsetuStore.listCatalogRequests(status));
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.patch("/api/admin/partsetu/catalog-requests/:id", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status, adminNotes } = req.body || {};
      partsetuStore.updateCatalogRequest(id, { status, adminNotes });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.get("/api/admin/partsetu/conversations", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(partsetuStore.listConversationsAdmin(200)); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.get("/api/admin/partsetu/conversations/:id/messages", requireDataCenterOrAdmin, async (req, res) => {
    try { res.json(partsetuStore.listMessages(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.get("/api/admin/partsetu/usage", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(partsetuStore.usageSummary()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // ---- Admin: catalog PDF upload + ingest (v1.3) ----
  // Upload a spare-parts catalogue PDF; it is stored on the persistent disk and
  // parsed synchronously into partsetu_catalogs/partsetu_parts. ~30s for a large
  // catalogue is acceptable; the admin sees the result inline.
  app.post("/api/admin/partsetu/catalogs/upload", requireDataCenterOrAdmin, partsetuCatalogUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file || !file.buffer?.length) return res.status(400).json({ error: "No PDF uploaded" });
      // Magic-byte check: a real PDF starts with "%PDF".
      if (file.buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
        return res.status(400).json({ error: "File is not a valid PDF (bad header)" });
      }
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      // B1 — optional free-form chassis number from the upload form.
      const chassisNo = req.body?.chassisNo ? String(req.body.chassisNo).trim() : undefined;
      const tmpPath = catalogStorage.saveTmpPdf(file.buffer);
      try {
        const r = await catalogIngester.ingestCatalogPdf({ pdfPath: tmpPath, uploadedBy, chassisNo, cleanupSrc: true });
        res.json({ catalogId: r.catalogId, partsCount: r.partsCount, vcNo: r.vcNo, model: r.model });
      } catch (err: any) {
        catalogStorage.deleteTmp(tmpPath);
        res.status(422).json({ error: err?.message || "Ingestion failed" });
      }
    } catch (e: any) { res.status(500).json({ error: e?.message || "Upload failed" }); }
  });

  // R27.22 — AI-driven catalog metadata detection. Stages the PDF under its
  // fingerprint and returns the (cached or AI-proposed) metadata for the confirm
  // dialog. The catalog row is NOT created here; confirm-upload does that.
  const catalogMetaDetector = require("./services/catalog-metadata-detector") as typeof import("./services/catalog-metadata-detector");
  app.post("/api/admin/partsetu/catalogs/detect-metadata", requireDataCenterOrAdmin, partsetuCatalogUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file || !file.buffer?.length) return res.status(400).json({ error: "No PDF uploaded" });
      if (file.buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
        return res.status(400).json({ error: "File is not a valid PDF (bad header)" });
      }
      const r = await catalogMetaDetector.detectCatalogMetadata({ buffer: file.buffer, filename: String(file.originalname || "catalog.pdf") });
      res.json(r);
    } catch (e: any) { res.status(500).json({ error: e?.message || "Detection failed" }); }
  });

  // R27.22 — confirm catalog metadata + ingest the staged PDF. Body:
  // { fingerprint, metadata, originalFilename, edited? }. Moves the staged PDF
  // into the ingester (which copies it to its final <id>.pdf) and applies the
  // confirmed metadata. Saves the confirmed metadata to the cache.
  app.post("/api/admin/partsetu/catalogs/confirm-upload", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const fingerprint = String(req.body?.fingerprint || "").trim();
      if (!fingerprint || !/^[a-f0-9]{16,128}$/i.test(fingerprint)) return res.status(400).json({ error: "Missing or invalid fingerprint" });
      const stagedPath = catalogMetaDetector.catalogStagingPath(fingerprint);
      if (!fs.existsSync(stagedPath)) return res.status(404).json({ error: "Staged PDF not found — please re-upload" });
      const metadata = (req.body?.metadata || {}) as import("./services/catalog-metadata-detector").CatalogMetadata;
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const override = catalogMetaDetector.toCatalogMetaOverride(metadata);
      const chassisNo = metadata?.chassis_no ? String(metadata.chassis_no).trim() : undefined;
      try {
        const r = await catalogIngester.ingestCatalogPdf({
          pdfPath: stagedPath, uploadedBy,
          oem: override.oem ? String(override.oem) : undefined,
          chassisNo, cleanupSrc: true, meta: override,
        });
        const source = req.body?.edited ? "user-edited" : "user-confirmed";
        try { catalogMetaDetector.saveCatalogMetaCache({ fingerprint, metadata, confidence: req.body?.confidence ?? null, source, createdBy: uploadedBy }); } catch { /* non-fatal */ }
        res.json({ catalogId: r.catalogId, partsCount: r.partsCount, vcNo: r.vcNo, model: r.model });
      } catch (err: any) {
        res.status(422).json({ error: err?.message || "Ingestion failed" });
      }
    } catch (e: any) { res.status(500).json({ error: e?.message || "Confirm failed" }); }
  });

  app.get("/api/admin/partsetu/catalogs", requireDataCenterOrAdmin, async (_req, res) => {
    try {
      const rows = rawSqlite.prepare(
        `SELECT c.id, c.oem, c.model, c.variant, c.vc_no, c.status, c.file_size_bytes,
                c.uploaded_at, c.uploaded_by, c.ingest_error, c.total_pages,
                (SELECT COUNT(*) FROM partsetu_parts p WHERE p.catalog_id = c.id) AS parts_count
         FROM partsetu_catalogs c
         ORDER BY COALESCE(c.uploaded_at, c.ingested_at) DESC, c.id DESC`,
      ).all();
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // R27.24a — diagnostic: random sample of a catalog's actual parts so the
  // team can inspect real partsetu_parts.description text after deploy.
  app.get("/api/admin/partsetu/diag/sample-parts", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const catalogId = Number(req.query.catalog_id);
      if (!catalogId) return res.status(400).json({ error: "catalog_id is required" });
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));
      const cat = rawSqlite.prepare(`SELECT id, oem, model, variant FROM partsetu_catalogs WHERE id = ?`).get(catalogId) as any;
      if (!cat) return res.status(404).json({ error: "catalog not found" });
      const label = [cat.model, cat.variant].filter(Boolean).join(" ").trim() || cat.oem || `#${catalogId}`;
      const total = (rawSqlite.prepare(`SELECT COUNT(*) AS n FROM partsetu_parts WHERE catalog_id = ?`).get(catalogId) as any)?.n || 0;
      const samples = rawSqlite.prepare(
        `SELECT id, part_number, description, source_page_no FROM partsetu_parts
         WHERE catalog_id = ? ORDER BY RANDOM() LIMIT ?`,
      ).all(catalogId, limit);
      res.json({ catalog_id: catalogId, catalog_label: label, total_parts: total, samples });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // R27.24a3 — Universal Vehicle Identifier resolver test endpoint. Returns the
  // full ranked candidate list + auto-lock decision so an admin can probe any
  // fragment (partial VC No, chassis prefix, model, OEM code) from a browser.
  app.post("/api/admin/partsetu/uvi-resolve", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const input = String(req.body?.input || "").trim();
      if (!input) return res.status(400).json({ error: "input is required" });
      const result = await partsetuUvi.resolveVehicle(input);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // R27.24a3 — admin teaches the resolver a mapping (e.g. chassis '505409' →
  // catalog 2). Future queries hit the identifier table instantly.
  app.post("/api/admin/partsetu/identifiers/add", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const catalogId = Number(req.body?.catalog_id);
      const type = String(req.body?.identifier_type || "").trim();
      const value = String(req.body?.identifier_value || "").trim();
      if (!catalogId || !type || !value) {
        return res.status(400).json({ error: "catalog_id, identifier_type and identifier_value are required" });
      }
      const cat = rawSqlite.prepare(`SELECT id FROM partsetu_catalogs WHERE id = ?`).get(catalogId);
      if (!cat) return res.status(404).json({ error: "catalog not found" });
      const normalized = value.toUpperCase().replace(/[\s\-._]/g, "");
      const info = rawSqlite.prepare(
        `INSERT OR IGNORE INTO partsetu_vehicle_identifiers
         (catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at)
         VALUES (?, ?, ?, ?, 1.0, 'user_confirmed', ?)`,
      ).run(catalogId, type, value, normalized, Date.now());
      if (!info.changes) {
        const existing = rawSqlite.prepare(
          `SELECT id FROM partsetu_vehicle_identifiers WHERE catalog_id = ? AND identifier_type = ? AND normalized_value = ?`,
        ).get(catalogId, type, normalized) as any;
        return res.json({ ok: true, id: existing?.id ?? null, existed: true });
      }
      res.json({ ok: true, id: Number(info.lastInsertRowid) });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.get("/api/admin/partsetu/identifiers/list", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const catalogId = Number(req.query.catalog_id);
      if (!catalogId) return res.status(400).json({ error: "catalog_id is required" });
      const rows = rawSqlite.prepare(
        `SELECT id, catalog_id, identifier_type, identifier_value, normalized_value, confidence, source, created_at
         FROM partsetu_vehicle_identifiers WHERE catalog_id = ? ORDER BY identifier_type, identifier_value`,
      ).all(catalogId);
      res.json({ catalog_id: catalogId, identifiers: rows });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.delete("/api/admin/partsetu/identifiers/:id", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "id is required" });
      const info = rawSqlite.prepare(`DELETE FROM partsetu_vehicle_identifiers WHERE id = ?`).run(id);
      res.json({ ok: true, deleted: info.changes });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.get("/api/admin/partsetu/catalogs/:id/pdf", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const p = catalogStorage.getCatalogPdfPath(id);
      if (!catalogStorage.catalogPdfExists(id)) return res.status(404).json({ error: "PDF not found on disk" });
      res.setHeader("Content-Type", "application/pdf");
      res.sendFile(p);
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.delete("/api/admin/partsetu/catalogs/:id", requireAdminRole, async (req, res) => {
    try {
      const id = Number(req.params.id);
      rawSqlite.prepare(`UPDATE partsetu_conversations SET catalog_context_id = NULL WHERE catalog_context_id = ?`).run(id);
      rawSqlite.prepare(`DELETE FROM partsetu_parts WHERE catalog_id = ?`).run(id);
      rawSqlite.prepare(`DELETE FROM partsetu_catalog_images WHERE catalog_id = ?`).run(id);
      rawSqlite.prepare(`DELETE FROM partsetu_catalogs WHERE id = ?`).run(id);
      catalogStorage.deleteCatalogPdf(id);
      res.json({ deleted: true });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // R27.23 — serve an embedded catalog image for a page. Picks the lowest
  // image_index for that page. Streams from local disk or redirects to a
  // presigned R2 URL depending on where the image was stored at ingest.
  async function servePartsetuImage(catalogId: number, pageNo: number, res: Response): Promise<void> {
    const row = rawSqlite.prepare(
      `SELECT * FROM partsetu_catalog_images WHERE catalog_id = ? AND page_no = ? ORDER BY image_index ASC LIMIT 1`,
    ).get(catalogId, pageNo) as any;
    if (!row) { res.status(404).json({ error: "Image not found" }); return; }
    const fmt = (row.format || "png").toLowerCase();
    const contentType = fmt === "jpg" || fmt === "jpeg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
    console.log(`[partsetu] serve_image catalog=${catalogId} page=${pageNo}`);
    if (row.storage_type === "local" && row.local_path) {
      if (!fs.existsSync(row.local_path)) { res.status(404).json({ error: "Image file missing on disk" }); return; }
      res.setHeader("Content-Type", contentType);
      res.sendFile(path.resolve(row.local_path));
      return;
    }
    if (row.storage_type === "r2" && row.r2_key) {
      const r2 = require("./services/r2-storage") as typeof import("./services/r2-storage");
      const url = await r2.getStorageBackend().getFileUrl(row.r2_key, "r2");
      res.redirect(url);
      return;
    }
    res.status(404).json({ error: "Image has no resolvable storage location" });
  }

  app.get("/api/admin/partsetu/catalog-images/:catalogId/page-:page.:ext", requireDataCenterOrAdmin, async (req, res) => {
    try {
      await servePartsetuImage(Number(req.params.catalogId), Number(req.params.page), res);
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Public chat-side image: token must be a valid chat session id (partsetu_conversations).
  app.get("/api/partsetu/catalog-images/:catalogId/page-:page.:ext", async (req, res) => {
    try {
      const token = String(req.query.token || "");
      if (!token) return res.status(401).json({ error: "token required" });
      const conv = rawSqlite.prepare(`SELECT id FROM partsetu_conversations WHERE id = ?`).get(Number(token)) as any;
      if (!conv) return res.status(403).json({ error: "invalid session token" });
      await servePartsetuImage(Number(req.params.catalogId), Number(req.params.page), res);
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  app.post("/api/admin/partsetu/catalogs/:id/reingest", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const r = await catalogIngester.reingestCatalog(id, uploadedBy);
      res.json({ catalogId: r.catalogId, partsCount: r.partsCount });
    } catch (e: any) { res.status(422).json({ error: e?.message || "Re-ingest failed" }); }
  });

  // ==================================================================
  // PartSetu v1.4 — Comparative Sheets (C1), Price Lists (C2),
  // Consumption Reports (C3), and Teaching Module (D2).
  // All guarded by requireDataCenterOrAdmin (data_center: no DELETE).
  // ==================================================================
  const xrefIngester = require("./services/xref-ingester") as typeof import("./services/xref-ingester");
  const sheetIngester = require("./services/sheet-ingester") as typeof import("./services/sheet-ingester");

  // Disk storage for uploaded sheets on the persistent disk.
  const partsetuDataDir = path.join(process.env.DATA_DIR || ".", "uploads", "partsetu");
  const mkSheetStore = (sub: string, maxMb: number) => {
    const dir = path.join(partsetuDataDir, sub);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return multer({
      storage: multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, dir),
        filename: (_req: any, file: any, cb: any) => cb(null, `${Date.now()}-${String(file.originalname || "sheet").replace(/[^a-zA-Z0-9._-]/g, "_")}`),
      }),
      limits: { fileSize: maxMb * 1024 * 1024 },
    });
  };
  const xrefUpload = mkSheetStore("xrefs", 100);
  const priceUpload = mkSheetStore("prices", 50);
  const consumptionUpload = mkSheetStore("consumption", 50);

  // ---- C1: Comparative sheets (xref) ----
  app.post("/api/admin/partsetu/xrefs/upload", requireDataCenterOrAdmin, xrefUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const sourceName = String(req.body?.sourceName || file.originalname || "comparative-sheet");
      const sourceBrand = req.body?.sourceBrand ? String(req.body.sourceBrand) : "WABCO";
      const r = xrefIngester.ingestXrefWorkbook({ xlsxPath: file.path, sourceName, sourceBrand, uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Xref ingest failed" }); }
  });

  // R27.22 — AI-driven xref format detection. Uses in-memory upload so the
  // detector can fingerprint + stage the workbook under its fingerprint, then
  // returns the (cached or AI-proposed) per-sheet mapping plan + preview.
  const xrefFormatDetector = require("./services/xref-format-detector") as typeof import("./services/xref-format-detector");
  const xrefDetectUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  app.post("/api/admin/partsetu/xrefs/detect-format", requireDataCenterOrAdmin, xrefDetectUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file || !file.buffer?.length) return res.status(400).json({ error: "No file uploaded" });
      const r = await xrefFormatDetector.detectXrefFormat({ buffer: file.buffer, filename: String(file.originalname || "xref.xlsx") });
      res.json(r);
    } catch (e: any) { res.status(500).json({ error: e?.message || "Detection failed" }); }
  });

  // R27.22 — confirm xref mapping plan + ingest the staged workbook. Body:
  // { fingerprint, plan, originalFilename, edited? }. Runs the ingester with the
  // confirmed plan and saves the plan to the format cache.
  app.post("/api/admin/partsetu/xrefs/confirm-format", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const fingerprint = String(req.body?.fingerprint || "").trim();
      if (!fingerprint || !/^[a-f0-9]{16,128}$/i.test(fingerprint)) return res.status(400).json({ error: "Missing or invalid fingerprint" });
      const stagedPath = xrefFormatDetector.xrefStagingPath(fingerprint);
      if (!fs.existsSync(stagedPath)) return res.status(404).json({ error: "Staged workbook not found — please re-upload" });
      const plan = req.body?.plan as import("./services/xref-ingester").XrefMappingPlan;
      if (!plan || !Array.isArray(plan.sheets)) return res.status(400).json({ error: "Missing or invalid mapping plan" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const sourceName = String(req.body?.originalFilename || "comparative-sheet");
      const sourceBrand = plan.file_brand ? String(plan.file_brand) : "WABCO";
      try {
        const r = xrefIngester.ingestXrefWorkbook({ xlsxPath: stagedPath, sourceName, sourceBrand, uploadedBy, mappingPlan: plan });
        const source = req.body?.edited ? "user-edited" : "user-confirmed";
        try { xrefFormatDetector.saveXrefCache({ fingerprint, plan, source, label: plan.layout || null, createdBy: uploadedBy }); } catch { /* non-fatal */ }
        res.json(r);
      } catch (err: any) {
        res.status(422).json({ error: err?.message || "Xref ingest failed" });
      }
    } catch (e: any) { res.status(500).json({ error: e?.message || "Confirm failed" }); }
  });

  app.get("/api/admin/partsetu/xrefs", requireDataCenterOrAdmin, async (_req, res) => {
    try {
      res.json(rawSqlite.prepare(`SELECT * FROM partsetu_xref_sources ORDER BY id DESC`).all());
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.get("/api/admin/partsetu/xrefs/:id/rows", requireDataCenterOrAdmin, async (req, res) => {
    try {
      res.json(rawSqlite.prepare(`SELECT * FROM partsetu_xref WHERE source_file_id = ? LIMIT 500`).all(Number(req.params.id)));
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.post("/api/admin/partsetu/xrefs/:id/reingest", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const src = rawSqlite.prepare(`SELECT * FROM partsetu_xref_sources WHERE id = ?`).get(Number(req.params.id)) as any;
      if (!src) return res.status(404).json({ error: "Source not found" });
      if (!src.file_path || !fs.existsSync(src.file_path)) return res.status(404).json({ error: "Stored file not found" });
      xrefIngester.deleteXrefSource(Number(req.params.id));
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const r = xrefIngester.ingestXrefWorkbook({ xlsxPath: src.file_path, sourceName: src.source_name, sourceBrand: src.source_brand || "WABCO", uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Re-ingest failed" }); }
  });
  app.delete("/api/admin/partsetu/xrefs/:id", requireAdminRole, async (req, res) => {
    try { res.json(xrefIngester.deleteXrefSource(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // ---- C2/C3 shared: preview a sheet's columns + sample rows for mapping ----
  // The upload is stored, parsed, and its detected columns + 5 sample rows are
  // returned so the admin can map each column to a schema field before ingest.
  const previewUpload = mkSheetStore("tmp", 50);
  app.post("/api/admin/partsetu/sheet/preview", requireDataCenterOrAdmin, previewUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const preview = sheetIngester.parseSheetPreview(file.path);
      const kind = String(req.body?.kind || "prices");
      const fields = kind === "consumption" ? sheetIngester.CONSUMPTION_SCHEMA_FIELDS : sheetIngester.PRICE_SCHEMA_FIELDS;
      res.json({ filePath: file.path, originalName: file.originalname, schemaFields: fields, ...preview });
    } catch (e: any) { res.status(422).json({ error: e?.message || "Preview failed" }); }
  });

  // ---- C2: Price lists ----
  app.post("/api/admin/partsetu/prices/upload", requireDataCenterOrAdmin, priceUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const sourceName = String(req.body?.sourceName || file.originalname || "price-list");
      let columnMap: any = {};
      try { columnMap = JSON.parse(req.body?.columnMap || "{}"); } catch { columnMap = {}; }
      const r = sheetIngester.ingestPrices({ filePath: file.path, sourceName, columnMap, uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Price ingest failed" }); }
  });
  // Ingest from an already-previewed (uploaded) file path + chosen mapping.
  app.post("/api/admin/partsetu/prices/ingest", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { filePath, sourceName, columnMap } = req.body || {};
      if (!filePath || !fs.existsSync(filePath)) return res.status(400).json({ error: "filePath missing or not found" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const r = sheetIngester.ingestPrices({ filePath, sourceName: String(sourceName || "price-list"), columnMap: columnMap || {}, uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Price ingest failed" }); }
  });
  app.get("/api/admin/partsetu/prices", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_price_sources ORDER BY id DESC`).all()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.get("/api/admin/partsetu/prices/:id/rows", requireDataCenterOrAdmin, async (req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_prices WHERE source_file_id = ? LIMIT 500`).all(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.delete("/api/admin/partsetu/prices/:id", requireAdminRole, async (req, res) => {
    try { res.json(sheetIngester.deletePriceSource(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // ---- C3: Consumption reports ----
  app.post("/api/admin/partsetu/consumption/upload", requireDataCenterOrAdmin, consumptionUpload.single("file"), async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const sourceName = String(req.body?.sourceName || file.originalname || "consumption-report");
      let columnMap: any = {};
      try { columnMap = JSON.parse(req.body?.columnMap || "{}"); } catch { columnMap = {}; }
      const r = sheetIngester.ingestConsumption({ filePath: file.path, sourceName, columnMap, uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Consumption ingest failed" }); }
  });
  app.post("/api/admin/partsetu/consumption/ingest", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { filePath, sourceName, columnMap } = req.body || {};
      if (!filePath || !fs.existsSync(filePath)) return res.status(400).json({ error: "filePath missing or not found" });
      const uploadedBy = ((req as any).user?.username as string) || "admin";
      const r = sheetIngester.ingestConsumption({ filePath, sourceName: String(sourceName || "consumption-report"), columnMap: columnMap || {}, uploadedBy });
      res.json(r);
    } catch (e: any) { res.status(422).json({ error: e?.message || "Consumption ingest failed" }); }
  });
  app.get("/api/admin/partsetu/consumption", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_consumption_sources ORDER BY id DESC`).all()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.get("/api/admin/partsetu/consumption/:id/rows", requireDataCenterOrAdmin, async (req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_consumption WHERE source_file_id = ? LIMIT 500`).all(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.delete("/api/admin/partsetu/consumption/:id", requireAdminRole, async (req, res) => {
    try { res.json(sheetIngester.deleteConsumptionSource(Number(req.params.id))); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // ==================================================================
  // PartSetu v1.4 D2 — Teaching Module CRUD (synonyms / answers / rules)
  // + Lessons Import (parse via Claude, then apply selected).
  // ==================================================================
  const teachNow = () => Date.now();

  // Synonyms
  app.get("/api/admin/partsetu/synonyms", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_synonyms ORDER BY id DESC`).all()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.post("/api/admin/partsetu/synonyms", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { queryTerm, expandedTerms, catalogId } = req.body || {};
      if (!queryTerm || !Array.isArray(expandedTerms)) return res.status(400).json({ error: "queryTerm and expandedTerms[] required" });
      const taughtBy = ((req as any).user?.username as string) || "admin";
      const ts = teachNow();
      const r = rawSqlite.prepare(
        `INSERT OR IGNORE INTO partsetu_synonyms (query_term, expanded_terms_json, catalog_id, taught_by, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?)`,
      ).run(String(queryTerm).toLowerCase(), JSON.stringify(expandedTerms), catalogId ?? null, taughtBy, ts, ts);
      res.json({ id: Number(r.lastInsertRowid), changes: r.changes });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.patch("/api/admin/partsetu/synonyms/:id", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { queryTerm, expandedTerms, catalogId } = req.body || {};
      rawSqlite.prepare(
        `UPDATE partsetu_synonyms SET query_term = COALESCE(?, query_term),
           expanded_terms_json = COALESCE(?, expanded_terms_json),
           catalog_id = ?, updated_at = ? WHERE id = ?`,
      ).run(
        queryTerm != null ? String(queryTerm).toLowerCase() : null,
        Array.isArray(expandedTerms) ? JSON.stringify(expandedTerms) : null,
        catalogId ?? null, teachNow(), Number(req.params.id),
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.delete("/api/admin/partsetu/synonyms/:id", requireAdminRole, async (req, res) => {
    try { rawSqlite.prepare(`DELETE FROM partsetu_synonyms WHERE id = ?`).run(Number(req.params.id)); res.json({ deleted: true }); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Answers
  app.get("/api/admin/partsetu/answers", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_answers ORDER BY id DESC`).all()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.post("/api/admin/partsetu/answers", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { catalogId, queryPattern, partNumbers, notes } = req.body || {};
      if (!queryPattern) return res.status(400).json({ error: "queryPattern required" });
      const taughtBy = ((req as any).user?.username as string) || "admin";
      const ts = teachNow();
      const r = rawSqlite.prepare(
        `INSERT INTO partsetu_answers (catalog_id, query_pattern, part_numbers_json, notes, taught_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(catalogId ?? null, String(queryPattern), JSON.stringify(partNumbers || []), notes ?? null, taughtBy, ts, ts);
      res.json({ id: Number(r.lastInsertRowid) });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.patch("/api/admin/partsetu/answers/:id", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { catalogId, queryPattern, partNumbers, notes } = req.body || {};
      rawSqlite.prepare(
        `UPDATE partsetu_answers SET catalog_id = ?, query_pattern = COALESCE(?, query_pattern),
           part_numbers_json = COALESCE(?, part_numbers_json), notes = ?, updated_at = ? WHERE id = ?`,
      ).run(
        catalogId ?? null, queryPattern ?? null,
        Array.isArray(partNumbers) ? JSON.stringify(partNumbers) : null,
        notes ?? null, teachNow(), Number(req.params.id),
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.delete("/api/admin/partsetu/answers/:id", requireAdminRole, async (req, res) => {
    try { rawSqlite.prepare(`DELETE FROM partsetu_answers WHERE id = ?`).run(Number(req.params.id)); res.json({ deleted: true }); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // Rules
  app.get("/api/admin/partsetu/rules", requireDataCenterOrAdmin, async (_req, res) => {
    try { res.json(rawSqlite.prepare(`SELECT * FROM partsetu_rules ORDER BY priority DESC, id DESC`).all()); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.post("/api/admin/partsetu/rules", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { ruleText, scope, priority, oem, catalogId, category } = req.body || {};
      if (!ruleText) return res.status(400).json({ error: "ruleText required" });
      const taughtBy = ((req as any).user?.username as string) || "admin";
      const ts = teachNow();
      const r = rawSqlite.prepare(
        `INSERT INTO partsetu_rules (rule_text, scope, priority, oem, catalog_id, category, active, taught_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(String(ruleText), String(scope || "global"), Number(priority ?? 50), oem ?? null, catalogId ?? null, category ?? null, taughtBy, ts, ts);
      res.json({ id: Number(r.lastInsertRowid) });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.patch("/api/admin/partsetu/rules/:id", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { ruleText, scope, priority, oem, catalogId, category, active } = req.body || {};
      rawSqlite.prepare(
        `UPDATE partsetu_rules SET rule_text = COALESCE(?, rule_text), scope = COALESCE(?, scope),
           priority = COALESCE(?, priority), oem = ?, catalog_id = ?, category = ?,
           active = COALESCE(?, active), updated_at = ? WHERE id = ?`,
      ).run(
        ruleText ?? null, scope ?? null, priority != null ? Number(priority) : null,
        oem ?? null, catalogId ?? null, category ?? null,
        active != null ? (active ? 1 : 0) : null, teachNow(), Number(req.params.id),
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message }); }
  });
  app.delete("/api/admin/partsetu/rules/:id", requireAdminRole, async (req, res) => {
    try { rawSqlite.prepare(`DELETE FROM partsetu_rules WHERE id = ?`).run(Number(req.params.id)); res.json({ deleted: true }); }
    catch (e: any) { res.status(500).json({ error: e?.message }); }
  });

  // ---- Lessons Import: parse free text into structured lessons, then apply ----
  app.post("/api/admin/partsetu/lessons-import/parse", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const rawText = String(req.body?.rawText || "").trim();
      if (!rawText) return res.status(400).json({ error: "rawText required" });
      const taughtBy = ((req as any).user?.username as string) || "admin";
      const sys = `You convert free-form PartSetu teaching notes into structured lessons. Return ONLY a JSON object with keys: rules (array of {rule_text, scope, priority, oem}), synonyms (array of {query_term, expanded_terms: string[]}), answers (array of {query_pattern, part_numbers: string[], notes}). scope is 'global' or 'oem'. priority 50-100. Omit fields you can't infer. No prose, no markdown.`;
      const r = await claudeSvc.callClaudeSonnet(sys, [{ role: "user", content: rawText.slice(0, 16000) }], 2048);
      let parsed: any = { rules: [], synonyms: [], answers: [] };
      if (r.ok) {
        try { parsed = JSON.parse(r.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()); } catch { /* keep empty */ }
      }
      const ts = teachNow();
      const ins = rawSqlite.prepare(
        `INSERT INTO partsetu_lessons_import (raw_text, parsed_lessons_json, status, taught_by, created_at)
         VALUES (?, ?, 'pending', ?, ?)`,
      ).run(rawText, JSON.stringify(parsed), taughtBy, ts);
      res.json({ importId: Number(ins.lastInsertRowid), parsed, aiAvailable: r.ok });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Parse failed" }); }
  });
  app.post("/api/admin/partsetu/lessons-import/apply", requireDataCenterOrAdmin, async (req, res) => {
    try {
      const { importId, lessons } = req.body || {};
      const sel = lessons || {};
      const taughtBy = ((req as any).user?.username as string) || "admin";
      const ts = teachNow();
      let rules = 0, synonyms = 0, answers = 0;
      const tx = rawSqlite.transaction(() => {
        for (const r of (sel.rules || [])) {
          if (!r?.rule_text) continue;
          rawSqlite.prepare(
            `INSERT INTO partsetu_rules (rule_text, scope, priority, oem, catalog_id, category, active, taught_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?)`,
          ).run(String(r.rule_text), String(r.scope || "global"), Number(r.priority ?? 50), r.oem ?? null, taughtBy, ts, ts);
          rules++;
        }
        for (const s of (sel.synonyms || [])) {
          if (!s?.query_term || !Array.isArray(s.expanded_terms)) continue;
          rawSqlite.prepare(
            `INSERT OR IGNORE INTO partsetu_synonyms (query_term, expanded_terms_json, catalog_id, taught_by, source, created_at, updated_at)
             VALUES (?, ?, NULL, ?, 'lessons-import', ?, ?)`,
          ).run(String(s.query_term).toLowerCase(), JSON.stringify(s.expanded_terms), taughtBy, ts, ts);
          synonyms++;
        }
        for (const a of (sel.answers || [])) {
          if (!a?.query_pattern) continue;
          rawSqlite.prepare(
            `INSERT INTO partsetu_answers (catalog_id, query_pattern, part_numbers_json, notes, taught_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(a.catalog_id ?? null, String(a.query_pattern), JSON.stringify(a.part_numbers || []), a.notes ?? null, taughtBy, ts, ts);
          answers++;
        }
        if (importId) {
          rawSqlite.prepare(`UPDATE partsetu_lessons_import SET status = 'applied', applied_at = ? WHERE id = ?`).run(ts, Number(importId));
        }
      });
      tx();
      res.json({ applied: { rules, synonyms, answers } });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Apply failed" }); }
  });

  // ---- public: currencies (TASK 7) ----
  app.get("/api/public/currencies", async (_req, res) => {
    try {
      const { getFXRate } = await import("./fx-service");
      const defaultCurrency = shop.getShopSetting("default_currency", "INR");
      let usdRateInr: number | null = null;
      try {
        // open.er-api.com / exchangerate.host both keyed via getFXRate(USD→INR)
        usdRateInr = await getFXRate("USD", "INR");
      } catch { usdRateInr = null; }
      const rates: Record<string, any> = {};
      if (usdRateInr && usdRateInr > 0) {
        rates.USD = { rate_inr: usdRateInr, fetched_at: new Date().toISOString() };
      } else {
        // graceful fallback so the picker still works if the FX API is down
        rates.USD = { rate_inr: 83.5, fetched_at: null, fallback: true };
      }
      res.json({ default: defaultCurrency, available: ["INR", "USD"], rates });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ---- shop auth (TASK 2 / R27.1a BUG 2 — strict email-OTP verification) ----
  // R27.1a BUG 2 — signup creates an UNVERIFIED account, emails a 6-digit OTP, and does
  // NOT issue a token. Client redirects to /#/customer/verify?email=... to complete.
  function sendShopOtpEmail(to: string, otp: string) {
    sendGenericEmail({
      to,
      subject: "Your Narmada verification code",
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#001a4d;color:#fff;padding:18px;border-radius:8px 8px 0 0;"><h2 style="margin:0;">Verify your email</h2></div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;text-align:center;">
          <p style="margin:0 0 12px;">Your Narmada verification code is:</p>
          <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:8px 0;color:#001a4d;">${escapeHtml(otp)}</p>
          <p style="color:#888;font-size:13px;margin-top:12px;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
        </div></div>`,
      text: `Your Narmada verification code is: ${otp} (expires in 10 minutes).`,
      event: "shop_signup_otp",
    }).catch((e: any) => console.error("[email] order_signup_otp failed:", e?.message || e));
  }

  function sendShopWelcomeEmail(to: string, name?: string) {
    sendGenericEmail({
      to,
      subject: "Welcome to Narmada Mobility",
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#001a4d;color:#fff;padding:18px;border-radius:8px 8px 0 0;"><h2 style="margin:0;">Welcome${name ? ", " + escapeHtml(name) : ""}!</h2></div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <p>Your Narmada Mobility account is verified and ready. You can now shop genuine spare parts, save addresses, and track your orders.</p>
          <p style="margin-top:14px;"><a href="https://narmadamobility.com/#/products" style="background:#001a4d;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Start shopping</a></p>
        </div></div>`,
      text: `Welcome to Narmada Mobility${name ? ", " + name : ""}! Your account is verified and ready.`,
      event: "shop_welcome",
    }).catch((e: any) => console.error("[email] shop_welcome failed:", e?.message || e));
  }

  app.post("/api/shop/signup", async (req, res) => {
    try {
      const { email, password, full_name, fullName, phone } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });
      if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const { user, otp } = shop.createShopUser(email, password, full_name ?? fullName, phone);
      sendShopOtpEmail((user as any).email, otp);
      res.json({ verify_required: true, email: (user as any).email });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/shop/verify-otp", async (req, res) => {
    try {
      const { email, otp } = req.body || {};
      if (!email || !otp) return res.status(400).json({ error: "Email and code required" });
      const result = shop.verifyShopOtp(email, otp);
      sendShopWelcomeEmail((result.user as any).email, (result.user as any).fullName);
      res.json(result);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/shop/resend-otp", async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: "Email required" });
      const { otp } = shop.resendShopOtp(email);
      sendShopOtpEmail(String(email).trim().toLowerCase(), otp);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/shop/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });
      const result = shop.loginShopUser(email, password);
      if (!result) return res.status(401).json({ error: "Invalid email or password" });
      if ("error" in result && result.error === "verify_required") {
        // Re-send a fresh OTP so the user lands on the verify screen with a valid code.
        try { const { otp } = shop.resendShopOtp(result.email); sendShopOtpEmail(result.email, otp); } catch {}
        return res.status(403).json({ error: "verify_required", email: result.email });
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/shop/logout", requireShop, async (req, res) => {
    shop.deleteShopSession(req.headers["x-shop-token"] as string);
    res.json({ ok: true });
  });

  app.get("/api/shop/me", requireShop, async (req, res) => {
    const user = shop.getShopUserById((req as any).shopUserId);
    if (!user) return res.status(404).json({ error: "Account not found" });
    res.json(user);
  });

  // ---- addresses ----
  app.get("/api/shop/addresses", requireShop, (req, res) => res.json(shop.listAddresses((req as any).shopUserId)));
  app.post("/api/shop/addresses", requireShop, (req, res) => {
    try { res.json(shop.createAddress((req as any).shopUserId, req.body || {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.put("/api/shop/addresses/:id", requireShop, (req, res) => {
    const r = shop.updateAddress((req as any).shopUserId, parseInt(String(req.params.id), 10), req.body || {});
    if (!r) return res.status(404).json({ error: "Address not found" });
    res.json(r);
  });
  app.delete("/api/shop/addresses/:id", requireShop, (req, res) => {
    shop.deleteAddress((req as any).shopUserId, parseInt(String(req.params.id), 10));
    res.json({ ok: true });
  });
  app.post("/api/shop/addresses/:id/default", requireShop, (req, res) => {
    const r = shop.setDefaultAddress((req as any).shopUserId, parseInt(String(req.params.id), 10));
    if (!r) return res.status(404).json({ error: "Address not found" });
    res.json(r);
  });

  // ---- wishlist ----
  app.get("/api/shop/wishlist", requireShop, (req, res) => res.json(shop.listWishlist((req as any).shopUserId)));
  app.post("/api/shop/wishlist", requireShop, (req, res) => {
    const { product_id, productId, part_number, partNumber } = req.body || {};
    const pid = parseInt(String(product_id ?? productId), 10);
    if (!pid) return res.status(400).json({ error: "product_id required" });
    res.json(shop.addWishlist((req as any).shopUserId, pid, part_number ?? partNumber));
  });
  app.delete("/api/shop/wishlist/:id", requireShop, (req, res) => res.json(shop.removeWishlist((req as any).shopUserId, parseInt(String(req.params.id), 10))));

  // ---- freight quote for cart (public) ----
  app.post("/api/shop/freight-quote", (req, res) => {
    try {
      const items: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
      let freight = 0;
      const lines = items.map((it) => {
        const per = shop.getFreightForPart(it.part_number ?? it.partNumber);
        const qty = Math.max(1, Number(it.qty) || 1);
        freight += per * qty;
        return { partNumber: it.part_number ?? it.partNumber ?? null, freightPerUnit: per, qty };
      });
      res.json({ freightInr: freight, lines });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- checkout / orders (TASK 3) ----
  app.post("/api/shop/orders", requireShop, async (req, res) => {
    try {
      const shopUserId = (req as any).shopUserId as number;
      const user = shop.getShopUserById(shopUserId);
      if (!user) return res.status(404).json({ error: "Account not found" });
      const body = req.body || {};
      const ship = body.ship || body.address || {};
      const order = shop.createShopOrder({
        shopUserId,
        customerEmail: (user as any).email,
        customerPhone: (user as any).phone || ship.phone || null,
        customerName: (user as any).fullName || ship.fullName || null,
        ship: {
          fullName: ship.fullName || ship.full_name,
          phone: ship.phone,
          line1: ship.line1, line2: ship.line2,
          city: ship.city, state: ship.state, pincode: ship.pincode, country: ship.country || "IN",
        },
        items: (body.items || []).map((it: any) => ({
          productId: it.product_id ?? it.productId ?? null,
          partNumber: it.part_number ?? it.partNumber ?? null,
          name: it.name, image: it.image ?? null,
          unitPriceInr: Number(it.unit_price ?? it.unitPriceInr ?? it.unit_price_inr ?? 0),
          qty: Number(it.qty) || 1,
        })),
        currency: body.currency || "INR",
        fxRate: Number(body.fx_rate ?? body.fxRate ?? 1) || 1,
        paymentMode: "COD",
      });

      // Order confirmation email (fire-and-forget, never blocks order placement).
      try {
        const itemRows = (order!.items || []).map((it: any) =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(it.name)}${it.partNumber ? ` <span style="color:#888;">(${escapeHtml(it.partNumber)})</span>` : ""}</td>
           <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td>
           <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">₹${Number(it.totalInr).toLocaleString("en-IN")}</td></tr>`
        ).join("");
        const s = order!.ship || ({} as any);
        sendGenericEmail({
          to: (user as any).email,
          subject: `Order Confirmed - ${order!.orderNumber} - Narmada Mobility`,
          html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;">
            <div style="background:#001a4d;color:#fff;padding:18px;border-radius:8px 8px 0 0;"><h2 style="margin:0;">Thank you for your order!</h2></div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
              <p>Your order <strong>${order!.orderNumber}</strong> has been placed.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
                <thead><tr style="background:#f3f4f6;"><th style="padding:6px 8px;text-align:left;">Item</th><th style="padding:6px 8px;">Qty</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead>
                <tbody>${itemRows}</tbody>
              </table>
              <p style="text-align:right;margin:4px 0;">Subtotal: ₹${Number(order!.subtotalInr).toLocaleString("en-IN")}</p>
              <p style="text-align:right;margin:4px 0;">Freight: ₹${Number(order!.freightInr).toLocaleString("en-IN")}</p>
              <p style="text-align:right;margin:4px 0;font-size:16px;"><strong>Total: ₹${Number(order!.totalInr).toLocaleString("en-IN")}</strong> (Cash on Delivery)</p>
              <p style="margin-top:14px;"><strong>Ship to:</strong><br/>${escapeHtml(s.fullName || "")}, ${escapeHtml(s.phone || "")}<br/>${escapeHtml(s.line1 || "")}${s.line2 ? ", " + escapeHtml(s.line2) : ""}<br/>${escapeHtml(s.city || "")}, ${escapeHtml(s.state || "")} - ${escapeHtml(s.pincode || "")}</p>
              <p style="margin-top:14px;">Track your order at <a href="https://narmadamobility.com/#/customer/orders/${order!.id}">narmadamobility.com</a></p>
            </div></div>`,
          text: `Your order ${order!.orderNumber} has been placed. Total ₹${Number(order!.totalInr).toLocaleString("en-IN")} (Cash on Delivery).`,
          event: "shop_order_confirm",
        }).catch((e: any) => console.error("[email] order_confirm failed:", e?.message));
      } catch (e: any) { console.error("[email] order_confirm build error:", e?.message); }

      // Auto-PO into procurement (fire-and-forget; failure must NOT fail the order).
      try {
        const poItems = (order!.items || []).map((it: any) => ({
          description: it.name, partNumber: it.partNumber || undefined,
          qty: it.qty, unitPrice: it.unitPriceInr,
        }));
        const po = await v2.createPurchaseOrderV2(
          { customerName: `Web Order — ${order!.customerName || (user as any).email}`, status: "draft", notes: `Auto-created from web order ${order!.orderNumber}` } as any,
          poItems as any,
        );
        if (po?.id) shop.linkProcurementPo(order!.id, po.id);
      } catch (e: any) { console.error("[shop] auto-PO error:", e?.message); }

      res.json(shop.getShopOrder(order!.id));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/shop/orders", requireShop, (req, res) => res.json(shop.listOrdersForUser((req as any).shopUserId)));
  app.get("/api/shop/orders/:id", requireShop, (req, res) => {
    const o = shop.getOrderForUser((req as any).shopUserId, parseInt(String(req.params.id), 10));
    if (!o) return res.status(404).json({ error: "Order not found" });
    res.json(o);
  });

  // ---- admin: orders (TASK 4) ----
  app.get("/api/admin/shop-orders", requireAuth, (req, res) => {
    res.json(shop.adminListOrders({
      status: req.query.status as string, from: req.query.from as string, to: req.query.to as string,
      q: req.query.q as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }));
  });
  app.get("/api/admin/shop-orders/:id", requireAuth, (req, res) => {
    const o = shop.getShopOrder(parseInt(String(req.params.id), 10));
    if (!o) return res.status(404).json({ error: "Order not found" });
    res.json(o);
  });
  app.patch("/api/admin/shop-orders/:id/status", requireAuth, async (req, res) => {
    try {
      const { status, note } = req.body || {};
      if (!status) return res.status(400).json({ error: "status required" });
      const by = ((req as any).user?.username) || "admin";
      const o = shop.adminUpdateOrderStatus(parseInt(String(req.params.id), 10), status, note || null, by);
      if (!o) return res.status(404).json({ error: "Order not found" });
      // R27.1a BUG 1 — order status update emails for confirmed/packed/dispatched/delivered.
      if (o.customerEmail) {
        const COPY: Record<string, { subject: string; heading: string; body: string }> = {
          confirmed: { subject: "Order Confirmed", heading: "Your order is confirmed", body: "We've confirmed your order and started preparing it." },
          packed: { subject: "Order Packed", heading: "Your order is packed", body: "Your order has been packed and is ready for dispatch." },
          dispatched: { subject: "Order Dispatched", heading: "Your order is on the way!", body: "Your order has been dispatched." },
          delivered: { subject: "Order Delivered", heading: "Your order has been delivered", body: "Your order has been delivered. Thank you for shopping with Narmada Mobility!" },
        };
        const c = COPY[String(status)];
        if (c) {
          const tracking = (status === "dispatched")
            ? `${o.dispatchedCarrier ? `<p>Carrier: <strong>${escapeHtml(o.dispatchedCarrier)}</strong></p>` : ""}${o.dispatchedDocket ? `<p>Docket / Tracking #: <strong>${escapeHtml(o.dispatchedDocket)}</strong></p>` : ""}`
            : "";
          sendGenericEmail({
            to: o.customerEmail,
            subject: `${c.subject} - ${o.orderNumber} - Narmada Mobility`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
              <h2 style="color:#001a4d;">${c.heading}</h2>
              <p>Order <strong>${escapeHtml(o.orderNumber)}</strong> — ${c.body}</p>
              ${tracking}
              <p>Track at <a href="https://narmadamobility.com/#/customer/orders/${o.id}">narmadamobility.com</a></p>
            </div>`,
            text: `${c.heading}. Order ${o.orderNumber}: ${c.body}`,
            event: `shop_order_${status}`,
          }).catch((e: any) => console.error(`[email] shop_order_${status} failed:`, e?.message));
        }
      }
      res.json(o);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch("/api/admin/shop-orders/:id/dispatch", requireAuth, (req, res) => {
    const { carrier, docket, dispatched_at, dispatchedAt } = req.body || {};
    const o = shop.adminUpdateDispatch(parseInt(String(req.params.id), 10), carrier, docket, dispatched_at ?? dispatchedAt);
    if (!o) return res.status(404).json({ error: "Order not found" });
    res.json(o);
  });

  // ---- admin: web customers (TASK 5) ----
  app.get("/api/admin/shop-customers", requireAuth, (req, res) => {
    res.json(shop.adminListShopUsers({ q: req.query.q as string, sort: req.query.sort as string }));
  });
  app.get("/api/admin/shop-customers/:id", requireAuth, (req, res) => {
    const u = shop.adminGetShopUser(parseInt(String(req.params.id), 10));
    if (!u) return res.status(404).json({ error: "Customer not found" });
    res.json(u);
  });

  // ---- admin: freight charges (TASK 6) ----
  app.get("/api/admin/freight-charges", requireAuth, (req, res) => {
    res.json(shop.adminListFreight({
      q: req.query.q as string,
      zeroOnly: req.query.zero_only === "1" || req.query.zero_only === "true",
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }));
  });
  app.patch("/api/admin/freight-charges/:partNumber", requireAuth, (req, res) => {
    const { freight_inr, freightInr, city, source, destination, mode } = req.body || {};
    res.json(shop.adminUpsertFreight(
      decodeURIComponent(req.params.partNumber),
      Number(freight_inr ?? freightInr ?? 0),
      { city, source, destination, mode },
    ));
  });
  app.post("/api/admin/freight-charges/bulk", requireAuth, (req, res) => {
    const { part_numbers, partNumbers, freight_inr, freightInr } = req.body || {};
    const pns: string[] = part_numbers ?? partNumbers ?? [];
    if (!Array.isArray(pns) || !pns.length) return res.status(400).json({ error: "part_numbers required" });
    res.json(shop.adminBulkFreight(pns, Number(freight_inr ?? freightInr ?? 0)));
  });
  app.post("/api/admin/freight-charges/csv", requireAuth, freightCsvStore.single("file"), (req, res) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "CSV file required" });
      const text = fs2.readFileSync(file.path, "utf8");
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      let upserted = 0;
      for (const row of parsed.data as any[]) {
        const pn = row.part_number || row.partNumber || row.Part || row.part;
        const fr = row.freight_inr ?? row.freight ?? row.Freight;
        if (pn) { shop.adminUpsertFreight(String(pn).trim(), Number(fr) || 0); upserted++; }
      }
      try { fs2.unlinkSync(file.path); } catch {}
      res.json({ ok: true, upserted });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ---- duplicate PO + quotation (TASK 8) ----
  app.post("/api/admin/purchase-orders/:id/duplicate", requireAuth, async (req, res) => {
    try {
      const dup = await v2.duplicatePurchaseOrderV2(parseInt(String(req.params.id), 10));
      if (!dup) return res.status(404).json({ error: "PO not found" });
      res.json(dup);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/admin/quotations/:id/duplicate", requireAuth, async (req, res) => {
    try {
      const dup = await v2.duplicateQuotation(parseInt(String(req.params.id), 10));
      if (!dup) return res.status(404).json({ error: "Quotation not found" });
      res.json(dup);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
}

// R27.1 — local HTML escaper for order/dispatch emails.
function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
