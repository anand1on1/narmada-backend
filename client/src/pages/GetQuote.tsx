// R28.3 — Get-Quotation 5-step wizard (public). Full Step-3 redesign per user
// feedback ("shitiest ui" screenshot review). Layout for Step 3 is now:
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ Wizard stepper (5 pills)                                             │
//   │ Step title "Add parts to your quote"                                 │
//   ├────────────────────────┬─────────────────────────────────────────────┤
//   │ LEFT 30% sticky cart   │ RIGHT 70% FindPartsEmbed (4 tabs)           │
//   │  header + qty +/-      │  Registration | Chassis | Model | Part #    │
//   │  empty state           │  results grid + Add-to-quote per card        │
//   │  trash icon per row    │  collapsible "Don't see your part?" below   │
//   ├────────────────────────┴─────────────────────────────────────────────┤
//   │  [Back]                                                    [Continue]│
//   └──────────────────────────────────────────────────────────────────────┘
//
// Mobile: single column. The cart becomes a bottom Sheet drawer; a floating
// "🛒 View cart (N)" button on the bottom-right opens it. Continue is inside
// the drawer footer AND below the finder.
//
// Steps 1, 2, 4, 5 are visually upgraded (card shadows, spacing, larger type,
// bigger stepper pills, gradient background) but their flow logic is unchanged.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { COUNTRIES, CURRENCIES, DIAL_CODES, findCountry } from "@/data/countries";
import { formatINR } from "@/lib/r28-utils";
import { Plus, Minus, Trash2, MessageCircle, Loader2, ShoppingCart, ChevronDown, ChevronRight, ArrowRight, Check, ImageOff, ArrowLeft } from "lucide-react";
import { FindPartsEmbed, AddablePart } from "@/components/FindPartsEmbed";

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
export interface WizardCartItem {
  part_id?: number;
  part_number: string;
  oem_number?: string | null;
  description: string;
  image_url?: string | null;
  image_source?: string | null;
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto py-8 md:py-12 px-4 sm:px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-mono uppercase mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-pulse" /> Formal Quotation
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Request a formal quotation</h1>
          <p className="text-slate-600 mt-2 text-base">Verified email · secure form · sales team responds within 24 hours.</p>
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

/* ─────────────────────────────────────────────────────────── Stepper (bigger) */
function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  const labels = ["Contact", "Verify", "Parts", "Details", "Done"];
  return (
    <ol className="flex items-center justify-center gap-1 sm:gap-2 mb-8 flex-wrap" aria-label="Wizard progress">
      {labels.map((label, i) => {
        const idx = i + 1;
        const active = current === idx;
        const done = current > idx;
        return (
          <li key={label} className="flex items-center gap-1 sm:gap-2">
            <span
              className={`inline-flex items-center justify-center h-8 min-w-[2rem] px-4 rounded-full text-xs font-bold gap-1.5 transition-colors ${
                done ? "bg-emerald-500 text-white"
                : active ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "bg-slate-200 text-slate-500"
              }`}
              data-testid={`step-dot-${idx}`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : <span>{idx}</span>}
              <span className="uppercase tracking-wider text-[11px] hidden sm:inline">{label}</span>
            </span>
            {idx < labels.length && <span className="text-slate-300 hidden sm:inline">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────────────────────────────────────────────── Step 1 */
function Step1Contact({ contact, onContact, onNext }: { contact: Contact; onContact: (c: Contact) => void; onNext: () => void }) {
  const [sending, setSending] = useState(false);

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
    <form onSubmit={submit} className="bg-card rounded-xl shadow-md border p-6 md:p-8 space-y-5 max-w-3xl mx-auto" data-testid="step-1">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">Tell us who you are</h2>
        <p className="text-sm text-slate-500 mt-1">We'll send a 6-digit code to your email to verify.</p>
      </div>
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
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </form>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs uppercase text-slate-500 mb-1.5 font-mono tracking-wider">{label}</label>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── Step 2 */
function Step2Otp({ email, onBack, onVerified }: { email: string; onBack: () => void; onVerified: (tok: string) => void }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const code = digits.join("");

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits]; next[i] = d; setDigits(next);
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
    <form onSubmit={verify} className="bg-card rounded-xl shadow-md border p-6 md:p-8 text-center space-y-6 max-w-xl mx-auto" data-testid="step-2">
      <div>
        <div className="text-xs uppercase text-slate-500 font-mono tracking-wider mb-2">Step 2 — Verify email</div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">We sent a 6-digit code to</h2>
        <div className="text-base text-indigo-700 font-mono mt-1">{email}</div>
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

/* ─────────────────────────────────────────────────────────────────── Step 3 */
function Step3Parts({ cart, onCart, onBack, onNext }: { cart: WizardCartItem[]; onCart: (c: WizardCartItem[]) => void; onBack: () => void; onNext: () => void }) {
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const addedPartIds = useMemo(() => {
    const s = new Set<number>();
    cart.forEach((c) => { if (c.part_id != null) s.add(c.part_id); });
    return s;
  }, [cart]);

  const handleAdd = (p: AddablePart) => {
    // Match on part_number + chassis_slug so a single part_number can appear
    // twice if it fits two different chassis models.
    const key = (c: WizardCartItem) => `${c.part_number}::${c.chassis_slug || ""}`;
    const incomingKey = `${p.part_number}::${p.fits_chassis?.slug || ""}`;
    const existing = cart.find((c) => key(c) === incomingKey);
    if (existing) {
      onCart(cart.map((c) => c === existing ? { ...c, qty: c.qty + 1 } : c));
    } else {
      onCart([...cart, {
        part_id: p.part_id,
        part_number: p.part_number,
        oem_number: p.oem_number || null,
        description: p.description || "",
        image_url: p.image_url || null,
        image_source: p.image_source || null,
        chassis_slug: p.fits_chassis?.slug || null,
        chassis_display_name: p.fits_chassis?.display_name || null,
        sell_price: p.sell_price ?? null,
        qty: 1,
      }]);
    }
    toast({ title: "Added to your quote", description: `${p.part_number}${p.description ? " — " + p.description : ""}` });
  };

  const addManual = (pn: string, desc: string) => {
    onCart([...cart, {
      part_number: pn,
      description: desc,
      image_source: "manual",
      qty: 1,
      sell_price: null,
      chassis_slug: null,
      chassis_display_name: null,
    }]);
  };
  const setQty = (i: number, qty: number) => onCart(cart.map((c, idx) => idx === i ? { ...c, qty: Math.max(1, qty) } : c));
  const remove = (i: number) => onCart(cart.filter((_, idx) => idx !== i));

  const totalItems = cart.reduce((s, c) => s + c.qty, 0);

  return (
    <div data-testid="step-3">
      <div className="mb-6 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-900">Add parts to your quote</h2>
        <p className="text-slate-600 mt-2 text-base">Use any of the four tabs — Registration, Chassis Number, Model, or Part Number — to find parts, then add them to your quote.</p>
      </div>

      {/* ── 2-column layout: LEFT 30% cart, RIGHT 70% finder */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(320px,26%)_minmax(0,74%)] gap-6">
        {/* LEFT — sticky cart (hidden on mobile; a floating button + Sheet handles mobile) */}
        <aside className="hidden md:block">
          <div className="sticky top-24">
            <CartCard cart={cart} onSetQty={setQty} onRemove={remove} />
          </div>
        </aside>

        {/* RIGHT — Find Parts + manual-entry collapsible */}
        <div className="space-y-6 min-w-0">
          {/* R28.4 — finder wrapped in a matching card so the visual boundary
              between cart and finder reads clearly at wide viewports. */}
          <div className="bg-card border shadow-md rounded-xl p-5 md:p-6" data-testid="finder-card">
            <FindPartsEmbed
              initialTab="reg"
              isEmbeddedWizard
              onAddToCart={handleAdd}
              addedPartIds={addedPartIds}
            />
          </div>
          <ManualEntry onAdd={addManual} />
        </div>
      </div>

      {/* ── Bottom action row (full width, below the 2-col grid) */}
      <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <Button variant="outline" size="lg" onClick={onBack} data-testid="btn-back-2">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          disabled={cart.length === 0}
          className="min-w-[200px]"
          data-testid="btn-next-4"
        >
          Continue <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* ── Mobile: floating "View cart (N)" button + Sheet drawer */}
      <button
        type="button"
        onClick={() => setMobileCartOpen(true)}
        className="md:hidden fixed bottom-24 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-indigo-600 text-white px-5 py-3 font-semibold text-sm shadow-lg shadow-indigo-600/40 hover:bg-indigo-700 transition-all"
        data-testid="btn-mobile-cart"
        aria-label={`View cart with ${totalItems} items`}
      >
        <ShoppingCart className="h-4 w-4" />
        View cart ({totalItems})
      </button>
      <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-hidden flex flex-col p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Your Quote ({totalItems} item{totalItems === 1 ? "" : "s"})</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <CartCard cart={cart} onSetQty={setQty} onRemove={remove} embedded />
          </div>
          <div className="border-t p-4 grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setMobileCartOpen(false)} data-testid="btn-mobile-cart-close">Close</Button>
            <Button
              onClick={() => { setMobileCartOpen(false); onNext(); }}
              disabled={cart.length === 0}
              data-testid="btn-mobile-cart-continue"
            >
              Continue <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ─────────────────────────────────────────── Cart card (used desktop + mobile) */
function CartCard({ cart, onSetQty, onRemove, embedded }: { cart: WizardCartItem[]; onSetQty: (i: number, q: number) => void; onRemove: (i: number) => void; embedded?: boolean }) {
  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  return (
    <div
      className={`bg-card rounded-xl border shadow-md p-5 md:p-6 ${embedded ? "" : "max-h-[calc(100vh-8rem)] overflow-y-auto"}`}
      data-testid="cart-card"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-indigo-600" />
          <h3 className="font-bold text-slate-900 text-lg">Your Quote</h3>
          <span
            className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5"
            data-testid="cart-count"
          >
            {totalItems} item{totalItems === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {cart.length === 0 ? (
        <div className="py-8 text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-slate-100 text-slate-400 mb-3">
            <ShoppingCart className="h-7 w-7" />
          </div>
          <div className="text-sm font-medium text-slate-700">Your quote is empty</div>
          <div className="text-xs text-slate-500 mt-1 flex items-center justify-center gap-1">
            Add parts using the finder <ArrowRight className="h-3 w-3" />
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {cart.map((c, i) => (
            <CartLine key={`${c.part_number}-${c.chassis_slug || ""}-${i}`} item={c} idx={i} onSetQty={onSetQty} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {cart.length > 0 && (
        <div className="mt-4 pt-3 border-t text-xs text-slate-500 text-center">
          Prices are shown on the formal quotation you'll receive by email.
        </div>
      )}
    </div>
  );
}

function CartLine({ item, idx, onSetQty, onRemove }: { item: WizardCartItem; idx: number; onSetQty: (i: number, q: number) => void; onRemove: (i: number) => void }) {
  const [imgOk, setImgOk] = useState(!!item.image_url);
  return (
    <li className="flex gap-3 pb-3 border-b border-slate-100 last:border-b-0 last:pb-0" data-testid={`cart-line-${idx}`}>
      <div className="h-16 w-16 rounded bg-slate-100 shrink-0 flex items-center justify-center overflow-hidden">
        {item.image_url && imgOk ? (
          <img src={item.image_url} alt={item.part_number} className="h-full w-full object-contain" onError={() => setImgOk(false)} />
        ) : (
          <ImageOff className="h-4 w-4 text-slate-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs font-bold text-slate-900 truncate">{item.part_number}</div>
        {item.oem_number && <div className="font-mono text-[10px] text-slate-500 truncate">OEM {item.oem_number}</div>}
        {item.description && <div className="text-[11px] text-slate-600 line-clamp-2">{item.description}</div>}
        {item.chassis_display_name && (
          <div className="text-[10px] text-indigo-600 font-mono truncate mt-0.5">{item.chassis_display_name}</div>
        )}
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="inline-flex items-center border rounded-md bg-white">
            <button
              type="button"
              onClick={() => onSetQty(idx, item.qty - 1)}
              className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              disabled={item.qty <= 1}
              aria-label="Decrease quantity"
              data-testid={`cart-minus-${idx}`}
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="px-2 text-xs font-mono w-8 text-center" data-testid={`cart-qty-${idx}`}>{item.qty}</span>
            <button
              type="button"
              onClick={() => onSetQty(idx, item.qty + 1)}
              className="px-2 py-1 text-slate-600 hover:bg-slate-100"
              aria-label="Increase quantity"
              data-testid={`cart-plus-${idx}`}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="text-slate-400 hover:text-red-600 p-1"
            aria-label={`Remove ${item.part_number}`}
            data-testid={`cart-remove-${idx}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ────────────────────────────────── Manual entry collapsible (closed default) */
function ManualEntry({ onAdd }: { onAdd: (pn: string, desc: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pn, setPn] = useState("");
  const [desc, setDesc] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pn.trim();
    if (!cleaned) return;
    onAdd(cleaned, desc.trim());
    setPn(""); setDesc("");
    toast({ title: "Added to your quote", description: cleaned });
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full inline-flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          data-testid="manual-entry-trigger"
        >
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4 text-slate-500" />
            Don't see your part? Add it manually
          </span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form onSubmit={submit} className="mt-3 bg-card rounded-lg border shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase text-slate-500 mb-1 font-mono tracking-wider">Part number *</label>
              <Input value={pn} onChange={(e) => setPn(e.target.value)} placeholder="e.g. 251434100121" className="font-mono" data-testid="input-manual-pn" required />
            </div>
            <div>
              <label className="block text-xs uppercase text-slate-500 mb-1 font-mono tracking-wider">Description</label>
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" data-testid="input-manual-desc" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!pn.trim()} data-testid="btn-manual-add">
              <Plus className="w-4 h-4 mr-2" /> Add to quote
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─────────────────────────────────────────────────────────────────── Step 4 */
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
      const r = await apiRequest("POST", "/api/quote/submit", body, {
        "x-quote-token": otpToken,
      });
      const data = await r.json();
      if (!data.ok || !data.reference) throw new Error(data.error || "Submission failed");
      onSuccess(data.reference);
    } catch (e: any) {
      toast({ title: "Submission failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={submit} className="bg-card rounded-xl shadow-md border p-6 md:p-8 space-y-6 max-w-3xl mx-auto" data-testid="step-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">Order details</h2>
        <p className="text-sm text-slate-500 mt-1">Tell us when you need parts and where to deliver.</p>
      </div>

      <div>
        <div className="text-xs uppercase text-slate-500 font-mono tracking-wider mb-2">Cart summary</div>
        <div className="rounded-lg border divide-y bg-white">
          {cart.map((c, i) => (
            <div key={i} className="p-3 flex items-center justify-between text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-semibold truncate">{c.part_number}</div>
                <div className="text-xs text-slate-600 truncate">{c.description}</div>
              </div>
              <div className="text-xs text-slate-600 font-mono">× {c.qty}</div>
            </div>
          ))}
        </div>
        {total > 0 && <div className="text-xs text-slate-500 mt-1 text-right">Est. subtotal: <span className="font-semibold text-slate-800">{formatINR(total)}</span></div>}
      </div>

      <div>
        <div className="text-xs uppercase text-slate-500 font-mono tracking-wider mb-2">When do you need it?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TIMEFRAMES.map((t) => (
            <label key={t.id} className={`flex items-center gap-2 border rounded-lg p-3 text-sm cursor-pointer transition-colors ${
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
        <label className="block text-xs uppercase text-slate-500 mb-1.5 font-mono tracking-wider">Notes (optional, max 2000 chars)</label>
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

      <div className="flex flex-col-reverse sm:flex-row gap-3 justify-between pt-2 border-t">
        <Button type="button" variant="outline" size="lg" onClick={onBack} data-testid="btn-back-3">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Button type="submit" size="lg" disabled={submitting} data-testid="btn-submit">
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Submit request
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────── Step 5 */
function Step5Success({ reference, contact, onReset }: { reference: string; contact: Contact; onReset: () => void }) {
  const waMsg = `Hi Narmada Mobility, tracking my quote reference ${reference}.`;
  const waHref = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(waMsg)}`;
  return (
    <div className="bg-card rounded-xl shadow-md border p-6 md:p-8 text-center space-y-5 max-w-xl mx-auto" data-testid="step-5">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-100 text-emerald-700 mx-auto">
        <Check className="w-7 h-7" />
      </div>
      <div>
        <div className="text-xl font-bold text-slate-900">Request received</div>
        <div className="text-sm text-slate-600 mt-1">Our sales team will respond to <span className="font-mono">{contact.email}</span> within 24 hours.</div>
      </div>
      <div className="rounded-lg bg-slate-50 border p-4 inline-block">
        <div className="text-xs uppercase text-slate-500 font-mono tracking-wider mb-1">Your reference</div>
        <div className="text-2xl font-mono font-bold text-slate-900" data-testid="quote-reference">{reference}</div>
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
