import { QUOTE_BRANDS, QUOTE_PARTS, QUOTE_FAQS, QUOTE_PHOTOS } from "../shared/quote-content";
import cities from "../shared/data/india-cities.json";
import { COUNTRIES } from "../client/src/data/countries";
import { escapeHtml as esc } from "./auto-blogger-safety";
import { CRITICAL_CSS } from "./seo-templates";

/** Same editorial source as the interactive guide. No user data or private prices. */
export function renderQuotePage(available: string[] = []) {
  const states = Array.from(new Set(cities.map(c => c.state))).sort();
  const photo = (i: number) => { const p = QUOTE_PHOTOS[i]; return `<figure><img src="${p.file}" alt="${esc(p.alt)}" width="1000" style="max-width:100%;height:auto" loading="lazy"><figcaption>${esc(p.caption)} Photo: <a href="${p.source}">${p.creator}</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Resized and converted to WebP; same licence.</figcaption></figure>`; };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Get a spare parts quotation | Trucks, buses and equipment | Narmada Mobility</title>
<meta name="description" content="Verify your email, upload an indent or enter parts manually, review quantities and request pricing for trucks, buses and construction equipment parts.">
<meta name="robots" content="index,follow"><link rel="canonical" href="https://narmadamobility.com/get-quote"><style>${CRITICAL_CSS}</style></head><body>
<header class="site"><a class="brand" href="/">Narmada Mobility</a><nav><a href="/products">Parts catalog</a><a href="/contact">Contact</a></nav></header>
<main class="container"><h1>Get a spare parts quotation</h1><p>For trucks, buses, tippers, dumpers, trailers and construction equipment.
Share the parts you need; pricing, fitment and delivery are confirmed in the quotation.</p>
<section><h2>Contact, verify, add parts and review</h2><p>Provide your company, contact name, mobile number, email and country.
Verify your email on this page, then choose Upload Indent Copy or Enter Parts Manually. Both routes lead to an editable review of part number, name and quantity.
Include delivery location and timing before submitting. A saved enquiry reference does not mean an email has reached an inbox.</p>
<noscript><p>JavaScript is required for the secure email-verification form and document upload. You can still read this guide and
<a href="mailto:anand@narmadamotors.in,sales@narmadamobility.com">email both sales addresses manually</a>.</p></noscript>
<p>Your request is addressed to anand@narmadamotors.in and sales@narmadamobility.com. Pricing and delivery require confirmation; no payment is collected by this form.</p></section>
${photo(0)}<section><h2>From your indent to a clear enquiry</h2><p>Keep leading zeroes in part numbers. Include chassis or engine reference, build year, emission standard, assembly identifiers and relevant dimensions.
Similar model names do not establish interchangeable fitment. Never guess an unknown part number or quantity.</p>
<p>Uploaded documents may be processed by our document-reading service. Review all extracted items before submission.
PDFs and images are sent to Anthropic for extraction. CSV and XLSX are processed on our server. Remove confidential or unnecessary information before uploading.
Manual entry remains available.</p></section>
<section><h2>Brand and model enquiry directory</h2><p>Selected current and legacy model families, not an exhaustive list, affiliation, stock statement or compatibility guarantee.</p>
${QUOTE_BRANDS.map(b => `<article><h3>${b.name}: ${b.kind}</h3><p>${esc(b.models)}</p><p><a href="${b.source}">Model reference</a>${b.secondary ? ` · <a href="${b.secondary}">Additional model reference</a>` : ""}</p>
${["tata","bharatbenz","mahindra","ashok-leyland"].includes(b.slug) ? `<p>${available.includes(b.slug) ? `<a href="/price-checker?brand=${b.slug}">Check available ${b.name} prices</a>` : `Request a ${b.name} price list with your enquiry.`} Public price checking where available, not a downloadable dealer-cost list.</p>` : ""}</article>`).join("")}</section>
<section><h2>Parts and assemblies you can enquire about</h2>${QUOTE_PARTS.map(([a,b]) => `<h3>${a}</h3><p>${b}</p>`).join("")}${photo(1)}</section>
<section><h2>India delivery enquiries: states, union territories, cities and towns</h2><p>All 28 states and 8 union territories are represented below.
These selected community city names are not exhaustive or a confirmed delivery network. Enter another destination in the enquiry and correct historical spellings where needed.</p>
${states.map(s => `<details><summary>${esc(s)}</summary><p>${cities.filter(c => c.state === s).map(c => esc(c.name)).join(", ")}</p></details>`).join("")}
<p>City data: <a href="https://github.com/nshntarora/Indian-Cities-JSON">Indian Cities JSON (MIT)</a>; additions from
<a href="https://knowindia.india.gov.in/states-uts/sikkim.php">Sikkim</a>, <a href="https://ladakh.gov.in/">Ladakh</a>,
<a href="https://lakshadweep.gov.in/">Lakshadweep</a> and <a href="https://ddd.gov.in/">Dadra and Nagar Haveli and Daman and Diu</a>. Reviewed 12 November 2026.</p></section>
<section><h2>International destination enquiries</h2><p>Give the country, city or port, quantities, packing needs and documentation requirements.
Export eligibility, customs, freight and lead times are checked separately. This country directory is an enquiry aid, not a list of established export routes.</p>
<details><summary>Country directory</summary><p>${COUNTRIES.map(c => esc(c.name)).join(", ")}</p></details></section>
<section><h2>Before you send an enquiry</h2>${QUOTE_FAQS.map(([q,a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</section>
</main></body></html>`;
}
