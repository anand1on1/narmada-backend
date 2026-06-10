// Customer portal auth helper — mirrors admin-auth pattern.
// Token lives in localStorage (key: narmada_customer_token); revalidates on mount via /api/customer/me.
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { apiUrl } from "@/lib/queryClient";

interface CustomerCtx {
  token: string | null;
  email: string | null;
  customer: any | null;
  setAuth: (token: string, email: string) => void;
  clear: () => void;
  ready: boolean;
}

const Ctx = createContext<CustomerCtx>({
  token: null, email: null, customer: null,
  setAuth: () => {}, clear: () => {}, ready: false,
});

const K_TOKEN = "narmada_customer_token";
const K_EMAIL = "narmada_customer_email";

function safeGet(key: string): string | null {
  try { if (typeof window === "undefined") return null; return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try { if (typeof window === "undefined") return; if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
}

let memToken: string | null = safeGet(K_TOKEN);
let memEmail: string | null = safeGet(K_EMAIL);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [email, setEmail] = useState<string | null>(memEmail);
  const [customer, setCustomer] = useState<any | null>(null);
  const [ready, setReady] = useState<boolean>(!memToken);

  const setAuth = useCallback((t: string, e: string) => {
    memToken = t; memEmail = e;
    safeSet(K_TOKEN, t); safeSet(K_EMAIL, e);
    setToken(t); setEmail(e); setReady(true);
  }, []);

  const clear = useCallback(() => {
    memToken = null; memEmail = null;
    safeSet(K_TOKEN, null); safeSet(K_EMAIL, null);
    setToken(null); setEmail(null); setCustomer(null); setReady(true);
  }, []);

  useEffect(() => {
    if (!token) { setReady(true); return; }
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/customer/me"), { headers: { "x-customer-token": token } });
        if (r.ok) {
          const j = await r.json();
          setCustomer(j);
          setReady(true);
        } else {
          clear();
        }
      } catch { clear(); }
    })();
  }, [token, clear]);

  return <Ctx.Provider value={{ token, email, customer, setAuth, clear, ready }}>{children}</Ctx.Provider>;
}

export function useCustomerAuth() { return useContext(Ctx); }

export async function customerFetch(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-customer-token", token);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(apiUrl(path), { ...init, headers });
}
