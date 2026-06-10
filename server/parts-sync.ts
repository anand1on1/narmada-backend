/**
 * Parts Master sync helper — Session C
 * Upserts part data into parts_master table.
 * Called after every quotation save / item addition.
 */
import { db } from "./storage";
import { partsMaster } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Upsert a part into parts_master from quotation data.
 * Updates latest known MRP, HSN, GST, brand and increments use_count.
 */
export async function upsertPartFromQuotation(
  partNumber: string,
  name: string,
  hsn: string | null,
  gstRate: number | null,
  brand: string | null,
  mrp: number | null,
): Promise<void> {
  if (!partNumber || !partNumber.trim()) return;

  const pn = partNumber.trim();
  const searchText = `${pn} ${name}`.toLowerCase().replace(/\s+/g, " ").trim();
  const now = Date.now();

  try {
    const existing = db
      .select()
      .from(partsMaster)
      .where(eq(partsMaster.partNumber, pn))
      .get();

    if (existing) {
      // Update with latest data
      db.update(partsMaster)
        .set({
          name: name || existing.name,
          hsn: hsn ?? existing.hsn,
          gstRate: gstRate ?? existing.gstRate,
          brand: brand ?? existing.brand,
          lastMrp: mrp ?? existing.lastMrp,
          lastSource: "manual",
          lastUpdated: now,
          searchText,
          useCount: (existing.useCount || 0) + 1,
        })
        .where(eq(partsMaster.partNumber, pn))
        .run();
    } else {
      // Insert new record
      db.insert(partsMaster)
        .values({
          partNumber: pn,
          name: name || pn,
          hsn: hsn || null,
          gstRate: gstRate || null,
          brand: brand || null,
          lastMrp: mrp || null,
          lastSource: "manual",
          lastUpdated: now,
          searchText,
          useCount: 1,
          createdAt: now,
        })
        .run();
    }
  } catch (e: any) {
    // Non-fatal — log and continue
    console.error(`[parts-sync] upsertPartFromQuotation error for ${pn}:`, e?.message);
  }
}

/**
 * Batch upsert multiple parts at once (from import or quotation)
 */
export async function upsertPartsFromImport(
  parts: Array<{
    partNumber: string;
    name: string;
    hsn?: string | null;
    gstRate?: number | null;
    brand?: string | null;
    mrp?: number | null;
    source?: string;
  }>,
): Promise<{ updated: number; inserted: number; errors: number }> {
  let updated = 0;
  let inserted = 0;
  let errors = 0;

  for (const part of parts) {
    if (!part.partNumber?.trim()) continue;

    const pn = part.partNumber.trim();
    const searchText = `${pn} ${part.name || ""}`.toLowerCase().trim();
    const now = Date.now();

    try {
      const existing = db
        .select()
        .from(partsMaster)
        .where(eq(partsMaster.partNumber, pn))
        .get();

      if (existing) {
        db.update(partsMaster)
          .set({
            name: part.name || existing.name,
            hsn: part.hsn ?? existing.hsn,
            gstRate: part.gstRate ?? existing.gstRate,
            brand: part.brand ?? existing.brand,
            lastMrp: part.mrp ?? existing.lastMrp,
            lastSource: part.source || "import",
            lastUpdated: now,
            searchText,
            useCount: (existing.useCount || 0) + 1,
          })
          .where(eq(partsMaster.partNumber, pn))
          .run();
        updated++;
      } else {
        db.insert(partsMaster)
          .values({
            partNumber: pn,
            name: part.name || pn,
            hsn: part.hsn || null,
            gstRate: part.gstRate || null,
            brand: part.brand || null,
            lastMrp: part.mrp || null,
            lastSource: part.source || "import",
            lastUpdated: now,
            searchText,
            useCount: 1,
            createdAt: now,
          })
          .run();
        inserted++;
      }
    } catch (e: any) {
      console.error(`[parts-sync] batch upsert error for ${pn}:`, e?.message);
      errors++;
    }
  }

  return { updated, inserted, errors };
}
