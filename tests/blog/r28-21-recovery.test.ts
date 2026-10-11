import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import type { Server } from "node:http";
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
import { AutoBlogger, slotTime, TOKEN_RESERVATION } from "../../server/auto-blogger";
import { LiveBlogProviders, type BlogProviders } from "../../server/auto-blogger-providers";
import { readEvidence, validateArticle } from "../../server/auto-blogger-safety";
import { articleDraftSchema } from "../../shared/auto-blogger";
import { publicArticle, publicList, blogSitemap, renderBlog, registerAutoBloggerRoutes } from "../../server/auto-blogger-routes";
import { fixtureDay, fixtureUrls, fixturePages, realisticDraft } from "./recovery-fixture";

const morning = slotTime(fixtureDay, "12:49");
let db: Database.Database, engine: AutoBlogger, provider: LiveBlogProviders, http: ReturnType<typeof vi.fn>, dbPath: string;
let server: Server | undefined;
let sourceReply: (url: string) => { status?: number; body: Buffer | string; encoding?: string; location?: string; type?: string };
const sources = () => fixturePages.map((text, i) => ({ text, url: fixtureUrls[i], title: "Offline technical fixture", accessedAt: morning }));
const job = (id = 1) => db.prepare("SELECT * FROM blog_jobs WHERE id=?").get(id) as any;
const usage = () => engine.status(morning).today.usage;
function addFailed(id: number, error = "TOPIC_QUEUE_EMPTY", attempts = 1, day = fixtureDay, topicId?: number) {
  db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,retry_at,topic_id,error_code,created_at,finished_at)
    VALUES(?,? ,?,'new','failed',?,0,0,?,?,?,?)`).run(id, day, `recorded-${id}`, attempts, topicId ?? null, error, morning - 2 * 86400000, morning - 2 * 86400000);
}
beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), "narmada-vitest-recovery-")), "fixture.db");
  db = new Database(dbPath);
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,brand TEXT,category TEXT,part_number TEXT,active INTEGER,name TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,title TEXT,excerpt TEXT,content TEXT,meta_title TEXT,
      meta_description TEXT,author_name TEXT,published INTEGER,published_at INTEGER,created_at INTEGER,updated_at INTEGER);
    INSERT INTO products VALUES(1,'brake-fixture','Tata','brakes','TEST-BRAKE',1,'Brake');
    INSERT INTO products VALUES(2,'filter-fixture','Cummins','filter','TEST-FILTER',1,'Filter');
    INSERT INTO posts VALUES(100,'buy-tata-spare-parts-delhi','Legacy manually authored article',
      'Legacy excerpt','Untouched legacy content','Legacy title','Legacy description','Original author',1,1,1,1);`);
  network.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  sourceReply = url => {
    const i = fixtureUrls.indexOf(url);
    return i < 0 ? { status: 403, body: "Access denied" } :
      { body: gzipSync(`<header>${"Navigation ".repeat(100)}</header><main><p>${fixturePages[i]}</p></main>`), encoding: "gzip" };
  };
  network.request.mockReset().mockImplementation((url: URL, _options: any, callback: any) => {
    const req = new EventEmitter() as any;
    req.destroy = (e?: Error) => { if (e) req.emit("error", e); req.emit("close"); };
    req.end = () => queueMicrotask(() => {
      const next = sourceReply(url.href);
      const res = Readable.from([Buffer.from(next.body)]) as any;
      res.statusCode = next.status || 200;
      res.headers = { "content-type": next.type || "text/html", "content-encoding": next.encoding, location: next.location };
      res.on("end", () => req.emit("close"));
      callback(res);
    });
    return req;
  });
  vi.stubEnv("CLAUDE_API_KEY", "offline-fixture"); vi.stubEnv("TAVILY_API_KEY", "offline-fixture");
  http = vi.fn(async (url: string, options: any) => {
    const body = JSON.parse(options.body);
    if (url.includes("tavily")) return Response.json({ results: [
      { url: "https://127.0.0.1/private" }, ...[1, 2, 3, 4].map(i => ({ url: `https://www.tatamotors.com/blocked-${i}` })),
      ...fixtureUrls.map(url => ({ url })),
    ] });
    return Response.json({ stop_reason: "end_turn", content: [{ type: "text",
      text: JSON.stringify(body.max_tokens === 300 ? { supported: true } : realisticDraft()) }],
      usage: { input_tokens: 1400, output_tokens: body.max_tokens === 300 ? 15 : 2200 } });
  });
  provider = new LiveBlogProviders(http as any);
  engine = new AutoBlogger(db, provider, () => true);
  engine.setSettings({ ...engine.settings(), morning: "12:48", evening: "16:00" });
});
afterEach(async () => {
  if (server) { await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe("R28.21 recorded production failure recovery", () => {
  it("runs real adapters, compressed authoritative retrieval, validation, review, publication and public delivery without live calls", async () => {
    await engine.tick(morning);
    expect(job()).toMatchObject({ status: "succeeded", attempts: 1, calls: 3, token_reserved: 60000 });
    expect(network.request).toHaveBeenCalledTimes(6); // first FOUR references fail; fifth/sixth succeed
    expect(http).toHaveBeenCalledTimes(3);
    const search = JSON.parse(http.mock.calls[0][1].body);
    expect(search.query).toMatch(/parts identification documentation manufacturer/);
    const publicPost = publicArticle(db, realisticDraft().title.toLowerCase().replace(/[^a-z0-9]+/g, "-"))!;
    expect(publicPost).toBeTruthy();
    expect(publicList(db, {}).total).toBe(2);
    expect(blogSitemap(db)).toContain(publicPost.slug);
    const rendered = renderBlog(db, publicPost.slug);
    expect(rendered.status).toBe(200);
    expect(rendered.html).toContain("Start with what you can document");
    expect(rendered.html).toContain('rel="canonical"');
    expect(rendered.html).toContain(`https://narmadamobility.com/blog/${publicPost.slug}`);
    expect(rendered.html).toContain('application/ld+json');
    expect(db.prepare("SELECT COUNT(*) n FROM blog_topic_signals").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_topics WHERE intent='research-discovery'").get()).toEqual({ n: 1 });
    const legacy = db.prepare("SELECT * FROM posts WHERE id=100").get() as any;
    expect(legacy).toMatchObject({ slug: "buy-tata-spare-parts-delhi", content: "Untouched legacy content", published: 1, updated_at: 1 });
    expect(usage()).toEqual({ calls: 3, tokens: 60000 });
  });
  it("repairs exact job26 excerpt247 and optional followup quote22 without inventing evidence or another paid call", async () => {
    const output = realisticDraft();
    output.excerpt = "A useful procurement enquiry records the vehicle, component and unresolved questions. ".repeat(3).slice(0, 247);
    expect(output.excerpt).toHaveLength(247);
    output.followUpTopics.push({ title: "What questions should accompany uncertain markings on a label?",
      sourceUrl: fixtureUrls[1], evidenceQuote: "x".repeat(22) });
    const raw = articleDraftSchema.safeParse(output);
    expect(raw.success).toBe(false);
    if (!raw.success) expect(raw.error.issues.map(i => i.path.join("."))).toEqual(["excerpt", "followUpTopics.1.evidenceQuote"]);
    const realGenerate = provider.generate.bind(provider);
    provider.generate = async context => { const result = await realGenerate(context); return { ...result, draft: output }; };
    await engine.tick(morning);
    expect(job().status).toBe("succeeded");
    const saved = engine.article(job().post_id).snapshot;
    expect(saved.excerpt.length).toBeLessThanOrEqual(200);
    expect(saved.claims).toEqual(output.claims);
    expect(saved.followUpTopics).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(3);
  });
  it.each(["EVIDENCE_INSUFFICIENT", "EVIDENCE_SOURCES_UNREACHABLE", "PROVIDER_NETWORK_ERROR", "PROVIDER_TIMEOUT"])(
    "refunds never-started stages for repeated %s, leaving PM first-attempt budget intact", async code => {
      provider.research = vi.fn(async () => { throw new Error(code); });
      await engine.tick(morning); await engine.tick(morning + 6 * 60000); await engine.tick(morning + 17 * 60000);
      expect(job()).toMatchObject({ status: "failed", attempts: 3, calls: 3, token_reserved: 6000, error_code: code });
      expect(usage()).toEqual({ calls: 3, tokens: 6000 });
      provider.research = async () => sources();
      await engine.tick(slotTime(fixtureDay, "16:01")); // improvement skips
      await engine.tick(slotTime(fixtureDay, "16:02")); // PM
      const pm = db.prepare("SELECT * FROM blog_jobs WHERE slot='new-pm'").get() as any;
      expect(pm).toMatchObject({ status: "succeeded", calls: 3, attempts: 1 });
      expect(usage()).toEqual({ calls: 6, tokens: 66000 });
    });
  it("uses sanitized schema feedback after a file-backed restart and does not rerun completed slots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate = async () => ({ draft: { ...realisticDraft(), metaTitle: "private-generated-value".repeat(6) }, tokens: 1200 });
    await engine.tick(morning);
    expect(job()).toMatchObject({ status: "retry", calls: 2, token_reserved: 36000 });
    db.close(); db = new Database(dbPath);
    provider = new LiveBlogProviders(http as any);
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(morning + 6 * 60000);
    const generatedCall = http.mock.calls.find(c => c[0].includes("anthropic") && JSON.parse(c[1].body).max_tokens === 6000)!;
    const context = JSON.parse(JSON.parse(generatedCall[1].body).messages[0].content);
    expect(context.schemaFeedback).toContainEqual(expect.objectContaining({ field: "metaTitle", maximum: 65 }));
    expect(JSON.stringify(context)).not.toContain("private-generated-value");
    expect(context.repairInstruction).toContain("Never invent or extend quotations");
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2, calls: 5, token_reserved: 96000 });
    expect(engine.status(morning).jobs[0].schemaDiagnostics).toEqual([]);
    await engine.tick(morning + 8 * 60000);
    expect(job().attempts).toBe(2);
    warn.mockRestore();
  });
  it("settles only unsent stages once after an abandoned lease, never refunds ambiguous research or legacy reservations", async () => {
    engine.enqueueDue(morning);
    db.prepare(`UPDATE blog_jobs SET status='running',attempts=1,lease_token='dead',lease_until=?,
      calls=3,token_reserved=? WHERE id=1`).run(morning - 1, TOKEN_RESERVATION);
    db.prepare("INSERT INTO blog_usage VALUES(?,3,?)").run(fixtureDay, TOKEN_RESERVATION);
    db.prepare("INSERT INTO blog_attempt_budget VALUES('dead',1,?,1,2000,0)").run(fixtureDay);
    db.prepare("UPDATE blog_worker_lock SET token='dead',expires=?").run(morning - 1);
    await engine.tick(morning);
    expect(job()).toMatchObject({ status: "succeeded", calls: 4, token_reserved: 62000, attempts: 2 });
    expect(usage()).toEqual({ calls: 4, tokens: 62000 });
    await new AutoBlogger(db, provider, () => true).tick(morning + 1000);
    expect(usage()).toEqual({ calls: 4, tokens: 62000 });
    expect(db.prepare("SELECT settled FROM blog_attempt_budget WHERE lease_token='dead'").get()).toEqual({ settled: 1 });
  });
  it("fences a still-running stale worker from spending generation calls or overwriting a recovered success", async () => {
    let release!: () => void;
    const slow: BlogProviders = { status: () => provider.status(),
      research: () => new Promise(resolve => { release = () => resolve(sources()); }),
      generate: vi.fn(async () => ({ draft: realisticDraft(), tokens: 2000 })),
      review: vi.fn(async () => ({ supported: true, tokens: 100 })) };
    const pending = new AutoBlogger(db, slow, () => true).tick(morning);
    await engine.tick(morning + 6 * 60000);
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2, calls: 4, token_reserved: 62000 });
    release(); await pending;
    expect(slow.generate).not.toHaveBeenCalled();
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2, calls: 4, token_reserved: 62000 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 1 });
  });
  it("labels a new-job retry's protected budget correctly and never refunds historical untracked reservations", async () => {
    engine.setSettings({ ...engine.settings(), dailyTokenBudget: 120000, dailyCallBudget: 6 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.generate = async () => ({ draft: { ...realisticDraft(), excerpt: null }, tokens: 1200 });
    await engine.tick(morning);
    expect(usage()).toEqual({ calls: 2, tokens: 36000 });
    await engine.tick(morning + 6 * 60000);
    expect(job()).toMatchObject({ error_code: "BUDGET_RESERVED_FOR_OTHER_NEW_SLOT", calls: 2, token_reserved: 36000 });
    db.prepare("INSERT INTO blog_usage VALUES('2026-10-10',9,180000)").run();
    await engine.tick(morning + 7 * 60000);
    expect(db.prepare("SELECT calls,tokens FROM blog_usage WHERE day='2026-10-10'").get()).toEqual({ calls: 9, tokens: 180000 });
  });
  it("recovers the all-assigned exhausted queue without re-running its 13 historical jobs", async () => {
    engine.plan(morning - 8 * 86400000);
    // Reproduce the 13 assigned topics, including one real-research-style topic.
    db.prepare(`INSERT INTO blog_topics(fingerprint,title,cluster_id,intent,category,product_ids,status,created_at)
      VALUES('extra','How should uncertain part markings be documented before quotation?',3,'research-discovery','brake','[1]','assigned',?)`).run(morning - 8 * 86400000);
    const topics = db.prepare("SELECT * FROM blog_topics").all() as any[];
    expect(topics).toHaveLength(13);
    db.prepare("UPDATE blog_topics SET status='assigned'").run();
    topics.forEach((t, i) => addFailed(i + 10, "EVIDENCE_INSUFFICIENT", 3, "2026-10-03", t.id));
    const before = db.prepare("SELECT * FROM blog_jobs ORDER BY id").all();
    engine.plan(morning);
    const recovered = db.prepare("SELECT * FROM blog_topics WHERE status='queued'").all() as any[];
    expect(recovered.length).toBeGreaterThanOrEqual(4);
    expect(recovered.length).toBeLessThanOrEqual(12);
    expect(db.prepare("SELECT * FROM blog_jobs ORDER BY id").all()).toEqual(before);
    await engine.tick(morning);
    expect((db.prepare("SELECT COUNT(*) n FROM blog_jobs WHERE status='succeeded'").get() as any).n).toBe(1);
    expect(db.prepare("SELECT * FROM blog_jobs WHERE day='2026-10-03' ORDER BY id").all()).toEqual(before);
  });
  it("backs off failed topics for 1 then 2 days, respects ready-queue capacity and blocks the third episode and safety failures", () => {
    engine.plan(morning);
    const t = db.prepare("SELECT id FROM blog_topics ORDER BY id LIMIT 1").get() as any;
    addFailed(1, "EVIDENCE_INSUFFICIENT", 3, fixtureDay, t.id);
    db.prepare("UPDATE blog_jobs SET finished_at=? WHERE id=1").run(morning);
    db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(t.id);
    engine.plan(morning);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t.id)).toEqual({ status: "cooldown" });
    engine.plan(morning + 86400000);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t.id)).toEqual({ status: "cooldown" }); // ready queue full
    db.prepare("UPDATE blog_topics SET status='completed' WHERE id=(SELECT id FROM blog_topics WHERE status='queued' LIMIT 1)").run();
    engine.plan(morning + 86400000);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t.id)).toEqual({ status: "queued" });
    for (let cycle = 2; cycle <= 3; cycle++) {
      addFailed(cycle, "EVIDENCE_INSUFFICIENT", 3, fixtureDay, t.id);
      db.prepare("UPDATE blog_jobs SET finished_at=? WHERE id=?").run(morning, cycle);
      db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(t.id);
      engine.plan(morning);
      if (cycle === 2) expect(db.prepare("SELECT next_eligible_at FROM blog_topic_recovery WHERE topic_id=?").get(t.id))
        .toEqual({ next_eligible_at: morning + 2 * 86400000 });
    }
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t.id)).toEqual({ status: "blocked" });
    engine.plan(morning + 30 * 86400000);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t.id)).toEqual({ status: "blocked" });
    const second = db.prepare("SELECT id FROM blog_topics WHERE id!=? LIMIT 1").get(t.id) as any;
    addFailed(4, "PRIVACY_CHECK_FAILED", 1, fixtureDay, second.id);
    db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(second.id);
    engine.plan(morning);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(second.id)).toEqual({ status: "blocked" });
  });
  it("does not recover topics held by a retry or by a saved draft; planning stays deduplicated and diverse", async () => {
    engine.setSettings({ ...engine.settings(), mode: "pause" });
    const id = Number(engine.enqueueDraft(morning));
    await engine.tick(morning, id);
    const t = job(id).topic_id;
    db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(t);
    engine.plan(morning + 30 * 86400000);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(t)).toEqual({ status: "assigned" });
    const another = db.prepare("SELECT id FROM blog_topics WHERE status='queued' LIMIT 1").get() as any;
    addFailed(2, "EVIDENCE_INSUFFICIENT", 1, fixtureDay, another.id);
    db.prepare("UPDATE blog_jobs SET status='retry' WHERE id=2").run();
    db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(another.id);
    engine.plan(morning);
    expect(db.prepare("SELECT status FROM blog_topics WHERE id=?").get(another.id)).toEqual({ status: "assigned" });
    const topics = db.prepare("SELECT * FROM blog_topics").all() as any[];
    expect(new Set(topics.map(t => t.fingerprint)).size).toBe(topics.length);
    expect(new Set(topics.map(t => t.category)).size).toBe(2);
    expect(new Set(topics.map(t => t.intent)).size).toBeGreaterThan(3);
  });
  it("plans a fresh distinct batch after the first batch is quarantined instead of cycling blocked topics", () => {
    engine.plan(morning);
    const first = db.prepare("SELECT id,title FROM blog_topics").all() as any[];
    db.prepare("UPDATE blog_topics SET status='blocked'").run();
    expect(engine.plan(morning + 86400000)).toBeGreaterThan(0);
    const ready = db.prepare("SELECT * FROM blog_topics WHERE status='queued'").all() as any[];
    expect(ready.length).toBeLessThanOrEqual(12);
    expect(ready.every(t => !first.some(old => old.id === t.id || old.title === t.title))).toBe(true);
    expect(ready.some(t => ["identification", "documentation", "clarification", "traceability", "records", "verification"].includes(t.intent))).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM blog_topics WHERE status='blocked'").get() as any).n).toBe(first.length);
  });
  it("accepts a substantive reviewed addition to an older article while preserving URL/date and skipping cosmetic rewrites", async () => {
    await engine.tick(morning);
    const id = job().post_id, old = engine.article(id);
    const draft = realisticDraft();
    draft.improvementSummary = "Added a practical handover and document-reconciliation section without introducing fitment claims.";
    draft.content += `<h2>Hand over the unanswered questions</h2><p>When another colleague takes over the enquiry,
      make a short handover note that explains the current decision rather than forwarding an unexplained pile
      of attachments. Identify which photograph belongs to which observation and which reply addresses each
      outstanding question. Where two documents disagree, keep both versions visible and explain why you have
      not treated either as conclusive. This helps the colleague continue the investigation without repeating
      assumptions that were already set aside. Before the request is closed, agree where the final clarification
      will be retained and how anyone reading the record can distinguish it from an earlier provisional answer.
      You can use a simple checklist for that handover; there is no need to claim that your internal recordkeeping
      method proves compatibility or replaces the applicable technical review.</p>`;
    provider.generate = async () => ({ draft, tokens: 2500 });
    db.prepare("UPDATE posts SET updated_at=? WHERE id=?").run(morning - 8 * 86400000, id);
    await engine.tick(slotTime(fixtureDay, "13:01"));
    const improved = engine.article(id);
    expect(improved.content).toContain("Hand over the unanswered questions");
    expect(improved.slug).toBe(old.slug);
    expect(improved.published_at).toBe(old.published_at);
    expect(improved.revisions).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "before-improvement" })]));
    // A date/heading-only tweak is not a substantive improvement.
    const { hasSubstantiveChange } = await import("../../server/auto-blogger-safety");
    expect(hasSubstantiveChange(draft.content.replace("Hand over", "Pass over"), draft.content)).toBe(false);
  });
  it("offers exactly one audited recovery for today's failed new slot without resetting attempts, budget or other jobs", async () => {
    addFailed(1);
    addFailed(2, "TOPIC_QUEUE_EMPTY", 3);
    addFailed(3, "TOPIC_QUEUE_EMPTY", 1, "2026-10-10");
    addFailed(4, "PRIVACY_CHECK_FAILED");
    const others = db.prepare("SELECT * FROM blog_jobs WHERE id!=1 ORDER BY id").all();
    engine.setSettings({ ...engine.settings(), mode: "pause" });
    expect(engine.recoverJob(1, morning)).toMatchObject({ attemptsRemaining: 2 });
    expect(job()).toMatchObject({ attempts: 1, calls: 0, token_reserved: 0 });
    for (const id of [1, 2, 3, 4, 999]) expect(() => engine.recoverJob(id, morning)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    await engine.tick(morning, 1);
    expect(job()).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(engine.article(job().post_id).published).toBe(0);
    expect(db.prepare("SELECT * FROM blog_jobs WHERE id!=1 ORDER BY id").all()).toEqual(others);
    expect(db.prepare("SELECT * FROM blog_job_recoveries").all()).toEqual([
      { job_id: 1, previous_error: "TOPIC_QUEUE_EMPTY", attempts_at_recovery: 1, recovered_at: morning },
    ]);
    const id = job().post_id;
    // Explicit admin publication: independent re-review and original daily cap.
    await engine.edit(id, { publish: true }, morning + 1000);
    expect(engine.article(id).published).toBe(1);
    expect(usage()).toEqual({ calls: 4, tokens: 86000 });
    expect((db.prepare("SELECT COUNT(*) n FROM blog_publications").get() as any).n).toBe(1);
  });
  it("will not reopen a failed job whose topic is blocked, already saved, or owned by another active job", () => {
    engine.plan(morning);
    const t = db.prepare("SELECT id FROM blog_topics LIMIT 1").get() as any;
    addFailed(1, "EVIDENCE_INSUFFICIENT", 1, fixtureDay, t.id);
    db.prepare("UPDATE blog_topics SET status='blocked' WHERE id=?").run(t.id);
    expect(() => engine.recoverJob(1, morning)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(t.id);
    addFailed(2, "EVIDENCE_INSUFFICIENT", 1, fixtureDay, t.id);
    db.prepare("UPDATE blog_jobs SET status='retry' WHERE id=2").run();
    expect(() => engine.recoverJob(1, morning)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    db.prepare("UPDATE blog_jobs SET status='succeeded' WHERE id=2").run();
    db.prepare("INSERT INTO blog_articles VALUES(100,?,1,'brake','{}',?)").run(t.id, morning);
    expect(() => engine.recoverJob(1, morning)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    expect(db.prepare("SELECT COUNT(*) n FROM blog_job_recoveries").get()).toEqual({ n: 0 });
  });
  it("will not target yesterday across the IST boundary or implicitly wake other jobs", async () => {
    addFailed(1);
    engine.recoverJob(1, morning);
    engine.setSettings({ ...engine.settings(), mode: "pause" });
    await engine.tick(slotTime("2026-10-12", "00:01"), 1);
    expect(http).not.toHaveBeenCalled();
    expect(job().attempts).toBe(1);
  });
  it("never repairs invalid claim quotes or publishes a rejected factual review", async () => {
    const bad = realisticDraft();
    bad.claims[0].evidenceQuote = "This sentence is fabricated and is not present in the supplied evidence.";
    expect(() => validateArticle(db, bad, sources())).toThrow("CLAIM_NOT_GROUNDED");
    bad.claims[0].evidenceQuote = "x".repeat(22);
    expect(() => validateArticle(db, bad, sources())).toThrow("ARTICLE_SCHEMA_INVALID");
    expect(() => validateArticle(db, { ...realisticDraft(), excerpt: `<p>${"x".repeat(247)}</p>` }, sources()))
      .toThrow("ARTICLE_SCHEMA_INVALID");
    provider.review = async () => ({ supported: false, tokens: 20 });
    await engine.tick(morning);
    expect(job().error_code).toBe("EDITORIAL_REVIEW_FAILED");
    expect((db.prepare("SELECT COUNT(*) n FROM blog_articles").get() as any).n).toBe(0);
  });
  it("keeps recovery and targeted wake admin-only and passes only the selected id to the worker", async () => {
    vi.spyOn(Date, "now").mockReturnValue(morning);
    addFailed(1);
    const tick = vi.spyOn(engine, "tick").mockResolvedValue();
    const app = express(); app.use(express.json());
    registerAutoBloggerRoutes(app, db, (req, res, next) => {
      if (req.headers["x-admin-token"] !== "fixture-admin") return res.status(401).end();
      next();
    }, engine);
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/admin/auto-blogger`;
    expect((await fetch(`${url}/jobs/1/recover`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${url}/wake`, { method: "POST" })).status).toBe(401);
    const options = { method: "POST", headers: { "x-admin-token": "fixture-admin", "Content-Type": "application/json" } };
    expect((await fetch(`${url}/jobs/1/recover`, options)).status).toBe(200);
    expect((await fetch(`${url}/jobs/1/recover`, options)).status).toBe(400);
    engine.setSettings({ ...engine.settings(), mode: "pause" });
    expect((await fetch(`${url}/wake`, { ...options, body: "{}" })).status).toBe(409);
    expect((await fetch(`${url}/wake`, { ...options, body: '{"jobId":1}' })).status).toBe(202);
    expect(tick).toHaveBeenCalledExactlyOnceWith(morning, 1);
    expect((await fetch(`${url}/wake`, { ...options, body: '{"jobId":1,"resetAttempts":true}' })).status).toBe(400);
  });
});

describe("R28.21 precise transport and evidence safeguards", () => {
  it.each(["TimeoutError", "AbortError"])("classifies %s separately from generic network errors", async name => {
    const failing = new LiveBlogProviders((async () => { const e = new Error("private transport text"); e.name = name; throw e; }) as any);
    await expect(failing.generate({})).rejects.toThrow("PROVIDER_TIMEOUT");
  });
  it("distinguishes malformed JSON, body transport failure and oversized provider body", async () => {
    for (const [response, code] of [
      [new Response("{bad"), "PROVIDER_RESPONSE_INVALID"],
      [new Response(new ReadableStream({ start(c) { c.error(new Error("private-body-disconnect")); } })), "PROVIDER_NETWORK_ERROR"],
      [new Response("x".repeat(250001)), "PROVIDER_RESPONSE_TOO_LARGE"],
    ] as const) await expect(new LiveBlogProviders((async () => response) as any).generate({})).rejects.toThrow(code);
  });
  it("decodes Brotli, excludes navigation, rejects compressed expansion bombs and challenge HTML", async () => {
    sourceReply = () => ({ body: brotliCompressSync(`<nav>Navigation links</nav><article>${fixturePages[0]}</article>`), encoding: "br" });
    const page = await readEvidence(fixtureUrls[0]);
    expect(page.text).toContain(realisticDraft().claims[0].evidenceQuote);
    expect(page.text).not.toContain("Navigation");
    sourceReply = () => ({ body: gzipSync("x".repeat(750001)), encoding: "gzip" });
    await expect(readEvidence(fixtureUrls[0])).rejects.toThrow("SOURCE_TOO_LARGE");
    sourceReply = () => ({ body: `<p>Verify you are human ${"Browser challenge ".repeat(100)}</p>` });
    await expect(readEvidence(fixtureUrls[0])).rejects.toThrow("SOURCE_UNREACHABLE");
  });
  it("rejects unsafe redirects/DNS without requests to their targets", async () => {
    sourceReply = () => ({ status: 302, location: "https://169.254.169.254/metadata", body: "" });
    await expect(readEvidence(fixtureUrls[0])).rejects.toThrow("SOURCE_URL_REJECTED");
    expect(network.request).toHaveBeenCalledTimes(1);
    network.lookup.mockResolvedValue([{ address: "10.0.0.4", family: 4 }]);
    await expect(readEvidence(fixtureUrls[0])).rejects.toThrow("SOURCE_ADDRESS_REJECTED");
    expect(network.request).toHaveBeenCalledTimes(1);
  });
});
