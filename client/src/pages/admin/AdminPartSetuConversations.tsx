// v1.4a — PartSetu Conversations (view-only). Lists recent chat conversations and,
// on selection, their messages. No mutations — safe for both admin and Data Center.
// Shell-aware: renders under AdminLayout or DataCenterLayout and uses the active token.
import { useEffect, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { MessageSquare } from "lucide-react";

type Convo = Record<string, any>;
type Msg = Record<string, any>;

export default function AdminPartSetuConversations() {
  const { token, adminFetch } = useShellAuth();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const r = await adminFetch(token, "/api/admin/partsetu/conversations");
        if (alive && r.ok) { const d = await r.json(); setConvos(Array.isArray(d) ? d : []); }
      } catch { /* ignore */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token]);

  async function open(id: number) {
    setSelected(id);
    setMessages([]);
    try {
      const r = await adminFetch(token, `/api/admin/partsetu/conversations/${id}/messages`);
      if (r.ok) { const d = await r.json(); setMessages(Array.isArray(d) ? d : []); }
    } catch { /* ignore */ }
  }

  const fmt = (v: any) => (v == null ? "" : String(v));

  return (
    <ShellLayout title="PartSetu — Conversations">
      <p className="text-sm text-muted-foreground mb-4">Recent customer conversations (read-only).</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 border rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b text-xs font-bold uppercase tracking-wider text-slate-500">Conversations</div>
          {loading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
          {!loading && convos.length === 0 && <div className="p-4 text-sm text-muted-foreground">No conversations yet.</div>}
          <ul className="divide-y max-h-[60vh] overflow-y-auto">
            {convos.map((c) => {
              const id = Number(c.id ?? c.conversation_id);
              return (
                <li key={id}>
                  <button
                    onClick={() => open(id)}
                    className={"w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 " + (selected === id ? "bg-cyan-50" : "")}
                    data-testid={`convo-${id}`}
                  >
                    <div className="font-medium text-slate-800 flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                      {fmt(c.customer_name || c.title || c.phone || `Conversation #${id}`)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{fmt(c.last_message || c.created_at || c.updated_at)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="lg:col-span-2 border rounded-xl p-4 min-h-[40vh]">
          {selected == null && <div className="text-sm text-muted-foreground">Select a conversation to view its messages.</div>}
          {selected != null && messages.length === 0 && <div className="text-sm text-muted-foreground">No messages.</div>}
          <div className="space-y-3">
            {messages.map((m, i) => {
              const role = fmt(m.role || m.sender || (m.is_bot ? "assistant" : "user"));
              const mine = role === "assistant" || role === "bot";
              return (
                <div key={m.id ?? i} className={"flex " + (mine ? "justify-start" : "justify-end")}>
                  <div className={"max-w-[80%] rounded-2xl px-4 py-2 text-sm " + (mine ? "bg-slate-100 text-slate-800" : "bg-cyan-600 text-white")}>
                    <div className="text-[10px] uppercase tracking-wider font-bold opacity-70 mb-0.5">{role}</div>
                    {fmt(m.content || m.text || m.body || m.message)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ShellLayout>
  );
}
