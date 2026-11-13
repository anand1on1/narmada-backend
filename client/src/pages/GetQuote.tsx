import { useState } from "react";
import { apiUrl } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeoHead } from "@/components/SeoHead";
import { COUNTRIES, findCountry } from "@/data/countries";
import { Upload, ListPlus, Loader2, Trash2 } from "lucide-react";
import { QuoteGuide, DestinationPicker } from "@/components/QuoteGuide";

type Contact = { company_name: string; contact_name: string; email: string; mobile: string; country: string; currency: string; country_code: string };
type Item = { part_number: string; description: string; qty: string; needs_review?: boolean };
const initial: Contact = { company_name: "", contact_name: "", email: "", mobile: "", country: "IN", currency: "INR", country_code: "+91" };
const blank = (): Item => ({ part_number: "", description: "", qty: "" });
async function request(path: string, body?: unknown, token?: string, multipart = false) {
  const response = await fetch(apiUrl(path), { method: body === undefined ? "GET" : "POST",
    headers: { ...(multipart || body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { "x-quote-token": token } : {}) },
    body: body === undefined ? undefined : multipart ? body as FormData : JSON.stringify(body) });
  const contentType = response.headers.get("content-type") || "";
  if (!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    if (response.status === 404 || (response.ok && /text\/html/i.test(contentType))) {
      throw Error("This quotation feature is not available on the current server version. Please contact sales so the matching backend can be deployed. Re-uploading the file will not fix this; your draft is retained.");
    }
    throw Error("The quotation service is temporarily unavailable. Your draft is retained. Please try later or contact sales.");
  }
  let result: any;
  try { result = await response.json(); } catch { throw Error("The service returned an unreadable response. Retry without changing your draft."); }
  if (!response.ok) throw Error(result.error || "The request failed. Please try again.");
  return result;
}
export default function GetQuote() {
  const [step, setStep] = useState(1);
  const [contact, setContact] = useState<Contact>(initial);
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"upload" | "manual" | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [timeframe, setTimeframe] = useState("immediate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<any>(null);
  const [key] = useState(() => crypto.randomUUID());
  const validContact = contact.company_name.trim() && contact.contact_name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) && /^\d{6,15}$/.test(contact.mobile);
  const validItems = items.length > 0 && items.length <= 500 && items.every(i => (i.part_number.trim() || i.description.trim()) && /^\d+$/.test(i.qty) && Number(i.qty) >= 1 && Number(i.qty) <= 9999);
  const changeContact = (name: keyof Contact, value: string) => {
    if (name === "email") { setToken(""); setSentTo(""); setCode(""); }
    setContact(c => ({ ...c, [name]: value })); setError(""); setNotice("");
  };
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (e: any) {
      setError(e.message || "Please try again.");
      if (/verify.*email|expired.*token|invalid_or_expired_token|missing_token/i.test(e.message || "")) setToken("");
    }
    finally { setBusy(false); }
  };
  const go = (next: number) => { setError(""); setNotice(""); setStep(next); window.scrollTo({ top: 0 }); };
  const send = () => run(async () => {
    const email = contact.email.trim().toLowerCase();
    await request("/api/quote/otp/send", { email });
    setSentTo(email); setCode(""); setNotice("Verification email sent. The code expires in 10 minutes.");
  });
  const verify = () => run(async () => {
    if (!validContact) throw Error("Complete your contact details before verifying your email.");
    const data = await request("/api/quote/otp/verify", { email: sentTo, code, contact });
    if (!data.verification_token) throw Error("Verification did not complete. Please request a new code.");
    setToken(data.verification_token); setNotice("Email verified. Continue to choose how to add parts.");
  });
  const parse = () => run(async () => {
    if (!file || !consent) throw Error("Choose a file and confirm document-processing consent.");
    if (file.size > 4 * 1024 * 1024) throw Error("Maximum file size is 4 MiB. Split the file or enter parts manually.");
    const body = new FormData(); body.append("consent", "true"); body.append("file", file);
    const data = await request("/api/quote/indent/parse", body, token, true);
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 500) throw Error("No complete item list was returned. Try manual entry.");
    setItems(data.items.map((i: any) => ({ part_number: i.part_number || "", description: i.description || "",
      qty: i.qty == null ? "" : String(i.qty), needs_review: i.needs_review })));
    setNotice("Extracted items are a draft. Check every part number, name and quantity before continuing.");
  });
  const submit = () => run(async () => {
    if (!validItems || !token) throw Error("Check your items and verify your email before submitting.");
    const data = await request("/api/quote/submit", { ...contact, email: contact.email.trim().toLowerCase(),
      request_key: key, delivery_location: delivery, notes, timeframe,
      cart: items.map(i => ({ part_number: i.part_number.trim(), description: i.description.trim(), qty: Number(i.qty) })) }, token);
    if (!data.reference) throw Error("No request reference was returned. Retry this unchanged request.");
    setResult(data); go(4);
  });
  return <div className="bg-slate-50 text-slate-900 min-h-screen">
    <SeoHead title="Get a spare parts quotation | Trucks, buses and equipment | Narmada Mobility"
      description="Verify your email, upload an indent or enter parts manually, review quantities and request pricing for commercial vehicle and construction equipment parts." />
    <article className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <header className="max-w-3xl mb-8">
        <p className="text-sm font-semibold text-cyan-800 uppercase tracking-wider mb-3">Parts enquiry desk</p>
        <h1 className="text-3xl font-bold tracking-tight">Get a spare parts quotation</h1>
        <p className="mt-3 text-slate-600">For trucks, buses, tippers, dumpers, trailers and construction equipment.
          Share the parts you need; pricing, fitment and delivery are confirmed in the quotation.</p>
      </header>
      <ol aria-label="Quotation progress" className="flex flex-wrap gap-3 text-sm mb-6">
        {["Contact & verify", "Add parts", "Review & submit", "Reference"].map((label, i) =>
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "font-bold text-cyan-800" : "text-slate-600"}>{i + 1}. {label}</li>)}
      </ol>
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-8" aria-busy={busy}>
        {error && <div role="alert" className="mb-5 rounded-md bg-red-50 text-red-800 p-4 break-words" data-testid="quote-error">
          {error}<p className="mt-2 text-sm">Your draft is retained. If verification expired, return to Contact &amp; verify.</p></div>}
        {notice && <p role="status" className="mb-5 bg-cyan-50 text-cyan-900 p-4 rounded-md">{notice}</p>}
        {step === 1 && <div data-testid="quote-contact">
          <h2 className="text-xl font-semibold mb-5">Your details and email verification</h2>
          <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-5">
            {([["company_name", "Company"], ["contact_name", "Contact name"], ["mobile", "Mobile number"], ["email", "Email address"]] as const).map(([name, label]) =>
              <label key={name} className="block text-sm font-medium">{label}<Input className="mt-2" value={contact[name]}
                type={name === "email" ? "email" : "text"} inputMode={name === "mobile" ? "tel" : undefined}
                maxLength={name === "contact_name" ? 100 : name === "mobile" ? 15 : 200}
                onChange={e => changeContact(name, name === "mobile" ? e.target.value.replace(/\D/g, "") : e.target.value)}
                data-testid={`quote-${name}`} /></label>)}
            <label className="block text-sm font-medium">Country<select value={contact.country} className="mt-2 w-full border rounded-md p-3 bg-white"
              onChange={e => { const c = findCountry(e.target.value); if (c) setContact(v => ({ ...v, country: c.code, currency: c.currency, country_code: c.dial })); }} data-testid="quote-country">
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
            <label className="block text-sm font-medium">Phone country code<Input value={contact.country_code} maxLength={6} className="mt-2"
              onChange={e => changeContact("country_code", e.target.value)} data-testid="quote-dial" /></label>
          </fieldset>
          <div className="mt-6 flex flex-wrap gap-3 items-end">
            {!token && <Button onClick={send} disabled={busy || !validContact} data-testid="quote-send-otp">{sentTo ? "Resend code" : "Send email code"}</Button>}
            {sentTo && !token && <><label className="text-sm font-medium">Six-digit email code<Input inputMode="numeric" autoComplete="one-time-code"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy} className="mt-2 max-w-48" data-testid="quote-otp" /></label>
              <Button onClick={verify} disabled={busy || !validContact || code.length !== 6} data-testid="quote-verify">Verify email</Button></>}
            {token && <><p className="text-emerald-800 font-medium">Email verified</p>
              <Button variant="outline" disabled={busy} onClick={() => { setToken(""); setSentTo(""); setCode(""); }} data-testid="quote-reverify">Re-verify email</Button>
              <Button onClick={() => go(2)} disabled={busy || !validContact} data-testid="quote-next">Continue</Button></>}
          </div>
          <p className="text-sm text-slate-600 mt-5">By verifying your email, you share your contact details with Narmada Mobility for follow-up,
            even if you do not finish the quotation. Verification remains valid for 30 minutes.
            Changing your email requires a new code.</p>
        </div>}
        {step === 2 && <div data-testid="quote-parts">
          <h2 className="text-xl font-semibold mb-5">How would you like to add parts?</h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <button disabled={busy} onClick={() => setMode("upload")} aria-pressed={mode === "upload"} data-testid="quote-upload-mode"
              className={`text-left border rounded-lg p-5 ${mode === "upload" ? "border-cyan-700 bg-cyan-50" : "border-slate-300"}`}><Upload className="mb-3" /><strong>Upload Indent Copy</strong><span className="block text-sm mt-2">CSV, XLSX, PDF, JPG or PNG</span></button>
            <button disabled={busy} onClick={() => { setMode("manual"); if (!items.length) setItems([blank()]); }} aria-pressed={mode === "manual"} data-testid="quote-manual-mode"
              className={`text-left border rounded-lg p-5 ${mode === "manual" ? "border-cyan-700 bg-cyan-50" : "border-slate-300"}`}><ListPlus className="mb-3" /><strong>Enter Parts Manually</strong><span className="block text-sm mt-2">Part numbers, names and quantities</span></button>
          </div>
          {mode === "upload" && <fieldset disabled={busy} className="space-y-4 mb-6">
            <label className="block text-sm font-medium">Indent file<input type="file" accept=".csv,.xlsx,.pdf,.jpg,.jpeg,.png" className="block mt-2 max-w-full" data-testid="quote-file"
              onChange={e => { setFile(e.target.files?.[0] || null); setError(""); }} /></label>
            <p className="text-sm text-slate-600">Up to 4 MiB, 500 items, 5 PDF pages or 20 megapixels. XLSX uses the first worksheet.
              CSV must be UTF-8. Suggested headers: part_number, description, quantity. Reading a new file replaces the current draft only after successful extraction.</p>
            <label className="flex gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="quote-consent" />Uploaded documents may be processed by our document-reading service. Review all extracted items before submission.</label>
            <p className="text-sm text-slate-600">PDFs and images are sent to Anthropic for extraction. CSV and XLSX are processed on our server.
              Remove confidential or unnecessary information before uploading. You can enter parts manually instead.</p>
            <Button onClick={parse} disabled={busy || !file || !consent} data-testid="quote-parse">Read indent</Button>
          </fieldset>}
          {!!items.length && <div className="space-y-4">
            <p className="text-sm text-slate-600">Review every row. Leave an unknown part number blank and provide its name. Quantities must be whole numbers from 1 to 9999.</p>
            {items.map((item, index) => <fieldset key={index} disabled={busy} className="grid sm:grid-cols-[1fr_2fr_100px_44px] gap-3 border-b pb-4" data-testid={`quote-row-${index}`}>
              <label className="text-sm">Part number<Input value={item.part_number} maxLength={100} className="mt-1 font-mono" data-testid={`quote-part-${index}`}
                onChange={e => setItems(v => v.map((r, i) => i === index ? { ...r, part_number: e.target.value } : r))} /></label>
              <label className="text-sm">Part name / description<Input value={item.description} maxLength={500} className="mt-1" data-testid={`quote-name-${index}`}
                onChange={e => setItems(v => v.map((r, i) => i === index ? { ...r, description: e.target.value } : r))} /></label>
              <label className="text-sm">Quantity<Input inputMode="numeric" value={item.qty} maxLength={4} className="mt-1" data-testid={`quote-qty-${index}`}
                onChange={e => setItems(v => v.map((r, i) => i === index ? { ...r, qty: e.target.value } : r))} /></label>
              <Button variant="outline" className="sm:mt-6 min-h-11" aria-label={`Remove row ${index + 1}`} onClick={() => setItems(v => v.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></Button>
              {item.needs_review && <p className="text-sm text-amber-800 sm:col-span-4">Source fields may be missing or uncertain. Please check this row.</p>}
            </fieldset>)}
          </div>}
          {mode && <Button variant="outline" className="mt-5" disabled={busy || items.length >= 500} onClick={() => setItems(v => [...v, blank()])} data-testid="quote-add-row">Add a row</Button>}
          <div className="flex justify-between gap-4 mt-8"><Button variant="outline" disabled={busy} onClick={() => go(1)}>Contact &amp; verify</Button>
            <Button disabled={busy || !validItems} onClick={() => go(3)} data-testid="quote-review">Review enquiry</Button></div>
        </div>}
        {step === 3 && <div data-testid="quote-review-panel">
          <h2 className="text-xl font-semibold mb-4">Review and submit</h2>
          <p className="text-slate-600 break-words">{contact.company_name} · {contact.contact_name} · {contact.email}</p>
          <ul className="divide-y my-5">{items.map((i, n) => <li key={n} className="py-3 break-words"><span className="font-mono">{i.part_number || "Part number not supplied"}</span> · {i.description} · Quantity {i.qty}</li>)}</ul>
          <DestinationPicker value={delivery} onChange={setDelivery} disabled={busy} />
          <label className="block text-sm font-medium mt-5">Required timeframe<select disabled={busy} value={timeframe} onChange={e => setTimeframe(e.target.value)} className="block w-full mt-2 p-3 border rounded-md bg-white">
            <option value="immediate">Immediate enquiry</option><option value="one_week">Within one week</option><option value="one_month">Within one month</option><option value="later">Planning for later</option>
          </select></label>
          <label className="block text-sm font-medium mt-5">Notes, vehicle details or delivery instructions<textarea disabled={busy} value={notes} maxLength={2000}
            onChange={e => setNotes(e.target.value)} className="block w-full mt-2 p-3 border rounded-md" rows={4} data-testid="quote-notes" /></label>
          <p className="text-sm text-slate-600 my-5">Submission saves your enquiry and sends it to anand@narmadamotors.in and sales@narmadamobility.com.
            This is a request for a quotation, not an order or a guarantee of stock, fitment, price or delivery.</p>
          <div className="flex justify-between gap-4"><Button variant="outline" disabled={busy} onClick={() => go(2)}>Edit parts</Button>
            <Button disabled={busy || !validItems} onClick={submit} data-testid="quote-submit">Submit enquiry</Button></div>
        </div>}
        {step === 4 && result && <div data-testid="quote-success">
          <h2 className="text-xl font-semibold">Your enquiry is saved</h2>
          <p className="font-mono text-lg my-4" data-testid="quote-reference">{result.reference}</p>
          <p>{result.notification?.state === "sent" ? "Both sales email notifications were accepted by the email service. Inbox delivery is not guaranteed." :
            "Email delivery is not yet confirmed for both recipients. Your saved enquiry reference remains valid."}</p>
          {result.notification?.recipients?.map((r: any) => <p className="text-sm mt-3 break-words" key={r.recipient}>{r.recipient}: {r.state === "unknown" ? "delivery uncertain; contact sales before sending again" : r.state}</p>)}
          <div className="flex flex-wrap gap-3 mt-6">
            <Button variant="outline" disabled={busy} onClick={() => run(async () => setResult(await request(`/api/quote/${encodeURIComponent(result.reference)}/status`, undefined, token)))} data-testid="quote-status">Check email status</Button>
            {result.notification?.retryable && <Button disabled={busy} onClick={() => run(async () => setResult(await request(`/api/quote/${encodeURIComponent(result.reference)}/notification-retry`, {}, token)))} data-testid="quote-retry-email">Retry unsent notifications</Button>}
            <a href="/get-quote" className="underline p-3">Start another enquiry</a>
          </div>
          <p className="text-sm mt-5">Retries are limited to three attempts, at least one minute apart. An uncertain send is not repeated automatically.</p>
        </div>}
        {busy && <p role="status" className="mt-5 inline-flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Processing. Keep this page open.</p>}
      </section>
      {step === 1 && <QuoteGuide onDestination={v => { setDelivery(v); setNotice(`Delivery enquiry destination selected: ${v}`); document.querySelector("main")?.scrollIntoView(); }} />}
    </article>
  </div>;
}
