import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Sparkles, Send, History } from "lucide-react";

interface HistoryRow { id: number; prompt: string; answer_summary?: string | null; asked_at?: string | null; }

export default function AdminAIBar() {
  const { token } = useAdminAuth();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{ summary: string; tool: string; data: any; llm: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  async function loadHistory() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/ai-bar/history");
    if (r.ok) setHistory(await r.json());
  }
  useEffect(() => { loadHistory(); }, [token]); // eslint-disable-line

  async function ask(q?: string) {
    const text = (q ?? prompt).trim();
    if (!text) return;
    setLoading(true); setErr(null); setAnswer(null);
    try {
      const r = await adminFetch(token, "/api/admin/ai-bar/ask", { method: "POST", body: JSON.stringify({ prompt: text }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Request failed"); }
      else { setAnswer(j); loadHistory(); }
    } catch (e: any) { setErr(e.message || "Request failed"); }
    finally { setLoading(false); }
  }

  const suggestions = [
    "How many open POs?", "Show open deviations", "Pending expense approvals",
    "What is the cash balance?", "Patna stock", "Salary due this month", "Low stock products",
  ];

  return (
    <AdminLayout title="Supreme AI Bar">
      <div className="max-w-4xl">
        <div className="bg-card border rounded-xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3 text-indigo-600">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold">Ask anything about your operations</span>
          </div>
          <div className="flex gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
              placeholder="e.g. how many POs are still open?"
              className="flex-1 px-4 py-2.5 rounded-lg border bg-background text-sm"
            />
            <button onClick={() => ask()} disabled={loading || !prompt.trim()} className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
              <Send className="w-4 h-4" /> {loading ? "Asking…" : "Ask"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {suggestions.map((s) => (
              <button key={s} onClick={() => { setPrompt(s); ask(s); }} className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted text-muted-foreground">{s}</button>
            ))}
          </div>
        </div>

        {err && <div className="mb-4 text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2">{err}</div>}

        {answer && (
          <div className="bg-card border rounded-xl p-5 mb-5">
            <div className="text-sm whitespace-pre-wrap mb-3">{answer.summary}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span className="px-2 py-0.5 rounded bg-muted font-mono">{answer.tool}</span>
              <span>{answer.llm ? "LLM-assisted" : "deterministic"}</span>
            </div>
            {Array.isArray(answer.data) && answer.data.length > 0 && (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>{Object.keys(answer.data[0]).map((k) => <th key={k} className="p-2 font-semibold">{k}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {answer.data.map((row: any, i: number) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {Object.keys(answer.data[0]).map((k) => <td key={k} className="p-2">{row[k] == null ? "—" : String(row[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {answer.data && !Array.isArray(answer.data) && (
              <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto">{JSON.stringify(answer.data, null, 2)}</pre>
            )}
            {Array.isArray(answer.data) && answer.data.length === 0 && (
              <div className="text-xs text-muted-foreground">No rows.</div>
            )}
          </div>
        )}

        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b text-sm font-semibold text-muted-foreground">
            <History className="w-4 h-4" /> Recent questions
          </div>
          {history.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No history yet.</div>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-3 hover:bg-muted/30 cursor-pointer" onClick={() => { setPrompt(h.prompt); ask(h.prompt); }}>
                  <div className="text-sm font-medium">{h.prompt}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{h.answer_summary}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
