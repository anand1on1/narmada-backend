import { useEffect, useState, useRef, useCallback } from "react";
import { Bell } from "lucide-react";

// R26.5 (H) — cross-team notifications bell. Works for any role that authenticates
// against the data_team store (admin via SSO team token, sales/finance/hr).
// `roleFetch(token, url, init)` must attach the right auth header.
interface CrossTeamEvent {
  id: number;
  event_type: string;
  payload_json?: string | null;
  target_user_id?: number | null;
  target_role?: string | null;
  read_at?: string | null;
  created_at: number | string;
}

const LABELS: Record<string, string> = {
  lead_assigned: "New lead assigned",
  po_created_for_rep_customer: "PO created for your customer",
  po_shipped: "PO shipped",
  payment_received: "Payment received",
  target_deadline_approaching: "Target deadline approaching",
};

function summarize(ev: CrossTeamEvent): string {
  let payload: any = {};
  try { payload = ev.payload_json ? JSON.parse(ev.payload_json) : {}; } catch { /* ignore */ }
  const label = LABELS[ev.event_type] || ev.event_type;
  if (ev.event_type === "lead_assigned" && payload.lead_name) return `${label}: ${payload.lead_name}`;
  if (ev.event_type === "target_deadline_approaching" && payload.days_left != null) return `${label} (${payload.days_left}d left)`;
  if (ev.event_type === "po_shipped" && payload.po_number) return `${label}: ${payload.po_number}`;
  if (ev.event_type === "payment_received" && payload.amount != null) return `${label}: ₹${Number(payload.amount).toLocaleString("en-IN")}`;
  return label;
}

function timeAgo(ts: number | string): string {
  const ms = typeof ts === "string" ? Date.parse(ts) : Number(ts);
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsBell({
  roleFetch, token,
}: {
  roleFetch: (token: string | null, url: string, init?: RequestInit) => Promise<Response>;
  token: string | null;
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CrossTeamEvent[]>([]);
  const alive = useRef(true);

  const loadCount = useCallback(async () => {
    if (!token) return;
    try {
      const r = await roleFetch(token, "/api/notifications/unread-count");
      if (!r.ok || !alive.current) return;
      const j = await r.json();
      setCount(Number(j?.count ?? 0));
    } catch { /* ignore */ }
  }, [roleFetch, token]);

  const loadList = useCallback(async () => {
    if (!token) return;
    try {
      const r = await roleFetch(token, "/api/notifications");
      if (!r.ok) return;
      const j = await r.json();
      setItems(Array.isArray(j) ? j.slice(0, 10) : []);
    } catch { /* ignore */ }
  }, [roleFetch, token]);

  useEffect(() => {
    alive.current = true;
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => { alive.current = false; clearInterval(id); };
  }, [loadCount]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await loadList();
  }

  async function markRead(id: number) {
    if (!token) return;
    try {
      await roleFetch(token, `/api/notifications/${id}/read`, { method: "POST" });
      setItems((prev) => prev.map((e) => (e.id === id ? { ...e, read_at: new Date().toISOString() } : e)));
      loadCount();
    } catch { /* ignore */ }
  }

  if (!token) return null;

  return (
    <div className="relative">
      <button onClick={toggle} className="relative p-2 rounded-lg hover:bg-slate-100" title="Notifications" data-testid="notifications-bell">
        <Bell className="w-5 h-5 text-slate-600" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center" data-testid="notifications-count">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-80 bg-white border rounded-xl shadow-xl z-40 overflow-hidden" data-testid="notifications-dropdown">
            <div className="px-4 py-2.5 border-b text-xs font-bold uppercase tracking-wider text-muted-foreground flex justify-between items-center">
              Notifications {count > 0 && <span className="text-rose-600">{count} unread</span>}
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {items.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No notifications.</div>
              ) : (
                items.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => markRead(ev.id)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex flex-col gap-0.5 ${ev.read_at ? "opacity-60" : "bg-indigo-50/40"}`}
                    data-testid={`notification-${ev.id}`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{summarize(ev)}</span>
                      {!ev.read_at && <span className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 flex-shrink-0" />}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(ev.created_at)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
