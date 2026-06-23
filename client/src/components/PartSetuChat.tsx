// PartSetu AI — floating spare-parts chatbot widget.
// Mounted only on customer-facing (shop) pages via SiteLayout.
// Auth gating Pattern B: the first message is free for a guest; the next message
// prompts "Login to continue". The pre-login conversation is preserved (in
// localStorage) across the login round-trip.
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { Bot, Send, Paperclip, X, Loader2, FileQuestion, Sparkles } from "lucide-react";
import { useShopAuth, shopFetch } from "@/lib/shop-auth";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
}

const K_CONV = "partsetu_conversation";
const K_MSGS = "partsetu_messages";
const K_GUEST = "partsetu_guest_session";

function loadJSON<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function guestSessionId(): string {
  try {
    let g = localStorage.getItem(K_GUEST);
    if (!g) { g = `g_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(K_GUEST, g); }
    return g;
  } catch { return `g_${Date.now()}`; }
}

const GREETING: ChatMsg = {
  role: "assistant",
  content:
    "Hi! I'm PartSetu AI — your bridge to the right spare part. Tell me the part name, an OEM part number, or your vehicle's chassis / VC number and I'll help you find the correct part.",
};

export function PartSetuChat() {
  const { token, user } = useShopAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(() => loadJSON<ChatMsg[]>(K_MSGS, [GREETING]));
  const [conversationId, setConversationId] = useState<number | null>(() => loadJSON<number | null>(K_CONV, null));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [showCatalogForm, setShowCatalogForm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = useCallback((msgs: ChatMsg[], conv: number | null) => {
    try {
      localStorage.setItem(K_MSGS, JSON.stringify(msgs.slice(-50)));
      localStorage.setItem(K_CONV, JSON.stringify(conv));
    } catch {}
  }, []);

  useEffect(() => { persist(messages, conversationId); }, [messages, conversationId, persist]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, loading]);

  // Once the user logs in, the gate is lifted for the existing conversation.
  useEffect(() => { if (user) setNeedLogin(false); }, [user]);

  async function ensureConversation(): Promise<number | null> {
    if (conversationId) return conversationId;
    try {
      const r = await shopFetch(token, "/api/partsetu/conversation", {
        method: "POST",
        body: JSON.stringify({ guestSessionId: guestSessionId() }),
      });
      const data = await r.json();
      if (data?.conversationId) { setConversationId(data.conversationId); return data.conversationId; }
    } catch {}
    return null;
  }

  async function sendText() {
    const text = input.trim();
    if (!text || loading) return;
    const convId = await ensureConversation();
    if (!convId) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const r = await shopFetch(token, "/api/partsetu/message", {
        method: "POST",
        body: JSON.stringify({ conversationId: convId, content: text }),
      });
      if (r.status === 401) {
        const body = await r.json().catch(() => ({}));
        if (body?.requires_login) { setNeedLogin(true); setLoading(false); return; }
      }
      const data = await r.json();
      setMessages((m) => [...m, { role: "assistant", content: data?.reply || "Sorry, I couldn't process that." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file || !token) return;
    const convId = await ensureConversation();
    if (!convId) return;
    setMessages((m) => [...m, { role: "user", content: `Uploaded image: ${file.name}` }]);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("conversationId", String(convId));
      const r = await shopFetch(token, "/api/partsetu/upload-image", { method: "POST", body: fd });
      const data = await r.json();
      setMessages((m) => [...m, { role: "assistant", content: data?.reply || "I couldn't read that image." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Image upload failed — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher bubble — bottom-right, stacked above the WhatsApp button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-white px-4 py-3 font-semibold text-sm shadow-lg shadow-[hsl(212_95%_55%)]/30 transition-all hover:scale-105"
          data-testid="partsetu-launcher"
          aria-label="Open PartSetu AI"
        >
          <Bot className="h-5 w-5" />
          <span className="hidden sm:inline">PartSetu AI</span>
        </button>
      )}

      {open && (
        <div
          className="fixed z-50 bottom-0 right-0 sm:bottom-5 sm:right-5 w-full sm:w-[400px] h-[100dvh] sm:h-[600px] sm:max-h-[80vh] flex flex-col bg-white sm:rounded-2xl shadow-2xl border border-[hsl(220_45%_20%)]/10 overflow-hidden"
          data-testid="partsetu-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[hsl(220_60%_12%)] text-white">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-[hsl(212_95%_55%)] inline-flex items-center justify-center">
                <Bot className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold text-[15px] flex items-center gap-1">PartSetu AI <Sparkles className="h-3.5 w-3.5 text-[hsl(212_95%_65%)]" /></div>
                <div className="text-[11px] text-white/70">Your bridge to the right spare part</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-white/70 hover:text-white" data-testid="partsetu-close" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-[hsl(210_30%_98%)]">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[hsl(212_95%_55%)] text-white rounded-br-sm"
                      : "bg-white text-[hsl(220_60%_12%)] border border-[hsl(220_45%_20%)]/10 rounded-bl-sm"
                  }`}
                  data-testid={`partsetu-msg-${m.role}`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-[hsl(220_45%_20%)]/10 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-[hsl(212_95%_55%)]" />
                </div>
              </div>
            )}

            {needLogin && (
              <div className="rounded-xl border border-[hsl(212_95%_55%)]/30 bg-[hsl(212_95%_55%)]/8 p-3 text-[13px] text-[hsl(220_60%_12%)]" data-testid="partsetu-login-gate">
                <p className="font-medium mb-2">Log in to continue chatting with PartSetu AI.</p>
                <Link href="/customer/login">
                  <a onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(212_95%_55%)] text-white px-3 py-1.5 text-[13px] font-semibold hover:bg-[hsl(212_95%_50%)]" data-testid="partsetu-login-link">
                    Log in to continue
                  </a>
                </Link>
                <p className="mt-2 text-[11px] text-[hsl(220_60%_12%)]/60">Your conversation will be saved.</p>
              </div>
            )}

            {showCatalogForm && <CatalogRequestForm token={token} onDone={(msg) => { setShowCatalogForm(false); setMessages((m) => [...m, { role: "assistant", content: msg }]); }} />}
          </div>

          {/* Composer */}
          <div className="border-t border-[hsl(220_45%_20%)]/10 bg-white px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!user}
                title={user ? "Attach a photo of the part" : "Log in to attach photos"}
                className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md text-[hsl(220_60%_12%)]/60 hover:bg-[hsl(220_45%_20%)]/5 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="partsetu-attach"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} data-testid="partsetu-file" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder={needLogin ? "Log in to continue…" : "Ask about a part or part number…"}
                disabled={needLogin || loading}
                className="flex-1 min-w-0 rounded-md border border-[hsl(220_45%_20%)]/15 px-3 py-2 text-[13.5px] outline-none focus:border-[hsl(212_95%_55%)] disabled:bg-[hsl(210_30%_96%)]"
                data-testid="partsetu-input"
              />
              <button
                type="button"
                onClick={sendText}
                disabled={!input.trim() || loading || needLogin}
                className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md bg-[hsl(212_95%_55%)] text-white hover:bg-[hsl(212_95%_50%)] disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="partsetu-send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <button
                type="button"
                onClick={() => setShowCatalogForm((v) => !v)}
                disabled={!user}
                title={user ? "Request a catalog for your vehicle" : "Log in to request a catalog"}
                className="inline-flex items-center gap-1 text-[11px] text-[hsl(220_60%_12%)]/55 hover:text-[hsl(212_95%_55%)] disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="partsetu-request-catalog"
              >
                <FileQuestion className="h-3.5 w-3.5" /> Request Catalog
              </button>
              <span className="text-[10px] text-[hsl(220_60%_12%)]/35">Powered by PartSetu AI</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CatalogRequestForm({ token, onDone }: { token: string | null; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ make: "", model: "", variant: "", year: "", chassisNo: "", engineModel: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await shopFetch(token, "/api/partsetu/catalog-request", { method: "POST", body: JSON.stringify(f) });
      if (r.ok) onDone("Thanks! Your catalog request has been sent to our team. We'll add it and follow up shortly.");
      else onDone("Sorry, we couldn't submit your request right now. Please try again later.");
    } catch {
      onDone("Network error submitting your request. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-[hsl(220_45%_20%)]/15 bg-white p-3 space-y-2" data-testid="partsetu-catalog-form">
      <div className="text-[13px] font-semibold text-[hsl(220_60%_12%)]">Request a Catalog</div>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Make (e.g. Tata)" value={f.make} onChange={set("make")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-make" />
        <input placeholder="Model" value={f.model} onChange={set("model")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-model" />
        <input placeholder="Variant" value={f.variant} onChange={set("variant")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-variant" />
        <input placeholder="Year" value={f.year} onChange={set("year")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-year" />
        <input placeholder="Chassis No." value={f.chassisNo} onChange={set("chassisNo")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-chassis" />
        <input placeholder="Engine model" value={f.engineModel} onChange={set("engineModel")} className="rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-engine" />
      </div>
      <input placeholder="Notes (optional)" value={f.notes} onChange={set("notes")} className="w-full rounded-md border border-[hsl(220_45%_20%)]/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-[hsl(212_95%_55%)]" data-testid="catreq-notes" />
      <button type="button" onClick={submit} disabled={busy} className="w-full rounded-md bg-[hsl(212_95%_55%)] text-white py-1.5 text-[13px] font-semibold hover:bg-[hsl(212_95%_50%)] disabled:opacity-50" data-testid="catreq-submit">
        {busy ? "Submitting…" : "Submit Request"}
      </button>
    </div>
  );
}
