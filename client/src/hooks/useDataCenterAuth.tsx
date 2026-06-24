// v1.4a — Data Center auth. A fully separate session from the admin app: its own
// localStorage keys, its own x-datacenter-token header, validated against
// /api/datacenter/me. Mirrors admin-auth.tsx but never touches admin tokens.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { apiUrl } from "@/lib/queryClient";

interface DataCenterCtx {
  token: string | null;
  username: string | null;
  displayName: string | null;
  setAuth: (token: string, username: string, displayName?: string) => void;
  clear: () => void;
  ready: boolean;
}

const Ctx = createContext<DataCenterCtx>({
  token: null, username: null, displayName: null,
  setAuth: () => {}, clear: () => {}, ready: false,
});

const STORAGE_KEY_TOKEN = "narmada_dc_token";
const STORAGE_KEY_USER = "narmada_dc_user";
const STORAGE_KEY_DISPLAY = "narmada_dc_display";

function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value === null) { localStorage.removeItem(key); sessionStorage.removeItem(key); }
    else localStorage.setItem(key, value);
  } catch { /* sandboxed iframe — module memory fallback */ }
}

let memToken: string | null = safeGet(STORAGE_KEY_TOKEN);
let memUser: string | null = safeGet(STORAGE_KEY_USER);
let memDisplay: string | null = safeGet(STORAGE_KEY_DISPLAY);

export function DataCenterAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [username, setUsername] = useState<string | null>(memUser);
  const [displayName, setDisplayName] = useState<string | null>(memDisplay);
  const [ready, setReady] = useState<boolean>(!memToken);

  const setAuth = useCallback((t: string, u: string, d?: string) => {
    memToken = t; memUser = u; memDisplay = d || u;
    safeSet(STORAGE_KEY_TOKEN, t);
    safeSet(STORAGE_KEY_USER, u);
    safeSet(STORAGE_KEY_DISPLAY, memDisplay);
    setToken(t); setUsername(u); setDisplayName(memDisplay);
    setReady(true);
  }, []);

  const clear = useCallback(() => {
    memToken = null; memUser = null; memDisplay = null;
    safeSet(STORAGE_KEY_TOKEN, null);
    safeSet(STORAGE_KEY_USER, null);
    safeSet(STORAGE_KEY_DISPLAY, null);
    setToken(null); setUsername(null); setDisplayName(null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!memToken) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/datacenter/me"), { headers: { "x-datacenter-token": memToken! } });
        if (cancelled) return;
        if (!r.ok) { clear(); }
        else {
          const data = await r.json();
          if (data) {
            memDisplay = data.displayName || data.username || memUser;
            safeSet(STORAGE_KEY_DISPLAY, memDisplay);
            setDisplayName(memDisplay);
          }
          setReady(true);
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ token, username, displayName, setAuth, clear, ready }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDataCenterAuth() {
  return useContext(Ctx);
}

// dcFetch — sends the x-datacenter-token header. Mirrors adminFetch's JSON default
// (skip Content-Type for multipart by passing your own headers).
export async function dcFetch(token: string | null, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = token || memToken;
  if (t) headers.set("x-datacenter-token", t);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(url), { ...init, headers });
}

export function getDataCenterToken(): string | null { return memToken; }
