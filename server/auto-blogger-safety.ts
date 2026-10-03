import sanitizeHtml from "sanitize-html";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { Database } from "better-sqlite3";
import { articleDraftSchema, type ArticleDraft, type BlogSource } from "../shared/auto-blogger";
import { productPath } from "../shared/public-urls";
import { ArticleSchemaValidationError } from "./blog-schema-diagnostics";

export const authoritativeDomains = [
  "tatamotors.com", "tatacommercialvehicles.com", "ashokleyland.com", "eichertrucksandbuses.com",
  "mahindratruckandbus.com", "bharatbenz.com", "man.eu", "volvotrucks.com", "volvobuses.com",
  "cummins.com", "boschaftermarket.com", "zf.com", "schaeffler.com", "skf.com", "amwmotors.com",
  "morth.nic.in", "dgft.gov.in", "cbic.gov.in", "bis.gov.in", "mahle-aftermarket.com",
];
export const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const textOnly = (html: string) => sanitizeHtml(html.replace(/<\/(?:p|h[1-6]|li|tr|div|section|blockquote|ul|ol)>/gi, " "), { allowedTags: [], allowedAttributes: {} })
  .replace(/&(?:nbsp|amp|lt|gt|quot);/g, " ").replace(/\s+/g, " ").trim();

export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "a", "blockquote", "br",
      "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "rel"] },
    allowedSchemes: ["https", "http"], allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: { a: (_tag, attrs) => ({
      tagName: "a", attribs: { href: attrs.href || "", rel: "noopener noreferrer" },
    }) },
  });
}
export function assertPublicSource(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("SOURCE_URL_REJECTED"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      isIP(url.hostname) || !authoritativeDomains.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`))) {
    throw new Error("SOURCE_URL_REJECTED");
  }
  return url;
}
export function publicAddress(ip: string): boolean {
  // Fail closed on IPv6, including IPv4-mapped IPv6. Research only needs public A records.
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) || a === 198);
}
// Fixed hostname allowlist + public DNS + pinned lookup prevents redirect/rebinding SSRF.
// No cookies/authorization; every redirect revalidates host/DNS and pins a public
// address. A whole source (including DNS/redirects) gets 12 seconds and <=3 hops.
export async function readEvidence(input: string): Promise<BlogSource> {
  let url = assertPublicSource(input);
  const deadline = Date.now() + 12000, seen = new Set<string>();
  let html = "";
  for (let hop = 0; hop <= 3; hop++) {
  if (seen.has(url.href)) throw new Error("SOURCE_REDIRECT_REJECTED");
  seen.add(url.href);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("SOURCE_TIMEOUT");
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, family: 4 }),
    new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error("SOURCE_DNS_TIMEOUT")), Math.min(5000, remaining)); t.unref(); }),
  ]);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("SOURCE_ADDRESS_REJECTED");
  const result = await new Promise<{ html?: string; redirect?: string }>((resolve, reject) => {
    const req = request(url, {
      method: "GET", headers: { "User-Agent": "NarmadaMobilityEditorial/1.0", Accept: "text/html,text/plain" },
      lookup: ((_host: any, opts: any, cb: any) => opts?.all
        ? cb(null, [{ address: addresses[0].address, family: 4 }])
        : cb(null, addresses[0].address, 4)) as any,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.resume(); resolve({ redirect: res.headers.location }); return;
      }
      if (res.statusCode !== 200 || !/text\/(html|plain)/i.test(String(res.headers["content-type"]))) {
        res.resume(); reject(new Error("SOURCE_UNREACHABLE")); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", c => { size += c.length; if (size > 750000) req.destroy(new Error("SOURCE_TOO_LARGE")); else chunks.push(c); });
      res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => reject(new Error("SOURCE_UNREACHABLE")));
    });
    const timer = setTimeout(() => req.destroy(new Error("SOURCE_TIMEOUT")), Math.max(1, deadline - Date.now()));
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => reject(new Error("SOURCE_UNREACHABLE")));
    req.end();
  });
  if (result.redirect) {
    if (hop === 3) throw new Error("SOURCE_REDIRECT_REJECTED");
    url = assertPublicSource(new URL(result.redirect, url).href);
    continue;
  }
  html = result.html || "";
  break;
  }
  const text = textOnly(html).slice(0, 14000);
  if (text.length < 250) throw new Error("EVIDENCE_INSUFFICIENT");
  // Redact phone/email text from public research pages before generation.
  const safe = text.replace(/\S+@\S+\.\S+/g, "[redacted]").replace(/(?:\+?\d[\s().-]*){9,}/g, "[redacted]");
  return { url: url.href, title: url.hostname, text: safe, accessedAt: Date.now() };
}

const stop = new Set("the a an and for in of to with your how guide parts vehicle commercial narmada mobility".split(" "));
function tokens(s: string) { return new Set(textOnly(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stop.has(w))); }
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  const intersection = Array.from(x).filter(t => y.has(t)).length;
  return intersection / Math.max(1, Math.min(x.size, y.size));
}
function shingles(s: string): Set<string> {
  const w = textOnly(s).toLowerCase().split(/\s+/);
  return new Set(w.slice(0, -5).map((_, i) => w.slice(i, i + 6).join(" ")));
}
export function overlap(a: string, b: string): number {
  const x = shingles(a), y = shingles(b);
  return Array.from(x).filter(t => y.has(t)).length / Math.max(1, Math.min(x.size, y.size));
}
export function internalLinks(db: Database): string[] {
  return ["/products", "/contact", "/blog",
    ...(db.prepare("SELECT slug,part_number FROM products WHERE active=1 AND slug GLOB '[a-zA-Z0-9]*' LIMIT 10000").all() as any[])
      .filter(r => /^[a-zA-Z0-9_-]+$/.test(r.slug)).flatMap(r => [productPath(r), `/product/${r.slug}`]),
    ...(db.prepare("SELECT slug FROM posts WHERE published=1 LIMIT 10000").all() as any[])
      .filter(r => /^[a-zA-Z0-9_-]+$/.test(r.slug)).map(r => `/blog/${r.slug}`)];
}
export function validateArticle(db: Database, input: unknown, sources: BlogSource[], existingId?: number): ArticleDraft {
  const parsed = articleDraftSchema.safeParse(input);
  if (!parsed.success) throw new ArticleSchemaValidationError(input, parsed.error.issues);
  const d = parsed.data;
  const clean = cleanHtml(d.content), plain = textOnly(clean);
  const all = `${d.title} ${d.excerpt} ${plain} ${d.metaTitle} ${d.metaDescription}`;
  if (/\b(exclusive|authori[sz]ed (?:dealer|supplier|distributor|partner)|best supplier|guaranteed fit|in stock|ready stock|genuine OEM|OEM genuine|lowest price|our branch|our warehouse|Narmada Motors)\b/i.test(all))
    throw new Error("UNSUPPORTED_COMMERCIAL_CLAIM");
  if (/\S+@\S+\.\S+|(?:\+?\d[\s().-]*){10,}|\b(customer|vendor)\s*(name|address|phone|price)|\b(margin|bank account|IFSC|payment details)\b/i.test(all))
    throw new Error("PRIVACY_CHECK_FAILED");
  if (plain.split(/\s+/).length < 450 || plain.split(/\s+/).length > 1400 || (clean.match(/<h2>/g) || []).length < 3)
    throw new Error("ARTICLE_STRUCTURE_INVALID");
  if (/<(?:script|style|iframe|svg|form)|\bon\w+\s*=|(?:javascript|data)\s*:/i.test(d.content))
    throw new Error("UNSAFE_HTML");
  const allowed = new Set(internalLinks(db)), sourceUrls = new Set(sources.map(s => s.url));
  const hrefs = Array.from(clean.matchAll(/href="([^"]+)"/g)).map(m => m[1].replace(/&amp;/g, "&"));
  let internal = 0, external = 0;
  for (const href of hrefs) {
    if (href.startsWith("/")) { if (!allowed.has(href)) throw new Error("INTERNAL_LINK_INVALID"); internal++; }
    else { assertPublicSource(href); if (!sourceUrls.has(href)) throw new Error("UNCITED_EXTERNAL_LINK"); external++; }
  }
  if (internal < 1 || external < 2 || new Set(hrefs.filter(h => sourceUrls.has(h))).size < 2 ||
      hrefs.length > 12 || sources.length < 2) throw new Error("LINK_EVIDENCE_INSUFFICIENT");
  for (const claim of d.claims) {
    const source = sources.find(s => s.url === claim.sourceUrl);
    if (!source || !source.text.toLowerCase().includes(claim.evidenceQuote.toLowerCase()) ||
        !plain.toLowerCase().includes(textOnly(claim.claim).toLowerCase())) throw new Error("CLAIM_NOT_GROUNDED");
  }
  for (const topic of d.followUpTopics) {
    const source = sources.find(s => s.url === topic.sourceUrl);
    if (!source || !source.text.toLowerCase().includes(topic.evidenceQuote.toLowerCase()) ||
      !/^[a-zA-Z0-9 ,:?!&()/'–—-]+$/.test(topic.title) || /\d{7,}/.test(topic.title))
      throw new Error("DISCOVERED_TOPIC_UNGROUNDED");
  }
  for (const slug of d.productSlugs)
    if (!allowed.has(`/product/${slug}`)) throw new Error("PRODUCT_LINK_INVALID");
  const others = db.prepare("SELECT id,title,content FROM posts WHERE id != ? ORDER BY id DESC LIMIT 2000").all(existingId || 0) as any[];
  if (others.some(p => similarity(d.title, p.title) > 0.82 || overlap(clean, p.content) > 0.38))
    throw new Error("ARTICLE_TOO_SIMILAR");
  // Do not permit long copied passages from online evidence.
  if (sources.some(s => overlap(clean, s.text) > 0.35)) throw new Error("SOURCE_COPY_OVERLAP");
  return { ...d, content: clean };
}
