export const REFERENCE_NOTICE_TITLE = "Price and part-reference notice";
export const REFERENCE_NOTICES = [
  "Prices shown are for reference only. Final pricing is confirmed in your quotation.",
  "Part numbers are used for identification and reference only.",
  "Narmada Mobility is an independent seller. A brand or part-number reference does not mean the supplied part is OEM or manufactured by that brand.",
] as const;

/** Static, complete counterpart of the enhanced carousel, with no JS dependency. */
export function renderReferenceNotice(): string {
  return `<aside aria-label="${REFERENCE_NOTICE_TITLE}" data-reference-notice="static" style="margin:20px 0;padding:16px;border:1px solid #bae6fd;border-radius:10px;background:#f0f9ff;color:#0f172a">
<h2 style="font-size:16px;margin:0 0 12px;border:0">${REFERENCE_NOTICE_TITLE}</h2>
<details open><summary style="cursor:pointer;font-weight:600">Full disclaimer</summary>
${REFERENCE_NOTICES.map(text => `<p style="font-size:14px;line-height:1.6;margin:10px 0 0">${text}</p>`).join("")}</details></aside>`;
}
