// R27.1 — website shopper (e-commerce) auth. SEPARATE from customer-auth.tsx
// (which is the OTP-based B2B portal). Token in localStorage (narmada_shop_token);
// revalidates via /api/shop/me using the x-shop-token header.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from "react";
import { apiUrl } from "@/lib/queryClient";

interface ShopUser {
  id: number;
  email: string;
  fullName?: string | null;
  phone?: string | null;
}

interface ShopCtx {
  token: string | null;
  user: ShopUser | null;
  ready: boolean;
  setAuth: (token: string, user: ShopUser) => void;
  clear: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ShopCtx>({
  token: null, user: null, ready: false,
  setAuth: () => {}, clear: () => {}, refresh: async () => {},
});

const K_TOKEN = "narmada_shop_token";

function safeGet(key: string): string | null {
  try { if (typeof window === "undefined") return null; return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try { if (typeof window === "undefined") return; if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
}

let memToken: string | null = safeGet(K_TOKEN);

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [user, setUser] = useState<ShopUser | null>(null);
  const [ready, setReady] = useState<boolean>(!memToken);
  // R27.1b BUG-1 — when setAuth just stored a fresh server-issued user, skip the
  // next revalidate cycle so a racing /api/shop/me can't transiently clear() it.
  const justSetRef = useRef(false);

  const setAuth = useCallback((t: string, u: ShopUser) => {
    memToken = t;
    safeSet(K_TOKEN, t);
    justSetRef.current = true;
    setToken(t); setUser(u); setReady(true);
    // R27.1a BUG 3 — notify any non-context listeners (and other tabs sync via storage).
    try { window.dispatchEvent(new Event("shop:auth-changed")); } catch {}
  }, []);

  const clear = useCallback(() => {
    memToken = null;
    safeSet(K_TOKEN, null);
    setToken(null); setUser(null); setReady(true);
    try { window.dispatchEvent(new Event("shop:auth-changed")); } catch {}
  }, []);

  // R27.1b BUG-1 — revalidate with retry/backoff. Only clear() on a definitive
  // 401/403 (token rejected). Network errors and 5xx leave state intact.
  const revalidate = useCallback(async () => {
    if (!memToken) { setReady(true); return; }
    const delays = [0, 500, 1500];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await sleep(delays[i]);
      if (memToken == null) { setReady(true); return; }
      try {
        const r = await fetch(apiUrl("/api/shop/me"), { headers: { "x-shop-token": memToken } });
        if (r.ok) { setUser(await r.json()); setReady(true); return; }
        if (r.status === 401 || r.status === 403) { clear(); return; }
        // 5xx / other: retry
      } catch {
        // network: retry
      }
    }
    // All retries exhausted on transient errors — keep existing state, just mark ready.
    setReady(true);
  }, [clear]);

  const refresh = useCallback(async () => { await revalidate(); }, [revalidate]);

  useEffect(() => {
    if (!token) { setReady(true); return; }
    if (justSetRef.current) {
      // Fresh user came straight from the server via setAuth — trust it, skip one cycle.
      justSetRef.current = false;
      setReady(true);
      return;
    }
    let mounted = true;
    (async () => { if (mounted) await revalidate(); })();
    return () => { mounted = false; };
  }, [token, revalidate]);

  // R27.1a BUG 3 — keep auth state in sync if the token changes in another tab
  // (storage event) or via the custom event we dispatch on login/verify/logout.
  useEffect(() => {
    const sync = () => {
      const t = safeGet(K_TOKEN);
      memToken = t;
      setToken(t);
      if (!t) { setUser(null); setReady(true); }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === K_TOKEN) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("shop:auth-changed", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("shop:auth-changed", sync);
    };
  }, []);

  return <Ctx.Provider value={{ token, user, ready, setAuth, clear, refresh }}>{children}</Ctx.Provider>;
}

export function useShopAuth() { return useContext(Ctx); }

export async function shopFetch(token: string | null, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("x-shop-token", token);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}
