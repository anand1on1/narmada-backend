import type { Database } from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { bloggerSettingsSchema, BLOG_EDITOR, type BloggerSettings, type CatalogFact, type BlogSource, type ArticleDraft } from "../shared/auto-blogger";
import { LiveBlogProviders, type BlogProviders } from "./auto-blogger-providers";
import { cleanHtml, similarity, hasSubstantiveChange, internalLinks, validateArticle } from "./auto-blogger-safety";
import { productPath } from "../shared/public-urls";
import { safeBlogCode, blogAction } from "../shared/blog-diagnostics";
import { ArticleSchemaValidationError, schemaDiagnosticSummary, type SchemaDiagnostic } from "./blog-schema-diagnostics";

// Deliberately isolated, additive tables. Never alters products/quotations/PO publication rules.
export function migrateAutoBlogger(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blog_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blog_clusters (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, pillar_post_id INTEGER);
    CREATE TABLE IF NOT EXISTS blog_topics (
      id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      cluster_id INTEGER NOT NULL, intent TEXT NOT NULL, category TEXT NOT NULL,
      product_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'queued', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blog_jobs (
      id INTEGER PRIMARY KEY, day TEXT NOT NULL, slot TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0, topic_id INTEGER, post_id INTEGER,
      lease_token TEXT, lease_until INTEGER, error_code TEXT, calls INTEGER NOT NULL DEFAULT 0,
      token_reserved INTEGER NOT NULL DEFAULT 0, token_used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, finished_at INTEGER, UNIQUE(day,slot));
    CREATE TABLE IF NOT EXISTS blog_articles (
      post_id INTEGER PRIMARY KEY, topic_id INTEGER UNIQUE, cluster_id INTEGER,
      category TEXT NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blog_versions (
      id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, snapshot TEXT NOT NULL,
      reason TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blog_sources (
      post_id INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, accessed_at INTEGER NOT NULL,
      PRIMARY KEY(post_id,url));
    CREATE TABLE IF NOT EXISTS blog_article_products (
      post_id INTEGER NOT NULL, product_id INTEGER NOT NULL, PRIMARY KEY(post_id,product_id));
    CREATE TABLE IF NOT EXISTS blog_topic_signals (
      topic_id INTEGER NOT NULL, source_url TEXT NOT NULL, accessed_at INTEGER NOT NULL,
      evidence_quote TEXT NOT NULL, PRIMARY KEY(topic_id,source_url));
    CREATE TABLE IF NOT EXISTS blog_publications (
      post_id INTEGER PRIMARY KEY, day TEXT NOT NULL, job_id INTEGER);
    CREATE TABLE IF NOT EXISTS blog_worker_lock (
      id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, expires INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS blog_usage (
      day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS blog_job_schema_diagnostics (
      job_id INTEGER PRIMARY KEY, details TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS blog_topic_recovery (
      topic_id INTEGER PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
      last_job_id INTEGER, next_eligible_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS blog_attempt_budget (
      lease_token TEXT PRIMARY KEY, job_id INTEGER NOT NULL, day TEXT NOT NULL,
      calls_started INTEGER NOT NULL DEFAULT 0, tokens_started INTEGER NOT NULL DEFAULT 0,
      settled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS blog_job_recoveries (
      job_id INTEGER PRIMARY KEY, previous_error TEXT NOT NULL,
      attempts_at_recovery INTEGER NOT NULL, recovered_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS blog_jobs_due ON blog_jobs(day,status,retry_at);
    CREATE INDEX IF NOT EXISTS blog_versions_post ON blog_versions(post_id,id);
    INSERT OR IGNORE INTO blog_worker_lock(id,expires) VALUES(1,0);
  `);
  db.prepare("INSERT OR IGNORE INTO blog_settings(id,value) VALUES(1,?)").run(JSON.stringify(bloggerSettingsSchema.parse({})));
  for (const name of ["Brand knowledge", "Parts selection", "Procurement practice", "Applications & care", "India & cross-border"])
    db.prepare("INSERT OR IGNORE INTO blog_clusters(name) VALUES(?)").run(name);
}
export function indiaDay(now = Date.now()) { return new Date(now + 330 * 60000).toISOString().slice(0, 10); }
export function slotTime(day: string, hhmm: string) { return Date.parse(`${day}T${hhmm}:00+05:30`); }
export const TOKEN_RESERVATION = 60000; // Worst-case character-bound input + capped output for all three calls.
// Charge sent calls conservatively (including ambiguous transport failures).
// Only stages provably never started are refunded, including after a restart.
const STAGE_TOKENS = { research: 2000, generate: 34000, review: 24000 };
const LEASE_MS = 5 * 60000;
const safeCode = safeBlogCode;
const brands = ["Tata", "Ashok Leyland", "Eicher", "Mahindra", "BharatBenz", "AMW", "MAN", "Volvo",
  "Bharat Benz", "Cummins", "Bosch", "ZF", "Schaeffler", "SKF", "Denso", "Delphi", "Lucas TVS",
  "Wabco", "Knorr-Bremse", "Meritor", "Donaldson", "Fleetguard", "Timken", "Sachs", "MANN-FILTER", "Mahle", "Haldex", "Dana", "Hella"];
const categories = ["engine", "brake", "clutch", "transmission", "gearbox", "suspension", "steering",
  "electrical", "filter", "cooling", "body", "axle", "bearing", "fuel", "hydraulic", "chassis", "lubrication"];
export function catalogFeed(db: Database): CatalogFact[] {
  const rows = db.prepare("SELECT id,slug,brand,category,part_number FROM products WHERE active=1 ORDER BY id DESC LIMIT 1000").all() as any[];
  return rows.flatMap(r => {
    const brand = brands.find(b => b.toLowerCase() === String(r.brand).trim().toLowerCase());
    const category = String(r.category).trim().toLowerCase() === "other" ? "general" :
      categories.find(c => new RegExp(`\\b${c}(?:s|ing)?\\b`, "i").test(String(r.category)));
    if (!brand || !category || !/^[a-zA-Z0-9_-]{1,150}$/.test(r.slug)) return [];
    let demand = false;
    // Private lines are never selected. Only existence of an exact catalog part-number match is used.
    // No qty, prices, descriptions, identity fields or raw JSON ever leave the database.
    if (r.part_number) for (const table of ["quotation_items", "po_items"]) {
      try {
        if ((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE part_number=?`).get(r.part_number) as any).n >= 3) demand = true;
      } catch { /* Older installs may not have one of the line tables yet. */ }
    }
    // Optional identifier comes ONLY from an already-public catalog field, never raw line text.
    const pn = String(r.part_number || "").trim();
    const partNumber = /^[A-Z0-9][A-Z0-9./-]{1,39}$/i.test(pn) && !/^\d{9,}$/.test(pn) ? pn : undefined;
    return [{ id: r.id, slug: r.slug, brand, category, ...(partNumber ? { partNumber } : {}),
      demandBand: demand ? "historical-enquiries" : "catalog" } as CatalogFact];
  });
}
export class AutoBlogger {
  constructor(public db: Database, public providers: BlogProviders = new LiveBlogProviders(),
    private enabled = () => process.env.AUTO_BLOGGER_ENABLED === "true") {
    migrateAutoBlogger(db);
  }
  settings(): BloggerSettings {
    return bloggerSettingsSchema.parse(JSON.parse((this.db.prepare("SELECT value FROM blog_settings WHERE id=1").get() as any).value));
  }
  setSettings(value: unknown) {
    const s = bloggerSettingsSchema.parse(value);
    this.db.prepare("UPDATE blog_settings SET value=? WHERE id=1").run(JSON.stringify(s));
    return s;
  }
  status(now = Date.now(), requestedPage = 1) {
    const settings = this.settings(), providers = this.providers.status(), deploymentEnabled = this.enabled();
    const today = indiaDay(now), jobs = this.db.prepare(`SELECT j.*,d.details AS schema_details FROM blog_jobs j
      LEFT JOIN blog_job_schema_diagnostics d ON d.job_id=j.id ORDER BY j.id DESC LIMIT 80`).all() as any[];
    const tomorrow = indiaDay(now + 86400000);
    const slots = [["morning", settings.morning], ["improvement", settings.improvement], ["evening", settings.evening]];
    const next = [today, tomorrow].flatMap(day => slots.map(([slot, time]) => ({ slot, at: slotTime(day, time) })))
      .find(v => v.at > now);
    const articleTotal = (this.db.prepare("SELECT COUNT(*) n FROM posts p JOIN blog_articles a ON a.post_id=p.id").get() as any).n;
    const articlePages = Math.max(1, Math.ceil(articleTotal / 20));
    const articlePage = Math.max(1, Math.min(articlePages, Math.trunc(requestedPage) || 1));
    const reason = !deploymentEnabled ? "DEPLOYMENT_NOT_ENABLED" : !providers.ready ? "PROVIDERS_NOT_CONFIGURED" : settings.mode === "pause" ? "PAUSED" : null;
    const lastSuccess = this.db.prepare("SELECT finished_at FROM blog_jobs WHERE status='succeeded' ORDER BY finished_at DESC LIMIT 1").get() as any;
    return { settings, providers, deploymentEnabled, available: deploymentEnabled && providers.ready,
      reason, diagnostics: { nextAction: blogAction(reason),
        connectivity: lastSuccess ? "previous-success-not-current-verification" : "not-verified",
        lastSuccessfulJobAt: lastSuccess?.finished_at || null,
        providerNotice: "Configured means key presence only, not verified connectivity, credit balance or model access.",
        budgetWarning: settings.dailyCallBudget < 6 || settings.dailyTokenBudget < 120000
          ? "Budget cannot reserve even two first-attempt new posts."
          : settings.dailyCallBudget < 21 || settings.dailyTokenBudget < 420000
          ? "Retries and optional improvements share a finite budget. New-post first attempts are protected; not all retries may fit." : null },
      timezone: "Asia/Kolkata", nextSchedule: next,
      today: { day: today, published: (this.db.prepare("SELECT COUNT(*) n FROM blog_publications WHERE day=?").get(today) as any).n,
        usage: this.db.prepare("SELECT calls,tokens FROM blog_usage WHERE day=?").get(today) || { calls: 0, tokens: 0 } },
      // Logs contain only allowlisted diagnostic codes, never raw prompts, API bodies or credentials.
      jobs: jobs.map(({ lease_token, schema_details, ...j }) => {
        let schemaDiagnostics: SchemaDiagnostic[] = [];
        try { schemaDiagnostics = schema_details ? JSON.parse(schema_details) : []; } catch { /* damaged optional diagnostic is not content */ }
        return { ...j, error_code: j.error_code ? safeCode(j.error_code) : null, schemaDiagnostics,
          nextAction: (j.error_code === "ARTICLE_SCHEMA_INVALID"
            ? "Generated JSON failed a field/type/length rule. No rejected content was saved or published. Older jobs did not retain field diagnostics. New failures use bounded retries within the existing daily budget."
            : blogAction(j.error_code)) + (j.error_code === "ARTICLE_SCHEMA_INVALID" && schemaDiagnostics.length
            ? ` Fields: ${schemaDiagnosticSummary(schemaDiagnostics)}` : "") };
      }),
      topics: this.db.prepare(`SELECT t.*,COALESCE(r.failures,0) AS recoveryFailures,r.next_eligible_at AS nextEligibleAt
        FROM blog_topics t LEFT JOIN blog_topic_recovery r ON r.topic_id=t.id ORDER BY t.id DESC LIMIT 100`).all(),
      clusters: this.db.prepare("SELECT * FROM blog_clusters").all(),
      articleTotal, articlePages, articlePage,
      articles: this.db.prepare(`SELECT p.id,p.slug,p.title,p.published,p.published_at,p.updated_at,a.category
        FROM posts p JOIN blog_articles a ON a.post_id=p.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 20 OFFSET ?`).all((articlePage - 1) * 20) };
  }
  plan(now = Date.now()) {
    return this.db.transaction(() => {
      const recovered = this.recoverTopics(now);
      const queued = (this.db.prepare("SELECT COUNT(*) n FROM blog_topics WHERE status='queued'").get() as any).n;
      if (queued >= 12) return recovered;
      const facts = catalogFeed(this.db);
      if (!facts.length) throw new Error("PUBLIC_CATALOG_INSUFFICIENT");
      const prior = (this.db.prepare("SELECT title FROM blog_topics UNION ALL SELECT title FROM posts").all() as any[]).map(r => r.title);
      const intents = [
        { cluster: 1, label: "brand", title: (f: CatalogFact) => `${f.brand} parts procurement: identifying ${f.category} requirements before a quote` },
        { cluster: 2, label: "category", title: (f: CatalogFact) => `${f.category} parts selection: a specification checklist for commercial fleets` },
        { cluster: 3, label: "procurement", title: (f: CatalogFact) => `Comparing ${f.category} part quotations without overlooking technical requirements` },
        { cluster: 4, label: "application", title: (f: CatalogFact) => `${f.brand} fleet maintenance records: preparing a useful ${f.category} parts enquiry` },
        { cluster: 5, label: "geography", title: (f: CatalogFact) => `Sourcing ${f.category} parts across India: documentation and dispatch questions` },
        { cluster: 3, label: "procurement", title: (f: CatalogFact) => `Receiving ${f.category} components: documenting condition and checking the order` },
        { cluster: 5, label: "geography", title: (f: CatalogFact) => `Cross-border ${f.category} parts enquiries: separating technical details from export paperwork` },
        { cluster: 4, label: "application", title: (f: CatalogFact) => `How a fleet service history supports clearer ${f.category} replacement enquiries` },
        // Distinct next-batch seeds when earlier themes are exhausted/quarantined.
        // Still catalog-grounded questions, never claims or city-name permutations;
        // research and article deduplication must establish publishable substance.
        { cluster: 2, label: "identification", title: (f: CatalogFact) => `Building a ${f.category} component identification record when markings are incomplete` },
        { cluster: 3, label: "documentation", title: (f: CatalogFact) => `Photographing ${f.category} component labels: what to include in a technical enquiry` },
        { cluster: 3, label: "clarification", title: (f: CatalogFact) => `Recording unresolved ${f.category} specification questions before approving an order` },
        { cluster: 3, label: "traceability", title: (f: CatalogFact) => `Keeping ${f.category} packaging labels linked to purchasing documents` },
        { cluster: 4, label: "records", title: (f: CatalogFact) => `Reviewing conflicting ${f.category} references in workshop records` },
        { cluster: 2, label: "verification", title: (f: CatalogFact) => `Asking for documentary support when a ${f.category} replacement is proposed` },
      ];
      let added = 0;
      // Round-robin intents AND brands/categories; no multiplication over city names.
      const count = (this.db.prepare("SELECT COUNT(*) n FROM blog_topics").get() as any).n;
      const ordered = [...facts].sort((a, b) => a.brand.localeCompare(b.brand) || a.category.localeCompare(b.category));
      const unique = Array.from(new Map(ordered.map(f => [`${f.brand}:${f.category}`, f])).values());
      for (let k = 0; k < unique.length * intents.length && queued + added < 12; k++) {
        const f = unique[(k + count) % unique.length];
        const i = intents[(Math.floor(k / unique.length) + k % unique.length + count) % intents.length];
        const title = i.title(f);
        if (prior.some(t => similarity(title, t) > 0.8)) continue;
        const fingerprint = createHash("sha256").update(title.toLowerCase()).digest("hex");
        const productIds = facts.filter(p => p.brand === f.brand && p.category === f.category).slice(0, 3).map(p => p.id);
        const r = this.db.prepare(`INSERT OR IGNORE INTO blog_topics(fingerprint,title,cluster_id,intent,category,product_ids,created_at)
          VALUES(?,?,?,?,?,?,?)`).run(fingerprint, title, i.cluster, i.label, f.category, JSON.stringify(productIds), now);
        if (r.changes) { added++; prior.push(title); }
      }
      return added + recovered;
    }).immediate();
  }
  private recoverTopics(now: number) {
    // Historical jobs are audit records, never re-run or reset. Recover only their
    // unused topics; a live/retrying job or a saved draft always keeps ownership.
    const abandoned = this.db.prepare(`SELECT t.id,j.id AS job_id,j.error_code,
        COALESCE(j.finished_at,j.created_at,t.created_at) AS failed_at
      FROM blog_topics t LEFT JOIN blog_jobs j ON j.id=(SELECT MAX(id) FROM blog_jobs WHERE topic_id=t.id)
      WHERE t.status='assigned'
        AND NOT EXISTS(SELECT 1 FROM blog_articles a WHERE a.topic_id=t.id)
        AND NOT EXISTS(SELECT 1 FROM blog_jobs live WHERE live.topic_id=t.id
          AND live.status IN ('queued','retry','running'))
      ORDER BY t.id LIMIT 100`).all() as any[];
    for (const t of abandoned) {
      const prior = this.db.prepare("SELECT * FROM blog_topic_recovery WHERE topic_id=?").get(t.id) as any;
      const failures = (prior?.failures || 0) + (prior?.last_job_id === t.job_id ? 0 : 1);
      const unsafe = /PRIVACY|UNSAFE|UNGROUNDED|CLAIM_NOT|UNSUPPORTED_COMMERCIAL|EDITORIAL_REVIEW/.test(t.error_code || "");
      const eligible = t.failed_at + Math.min(7, 2 ** Math.max(0, failures - 1)) * 86400000;
      this.db.prepare(`INSERT INTO blog_topic_recovery VALUES(?,?,?,?)
        ON CONFLICT(topic_id) DO UPDATE SET failures=excluded.failures,last_job_id=excluded.last_job_id,next_eligible_at=excluded.next_eligible_at`)
        .run(t.id, failures, t.job_id || null, eligible);
      this.db.prepare("UPDATE blog_topics SET status=? WHERE id=?").run(unsafe || failures >= 3 ? "blocked" : "cooldown", t.id);
    }
    // At most four re-entries per planning pass; never create extra publication jobs.
    const queued = (this.db.prepare("SELECT COUNT(*) n FROM blog_topics WHERE status='queued'").get() as any).n;
    return this.db.prepare(`UPDATE blog_topics SET status='queued' WHERE id IN (
      SELECT t.id FROM blog_topics t JOIN blog_topic_recovery r ON r.topic_id=t.id
      WHERE t.status='cooldown' AND r.failures<3 AND r.next_eligible_at<=?
      ORDER BY r.failures,r.next_eligible_at,t.id LIMIT ?)`).run(now, Math.min(4, Math.max(0, 12 - queued))).changes;
  }
  private settleBudget(token: string) {
    this.db.transaction(() => {
      const b = this.db.prepare("SELECT * FROM blog_attempt_budget WHERE lease_token=? AND settled=0").get(token) as any;
      if (!b) return;
      const calls = 3 - b.calls_started, tokens = TOKEN_RESERVATION - b.tokens_started;
      this.db.prepare("UPDATE blog_usage SET calls=calls-?,tokens=tokens-? WHERE day=?").run(calls, tokens, b.day);
      this.db.prepare("UPDATE blog_jobs SET calls=calls-?,token_reserved=token_reserved-? WHERE id=?").run(calls, tokens, b.job_id);
      this.db.prepare("UPDATE blog_attempt_budget SET settled=1 WHERE lease_token=?").run(token);
    }).immediate();
  }
  private startStage(job: any, stage: keyof typeof STAGE_TOKENS, now: number) {
    this.db.transaction(() => {
      this.ensureLease(job, now);
      if (!this.enabled() || (this.settings().mode === "pause" && !job.allowPaused)) throw new Error("PAUSED_DURING_JOB");
      const r = this.db.prepare(`UPDATE blog_attempt_budget SET calls_started=calls_started+1,tokens_started=tokens_started+?
        WHERE lease_token=? AND settled=0 AND calls_started<3 AND tokens_started+?<=?`)
        .run(STAGE_TOKENS[stage], job.lease_token, STAGE_TOKENS[stage], TOKEN_RESERVATION);
      if (!r.changes) throw new Error("DAILY_PROVIDER_BUDGET");
    }).immediate();
  }
  enqueueDue(now = Date.now()) {
    const s = this.settings(), day = indiaDay(now);
    // No yesterday/backlog replay: restart catches up ONLY today's due slots.
    const slots = [["new-am", "new", s.morning], ["improve", "improve", s.improvement], ["new-pm", "new", s.evening]];
    for (const [slot, kind, time] of slots) {
      const due = slotTime(day, time);
      if (due <= now) this.db.prepare(`INSERT OR IGNORE INTO blog_jobs(day,slot,kind,due_at,created_at) VALUES(?,?,?,?,?)`)
        .run(day, slot, kind, due, now);
    }
    this.db.prepare(`UPDATE blog_jobs SET status='expired',error_code='MISSED_DAY',finished_at=?
      WHERE day<? AND status IN ('queued','retry','running') AND COALESCE(lease_until,0)<?`).run(now, day, now);
  }
  enqueueDraft(now = Date.now()) {
    if (!this.enabled() || !this.providers.status().ready) throw new Error("PROVIDERS_UNAVAILABLE");
    return this.db.transaction(() => {
      const day = indiaDay(now);
      const n = (this.db.prepare("SELECT COUNT(*) n FROM blog_jobs WHERE day=? AND kind='draft'").get(day) as any).n;
      if (n >= this.settings().dailyDraftCap) throw new Error("DRAFT_DAILY_CAP");
      return this.db.prepare("INSERT INTO blog_jobs(day,slot,kind,due_at,created_at) VALUES(?,?,'draft',?,?)")
        .run(day, `draft-${n + 1}`, now, now).lastInsertRowid;
    }).immediate();
  }
  recoverJob(id: number, now = Date.now()) {
    return this.db.transaction(() => {
      const job = this.db.prepare("SELECT * FROM blog_jobs WHERE id=?").get(id) as any;
      // One explicit recovery, only today's failed new slot, with attempts left.
      // Never reset attempt/cost counters, re-open old days or override a safety rejection.
      if (!job || job.day !== indiaDay(now) || job.kind !== "new" || job.status !== "failed" ||
          job.attempts >= this.settings().maxAttempts ||
          !/^(TOPIC_QUEUE_EMPTY|PUBLIC_CATALOG_INSUFFICIENT|DAILY_PROVIDER_BUDGET|BUDGET_RESERVED_FOR_(NEW_POSTS|OTHER_NEW_SLOT)|PROVIDER_(NETWORK_ERROR|TIMEOUT|RATE_LIMIT|REQUEST_FAILED)|EVIDENCE_(INSUFFICIENT|SOURCES_UNREACHABLE)|ARTICLE_SCHEMA_INVALID)$/.test(job.error_code || "") ||
          this.db.prepare("SELECT 1 FROM blog_job_recoveries WHERE job_id=?").get(id))
        throw new Error("JOB_RECOVERY_NOT_ELIGIBLE");
      if (job.topic_id && (
        this.db.prepare("SELECT 1 FROM blog_topics WHERE id=? AND status='blocked'").get(job.topic_id) ||
        this.db.prepare("SELECT 1 FROM blog_articles WHERE topic_id=?").get(job.topic_id) ||
        this.db.prepare("SELECT 1 FROM blog_jobs WHERE topic_id=? AND id!=? AND status IN ('queued','retry','running')")
          .get(job.topic_id, id))) throw new Error("JOB_RECOVERY_NOT_ELIGIBLE");
      this.db.prepare("INSERT INTO blog_job_recoveries VALUES(?,?,?,?)").run(id, job.error_code, job.attempts, now);
      this.db.prepare("UPDATE blog_jobs SET status='retry',retry_at=MAX(retry_at,?) WHERE id=?").run(now, id);
      return { jobId: id, attemptsRemaining: this.settings().maxAttempts - job.attempts,
        nextEligibleAt: Math.max(now, job.retry_at), mode: this.settings().mode };
    }).immediate();
  }
  private reserve(day: string, calls: number, tokens: number, protectNew = false) {
    const s = this.settings();
    this.db.prepare("INSERT OR IGNORE INTO blog_usage(day) VALUES(?)").run(day);
    if (protectNew && s.mode === "auto") {
      const usage = this.db.prepare("SELECT calls,tokens FROM blog_usage WHERE day=?").get(day) as any;
      const started = (this.db.prepare("SELECT COUNT(*) n FROM blog_jobs WHERE day=? AND kind='new' AND attempts>0").get(day) as any).n;
      const remaining = Math.max(0, 2 - started);
      if (usage.calls + calls + remaining * 3 > s.dailyCallBudget ||
          usage.tokens + tokens + remaining * TOKEN_RESERVATION > s.dailyTokenBudget) throw new Error("BUDGET_RESERVED_FOR_NEW_POSTS");
    }
    const result = this.db.prepare(`UPDATE blog_usage SET calls=calls+?,tokens=tokens+?
      WHERE day=? AND calls+?<=? AND tokens+?<=?`).run(calls, tokens, day, calls, s.dailyCallBudget, tokens, s.dailyTokenBudget);
    if (!result.changes) throw new Error("DAILY_PROVIDER_BUDGET");
  }
  private claim(now: number, requestedJobId?: number): any {
    return this.db.transaction(() => {
      const token = randomUUID();
      if (!this.db.prepare("UPDATE blog_worker_lock SET token=?,expires=? WHERE id=1 AND expires<?").run(token, now + LEASE_MS, now).changes) return null;
      const s = this.settings(), day = indiaDay(now);
      this.db.prepare(`UPDATE blog_jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',finished_at=?
        WHERE day=? AND attempts>=? AND status IN ('running','retry') AND COALESCE(lease_until,0)<?`).run(now, day, s.maxAttempts, now);
      const job = this.db.prepare(`SELECT * FROM blog_jobs WHERE day=? AND attempts<? AND due_at<=? AND retry_at<=?
        AND (? IS NULL OR id=?)
        AND (status IN ('queued','retry') OR (status='running' AND lease_until<?))
        ORDER BY due_at,id LIMIT 1`).get(day, s.maxAttempts, now, now, requestedJobId ?? null, requestedJobId ?? null, now) as any;
      if (!job) { this.release(token); return null; }
      this.db.prepare(`UPDATE blog_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,
        error_code=NULL WHERE id=?`).run(token, now + LEASE_MS, job.id);
      return { ...job, lease_token: token, attempts: job.attempts + 1 };
    }).immediate();
  }
  private release(token: string) {
    this.db.prepare("UPDATE blog_worker_lock SET token=NULL,expires=0 WHERE id=1 AND token=?").run(token);
  }
  private ensureLease(job: any, now: number) {
    const row = this.db.prepare("SELECT token,expires FROM blog_worker_lock WHERE id=1").get() as any;
    if (row.token !== job.lease_token || row.expires <= now || indiaDay(now) !== job.day) throw new Error("LEASE_EXPIRED");
  }
  private choose(job: any, now: number): { topic: any; existing?: any } {
    if (job.kind === "improve") {
      const existing = (job.post_id
        ? this.db.prepare("SELECT p.* FROM posts p JOIN blog_articles a ON a.post_id=p.id WHERE p.id=? AND p.published=1 AND p.updated_at<?").get(job.post_id, now - 7 * 86400000)
        : this.db.prepare(`SELECT p.* FROM posts p JOIN blog_articles a ON a.post_id=p.id WHERE p.published=1 AND p.updated_at<? ORDER BY p.updated_at,p.id LIMIT 1`).get(now - 7 * 86400000)) as any;
      if (!existing) throw new Error("NO_SUPPORTED_CHANGE");
      const managed = this.db.prepare("SELECT * FROM blog_articles WHERE post_id=?").get(existing.id) as any;
      const topic = managed?.topic_id ? this.db.prepare("SELECT * FROM blog_topics WHERE id=?").get(managed.topic_id) : {
        title: existing.title, category: "procurement", cluster_id: 3, product_ids: "[]",
      };
      // Legacy titles are not trusted prompt text; reject contact-like or excessively long values.
      if (!/^[a-zA-Z0-9 ,:?!&()/'–—-]{20,160}$/.test(existing.title) || /\d{7,}/.test(existing.title)) throw new Error("LEGACY_TITLE_UNSAFE");
      this.db.prepare("UPDATE blog_jobs SET post_id=? WHERE id=?").run(existing.id, job.id);
      return { topic, existing };
    }
    if (!job.topic_id) this.plan(now);
    const topic = (job.topic_id ? this.db.prepare("SELECT * FROM blog_topics WHERE id=?").get(job.topic_id) :
      this.db.prepare(`SELECT t.* FROM blog_topics t LEFT JOIN blog_topic_recovery r ON r.topic_id=t.id
        WHERE t.status='queued'
        ORDER BY (t.category=COALESCE((SELECT prev.category FROM blog_jobs j JOIN blog_topics prev ON prev.id=j.topic_id
          WHERE j.topic_id IS NOT NULL ORDER BY j.id DESC LIMIT 1),'')),
          COALESCE(r.failures,0),t.id LIMIT 1`).get()) as any;
    if (!topic) throw new Error("TOPIC_QUEUE_EMPTY");
    this.db.prepare("UPDATE blog_topics SET status='assigned' WHERE id=?").run(topic.id);
    this.db.prepare("UPDATE blog_jobs SET topic_id=? WHERE id=?").run(topic.id, job.id);
    return { topic };
  }
  private saveSnapshot(postId: number, snapshot: any, reason: string, now: number) {
    this.db.prepare("INSERT INTO blog_versions(post_id,snapshot,reason,created_at) VALUES(?,?,?,?)")
      .run(postId, JSON.stringify(snapshot), reason, now);
  }
  private relationships(postId: number, snapshot: any) {
    this.db.prepare("DELETE FROM blog_sources WHERE post_id=?").run(postId);
    this.db.prepare("DELETE FROM blog_article_products WHERE post_id=?").run(postId);
    for (const s of snapshot.sources as BlogSource[]) this.db.prepare("INSERT OR IGNORE INTO blog_sources VALUES(?,?,?,?)")
      .run(postId, s.url, s.title, s.accessedAt);
    for (const slug of snapshot.productSlugs as string[]) this.db.prepare(`INSERT OR IGNORE INTO blog_article_products
      SELECT ?,id FROM products WHERE slug=? AND active=1`).run(postId, slug);
  }
  private replenish(draft: ArticleDraft, sources: BlogSource[], topic: any, now: number) {
    const titles = (this.db.prepare("SELECT title FROM blog_topics UNION ALL SELECT title FROM posts").all() as any[]).map(r => r.title);
    let queued = (this.db.prepare("SELECT COUNT(*) n FROM blog_topics WHERE status='queued'").get() as any).n;
    for (const follow of draft.followUpTopics) {
      if (queued >= 24 || titles.some(t => similarity(t, follow.title) > 0.75)) continue;
      const source = sources.find(s => s.url === follow.sourceUrl);
      if (!source) continue; // validated earlier; fail-closed defensive boundary
      const fingerprint = createHash("sha256").update(follow.title.toLowerCase()).digest("hex");
      const r = this.db.prepare(`INSERT OR IGNORE INTO blog_topics(fingerprint,title,cluster_id,intent,category,product_ids,created_at)
        VALUES(?,?,?,'research-discovery',?,?,?)`).run(fingerprint, follow.title, topic.cluster_id, topic.category, topic.product_ids, now);
      if (r.changes) {
        this.db.prepare("INSERT INTO blog_topic_signals VALUES(?,?,?,?)").run(r.lastInsertRowid, source.url, source.accessedAt, follow.evidenceQuote);
        queued++; titles.push(follow.title);
      }
    }
    if (topic.id) for (const source of sources) this.db.prepare("INSERT OR IGNORE INTO blog_topic_signals VALUES(?,?,?,?)")
      .run(topic.id, source.url, source.accessedAt, "Research reference used for this editorial topic; no search-volume estimate.");
  }
  private firstPublish(post: any, now: number, jobId?: number) {
    if (post.published_at || post.published) return;
    const day = indiaDay(now);
    if ((this.db.prepare("SELECT COUNT(*) n FROM blog_publications WHERE day=?").get(day) as any).n >= 2) throw new Error("NEW_PUBLICATION_DAILY_CAP");
    this.db.prepare("INSERT INTO blog_publications(post_id,day,job_id) VALUES(?,?,?)").run(post.id, day, jobId || null);
  }
  private persist(draft: ArticleDraft, sources: BlogSource[], topic: any, existing: any, job: any, now: number) {
    const snapshot = { ...draft, sources };
    const publish = !job.forceDraft && job.kind !== "draft" && this.settings().mode === "auto";
    if (existing && !publish) {
      this.db.prepare(`INSERT OR IGNORE INTO blog_articles(post_id,topic_id,cluster_id,category,snapshot,updated_at) VALUES(?,?,?,?,?,?)`)
        .run(existing.id, topic.id || null, topic.cluster_id, topic.category, JSON.stringify({
          title: existing.title, excerpt: existing.excerpt, content: cleanHtml(existing.content),
          metaTitle: existing.meta_title, metaDescription: existing.meta_description,
          sources: [], claims: [], productSlugs: [], improvementSummary: "", followUpTopics: [],
        }), now);
      this.saveSnapshot(existing.id, snapshot, "proposed-improvement", now);
      return existing.id;
    }
    let id: number;
    if (existing) {
      id = existing.id;
      const prior = this.db.prepare("SELECT snapshot FROM blog_articles WHERE post_id=?").get(id) as any;
      this.saveSnapshot(id, prior ? JSON.parse(prior.snapshot) : {
        title: existing.title, excerpt: existing.excerpt, content: cleanHtml(existing.content), metaTitle: existing.meta_title,
        metaDescription: existing.meta_description, sources: [], claims: [], productSlugs: [],
      }, "before-improvement", now);
      this.db.prepare(`UPDATE posts SET title=?,excerpt=?,content=?,meta_title=?,meta_description=?,author_name=?,
        published_at=COALESCE(published_at,created_at),updated_at=? WHERE id=?`)
        .run(draft.title, draft.excerpt, draft.content, draft.metaTitle, draft.metaDescription, BLOG_EDITOR, now, id);
    } else {
      const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 130);
      if (this.db.prepare("SELECT id FROM posts WHERE slug=?").get(slug)) throw new Error("DUPLICATE_SLUG");
      id = Number(this.db.prepare(`INSERT INTO posts(slug,title,excerpt,content,meta_title,meta_description,author_name,published,published_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,0,NULL,?,?)`).run(slug, draft.title, draft.excerpt, draft.content,
        draft.metaTitle, draft.metaDescription, BLOG_EDITOR, now, now).lastInsertRowid);
      if (publish) {
        this.firstPublish({ id }, now, job.id);
        this.db.prepare("UPDATE posts SET published=1,published_at=? WHERE id=?").run(now, id);
      }
    }
    this.db.prepare(`INSERT INTO blog_articles(post_id,topic_id,cluster_id,category,snapshot,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(post_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=excluded.updated_at`)
      .run(id, topic.id || null, topic.cluster_id, topic.category, JSON.stringify(snapshot), now);
    this.saveSnapshot(id, snapshot, existing ? "auto-improvement" : publish ? "auto-published" : "generated-draft", now);
    this.relationships(id, snapshot);
    this.replenish(draft, sources, topic, now);
    if (publish) this.db.prepare("UPDATE blog_clusters SET pillar_post_id=COALESCE(pillar_post_id,?) WHERE id=?").run(id, topic.cluster_id);
    if (topic.id) this.db.prepare("UPDATE blog_topics SET status='completed' WHERE id=?").run(topic.id);
    return id;
  }
  async tick(now = Date.now(), requestedJobId?: number) {
    const initialMode = this.settings().mode;
    if (!this.enabled() || !this.providers.status().ready || (initialMode === "pause" && requestedJobId === undefined)) return;
    // Explicit admin verification never catches up unrelated scheduled slots.
    if (requestedJobId === undefined) this.enqueueDue(now);
    const staleBudgets = this.db.prepare(`SELECT b.lease_token FROM blog_attempt_budget b JOIN blog_jobs j ON j.id=b.job_id
      WHERE b.settled=0 AND (j.lease_token!=b.lease_token OR COALESCE(j.lease_until,0)<=?
        OR j.status NOT IN ('running'))`).all(now) as any[];
    for (const b of staleBudgets) this.settleBudget(b.lease_token);
    const job = this.claim(now, requestedJobId); if (!job) return;
    job.allowPaused = requestedJobId !== undefined && initialMode === "pause";
    job.forceDraft = initialMode !== "auto";
    // Test clock may be injected; real processing elapsed time still expires the lease.
    const start = Date.now(), clock = () => now + (Date.now() - start);
    try {
      const { topic, existing } = this.choose(job, now);
      // Skipped improvements spend nothing. Protect one attempt for each other
      // unattempted daily new-post slot, including the not-yet-due evening slot.
      this.db.transaction(() => {
        const settings = this.settings(), usage = this.db.prepare("SELECT calls,tokens FROM blog_usage WHERE day=?").get(job.day) as any || { calls: 0, tokens: 0 };
        const started = (this.db.prepare("SELECT COUNT(*) n FROM blog_jobs WHERE day=? AND kind='new' AND attempts>0").get(job.day) as any).n;
        const protectedSlots = Math.max(0, 2 - started);
        if (settings.mode === "auto" && (job.kind !== "new" || job.attempts > 1) &&
          (usage.calls + 3 + protectedSlots * 3 > settings.dailyCallBudget ||
           usage.tokens + TOKEN_RESERVATION * (1 + protectedSlots) > settings.dailyTokenBudget))
          throw new Error(job.kind === "new" ? "BUDGET_RESERVED_FOR_OTHER_NEW_SLOT" : "BUDGET_RESERVED_FOR_NEW_POSTS");
        this.reserve(job.day, 3, TOKEN_RESERVATION);
        this.db.prepare("UPDATE blog_jobs SET calls=calls+3,token_reserved=token_reserved+? WHERE id=?").run(TOKEN_RESERVATION, job.id);
        this.db.prepare("INSERT INTO blog_attempt_budget(lease_token,job_id,day) VALUES(?,?,?)").run(job.lease_token, job.id, job.day);
      }).immediate();
      const ids = JSON.parse(topic.product_ids);
      const facts = catalogFeed(this.db).filter(f => ids.includes(f.id)).slice(0, 3);
      // Search for technical evidence, not the long templated editorial headline.
      const researchQuery = topic.intent === "research-discovery" || topic.intent === "geography" ? topic.title :
        `${facts[0]?.brand || ""} ${topic.category} parts ${job.attempts > 1 ? "service maintenance reference" : "identification documentation"} manufacturer`;
      this.startStage(job, "research", clock());
      const sources = await this.providers.research(researchQuery);
      const links = internalLinks(this.db);
      const cluster = this.db.prepare("SELECT name,pillar_post_id FROM blog_clusters WHERE id=?").get(topic.cluster_id) as any;
      const pillar = cluster?.pillar_post_id && this.db.prepare("SELECT slug FROM posts WHERE id=? AND published=1").get(cluster.pillar_post_id) as any;
      const supporting = this.db.prepare(`SELECT p.slug FROM posts p JOIN blog_articles a ON a.post_id=p.id
        WHERE p.published=1 AND a.cluster_id=? ORDER BY p.published_at DESC LIMIT 3`).all(topic.cluster_id) as any[];
      // Existing managed content already passed privacy checks. Unmanaged legacy prose
      // is not sent to AI: research the safe title afresh rather than risk old free-text PII.
      const managed = existing && this.db.prepare("SELECT post_id FROM blog_articles WHERE post_id=?").get(existing.id);
      const diagnosticRow = this.db.prepare("SELECT details FROM blog_job_schema_diagnostics WHERE job_id=?").get(job.id) as any;
      const schemaFeedback: SchemaDiagnostic[] = diagnosticRow ? JSON.parse(diagnosticRow.details) : [];
      this.startStage(job, "generate", clock());
      const generated = await this.providers.generate({
        topic: topic.title, category: topic.category, catalog: facts,
        cluster: cluster?.name, editorialRole: pillar ? "supporting article" : "evidence-led overview/pillar",
        pillarLink: pillar ? `/blog/${pillar.slug}` : undefined,
        links: ["/products", "/contact", ...facts.map(productPath),
          ...(pillar ? [`/blog/${pillar.slug}`] : []),
          ...supporting.map(p => `/blog/${p.slug}`).filter(l => links.includes(l))],
        sources, previousArticle: managed ? cleanHtml(existing.content).slice(0, 6500) : undefined,
        ...(schemaFeedback.length ? { schemaFeedback,
          repairInstruction: "The prior attempt failed these schema rules. Correct these fields using the supplied evidence. Never invent or extend quotations. Omit optional follow-up questions if invalid. Return a complete valid article." } : {}),
      });
      this.db.prepare("UPDATE blog_jobs SET token_used=token_used+? WHERE id=? AND lease_token=?").run(generated.tokens, job.id, job.lease_token);
      const draft = validateArticle(this.db, generated.draft, sources, existing?.id);
      if (existing && (!draft.improvementSummary || !hasSubstantiveChange(draft.content, existing.content)))
        throw new Error("NO_SUPPORTED_CHANGE");
      this.startStage(job, "review", clock());
      const review = await this.providers.review(draft, sources);
      this.db.prepare("UPDATE blog_jobs SET token_used=token_used+? WHERE id=? AND lease_token=?").run(review.tokens, job.id, job.lease_token);
      if (!review.supported) throw new Error("EDITORIAL_REVIEW_FAILED");
      this.db.transaction(() => {
        this.ensureLease(job, clock());
        if (!this.enabled() || (this.settings().mode === "pause" && !job.allowPaused)) throw new Error("PAUSED_DURING_JOB");
        // An editor may have unpublished or changed the article while a provider was running.
        if (existing) {
          const current = this.db.prepare("SELECT published,updated_at FROM posts WHERE id=?").get(existing.id) as any;
          if (!current?.published || current.updated_at !== existing.updated_at) throw new Error("ARTICLE_CHANGED_DURING_JOB");
        }
        const postId = this.persist(draft, sources, topic, existing, job, clock());
        this.db.prepare("UPDATE blog_jobs SET status='succeeded',post_id=?,finished_at=? WHERE id=? AND lease_token=?")
          .run(postId, clock(), job.id, job.lease_token);
        this.db.prepare("DELETE FROM blog_job_schema_diagnostics WHERE job_id=?").run(job.id);
      }).immediate();
    } catch (error) {
      const code = safeCode(error);
      if (error instanceof ArticleSchemaValidationError) {
        // The generated article itself is deliberately NOT persisted on failure.
        // Fence diagnostics too: an expired worker cannot replace a newer attempt's result.
        const owned = this.db.prepare("SELECT id FROM blog_jobs WHERE id=? AND lease_token=?").get(job.id, job.lease_token);
        if (owned) {
          this.db.prepare(`INSERT INTO blog_job_schema_diagnostics(job_id,details,created_at) VALUES(?,?,?)
            ON CONFLICT(job_id) DO UPDATE SET details=excluded.details,created_at=excluded.created_at`)
            .run(job.id, JSON.stringify(error.diagnostics), clock());
          console.warn("[auto-blogger] schema_validation", JSON.stringify({ jobId: job.id, attempt: job.attempts, issues: error.diagnostics }));
        }
      }
      const skipped = code === "NO_SUPPORTED_CHANGE";
      const retryable = /^(PROVIDER_(?:NETWORK|TIMEOUT|RATE|REQUEST|RESPONSE|EMPTY)|SOURCE_|EVIDENCE_|LEASE_EXPIRED|ARTICLE_SCHEMA_INVALID$|GENERATION_(?:JSON_INVALID|TRUNCATED))/.test(code);
      const status = skipped ? "skipped" : retryable && job.attempts < this.settings().maxAttempts ? "retry" : "failed";
      this.db.prepare(`UPDATE blog_jobs SET status=?,error_code=?,retry_at=?,finished_at=?
        WHERE id=? AND lease_token=?`).run(status, code, clock() + 5 * 60000 * job.attempts, clock(), job.id, job.lease_token);
    } finally {
      this.settleBudget(job.lease_token);
      this.release(job.lease_token);
      const result = this.db.prepare(`SELECT id,day,kind,status,attempts,error_code,calls,token_reserved,post_id
        FROM blog_jobs WHERE id=? AND lease_token=?`).get(job.id, job.lease_token);
      if (result) console.info("[auto-blogger] job_result", JSON.stringify(result));
    }
  }
  article(id: number) {
    const row = this.db.prepare(`SELECT p.*,a.snapshot,a.category FROM posts p JOIN blog_articles a ON a.post_id=p.id WHERE p.id=?`).get(id) as any;
    if (!row) throw new Error("ARTICLE_NOT_FOUND");
    return { ...row, snapshot: JSON.parse(row.snapshot),
      revisions: this.db.prepare("SELECT id,reason,created_at FROM blog_versions WHERE post_id=? ORDER BY id DESC LIMIT 100").all(id) };
  }
  unpublish(id: number, now = Date.now()) {
    const a = this.article(id);
    this.saveSnapshot(id, a.snapshot, "unpublished", now);
    this.db.prepare("UPDATE posts SET published=0,updated_at=? WHERE id=?").run(now, id);
  }
  async edit(id: number, input: any, now = Date.now()) {
    const started = Date.now(), clock = () => now + (Date.now() - started);
    const a = this.article(id);
    let snapshot = a.snapshot;
    if (input.revisionId) {
      const revision = this.db.prepare("SELECT snapshot FROM blog_versions WHERE id=? AND post_id=?").get(input.revisionId, id) as any;
      if (!revision) throw new Error("REVISION_NOT_FOUND");
      snapshot = JSON.parse(revision.snapshot);
    } else {
      for (const field of ["title", "excerpt", "content", "metaTitle", "metaDescription", "claims"])
        if (input[field] !== undefined) snapshot = { ...snapshot, [field]: input[field] };
    }
    const { sources, ...data } = snapshot;
    const draft = validateArticle(this.db, data, sources, id);
    // Saves to a live article or explicit publish must pass the same grounded reviewer.
    const publish = input.publish === true || (a.published && input.publish !== false);
    if (publish) {
      if (!this.enabled() || !this.providers.status().ready) throw new Error("PROVIDERS_UNAVAILABLE");
      this.reserve(indiaDay(now), 1, 26000, true);
      const review = await this.providers.review(draft, sources);
      if (!review.supported) throw new Error("EDITORIAL_REVIEW_FAILED");
    }
    this.db.transaction(() => {
      const savedAt = clock();
      if (publish && (!this.enabled() || !this.providers.status().ready)) throw new Error("PROVIDERS_UNAVAILABLE");
      const current = this.db.prepare("SELECT updated_at,published FROM posts WHERE id=?").get(id) as any;
      if (current.updated_at !== a.updated_at || current.published !== a.published) throw new Error("ARTICLE_CHANGED_DURING_JOB");
      if (publish) this.firstPublish(a, savedAt);
      this.saveSnapshot(id, a.snapshot, "before-edit", savedAt);
      const next = { ...draft, sources };
      this.db.prepare(`UPDATE posts SET title=?,excerpt=?,content=?,meta_title=?,meta_description=?,published=?,
        published_at=CASE WHEN ?=1 THEN COALESCE(published_at,?) ELSE published_at END,updated_at=? WHERE id=?`)
        .run(draft.title, draft.excerpt, draft.content, draft.metaTitle, draft.metaDescription, publish ? 1 : 0,
          publish ? 1 : 0, a.published ? a.published_at || a.created_at : savedAt, savedAt, id);
      this.db.prepare("UPDATE blog_articles SET snapshot=?,updated_at=? WHERE post_id=?").run(JSON.stringify(next), savedAt, id);
      this.relationships(id, next);
      this.saveSnapshot(id, next, input.revisionId ? "rollback" : "editor-save", savedAt);
    }).immediate();
    return this.article(id);
  }
}
