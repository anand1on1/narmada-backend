import { useEffect, useRef, useSyncExternalStore } from "react";
import { Link } from "wouter";

const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
export function useResultParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const params = new URLSearchParams(search);
  function update(values: Record<string, string | number>, resetPage = true) {
    // Read the latest URL so several setters in one event cannot overwrite
    // each other, and browser Back is always the source of truth.
    const next = new URLSearchParams(window.location.search);
    if (resetPage) next.delete("page");
    Object.entries(values).forEach(([key, value]) => {
      if (value === "" || (key === "page" && Number(value) === 1)) next.delete(key);
      else next.set(key, String(value));
    });
    const suffix = next.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (suffix ? `?${suffix}` : ""));
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const parsed = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  return {
    params, update, page,
    setPage: (value: number | ((page: number) => number)) => update({ page: typeof value === "function" ? value(page) : value }, false),
  };
}

// Bounded, short-lived scroll bookkeeping; never browser storage or API cache.
const positions = new Map<string, { y: number; at: number }>();
export function safeResultsReturn(value: string | null, base: string) {
  if (!value || (value !== base && !value.startsWith(base + "?")) || value.includes("#") || value.includes("\\")) return base;
  return value;
}
export function useResultsNavigation(base: string, ready: boolean, identity: string | null) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const url = base + search;
  const key = `${identity || ""}:${url}`;
  const restored = useRef("");
  useEffect(() => {
    if (!ready || restored.current === key) return;
    restored.current = key;
    const position = positions.get(key);
    if (!position || Date.now() - position.at > 30 * 60_000) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: position.y, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  function remember() {
    positions.delete(key);
    positions.set(key, { y: window.scrollY, at: Date.now() });
    if (positions.size > 80) positions.delete(positions.keys().next().value!);
  }
  return {
    remember,
    detailHref: (id: number) => `${base}/${id}?${new URLSearchParams({ returnTo: url })}`,
  };
}
export function BackToResults({ base }: { base: string }) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const href = safeResultsReturn(new URLSearchParams(search).get("returnTo"), base);
  return <Link href={href} className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline mb-4" data-testid="back-to-results">← Back to results</Link>;
}
