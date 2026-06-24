// PartSetu AI v1.4 D2 — Teaching Module.
// Four tabs: Synonyms, Answers, Rules (CRUD) and Lessons Import (parse free text
// via Claude → review → apply). All teaching lives in our sqlite DB only.
import { useEffect, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { Plus, Trash2, Sparkles, BookOpen, MessageSquare, ScrollText } from "lucide-react";

type Tab = "synonyms" | "answers" | "rules" | "lessons";

export default function AdminPartSetuTeach() {
  const { token, role } = useShellAuth();
  const canDelete = role !== "data_center";
  const [tab, setTab] = useState<Tab>("synonyms");

  return (
    <ShellLayout title="PartSetu — Teach">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4" /> Teach the PartSetu chatbot. Synonyms expand queries, Answers bypass search for known questions, Rules inject high-authority guidance. Everything is stored in our database.
      </div>
      <div className="flex gap-1 border-b mb-5">
        {([
          ["synonyms", "Synonyms", BookOpen],
          ["answers", "Answers", MessageSquare],
          ["rules", "Rules", ScrollText],
          ["lessons", "Lessons Import", Sparkles],
        ] as [Tab, string, any][]).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${k}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "synonyms" && <SynonymsTab token={token} canDelete={canDelete} />}
      {tab === "answers" && <AnswersTab token={token} canDelete={canDelete} />}
      {tab === "rules" && <RulesTab token={token} canDelete={canDelete} />}
      {tab === "lessons" && <LessonsTab token={token} />}
    </ShellLayout>
  );
}

function Msg({ m }: { m: { kind: "ok" | "err"; text: string } | null }) {
  if (!m) return null;
  return <div className={`my-3 text-sm ${m.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{m.text}</div>;
}

// ---------------- Synonyms ----------------
function SynonymsTab({ token, canDelete }: { token: string | null; canDelete: boolean }) {
  const { adminFetch } = useShellAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [queryTerm, setQueryTerm] = useState("");
  const [expanded, setExpanded] = useState("");
  const [catalogId, setCatalogId] = useState("");

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/partsetu/synonyms");
    setRows(r.ok ? await r.json() : []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function add() {
    if (!token || !queryTerm.trim()) return;
    const terms = expanded.split(",").map((t) => t.trim()).filter(Boolean);
    const r = await adminFetch(token, "/api/admin/partsetu/synonyms", {
      method: "POST",
      body: JSON.stringify({ queryTerm: queryTerm.trim(), expandedTerms: terms, catalogId: catalogId ? Number(catalogId) : null }),
    });
    if (r.ok) { setMsg({ kind: "ok", text: "Synonym saved." }); setQueryTerm(""); setExpanded(""); setCatalogId(""); load(); }
    else setMsg({ kind: "err", text: "Save failed." });
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this synonym?")) return;
    await adminFetch(token, `/api/admin/partsetu/synonyms/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="border rounded-lg p-4 mb-4 bg-muted/20 flex flex-wrap items-end gap-3">
        <Labeled label="Query term"><input value={queryTerm} onChange={(e) => setQueryTerm(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm" data-testid="input-syn-term" /></Labeled>
        <Labeled label="Expanded terms (comma-separated)"><input value={expanded} onChange={(e) => setExpanded(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-80" data-testid="input-syn-expanded" /></Labeled>
        <Labeled label="Catalog ID (optional)"><input value={catalogId} onChange={(e) => setCatalogId(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-32" data-testid="input-syn-catalog" /></Labeled>
        <button onClick={add} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold" data-testid="button-syn-add"><Plus className="w-4 h-4" />Add</button>
      </div>
      <Msg m={msg} />
      <Table head={["Term", "Expands to", "Catalog", "Source", ""]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-t" data-testid={`syn-row-${r.id}`}>
            <td className="px-3 py-2 font-medium">{r.query_term}</td>
            <td className="px-3 py-2">{(() => { try { return (JSON.parse(r.expanded_terms_json || "[]") as string[]).join(", "); } catch { return "—"; } })()}</td>
            <td className="px-3 py-2">{r.catalog_id ?? "global"}</td>
            <td className="px-3 py-2 text-muted-foreground">{r.source || "—"}</td>
            <td className="px-3 py-2 text-right">{canDelete && <button onClick={() => del(r.id)} className="text-rose-600 hover:underline inline-flex items-center gap-1" data-testid={`syn-delete-${r.id}`}><Trash2 className="w-4 h-4" /></button>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------------- Answers ----------------
function AnswersTab({ token, canDelete }: { token: string | null; canDelete: boolean }) {
  const { adminFetch } = useShellAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pattern, setPattern] = useState("");
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [catalogId, setCatalogId] = useState("");

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/partsetu/answers");
    setRows(r.ok ? await r.json() : []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function add() {
    if (!token || !pattern.trim()) return;
    const partNumbers = parts.split(",").map((t) => t.trim()).filter(Boolean);
    const r = await adminFetch(token, "/api/admin/partsetu/answers", {
      method: "POST",
      body: JSON.stringify({ queryPattern: pattern.trim(), partNumbers, notes: notes.trim() || null, catalogId: catalogId ? Number(catalogId) : null }),
    });
    if (r.ok) { setMsg({ kind: "ok", text: "Answer saved." }); setPattern(""); setParts(""); setNotes(""); setCatalogId(""); load(); }
    else setMsg({ kind: "err", text: "Save failed." });
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this answer?")) return;
    await adminFetch(token, `/api/admin/partsetu/answers/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="border rounded-lg p-4 mb-4 bg-muted/20 flex flex-wrap items-end gap-3">
        <Labeled label="Query pattern"><input value={pattern} onChange={(e) => setPattern(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-72" data-testid="input-ans-pattern" /></Labeled>
        <Labeled label="Part numbers (comma-separated)"><input value={parts} onChange={(e) => setParts(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-72" data-testid="input-ans-parts" /></Labeled>
        <Labeled label="Catalog ID (optional)"><input value={catalogId} onChange={(e) => setCatalogId(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-28" data-testid="input-ans-catalog" /></Labeled>
        <Labeled label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-64" data-testid="input-ans-notes" /></Labeled>
        <button onClick={add} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold" data-testid="button-ans-add"><Plus className="w-4 h-4" />Add</button>
      </div>
      <Msg m={msg} />
      <Table head={["Pattern", "Parts", "Catalog", "Notes", ""]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-t" data-testid={`ans-row-${r.id}`}>
            <td className="px-3 py-2 font-medium">{r.query_pattern}</td>
            <td className="px-3 py-2">{(() => { try { return (JSON.parse(r.part_numbers_json || "[]") as string[]).join(", "); } catch { return "—"; } })()}</td>
            <td className="px-3 py-2">{r.catalog_id ?? "any"}</td>
            <td className="px-3 py-2 text-muted-foreground">{r.notes || "—"}</td>
            <td className="px-3 py-2 text-right">{canDelete && <button onClick={() => del(r.id)} className="text-rose-600 hover:underline inline-flex items-center gap-1" data-testid={`ans-delete-${r.id}`}><Trash2 className="w-4 h-4" /></button>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------------- Rules ----------------
function RulesTab({ token, canDelete }: { token: string | null; canDelete: boolean }) {
  const { adminFetch } = useShellAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [ruleText, setRuleText] = useState("");
  const [scope, setScope] = useState("global");
  const [priority, setPriority] = useState("50");
  const [oem, setOem] = useState("");

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/partsetu/rules");
    setRows(r.ok ? await r.json() : []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function add() {
    if (!token || !ruleText.trim()) return;
    const r = await adminFetch(token, "/api/admin/partsetu/rules", {
      method: "POST",
      body: JSON.stringify({ ruleText: ruleText.trim(), scope, priority: Number(priority) || 50, oem: scope === "oem" && oem.trim() ? oem.trim() : null }),
    });
    if (r.ok) { setMsg({ kind: "ok", text: "Rule saved." }); setRuleText(""); setOem(""); load(); }
    else setMsg({ kind: "err", text: "Save failed." });
  }
  async function del(id: number) {
    if (!token || !confirm("Delete this rule?")) return;
    await adminFetch(token, `/api/admin/partsetu/rules/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="border rounded-lg p-4 mb-4 bg-muted/20 flex flex-wrap items-end gap-3">
        <Labeled label="Rule text"><input value={ruleText} onChange={(e) => setRuleText(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-96" data-testid="input-rule-text" /></Labeled>
        <Labeled label="Scope">
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm" data-testid="select-rule-scope">
            <option value="global">global</option>
            <option value="oem">oem</option>
          </select>
        </Labeled>
        {scope === "oem" && <Labeled label="OEM"><input value={oem} onChange={(e) => setOem(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-40" data-testid="input-rule-oem" /></Labeled>}
        <Labeled label="Priority"><input value={priority} onChange={(e) => setPriority(e.target.value)} className="border rounded-lg px-3 py-1.5 bg-background text-sm w-24" data-testid="input-rule-priority" /></Labeled>
        <button onClick={add} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold" data-testid="button-rule-add"><Plus className="w-4 h-4" />Add</button>
      </div>
      <Msg m={msg} />
      <Table head={["Priority", "Rule", "Scope", "OEM", "By", ""]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-t" data-testid={`rule-row-${r.id}`}>
            <td className="px-3 py-2 font-mono">{r.priority}</td>
            <td className="px-3 py-2">{r.rule_text}</td>
            <td className="px-3 py-2">{r.scope}</td>
            <td className="px-3 py-2">{r.oem || "—"}</td>
            <td className="px-3 py-2 text-muted-foreground">{r.taught_by || "—"}</td>
            <td className="px-3 py-2 text-right">{canDelete && <button onClick={() => del(r.id)} className="text-rose-600 hover:underline inline-flex items-center gap-1" data-testid={`rule-delete-${r.id}`}><Trash2 className="w-4 h-4" /></button>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------------- Lessons Import ----------------
function LessonsTab({ token }: { token: string | null }) {
  const { adminFetch } = useShellAuth();
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [parsed, setParsed] = useState<{ rules: any[]; synonyms: any[]; answers: any[] } | null>(null);

  async function parse() {
    if (!token || !rawText.trim() || parsing) return;
    setParsing(true);
    setMsg(null);
    setParsed(null);
    try {
      const r = await adminFetch(token, "/api/admin/partsetu/lessons-import/parse", {
        method: "POST",
        body: JSON.stringify({ rawText: rawText.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setImportId(j.importId);
        setParsed({ rules: j.parsed?.rules || [], synonyms: j.parsed?.synonyms || [], answers: j.parsed?.answers || [] });
        if (!j.aiAvailable) setMsg({ kind: "err", text: "AI parser unavailable — review/edit not possible. Nothing was parsed." });
      } else setMsg({ kind: "err", text: j.error || "Parse failed." });
    } finally { setParsing(false); }
  }

  async function apply() {
    if (!token || !parsed || applying) return;
    setApplying(true);
    setMsg(null);
    try {
      const r = await adminFetch(token, "/api/admin/partsetu/lessons-import/apply", {
        method: "POST",
        body: JSON.stringify({ importId, lessons: parsed }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ kind: "ok", text: `Applied — ${j.applied?.rules || 0} rules, ${j.applied?.synonyms || 0} synonyms, ${j.applied?.answers || 0} answers.` });
        setParsed(null); setRawText(""); setImportId(null);
      } else setMsg({ kind: "err", text: j.error || "Apply failed." });
    } finally { setApplying(false); }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-2">Paste free-form teaching notes. They are parsed into structured rules, synonyms and answers for review before applying.</p>
      <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8}
        className="w-full border rounded-lg px-3 py-2 bg-background text-sm font-mono" placeholder="e.g. For Tata SIGNA trucks, brake chamber is also called brake actuator. The water pump for engine X is part 12345..."
        data-testid="textarea-lessons" />
      <div className="mt-3 flex gap-3">
        <button onClick={parse} disabled={parsing} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="button-lessons-parse">
          <Sparkles className="w-4 h-4" /> {parsing ? "Parsing…" : "Parse with AI"}
        </button>
        {parsed && <button onClick={apply} disabled={applying} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="button-lessons-apply">{applying ? "Applying…" : "Apply all"}</button>}
      </div>
      <Msg m={msg} />
      {parsed && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Preview title={`Rules (${parsed.rules.length})`} items={parsed.rules.map((r) => `[${r.scope || "global"} p${r.priority ?? 50}${r.oem ? " " + r.oem : ""}] ${r.rule_text}`)} />
          <Preview title={`Synonyms (${parsed.synonyms.length})`} items={parsed.synonyms.map((s) => `${s.query_term} → ${(s.expanded_terms || []).join(", ")}`)} />
          <Preview title={`Answers (${parsed.answers.length})`} items={parsed.answers.map((a) => `${a.query_pattern} → ${(a.part_numbers || []).join(", ")}`)} />
        </div>
      )}
    </div>
  );
}

function Preview({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border rounded-lg p-3 bg-muted/10">
      <h4 className="font-semibold text-sm mb-2">{title}</h4>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">None</p> : (
        <ul className="space-y-1 text-xs">{items.map((it, i) => <li key={i} className="border-b last:border-0 pb-1">{it}</li>)}</ul>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: any }) {
  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
