import type { RequestHandler } from "express";
import { excludedPublicText, publicRecord } from "../shared/public-visibility";

/** Defence in depth for legacy public JSON projections. Staff/customer/quote
 * endpoints are deliberately excluded so historical business records survive. */
export const publicVisibility: RequestHandler = (req, res, next) => {
  const isApi = /^\/api\/(?:products|price-lists|posts|blog\/posts|chassis|parts|parts-finder|seo\/product)(?:\/|$)/.test(req.path);
  const isPage = /^\/(?:brand\/|eicher-|public-blog|blog(?:\/|$)|public-catalog|products(?:\/|$)|product\/|p\/|c\/|category\/|sitemap)/.test(req.path);
  if (!isApi && !isPage) return next();
  if (excludedPublicText(req.path)) return void res.status(404).set("X-Robots-Tag", "noindex").end();
  if (isApi) {
    const original = res.json.bind(res);
    const filter = (v: any): any => {
      if (Array.isArray(v)) return v.filter(publicRecord).filter(x => !excludedPublicText(x)).map(filter);
      if (v && typeof v === "object") return publicRecord(v) ? Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === "object" ? filter(val) : val])) : null;
      return v;
    };
    res.json = ((body: any) => {
      if (!Array.isArray(body) && !publicRecord(body)) return original.call(res.status(404).set("X-Robots-Tag", "noindex"), { error: "Not found" });
      const result = filter(body);
      if (result && Array.isArray(result.results) && "count" in result) result.count = result.results.length;
      return original(result);
    }) as typeof res.json;
  }
  if (isPage) {
    const send = res.send.bind(res);
    res.send = ((body: any) => {
      if (typeof body === "string" && excludedPublicText(body)) return send.call(
        res.status(404).set("X-Robots-Tag", "noindex").type("html"),
        '<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>Page not found</title></head><body><h1>Page not found</h1><a href="/get-quote">Request a quotation</a></body></html>');
      return send(body);
    }) as typeof res.send;
  }
  next();
};
