/**
 * R25a Fix 3 — TeamChats.tsx
 * WhatsApp-web-style chat hub for the data team, mirroring the admin Chats UI (R24.4).
 * Left = conversation list, right = thread. Uses team auth + /api/team/chats endpoints.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { Send, Search } from "lucide-react";

type Conv = {
  vendorId: number | null;
  phone: string | null;
  name: string;
  lastMessage: string;
  lastDirection: string | null;
  lastMessageAt: number;
  unreadCount: number;
  messageCount: number;
};
type Msg = { id: number; direction: string; body: string; created_at: number; status: string | null };

const timeShort = (ms: number) => {
  if (!ms) return "";
  const d = new Date(Number(ms));
  return d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
};

export default function TeamChats() {
  const { token } = useTeamAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [active, setActive] = useState<Conv | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConvs = useCallback(async () => {
    try {
      const res = await teamFetch(token, "/api/team/chats");
      if (res.ok) setConvs(await res.json());
    } catch { /* keep last */ }
  }, [token]);

  const loadThread = useCallback(async (vendorId: number) => {
    try {
      const res = await teamFetch(token, `/api/team/chats/${vendorId}`);
      if (res.ok) setThread(await res.json());
    } catch { /* keep last */ }
  }, [token]);

  useEffect(() => {
    loadConvs();
    const id = setInterval(loadConvs, 15000);
    return () => clearInterval(id);
  }, [loadConvs]);

  useEffect(() => {
    if (active?.vendorId == null) return;
    loadThread(active.vendorId);
    const id = setInterval(() => active.vendorId != null && loadThread(active.vendorId), 15000);
    return () => clearInterval(id);
  }, [active, loadThread]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread]);

  const send = async () => {
    if (!active?.vendorId || !text.trim() || sending) return;
    setSending(true);
    try {
      const res = await teamFetch(token, `/api/team/chats/${active.vendorId}/send`, {
        method: "POST", body: JSON.stringify({ message: text.trim() }),
      });
      if (res.ok) { setText(""); await loadThread(active.vendorId); await loadConvs(); }
    } finally { setSending(false); }
  };

  const visible = convs
    .filter((c) => (filter === "unread" ? c.unreadCount > 0 : true))
    .filter((c) => (q ? `${c.name} ${c.phone || ""}`.toLowerCase().includes(q.toLowerCase()) : true));

  return (
    <TeamLayout title="Chats">
      <div className="flex border rounded-xl overflow-hidden bg-card" style={{ height: "calc(100vh - 200px)" }}>
        {/* Sidebar */}
        <div className="w-[30%] min-w-[260px] border-r flex flex-col">
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border bg-background"
                data-testid="input-chat-search"
              />
            </div>
            <div className="flex gap-2 text-xs">
              {(["all", "unread"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={"px-3 py-1 rounded-full font-semibold " + (filter === f ? "bg-accent text-accent-foreground" : "bg-slate-100 dark:bg-slate-900")}
                  data-testid={`filter-${f}`}>
                  {f === "all" ? "All" : "Unread"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {visible.length === 0 && <div className="p-4 text-sm text-muted-foreground">No conversations.</div>}
            {visible.map((c, i) => (
              <button
                key={`${c.vendorId}-${c.phone}-${i}`}
                onClick={() => setActive(c)}
                disabled={c.vendorId == null}
                className={"w-full text-left px-3 py-3 border-b flex gap-3 items-center hover:bg-slate-50 dark:hover:bg-slate-900 " +
                  (active?.vendorId === c.vendorId ? "bg-slate-100 dark:bg-slate-900" : "") + (c.vendorId == null ? " opacity-60" : "")}
                data-testid={`conv-${c.vendorId ?? c.phone}`}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-700 flex items-center justify-center font-bold flex-shrink-0">
                  {(c.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold truncate">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeShort(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-xs text-muted-foreground truncate">{c.lastDirection === "out" ? "You: " : ""}{c.lastMessage}</span>
                    {c.unreadCount > 0 && <span className="bg-emerald-600 text-white text-[10px] px-1.5 rounded-full flex-shrink-0">{c.unreadCount}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-950">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Select a conversation</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b bg-card flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-700 flex items-center justify-center font-bold">
                  {(active.name || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold">{active.name}</div>
                  <div className="text-xs text-muted-foreground">{active.phone || ""}</div>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {thread.map((m) => (
                  <div key={m.id} className={"flex " + (m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div className={"max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm " +
                      (m.direction === "out" ? "bg-emerald-100 dark:bg-emerald-900" : "bg-card border")}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className="text-[10px] text-muted-foreground text-right mt-1">{timeShort(m.created_at)}{m.status ? ` · ${m.status}` : ""}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t bg-card flex gap-2">
                <input
                  value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Type a message…"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border bg-background"
                  data-testid="input-chat-message"
                />
                <button onClick={send} disabled={sending || !text.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50 flex items-center gap-1"
                  data-testid="button-chat-send">
                  <Send className="w-4 h-4" /> Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </TeamLayout>
  );
}
