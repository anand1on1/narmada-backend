import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutoBlogger, slotTime } from "../../server/auto-blogger";
import { BLOG_POLICY, BLOG_PROVIDER_TIMEOUTS, LiveBlogProviders, ProviderTransportError } from "../../server/auto-blogger-providers";
import { cleanHtml, validateArticle } from "../../server/auto-blogger-safety";
import { commercialDiagnostics } from "../../server/blog-commercial-policy";
import { fixtureUrls, fixturePages, realisticDraft } from "./recovery-fixture";

// Representative offline reproductions; job30's rejected text was not retained.
const now = slotTime("2026-10-12", "00:21");
let db: Database.Database, path: string, engine: AutoBlogger, provider: LiveBlogProviders;
let generated: () => ReturnType<typeof realisticDraft>, reviewSupported: boolean;
let http: ReturnType<typeof vi.fn>;
const sources = () => fixturePages.map((text, i) => ({ url: fixtureUrls[i], title: "Offline reference", text, accessedAt: now }));
const row = () => db.prepare("SELECT * FROM blog_jobs ORDER BY id LIMIT 1").get() as any;
const badDraft = () => ({ ...realisticDraft(), content: realisticDraft().content +
  "<p>PRIVATE_REJECTED_BODY A catalog listing does not prove that a part is in stock.</p>" });
function message(data: unknown) {
  return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }],
    usage: { input_tokens: 1400, output_tokens: 3778 } });
}
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "narmada-vitest-r28-22-")), "fixture.db");
  db = new Database(path);
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,brand TEXT,category TEXT,part_number TEXT,active INTEGER,name TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,title TEXT,excerpt TEXT,content TEXT,meta_title TEXT,
      meta_description TEXT,author_name TEXT,published INTEGER,published_at INTEGER,created_at INTEGER,updated_at INTEGER);
    INSERT INTO products VALUES(1,'brake-fixture','Tata','brakes','FIXTURE-BRAKE',1,'Brake');`);
  vi.stubEnv("CLAUDE_API_KEY", "offline-key"); vi.stubEnv("TAVILY_API_KEY", "offline-key");
  generated = realisticDraft; reviewSupported = true;
  http = vi.fn(async (url: string, options: any) => {
    const body = JSON.parse(options.body);
    if (url.includes("tavily")) return Response.json({ results: fixtureUrls.map(url => ({ url })) });
    return message(body.max_tokens === 300 ? { supported: reviewSupported } : generated());
  });
  provider = new LiveBlogProviders(http as any, async url => sources().find(s => s.url === url)!);
  engine = new AutoBlogger(db, provider, () => true);
  engine.setSettings({ ...engine.settings(), morning: "00:20", evening: "16:00" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("R28.22 commercial policy without factual-gate bypass", () => {
  it.each([
    ["A catalog listing does not prove that a part is in stock.", "STOCK_AVAILABILITY"],
    ["Ask an authorized supplier for manufacturer documentation.", "SELLER_AUTHORIZATION"],
    ["The manufacturer describes its authorized distributor network.", "SELLER_AUTHORIZATION"],
    ["This record does not establish exclusive rights to supply the component.", "EXCLUSIVITY"],
    ["Narmada Mobility offers guaranteed fit for this component.", "FITMENT_GUARANTEE"],
    ["Narmada Mobility offers the lowest price for genuine OEM parts.", "OEM_GENUINENESS"],
    ["The component can be collected from our warehouse.", "OWN_FACILITIES"],
  ])("reports only a safe field/rule for %s, with the original block preserved", (sentence, rule) => {
    const draft = { ...realisticDraft(), content: realisticDraft().content + `<p>${sentence}</p>` };
    try {
      validateArticle(db, draft, sources());
      throw new Error("expected conservative rejection");
    } catch (error: any) {
      expect(error.message).toBe("UNSUPPORTED_COMMERCIAL_CLAIM");
      expect(error.diagnostics).toContainEqual({ field: "content", rule });
      expect(JSON.stringify(error.diagnostics)).not.toContain(sentence);
    }
    expect(BLOG_POLICY).toContain(rule);
    expect(BLOG_POLICY).toContain("even in negated advice");
  });
  it("permits neutral advice and attributed paraphrase while retaining exact sourced evidence quotes", () => {
    const original = "The manufacturer describes its authorized distributor network.";
    const paraphrase = "The manufacturer describes its distributor network.";
    const evidence = sources(); evidence[0].text += ` ${original}`;
    const draft = realisticDraft();
    draft.content += `<p>A catalog listing is not evidence of current availability. Ask the supplier for manufacturer documentation. ${paraphrase}</p>`;
    draft.claims.push({ claim: paraphrase, sourceUrl: fixtureUrls[0], evidenceQuote: original });
    const validated = validateArticle(db, draft, evidence);
    expect(validated.claims[2].evidenceQuote).toBe(original);
    const fabricated = { ...draft, claims: [...draft.claims.slice(0, 2), { ...draft.claims[2], evidenceQuote: "This invented sentence is not actually in the supplied reference." }] };
    expect(() => validateArticle(db, fabricated, evidence)).toThrow("CLAIM_NOT_GROUNDED");
  });
  it("keeps the exact legacy deny-rule coverage in all five public fields, not just article body", () => {
    const blocked = ["exclusive", "authorized dealer", "authorised supplier", "authorized distributor", "authorised partner",
      "best supplier", "guaranteed fit", "in stock", "ready stock", "genuine OEM", "OEM genuine", "lowest price",
      "our branch", "our warehouse", "Narmada Motors"];
    for (const field of ["title", "excerpt", "content", "metaTitle", "metaDescription"] as const) {
      for (const phrase of blocked) {
        const fields = { title: "", excerpt: "", content: "", metaTitle: "", metaDescription: "", [field]: phrase };
        expect(commercialDiagnostics(fields)).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
      }
    }
  });
  it("uses persisted rule feedback once across restart, then validates/reviews and publishes through real adapters", async () => {
    generated = badDraft;
    await engine.tick(now);
    expect(row()).toMatchObject({ status: "retry", attempts: 1, calls: 2, token_reserved: 36000, token_used: 5178,
      error_code: "UNSUPPORTED_COMMERCIAL_CLAIM" });
    const status = engine.status(now);
    expect(status.jobs[0].commercialDiagnostics).toEqual([{ field: "content", rule: "STOCK_AVAILABILITY" }]);
    expect(status.jobs[0].nextAction).toContain("content/STOCK_AVAILABILITY");
    expect(JSON.stringify(status.jobs)).not.toContain("PRIVATE_REJECTED_BODY");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("PRIVATE_REJECTED_BODY");
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
    db.close(); db = new Database(path);
    generated = realisticDraft;
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(now + 6 * 60000);
    const requests = http.mock.calls.filter(c => c[0].includes("anthropic") && JSON.parse(c[1].body).max_tokens === 6000);
    const context = JSON.parse(JSON.parse(requests[1][1].body).messages[0].content);
    expect(context.commercialFeedback).toEqual([{ field: "content", rule: "STOCK_AVAILABILITY" }]);
    expect(context.commercialRepairInstruction).toContain("do not disguise them with synonyms");
    expect(JSON.stringify(context)).not.toContain("PRIVATE_REJECTED_BODY");
    expect(row()).toMatchObject({ status: "succeeded", attempts: 2, calls: 5, token_reserved: 96000 });
    expect(engine.article(row().post_id).published).toBe(1);
    expect(engine.status(now).jobs[0].commercialDiagnostics).toEqual([]);
  });
  it("does not repeat commercial corrections, reset caps or reopen a terminal unsafe job", async () => {
    generated = badDraft;
    await engine.tick(now); await engine.tick(now + 6 * 60000); await engine.tick(now + 17 * 60000);
    expect(row()).toMatchObject({ status: "failed", attempts: 2, calls: 4, token_reserved: 72000 });
    expect(() => engine.recoverJob(row().id, now + 18 * 60000)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    expect(engine.settings()).toMatchObject({ maxAttempts: 3, dailyCallBudget: 18, dailyTokenBudget: 300000 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
  });
  it("never bypasses independent review when a correction removes the blocked wording", async () => {
    generated = badDraft; await engine.tick(now);
    generated = () => ({ ...realisticDraft(), content: realisticDraft().content + "<p>Our company can supply every replacement immediately.</p>" });
    reviewSupported = false;
    await engine.tick(now + 6 * 60000);
    expect(row()).toMatchObject({ status: "failed", error_code: "EDITORIAL_REVIEW_FAILED", attempts: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
  });
  it("cannot offer correction when the original attempt limit leaves no room", async () => {
    engine.setSettings({ ...engine.settings(), maxAttempts: 1 });
    generated = badDraft; await engine.tick(now);
    expect(row()).toMatchObject({ status: "failed", attempts: 1 });
    expect(db.prepare("SELECT repair_offered FROM blog_job_commercial_diagnostics").get()).toEqual({ repair_offered: 0 });
  });
  it("does not spend protected PM first-attempt budget on a commercial correction", async () => {
    engine.setSettings({ ...engine.settings(), dailyCallBudget: 6, dailyTokenBudget: 120000 });
    generated = badDraft;
    await engine.tick(now); await engine.tick(now + 6 * 60000);
    expect(row()).toMatchObject({ status: "failed", error_code: "BUDGET_RESERVED_FOR_OTHER_NEW_SLOT", calls: 2, token_reserved: 36000 });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("still rejects private data in the corrected output before independent review", async () => {
    generated = badDraft; await engine.tick(now);
    generated = () => ({ ...realisticDraft(), content: realisticDraft().content + "<p>Write to private@example.com for this transaction.</p>" });
    await engine.tick(now + 6 * 60000);
    expect(row()).toMatchObject({ status: "failed", error_code: "PRIVACY_CHECK_FAILED", calls: 4 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
  });
  it("does not reopen job30 or invent historical field diagnostics when migrating/restarting", async () => {
    db.prepare(`INSERT INTO blog_topics(id,fingerprint,title,cluster_id,intent,category,product_ids,status,created_at)
      VALUES(14,'historical','Asking for documentary support when a general replacement is proposed',
        2,'verification','general','[1]','blocked',?)`).run(now);
    db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,topic_id,error_code,calls,token_reserved,token_used,created_at,finished_at)
      VALUES(30,'2026-10-12','new-am','new','failed',1,?,14,'UNSUPPORTED_COMMERCIAL_CLAIM',2,36000,5178,?,?)`).run(now, now, now);
    const original = row();
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(now + 1000);
    expect(row()).toEqual(original);
    expect(engine.status(now).jobs[0].commercialDiagnostics).toEqual([]);
    expect(http).not.toHaveBeenCalled();
    expect(() => engine.recoverJob(30, now)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
  });
});

describe("R28.22 bounded stage deadlines and diagnostics", () => {
  it("budgets a complete worst-case attempt below the unchanged five-minute lease", () => {
    expect(BLOG_PROVIDER_TIMEOUTS).toEqual({ research: 45000, generate: 120000, review: 45000 });
    expect(Object.values(BLOG_PROVIDER_TIMEOUTS).reduce((a, b) => a + b, 0) + 3 * 12000).toBe(246000);
    expect(246000).toBeLessThan(5 * 60000);
  });
  it("allows a simulated 75-second generation yet cancels a stall at the fixed 120-second deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("fixture timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    let latency = 75000;
    const transport = vi.fn(async (_url: any, options: any) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(message(realisticDraft())), latency);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    }));
    const live = new LiveBlogProviders(transport as any);
    const first = live.generate({});
    await vi.advanceTimersByTimeAsync(75000);
    expect((await first).draft).toMatchObject({ title: realisticDraft().title });
    latency = 180000;
    const second = live.generate({}).catch(e => e);
    await vi.advanceTimersByTimeAsync(120000);
    const failure = await second;
    expect(failure).toBeInstanceOf(ProviderTransportError);
    expect(failure.message).toBe("PROVIDER_TIMEOUT");
    expect(failure.diagnostics).toEqual({ stage: "generate", phase: "headers", timeoutMs: 120000, elapsedMs: 120000 });
    expect(transport).toHaveBeenCalledTimes(2); // no hidden in-provider retry
  });
  it("identifies body stalls independently of header waits without retaining provider text", async () => {
    const nativeTimeout = AbortSignal.timeout;
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => nativeTimeout(5));
    const live = new LiveBlogProviders((async (_url: any, options: any) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      },
    }))) as any);
    const failure = await live.generate({}).catch(e => e);
    expect(failure).toBeInstanceOf(ProviderTransportError);
    expect(failure.diagnostics).toMatchObject({ stage: "generate", phase: "body", timeoutMs: 120000 });
    expect(failure.message).toBe("PROVIDER_TIMEOUT");
  });
  it("persists only allowlisted transport metadata, never raw provider errors", async () => {
    const original = http.getMockImplementation()!;
    http.mockImplementation(async (url: string, options: any) => {
      if (url.includes("anthropic")) throw new Error("SECRET_KEY private@example.com PRIVATE_BODY");
      return original(url, options);
    });
    await engine.tick(now);
    const status = engine.status(now);
    expect(status.jobs[0].providerDiagnostics).toMatchObject({ stage: "generate", phase: "headers", timeoutMs: 120000 });
    expect(JSON.stringify(status.jobs)).not.toMatch(/SECRET_KEY|private@example|PRIVATE_BODY/);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/SECRET_KEY|private@example|PRIVATE_BODY/);
  });
  it("reproduces job31's research-failure then generation-timeout accounting, with explicit stage and bounded restart recovery", async () => {
    let call = 0;
    const research = provider.research.bind(provider);
    provider.research = async query => { if (++call === 1) throw new Error("EVIDENCE_INSUFFICIENT"); return research(query); };
    const generate = provider.generate.bind(provider);
    provider.generate = async () => { throw new ProviderTransportError("PROVIDER_TIMEOUT", "generate", "headers", Date.now() - 120000); };
    const draftId = Number(engine.enqueueDraft(now));
    await engine.tick(now, draftId);
    expect(row()).toMatchObject({ status: "retry", calls: 1, token_reserved: 2000 });
    await engine.tick(now + 6 * 60000, draftId);
    expect(row()).toMatchObject({ status: "retry", attempts: 2, calls: 3, token_reserved: 38000, error_code: "PROVIDER_TIMEOUT" });
    expect(engine.status(now).jobs[0].providerDiagnostics).toMatchObject({ stage: "generate", phase: "headers", timeoutMs: 120000 });
    expect(engine.status(now).jobs[0].nextAction).toContain("Stage: generate; phase: headers; deadline: 120000ms");
    db.close(); db = new Database(path);
    provider.generate = generate;
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(now + 17 * 60000, draftId);
    expect(row()).toMatchObject({ status: "succeeded", attempts: 3, calls: 6, token_reserved: 98000 });
    expect(engine.article(row().post_id).published).toBe(0); // manual draft never publishes unexpectedly
    expect(engine.status(now).jobs[0].providerDiagnostics).toBeNull();
  });
});

describe("R28.22 exact job31 metadata failure and all presentation bounds", () => {
  it("repairs the recorded 177-character metaDescription to a whole-word prefix <=165, then reviews metadata before publication", async () => {
    const draft = realisticDraft();
    draft.metaDescription = (draft.metaDescription + " Keep unresolved questions with the vehicle records and seek confirmation.").slice(0, 177);
    expect(draft.metaDescription).toHaveLength(177);
    generated = () => draft;
    await engine.tick(now);
    expect(row()).toMatchObject({ status: "succeeded", attempts: 1, calls: 3, token_reserved: 60000 });
    const saved = engine.article(row().post_id).snapshot;
    expect(saved.metaDescription.length).toBeLessThanOrEqual(165);
    expect(saved.metaDescription.length).toBeGreaterThanOrEqual(60);
    expect(draft.metaDescription.startsWith(saved.metaDescription)).toBe(true);
    expect(draft.metaDescription[saved.metaDescription.length]).toMatch(/\s/);
    expect(saved.claims).toEqual(draft.claims);
    const reviewCall = http.mock.calls.find(c => c[0].includes("anthropic") && JSON.parse(c[1].body).max_tokens === 300)!;
    const body = JSON.parse(reviewCall[1].body);
    const reviewed = JSON.parse(body.messages[0].content).article;
    expect(reviewed).toMatchObject({ title: saved.title, excerpt: saved.excerpt,
      metaTitle: saved.metaTitle, metaDescription: saved.metaDescription });
    expect(body.system).toContain("title, excerpt, metadata and article body");
  });
  it("normalizes all overlong plaintext presentation fields without changing article facts or evidence quotes", () => {
    const original = realisticDraft();
    const input = { ...original,
      title: "Preparing a clear brake component enquiry using identification records and photographs before asking the technical contact for clarification",
      excerpt: (original.excerpt + " Keep the unresolved information visible for the next person to review before placing an order.").slice(0, 247),
      metaTitle: "Preparing component identification records for a clear brake replacement enquiry",
      metaDescription: (original.metaDescription + " Keep the unanswered questions with the request.").slice(0, 177),
    };
    const valid = validateArticle(db, input, sources());
    for (const [field, max] of [["title", 120], ["excerpt", 200], ["metaTitle", 65], ["metaDescription", 165]] as const) {
      expect(input[field].length).toBeGreaterThan(max);
      expect(valid[field].length).toBeLessThanOrEqual(max);
      expect(input[field].startsWith(valid[field])).toBe(true);
      expect(input[field][valid[field].length]).toMatch(/\s/);
    }
    expect(valid.content).toBe(cleanHtml(original.content));
    expect(valid.claims).toEqual(original.claims);
  });
  it.each(["title", "excerpt", "metaTitle", "metaDescription"] as const)(
    "does not blindly clip HTML, entities, unbroken text, wrong types or short %s", field => {
      for (const value of [`<p>${"text ".repeat(60)}</p>`, `${"text ".repeat(60)} &amp;`, "x".repeat(301), null, "short"]) {
        expect(() => validateArticle(db, { ...realisticDraft(), [field]: value }, sources())).toThrow("ARTICLE_SCHEMA_INVALID");
      }
    });
  it("does not treat metadata normalization as factual approval", async () => {
    const draft = realisticDraft();
    draft.metaDescription = "This component is suitable for every vehicle in the fleet without further technical checking. ".repeat(2).slice(0, 177);
    generated = () => draft;
    reviewSupported = false;
    await engine.tick(now);
    expect(row()).toMatchObject({ status: "failed", error_code: "EDITORIAL_REVIEW_FAILED", calls: 3 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
    expect(draft.claims).toEqual(realisticDraft().claims);
  });
  it("can advance only the unused PM slot via existing ordered settings without replaying exhausted AM/draft jobs or duplicating later", async () => {
    db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,error_code,calls,token_reserved,created_at,finished_at)
      VALUES(30,'2026-10-12','new-am','new','failed',1,?,'UNSUPPORTED_COMMERCIAL_CLAIM',2,36000,?,?)`).run(now, now, now);
    db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,error_code,calls,token_reserved,created_at,finished_at)
      VALUES(31,'2026-10-12','draft-1','draft','failed',3,?,'ARTICLE_SCHEMA_INVALID',5,74000,?,?)`).run(now, now, now);
    db.prepare("INSERT INTO blog_usage VALUES('2026-10-12',7,110000)").run();
    const exhausted = db.prepare("SELECT * FROM blog_jobs ORDER BY id").all();
    expect(() => engine.setSettings({ ...engine.settings(), evening: "00:25" })).toThrow(); // 13:00 improvement is too late
    engine.setSettings({ ...engine.settings(), improvement: "00:24", evening: "00:25" });
    await engine.tick(slotTime("2026-10-12", "00:26")); // optional improvement: no eligible managed article
    await engine.tick(slotTime("2026-10-12", "00:26") + 1000); // the one unused PM slot
    expect(db.prepare("SELECT * FROM blog_jobs WHERE id IN (30,31) ORDER BY id").all()).toEqual(exhausted);
    expect(db.prepare("SELECT status,calls FROM blog_jobs WHERE slot='improve'").get()).toEqual({ status: "skipped", calls: 0 });
    expect(db.prepare("SELECT status,calls FROM blog_jobs WHERE slot='new-pm'").get()).toEqual({ status: "succeeded", calls: 3 });
    expect(db.prepare("SELECT calls,tokens FROM blog_usage WHERE day='2026-10-12'").get()).toEqual({ calls: 10, tokens: 170000 });
    engine.setSettings({ ...engine.settings(), morning: "12:48", improvement: "13:00", evening: "16:00" });
    await engine.tick(slotTime("2026-10-12", "16:01"));
    expect(db.prepare("SELECT COUNT(*) n FROM blog_jobs WHERE day='2026-10-12' AND slot='new-pm'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM blog_publications WHERE day='2026-10-12'").get()).toEqual({ n: 1 });
    expect(engine.settings()).toMatchObject({ dailyNewCap: 2, dailyCallBudget: 18, dailyTokenBudget: 300000, maxAttempts: 3 });
  });
});
