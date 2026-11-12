export const REFERENCE_NOTICE_TITLE = "Price and part-reference notice";
export const REFERENCE_NOTICES = [
  "Prices shown are for reference only. Final pricing is confirmed in your quotation.",
  "Part numbers are used for identification and reference only.",
  "Narmada Mobility is an independent seller. A brand or part-number reference does not mean the supplied part is OEM or manufactured by that brand.",
] as const;

export const REFERENCE_NOTICE_CSS = `
.reference-notice{min-width:0;margin:20px 0;padding:14px 16px;border:1px solid #bae6fd;border-radius:10px;background:#f0f9ff;color:#0f172a}
.reference-notice h2{font-size:15px;line-height:1.4;margin:0;border:0;padding:0;font-weight:600}
.reference-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.reference-control{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 12px;border:1px solid #bae6fd;border-radius:6px;background:#fff;color:#0f172a;font-size:13px;cursor:pointer}
.reference-control:focus-visible,.reference-notice summary:focus-visible{outline:2px solid #075985;outline-offset:3px}
.reference-window{overflow:hidden;margin-top:10px;max-width:100%}
.reference-track{display:flex;width:max-content;animation:reference-marquee 65s linear infinite;will-change:transform}
.reference-group{display:flex;align-items:center;gap:36px;flex-shrink:0;padding-right:36px}
.reference-statement{font-size:14px;line-height:1.6;white-space:nowrap;margin:0}
.reference-statement::before{content:"•";margin-right:12px;color:#0369a1}
.reference-notice[data-paused="true"] .reference-track,.reference-notice:hover .reference-track,.reference-notice:focus-within .reference-track,.reference-notice:has(.reference-pause:checked) .reference-track{animation-play-state:paused}
.reference-notice details{margin-top:12px;border-top:1px solid #bae6fd;padding-top:10px;font-size:13px}
.reference-notice summary{cursor:pointer;font-weight:600}
.reference-notice details p{font-size:14px;line-height:1.6;margin:8px 0 0}
.reference-reduced{display:none}
@keyframes reference-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){
 .reference-track{animation:none;transform:none;width:auto;will-change:auto}
 .reference-group{display:block;padding-right:0}
 .reference-group[aria-hidden="true"]{display:none}
 .reference-statement{white-space:normal;margin:6px 0}
 .reference-control{display:none}
 .reference-reduced{display:block;font-size:12px;margin:8px 0 0}
}`;

/** Complete CSS ticker; native checkbox pauses it even without JavaScript. */
export function renderReferenceNotice(): string {
  const statements = REFERENCE_NOTICES.map(text => `<p class="reference-statement">${text}</p>`).join("");
  return `<style>${REFERENCE_NOTICE_CSS}</style><aside aria-label="${REFERENCE_NOTICE_TITLE}" data-reference-notice="static" class="reference-notice">
<div class="reference-heading"><h2>${REFERENCE_NOTICE_TITLE}</h2><label class="reference-control"><input type="checkbox" class="reference-pause"> Pause ticker</label></div>
<div class="reference-window"><div class="reference-track"><div class="reference-group">${statements}</div><div class="reference-group" aria-hidden="true">${statements}</div></div></div>
<p class="reference-reduced">Reduced motion is enabled. All notices are shown without movement.</p>
<details><summary>Full disclaimer</summary>${REFERENCE_NOTICES.map(text => `<p>${text}</p>`).join("")}</details></aside>`;
}
