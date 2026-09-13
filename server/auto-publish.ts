// =====================================================================
// R28 Session 3 — server/auto-publish.ts
//
// Verbatim user requirements (preserved as inline comments per task rules):
//   * "Auto-Publish on Receipt: this is wrong actually when a client purchase
//      order is processed and rates are locked and delhi is notified at that
//      time the publishing should happen"
//   * "feature d: the product should be ready to order when notify delhi is
//      triggered, the quantity should br 10 for each pcs. No RELATION WITH THE
//      PATNA RECIEVING"
//   * "every item successfully procured by the team is automatically published
//      with 22% markup on purchase price"
//   * "on the image section an image resembling the item i.e if its a uj cross
//      then a cross image should be used with disclaimer the image is only for
//      representation purpose"
//
// Behavior:
//   * PRE-CHECK feature flag AUTO_PUBLISH_ENABLED. If not 'true', short-circuit
//     with a benign {ok:true, ..., details:[{part_number:'*',status:'feature_disabled'}]}
//     — this preserves the "notify-Delhi does exactly what it does today" rule.
//   * Load PO + po_items (schema found via grep: separate `po_items` table,
//     one row per line, with part_number/description/qty/purchase_cost/unit_price).
//   * Per line item:
//       - dedupe by (po_id, part_number) → skip if a published/updated row exists
//       - compute published_price = round(purchase_price * 1.22, 2)
//         (markup pct overridable via AUTO_PUBLISH_MARKUP_PCT, default 22)
//       - quantity ALWAYS 10 (overridable via AUTO_PUBLISH_DEFAULT_QTY, default 10)
//       - fetch representational image via getRepresentationalImage
//       - upsert into products table (match by part_number if unique, else create)
//       - insert into auto_publish_log
//       - fire-and-forget summary email to sales@narmadamobility.com
// =====================================================================

import { rawSqlite } from "./storage";
import { storage } from "./storage";
import * as v2 from "./storage-v2";
import { getRepresentationalImage } from "./part-image-gen";
import { sendGenericSalesEmail } from "./email";

export interface AutoPublishDetail {
  part_number: string;
  status: string;
  product_id?: number;
  error?: string;
}

export interface AutoPublishResult {
  ok: boolean;
  published: number;
  updated: number;
  skipped: number;
  errors: number;
  details: AutoPublishDetail[];
}

export function toSlug(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function inferCategory(description: string): string {
  const d = String(description || "").toLowerCase();
  if (/clutch/.test(d)) return "clutch";
  if (/brake/.test(d)) return "brake";
  if (/suspension|shock|spring/.test(d)) return "suspension";
  if (/engine|piston|crankshaft/.test(d)) return "engine";
  if (/filter/.test(d)) return "filter";
  if (/electrical|wire|sensor|alternator|starter/.test(d)) return "electrical";
  if (/transmission|gear|axle|propeller|uj|u-joint|cross/.test(d)) return "transmission";
  if (/body|mirror|panel|bumper/.test(d)) return "body";
  return "other";
}

// R28.10 Bug 4: infer a real brand slug from the description so auto-published
// products actually appear when the /products catalog is filtered by brand.
// Falls back to "other" (which is a valid enum value in the schema) if we
// can't guess. Slugs match those used by client/src/data/brands.ts / BRAND_WALL.
export function inferBrand(description: string, partNumber: string): string {
  const s = `${description || ""} ${partNumber || ""}`.toLowerCase();
  if (/\btata\b|tml|prima|signa|lpt|lpk|lps|lpo|ultra/.test(s)) return "tata";
  if (/bharat[\s-]?benz|bharatbenz/.test(s)) return "bharatbenz";
  if (/ashok[\s-]?leyland|leyland|dost/.test(s)) return "ashok-leyland";
  if (/\beicher\b|pro[\s-]?series/.test(s)) return "eicher";
  if (/\bvolvo\b/.test(s)) return "volvo";
  if (/\bmahindra\b/.test(s)) return "mahindra";
  if (/\bscania\b/.test(s)) return "scania";
  if (/mercedes|benz/.test(s)) return "other";
  return "other";
}

function existingLogRow(poId: number, partNumber: string): { id: number; status: string; product_id: number | null } | undefined {
  try {
    return rawSqlite
      .prepare(`SELECT id, status, product_id FROM auto_publish_log WHERE po_id = ? AND part_number = ?`)
      .get(poId, partNumber) as { id: number; status: string; product_id: number | null } | undefined;
  } catch {
    return undefined;
  }
}

function insertAutoPublishLogRow(row: {
  po_id: number;
  po_line_id: number | null;
  part_number: string;
  description: string;
  purchase_price: number;
  published_price: number;
  markup_pct: number;
  quantity: number;
  product_id: number | null;
  image_url: string | null;
  image_source: string | null;
  status: string;
  error_message: string | null;
  triggered_by: string;
  triggered_by_user_id: number | null;
}): number {
  const info = rawSqlite
    .prepare(
      `INSERT INTO auto_publish_log (po_id, po_line_id, part_number, description, purchase_price,
                                     published_price, markup_pct, quantity, product_id, image_url,
                                     image_source, status, error_message, triggered_by,
                                     triggered_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.po_id, row.po_line_id, row.part_number, row.description, row.purchase_price,
      row.published_price, row.markup_pct, row.quantity, row.product_id, row.image_url,
      row.image_source, row.status, row.error_message, row.triggered_by,
      row.triggered_by_user_id, Date.now(),
    );
  return Number(info.lastInsertRowid);
}

// ---- Product upsert ------------------------------------------------------
// The products schema (shared/schema.ts) has:
//   id, slug (UNIQUE), name, brand, model, category, part_number, oem_number,
//   description, short_description, price_inr, stock_qty, image_urls (JSON),
//   compatible_models, meta_*, featured, active, created_at
// We match by part_number first (there is a helper storage.getProductByPartNumber).
// If no product exists, we create one. If one exists, we update price/qty/image.
async function upsertProduct(args: {
  partNumber: string;
  description: string;
  publishedPrice: number;
  quantity: number;
  imageUrl: string;
}): Promise<{ id: number; created: boolean }> {
  const { partNumber, description, publishedPrice, quantity, imageUrl } = args;
  const existing = await (storage as any).getProductByPartNumber(partNumber);
  const imageUrlsJson = JSON.stringify([imageUrl]);
  const inferredBrand = inferBrand(description, partNumber);
  if (existing) {
    // R28.10 Bug 4: force `active: true` (in case an admin previously hid the
    // product) and leave brand/category untouched to preserve any manual edits.
    // R28.10a: exception — if brand is still the placeholder "other", re-infer
    // it. Manual admin edits (any specific brand like "tata") are preserved
    // because the guard only fires on the sentinel "other".
    const shouldFixBrand = existing.brand === "other" && inferredBrand && inferredBrand !== "other";
    await storage.updateProduct(existing.id, {
      priceInr: publishedPrice,
      stockQty: quantity,
      imageUrls: imageUrlsJson,
      active: true,
      description: existing.description || description,
      ...(shouldFixBrand ? { brand: inferredBrand } : {}),
    } as any);
    console.log("[auto-publish] upserted product:", { id: existing.id, partNumber, action: "update", active: true, slug: existing.slug, ...(shouldFixBrand ? { brandFixed: `other→${inferredBrand}` } : {}) });
    return { id: existing.id, created: false };
  }
  const category = inferCategory(description);
  const baseSlug = toSlug(`${partNumber}-${description}`.slice(0, 80)) || toSlug(partNumber) || `part-${Date.now()}`;
  // Ensure slug uniqueness (append -N if collision).
  let slug = baseSlug;
  let n = 1;
  while (await storage.getProductBySlug(slug)) {
    slug = `${baseSlug}-${n++}`;
    if (n > 50) { slug = `${baseSlug}-${Date.now()}`; break; }
  }
  const created = await storage.createProduct({
    slug,
    name: description || partNumber,
    // R28.10 Bug 4: use a real brand slug so /products?brand=<x> filters surface
    // the item; falls back to "other" when we can't guess.
    brand: inferredBrand,
    model: null,
    category,
    partNumber,
    oemNumber: null,
    description: description || partNumber,
    shortDescription: null,
    priceInr: publishedPrice,
    stockQty: quantity,
    imageUrls: imageUrlsJson,
    compatibleModels: "[]",
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    featured: false,
    active: true,
  } as any);
  console.log("[auto-publish] upserted product:", { id: created.id, partNumber, action: "create", active: true, slug, brand: inferredBrand });
  return { id: created.id, created: true };
}

// ---- Main entry point ---------------------------------------------------
export async function autoPublishFromPO(
  poId: number,
  triggeredByUserId?: number,
  triggeredBy: "notify-delhi" | "manual-admin" = "notify-delhi",
): Promise<AutoPublishResult> {
  // R28 Session 3 — pre-check the feature flag. Default OFF so notify-Delhi
  // "behaves exactly as it does today" until the user manually flips it on.
  const enabled = String(process.env.AUTO_PUBLISH_ENABLED ?? "false").toLowerCase() === "true";
  if (!enabled) {
    return {
      ok: true,
      published: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      details: [{ part_number: "*", status: "feature_disabled" }],
    };
  }

  const markupPct = Number(process.env.AUTO_PUBLISH_MARKUP_PCT ?? 22);
  const defaultQty = Number(process.env.AUTO_PUBLISH_DEFAULT_QTY ?? 10);
  const multiplier = 1 + markupPct / 100;

  const details: AutoPublishDetail[] = [];
  let published = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  let po: any;
  try {
    po = await v2.getPurchaseOrderV2(poId);
  } catch (e: any) {
    return { ok: false, published: 0, updated: 0, skipped: 0, errors: 1,
             details: [{ part_number: "*", status: "error", error: `load_po_failed: ${e?.message || e}` }] };
  }
  if (!po) {
    return { ok: false, published: 0, updated: 0, skipped: 0, errors: 1,
             details: [{ part_number: "*", status: "error", error: "po_not_found" }] };
  }

  const items: any[] = Array.isArray(po.items) ? po.items : [];
  for (const it of items) {
    const partNumber = String(it.partNumber || "").trim();
    if (!partNumber) {
      skipped += 1;
      details.push({ part_number: "(missing)", status: "skipped_no_part_number" });
      continue;
    }
    // Idempotency: skip if we've already published/updated this (po_id, part_number).
    const prior = existingLogRow(poId, partNumber);
    if (prior && (prior.status === "published" || prior.status === "updated")) {
      skipped += 1;
      details.push({ part_number: partNumber, status: "skipped_duplicate", product_id: prior.product_id ?? undefined });
      continue;
    }

    // Purchase price: prefer per-line purchaseCost, then vendorRate, then unitPrice.
    const purchasePrice = Number(it.purchaseCost ?? it.vendorRate ?? it.unitPrice ?? 0);
    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      // Log an error row so the admin log shows why nothing was published.
      try {
        insertAutoPublishLogRow({
          po_id: poId, po_line_id: it.id ?? null, part_number: partNumber,
          description: String(it.description || partNumber),
          purchase_price: 0, published_price: 0, markup_pct: markupPct, quantity: defaultQty,
          product_id: null, image_url: null, image_source: null,
          status: "error", error_message: "purchase_price_missing_or_zero",
          triggered_by: triggeredBy, triggered_by_user_id: triggeredByUserId ?? null,
        });
      } catch { /* ignore duplicate-key */ }
      errors += 1;
      details.push({ part_number: partNumber, status: "error", error: "purchase_price_missing" });
      continue;
    }

    const publishedPrice = round2(purchasePrice * multiplier);
    const description = String(it.description || partNumber);

    // Fetch representational image. Awaited, but bounded by internal 30s
    // timeout so it can't stall the caller indefinitely.
    let img: { url: string; source: "generated" | "reused" | "placeholder" };
    try {
      img = await getRepresentationalImage(partNumber, description);
    } catch (e: any) {
      // R28.10 Bug 5: point to premium JPG placeholder.
      img = { url: "/images/placeholder-part.jpg", source: "placeholder" };
    }

    // Upsert product row.
    let productId: number | null = null;
    let created = false;
    try {
      const r = await upsertProduct({
        partNumber,
        description,
        publishedPrice,
        quantity: defaultQty,     // "quantity should br 10 for each pcs" (verbatim)
        imageUrl: img.url,
      });
      productId = r.id;
      created = r.created;
    } catch (e: any) {
      try {
        insertAutoPublishLogRow({
          po_id: poId, po_line_id: it.id ?? null, part_number: partNumber, description,
          purchase_price: purchasePrice, published_price: publishedPrice, markup_pct: markupPct,
          quantity: defaultQty, product_id: null, image_url: img.url, image_source: img.source,
          status: "error", error_message: `upsert_failed: ${e?.message || e}`,
          triggered_by: triggeredBy, triggered_by_user_id: triggeredByUserId ?? null,
        });
      } catch { /* ignore duplicate-key */ }
      errors += 1;
      details.push({ part_number: partNumber, status: "error", error: e?.message || String(e) });
      continue;
    }

    // Log outcome.
    const status = created ? "published" : "updated";
    try {
      insertAutoPublishLogRow({
        po_id: poId, po_line_id: it.id ?? null, part_number: partNumber, description,
        purchase_price: purchasePrice, published_price: publishedPrice, markup_pct: markupPct,
        quantity: defaultQty, product_id: productId, image_url: img.url, image_source: img.source,
        status, error_message: null,
        triggered_by: triggeredBy, triggered_by_user_id: triggeredByUserId ?? null,
      });
    } catch (e: any) {
      // Unique constraint would only fire on race; treat as skipped duplicate.
      skipped += 1;
      details.push({ part_number: partNumber, status: "skipped_race", product_id: productId ?? undefined });
      continue;
    }

    if (created) published += 1; else updated += 1;
    details.push({ part_number: partNumber, status, product_id: productId ?? undefined });
  }

  // Fire-and-forget notification email — do NOT await (user rule: "No `await`
  // on AiSensy or email calls (fire-and-forget)").
  if (published + updated + errors > 0) {
    void (async () => {
      try {
        const lines = details
          .filter((d) => d.status === "published" || d.status === "updated" || d.status === "error")
          .map((d) => `  ${d.part_number.padEnd(20)}  ${d.status}${d.product_id ? ` (product #${d.product_id})` : ""}${d.error ? ` — ${d.error}` : ""}`)
          .join("\n");
        const subject = `[Narmada Auto-Publish] PO #${poId} — ${published} new / ${updated} updated / ${errors} errors`;
        const text =
          `Auto-Publish summary for PO #${poId}\n` +
          `Trigger: ${triggeredBy}\n` +
          `Markup: ${markupPct}%   Quantity: ${defaultQty}\n\n` +
          `Published: ${published}\nUpdated:   ${updated}\nSkipped:   ${skipped}\nErrors:    ${errors}\n\n` +
          `Details:\n${lines}\n`;
        await sendGenericSalesEmail({
          eventType: "auto_publish",
          entityId: poId,
          subject,
          text,
        });
      } catch (e: any) {
        console.error("[auto-publish] summary email failed:", e?.message || e);
      }
    })();
  }

  return { ok: true, published, updated, skipped, errors, details };
}

// ---- Admin helpers ------------------------------------------------------

export function listAutoPublishLog(opts: { limit?: number; offset?: number; poId?: number; status?: string } = {}): any[] {
  const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 500);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const clauses: string[] = [];
  const params: any[] = [];
  if (opts.poId != null && Number.isFinite(opts.poId)) { clauses.push("po_id = ?"); params.push(opts.poId); }
  if (opts.status) { clauses.push("status = ?"); params.push(opts.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const rows = rawSqlite
      .prepare(`SELECT * FROM auto_publish_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    // R28.10 Bug 1: map snake_case sqlite columns to camelCase so the frontend log page renders values.
    return (rows as any[]).map((r) => ({
      id: r.id,
      poId: r.po_id,
      poLineId: r.po_line_id,
      partNumber: r.part_number,
      description: r.description,
      purchasePrice: r.purchase_price,
      publishedPrice: r.published_price,
      markupPct: r.markup_pct,
      quantity: r.quantity,
      productId: r.product_id,
      imageUrl: r.image_url,
      imageSource: r.image_source,
      status: r.status,
      errorMessage: r.error_message,
      triggeredByUserId: r.triggered_by_user_id,
      triggeredBy: r.triggered_by,
      createdAt: r.created_at,
    }));
  } catch (e: any) {
    console.error("[auto-publish] listAutoPublishLog failed:", e?.message || e);
    return [];
  }
}
