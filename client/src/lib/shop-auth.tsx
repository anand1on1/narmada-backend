// R27.1 — website shopper (e-commerce) auth. SEPARATE from customer-auth.tsx
// (which is the OTP-based B2B portal). Token in localStorage (narmada_shop_token);
// revalidates via /api/shop/me using the x-shop-token header.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
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

export function ShopAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [user, setUser] = useState<ShopUser | null>(null);
  const [ready, setReady] = useState<boolean>(!memToken);

  const setAuth = useCallback((t: string, u: ShopUser) => {
    memToken = t;
    safeSet(K_TOKEN, t);
    setToken(t); setUser(u); setReady(true);
  }, []);

  const clear = useCallback(() => {
    memToken = null;
    safeSet(K_TOKEN, null);
    setToken(null); setUser(null); setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!memToken) { setReady(true); return; }
    try {
      const r = await fetch(apiUrl("/api/shop/me"), { headers: { "x-shop-token": memToken } });
      if (r.ok) { setUser(await r.json()); setReady(true); }
      else { clear(); }
    } catch { clear(); }
  }, [clear]);

  useEffect(() => {
    let mounted = true;
    if (!token) { setReady(true); return; }
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/shop/me"), { headers: { "x-shop-token": token } });
        if (!mounted) return;
        if (r.ok) { setUser(await r.json()); setReady(true); }
        else clear();
      } catch { if (mounted) clear(); }
    })();
    return () => { mounted = false; };
  }, [token, clear]);

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
