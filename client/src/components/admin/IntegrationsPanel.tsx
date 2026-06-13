// R26.3b — OAuth Integrations panel (Google + Meta) for the Admin area.
// Status comes from two sources:
//   GET /api/auth/me          → session-based connected/email/name (no admin token)
//   GET /api/auth/connections → admin (x-admin-token), provides last_used_at
import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Facebook, Link as LinkIcon, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiUrl } from "@/lib/queryClient";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";

type Provider = "google" | "meta";

interface MeProvider {
  connected: boolean;
  email?: string | null;
  name?: string | null;
}

interface MeResponse {
  google?: MeProvider;
  meta?: MeProvider;
}

interface ConnectionRow {
  provider?: string;
  last_used_at?: string | null;
  lastUsedAt?: string | null;
}

function relativeTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

export function IntegrationsPanel() {
  const { token } = useAdminAuth();
  const { toast } = useToast();

  const [me, setMe] = useState<MeResponse>({});
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
  const handledParams = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const [meRes, connRes] = await Promise.all([
        // /api/auth/me is session-based — no admin token needed.
        fetch(apiUrl("/api/auth/me"), { credentials: "include" }).catch(() => null),
        // /api/auth/connections is an admin endpoint — must carry x-admin-token.
        adminFetch(token, "/api/auth/connections").catch(() => null),
      ]);
      if (meRes && meRes.ok) {
        setMe(await meRes.json());
      }
      if (connRes && connRes.ok) {
        const data = await connRes.json();
        setConnections(Array.isArray(data) ? data : data.connections || []);
      }
    } catch {
      /* leave previous state in place on transient failure */
    } finally {
      setLoading(false);
    }
  }, [token]);

  // One-shot: handle OAuth redirect query params (?google=connected|failed, ?meta=...).
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    for (const p of ["google", "meta"] as Provider[]) {
      const v = params.get(p);
      if (!v) continue;
      const label = p === "google" ? "Google" : "Meta";
      if (v === "connected") {
        toast({ title: `${label} connected successfully` });
      } else if (v === "failed") {
        toast({ title: `${label} connection failed. Please try again.`, variant: "destructive" });
      }
      params.delete(p);
      changed = true;
    }
    if (changed) {
      // Hash routing keeps the route in location.hash; only scrub the query string.
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch + 30s poll + refetch on window focus.
  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 30000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  const connect = (provider: Provider) => {
    window.location.href = apiUrl(`/api/auth/${provider}`);
  };

  const disconnect = async (provider: Provider) => {
    setDisconnecting(provider);
    try {
      const res = await adminFetch(token, `/api/auth/${provider}/disconnect`, { method: "POST" });
      const label = provider === "google" ? "Google" : "Meta";
      if (res.ok) {
        toast({ title: `${label} disconnected` });
        await refetch();
      } else {
        toast({ title: `Failed to disconnect ${label}`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error while disconnecting", variant: "destructive" });
    } finally {
      setDisconnecting(null);
    }
  };

  const lastUsedFor = (provider: Provider): string | null => {
    const row = connections.find((c) => (c.provider || "").toLowerCase() === provider);
    if (!row) return null;
    return relativeTime(row.last_used_at ?? row.lastUsedAt);
  };

  const cards: Array<{
    provider: Provider;
    title: string;
    subtitle: string;
    icon: typeof Mail;
    accent: string;
  }> = [
    { provider: "google", title: "Google", subtitle: "Gmail Send · Sign-in", icon: Mail, accent: "text-rose-500" },
    { provider: "meta", title: "Meta", subtitle: "Facebook · Instagram · Lead Ads", icon: Facebook, accent: "text-blue-600" },
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Connect the seller workspace accounts used for email and lead sync.
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          data-testid="button-integrations-refresh"
        >
          <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {cards.map((c) => {
          const state = (me as any)[c.provider] as MeProvider | undefined;
          const connected = !!state?.connected;
          const email = state?.email;
          const lastUsed = lastUsedFor(c.provider);
          const Icon = c.icon;
          return (
            <div
              key={c.provider}
              className="bg-card border rounded-xl p-6 shadow-sm flex flex-col"
              data-testid={`card-integration-${c.provider}`}
            >
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Icon className={"w-6 h-6 " + c.accent} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg">{c.title}</h3>
                    <span
                      className={
                        "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full " +
                        (connected ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-200 text-slate-600")
                      }
                      data-testid={`badge-status-${c.provider}`}
                    >
                      {connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{c.subtitle}</div>
                </div>
              </div>

              {connected && (
                <div className="mt-4 space-y-1 text-sm">
                  {email && (
                    <div className="text-slate-700" data-testid={`text-connected-as-${c.provider}`}>
                      Connected as: <span className="font-medium">{email}</span>
                    </div>
                  )}
                  {lastUsed && (
                    <div className="text-xs text-muted-foreground" data-testid={`text-last-used-${c.provider}`}>
                      Last used: {lastUsed}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 pt-1">
                {connected ? (
                  <button
                    onClick={() => disconnect(c.provider)}
                    disabled={disconnecting === c.provider}
                    className="px-4 py-2 rounded-lg text-sm font-semibold border border-rose-300 text-rose-600 hover:bg-rose-50 transition disabled:opacity-50"
                    data-testid={`button-disconnect-${c.provider}`}
                  >
                    {disconnecting === c.provider ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={() => connect(c.provider)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition inline-flex items-center gap-2"
                    data-testid={`button-connect-${c.provider}`}
                  >
                    <LinkIcon className="w-4 h-4" /> Connect {c.title}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick test buttons — backend wiring lands in R26.4. */}
      <div className="mt-6 border-t pt-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Test Connection</div>
        <div className="flex flex-wrap gap-3">
          <button
            // R26.4 - actual integration usage
            onClick={() => alert("Coming in R26.4")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50"
            data-testid="button-test-gmail"
          >
            Send test email via Gmail
          </button>
          <button
            // R26.4 - actual integration usage
            onClick={() => alert("Coming in R26.4")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50"
            data-testid="button-test-fb-pages"
          >
            List Facebook pages
          </button>
        </div>
      </div>
    </div>
  );
}
