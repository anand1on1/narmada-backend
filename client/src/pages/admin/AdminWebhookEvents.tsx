import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import { RefreshCw, Send } from "lucide-react";

// R26.6i — minimal debug viewer for the webhook_events audit log. Lets admin see
// every request that hit the AiSensy webhooks and self-test the inbound pipeline.
type WebhookEvent = {
  id: number;
  source: string;
  received_at: number;
  method: string | null;
  topic: string | null;
  from_phone: string | null;
  text_preview: string | null;
  processed: number;
  ignored_reason: string | null;
  headers_json: string | null;
  body_json: string | null;
  notes: string | null;
};

const fmtTime = (ms: number) => {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
};

const prettyJson = (s: string | null) => {
  if (!s) return "";
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
};

export default function AdminWebhookEvents() {
  const { token } = useAdminAuth();
  const [rows, setRows] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [fPhone, setFPhone] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fProcessed, setFProcessed] = useState("");

  // Inbound test form
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "100", source: "aisensy" });
      if (fPhone.trim()) qs.set("from_phone", fPhone.trim());
      if (fTopic.trim()) qs.set("topic", fTopic.trim());
      if (fProcessed === "0" || fProcessed === "1") qs.set("processed", fProcessed);
      const res = await adminFetch(token, `/api/admin/webhook-events?${qs.toString()}`);
      if (res.ok) setRows(await res.json());
    } catch { /* keep last */ } finally { setLoading(false); }
  }, [token, fPhone, fTopic, fProcessed]);

  useEffect(() => { load(); }, [load]);

  const sendTest = async () => {
    if (!testPhone.trim() || !testText.trim() || testing) return;
    setTesting(true);
    setTestResult("");
    try {
      const envelope = {
        topic: "message.sender.user",
        id: `admin-test-${Date.now()}`,
        project_id: "admin-test",
        data: { from: testPhone.trim(), messageData: { text: testText.trim() } },
      };
      const res = await fetch("/api/aisensy/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      const json = await res.json().catch(() => ({}));
      setTestResult(`HTTP ${res.status} — ${JSON.stringify(json)}`);
      await load();
    } catch (e: any) {
      setTestResult(`Error: ${e?.message || e}`);
    } finally { setTesting(false); }
  };

  return (
    <AdminLayout title="Webhook Events">
      <div className="space-y-5">
        {/* Inbound Test */}
        <div className="border rounded-xl bg-card p-4">
          <div className="font-semibold text-sm mb-2">Inbound Test</div>
          <div className="text-xs text-muted-foreground mb-3">
            POST a fake vendor reply (topic <code>message.sender.user</code>) to <code>/api/aisensy/webhook</code> to confirm the backend pipeline works end-to-end.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
              placeholder="From phone e.g. 919999999999"
              className="px-3 py-2 text-sm rounded-lg border bg-background sm:w-64"
              data-testid="input-test-phone"
            />
            <input
              value={testText} onChange={(e) => setTestText(e.target.value)}
              placeholder="Message text"
              className="px-3 py-2 text-sm rounded-lg border bg-background flex-1"
              data-testid="input-test-text"
            />
            <button
              onClick={sendTest} disabled={testing || !testPhone.trim() || !testText.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50 flex items-center gap-1 justify-center"
              data-testid="button-send-test"
            >
              <Send className="w-4 h-4" /> Send Test
            </button>
          </div>
          {testResult && (
            <div className="mt-2 text-xs font-mono text-slate-600 break-all" data-testid="text-test-result">{testResult}</div>
          )}
        </div>

        {/* Filters */}
        <div className="border rounded-xl bg-card p-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Phone</label>
            <input value={fPhone} onChange={(e) => setFPhone(e.target.value)}
              placeholder="from_phone" className="px-3 py-2 text-sm rounded-lg border bg-background"
              data-testid="filter-phone" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Topic</label>
            <input value={fTopic} onChange={(e) => setFTopic(e.target.value)}
              placeholder="topic" className="px-3 py-2 text-sm rounded-lg border bg-background"
              data-testid="filter-topic" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Processed</label>
            <select value={fProcessed} onChange={(e) => setFProcessed(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border bg-background" data-testid="filter-processed">
              <option value="">Any</option>
              <option value="1">Processed</option>
              <option value="0">Not processed</option>
            </select>
          </div>
          <button onClick={load} disabled={loading}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white disabled:opacity-50 flex items-center gap-1 justify-center"
            data-testid="button-refresh">
            <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
          </button>
        </div>

        {/* Table */}
        <div className="border rounded-xl bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b bg-slate-50 dark:bg-slate-900">
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">Topic</th>
                <th className="px-3 py-2 font-semibold">From</th>
                <th className="px-3 py-2 font-semibold">Text preview</th>
                <th className="px-3 py-2 font-semibold text-center">Processed</th>
                <th className="px-3 py-2 font-semibold">Ignored reason</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No webhook events.</td></tr>
              )}
              {rows.map((r) => (
                <>
                  <tr key={r.id} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900" data-testid={`row-event-${r.id}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTime(r.received_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.topic || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.from_phone || "—"}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate">{r.text_preview || "—"}</td>
                    <td className="px-3 py-2 text-center">{r.processed === 1 ? "✓" : "✗"}</td>
                    <td className="px-3 py-2 text-xs text-rose-600">{r.ignored_reason || ""}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        className="text-indigo-600 text-xs font-semibold hover:underline"
                        data-testid={`button-view-raw-${r.id}`}>
                        {expanded === r.id ? "Hide" : "View Raw"}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={`${r.id}-raw`} className="border-b bg-slate-50 dark:bg-slate-950">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid md:grid-cols-2 gap-3">
                          <div>
                            <div className="text-[11px] font-semibold text-muted-foreground mb-1">Headers</div>
                            <pre className="text-[11px] bg-card border rounded-lg p-2 overflow-auto max-h-64">{prettyJson(r.headers_json)}</pre>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold text-muted-foreground mb-1">Body</div>
                            <pre className="text-[11px] bg-card border rounded-lg p-2 overflow-auto max-h-64">{prettyJson(r.body_json)}</pre>
                          </div>
                        </div>
                        {r.notes && <div className="text-[11px] text-muted-foreground mt-2">notes: {r.notes}</div>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
