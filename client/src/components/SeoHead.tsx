import { useEffect } from "react";

export function SeoHead({ title, description, keywords, jsonLd }: {
  title: string;
  description: string;
  keywords?: string;
  jsonLd?: object | object[];
}) {
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    if (keywords) setMeta("keywords", keywords);
    setProp("og:title", title);
    setProp("og:description", description);

    // JSON-LD — remove any previously injected scripts, then inject one <script> per object
    document.querySelectorAll('script[data-seohead-jsonld="1"]').forEach((n) => n.remove());
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
  }, [title, description, keywords, jsonLd]);
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
