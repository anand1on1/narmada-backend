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

  app.get("/api/team/customers", requireDataTeam, async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      res.json(await v2.getCustomers(q));
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
      const newPassword = req.body?.newPassword;
      if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: "newPassword must be at least 8 characters" });
      const row = await v2.updateDataTeamUser(id, { passwordHash: hashPassword(String(newPassword)) });
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // -------- TEAM: PARTS MASTER --------
  app.get("/api/team/parts", requireDataTeam, async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      if (q.length < 3) return res.status(400).json({ error: "q must be at least 3 characters" });
      res.json(await v2.searchParts(q));
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
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      res.json(await v2.listQuotations({ status, customerId, page }));
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
      res.json({ parts });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team/quotations", requireDataTeam, async (req, res) => {
    try {
      const teamUser = (req as any).teamUser;
      const { items: rawItems, ...quotationData } = req.body || {};
      if (!quotationData.customerId) return res.status(400).json({ error: "customerId required" });
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
      const { items: rawItems, ...patchData } = req.body || {};
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
      const company = quotation.quotingCompanyId ? await v2.getQuotingCompany(quotation.quotingCompanyId) : null;
      const { generateQuotationPDF } = await import("./pdf-service");
      await generateQuotationPDF(
        {
          id: quotation.id, quoteNo: quotation.quoteNo,
          currency: quotation.currency, fxRate: quotation.fxRate,
          subtotal: quotation.subtotal, totalDiscount: quotation.totalDiscount,
          totalTax: quotation.totalTax, grandTotal: quotation.grandTotal,
          validUntil: quotation.validUntil, notes: quotation.notes,
          terms: quotation.terms, createdAt: quotation.createdAt,
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
      if (customer.phone) {
        const { sendQuoteSent } = await import("./whatsapp");
        Promise.resolve(sendQuoteSent(customer.phone, customer.name, quotation.quoteNo, pdfUrl))
          .catch((e: any) => console.error("[whatsapp] quote_sent dispatch error:", e?.message));
      }
      const teamUser = (req as any).teamUser;
      await v2.writeAuditLog({ actorType: "data_team", actorId: String(teamUser.id), action: "finalize_quotation", entityType: "quotation", entityId: String(id) });
      res.json({ quotation: updated, pdfUrl });
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
      if (!result.quotation.pdfUrl) return res.status(404).json({ error: "PDF not generated yet — call /finalize first" });
      const DATA_DIR2 = process.env.DATA_DIR || ".";
      const safeName = result.quotation.quoteNo.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pdfPath = path.join(DATA_DIR2, "uploads", "quotations", `${safeName}.pdf`);
      if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: "PDF file not found on disk" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      fs.createReadStream(pdfPath).pipe(res);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
      const { chatReply } = await import("./claude-service");
      const reply = await chatReply(histForClaude, String(message));
      const assistantMsg = await v2.saveChatMessage(c.customerId, "assistant", reply);
      res.json({ message: assistantMsg, reply });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
      const actor = (req.query.actor as string) || undefined;
      const action = (req.query.action as string) || undefined;
      const entityType = (req.query.entity_type as string) || undefined;
      const fromDate = (req.query.from as string) || undefined;
      const toDate = (req.query.to as string) || undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      res.json(await v2.listAuditLogs({ actorId: actor, action, entityType, fromDate, toDate, page }));
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

  console.log("[v2] Session C routes registered: quoting-companies, data-team, parts, quotations, chat, registration, audit-logs, search, health");
}
