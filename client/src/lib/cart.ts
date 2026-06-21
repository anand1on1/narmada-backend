// R27.1 — client-side cart. Persisted in localStorage (key: narmada_cart).
// A simple pub/sub so the header badge + cart page stay in sync without a global store.

export interface CartItem {
  productId?: number | null;
  slug?: string | null;
  partNumber?: string | null;
  name: string;
  image?: string | null;
  unitPriceInr: number;
  qty?: number;
}

const KEY = "narmada_cart";
type Listener = () => void;
const listeners = new Set<Listener>();

function read(): CartItem[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
  listeners.forEach((fn) => fn());
}

// Identity = productId when present, else partNumber, else name.
function sameLine(a: CartItem, b: CartItem): boolean {
  if (a.productId != null && b.productId != null) return a.productId === b.productId;
  if (a.partNumber && b.partNumber) return a.partNumber === b.partNumber;
  return a.name === b.name;
}

export function getCart(): CartItem[] {
  return read();
}

export function cartCount(): number {
  return read().reduce((n, it) => n + (Number(it.qty) || 0), 0);
}

export function cartSubtotalInr(): number {
  return read().reduce((s, it) => s + (Number(it.unitPriceInr) || 0) * (Number(it.qty) || 0), 0);
}

export function addToCart(item: CartItem, qty = 1) {
  const items = read();
  const existing = items.find((it) => sameLine(it, item));
  if (existing) existing.qty = (Number(existing.qty) || 0) + qty;
  else items.push({ ...item, qty: Math.max(1, qty) });
  write(items);
}

export function setQty(item: CartItem, qty: number) {
  const items = read();
  const existing = items.find((it) => sameLine(it, item));
  if (!existing) return;
  if (qty <= 0) {
    write(items.filter((it) => !sameLine(it, item)));
  } else {
    existing.qty = qty;
    write(items);
  }
}

export function removeFromCart(item: CartItem) {
  write(read().filter((it) => !sameLine(it, item)));
}

export function clearCart() {
  write([]);
}

export function subscribeCart(fn: Listener): () => void {
  listeners.add(fn);
  // Cross-tab sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
