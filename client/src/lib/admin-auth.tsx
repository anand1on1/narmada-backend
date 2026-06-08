// Admin auth helper — token is held only in module memory (sandbox blocks localStorage).
import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { apiUrl } from "@/lib/queryClient";

interface AdminCtx {
  token: string | null;
  username: string | null;
  setAuth: (token: string, username: string) => void;
  clear: () => void;
}

const Ctx = createContext<AdminCtx>({ token: null, username: null, setAuth: () => {}, clear: () => {} });

let memToken: string | null = null;
let memUser: string | null = null;

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [username, setUsername] = useState<string | null>(memUser);

  const setAuth = useCallback((t: string, u: string) => {
    memToken = t; memUser = u;
    setToken(t); setUsername(u);
  }, []);

  const clear = useCallback(() => {
    memToken = null; memUser = null;
    setToken(null); setUsername(null);
  }, []);

  return <Ctx.Provider value={{ token, username, setAuth, clear }}>{children}</Ctx.Provider>;
}

export function useAdminAuth() {
  return useContext(Ctx);
}

export async function adminFetch(token: string | null, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("x-admin-token", token);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(url), { ...init, headers });
}

export function getAdminToken(): string | null { return memToken; }
