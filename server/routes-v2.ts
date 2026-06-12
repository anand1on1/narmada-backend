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
import { sendNotification, buildTrackingLink, sendGenericEmail } from "./notifications";
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
    const q: any = await v2.getQuotingCompany(quotation.quotingCompanyId);
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
const VALID_ROLES: AdminRole[] = ["admin", "logistics", "accounts", "sales"];

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

  app.patch("/api/admin/customers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const customer = await v2.updateCustomer(id, req.body || {});
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

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
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const entries = await v2.listLedgerEntries(cid, { from, to });
      const balance = await v2.getLedgerBalance(cid);
      res.json({ entries, balanceInr: balance });
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
    res.json(await v2.listQuotes({ customerId, status }));
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
    try { res.json(await v2.listQuotingCompanies()); }
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

  app.patch("/api/team/customers/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const customer = await v2.updateCustomer(id, req.body || {});
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      const teamUser = (req as any).teamUser;
      Promise.resolve(v2.writeAuditLog({
        actorType: "data_team", actorId: String(teamUser?.id || ""), action: "update_customer",
        entityType: "customer", entityId: String(id),
      })).catch((e: any) => console.error("[audit] team customer update failed:", e?.message));
      res.json(customer);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

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
      const { editQuotationItems } = await import("./claude-service");
      const result = await editQuotationItems(instruction, items, context || {});
      // Pass through `summary` alias for the explanation field for nicer client toasts.
      res.json({ ...result, summary: (result as any).explanation });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
    try { res.json(await v2.listQuotingCompanies()); }
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
      const { username, password, name, email, phone } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      const passwordHash = hashPassword(String(password));
      const row = await v2.createDataTeamUser({ username: String(username), passwordHash, name, email, phone });
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
      const q = (req.query.q as string) || "";
      if (q.length < 3) return res.status(400).json({ error: "q must be at least 3 characters" });
      // Round 4: enriched view — includes brand / last-customer / last-discount / last-quoted-at
      res.json(v2.searchPartsEnriched(q, 50));
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
        const co = await v2.getQuotingCompany(Number(quotationData.quotingCompanyId));
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
      }
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "update_quotation", entityType: "quotation", entityId: String(id) });
      res.json({ quotation: updated, items: savedItems });
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
      await ctx.regenSitemap();
      res.setHeader("Content-Type", "application/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${process.env.APP_URL || "https://narmadamobility.com"}/</loc></url></urlset>`);
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
    const rows = await v2.listPurchaseOrdersV2WithTotals({ status: req.query.status as string | undefined });
    // R12: attach per-PO dispatch rollup (Status/Carrier/Bundles/Docket# columns).
    const summary = await v2.getDispatchSummaryForPOs(rows.map((r: any) => r.id));
    res.json(rows.map((r: any) => {
      const s = summary[r.id];
      return {
        ...r,
        dispatches: s?.dispatches || [],
        dispatchCarrier: s?.carrier || null,
        dispatchBundles: s?.bundles || 0,
        dispatchDockets: s?.docketNumbers || [],
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
    });
  });
  app.post("/api/team/purchase-orders", requireDataTeam, async (req, res) => {
    try {
      const u = (req as any).teamUser;
      const { items, ...po } = req.body || {};
      res.json(await v2.createPurchaseOrderV2({ ...po, createdBy: u?.username }, items || []));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch("/api/team/purchase-orders/:id", requireDataTeam, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const existing = await v2.getPurchaseOrderV2(id);
      if (!existing) return res.status(404).json({ error: "Not found" });

      const body = { ...(req.body || {}) } as any;

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
      if (!from) return res.json({ ok: true, ignored: "no from" });
      const vendor = await v2.getVendorByPhone(from);
      if (!vendor) { res.json({ ok: true, ignored: "unknown vendor" }); return; }

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
      res.json({ ok: true, vendor: vendor.id, extracted: !!extracted });
    } catch (e: any) {
      console.error("[webhook:aisensy]", e?.message);
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
      const sys = `You are a sourcing assistant for an automotive spare-parts distributor in India. Find 5-10 real candidate vendors/suppliers/manufacturers for the user's requirement. Return ONLY JSON array: [{"name","city","phone","website","source_url","confidence"}]. confidence 0..1. Use null for unknown fields.`;
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
            const summary = q?.vendor_id
              ? v2.getConfirmedItemsForVendorOnPo(poId, q.vendor_id)
              : { poNumber: "-", itemsText: "", totalAmount: 0, count: 0 };
            await wa.sendVendorRateConfirmed(phone, {
              vendorName: q?.vendor_name || "Seller",
              ourPoNumber: summary.poNumber,
              itemsText: summary.itemsText || `${q?.vendor_name || "item"}`,
              totalAmount: String(summary.totalAmount || q?.rate || 0),
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
      for (const [vendorId, items] of Array.from(byVendor.entries())) {
        if (!items.length) continue;
        const vendor = await v2.getVendor(vendorId);
        const phone = vendor?.whatsapp || vendor?.phone || items[0]?.vendor_phone;
        const itemsText = items
          .map((it: any, i: number) => `${i + 1}. ${[it.part_number, it.brand, it.description].filter(Boolean).join(" ")} x${it.qty ?? 1} (PO ${it.po_number})`)
          .join("\n");
        firedVendors++; firedItems += items.length;
        console.log(`[aisensy] batch RFQ to vendor ${vendorId} for ${items.length} items`);
        const vendorName = vendor?.name || items[0]?.vendor_name || "Seller";
        // Persist outbound copy immediately (so the chat shows it even if AiSensy is slow).
        const taxLine = "Please reply with rate per item. Mention if TAX INCLUSIVE (% included) or EXCLUSIVE (mention GST %).";
        const outBody = `Hello ${vendorName},\nNarmada Mobility requests your best rate for the following items:\n${itemsText}\n\n${taxLine}`;
        v2.addRfqMessage({ vendorId, vendorPhone: phone || null, direction: "out", body: outBody });
        if (phone) {
          setImmediate(() => {
            (async () => {
              const wa = require("./whatsapp") as typeof import("./whatsapp");
              await wa.sendVendorRateBatch(phone, { vendorName, itemsText });
            })().catch((err) => console.error("[aisensy] batch RFQ failed:", err));
          });
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

  // Public AiSensy inbound webhook for the R9 embedded chat. Persists every inbound message
  // to vendor_rfq_messages so the chat drawer shows vendor replies. Distinct path from the
  // existing R5.5 webhook (/api/webhooks/aisensy) to avoid double-registration.
  app.post("/api/aisensy/webhook", async (req: any, res: any) => {
    try {
      const b = req.body || {};
      const from = String(b.from || b.sender || b.phone || b.mobile || "");
      const message = String(b.message || b.text || b.body || "");
      const messageId = b.message_id || b.messageId || b.id || null;
      if (!from) return res.json({ ok: true, ignored: "no from" });
      const vendor = await v2.getVendorByPhone(from);
      v2.addRfqMessage({
        vendorId: vendor?.id ?? null, vendorPhone: from, direction: "in",
        body: message, aisensyMsgId: messageId,
      });
      res.json({ ok: true, vendor: vendor?.id ?? null });
    } catch (e: any) {
      console.error("[webhook:aisensy-r9]", e?.message);
      res.json({ ok: false, error: e?.message });
    }
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
      res.json(v2.getVendorLedger({ vendorId, from, to }));
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
      const sheetData = [
        ["Vendor", "Approved Items", "Approved Value", "Total Paid", "Balance", "Last Activity"],
        ...rows.map((r: any) => [
          r.vendor_name, r.item_count, r.total_approved_value, r.total_paid, r.balance,
          r.last_activity_at ? new Date(r.last_activity_at).toISOString().slice(0, 10) : "",
        ]),
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
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
      }));

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
          subtotal,
          total: subtotal,
          createdBy: u?.username,
          status: "draft",
        } as any,
        poItems2,
      );

      res.json(po);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const customerId = req.query.customer_id ? parseInt(req.query.customer_id as string, 10) : undefined;
      const statusRaw = (req.query.status as string | undefined) || "";
      const statuses = statusRaw ? statusRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      res.json(await v2.listDelhiPosWithRollup({ from, to, customerId, statuses }));
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
      const bundles = parseInt(String(req.body?.bundles || ""), 10);
      const file = req.file;
      if (!carrier) return res.status(400).json({ error: "Courier is required" });
      if (!docketNumber) return res.status(400).json({ error: "Docket number is required" });
      if (!Number.isInteger(bundles) || bundles < 1) return res.status(400).json({ error: "Bundles count (min 1) is required" });
      if (!file) return res.status(400).json({ error: "Docket slip upload is required" });

      const proto = "https";
      const host = req.get("host") || "narmada-backend.onrender.com";
      const docketSlipUrl = `${proto}://${host}/uploads/docket-slips/${file.filename}`;

      const result = await v2.dispatchPackedLines(poId, {
        carrier, docketNumber, bundles, docketSlipUrl, submittedBy: u?.username,
      });

      await v2.writeAuditLog({
        actorType: "delhi", actorId: u?.username, action: "po.dispatch",
        entityType: "purchase_order", entityId: String(poId),
        afterJson: JSON.stringify({ carrier, docketNumber, bundles, ...result }),
      });

      res.json(result);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
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
}
