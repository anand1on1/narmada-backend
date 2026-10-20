import type { Database } from "better-sqlite3";
import { PUBLIC_ORIGIN, productPath } from "../shared/public-urls";
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const xml=(kind:string,body:string)=>`<?xml version="1.0" encoding="UTF-8"?>\n<${kind} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</${kind}>`;
export const SITEMAP_RANGE=1000; // also remains comfortably below PHP's 8 MB cap
export function splitSitemapIndex(db: Database) {
  const ranges=db.prepare("SELECT DISTINCT CAST((id-1)/? AS INTEGER) n FROM products WHERE active=1 ORDER BY n LIMIT 50000").all(SITEMAP_RANGE) as any[];
  if(ranges.length>=49999) throw Error("Sitemap index capacity exceeded");
  return xml("sitemapindex",["static",...ranges.map(r=>String(r.n))].map(n=>`<sitemap><loc>${PUBLIC_ORIGIN}/sitemap-catalog-${n}.xml</loc></sitemap>`).join(""));
}
export function splitSitemapPage(db: Database, segment:string): string | null {
  if(segment==="static") return xml("urlset",["/","/products","/about","/contact","/work-with-us","/privacy","/disclaimer","/blog"].map(p=>`<url><loc>${PUBLIC_ORIGIN}${p}</loc></url>`).join(""));
  if(!/^(0|[1-9]\d{0,8})$/.test(segment)) return null;
  const start=Number(segment)*SITEMAP_RANGE;
  const rows=db.prepare(`SELECT p.slug,p.part_number,p.created_at,c.updated_at FROM products p
    LEFT JOIN catalog_prices c ON c.product_id=p.id WHERE p.active=1 AND p.id>? AND p.id<=? ORDER BY p.id`).all(start,start+SITEMAP_RANGE) as any[];
  if(!rows.length) return null;
  const body=xml("urlset",rows.map(r=>{
    const stamp=r.updated_at || r.created_at, date=Number(stamp)>0 ? new Date(Number(stamp)) : null;
    return `<url><loc>${esc(PUBLIC_ORIGIN+productPath(r))}</loc>${date && Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>`:""}</url>`;
  }).join(""));
  if(Buffer.byteLength(body)>7000000) throw Error("Sitemap response exceeds safe bridge limit");
  return body;
}
export const sitemapProductCount=(db:Database)=>(db.prepare("SELECT count(*) n FROM products WHERE active=1").get() as any).n+8;
