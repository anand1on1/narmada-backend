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

const ADMIN_USERNAME = "narmadamobility123";
const ADMIN_PASSWORD = "Mausami@@2026 "; // exact as requested (trailing space preserved as user wrote it)
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

// --- Simple in-memory session tokens (no localStorage needed; client passes token in header) ---
const adminTokens = new Set<string>();
function issueToken(): string { const t = randomBytes(32).toString("hex"); adminTokens.add(t); return t; }
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers["x-admin-token"] as string) || "";
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
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
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = issueToken();
      return res.json({ token, username: ADMIN_USERNAME });
    }
    return res.status(401).json({ error: "Invalid credentials" });
  });
  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const token = req.headers["x-admin-token"] as string;
    adminTokens.delete(token);
    res.json({ ok: true });
  });
  app.get("/api/admin/me", requireAdmin, (_req, res) => res.json({ ok: true, username: ADMIN_USERNAME }));

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
      const id = parseInt(req.params.id, 10);
      const body = { ...req.body };
      if (Array.isArray(body.imageUrls)) body.imageUrls = JSON.stringify(body.imageUrls);
      if (Array.isArray(body.compatibleModels)) body.compatibleModels = JSON.stringify(body.compatibleModels);
      const updated = await storage.updateProduct(id, body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
    await storage.deleteProduct(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

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
      res.json({ url: `/uploads/${finalName}` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // -------- CONTACT FORM --------
  app.post("/api/contact", async (req, res) => {
    try {
      const parsed = insertContactSchema.parse(req.body);
      const created = await storage.createContact(parsed);
      // In production this would dispatch SMTP to SALES_EMAIL. We log + persist
      // so the admin sees it; the user can wire SMTP later in the admin panel.
      console.log(`[contact] new submission → ${SALES_EMAIL}`, created.id, parsed.email);
      res.json({ ok: true, id: created.id, deliveredTo: SALES_EMAIL });
    } catch (e: any) { res.status(400).json({ error: e.message, details: e.errors }); }
  });
  app.get("/api/admin/contacts", requireAdmin, async (_req, res) => res.json(await storage.listContacts()));
  app.patch("/api/admin/contacts/:id", requireAdmin, async (req, res) => {
    await storage.updateContactStatus(parseInt(req.params.id, 10), req.body.status || "replied");
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
  function buildSitemapUrls(allProducts: Awaited<ReturnType<typeof storage.listProducts>>, baseUrl: string) {
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
    for (const b of BRAND_SLUGS) add(`/brand/${b}`, "0.9", "weekly");
    for (const c of CATEGORY_SLUGS) add(`/category/${c}`, "0.8", "weekly");
    // brand x state (India SEO)
    for (const b of BRAND_SLUGS) {
      for (const s of INDIAN_STATES) add(`/${b}-spare-parts-${toSlug(s)}`, "0.7");
    }
    // brand x country (global SEO)
    for (const b of BRAND_SLUGS) {
      for (const c of COUNTRIES) add(`/${b}-spare-parts-${toSlug(c)}`, "0.7");
    }
    // products
    for (const p of allProducts) {
      if (p.active) add(`/product/${p.slug}`, "0.6");
    }
    return urls;
  }

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

  return httpServer;
}
