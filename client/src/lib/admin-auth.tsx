// Admin auth helper — persists token in localStorage so refresh AND new-tab keep the admin signed in.
// Session A V2: switched from sessionStorage to localStorage so session survives new tab opening.
// Also revalidates token against backend on mount via /api/admin/me so stale tokens are cleared.
// Falls back to module memory if storage is blocked (e.g. embedded iframe sandbox).
import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { apiUrl } from "@/lib/queryClient";

export type AdminRole = "admin" | "logistics" | "accounts" | "sales" | "data_center" | "procurement" | "finance";

interface AdminCtx {
  token: string | null;
  username: string | null;
  role: AdminRole | null;
  displayName: string | null;
  setAuth: (token: string, username: string, role?: AdminRole, displayName?: string) => void;
  clear: () => void;
  ready: boolean;  // true once initial /me validation has completed
}

const Ctx = createContext<AdminCtx>({
  token: null, username: null, role: null, displayName: null,
  setAuth: () => {}, clear: () => {}, ready: false,
});

const STORAGE_KEY_TOKEN = "narmada_admin_token";
const STORAGE_KEY_USER = "narmada_admin_user";
const STORAGE_KEY_ROLE = "narmada_admin_role";
const STORAGE_KEY_DISPLAY = "narmada_admin_display";

function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    // Prefer localStorage (survives new tabs), fall back to sessionStorage (legacy tokens)
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value === null) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch { /* sandboxed iframe — fall back to module memory */ }
}

let memToken: string | null = safeGet(STORAGE_KEY_TOKEN);
let memUser: string | null = safeGet(STORAGE_KEY_USER);
let memRole: string | null = safeGet(STORAGE_KEY_ROLE);
let memDisplay: string | null = safeGet(STORAGE_KEY_DISPLAY);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(memToken);
  const [username, setUsername] = useState<string | null>(memUser);
  const [role, setRole] = useState<AdminRole | null>((memRole as AdminRole) || null);
  const [displayName, setDisplayName] = useState<string | null>(memDisplay);
  const [ready, setReady] = useState<boolean>(!memToken);  // if no token, no need to validate

  const setAuth = useCallback((t: string, u: string, r?: AdminRole, d?: string) => {
    memToken = t; memUser = u; memRole = r || "admin"; memDisplay = d || u;
    safeSet(STORAGE_KEY_TOKEN, t);
    safeSet(STORAGE_KEY_USER, u);
    safeSet(STORAGE_KEY_ROLE, memRole);
    safeSet(STORAGE_KEY_DISPLAY, memDisplay);
    setToken(t); setUsername(u);
    setRole(memRole as AdminRole); setDisplayName(memDisplay);
    setReady(true);
  }, []);

  const clear = useCallback(() => {
    memToken = null; memUser = null; memRole = null; memDisplay = null;
    safeSet(STORAGE_KEY_TOKEN, null);
    safeSet(STORAGE_KEY_USER, null);
    safeSet(STORAGE_KEY_ROLE, null);
    safeSet(STORAGE_KEY_DISPLAY, null);
    setToken(null); setUsername(null); setRole(null); setDisplayName(null);
    setReady(true);
  }, []);

  // Session A V2: validate token against backend on mount.
  // If /api/admin/me returns 401, clear stale token. If it returns ok, refresh role/displayName.
  useEffect(() => {
    if (!memToken) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/admin/me"), {
          headers: { "x-admin-token": memToken! },
        });
        if (cancelled) return;
        if (!r.ok) {
          // Token invalid/expired — clear
          clear();
        } else {
          const data = await r.json();
          // Update role/displayName from server in case they changed
          if (data && data.role) {
            memRole = data.role;
            memDisplay = data.displayName || data.username || memUser;
            safeSet(STORAGE_KEY_ROLE, memRole);
            safeSet(STORAGE_KEY_DISPLAY, memDisplay);
            setRole(memRole as AdminRole);
            setDisplayName(memDisplay);
          }
          setReady(true);
        }
      } catch {
        // Network failure — keep token in place, mark ready so UI doesn't hang
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ token, username, role, displayName, setAuth, clear, ready }}>
      {children}
    </Ctx.Provider>
  );
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
export function getAdminRole(): AdminRole | null { return (memRole as AdminRole) || null; }
