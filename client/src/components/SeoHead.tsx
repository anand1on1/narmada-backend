import { useEffect } from "react";
import { PUBLIC_ORIGIN } from "@shared/public-urls";

export function SeoHead({ title, description, keywords, jsonLd, canonicalPath, noindex = false }: {
  title: string;
  description: string;
  keywords?: string;
  jsonLd?: object | object[];
  canonicalPath?: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    if (keywords) setMeta("keywords", keywords);
    setProp("og:title", title);
    setProp("og:description", description);
    const page = new URLSearchParams(window.location.search).get("page");
    const path = canonicalPath || window.location.pathname + (page && /^[1-9]\d*$/.test(page) && Number(page) > 1 ? `?page=${page}` : "");
    const canonical = PUBLIC_ORIGIN + path;
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = canonical;
    setProp("og:url", canonical);
    setMeta("robots", noindex ? "noindex,follow" : "index,follow,max-image-preview:large");

    // JSON-LD — remove any previously injected scripts, then inject one <script> per object
    document.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
    if (jsonLd) {
      const items = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      items.forEach((item) => {
        const s = document.createElement("script");
        s.setAttribute("data-seohead-jsonld", "1");
        s.type = "application/ld+json";
        s.text = JSON.stringify(item);
        document.head.appendChild(s);
      });
    }
  }, [title, description, keywords, jsonLd, canonicalPath, noindex]);
  return null;
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
  el.setAttribute("content", content);
}
function setProp(prop: string, content: string) {
  let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement("meta"); el.setAttribute("property", prop); document.head.appendChild(el); }
  el.setAttribute("content", content);
}
