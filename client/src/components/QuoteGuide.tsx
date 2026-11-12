import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/queryClient";
import { COUNTRIES } from "@/data/countries";
import { QUOTE_BRANDS, QUOTE_PARTS, QUOTE_FAQS, QUOTE_PHOTOS } from "@shared/quote-content";
import cities from "@shared/data/india-cities.json";
import { Input } from "./ui/input";

const states = Array.from(new Set(cities.map(c => c.state))).sort();
export function DestinationPicker({ value, onChange, disabled = false }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [country, setCountry] = useState("IN");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const matches = cities.filter(c => (!state || c.state === state) && c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20);
  return <fieldset disabled={disabled} className="space-y-4" data-testid="quote-destination">
    <legend className="font-semibold text-lg mb-3">Delivery enquiry destination</legend>
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="text-sm">Country<select value={country} onChange={e => { setCountry(e.target.value); const c = COUNTRIES.find(c => c.code === e.target.value); onChange(c?.name || ""); }} className="block w-full border rounded-md bg-white p-3 mt-2" data-testid="destination-country">
        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      {country === "IN" && <label className="text-sm">State or union territory<select value={state} onChange={e => setState(e.target.value)} className="block w-full border rounded-md bg-white p-3 mt-2" data-testid="destination-state">
        <option value="">All 36 states and union territories</option>{states.map(s => <option key={s}>{s}</option>)}</select></label>}
    </div>
    {country === "IN" && <>
      <label className="block text-sm">Find a city or town<Input className="mt-2" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a city, or choose a state" data-testid="destination-search" /></label>
      {(search || state) && <div className="flex flex-wrap gap-2" aria-label="Matching destinations">{matches.length ? matches.map((c, i) =>
        <button type="button" key={`${c.name}-${i}`} onClick={() => onChange(`${c.name}, ${c.state}, India`)} className="border rounded-md p-3 text-sm text-left hover:bg-cyan-50" data-testid={`destination-city-${i}`}>{c.name}, {c.state}</button>) : <p>No match. Enter your destination below.</p>}</div>}
    </>}
    <label className="block text-sm font-medium">Selected destination, city, port or address (editable)<Input value={value} maxLength={300} onChange={e => onChange(e.target.value)} className="mt-2" data-testid="destination-value" /></label>
    <p className="text-sm text-slate-600">Selected cities and towns, not an exhaustive directory or confirmed delivery network.
      Enter any other destination manually. Shipping and export eligibility are checked for each enquiry.</p>
  </fieldset>;
}
function Photo({ index }: { index: number }) {
  const p = QUOTE_PHOTOS[index];
  return <figure>
    <img src={p.file} alt={p.alt} loading="lazy" decoding="async" width={index ? 1000 : 1400} height={index ? 667 : 933}
      className="w-full max-h-96 object-contain bg-white rounded-lg" onError={e => { e.currentTarget.hidden = true; }} />
    <figcaption className="text-xs text-slate-600 mt-3 leading-relaxed">{p.caption} Photo: <a href={p.source} className="underline">{p.creator}</a>,
      {" "}<a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline">CC BY-SA 4.0</a>. Resized and converted to WebP; derivative under the same licence.</figcaption>
  </figure>;
}
export function QuoteGuide({ onDestination }: { onDestination: (v: string) => void }) {
  const [destination, setDestination] = useState("");
  const { data: available } = useQuery<{ brand: string }[]>({ queryKey: ["/api/price-lists/brands"], queryFn: async () => {
    const r = await fetch(apiUrl("/api/price-lists/brands")); if (!r.ok) throw Error("Price availability unavailable"); return r.json();
  } });
  return <div className="space-y-12 mt-12" data-testid="quote-guide">
    <section className="grid lg:grid-cols-[1.1fr_1fr] gap-8 items-center">
      <Photo index={0} /><div>
        <h2 className="text-2xl font-semibold">From your indent to a clear enquiry</h2>
        <p className="mt-4 text-slate-600">A useful quotation starts with identifiers, quantities and the vehicle or machine application.
          Verify your email above, then choose Upload Indent Copy or Enter Parts Manually. Both routes lead to the same editable review.</p>
        <p className="mt-4 text-slate-600">Keep leading zeroes in part numbers. For replacement assemblies, include the chassis or engine reference,
          build year, emission standard and any relevant dimensions. Similar model names do not establish interchangeable fitment.</p>
        <p className="mt-4 text-slate-600">Your enquiry goes to both sales addresses. The team can then check your requirements and quote the
          applicable prices, terms and delivery options. No payment is collected by this form.</p>
      </div>
    </section>
    <section><h2 className="text-2xl font-semibold">Brand and model enquiry directory</h2>
      <p className="mt-3 text-slate-600">Selected current and legacy families help you describe your application. These are not an exhaustive model list,
        an affiliation statement or a claim of stock. Always include the exact vehicle or machine details.</p>
      <div className="divide-y mt-6">{QUOTE_BRANDS.map(b => <article key={b.slug} className="py-5 grid md:grid-cols-[210px_1fr] gap-3">
        <div><h3 className="text-lg font-semibold">{b.name}</h3><p className="text-sm text-slate-600 mt-1">{b.kind}</p></div>
        <div><p>{b.models}</p><p className="text-sm mt-3"><a className="underline text-cyan-800" href={b.source}>Model reference</a>
          {b.secondary && <> · <a className="underline text-cyan-800" href={b.secondary}>Additional model reference</a></>}</p>
          {["tata", "bharatbenz", "mahindra", "ashok-leyland"].includes(b.slug) && <p className="mt-3 text-sm">
            {available?.some(v => v.brand === b.slug) ? <a className="underline text-cyan-800" href={`/price-checker?brand=${b.slug}`} data-testid={`quote-price-${b.slug}`}>Check available {b.name} prices</a> :
              <button onClick={() => document.querySelector("main")?.scrollIntoView({ behavior: "smooth" })} className="underline text-cyan-800 py-2" data-testid={`quote-price-request-${b.slug}`}>Request a {b.name} price list with your enquiry</button>}
            <span className="block text-slate-600 mt-1">Public MRP in INR, GST included. Ask for a discount. Not a downloadable dealer-cost list.</span></p>}
        </div></article>)}</div>
      <p className="text-slate-600 mt-4">Other makes can be specified in your notes, including Scania, MAN, Isuzu, Mercedes-Benz, Komatsu, Hitachi,
        Hyundai and Kobelco. The sales team must assess the exact part and application.</p>
    </section>
    <section className="grid lg:grid-cols-[1fr_340px] gap-8">
      <div><h2 className="text-2xl font-semibold">Parts and assemblies you can enquire about</h2>
        <dl className="mt-6 space-y-5">{QUOTE_PARTS.map(([title, body]) => <div key={title}><dt className="font-semibold">{title}</dt><dd className="text-slate-600 mt-1">{body}</dd></div>)}</dl></div>
      <Photo index={1} />
    </section>
    <section className="bg-white rounded-xl border p-5 sm:p-8">
      <h2 className="text-2xl font-semibold mb-5">India and international delivery enquiries</h2>
      <p className="text-slate-600 mb-6">Browse all 28 Indian states and 8 union territories, search selected cities and towns, or choose a country.
        For export enquiries, add a city or port and any packing or documentation requirements. The country list is an enquiry aid, not a list of established export routes.</p>
      <DestinationPicker value={destination} onChange={setDestination} />
      <button disabled={!destination.trim()} onClick={() => onDestination(destination)} className="mt-4 bg-cyan-800 text-white rounded-md p-3 disabled:opacity-50" data-testid="destination-use">Use this destination in my enquiry</button>
      <p className="text-xs leading-relaxed text-slate-600 mt-4">City data: <a href="https://github.com/nshntarora/Indian-Cities-JSON" className="underline">Indian Cities JSON (MIT)</a>,
        with selected additions from <a href="https://knowindia.india.gov.in/states-uts/sikkim.php" className="underline">Sikkim</a>, <a href="https://ladakh.gov.in/" className="underline">Ladakh</a>,
        {" "}<a href="https://lakshadweep.gov.in/" className="underline">Lakshadweep</a> and <a href="https://ddd.gov.in/" className="underline">Dadra and Nagar Haveli and Daman and Diu</a>.
        Reviewed 12 November 2026; some community city spellings may be historical. Please correct the final address where needed.</p>
    </section>
    <section><h2 className="text-2xl font-semibold mb-5">Before you send an enquiry</h2>
      <div className="divide-y">{QUOTE_FAQS.map(([q, a]) => <details key={q} className="py-4"><summary className="font-semibold cursor-pointer">{q}</summary><p className="text-slate-600 mt-3">{a}</p></details>)}</div>
    </section>
  </div>;
}
