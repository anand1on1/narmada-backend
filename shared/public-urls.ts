// One canonical host and product route shared by HTML, XML, SPA and editorial links.
export const PUBLIC_ORIGIN = "https://narmadamobility.com";
export const MEDIA_ORIGIN = "https://narmada-backend.onrender.com";
export function productPath(p: { slug: string; partNumber?: string | null; part_number?: string | null }) {
  const raw = p.partNumber || p.part_number;
  // Apache shared hosts commonly reject encoded slashes before PHP. Such part
  // numbers remain visible in content/SKU, but use the valid slug-only URL.
  const pn = raw && !/[/\\]/.test(raw) ? raw : null;
  return `/product/${pn ? `${encodeURIComponent(pn)}/` : ""}${encodeURIComponent(p.slug)}`;
}
export function publicMedia(input: string): string {
  try {
    const u = new URL(input, input.startsWith("/uploads/") ? MEDIA_ORIGIN : PUBLIC_ORIGIN);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (u.hostname === "www.narmadamobility.com") u.hostname = "narmadamobility.com";
    // Uploaded files live on the persistent backend, not in daily frontend ZIPs.
    if (u.hostname === "narmadamobility.com" && u.pathname.startsWith("/uploads/")) return MEDIA_ORIGIN + u.pathname;
    return u.href;
  } catch { return ""; }
}
