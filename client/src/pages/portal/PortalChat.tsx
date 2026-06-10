import { useState, useEffect, useRef } from "react";
import { PortalLayout } from "./PortalLayout";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Send, Bot, User } from "lucide-react";

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
}

export default function PortalChat() {
  const { token } = useCustomerAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await customerFetch(token, "/api/portal/chat/history");
        if (r.ok) {
          const history: ChatMessage[] = await r.json();
          setMessages(history);
        }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || sending || !token) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const r = await customerFetch(token, "/api/portal/chat", {
        method: "POST",
        body: JSON.stringify({ message: userMsg.content }),
      });
      if (r.ok) {
        const { reply } = await r.json();
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process your request. Please try again." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error. Please check your connection." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <PortalLayout title="Chat Assistant">
      <div className="flex flex-col h-[calc(100vh-12rem)] max-w-2xl mx-auto">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 py-4 pr-2">
          {loading ? (
            <div className="text-center text-muted-foreground text-sm">Loading history…</div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground text-sm">Hi! I'm your Narmada assistant. Ask me about parts, orders, pricing, or anything else.</p>
            </div>
          ) : null}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-accent text-accent-foreground" : "bg-muted"}`}>
                {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${msg.role === "user"
                ? "bg-accent text-accent-foreground rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm"}`}>
                {msg.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-2">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl bg-muted rounded-tl-sm">
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t pt-4">
          <div className="flex gap-2">
            <input
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Type a message…"
              className="flex-1 border rounded-xl px-4 py-2.5 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              disabled={sending}
            />
            <button onClick={send} disabled={!input.trim() || sending}
              className="p-2.5 bg-accent text-accent-foreground rounded-xl disabled:opacity-50 hover:bg-accent/90 transition">
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            AI assistant — may not always be accurate. For urgent queries, contact us directly.
          </p>
        </div>
      </div>
    </PortalLayout>
  );
}
