import type { RequestHandler } from "express";
import type { DatabaseStorage } from "./storage";

// Opt-in pagination preserves the legacy array response for existing callers.
export function parseProductPage(query: Record<string, unknown>) {
  if (query.page === undefined && query.limit === undefined) return undefined;
  function positive(value: unknown, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error("Page and limit must be positive whole numbers.");
    }
    return Number(value);
  }
  const page = positive(query.page, 1);
  const limit = Math.min(positive(query.limit, 24), 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new Error("Page is too large.");
  return { page, limit, offset };
}

export function productsListHandler(storage: DatabaseStorage): RequestHandler {
  return async (req, res) => {
    let paging;
    try { paging = parseProductPage(req.query); }
    catch (e: any) { res.status(400).json({ error: e.message }); return; }
    const { brand, category, q, featured } = req.query;
    const filters = {
      brand: typeof brand === "string" ? brand : undefined,
      category: typeof category === "string" ? category : undefined,
      q: typeof q === "string" ? q : undefined,
      featured: featured === "1" || featured === "true",
      activeOnly: true,
    };
    res.json(paging ? await storage.pageProducts(filters, paging) : await storage.listProducts(filters));
  };
}
