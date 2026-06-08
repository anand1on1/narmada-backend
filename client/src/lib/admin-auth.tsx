// Admin auth helper — persists token in sessionStorage so a page refresh keeps the admin signed in.
// Falls back to module memory if storage is blocked (e.g. embedded iframe sandbox).
import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { apiUrl } from "@/lib/queryClient";

interface AdminCtx {
  token: string | null;
  username: string | null;
  setAuth: (token: string, username: string) => void;
  clear: () => void;
}

const Ctx = createContext<AdminCtx>({ token: null, username: null, setAuth: () => {}, clear: () => {} });

const STORAGE_KEY_TOKEN = "narmada_admin_token";
const STORAGE_KEY_USER = "narmada_admin_user";

function safeGet(key: string): string | null {
  try { return typeof window !== "undefined" ? sessionStorage.getItem(key) : null; } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* sandboxed iframe — fall back to module memory */ }
}

let memToken: string | null = safeGet(STORAGE_KEY_TOKEN);
let memUser: string | null = safeGet(STORAGE_KEY_USER);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [username, setUsername] = useState<string | null>(memUser);

  const setAuth = useCallback((t: string, u: string) => {
    memToken = t; memUser = u;
    safeSet(STORAGE_KEY_TOKEN, t);
    safeSet(STORAGE_KEY_USER, u);
    setToken(t); setUsername(u);
  }, []);

  const clear = useCallback(() => {
    memToken = null; memUser = null;
    safeSet(STORAGE_KEY_TOKEN, null);
    safeSet(STORAGE_KEY_USER, null);
    setToken(null); setUsername(null);
  }, []);

  return <Ctx.Provider value={{ token, username, setAuth, clear }}>{children}</Ctx.Provider>;
}

export function useAdminAuth() {
  return useContext(Ctx);
}

export async function adminFetch(token: string | null, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = token || memToken;
  if (t) headers.set("x-admin-token", t);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(url), { ...init, headers });
}

export function getAdminToken(): string | null { return memToken; }
