import type { Express, RequestHandler } from "express";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { AutoBlogger } from "./auto-blogger";
import { cleanHtml, escapeHtml as esc } from "./auto-blogger-safety";
import { BLOG_ORIGIN, BLOG_EDITOR } from "../shared/auto-blogger";
import { productPath } from "../shared/public-urls";
import { safeBlogCode } from "../shared/blog-diagnostics";

const iso = (n: number) => new Date(n).toISOString();
const date = (n: number) => new Date(n).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
export function publicArticle(db: Database, slug: string): any {
  const p = db.prepare(`SELECT p.id,p.slug,p.title,p.excerpt,p.content,p.meta_title,p.meta_description,
    p.published_at,p.updated_at,p.created_at,a.category,a.cluster_id FROM posts p
    LEFT JOIN blog_articles a ON a.post_id=p.id WHERE p.slug=? AND p.published=1`).get(slug) as any;
  if (!p) return null;
  const sources = db.prepare("SELECT url,title,accessed_at AS accessedAt FROM blog_sources WHERE post_id=?").all(p.id);
  return { id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, content: cleanHtml(p.content),
    metaTitle: p.meta_title, metaDescription: p.meta_description, category: p.category || "Insights",
    authorName: BLOG_EDITOR, publishedAt: p.published_at || p.created_at, updatedAt: p.updated_at,
    sources, aiAssisted: sources.length >= 2,
    products: db.prepare(`SELECT p.slug,p.name,p.part_number AS partNumber FROM products p JOIN blog_article_products ap ON ap.product_id=p.id
      WHERE ap.post_id=? AND p.active=1 LIMIT 5`).all(p.id),
    related: db.prepare(`SELECT p.slug,p.title FROM posts p JOIN blog_articles a ON a.post_id=p.id
      WHERE p.published=1 AND p.id!=? AND a.cluster_id=? ORDER BY p.published_at DESC LIMIT 3`).all(p.id, p.cluster_id || 0),
  };
}
export function publicList(db: Database, query: any = {}) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(String(query.page), 10) || 1));
  const q = String(query.q || "").slice(0, 100).trim(), category = String(query.category || "").slice(0, 60);
  const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const where = `p.published=1 AND (p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\')
    AND (?='' OR COALESCE(a.category,'Insights')=?)`;
  const args = [term, term, category, category];
  const total = (db.prepare(`SELECT COUNT(*) n FROM posts p LEFT JOIN blog_articles a ON a.post_id=p.id WHERE ${where}`).get(...args) as any).n;
  const items = db.prepare(`SELECT p.id,p.slug,p.title,p.excerpt,p.published_at AS publishedAt,
    p.updated_at AS updatedAt,COALESCE(a.category,'Insights') AS category FROM posts p LEFT JOIN blog_articles a ON a.post_id=p.id
    WHERE ${where} ORDER BY p.published_at DESC,p.id DESC LIMIT 12 OFFSET ?`).all(...args, (page - 1) * 12);
  const categories = (db.prepare(`SELECT DISTINCT COALESCE(a.category,'Insights') category FROM posts p
    LEFT JOIN blog_articles a ON a.post_id=p.id WHERE p.published=1 ORDER BY category`).all() as any[]).map(r => r.category);
  return { items, total, page, pages: Math.ceil(total / 12), categories, q, category };
}
export function blogSitemap(db: Database) {
  const rows = db.prepare("SELECT slug,updated_at FROM posts WHERE published=1 ORDER BY id LIMIT 45000").all() as any[];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${BLOG_ORIGIN}/blog</loc></url>${rows.map(p =>
    `<url><loc>${BLOG_ORIGIN}/blog/${esc(encodeURIComponent(p.slug))}</loc><lastmod>${iso(p.updated_at)}</lastmod></url>`).join("")}</urlset>`;
}
const css = `:root{color-scheme:light;--bg:#f7f8fc;--text:#15213b;--muted:#59657b;--line:#d9dfeb;--accent:#4338ca;--card:white}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.7 system-ui,sans-serif}a{color:var(--accent);text-underline-offset:4px}
header,footer{border-bottom:1px solid var(--line);padding:20px max(24px,calc((100vw - 1120px)/2));display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:var(--card)}
header a{text-decoration:none;font-weight:650}header img{width:164px;height:auto}nav{display:flex;gap:24px;flex-wrap:wrap}main{max-width:1120px;margin:auto;padding:56px 24px 80px}
.kicker{text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-size:12px;font-weight:750}h1{font-size:clamp(30px,4vw,50px);line-height:1.15;letter-spacing:-.035em;max-width:880px;margin:16px 0 24px}
h2{font-size:26px;line-height:1.3;margin-top:40px}h3{font-size:21px}.lead{font-size:20px;color:var(--muted);max-width:770px}.meta{color:var(--muted);font-size:14px;margin:20px 0}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:32px}.card{border:1px solid var(--line);background:var(--card);padding:28px;border-radius:16px}
.card h2{font-size:23px;margin:12px 0}.card p{color:var(--muted);font-size:16px}.card a{font-weight:650}.reading{max-width:760px}.reading p,.reading li{overflow-wrap:anywhere}
.reading a{overflow-wrap:anywhere}.reading table{display:block;overflow:auto;border-collapse:collapse}.reading td,.reading th{border:1px solid var(--line);padding:12px}
.sources{border-top:1px solid var(--line);margin-top:40px;padding-top:12px}.sources li{margin-bottom:12px;font-size:15px}.cta{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;margin-top:40px}
.button,button{display:inline-block;background:var(--accent);color:white;padding:12px 20px;border:0;border-radius:8px;text-decoration:none;font:inherit;font-weight:650;cursor:pointer}
.cta a{margin:8px 16px 0 0}form{display:flex;gap:12px;flex-wrap:wrap;margin:32px 0}label{font-size:14px;font-weight:600}input,select{display:block;padding:12px;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:8px;max-width:100%}
form button{align-self:end}.pagination{display:flex;gap:24px;align-items:center;margin-top:32px}.empty{border:1px dashed var(--line);padding:40px;border-radius:12px}
footer{font-size:14px;border-top:1px solid var(--line)}:focus-visible{outline:3px solid #7c83ff;outline-offset:4px}
@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}main{padding:32px 20px 60px}header{gap:12px}nav{gap:16px}h1{font-size:32px}}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#101522;--text:#e8ecf5;--muted:#b2bbce;--line:#343e54;--accent:#a7adff;--card:#1a2234}.button,button{color:#111827}}`;
const jsonLd = (data: any) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;
function shell(title: string, description: string, path: string, body: string, schema?: any, noindex = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Narmada Mobility</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${BLOG_ORIGIN}${esc(path)}"><meta name="robots" content="${noindex ? "noindex,follow" : "index,follow"}">
<meta property="og:type" content="${schema ? "article" : "website"}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${BLOG_ORIGIN}${esc(path)}">
<style>${css}</style>${schema ? jsonLd(schema) : ""}</head><body>
<header><a href="/" aria-label="Narmada Mobility home"><img src="/logo-header.png" alt="Narmada Mobility"></a>
<nav aria-label="Main navigation"><a href="/products">Parts catalog</a><a href="/blog">Insights</a><a href="/contact">Request a quote</a></nav></header>
<main>${body}</main><footer>Narmada Mobility Editorial Desk · Evidence-led commercial vehicle parts insights<a href="/privacy">Privacy</a><a href="/disclaimer">Disclaimer</a></footer></body></html>`;
}
export function renderBlog(db: Database, slug: string | undefined, query: any = {}) {
  if (slug) {
    const p = publicArticle(db, slug);
    if (!p) return { status: 404, html: shell("Article not found", "This article is not available.", "/blog",
      `<h1>Article not found</h1><p>This article may be unpublished or the address may have changed.</p><a href="/blog">Browse insights</a>`, undefined, true) };
    const path = `/blog/${encodeURIComponent(p.slug)}`;
    const schema = [
      { "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.excerpt,
        mainEntityOfPage: `${BLOG_ORIGIN}${path}`, datePublished: iso(p.publishedAt), dateModified: iso(p.updatedAt),
        author: { "@type": "Organization", name: BLOG_EDITOR }, publisher: { "@type": "Organization", name: "Narmada Mobility" } },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BLOG_ORIGIN },
        { "@type": "ListItem", position: 2, name: "Insights", item: `${BLOG_ORIGIN}/blog` },
        { "@type": "ListItem", position: 3, name: p.title, item: `${BLOG_ORIGIN}${path}` },
      ] },
    ];
    return { status: 200, html: shell(p.metaTitle || p.title, p.metaDescription || p.excerpt, path,
      `<a href="/blog">← All insights</a><p class="kicker">${esc(p.category)}</p><h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.excerpt)}</p><p class="meta">${BLOG_EDITOR}<br>Published <time datetime="${iso(p.publishedAt)}">${date(p.publishedAt)}</time> · Updated <time datetime="${iso(p.updatedAt)}">${date(p.updatedAt)}</time></p>
${p.aiAssisted ? '<p class="meta">AI-assisted editorial content, checked automatically against cited references. This is not a claim of human technical review. Confirm vehicle-specific requirements with the manufacturer and our team.</p>' : ""}
<article class="reading">${p.content}
${p.sources.length ? `<section class="sources"><h2>Sources & further reading</h2><ul>${p.sources.map((s: any) =>
        `<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title)}</a> · Accessed ${date(s.accessedAt)}</li>`).join("")}</ul></section>` : ""}
${p.products.length ? `<section><h2>Explore the catalog</h2><ul>${p.products.map((r: any) => `<li><a href="${esc(productPath(r))}">${esc(r.name)}</a></li>`).join("")}</ul><p>Catalog references do not confirm fitment or current availability.</p></section>` : ""}
<section class="cta"><h2>Make your next enquiry more useful.</h2><p>Share your vehicle details, part number and requirements. Our team can help confirm fitment and availability before quoting.</p>
<a class="button" href="/contact">Request a quote</a><a href="https://wa.me/917909083806?text=Hello%20Narmada%20Mobility%2C%20I%20have%20a%20parts%20enquiry.">WhatsApp the team</a></section>
${p.related.length ? `<section><h2>Continue reading</h2><ul>${p.related.map((r: any) => `<li><a href="/blog/${esc(r.slug)}">${esc(r.title)}</a></li>`).join("")}</ul></section>` : ""}</article>`, schema) };
  }
  const list = publicList(db, query);
  if (list.page > Math.max(1, list.pages)) return { status: 404, html: shell("Page not found", "This insights page is not available.", "/blog", "<h1>Page not found</h1><a href='/blog'>All insights</a>", undefined, true) };
  const pageHref = (page: number) => `/blog?${new URLSearchParams({ page: String(page), ...(list.q ? { q: list.q } : {}), ...(list.category ? { category: list.category } : {}) })}`;
  return { status: 200, html: shell("Parts knowledge. Better decisions.", "Practical commercial vehicle parts guides from the Narmada Mobility Editorial Desk.",
    list.page > 1 ? `/blog?page=${list.page}` : "/blog",
    `<p class="kicker">Narmada Mobility / Insights</p><h1>Parts knowledge.<br>Better decisions.</h1>
<p class="lead">Evidence-led guides to commercial vehicle parts, procurement and fleet care. Useful questions to ask before your next enquiry.</p>
<form action="/blog" method="get"><label>Search insights<input name="q" value="${esc(list.q)}" placeholder="Search topics"></label>
<label>Category<select name="category"><option value="">All categories</option>${list.categories.map(c => `<option${list.category === c ? " selected" : ""} value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label><button type="submit">Find articles</button></form>
<p class="meta">${list.total} article${list.total === 1 ? "" : "s"} · Narmada Mobility Editorial Desk</p>
${list.items.length ? `<div class="grid">${(list.items as any[]).map(p => `<article class="card"><span class="kicker">${esc(p.category)}</span>
<h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.excerpt)}</p><p class="meta">${p.publishedAt ? date(p.publishedAt) : ""}</p><a href="/blog/${esc(p.slug)}">Read insight →</a></article>`).join("")}</div>` :
      `<div class="empty">No articles found. ${list.q || list.category ? '<a href="/blog">Clear filters</a>' : "New editorial guides will appear here when published."}</div>`}
<nav class="pagination" aria-label="Pagination">${list.page > 1 ? `<a href="${esc(pageHref(list.page - 1))}">← Previous</a>` : ""}
<span>Page ${list.page} of ${Math.max(1, list.pages)}</span>${list.page < list.pages ? `<a href="${esc(pageHref(list.page + 1))}">Next →</a>` : ""}</nav>`,
    undefined, !!(list.q || list.category)) };
}

export function registerAutoBloggerRoutes(app: Express, db: Database, requireAdmin: RequestHandler, engine = new AutoBlogger(db)) {
  const base = "/api/admin/auto-blogger";
  const err = (res: any, e: any) => res.status(400).json({ error: safeBlogCode(e) });
  app.get(base, requireAdmin, (req, res) => res.json(engine.status(Date.now(), Number(req.query.page) || 1)));
  app.patch(`${base}/settings`, requireAdmin, (req, res) => {
    try { res.json(engine.setSettings(req.body)); } catch (e) { err(res, e); }
  });
  app.post(`${base}/plan`, requireAdmin, (_req, res) => {
    try { res.json({ added: engine.plan() }); } catch (e) { err(res, e); }
  });
  app.post(`${base}/draft`, requireAdmin, (_req, res) => {
    try { res.status(202).json({ jobId: engine.enqueueDraft() }); void engine.tick().catch(() => {}); } catch (e) { err(res, e); }
  });
  app.post(`${base}/wake`, requireAdmin, (_req, res) => {
    if (!engine.status().available || engine.settings().mode === "pause") return res.status(409).json({ error: "AUTOMATION_UNAVAILABLE_OR_PAUSED" });
    void engine.tick().catch(() => {}); res.status(202).json({ ok: true });
  });
  app.get(`${base}/articles/:id`, requireAdmin, (req, res) => {
    try { res.json(engine.article(Number(req.params.id))); } catch (e) { err(res, e); }
  });
  const editSchema = z.object({
    title: z.string().max(120).optional(), excerpt: z.string().max(200).optional(),
    content: z.string().max(35000).optional(), metaTitle: z.string().max(65).optional(),
    metaDescription: z.string().max(165).optional(), claims: z.array(z.any()).max(15).optional(),
    revisionId: z.number().int().positive().optional(), publish: z.boolean().optional(),
  }).strict();
  app.patch(`${base}/articles/:id`, requireAdmin, async (req, res) => {
    try { res.json(await engine.edit(Number(req.params.id), editSchema.parse(req.body))); } catch (e) { err(res, e); }
  });
  app.post(`${base}/articles/:id/unpublish`, requireAdmin, (req, res) => {
    try { engine.unpublish(Number(req.params.id)); res.json({ ok: true }); } catch (e) { err(res, e); }
  });
  app.get("/api/blog/posts", (req, res) => res.json(publicList(db, req.query)));
  app.get("/api/blog/posts/:slug", (req, res) => {
    const p = publicArticle(db, String(req.params.slug));
    if (!p) return res.status(404).json({ error: "Article not found" });
    res.setHeader("Cache-Control", "no-store"); res.json(p);
  });
  app.get(["/blog", "/blog/:slug", "/public-blog/html", "/public-blog/html/:slug"], (req, res) => {
    const page = renderBlog(db, req.params.slug as string | undefined, req.query);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.status(page.status).type("html").send(page.html);
  });
  app.get(["/sitemap-blog.xml", "/public-blog/sitemap.xml"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.type("application/xml").send(blogSitemap(db));
  });
  // Wake on intervals, never exact wall-minute equality; SQL leases also cover manual/parallel instances.
  // Deployment gate is checked inside tick. Registering/migrating alone never publishes.
  if (process.env.NODE_ENV !== "test") {
    const status = engine.status();
    console.log("[auto-blogger] startup", JSON.stringify({ deploymentEnabled: status.deploymentEnabled, mode: status.settings.mode,
      providers: status.providers, reason: status.reason, diagnostics: status.diagnostics }));
    const wake = () => { void engine.tick().catch(() => console.error("[auto-blogger] SCHEDULER_ERROR")); };
    const first = setTimeout(wake, 15000); first.unref();
    const timer = setInterval(wake, 60000); timer.unref();
  }
  return engine;
}
