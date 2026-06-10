import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { insertProductSchema, insertContactSchema } from "@shared/schema";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import Papa from "papaparse";
import { sendContactEmail } from "./email";
import { registerBulkRoutes } from "./bulk";
import { registerV2Routes, TokenMap, persistAdminSession, rehydrateSession, deleteAdminSession } from "./routes-v2";
import type { AdminRole } from "@shared/schema";

const ADMIN_USERNAME = "narmadamobility123";
const ADMIN_PASSWORD = "Carbounty@123";
// Accept multiple passwords to make login more forgiving (typos, autofill, etc.)
const ADMIN_PASSWORDS_ACCEPTED = [
  "Carbounty@123",
  "carbounty@123",
  "CARBOUNTY@123",
  "Mausami@@2026 ",  // legacy with trailing space
  "Mausami@@2026",   // legacy without trailing space
];
const SALES_EMAIL = "sales@Narmadamobility.com";
const WHATSAPP_NUMBER = "7909083806";

// Brand + category lists (mirror client/src/data/brands.ts at minimum for sitemap)
const BRAND_SLUGS = ["tata", "bharatbenz", "ashok-leyland", "eicher", "volvo"];
const CATEGORY_SLUGS = [
  "engine-parts", "dozer-urea", "clutch", "brake-system", "suspension",
  "transmission", "differential", "electrical", "filters", "turbocharger",
  "cooling", "hydraulic", "undercarriage", "cabin-body", "fuel-system",
];
const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
  "Uttarakhand","West Bengal","Delhi","Jammu and Kashmir","Ladakh","Puducherry",
  "Chandigarh","Andaman and Nicobar Islands","Dadra and Nagar Haveli and Daman and Diu","Lakshadweep",
];
const COUNTRIES = [
  "Kenya","Nigeria","Uganda","Tanzania","Mozambique","South Africa","Ghana","Ethiopia",
  "Zambia","Zimbabwe","Angola","Senegal","Ivory Coast","Egypt","Morocco","Algeria",
  "Sudan","Cameroon","Rwanda","Botswana","United Arab Emirates","Saudi Arabia","Oman",
  "Qatar","Kuwait","Bahrain","Iraq","Iran","Jordan","Lebanon","Yemen","Sri Lanka",
  "Bangladesh","Nepal","Bhutan","Myanmar","Vietnam","Indonesia","Malaysia","Philippines",
  "Thailand","Singapore","Russia","Kazakhstan","Uzbekistan","Belarus","Ukraine","Azerbaijan",
  "United States","Mexico","Brazil","Argentina","Colombia","Peru","Chile","Canada",
  "Australia","New Zealand","Germany","Netherlands","Turkey",
];

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Module-scope so routes-v2.ts can also call this via the regenSitemap callback
function buildSitemapUrls(allProducts: Awaited<ReturnType<typeof storage.listProducts>>, baseUrl: string): string[] {
  const urls: string[] = [];
  const add = (loc: string, priority = "0.6", changefreq = "weekly") => {
    urls.push(`  <url><loc>${baseUrl}${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`);
  };
  add("/", "1.0", "daily");
  add("/products", "0.9", "daily");
  add("/about", "0.7");
  add("/contact", "0.7");
  add("/work-with-us", "0.6");
  add("/privacy", "0.4", "yearly");
  add("/disclaimer", "0.4", "yearly");
  add("/blog", "0.8", "daily");
  add("/price-checker", "0.8", "weekly");
  add("/track-consignment", "0.6", "monthly");
  for (const b of BRAND_SLUGS) add(`/brand/${b}`, "0.9", "weekly");
  for (const c of CATEGORY_SLUGS) add(`/category/${c}`, "0.8", "weekly");
  for (const b of BRAND_SLUGS) {
    for (const s of INDIAN_STATES) add(`/${b}-spare-parts-${toSlug(s)}`, "0.7");
  }
  for (const b of BRAND_SLUGS) {
    for (const c of COUNTRIES) add(`/${b}-spare-parts-${toSlug(c)}`, "0.7");
  }
  for (const p of allProducts) {
    if (p.active) add(`/product/${p.slug}`, "0.6");
  }
  return urls;
}

// --- Session token map shared across routes.ts + routes-v2.ts ---
// Maps token → { username, role, displayName }. Role gates v2 endpoints; legacy
// endpoints only check token presence (effectively admin-equivalent since old
// system only had one user).
const adminTokens: TokenMap = new Map();
function issueToken(username: string, role: AdminRole = "admin", displayName?: string): string {
  const t = randomBytes(32).toString("hex");
  const info = { username, role, displayName };
  adminTokens.set(t, info);
  // Session A V2: persist to DB so token survives Render restarts
  persistAdminSession(t, info).catch(() => {});
  return t;
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers["x-admin-token"] as string) || "";
  let info = adminTokens.get(token);
  // Session A V2: try DB rehydration if not in memory
  if (!info && token) {
    const rehydrated = rehydrateSession(adminTokens, token);
    if (rehydrated) info = rehydrated;
  }
  if (!info) return res.status(401).json({ error: "Unauthorized" });
  // Legacy endpoints: only "admin" role is allowed (other roles use v2 endpoints)
  if (info.role !== "admin") return res.status(403).json({ error: "Admin role required" });
  (req as any).user = info;
  next();
}

// --- Uploads dir ---
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const PUBLIC_DIR = path.resolve(process.cwd(), "public-runtime");
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Serve uploaded images
  app.use("/uploads", express.static(UPLOADS_DIR));

  // -------- AUTH --------
  app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body || {};
    // Try primary admin first
    // Trim whitespace and check against multiple accepted passwords
    const trimmedUsername = (username || "").trim();
    const trimmedPassword = (password || "").trim();
    const passwordMatch = ADMIN_PASSWORDS_ACCEPTED.some(
      p => p.trim() === trimmedPassword
    );
    if (trimmedUsername === ADMIN_USERNAME.trim() && passwordMatch) {
      const token = issueToken(ADMIN_USERNAME, "admin");
      return res.json({ token, username: ADMIN_USERNAME, role: "admin" });
    }
    // Try DB users via v2 helpers
    try {
      const v2 = await import("./storage-v2");
      const { verifyPassword } = await import("./routes-v2");
      const user = await v2.getAdminUserByUsername(username);
      if (user && user.active && verifyPassword(password, user.passwordHash)) {
        const validRoles: AdminRole[] = ["admin", "logistics", "accounts", "sales"];
        const role = (validRoles.includes(user.role as AdminRole) ? user.role : "admin") as AdminRole;
        const token = issueToken(user.username, role, user.displayName || undefined);
        return res.json({ token, username: user.username, role, displayName: user.displayName });
      }
    } catch (e) { console.error("DB user check failed:", e); }
    return res.status(401).json({ error: "Invalid credentials" });
  });
  app.post("/api/admin/logout", (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    if (token) {
      adminTokens.delete(token);
      deleteAdminSession(token);
    }
    res.json({ ok: true });
  });
  app.get("/api/admin/me", (req, res) => {
    const token = (req.headers["x-admin-token"] as string) || "";
    let info = adminTokens.get(token);
    if (!info && token) {
      const rehydrated = rehydrateSession(adminTokens, token);
      if (rehydrated) info = rehydrated;
    }
    if (!info) return res.status(401).json({ error: "Unauthorized" });
    res.json({ ok: true, username: info.username, role: info.role, displayName: info.displayName });
  });

  // -------- PUBLIC: settings (USD/INR) --------
  app.get("/api/settings/fx", async (_req, res) => {
    const rate = (await storage.getSetting("usd_inr_rate")) || "83.5";
    res.json({ usdInr: parseFloat(rate) });
  });

  // -------- PUBLIC: meta (whatsapp, email) --------
  app.get("/api/site/meta", async (_req, res) => {
    res.json({
      whatsapp: WHATSAPP_NUMBER,
      salesEmail: SALES_EMAIL,
      address: "J-157, J Sector, Kankarbagh, Patna-800020, Bihar, India",
    });
  });

  // -------- PRODUCTS (public) --------
  app.get("/api/products", async (req, res) => {
    const { brand, category, q, featured } = req.query;
    const list = await storage.listProducts({
      brand: typeof brand === "string" ? brand : undefined,
      category: typeof category === "string" ? category : undefined,
      q: typeof q === "string" ? q : undefined,
      featured: featured === "1" || featured === "true",
      activeOnly: true,
    });
    res.json(list);
  });
  app.get("/api/products/:slug", async (req, res) => {
    const p = await storage.getProductBySlug(req.params.slug);
    if (!p || !p.active) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });

  // -------- PRODUCTS (admin) --------
  app.get("/api/admin/products", requireAdmin, async (_req, res) => {
    res.json(await storage.listProducts({}));
  });
  app.post("/api/admin/products", requireAdmin, async (req, res) => {
    try {
      const body = { ...req.body };
      // ensure slug
      if (!body.slug && body.name) body.slug = toSlug(body.name);
      // ensure arrays are strings
      if (Array.isArray(body.imageUrls)) body.imageUrls = JSON.stringify(body.imageUrls);
      if (Array.isArray(body.compatibleModels)) body.compatibleModels = JSON.stringify(body.compatibleModels);
      const parsed = insertProductSchema.parse(body);
      const created = await storage.createProduct(parsed);
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Invalid payload", details: e.errors });
    }
  });
  app.patch("/api/admin/products/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      const body = { ...req.body };
      if (Array.isArray(body.imageUrls)) body.imageUrls = JSON.stringify(body.imageUrls);
      if (Array.isArray(body.compatibleModels)) body.compatibleModels = JSON.stringify(body.compatibleModels);
      const updated = await storage.updateProduct(id, body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
    await storage.deleteProduct(parseInt(req.params.id as string, 10));
    res.json({ ok: true });
  });

  // -------- BULK PRODUCT UPLOAD (admin) --------
  registerBulkRoutes(app, requireAdmin);

  // -------- IMAGE UPLOAD (admin) --------
  // Accepts base64 data URL or raw base64 string and writes to /uploads/<id>.<ext>
  app.post("/api/admin/upload-image", requireAdmin, async (req, res) => {
    try {
      const { dataUrl, filename } = req.body || {};
      if (!dataUrl) return res.status(400).json({ error: "Missing dataUrl" });
      const match = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(dataUrl);
      let ext = "png", b64 = dataUrl;
      if (match) { ext = match[1].split("/")[1].replace("jpeg", "jpg"); b64 = match[2]; }
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: "Image too large (max 8MB)" });
      const id = randomBytes(8).toString("hex");
      const base = filename ? toSlug(filename.replace(/\.[^.]+$/, "")) : id;
      const finalName = `${base}-${id}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, finalName), buf);
      // Return absolute URL so frontend on different domain (GoDaddy) can load images from Render
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const host = req.get('host');
      const absoluteUrl = `${proto}://${host}/uploads/${finalName}`;
      res.json({ url: absoluteUrl, path: `/uploads/${finalName}` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- CONTACT FORM --------
  app.post("/api/contact", async (req, res) => {
    try {
      const parsed = insertContactSchema.parse(req.body);
      const created = await storage.createContact(parsed);
      const mail = await sendContactEmail({
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone || null,
        country: parsed.country || null,
        subject: parsed.subject || null,
        productInterest: parsed.productInterest || null,
        message: parsed.message,
      });
      console.log(`[contact] #${created.id} from ${parsed.email} — email: ${mail.ok ? "sent" : "not sent (" + mail.via + (mail.error ? ": " + mail.error : "") + ")"}`);
      res.json({ ok: true, id: created.id, deliveredTo: SALES_EMAIL, emailSent: mail.ok });
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.get("/api/admin/contacts", requireAdmin, async (_req, res) => res.json(await storage.listContacts()));
  app.patch("/api/admin/contacts/:id", requireAdmin, async (req, res) => {
    await storage.updateContactStatus(parseInt(req.params.id as string, 10), req.body.status || "replied");
    res.json({ ok: true });
  });

  // -------- SETTINGS (admin) --------
  app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
    const rate = await storage.getSetting("usd_inr_rate");
    res.json({ usdInr: parseFloat(rate || "83.5") });
  });
  app.patch("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      const v = parseFloat(req.body.usdInr);
      if (Number.isNaN(v) || v <= 0) throw new Error("Invalid USD/INR rate");
      await storage.setSetting("usd_inr_rate", String(v));
      res.json({ ok: true, usdInr: v });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // -------- SITEMAP --------
  app.get("/sitemap.xml", async (req, res) => {
    const baseUrl = (req.protocol + "://" + req.get("host")) || "https://narmadamobility.com";
    const allProducts = await storage.listProducts({ activeOnly: true });
    const urls = buildSitemapUrls(allProducts, baseUrl);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.set("Content-Type", "application/xml").send(xml);
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: /sitemap.xml\n`);
  });

  app.post("/api/admin/sitemap/regenerate", requireAdmin, async (req, res) => {
    const baseUrl = req.body.baseUrl || "https://narmadamobility.com";
    const allProducts = await storage.listProducts({ activeOnly: true });
    const urls = buildSitemapUrls(allProducts, baseUrl);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    fs.writeFileSync(path.join(PUBLIC_DIR, "sitemap.xml"), xml);
    await storage.logSitemapRun(urls.length);
    res.json({ ok: true, urlCount: urls.length, sample: urls.slice(0, 6), xmlSize: xml.length });
  });

  app.get("/api/admin/sitemap/status", requireAdmin, async (_req, res) => {
    const last = await storage.getLatestSitemapRun();
    res.json({ last });
  });

  // Download the last generated sitemap
  app.get("/api/admin/sitemap/download", requireAdmin, (_req, res) => {
    const p = path.join(PUBLIC_DIR, "sitemap.xml");
    if (!fs.existsSync(p)) return res.status(404).json({ error: "Generate first" });
    res.download(p, "sitemap.xml");
  });

  // -------- Phase 3: CMS / Price Checker / Consignments / Sub-users / SEO helpers --------
  registerV2Routes(app, {
    tokenMap: adminTokens,
    primaryAdminUsername: ADMIN_USERNAME,
    primaryAdminPassword: ADMIN_PASSWORD,
    uploadsDir: UPLOADS_DIR,
    regenSitemap: async () => {
      const baseUrl = `https://${process.env.SITE_HOST || "narmadamobility.com"}`;
      const allProducts = await storage.listProducts({ activeOnly: true });
      const urls = buildSitemapUrls(allProducts, baseUrl);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
      fs.writeFileSync(path.join(PUBLIC_DIR, "sitemap.xml"), xml);
      await storage.logSitemapRun(urls.length);
      return { urlCount: urls.length };
    },
  });

  return httpServer;
}
