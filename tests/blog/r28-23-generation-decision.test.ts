import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { AutoBlogger, slotTime } from "../../server/auto-blogger";
import { LiveBlogProviders } from "../../server/auto-blogger-providers";
import { fixtureUrls, fixturePages, realisticDraft } from "./recovery-fixture";

// Real research/generation/review adapters; only HTTP/evidence I/O is offline.
// These authored fixtures do not establish what live job33 actually returned.
const now = slotTime("2026-10-12", "00:21");
let db: Database.Database, engine: AutoBlogger, provider: LiveBlogProviders;
let generated: unknown, supported: boolean, researchFailsFirst: boolean, researchCalls: number;
let http: ReturnType<typeof vi.fn>;
const row = () => db.prepare("SELECT * FROM blog_jobs ORDER BY id DESC LIMIT 1").get() as any;
const requests = (tokens: number) => http.mock.calls
  .filter(c => c[0].includes("anthropic") && JSON.parse(c[1].body).max_tokens === tokens)
  .map(c => JSON.parse(c[1].body));
function message(data: unknown) {
  return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }],
    usage: { input_tokens: 4000, output_tokens: 1178 } });
}
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,brand TEXT,category TEXT,part_number TEXT,active INTEGER,name TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,title TEXT,excerpt TEXT,content TEXT,meta_title TEXT,
      meta_description TEXT,author_name TEXT,published INTEGER,published_at INTEGER,created_at INTEGER,updated_at INTEGER);
    INSERT INTO products VALUES(1,'brake-fixture','Tata','brakes','OFFLINE-PN',1,'Brake');`);
  vi.stubEnv("CLAUDE_API_KEY", "offline-key"); vi.stubEnv("TAVILY_API_KEY", "offline-key");
  vi.stubEnv("PERPLEXITY_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  generated = realisticDraft(); supported = true; researchFailsFirst = false; researchCalls = 0;
  http = vi.fn(async (url: string, options: any) => {
    const body = JSON.parse(options.body);
    if (url === "https://api.tavily.com/search") {
      const urls = researchFailsFirst && ++researchCalls === 1 ? fixtureUrls.slice(0, 1) : fixtureUrls;
      return Response.json({ results: urls.map(url => ({ url })) });
    }
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect([6000, 300]).toContain(body.max_tokens);
    return message(body.max_tokens === 300 ? { supported, substantiveChange: false } : generated);
  });
  provider = new LiveBlogProviders(http as any, async url => {
    const i = fixtureUrls.indexOf(url); expect(i).toBeGreaterThanOrEqual(0);
    return { url, text: fixturePages[i], title: "Authored offline fixture", accessedAt: now };
  });
  engine = new AutoBlogger(db, provider, () => true);
  engine.setSettings({ ...engine.settings(), morning: "00:20", improvement: "13:00", evening: "16:00" });
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("R28.23 strict operation-specific generation decisions", () => {
  it.each([
    [{ skip: true }, "UNSPECIFIED"],
    [{ skip: true, reasonCode: "INSUFFICIENT_RELEVANT_EVIDENCE" }, "INSUFFICIENT_RELEVANT_EVIDENCE"],
    [{ skip: true, reasonCode: "POLICY_CONSTRAINT" }, "POLICY_CONSTRAINT"],
  ])("retains genuine abstention without review, publication or retry: %j", async (output, reason) => {
    generated = output; await engine.tick(now);
    expect(row()).toMatchObject({ status: "skipped", error_code: "GENERATION_ABSTAINED", attempts: 1,
      calls: 2, token_reserved: 36000, token_used: 5178, post_id: null });
    expect(requests(300)).toHaveLength(0);
    expect(engine.status(now).jobs[0].providerDiagnostics).toEqual({
      stage: "generate", operation: "new", decision: "abstained", reasonCode: reason });
    expect(engine.status(now).jobs[0].nextAction).toContain(`model reason: ${reason}`);
    expect(engine.status(now).jobs[0].nextAction).toContain("not a verified diagnosis");
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(now + 17 * 60000);
    expect(row().attempts).toBe(1); expect(http).toHaveBeenCalledTimes(2);
    expect(() => engine.recoverJob(row().id, now)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
    expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
  });

  it.each([false, "false", "true", 0, 1, null, {}, []].map(skip => [skip]))("rejects malformed skip %j, without coercion or blind retry", async skip => {
    generated = { skip }; await engine.tick(now);
    expect(row()).toMatchObject({ status: "failed", error_code: "GENERATION_DECISION_INVALID",
      attempts: 1, calls: 2, token_reserved: 36000, token_used: 5178, post_id: null });
    expect(engine.status(now).jobs[0].providerDiagnostics).toEqual({
      stage: "generate", operation: "new", decision: "invalid", rule: "INVALID_ABSTENTION_SHAPE" });
    expect(requests(300)).toHaveLength(0);
    await engine.tick(now + 17 * 60000);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([
    { skip: true, reasonCode: "PRIVATE_SECRET" },
    { skip: true, reason: "private@example.com PRIVATE_SECRET" },
    { skip: true, PRIVATE_SECRET: "private@example.com" },
    { reasonCode: "POLICY_CONSTRAINT" },
    { ...realisticDraft(), skip: false },
    { ...realisticDraft(), skip: true },
  ])("rejects extra/unrecognized decision fields without leaking content: case %#", async output => {
    generated = output; await engine.tick(now);
    expect(row().error_code).toBe("GENERATION_DECISION_INVALID");
    expect(requests(300)).toHaveLength(0);
    expect(JSON.stringify(engine.status(now).jobs)).not.toMatch(/PRIVATE_SECRET|private@example|Start with what/);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/PRIVATE_SECRET|private@example|Start with what/);
  });

  it("rejects an improvement-only reason for new generation", async () => {
    generated = { skip: true, reasonCode: "NO_SUPPORTED_IMPROVEMENT" }; await engine.tick(now);
    expect(row().error_code).toBe("GENERATION_DECISION_INVALID");
    expect(engine.status(now).jobs[0].nextAction).toContain("REASON_OPERATION_MISMATCH");
    expect(requests(300)).toHaveLength(0);
  });

  it.each([true, false])("new article passes all existing validators and independent review decides supported=%s", async accepted => {
    supported = accepted; await engine.tick(now);
    const request = requests(6000)[0], context = JSON.parse(request.messages[0].content);
    expect(context.operation).toBe("new"); expect(context).not.toHaveProperty("previousArticle");
    expect(request.system).toContain("Operation: NEW_ARTICLE");
    expect(request.system).toContain("no previous article or substantive change is required");
    expect(request.system).not.toContain("Operation: IMPROVE_ARTICLE");
    expect(requests(300)).toHaveLength(1);
    expect(row().status).toBe(accepted ? "succeeded" : "failed");
    if (accepted) expect(engine.article(row().post_id).published).toBe(1);
    else {
      expect(row().error_code).toBe("EDITORIAL_REVIEW_FAILED");
      expect(db.prepare("SELECT COUNT(*) n FROM blog_articles").get()).toEqual({ n: 0 });
    }
  });

  it("reproduces research failure then generation abstention across restart, preserving stage accounting", async () => {
    researchFailsFirst = true;
    generated = { skip: true, reasonCode: "INSUFFICIENT_RELEVANT_EVIDENCE" };
    await engine.tick(now);
    expect(row()).toMatchObject({ status: "retry", error_code: "EVIDENCE_INSUFFICIENT", calls: 1, token_reserved: 2000 });
    engine = new AutoBlogger(db, provider, () => true);
    await engine.tick(now + 6 * 60000);
    expect(row()).toMatchObject({ kind: "new", status: "skipped", attempts: 2,
      error_code: "GENERATION_ABSTAINED", calls: 3, token_reserved: 38000, token_used: 5178 });
    await engine.tick(now + 17 * 60000);
    expect(row().attempts).toBe(2); expect(requests(300)).toHaveLength(0);
    expect(engine.settings()).toMatchObject({ maxAttempts: 3, dailyCallBudget: 18, dailyTokenBudget: 300000 });
  });

  it("gives actual improvement generation its own contract and preserves the older article on abstention", async () => {
    await engine.tick(now);
    const postId = row().post_id;
    db.prepare("UPDATE posts SET updated_at=?,published_at=? WHERE id=?").run(now - 10 * 86400000, now - 10 * 86400000, postId);
    const original = db.prepare("SELECT * FROM posts WHERE id=?").get(postId);
    generated = { skip: true, reasonCode: "NO_SUPPORTED_IMPROVEMENT" };
    await engine.tick(slotTime("2026-10-12", "13:01"));
    expect(row()).toMatchObject({ kind: "improve", status: "skipped", error_code: "GENERATION_ABSTAINED" });
    const request = requests(6000)[1], context = JSON.parse(request.messages[0].content);
    expect(context.operation).toBe("improve"); expect(context.previousArticle).toContain("Start with what");
    expect(request.system).toContain("Operation: IMPROVE_ARTICLE");
    expect(request.system).not.toContain("Operation: NEW_ARTICLE");
    expect(engine.status(now).jobs[0].providerDiagnostics).toMatchObject({ operation: "improve", reasonCode: "NO_SUPPORTED_IMPROVEMENT" });
    expect(requests(300)).toHaveLength(1); // only the original new article
    expect(db.prepare("SELECT * FROM posts WHERE id=?").get(postId)).toEqual(original);
  });

  it("keeps deterministic non-substantive improvement rejection separate from generation abstention", async () => {
    await engine.tick(now);
    db.prepare("UPDATE posts SET updated_at=?,published_at=?").run(now - 10 * 86400000, now - 10 * 86400000);
    await engine.tick(slotTime("2026-10-12", "13:01"));
    expect(row()).toMatchObject({ kind: "improve", status: "skipped", error_code: "NO_SUPPORTED_CHANGE" });
    expect(requests(6000)).toHaveLength(2); expect(requests(300)).toHaveLength(1);
  });

  it.each([false, "false"])("also rejects malformed improvement skip %j without review or content changes", async skip => {
    await engine.tick(now);
    db.prepare("UPDATE posts SET updated_at=?,published_at=?").run(now - 10 * 86400000, now - 10 * 86400000);
    const original = db.prepare("SELECT * FROM posts").get();
    generated = { skip };
    await engine.tick(slotTime("2026-10-12", "13:01"));
    expect(row()).toMatchObject({ kind: "improve", status: "failed", error_code: "GENERATION_DECISION_INVALID" });
    expect(engine.status(now).jobs[0].providerDiagnostics).toMatchObject({ operation: "improve", rule: "INVALID_ABSTENTION_SHAPE" });
    expect(requests(300)).toHaveLength(1);
    expect(db.prepare("SELECT * FROM posts").get()).toEqual(original);
  });

  it("preserves historical job33 and its unknown reason, without reopening it on restart", async () => {
    const later = slotTime("2026-10-12", "16:11");
    db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,error_code,created_at)
      VALUES(30,'2026-10-12','new-am','new','failed',1,?,'UNSUPPORTED_COMMERCIAL_CLAIM',?),
      (32,'2026-10-12','improve','improve','skipped',1,?,'NO_SUPPORTED_CHANGE',?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO blog_jobs(id,day,slot,kind,status,attempts,due_at,error_code,calls,token_reserved,created_at,finished_at)
      VALUES(33,'2026-10-12','new-pm','new','skipped',2,?,'NO_SUPPORTED_CHANGE',3,38000,?,?)`).run(later, later, later);
    const original = db.prepare("SELECT * FROM blog_jobs ORDER BY id").all();
    engine = new AutoBlogger(db, provider, () => true); await engine.tick(later + 1000);
    expect(db.prepare("SELECT * FROM blog_jobs ORDER BY id").all()).toEqual(original); expect(http).not.toHaveBeenCalled();
    expect(engine.status(now).jobs[0].providerDiagnostics).toBeNull();
    expect(engine.status(now).jobs[0].nextAction).toContain("original skip value and reason were not retained");
    expect(() => engine.recoverJob(33, now)).toThrow("JOB_RECOVERY_NOT_ELIGIBLE");
  });

  it("keeps no-eligible-article improvement skips before all provider calls", async () => {
    db.prepare(`INSERT INTO blog_jobs(day,slot,kind,status,attempts,due_at,created_at)
      VALUES('2026-10-12','new-am','new','failed',1,?,?)`).run(now, now);
    await engine.tick(slotTime("2026-10-12", "13:01"));
    expect(row()).toMatchObject({ kind: "improve", status: "skipped", error_code: "NO_SUPPORTED_CHANGE", calls: 0 });
    expect(http).not.toHaveBeenCalled();
  });
});
