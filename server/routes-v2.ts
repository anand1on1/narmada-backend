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
    const post = await 
