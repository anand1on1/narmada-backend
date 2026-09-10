// R28.2 — Get-Quotation 5-step wizard (public).
//
//   Step 1  contact form  (company, contact name, email, country, currency, phone)
//   Step 2  OTP entry     (6 digits, resend, change email)
//   Step 3  parts + cart  (search /api/parts/search → add to local wizard cart)
//   Step 4  order details (timeframe radio, delivery, notes)
//   Step 5  success       (reference number, WhatsApp deep link)
//
// State is kept in React (component-local) only — no localStorage — per user
// spec. The verification token from step 2 is required for step 5's submit.
// Step is driven by internal state; on step 5 we blow away all wizard state
// via the "Start a new quote" button.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { COUNTRIES, CURRENCIES, DIAL_CODES, findCountry } from "@/data/countries";
import { formatINR } from "@/lib/r28-utils";
import { Search, Plus, Minus, Trash2, MessageCircle, Loader2 } from "lucide-react";

const WHATSAPP = "917909083806";

interface Contact {
  company_name: string;
  contact_name: string;
  email: string;
  country: string;     // ISO code
  currency: string;    // ISO 4217
  country_code: string; // dial code (+91)
  mobile: string;
}
interface WizardCartItem {
  part_id?: number;
  part_number: string;
  description: string;
  chassis_slug?: string | null;
  chassis_display_name?: string | null;
  sell_price?: number | null;
  qty: number;
}

const EMPTY_CONTACT: Contact = {
  company_name: "",
  contact_name: "",
  email: "",
  country: "IN",
  currency: "INR",
  country_code: "+91",
  mobile: "",
};

export default function GetQuote() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [otpToken, setOtpToken] = useState<string>("");
  const [cart, setCart] = useState<WizardCartItem[]>([]);
  const [timeframe, setTimeframe] = useState<"immediate" | "one_week" | "one_month" | "three_months" | "later">("immediate");
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");

  const resetWizard = () => {
    setStep(1);
    setContact(EMPTY_CONTACT);
    setOtpToken("");
    setCart([]);
    setTimeframe("immediate");
    setDelivery("");
    setNotes("");
    setReference("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="text-center mb-6">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono uppercase mb-3">R28.2 · Get Quotation</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Request a formal quotation</h1>
          <p className="text-slate-600 mt-2 text-sm sm:text-base">Verified email · secure form · sales team responds within 24 hours.</p>
        </div>

        <StepIndicator current={step} />

        {step === 1 && <Step1Contact contact={contact} onContact={setContact} onNext={() => setStep(2)} />}
        {step === 2 && (
          <Step2Otp
            email={contact.email}
            onBack={() => setStep(1)}
            onVerified={(tok) => { setOtpToken(tok); setStep(3); }}
          />
        )}
        {step === 3 && (
          <Step3Parts
            cart={cart}
            onCart={setCart}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            currency={contact.currency}
          />
        )}
        {step === 4 && (
          <Step4Details
            cart={cart}
            contact={contact}
            timeframe={timeframe}
            delivery={delivery}
            notes={notes}
            otpToken={otpToken}
            onTimeframe={setTimeframe}
            onDelivery={setDelivery}
            onNotes={setNotes}
            onBack={() => setStep(3)}
            onSuccess={(ref) => { setReference(ref); setStep(5); }}
          />
        )}
        {step === 5 && (
          <Step5Success
            reference={reference}
            contact={contact}
            onReset={resetWizard}
          />
        )}
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  const labels = ["Contact", "Verify email", "Parts", "Details", "Done"];
  return (
    <ol className="flex items-center justify-center gap-1 sm:gap-2 mb-6 text-[11px] sm:text-xs font-mono" aria-label="Wizard progress">
      {labels.map((label, i) => {
        const idx = i + 1;
        const active = current === idx;
        const done = current > idx;
        return (
          <li key={label} className="flex items-center gap-1 sm:gap-2">
            <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold ${
              done ? "bg-emerald-500 text-white"
              : active ? "bg-indigo-600 text-white"
              : "bg-slate-200 text-slate-500"
            }`} data-testid={`step-dot-${idx}`}>{idx}</span>
            <span className={`uppercase tracking-wider ${active ? "text-indigo-700" : done ? "text-emerald-700" : "text-slate-400"}`}>{label}</span>
            {idx < labels.length && <span className="text-slate-300">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------- Step 1 */
function Step1Contact({ contact, onContact, onNext }: { contact: Contact; onContact: (c: Contact) => void; onNext: () => void }) {
  const [sending, setSending] = useState(false);

  // Update dial code + currency when country changes.
  const onCountryChange = (code: string) => {
    const c = findCountry(code);
    if (!c) return onContact({ ...contact, country: code });
    onContact({ ...contact, country: code, currency: c.currency, country_code: c.dial });
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email);
  const mobileValid = /^\d{6,15}$/.test(contact.mobile);
  const canProceed = contact.company_name.trim() && contact.contact_name.trim() && emailValid && mobileValid && contact.country_code;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canProceed || sending) return;
    setSending(true);
    try {
      const r = await apiRequest("POST", "/api/quote/otp/send", { email: contact.email.trim().toLowerCase() });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Failed to send OTP");
      toast({ title: "OTP sent", description: `Check ${contact.email} for the 6-digit code.` });
      onNext();
    } catch (e: any) {
      toast({ title: "Could not send OTP", description: e?.message || String(e), variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 space-y-4" data-testid="step-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Company name">
          <Input value={contact.company_name} onChange={(e) => onContact({ ...contact, company_name: e.target.value })} data-testid="input-company" required />
        </Field>
        <Field label="Contact name">
          <Input value={contact.contact_name} onChange={(e) => onContact({ ...contact, contact_name: e.target.value })} data-testid="input-name" required />
        </Field>
        <Field label="Email" full>
          <Input type="email" value={contact.email} onChange={(e) => onContact({ ...contact, email: e.target.value })} data-testid="input-email" required />
          {!emailValid && contact.email.length > 0 && <p className="text-xs text-red-600 mt-1">Please enter a valid email.</p>}
        </Field>
        <Field label="Country">
          <select value={contact.country} onChange={(e) => onCountryChange(e.target.value)} className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm bg-white" data-testid="select-country">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select value={contact.currency} onChange={(e) => onContact({ ...contact, currency: e.target.value })} className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm bg-white" data-testid="select-currency">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Country code">
          <select value={contact.country_code} onChange={(e) => onContact({ ...contact, country_code: e.target.value })} className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm bg-white" data-testid="select-dial">
            {DIAL_CODES.map((d) => <option key={d.dial} value={d.dial}>{d.dial}</option>)}
          </select>
        </Field>
        <Field label="Mobile">
          <Input inputMode="tel" value={contact.mobile} onChange={(e) => onContact({ ...contact, mobile: e.target.value.replace(/\D/g, "") })} placeholder="6–15 digits" data-testid="input-mobile" required />
          {!mobileValid && contact.mobile.length > 0 && <p className="text-xs text-red-600 mt-1">Mobile must be 6–15 digits.</p>}
        </Field>
      </div>
      <div className="pt-2 flex justify-end">
        <Button type="submit" size="lg" disabled={!canProceed || sending} data-testid="btn-send-otp">
          {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Send verification code
        </Button>
      </div>
    </form>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs uppercase text-slate-500 mb-1.5 font-mono">{label}</label>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- Step 2 */
function Step2Otp({ email, onBack, onVerified }: { email: string; onBack: () => void; onVerified: (tok: string) => void }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const code = digits.join("");

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits]; next[i] = d; setDigits(next);
    // auto-focus next
    if (d) {
      const nextEl = document.getElementById(`otp-${i + 1}`);
      if (nextEl) (nextEl as HTMLInputElement).focus();
    }
  };
  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      const prev = document.getElementById(`otp-${i - 1}`);
      if (prev) (prev as HTMLInputElement).focus();
    }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    try {
      const r = await apiRequest("POST", "/api/quote/otp/verify", { email: email.trim().toLowerCase(), code });
      const data = await r.json();
      const tok = data.verification_token || data.token;
      if (!data.ok || !tok) throw new Error(data.error || "Invalid code");
      onVerified(tok);
    } catch (e: any) {
      toast({ title: "Verification failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setVerifying(false); }
  };

  const resend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const r = await apiRequest("POST", "/api/quote/otp/send", { email: email.trim().toLowerCase() });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Failed");
      toast({ title: "OTP re-sent", description: `Check ${email} again.` });
    } catch (e: any) {
      toast({ title: "Could not resend", description: e?.message || String(e), variant: "destructive" });
    } finally { setResending(false); }
  };

  return (
    <form onSubmit={verify} className="bg-white rounded-2xl shadow-sm border p-6 sm:p-8 text-center space-y-5" data-testid="step-2">
      <div>
        <div className="text-xs uppercase text-slate-500 font-mono mb-1">Step 2 — Verify email</div>
        <div className="text-lg font-semibold text-slate-900">We sent a 6-digit code to</div>
        <div className="text-base text-indigo-700 font-mono">{email}</div>
      </div>
      <div className="flex justify-center gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            id={`otp-${i}`}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            className="w-11 h-14 sm:w-12 sm:h-14 text-center text-lg font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            data-testid={`otp-${i}`}
          />
        ))}
      </div>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button type="submit" size="lg" disabled={code.length !== 6 || verifying} data-testid="btn-verify">
          {verifying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Verify
        </Button>
        <Button type="button" variant="outline" onClick={resend} disabled={resending} data-testid="btn-resend">Resend code</Button>
        <Button type="button" variant="ghost" onClick={onBack} data-testid="btn-change-email">Change email</Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- Step 3 */
function Step3Parts({ cart, onCart, onBack, onNext, currency }: { cart: WizardCartItem[]; onCart: (c: WizardCartItem[]) => void; onBack: () => void; onNext: () => void; currency: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualPn, setManualPn] = useState("");
  const [manualDesc, setManualDesc] = useState("");

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const s = q.trim();
    if (s.length < 2) return;
    setLoading(true);
    try {
      const r = await apiRequest("GET", `/api/parts/search?q=${encodeURIComponent(s)}&limit=25`);
      const data = await r.json();
      setResults(data.results || []);
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  const add = (row: any) => {
    const existing = cart.find((c) => c.part_number === row.part_number && c.chassis_slug === row.fits_chassis?.slug);
    if (existing) {
      onCart(cart.map((c) => c === existing ? { ...c, qty: c.qty + 1 } : c));
    } else {
      onCart([...cart, {
        part_id: row.part_id,
        part_number: row.part_number,
        description: row.description || "",
        chassis_slug: row.fits_chassis?.slug || null,
        chassis_display_name: row.fits_chassis?.display_name || null,
        sell_price: row.sell_price,
        qty: 1,
      }]);
    }
  };

  const addManual = () => {
    const pn = manualPn.trim(); const desc = manualDesc.trim();
    if (!pn) return;
    onCart([...cart, { part_number: pn, description: desc, qty: 1, sell_price: null, chassis_slug: null, chassis_display_name: null }]);
    setManualPn(""); setManualDesc("");
  };
  const setQty = (i: number, qty: number) => onCart(cart.map((c, idx) => idx === i ? { ...c, qty: Math.max(1, qty) } : c));
  const remove = (i: number) => onCart(cart.filter((_, idx) => idx !== i));

  const subtotal = cart.reduce((s, c) => s + (Number(c.sell_price) || 0) * c.qty, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4" data-testid="step-3">
      {/* Search panel */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6">
        <form onSubmit={search} className="mb-4">
          <label className="block text-xs uppercase text-slate-500 mb-2 font-mono">Search parts to add</label>
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part number, OEM or description" className="flex-1 h-11 font-mono" data-testid="input-part-search" />
            <Button type="submit" className="h-11" disabled={loading || q.trim().length < 2} data-testid="btn-part-search">
              <Search className="w-4 h-4 mr-2" /> {loading ? "…" : "Search"}
            </Button>
          </div>
        </form>

        <div className="space-y-2 max-h-[480px] overflow-y-auto">
          {results.map((row) => (
            <div key={row.part_id} className="border rounded-lg p-3 flex items-center gap-3 hover:border-indigo-300 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-semibold text-slate-900 truncate">{row.part_number}</div>
                <div className="text-xs text-slate-600 truncate">{row.description}</div>
                {row.fits_chassis && <div className="text-[10px] text-indigo-600 font-mono uppercase mt-0.5">fits {row.fits_chassis.display_name}</div>}
              </div>
              {row.sell_price != null && row.sell_price > 0 && (
                <div className="text-sm text-slate-900 font-semibold whitespace-nowrap">{formatINR(row.sell_price)}</div>
              )}
              <Button size="sm" onClick={() => add(row)} data-testid={`btn-add-${row.part_id}`}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {!loading && q.trim().length >= 2 && results.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-4">
              No matches — add it manually below.
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t space-y-2">
          <div className="text-xs uppercase text-slate-500 font-mono">Or add a part manually</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={manualPn} onChange={(e) => setManualPn(e.target.value)} placeholder="Part number" className="font-mono" data-testid="input-manual-pn" />
            <Input value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder="Description (optional)" data-testid="input-manual-desc" />
            <Button type="button" onClick={addManual} disabled={!manualPn.trim()} data-testid="btn-manual-add">Add</Button>
          </div>
        </div>
      </div>

      {/* Cart panel */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 self-start lg:sticky lg:top-24">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-slate-900">Your cart</div>
          <div className="text-xs text-slate-500">{cart.length} item{cart.length === 1 ? "" : "s"}</div>
        </div>
        {cart.length === 0 && <div className="text-sm text-slate-500 py-4">No parts yet.</div>}
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {cart.map((c, i) => (
            <div key={i} className="border rounded-lg p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold truncate">{c.part_number}</div>
                  {c.description && <div className="text-[11px] text-slate-600 truncate">{c.description}</div>}
                  {c.chassis_display_name && <div className="text-[10px] text-indigo-600 font-mono truncate">{c.chassis_display_name}</div>}
                </div>
                <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-600" data-testid={`cart-remove-${i}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="inline-flex items-center border rounded-md">
                  <button onClick={() => setQty(i, c.qty - 1)} className="px-2 py-1 text-slate-600 hover:bg-slate-100" data-testid={`cart-minus-${i}`}><Minus className="w-3 h-3" /></button>
                  <span className="px-2 text-xs font-mono w-8 text-center">{c.qty}</span>
                  <button onClick={() => setQty(i, c.qty + 1)} className="px-2 py-1 text-slate-600 hover:bg-slate-100" data-testid={`cart-plus-${i}`}><Plus className="w-3 h-3" /></button>
                </div>
                {c.sell_price != null && c.sell_price > 0 && (
                  <div className="text-xs font-semibold text-slate-900">{formatINR(c.sell_price * c.qty)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {subtotal > 0 && (
          <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
            <span className="text-slate-600">Est. subtotal ({currency === "INR" ? "INR" : currency})</span>
            <span className="font-semibold text-slate-900">{formatINR(subtotal)}</span>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onBack} className="flex-1" data-testid="btn-back-2">Back</Button>
          <Button onClick={onNext} disabled={cart.length === 0} className="flex-1" data-testid="btn-next-4">Next</Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Step 4 */
function Step4Details({ cart, contact, timeframe, delivery, notes, otpToken, onTimeframe, onDelivery, onNotes, onBack, onSuccess }: {
  cart: WizardCartItem[];
  contact: Contact;
  timeframe: string;
  delivery: string;
  notes: string;
  otpToken: string;
  onTimeframe: (v: any) => void;
  onDelivery: (v: string) => void;
  onNotes: (v: string) => void;
  onBack: () => void;
  onSuccess: (ref: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const notesLeft = 2000 - notes.length;
  const TIMEFRAMES: { id: string; label: string }[] = [
    { id: "immediate", label: "Immediate (0–7 days)" },
    { id: "one_week", label: "Within 1 week" },
    { id: "one_month", label: "Within 1 month" },
    { id: "three_months", label: "Within 3 months" },
    { id: "later", label: "Later / planning" },
  ];
  const total = useMemo(() => cart.reduce((s, c) => s + (Number(c.sell_price) || 0) * c.qty, 0), [cart]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (notes.length > 2000) return toast({ title: "Notes too long", description: "Max 2000 characters.", variant: "destructive" });
    setSubmitting(true);
    try {
      // NOTE: server expects the verification token in the x-quote-token
      // HEADER (not the JSON body). apiRequest can't add custom headers so
      // fetch directly here.
      const body = {
        email: contact.email.trim().toLowerCase(),
        company_name: contact.company_name,
        contact_name: contact.contact_name,
        country: contact.country,
        currency: contact.currency,
        country_code: contact.country_code,
        mobile: contact.mobile,
        timeframe,
        delivery_location: delivery,
        notes,
        cart: cart.map((c) => ({
          part_number: c.part_number,
          description: c.description,
          chassis_slug: c.chassis_slug || null,
          qty: c.qty,
        })),
      };
      const r = await fetch("/api/quote/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-quote-token": otpToken,
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.ok || !data.reference) throw new Error(data.error || "Submission failed");
      onSuccess(data.reference);
    } catch (e: any) {
      toast({ title: "Submission failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border p-4 sm:p-6 space-y-5" data-testid="step-4">
      <div>
        <div className="text-xs uppercase text-slate-500 font-mono mb-2">Cart summary</div>
        <div className="rounded-lg border divide-y">
          {cart.map((c, i) => (
            <div key={i} className="p-2.5 flex items-center justify-between text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-semibold truncate">{c.part_number}</div>
                <div className="text-xs text-slate-600 truncate">{c.description}</div>
              </div>
              <div className="text-xs text-slate-500 font-mono">× {c.qty}</div>
            </div>
          ))}
        </div>
        {total > 0 && <div className="text-xs text-slate-500 mt-1 text-right">Est. subtotal: <span className="font-semibold text-slate-800">{formatINR(total)}</span></div>}
      </div>

      <div>
        <div className="text-xs uppercase text-slate-500 font-mono mb-2">When do you need it?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TIMEFRAMES.map((t) => (
            <label key={t.id} className={`flex items-center gap-2 border rounded-lg p-3 text-sm cursor-pointer ${
              timeframe === t.id ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
            }`}>
              <input type="radio" name="tf" checked={timeframe === t.id} onChange={() => onTimeframe(t.id)} data-testid={`tf-${t.id}`} />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <Field label="Delivery location">
        <Input value={delivery} onChange={(e) => onDelivery(e.target.value)} placeholder="City, port, or full address" data-testid="input-delivery" />
      </Field>

      <div>
        <label className="block text-xs uppercase text-slate-500 mb-1.5 font-mono">Notes (optional, max 2000 chars)</label>
        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          className="w-full rounded-md border border-slate-300 p-3 text-sm font-sans"
          placeholder="Additional context, special packing, payment terms…"
          data-testid="input-notes"
        />
        <div className={`text-[11px] mt-1 text-right ${notesLeft < 100 ? "text-amber-600" : "text-slate-400"}`}>{notesLeft} chars remaining</div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onBack} data-testid="btn-back-3">Back</Button>
        <Button type="submit" size="lg" disabled={submitting} data-testid="btn-submit">
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Submit request
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- Step 5 */
function Step5Success({ reference, contact, onReset }: { reference: string; contact: Contact; onReset: () => void }) {
  const waMsg = `Hi Narmada Mobility, tracking my quote reference ${reference}.`;
  const waHref = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(waMsg)}`;
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-8 text-center space-y-5" data-testid="step-5">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-emerald-100 text-emerald-700 mx-auto">✓</div>
      <div>
        <div className="text-lg font-semibold text-slate-900">Request received</div>
        <div className="text-sm text-slate-600 mt-1">Our sales team will respond to <span className="font-mono">{contact.email}</span> within 24 hours.</div>
      </div>
      <div className="rounded-lg bg-slate-50 border p-4 inline-block">
        <div className="text-xs uppercase text-slate-500 font-mono mb-1">Your reference</div>
        <div className="text-xl font-mono font-bold text-slate-900" data-testid="quote-reference">{reference}</div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
        <Button variant="outline" onClick={onReset} data-testid="btn-new-quote">Start a new quote</Button>
        <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1da851] text-white px-4 py-2 rounded-md text-sm font-semibold" data-testid="btn-wa-track">
          <MessageCircle className="w-4 h-4" /> Track on WhatsApp
        </a>
      </div>
      <div className="text-xs text-slate-500 pt-3">
        Need to browse more parts? <Link href="/find-parts"><a className="text-indigo-600 hover:underline">Back to Find Parts</a></Link>
      </div>
    </div>
  );
}
