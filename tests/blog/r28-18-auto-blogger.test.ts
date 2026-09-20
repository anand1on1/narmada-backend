import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { AutoBlogger, catalogFeed, indiaDay, migrateAutoBlogger, slotTime } from "../../server/auto-blogger";
import { cleanHtml, assertPublicSource, publicAddress, similarity, validateArticle } from "../../server/auto-blogger-safety";
import { LiveBlogProviders, type BlogProviders } from "../../server/auto-blogger-providers";
import { publicArticle, publicList, blogSitemap, renderBlog, registerAutoBloggerRoutes } from "../../server/auto-blogger-routes";
import { bloggerSettingsSchema, type BlogSource } from "../../shared/auto-blogger";

const DAY = "2026-09-20", evening = slotTime(DAY, "18:00");
const sources: BlogSource[] = [
  { url: "https://www.tatamotors.com/technical", title: "Tata Motors", accessedAt: evening,
    text: "A maintenance record helps identify the components used on a commercial vehicle. Always follow the applicable service instructions for the vehicle being maintained." },
  { url: "https://www.cummins.com/parts", title: "Cummins", accessedAt: evening,
    text: "Record the part number when preparing a replacement component enquiry. The identification label is a starting point for gathering information before ordering." },
];
// Simulate substantial reference pages, not just the verbatim claim itself.
for (const source of sources) source.text += " " + Array.from({ length: 100 }, (_, i) => `evidencecontext${i}`).join(" ");
function draft(seed = "alpha") {
  const claim1 = "A maintenance record helps identify the components used on a commercial vehicle.";
  const claim2 = "Record the part number when preparing a replacement component enquiry.";
  const words = Array.from({ length: 480 }, (_, i) => `${seed}word${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(" ");
  const titles: Record<string, string> = {
    alpha: "Inspection evidence and practical procurement preparation",
    bravo: "Workshop service records supporting electrical enquiries",
    charlie: "Receiving components and documenting package condition",
    delta: "Maintenance planning with component identification documents",
  };
  return { title: titles[seed] || `${seed} inspection evidence practical preparation checklist`, excerpt: `A practical ${seed} checklist to prepare clear component enquiries with supporting documents and technical questions.`,
    content: `<h2>Gather information</h2><p>${claim1} <a href="${sources[0].url}">Tata Motors reference</a></p><h2>Ask precise questions</h2>
      <p>${words}</p><h2>Prepare your enquiry</h2><p>${claim2} <a href="${sources[1].url}">Cummins reference</a></p><p><a href="/products">Browse our catalog</a>.</p>`,
    metaTitle: `${seed} practical component checklist`, metaDescription: "Prepare a clear component enquiry using vehicle records, identification details and technical questions before asking for a quote.",
    claims: [{ claim: claim1, sourceUrl: sources[0].url, evidenceQuote: claim1 },
      { claim: claim2, sourceUrl: sources[1].url, evidenceQuote: claim2 }],
    productSlugs: ["brake-fixture"], improvementSummary: "", followUpTopics: [],
  };
}
let db: Database.Database, engine: AutoBlogger, provider: BlogProviders, server: Server | undefined;
beforeEach(() => {
  // Real isolated file-backed DB, not the developer/production DB.
  db = new Database(join(mkdtempSync(join(tmpdir(), "narmada-vitest-blog-")), "blog.db"));
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,name TEXT,brand TEXT,category TEXT,part_number TEXT,active INTEGER);
    CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,title TEXT,excerpt TEXT,content TEXT,meta_title TEXT,meta_description TEXT,
    author_name TEXT,published INTEGER DEFAULT 0,published_at INTEGER,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE quotation_items(part_number TEXT,description TEXT,customer_name TEXT,unit_price REAL);
    CREATE TABLE po_items(part_number TEXT,description TEXT,vendor_name TEXT,purchase_cost REAL);
    INSERT INTO products VALUES(1,'brake-fixture','Private Name Never Sent','Tata','brakes','PUBLIC-PN-1',1);
    INSERT INTO products VALUES(2,'filter-fixture','Filter','Volvo','filters','PN-2',1);
    INSERT INTO quotation_items VALUES('PUBLIC-PN-1','John phone +919999999999','PRIVATE CUSTOMER',981.23);
    INSERT INTO po_items VALUES('PUBLIC-PN-1','private@example.com','PRIVATE VENDOR',123.45);`);
  let n = 0;
  provider = {
    status: () => ({ ready: true, research: true, generation: true }),
    research: vi.fn(async () => sources),
    generate: vi.fn(async () => ({ draft: draft(["alpha", "bravo", "charlie", "delta"][n++]), tokens: 2000 })),
    review: vi.fn(async () => ({ supported: true, tokens: 500 })),
  };
  engine = new AutoBlogger(db, provider, () => true);
});
afterEach(async () => {
  if (server) { await new Promise<void>(r => server!.close(() => r())); server = undefined; }
  db.close(); vi.unstubAllEnvs();
});
const jobs = () => db.prepare("SELECT * FROM blog_jobs ORDER BY id").all() as any[];
const posts = () => db.prepare("SELECT * FROM posts ORDER BY id").all() as any[];

describe("durable schedules, concurrency and budgets", () => {
  it("uses IST boundaries, ordered configurable slots and two fixed new-post slots", () => {
    expect(indiaDay(Date.parse("2026-09-19T18:29:59Z"))).toBe("2026-09-19");
    expect(indiaDay(Date.parse("2026-09-19T18:30:00Z"))).toBe(DAY);
    expect(new Date(slotTime(DAY, "09:00")).toISOString()).toBe("2026-09-20T03:30:00.000Z");
    expect(() => bloggerSettingsSchema.parse({ morning: "18:00" })).toThrow();
    expect(() => bloggerSettingsSchema.parse({ dailyNewCap: 3 })).toThrow();
    engine.enqueueDue(evening); engine.enqueueDue(evening);
    expect(jobs().map(j => j.slot)).toEqual(["new-am", "improve", "new-pm"]);
    expect(jobs().every(j => j.day === DAY)).toBe(true);
  });
  it("does not publish just by migrating or while deployment/providers are unavailable", async () => {
    migrateAutoBlogger(db);
    const disabled = new AutoBlogger(db, provider, () => false);
    await disabled.tick(evening);
    expect(jobs()).toHaveLength(0); expect(disabled.status().reason).toBe("DEPLOYMENT_NOT_ENABLED");
    provider.status = () => ({ ready: false, generation: false, research: false });
    await engine.tick(evening); expect(posts()).toHaveLength(0);
    expect(engine.status().reason).toBe("PROVIDERS_NOT_CONFIGURED");
  });
  it("catches up today's slots after restart without replaying historical days", async () => {
    db.prepare("INSERT INTO blog_jobs(day,slot,kind,due_at,created_at) VALUES('2026-09-19','new-am','new',0,0)").run();
    await engine.tick(evening);
    await new AutoBlogger(db, provider, () => true).tick(evening);
    await engine.tick(evening);
    expect(jobs().filter(j => j.day === DAY)).toHaveLength(3);
    expect(jobs()[0].status).toBe("expired");
    expect(posts().filter(p => p.published)).toHaveLength(2);
    await engine.tick(evening); expect(posts()).toHaveLength(2);
  });
  it("leases prevent overlap across instances and simultaneous manual wakes", async () => {
    let resolve!: () => void;
    provider.research = vi.fn(() => new Promise<BlogSource[]>(r => { resolve = () => r(sources); }));
    const first = engine.tick(evening);
    await new AutoBlogger(db, provider, () => true).tick(evening);
    expect(provider.research).toHaveBeenCalledTimes(1); resolve(); await first;
    expect(posts()).toHaveLength(1);
  });
  it("reclaims an abandoned lease but fences out its stale token", async () => {
    engine.enqueueDue(evening);
    db.prepare("UPDATE blog_jobs SET status='running',attempts=1,lease_until=?,lease_token='dead' WHERE id=1").run(evening - 1);
    db.prepare("UPDATE blog_worker_lock SET token='dead',expires=?").run(evening - 1);
    await engine.tick(evening);
    expect(jobs()[0].status).toBe("succeeded"); expect(jobs()[0].attempts).toBe(2);
  });
  it("retries transient failures with bounded backoff; never stores raw provider errors", async () => {
    provider.research = vi.fn(async () => { throw new Error("PROVIDER_RATE_LIMIT"); });
    await engine.tick(evening);
    expect(jobs()[0].status).toBe("retry"); expect(jobs()[0].attempts).toBe(1);
    await engine.tick(evening + 1000); // skips new-am backoff, handles improvement skip
    expect(jobs()[0].attempts).toBe(1);
    await engine.tick(evening + 6 * 60000);
    expect(jobs()[0].attempts).toBe(2);
    provider.research = vi.fn(async () => { throw new Error("secret-api-key private@example.com"); });
    await engine.tick(evening + 17 * 60000);
    expect(jobs()[0].error_code).toBe("INTERNAL_JOB_ERROR");
    expect(JSON.stringify(engine.status())).not.toContain("secret-api-key");
  });
  it("has finite daily reservations and draft cap; manual drafts never publish", async () => {
    engine.setSettings({ ...engine.settings(), mode: "draft", dailyTokenBudget: 60000 });
    engine.enqueueDraft(slotTime(DAY, "08:00"));
    expect(() => engine.enqueueDraft(slotTime(DAY, "08:00"))).toThrow("DRAFT_DAILY_CAP");
    await engine.tick(slotTime(DAY, "08:01"));
    expect(posts()[0].published).toBe(0);
    await engine.tick(evening);
    expect(jobs().some(j => j.error_code === "DAILY_PROVIDER_BUDGET")).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it("pause prevents publication even when changed during an in-flight job", async () => {
    provider.review = vi.fn(async () => {
      engine.setSettings({ ...engine.settings(), mode: "pause" });
      return { supported: true, tokens: 1 };
    });
    await engine.tick(evening);
    expect(posts()).toHaveLength(0); expect(jobs()[0].error_code).toBe("PAUSED_DURING_JOB");
  });
});

describe("grounded planning, retrieval and editorial validation", () => {
  it("never sends private line text, identities or prices; public normalized identifiers are allowed", async () => {
    const feed = JSON.stringify(catalogFeed(db));
    expect(feed).not.toMatch(/PRIVATE|John|PN-SECRET|999999|981.23|123.45|example.com|Private Name/);
    expect(feed).toContain("PUBLIC-PN-1");
    await engine.tick(evening);
    expect(JSON.stringify(vi.mocked(provider.generate).mock.calls)).not.toMatch(/PRIVATE|PN-SECRET|customer_name|purchase_cost/);
  });
  it("creates persistent clusters and a diverse deduplicated queue, not city clones", () => {
    const n = engine.plan(evening); expect(n).toBeGreaterThan(3);
    const rows = db.prepare("SELECT * FROM blog_topics").all() as any[];
    expect(new Set(rows.map(r => r.intent)).size).toBeGreaterThan(2);
    engine.plan(evening);
    expect(db.prepare("SELECT COUNT(*) n FROM blog_topics").get()).toEqual({ n });
    expect(similarity("Selecting brake pads for fleet maintenance", "Fleet maintenance: selecting brake pads")).toBe(1);
  });
  it("replenishes future questions from cited research with persisted provenance", async () => {
    provider.generate = vi.fn(async () => ({ draft: { ...draft(), followUpTopics: [{
      title: "What information should a component identification label capture?",
      sourceUrl: sources[1].url, evidenceQuote: draft().claims[1].evidenceQuote,
    }] }, tokens: 1 }));
    await engine.tick(evening);
    const topics = db.prepare("SELECT * FROM blog_topics WHERE intent='research-discovery'").all() as any[];
    expect(topics).toHaveLength(1);
    expect(db.prepare("SELECT source_url FROM blog_topic_signals WHERE topic_id=?").get(topics[0].id)).toEqual({ source_url: sources[1].url });
  });
  it("rejects unsafe HTML, invented links, unsupported claims and private details", () => {
    expect(cleanHtml('<svg onload="alert(1)"></svg><script>alert(1)</script><p style="x" onclick="x">Safe<a href="javascript:alert(1)">bad</a></p>')).toBe("<p>Safe<a rel=\"noopener noreferrer\">bad</a></p>");
    expect(() => validateArticle(db, { ...draft(), content: draft().content + "<script>x</script>" }, sources)).toThrow("UNSAFE_HTML");
    expect(() => validateArticle(db, { ...draft(), content: draft().content.replace("/products", "/product/invented") }, sources)).toThrow("INTERNAL_LINK_INVALID");
    expect(() => validateArticle(db, { ...draft(), title: "Narmada Mobility exclusive best supplier" }, sources)).toThrow("UNSUPPORTED_COMMERCIAL_CLAIM");
    expect(() => validateArticle(db, { ...draft(), excerpt: "Please contact private@example.com to discuss this transaction with our friendly representative." }, sources)).toThrow("PRIVACY_CHECK_FAILED");
    expect(() => validateArticle(db, { ...draft(), claims: [{ ...draft().claims[0], evidenceQuote: "An invented quote that is not actually from this reference." }, draft().claims[1]] }, sources)).toThrow("CLAIM_NOT_GROUNDED");
  });
  it("rejects localhost, private targets, IP literals, credential URLs and deceptive domains", () => {
    for (const url of ["http://www.tatamotors.com", "https://127.0.0.1", "https://tatamotors.com.evil.test", "https://localhost",
      "https://u:p@tatamotors.com", "https://tatamotors.com:8443", "file:///etc/passwd"]) expect(() => assertPublicSource(url)).toThrow();
    for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "100.64.0.1"]) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
  it("fails closed when the independent factual review rejects output", async () => {
    provider.review = vi.fn(async () => ({ supported: false, tokens: 10 }));
    await engine.tick(evening); expect(posts()).toHaveLength(0);
    expect(jobs()[0].error_code).toBe("EDITORIAL_REVIEW_FAILED");
  });
  it("rejects near duplicate articles, even with a changed title", async () => {
    await engine.tick(evening);
    expect(() => validateArticle(db, { ...draft(), title: "Different title completely new practical advice" }, sources)).toThrow("ARTICLE_TOO_SIMILAR");
  });
});

describe("revisions, public visibility, rendering and admin boundary", () => {
  it("improves older posts without changing URL or original date, and supports rollback", async () => {
    await engine.tick(evening);
    const old = posts()[0];
    db.prepare("UPDATE posts SET updated_at=? WHERE id=?").run(evening - 8 * 86400000, old.id);
    provider.generate = vi.fn(async () => ({ draft: { ...draft("delta"), improvementSummary: "Added a documented receiving checklist." }, tokens: 10 }));
    await engine.tick(evening);
    const updated = posts()[0];
    expect(updated.slug).toBe(old.slug); expect(updated.published_at).toBe(old.published_at);
    expect(updated.title).not.toBe(old.title);
    const before = (engine.article(old.id).revisions as any[]).find(r => r.reason === "before-improvement");
    await engine.edit(old.id, { revisionId: before.id }, evening + 1000);
    expect(posts()[0].title).toBe(old.title); expect(posts()[0].slug).toBe(old.slug);
  });
  it("skips unsupported/non-substantive improvements", async () => {
    await engine.tick(evening);
    db.prepare("UPDATE posts SET updated_at=?").run(evening - 8 * 86400000);
    provider.generate = vi.fn(async () => ({ draft: { ...draft(), improvementSummary: "Changed wording." }, tokens: 10 }));
    await engine.tick(evening);
    expect(jobs()[1].status).toBe("skipped");
  });
  it("excludes drafts/unpublished from all public APIs/SSR/sitemap and sanitizes legacy HTML", async () => {
    await engine.tick(evening);
    const p = posts()[0];
    const page = renderBlog(db, p.slug);
    expect(page.status).toBe(200); expect(page.html).toContain(`https://narmadamobility.com/blog/${p.slug}`);
    expect(page.html).toContain('"@type":"Article"'); expect(page.html).toContain('"dateModified":"2026-');
    expect(page.html).toContain("Narmada Mobility Editorial Desk");
    expect(page.html).toContain("wa.me/917909083806");
    expect(publicArticle(db, p.slug)).not.toHaveProperty("snapshot");
    engine.unpublish(p.id);
    expect(publicArticle(db, p.slug)).toBeNull(); expect(renderBlog(db, p.slug).status).toBe(404);
    expect(blogSitemap(db)).not.toContain(p.slug); expect(publicList(db).total).toBe(0);
  });
  it("paginates search and category filters with published-only results", () => {
    const insert = db.prepare("INSERT INTO posts(slug,title,excerpt,content,published,created_at,updated_at) VALUES(?,?,?,'safe',1,0,0)");
    for (let i = 0; i < 30; i++) insert.run(`test-${i}`, `Technical ${i}`, `brake checklist ${i}`);
    expect(publicList(db, { page: 2 }).items).toHaveLength(12);
    expect(publicList(db, { q: "brake" }).total).toBe(30);
    expect(publicList(db, { category: "unknown" }).total).toBe(0);
    expect(publicList(db, { q: "%" }).total).toBe(0);
    expect(publicList(db, { page: "-4" }).page).toBe(1);
    expect(renderBlog(db, undefined, { q: "<script>" }).html).not.toContain('value="<script>');
  });
  it("requires injected admin guard for every control; public pages remain read-only", async () => {
    const app = express(); app.use(express.json());
    registerAutoBloggerRoutes(app, db, (req, res, next) => {
      if (req.headers["x-admin-token"] === "admin") next(); else res.status(req.headers["x-team-token"] ? 403 : 401).end();
    }, engine);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server!.on("listening", r));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    expect((await fetch(`${origin}/api/admin/auto-blogger`)).status).toBe(401);
    expect((await fetch(`${origin}/api/admin/auto-blogger`, { headers: { "x-team-token": "team" } })).status).toBe(403);
    expect((await fetch(`${origin}/api/admin/auto-blogger`, { headers: { "x-admin-token": "admin" } })).status).toBe(200);
    expect((await fetch(`${origin}/public-blog/html`)).status).toBe(200);
    expect((await fetch(`${origin}/public-blog/html/nope`)).status).toBe(404);
    expect((await fetch(`${origin}/public-blog/html`, { method: "POST" })).status).toBe(404);
  });
  it("bounds growing admin article lists to twenty with stable non-overlapping pages", () => {
    const insert = db.prepare("INSERT INTO posts(slug,title,excerpt,content,published,created_at,updated_at) VALUES(?,?,'Summary','safe',1,0,0)");
    for (let i = 0; i < 31; i++) {
      const id = insert.run(`managed-${i}`, `Managed article ${i}`).lastInsertRowid;
      db.prepare("INSERT INTO blog_articles(post_id,category,snapshot,updated_at) VALUES(?,'procurement','{}',0)").run(id);
    }
    const first = engine.status(evening, 1), second = engine.status(evening, 2);
    expect(first.articleTotal).toBe(31); expect(first.articlePages).toBe(2);
    expect(first.articles).toHaveLength(20); expect(second.articles).toHaveLength(11);
    expect(new Set([...first.articles, ...second.articles].map((p: any) => p.id)).size).toBe(31);
    expect(engine.status(evening, 999).articlePage).toBe(2);
    expect(engine.status(evening, -1).articlePage).toBe(1);
  });
  it("rechecks the deployment gate before a reviewed manual publication is committed", async () => {
    engine.setSettings({ ...engine.settings(), mode: "draft" });
    await engine.tick(evening);
    const id = posts()[0].id;
    let enabled = true;
    const gated = new AutoBlogger(db, provider, () => enabled);
    provider.review = vi.fn(async () => { enabled = false; return { supported: true, tokens: 1 }; });
    await expect(gated.edit(id, { publish: true }, evening)).rejects.toThrow("PROVIDERS_UNAVAILABLE");
    expect(posts()[0].published).toBe(0);
  });
  it("wires real admin-only middleware and blocks legacy managed-article mutation bypass", () => {
    const routes = readFileSync("server/routes-v2.ts", "utf8");
    expect(routes).toContain("registerAutoBloggerRoutes(app, rawSqlite, requireAdminRole)");
    expect(routes.match(/if \(managedPost\(id\)\)/g)).toHaveLength(2);
  });
});

describe("production provider HTTP contracts (mocked transport only)", () => {
  it("reports missing real credentials rather than returning a mock article", async () => {
    vi.stubEnv("CLAUDE_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TAVILY_API_KEY", ""); vi.stubEnv("PERPLEXITY_API_KEY", "");
    const live = new LiveBlogProviders();
    expect(live.status().ready).toBe(false);
    await expect(live.research("test")).rejects.toThrow("RESEARCH_NOT_CONFIGURED");
    await expect(live.generate({})).rejects.toThrow("GENERATION_NOT_CONFIGURED");
  });
  it("calls fixed Tavily search and Anthropic APIs with bounded schema/usage; rejects unsafe evidence", async () => {
    vi.stubEnv("CLAUDE_API_KEY", "fixture"); vi.stubEnv("TAVILY_API_KEY", "fixture");
    const http = vi.fn(async (url: any, options: any) => {
      const body = JSON.parse(options.body);
      expect(options.redirect).toBe("error");
      if (String(url).includes("tavily")) {
        expect(body.include_domains).toContain("tatamotors.com");
        return Response.json({ results: [{ url: "https://127.0.0.1/private" }, ...sources.map(s => ({ url: s.url }))] });
      }
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(options.headers["anthropic-version"]).toBe("2023-06-01");
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body.max_tokens === 300 ? { supported: true } : draft()) }],
        usage: { input_tokens: 100, output_tokens: 50 } });
    });
    const reader = vi.fn(async (url: string) => sources.find(s => s.url === url)!);
    const live = new LiveBlogProviders(http as any, reader);
    expect(await live.research("Tata technical")).toHaveLength(2);
    expect(reader).toHaveBeenCalledTimes(2);
    expect((await live.generate({ sources })).tokens).toBe(150);
    expect((await live.review(draft(), sources)).supported).toBe(true);
  });
  it("supports existing Perplexity key with actual sonar citation contract", async () => {
    vi.stubEnv("TAVILY_API_KEY", ""); vi.stubEnv("PERPLEXITY_API_KEY", "fixture");
    const http = vi.fn(async (url: any, options: any) => {
      expect(url).toBe("https://api.perplexity.ai/chat/completions");
      expect(JSON.parse(options.body).model).toBe("sonar");
      return Response.json({ citations: sources.map(s => s.url) });
    });
    const live = new LiveBlogProviders(http as any, async url => sources.find(s => s.url === url)!);
    expect(await live.research("technical references")).toHaveLength(2);
  });
  it("rejects provider error/truncated/oversized JSON without persisting provider body", async () => {
    vi.stubEnv("CLAUDE_API_KEY", "fixture");
    const truncated = new LiveBlogProviders((async () => Response.json({ stop_reason: "max_tokens", content: [] })) as any);
    await expect(truncated.generate({})).rejects.toThrow("GENERATION_TRUNCATED");
    const error = new LiveBlogProviders((async () => new Response("secret body", { status: 429 })) as any);
    await expect(error.generate({})).rejects.toThrow("PROVIDER_RATE_LIMIT");
  });
});
