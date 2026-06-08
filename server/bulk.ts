// Bulk product upload — CSV-driven upsert keyed on slug.
import type { Express, Request, Response, NextFunction } from "express";
import Papa from "papaparse";
import { storage } from "./storage";
import { insertProductSchema } from "@shared/schema";

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const HEADERS = [
  "name", "brand", "category", "model", "part_number", "oem_number",
  "price_inr", "stock_qty", "short_description", "description",
  "image_urls", "compatible_models",
  "meta_title", "meta_description", "meta_keywords", "featured", "active",
];

const SAMPLE_ROWS: string[][] = [
  [
    "Tata Prima Brake Pad Set (Front)", "tata", "brake-system", "Prima 2523/3123",
    "NM-TATA-BP-001", "278611200172", "4500", "25",
    "OEM-grade front brake pad set for Tata Prima series",
    "Genuine OEM-grade brake pad set engineered for Tata Prima 2523/3123 tractors and tippers. Asbestos-free, low-noise, 80000 km service life.",
    "https://images.unsplash.com/photo-1486006920555-c77dcf18193c|https://images.unsplash.com/photo-1486262715619-67b85e0b08d3",
    "Tata Prima 2523|Tata Prima 3123|Tata Prima 4023",
    "Tata Prima Brake Pads Front - Narmada Mobility",
    "OEM-grade brake pad set for Tata Prima 2523/3123. In stock. Worldwide shipping from Patna.",
    "tata prima brake pads, brake pad set tata, narmada mobility",
    "1", "1",
  ],
  [
    "BharatBenz Clutch Plate 350mm", "bharatbenz", "clutch", "BharatBenz 2823C",
    "NM-BB-CL-018", "6722500001", "18500", "12",
    "Heavy-duty 350mm clutch plate for BharatBenz tippers",
    "Genuine 350mm organic clutch plate compatible with BharatBenz 2823C and 3128C tippers. SAE J661 friction rating, high heat tolerance.",
    "https://images.unsplash.com/photo-1635775017492-1eb935a082a1",
    "BharatBenz 2823C|BharatBenz 3128C",
    "BharatBenz Clutch Plate 350mm - Genuine",
    "Genuine 350mm clutch plate for BharatBenz 2823C/3128C. Shipped from Patna with full warranty.",
    "bharatbenz clutch plate, 350mm clutch, narmada mobility",
    "0", "1",
  ],
  [
    "Ashok Leyland Fuel Filter (Dost+)", "ashok-leyland", "filters", "Dost+ 1.5L",
    "NM-AL-FF-204", "BS6-FF-AL-2024", "650", "60",
    "Genuine fuel filter for Ashok Leyland Dost+ BS6",
    "OEM-spec spin-on fuel filter for Ashok Leyland Dost+ 1.5L BS6 engines. 10 micron filtration. Service interval 20000 km.",
    "https://images.unsplash.com/photo-1605618826115-fb9e775cf2b3",
    "Ashok Leyland Dost+|Ashok Leyland Bada Dost",
    "Ashok Leyland Dost+ Fuel Filter BS6 - Genuine",
    "OEM fuel filter for Ashok Leyland Dost+ BS6. 10 micron. Bulk pricing for dealers and fleets.",
    "ashok leyland fuel filter, dost+ filter, narmada mobility",
    "0", "1",
  ],
];

export function registerBulkRoutes(app: Express, requireAdmin: (r: Request, s: Response, n: NextFunction) => void) {
  // GET /api/admin/bulk-template.csv — download sample template
  app.get("/api/admin/bulk-template.csv", requireAdmin, (_req, res) => {
    const csv = Papa.unparse({ fields: HEADERS, data: SAMPLE_ROWS });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="narmada-bulk-upload-template.csv"`);
    res.send(csv);
  });

  // POST /api/admin/products/bulk — body { csv: "..." }
  app.post("/api/admin/products/bulk", requireAdmin, async (req, res) => {
    try {
      const { csv, rows: rawRows } = req.body || {};
      let rows: any[] = [];
      if (typeof csv === "string" && csv.trim()) {
        const parsed = Papa.parse(csv.trim(), {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
        });
        rows = (parsed.data as any[]) || [];
      } else if (Array.isArray(rawRows)) {
        rows = rawRows;
      } else {
        return res.status(400).json({ error: "Provide csv (string) or rows (array)" });
      }

      const created: any[] = [];
      const updated: any[] = [];
      const errors: { row: number; name?: string; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        try {
          const name = String(r.name || "").trim();
          if (!name) throw new Error("name is required");
          const brand = String(r.brand || "").trim().toLowerCase();
          const category = String(r.category || "").trim().toLowerCase();
          if (!brand) throw new Error("brand is required");
          if (!category) throw new Error("category is required");

          const priceInr = parseFloat(String(r.price_inr || r.priceinr || r.price || "0").replace(/[^0-9.]/g, ""));
          if (!priceInr || priceInr <= 0) throw new Error("price_inr must be a positive number");

          const description = String(r.description || "").trim() || name;

          const imageUrlsRaw = String(r.image_urls || r.imageurls || r.images || "").trim();
          const imageUrls = imageUrlsRaw
            ? imageUrlsRaw.split(/[|,]/).map((s: string) => s.trim()).filter(Boolean)
            : [];

          const compatRaw = String(r.compatible_models || r.compatiblemodels || r.compatible || "").trim();
          const compatibleModels = compatRaw
            ? compatRaw.split(/[|,]/).map((s: string) => s.trim()).filter(Boolean)
            : [];

          const truthy = (v: any) => v === true || v === 1 || /^(1|true|yes|y)$/i.test(String(v || "").trim());

          const slug = String(r.slug || "").trim() || toSlug(name);

          const payload: any = {
            slug,
            name,
            brand,
            model: String(r.model || "").trim() || null,
            category,
            partNumber: String(r.part_number || r.partnumber || "").trim() || null,
            oemNumber: String(r.oem_number || r.oemnumber || "").trim() || null,
            description,
            shortDescription: String(r.short_description || r.shortdescription || "").trim() || null,
            priceInr,
            stockQty: parseInt(String(r.stock_qty || r.stockqty || "0"), 10) || 0,
            imageUrls: JSON.stringify(imageUrls),
            compatibleModels: JSON.stringify(compatibleModels),
            metaTitle: String(r.meta_title || r.metatitle || "").trim() || null,
            metaDescription: String(r.meta_description || r.metadescription || "").trim() || null,
            metaKeywords: String(r.meta_keywords || r.metakeywords || "").trim() || null,
            featured: truthy(r.featured),
            active: r.active === undefined || r.active === "" ? true : truthy(r.active),
          };

          // Upsert by slug — update if exists, otherwise create
          const existing = await storage.getProductBySlug(slug);
          if (existing) {
            const upd = await storage.updateProduct(existing.id, payload);
            updated.push({ id: upd?.id, slug, name });
          } else {
            const parsedNew = insertProductSchema.parse(payload);
            const cre = await storage.createProduct(parsedNew);
            created.push({ id: cre.id, slug, name });
          }
        } catch (e: any) {
          errors.push({ row: i + 2, name: r.name, error: e.message || "unknown" });
        }
      }

      res.json({
        ok: true,
        summary: { total: rows.length, created: created.length, updated: updated.length, failed: errors.length },
        created,
        updated,
        errors,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}
