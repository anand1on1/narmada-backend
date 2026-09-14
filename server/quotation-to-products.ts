// R28.16 — Quotation line items → auto-publish as products
//
// When a quotation is saved (create or update), each line item is published as
// a live product in the catalog. This means every part that gets quoted becomes
// a searchable SEO'd product page automatically.
//
// Behavior (per line):
//
// 1. Line has partNumber AND a product with that partNumber ALREADY exists
//    → SKIP entirely. Existing product is left 100% untouched (no price/desc/anything).
//
// 2. Line has partNumber but NO existing product with that partNumber
//    → CREATE product. sku = partNumber. priceInr = quoted rate (post-discount, per unit).
//
// 3. Line has NO partNumber
//    → CREATE product. sku = "NM-" + 6 random hex chars. priceInr = quoted rate.
//
// All auto-created products are:
//   - active (live) = true
//   - featured = false
//   - stockQty = 10
//   - category = "other" (uncategorized)
//   - brand = inferred from productName, else "other"
//   - image = /images/placeholder-part.jpg (no image lookup; keep it fast)
//
// Fire-and-forget: caller invokes with `void publishQuotationItemsAsProducts(...)`.
// This helper never throws — failures are logged and swallowed.

import { randomBytes } from "node:crypto";
import { storage } from "./storage";
import { inferBrand, toSlug, round2 } from "./auto-publish";

export interface QuotationLineForPublish {
  partNumber?: string | null;
  productName: string;
  brand?: string | null;
  qty?: number | null;
  mrp?: number | null;
  discount?: number | null; // percentage
  lineTotal?: number | null;
}

export interface QuotationPublishResult {
  identifier: string; // partNumber or generated SKU
  productId: number | null;
  action: "created" | "skipped_existing" | "skipped_no_name" | "error";
  error?: string;
}

export interface QuotationPublishSummary {
  productsCreated: number;
  productsSkippedExisting: number;
  productsErrored: number;
  details: QuotationPublishResult[];
}

const DEFAULT_STOCK_QTY = 10;
const PLACEHOLDER_IMAGE = "/images/placeholder-part.jpg";

// -- helpers --

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await storage.getProductBySlug(slug)) {
    slug = `${base}-${n++}`;
    if (n > 50) return `${base}-${Date.now()}`;
  }
  return slug;
}

/** Auto-generate SKU for lines without a part number: NM-A7K2X9 */
function generateSku(): string {
  return `NM-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Compute per-unit quoted rate from a quotation line:
 *   perUnit = mrp * (1 - discount/100)
 * Falls back to lineTotal/qty if mrp missing but lineTotal present.
 */
function computeQuotedRate(item: QuotationLineForPublish): number {
  const mrp = Number(item.mrp || 0);
  const discountPct = Number(item.discount || 0);
  if (mrp > 0) {
    return round2(mrp * (1 - discountPct / 100));
  }
  const qty = Number(item.qty || 1);
  const total = Number(item.lineTotal || 0);
  if (qty > 0 && total > 0) return round2(total / qty);
  return 0;
}

/**
 * Publish one quotation line item as a product.
 * Never throws.
 */
export async function publishQuotationLineAsProduct(
  item: QuotationLineForPublish,
): Promise<QuotationPublishResult> {
  const productName = String(item.productName || "").trim();
  if (!productName) {
    return { identifier: "(no name)", productId: null, action: "skipped_no_name" };
  }

  try {
    // ---- Case 1: line has partNumber and product with that SKU already exists ----
    const rawPartNumber = String(item.partNumber || "").trim();
    if (rawPartNumber) {
      const existing = await (storage as any).getProductByPartNumber(rawPartNumber);
      if (existing) {
        // Leave completely untouched per spec.
        return { identifier: rawPartNumber, productId: existing.id, action: "skipped_existing" };
      }
    }

    // ---- Case 2 & 3: create new product ----
    const sku = rawPartNumber || generateSku();
    const priceInr = computeQuotedRate(item);
    const brand = String(item.brand || "").trim().toLowerCase() || inferBrand(productName, sku) || "other";
    const baseSlug =
      toSlug(`${sku}-${productName}`.slice(0, 80)) ||
      toSlug(sku) ||
      `quoted-${Date.now()}`;
    const slug = await uniqueSlug(baseSlug);

    const created = await storage.createProduct({
      slug,
      name: productName,
      brand,
      model: null,
      category: "other", // uncategorized per spec
      partNumber: sku,
      oemNumber: null,
      description: productName,
      shortDescription: null,
      priceInr,
      stockQty: DEFAULT_STOCK_QTY,
      imageUrls: JSON.stringify([PLACEHOLDER_IMAGE]),
      compatibleModels: JSON.stringify([]),
      metaTitle: `${productName} - ${sku} | Narmada Mobility`,
      metaDescription: `Buy ${productName} (${sku}) at Narmada Mobility. Genuine commercial vehicle spare parts, ready to ship.`,
      metaKeywords: null,
      featured: false,
      active: true, // live per spec
    } as any);

    return { identifier: sku, productId: created.id, action: "created" };
  } catch (e: any) {
    return {
      identifier: item.partNumber || "(no-part)",
      productId: null,
      action: "error",
      error: e?.message || String(e),
    };
  }
}

/**
 * Batch helper — call from quotation create/update handlers.
 * Serial (not parallel) to keep DB pressure low.
 * Never throws.
 */
export async function publishQuotationItemsAsProducts(
  quotationId: number | string,
  items: QuotationLineForPublish[],
): Promise<QuotationPublishSummary> {
  const details: QuotationPublishResult[] = [];
  let productsCreated = 0;
  let productsSkippedExisting = 0;
  let productsErrored = 0;

  for (const item of items) {
    const r = await publishQuotationLineAsProduct(item);
    details.push(r);
    if (r.action === "created") productsCreated++;
    else if (r.action === "skipped_existing") productsSkippedExisting++;
    else if (r.action === "error") productsErrored++;
  }

  console.log("[quotation-to-products] batch done:", {
    quotationId,
    total: items.length,
    productsCreated,
    productsSkippedExisting,
    productsErrored,
  });

  return { productsCreated, productsSkippedExisting, productsErrored, details };
}
