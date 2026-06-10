// Data team auth helper — mirrors admin-auth pattern.
// Token lives in localStorage (key: narmada_team_token); revalidates on mount via /api/team/me.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { apiUrl } from "@/lib/queryClient";

interface TeamUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}

interface TeamCtx {
  token: string | null;
  user: TeamUser | null;
  setAuth: (token: string, user: TeamUser) => void;
  clear: () => void;
  ready: boolean;
}

const Ctx = createContext<TeamCtx>({
  token: null, user: null,
  setAuth: () => {}, clear: () => {}, ready: false,
});

const K_TOKEN = "narmada_team_token";

function safeGet(key: string): string | null {
  try { if (typeof window === "undefined") return null; return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch {}
}

let memToken: string | null = safeGet(K_TOKEN);

export function TeamAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [user, setUser] = useState<TeamUser | null>(null);
  const [ready, setReady] = useState<boolean>(!memToken);

  const setAuth = useCallback((t: string, u: TeamUser) => {
    memToken = t;
    safeSet(K_TOKEN, t);
    setToken(t); setUser(u); setReady(true);
  }, []);

  const clear = useCallback(() => {
    memToken = null;
    safeSet(K_TOKEN, null);
    setToken(null); setUser(null); setReady(true);
  }, []);

  useEffect(() => {
    if (!memToken) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/team/me"), {
          headers: { "x-team-token": memToken! },
        });
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          setUser(data);
          setReady(true);
        } else {
          clear();
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ token, user, setAuth, clear, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTeamAuth() {
  return useContext(Ctx);
}

export async function teamFetch(token: string | null, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = token || memToken;
  if (t) headers.set("x-team-token", t);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(url), { ...init, headers });
}

export function getTeamToken(): string | null { return memToken; }
