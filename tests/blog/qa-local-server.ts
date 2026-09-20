// Local browser QA fixture only; not imported or bundled by the production application.
import express from "express";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AutoBlogger } from "../../server/auto-blogger";
import { registerAutoBloggerRoutes } from "../../server/auto-blogger-routes";
import { BLOG_EDITOR } from "../../shared/auto-blogger";

const db = new Database(join(mkdtempSync(join(tmpdir(), "narmada-vitest-browser-")), "fixture.db"));
db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,slug TEXT,name TEXT,brand TEXT,category TEXT,part_number TEXT,active INTEGER);
CREATE TABLE posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,title TEXT,excerpt TEXT,content TEXT,meta_title TEXT,meta_description TEXT,author_name TEXT,published INTEGER DEFAULT 0,published_at INTEGER,created_at INTEGER,updated_at INTEGER);
INSERT INTO products VALUES(1,'fixture-filter','Filter — QA catalog fixture','Tata','filter','QA-FILTER-1',1);`);
const providers = { status: () => ({ ready: true, generation: true, research: true }),
  research: async () => { throw new Error("QA_NO_PAID_GENERATIONS"); }, generate: async () => { throw new Error("QA_NO_PAID_GENERATIONS"); },
  review: async () => ({ supported: true, tokens: 0 }) };
const engine = new AutoBlogger(db, providers, () => true);
const now = Date.now();
const title = "A clearer parts enquiry starts with the right information";
const content = `<h2>Start with the vehicle record</h2><p>A maintenance record helps identify the components used on a commercial vehicle. Keep the available vehicle details together rather than relying on a photograph alone. A short enquiry that separates confirmed identifiers from open questions gives the receiving team a clearer starting point.</p>
<p>Before sending an enquiry, note the vehicle make, the available model reference and the component being discussed. If a detail is uncertain, say so. Avoid treating a visual resemblance as confirmation that a replacement will fit. A written record makes it easier to compare the answer you receive with the original requirement.</p>
<h2>Separate identification from compatibility</h2><p>Record the part number when preparing a replacement component enquiry. Identifying marks can help organize a conversation, but an identifier alone should not be treated as an assurance of stock or suitability. Keep the original reference alongside any alternative suggested for review.</p>
<p>Ask what additional information is needed to confirm the requirement. Depending on the component, the team may need another view of the label or clearer vehicle details. Do not guess missing characters or replace an unclear number with the first similar result from an online search. Mark uncertain information clearly and resolve it before ordering.</p>
<h2>Make your checklist easy to review</h2><ul><li>List the component and the quantity requested.</li><li>Include the verified reference, when available.</li><li>Separate required confirmation from known details.</li><li>Ask the team to confirm availability before a purchase decision.</li></ul>
<p>Keep each requested component on its own line. A short, consistent list reduces avoidable follow-up questions and makes it easier to see which points remain unresolved. Where photographs are available, label them so the person reviewing the enquiry can connect each image to the relevant line.</p>
<p>When a response arrives, compare it against the same checklist rather than judging only the headline amount. A quote is a useful commercial document, but it does not replace the need to clarify the exact requirement. Keep technical confirmation and commercial terms distinct so neither is silently assumed from the other.</p>
<h2>Keep a useful record of the answer</h2><p>Save the final confirmed details with your service records and note any outstanding questions. If the requirement changes, send a clear correction rather than adding another unlabeled message to the conversation. A concise update helps everyone work from the same version of the request.</p>
<p>The aim is not a longer enquiry. It is a more precise one: known details are recorded, assumptions are visible and questions have an owner. This approach can also make later conversations easier because the information used to make the decision is available for review.</p>
<p>This is a local QA article, not live business content. Technical reference fixtures: <a href="https://www.tatamotors.com/technical">Tata Motors</a> and <a href="https://www.cummins.com/parts">Cummins</a>. Explore the <a href="/products">parts catalog</a> or <a href="/contact">request a quote</a>.</p>`;
const sources = [
  { url: "https://www.tatamotors.com/technical", title: "Tata Motors — offline reference fixture", text: "A maintenance record helps identify the components used on a commercial vehicle.", accessedAt: now },
  { url: "https://www.cummins.com/parts", title: "Cummins — offline reference fixture", text: "Record the part number when preparing a replacement component enquiry.", accessedAt: now },
];
const claims = sources.map(s => ({ claim: s.text, sourceUrl: s.url, evidenceQuote: s.text }));
for (const source of sources) source.text += " " + Array.from({ length: 100 }, (_, i) => `referencecontext${i}`).join(" ");
const snapshot = { title, excerpt: "A practical checklist for gathering vehicle details, identifying references and asking better questions before requesting a quote.",
  content, metaTitle: "Prepare a clearer commercial vehicle parts enquiry", metaDescription: "Gather vehicle details, component references and open technical questions before requesting a quote from the Narmada Mobility team.",
  claims, sources, productSlugs: ["fixture-filter"], improvementSummary: "", followUpTopics: [] };
for (let i = 1; i <= 26; i++) {
  const t = i === 1 ? title : ["Receiving components: keep the order record clear", "Fleet procurement: questions before comparing quotations", "Filter enquiries: record the reference without guessing"][i % 3];
  const s = { ...snapshot, title: t, content: i === 1 ? content : `<p>Offline catalog QA fixture ${i}. This placeholder is used only to exercise list pagination and is never published to the production business website.</p>` };
  db.prepare(`INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(i, `fixture-insight-${i}`, t, s.excerpt, s.content,
    s.metaTitle, s.metaDescription, BLOG_EDITOR, i === 14 ? 0 : 1, i === 14 ? null : now - i * 86400000, now - i * 86400000, now - i * 86400000);
  db.prepare("INSERT INTO blog_articles(post_id,cluster_id,category,snapshot,updated_at) VALUES(?,?,?,?,?)")
    .run(i, i % 3 + 1, i % 2 ? "procurement" : "filter", JSON.stringify(s), now);
  db.prepare("INSERT INTO blog_versions(post_id,snapshot,reason,created_at) VALUES(?,?,?,?)").run(i, JSON.stringify(s), "generated-draft", now);
  for (const source of sources) db.prepare("INSERT INTO blog_sources VALUES(?,?,?,?)").run(i, source.url, source.title, now);
  db.prepare("INSERT INTO blog_article_products VALUES(?,1)").run(i);
}
engine.plan();
db.prepare("UPDATE blog_clusters SET pillar_post_id=1 WHERE id=1").run();
db.prepare("INSERT INTO blog_jobs(day,slot,kind,status,due_at,attempts,error_code,created_at) VALUES('2026-09-20','new-am','new','failed',?,1,'EVIDENCE_INSUFFICIENT',?)").run(now, now);
const app = express(); app.use(express.json());
app.get("/config.js", (_req, res) => res.type("js").send("window.__API_BASE__='';"));
app.get("/api/admin/me", (_req, res) => res.json({ username: "QA Admin", role: "admin", displayName: "QA Admin" }));
app.post("/qa/availability", (req, res) => { providers.status = () => ({ ready: !!req.body.ready, research: !!req.body.ready, generation: !!req.body.ready }); res.json({ ok: true }); });
registerAutoBloggerRoutes(app, db, (req, res, next) => req.headers["x-admin-token"] === "qa-local-only" ? next() : res.status(401).json({ error: "Unauthorized" }), engine);
app.use("/api", (_req, res) => res.json({ items: [], products: [], count: 0, total: 0 }));
app.get("/qa/spa", (_req, res) => res.sendFile(resolve("dist/public/index.html")));
app.use(express.static(resolve("dist/public")));
app.use((_req, res) => res.sendFile(resolve("dist/public/index.html")));
app.listen(5128, "0.0.0.0", () => console.log("R28.18 isolated QA fixture server on 5128; no live providers"));
