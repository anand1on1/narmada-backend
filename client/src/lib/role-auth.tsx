// R26.5 — shared auth helper for the new Sales/Finance/HR/Consignment portals.
// Each role authenticates against the data_team store and stores its own token in
// localStorage. The backend accepts the token via x-sales-token (and the generic
// x-team-token / Authorization fallbacks), so we send x-<role>-token + x-team-token.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { apiUrl } from "@/lib/queryClient";

export type PortalRole = "sales" | "finance" | "hr" | "consignment";

interface RoleUser {
  id: number; username: string; name?: string | null; role?: string | null;
  email?: string | null; phone?: string | null;
}
interface RoleCtx {
  token: string | null;
  user: RoleUser | null;
  setAuth: (token: string, user: RoleUser) => void;
  clear: () => void;
  ready: boolean;
}

function makeRoleAuth(role: PortalRole) {
  const KEY_TOKEN = `narmada_${role}_token`;
  const KEY_USER = `narmada_${role}_user`;

  function safeGet(key: string): string | null {
    try { return typeof window === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key: string, value: string | null) {
    try {
      if (typeof window === "undefined") return;
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch { /* sandboxed */ }
  }

  let memToken: string | null = safeGet(KEY_TOKEN);
  let memUser: RoleUser | null = (() => { try { return memToken ? JSON.parse(safeGet(KEY_USER) || "null") : null; } catch { return null; } })();

  const Ctx = createContext<RoleCtx>({ token: null, user: null, setAuth: () => {}, clear: () => {}, ready: false });

  function Provider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(memToken);
    const [user, setUser] = useState<RoleUser | null>(memUser);
    const [ready, setReady] = useState<boolean>(!memToken);

    const setAuth = useCallback((t: string, u: RoleUser) => {
      memToken = t; memUser = u;
      safeSet(KEY_TOKEN, t); safeSet(KEY_USER, JSON.stringify(u));
      setToken(t); setUser(u); setReady(true);
    }, []);

    const clear = useCallback(() => {
      memToken = null; memUser = null;
      safeSet(KEY_TOKEN, null); safeSet(KEY_USER, null);
      setToken(null); setUser(null); setReady(true);
    }, []);

    useEffect(() => {
      if (!memToken) { setReady(true); return; }
      let cancelled = false;
      (async () => {
        try {
          const r = await fetch(apiUrl(`/api/${role}/me`), { headers: { [`x-${role}-token`]: memToken!, "x-team-token": memToken! } });
          if (cancelled) return;
          if (!r.ok) clear();
          else { const data = await r.json(); if (data?.id) { memUser = data; safeSet(KEY_USER, JSON.stringify(data)); setUser(data); } setReady(true); }
        } catch { if (!cancelled) setReady(true); }
      })();
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <Ctx.Provider value={{ token, user, setAuth, clear, ready }}>{children}</Ctx.Provider>;
  }

  function useAuth() { return useContext(Ctx); }

  async function roleFetch(token: string | null, url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const t = token || memToken;
    if (t) { headers.set(`x-${role}-token`, t); headers.set("x-team-token", t); }
    // Only set JSON content-type when body is a plain string (not FormData).
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(apiUrl(url), { ...init, headers });
  }

  return { Provider, useAuth, roleFetch };
}

export const SalesAuth = makeRoleAuth("sales");
export const FinanceAuth = makeRoleAuth("finance");
export const HRAuth = makeRoleAuth("hr");
export const ConsignmentAuth = makeRoleAuth("consignment");
