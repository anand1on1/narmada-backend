// R28.13 — Chassis parts → individual product pages
//
// When a chassis catalog is uploaded, every part row is upserted into `products`
// so it gets an individual /product/{partNumber}/{slug} page, a sitemap entry,
// and can be indexed by Google.
//
// Behavior:
// - Part number NOT in products → CREATE new product
//     - Price sourced from price_items (MRP), fallback to row's sell_price, else 0 + enquiry-only
//     - Stock qty = 10 (parity with auto-publish rule)
//     - active = 1 IF price > 0, else 0 (draft/enquiry mode until admin fixes price)
//     - compatibleModels = ["<chassis display name>"]
// - Part number ALREADY in products → UPDATE only compatibleModels (append this chassis)
//     - Price / stock / active / images / description NOT touched
//     - This preserves any manual admin edits and matches user's "already present
//       product the chassis number and model details would have been updated in
//       the same product page" requirement verbatim.
//
// Chassis_parts rows are STILL inserted separately by the caller (backward-compat).
// This helper only handles the products-table side.

import { storage } from "./storage";
import { inferBrand, inferCategory, toSlug, round2 } from "./auto-publish";
import * as v2 from "./storage-v2";
import { getRepresentationalImage } from "./part-image-gen";

export interface ChassisMeta {
  id: number;
  displayName: string;      // "Tata LPK 3118 TC ISBe5.9 UMB BS4"
  make?: string | null;     // "TATA"
  model?: string | null;    // "LPK 3118"
  variant?: string | null;  // "BS4"
  slug: string;             // "lpk-3118-tc-isbe5-9-umb-bs4-56wb-rear-tml-bogie-susp-cab-ac"
}

export interface ChassisPartRow {
  partNumber: string;
  description: string;
  oemNumber?: string | null;
  category?: string | null;
  sellPrice?: number | null;      // if provided in the file
  purchasePrice?: number | null;  // if provided in the file
  imageUrl?: string | null;
}

export interface ChassisProductResult {
  partNumber: string;
  productId: number | null;
  action: "created" | "updated_models" | "skipped_no_part" | "error";
  priceSource?: "price_list_mrp" | "sell_price_from_row" | "enquiry_only";
  error?: string;
}

export interface ChassisProductsSummary {
  productsCreated: number;
  productsModelsUpdated: number;
  productsErrored: number;
  details: ChassisProductResult[];
}

const DEFAULT_STOCK_QTY = 10;

function parseCompatibleModels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await storage.getProductBySlug(slug)) {
    slug = `${base}-${n++}`;
    if (n > 50) return `${base}-${Date.now()}`;
  }
  return slug;
}

/**
 * Upsert a single chassis part into the products table.
 * Returns a result describing what happened. Never throws — errors are captured
 * in the result so a bad row doesn't abort the whole batch.
 */
export async function publishChassisPartAsProduct(
  chassis: ChassisMeta,
  row: ChassisPartRow,
): Promise<ChassisProductResult> {
  const partNumber = String(row.partNumber || "").trim();
  if (!partNumber) {
    return { partNumber: "(missing)", productId: null, action: "skipped_no_part" };
  }

  try {
    const description = String(row.description || partNumber).trim();
    const existing = await (storage as any).getProductByPartNumber(partNumber);

    // ---- Case 1: product exists → only append chassis to compatibleModels ----
    if (existing) {
      const current = parseCompatibleModels(existing.compatibleModels);
      const already = current.some(
        (m) => m.toLowerCase().trim() === chassis.displayName.toLowerCase().trim(),
      );
      if (already) {
        // No-op — this chassis already listed. Still counts as "updated" so the
        // admin can see coverage but we don't touch the DB row.
        return { partNumber, productId: existing.id, action: "updated_models" };
      }
      const next = [...current, chassis.displayName];
      await storage.updateProduct(existing.id, {
        compatibleModels: JSON.stringify(next),
      } as any);
      return { partNumber, productId: existing.id, action: "updated_models" };
    }

    // ---- Case 2: product does NOT exist → create it ----
    // Price sourcing:
    //   1. Look up MRP in price_items (most authoritative — customer-facing)
    //   2. Fallback to sell_price on the chassis row (if the file had one)
    //   3. Enquiry-only (priceInr = 0, active = 0)
    let priceInr = 0;
    let priceSource: ChassisProductResult["priceSource"] = "enquiry_only";
    let active = false;

    const mrpMatch = v2.lookupPartNumberMrp(partNumber);
    if (mrpMatch && mrpMatch.mrp > 0) {
      priceInr = round2(mrpMatch.mrp);
      priceSource = "price_list_mrp";
      active = true;
    } else if (row.sellPrice != null && row.sellPrice > 0) {
      priceInr = round2(Number(row.sellPrice));
      priceSource = "sell_price_from_row";
      active = true;
    }

    // Image: use row image if provided, else fetch a representational image.
    let imageUrl = String(row.imageUrl || "").trim();
    if (!imageUrl) {
      try {
        const img = await getRepresentationalImage(partNumber, description);
        imageUrl = img.url;
      } catch {
        imageUrl = "/images/placeholder-part.jpg";
      }
    }

    const inferredBrand = mrpMatch?.brand || inferBrand(description, partNumber) || chassis.make?.toLowerCase() || "other";
    const category = String(row.category || "").trim() || inferCategory(description);
    const baseSlug = toSlug(`${partNumber}-${description}`.slice(0, 80)) || toSlug(partNumber) || `part-${Date.now()}`;
    const slug = await uniqueSlug(baseSlug);

    const created = await storage.createProduct({
      slug,
      name: description || partNumber,
      brand: inferredBrand,
      model: chassis.model || null,
      category,
      partNumber,
      oemNumber: row.oemNumber || null,
      description,
      shortDescription: null,
      priceInr,
      stockQty: DEFAULT_STOCK_QTY,
      imageUrls: JSON.stringify([imageUrl]),
      compatibleModels: JSON.stringify([chassis.displayName]),
      metaTitle: `${description} - ${partNumber} | Narmada Mobility`,
      metaDescription: `Buy ${description} (part ${partNumber}) for ${chassis.displayName}. Genuine spare, ready to ship from Narmada Mobility.`,
      metaKeywords: null,
      featured: false,
      active,
    } as any);

    return {
      partNumber,
      productId: created.id,
      action: "created",
      priceSource,
    };
  } catch (e: any) {
    return {
      partNumber,
      productId: null,
      action: "error",
      error: e?.message || String(e),
    };
  }
}

/**
 * Batch helper — call after a chassis parts bulk upload completes.
 * Iterates rows serially so image generation calls don't stampede.
 * Never throws.
 */
export async function publishChassisPartsBatch(
  chassis: ChassisMeta,
  rows: ChassisPartRow[],
): Promise<ChassisProductsSummary> {
  const details: ChassisProductResult[] = [];
  let productsCreated = 0;
  let productsModelsUpdated = 0;
  let productsErrored = 0;

  for (const row of rows) {
    const r = await publishChassisPartAsProduct(chassis, row);
    details.push(r);
    if (r.action === "created") productsCreated++;
    else if (r.action === "updated_models") productsModelsUpdated++;
    else if (r.action === "error") productsErrored++;
  }

  console.log("[chassis-to-products] batch done:", {
    chassisId: chassis.id,
    chassisSlug: chassis.slug,
    total: rows.length,
    productsCreated,
    productsModelsUpdated,
    productsErrored,
  });

  return { productsCreated, productsModelsUpdated, productsErrored, details };
}
