import { QueryClient, QueryFunction } from "@tanstack/react-query";

// API base resolution order:
// 1. Build-time VITE_API_BASE (set when frontend is deployed separately to GoDaddy/CDN)
// 2. Perplexity deploy_website port-proxy placeholder __PORT_5000__
// 3. Same-origin (empty string) — when frontend & backend served from same host
// Runtime override: if window.__API_BASE__ is set (e.g., by /config.js loaded in index.html),
// it wins. Otherwise fall back to build-time VITE_API_BASE, then port-proxy placeholder, then same-origin.
const RUNTIME_API_BASE = typeof window !== "undefined" ? (window as any).__API_BASE__ : undefined;
const BUILD_API_BASE = (import.meta as any).env?.VITE_API_BASE as string | undefined;
const PORT_PLACEHOLDER = "__PORT_5000__";
export const API_BASE =
  (RUNTIME_API_BASE && String(RUNTIME_API_BASE).trim()) ||
  (BUILD_API_BASE && BUILD_API_BASE.trim()) ||
  (PORT_PLACEHOLDER.startsWith("__") ? "" : PORT_PLACEHOLDER);

/** Prepend API_BASE to a path so it works on GoDaddy (frontend) → Render (backend). */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(apiUrl(queryKey.join("/")));

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
