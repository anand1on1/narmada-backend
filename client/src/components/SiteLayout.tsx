// R28.3 — SiteLayout full rebuild.
//
// Fixes shipped by R28.2:
//   * "Narmada." wordmark overlapped the "Home" link (two competing wordmarks).
//   * "Contact IN INR" ran together with no gap (right cluster crammed).
//   * Ghost "GET QUOTATION" text bled under the utility bar (StickyGetQuote pill).
//   * "N SPARTS" partial letters visible (Logo bleeding under nav).
//
// Structure (per R28.3 spec):
//
//   utility strip .......... h-9  bg-slate-50  text-xs
//   main nav ............... h-16 bg-white     border-b shadow-sm
//     [Logo]  [nav center]  [INR ▾ · 🛒 · Sign In · Request a Quote]
//
// Layout uses CSS grid with explicit column widths (auto | 1fr | auto), so the
// three regions can never overlap regardless of viewport width. Below md the
// center nav is replaced by a hamburger that opens a sheet with all links.
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Phone, Mail, MapPin, MessageCircle, ChevronDown, ShoppingCart, User, Check, MapPinned } from "lucide-react";
import { BRAND_WALL } from "@/data/brands";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { whatsappLink } from "@/lib/utils-app";
import { cartCount, subscribeCart } from "@/lib/cart";
import { getCurrency, setCurrency, subscribeCurrency, loadFxRate, getUsdInr, Currency } from "@/lib/currency";
import { useShopAuth } from "@/lib/shop-auth";

const NAV: { to: string; label: string }[] = [
  { to: "/", label: "Home" },
  { to: "/products", label: "Catalog" },
  // Brands sits between Catalog and Find Parts and is rendered as a dropdown
  // inline (not from this list).
  { to: "/find-parts", label: "Find Parts" },
  { to: "/price-checker", label: "Price Checker" },
  { to: "/blog", label: "Insights" },
  { to: "/about", label: "About" },
  { to: "/work-with-us", label: "Work With Us" },
  { to: "/contact", label: "Contact" },
];

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  // Utility strip and main nav are static height, no scroll-shrink games — the
  // previous "sticky + backdrop-blur + shrink on scroll" combo was contributing
  // to the layout thrash that produced the overlap.
  return (
    <div className="min-h-screen flex flex-col bg-white text-foreground">
      {/* ────────────────────────────────────────────────────── utility strip */}
      <div className="w-full bg-slate-50 border-b border-slate-200 text-slate-600 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-9 grid grid-cols-[1fr_auto] items-center gap-4">
          <div className="hidden md:flex items-center gap-5 min-w-0">
            <span className="inline-flex items-center gap-1.5 truncate">
              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate">J-157, J Sector, Kankarbagh, Patna-800020</span>
            </span>
            <span className="inline-flex items-center gap-1.5 truncate">
              <Mail className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate">sales@Narmadamobility.com</span>
            </span>
          </div>
          <div className="flex items-center gap-4 justify-end">
            <Link href="/track-consignment">
              <a className="hidden md:inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors" data-testid="link-track-top">
                <MapPinned className="h-3 w-3" /> Track Consignment
              </a>
            </Link>
            <Link href="/get-quote">
              <a className="hidden md:inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors" data-testid="link-getquote-top">
                <MessageCircle className="h-3 w-3" /> Get Quotation
              </a>
            </Link>
            <a
              href={whatsappLink("7909083806", "Hello, I'm interested in spare parts.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-emerald-700 transition-colors"
              data-testid="link-whatsapp-top"
            >
              <MessageCircle className="h-3 w-3 text-emerald-600" />
              <span className="hidden md:inline">WhatsApp +91 79090 83806</span>
              <span className="md:hidden">WhatsApp</span>
            </a>
            {/* R28.4 — Currency selector moved out of the main header into the utility
                strip. Rarely used control, and its presence in the right cluster was
                causing "ContaNR" overlap at 1440px viewports. */}
            <span className="hidden md:inline-flex items-center pl-2 border-l border-slate-200">
              <CurrencyPicker compact />
            </span>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────── main nav */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        {/* R28.4 — header container widens to max-w-[1500px] at 2xl so the full
            9-link nav (only shown at 2xl) has room to sit alongside the wordmark
            and utility cluster without clipping "Contact" or "Home". */}
        <div className="max-w-7xl 2xl:max-w-[1500px] mx-auto px-4 sm:px-6 h-16 grid grid-cols-[auto_1fr_auto] items-center gap-x-6">
          {/* logo column ── shrink-0 so it can never grow into the nav */}
          <Link href="/">
            <a className="flex items-center shrink-0" data-testid="link-home-logo" aria-label="Narmada Mobility home">
              <Logo />
            </a>
          </Link>

          {/* center nav (lg and up) ── R28.4:
                • min-w-0 lets the column shrink instead of pushing the edges.
                • justify-center at 2xl (≥1536px) where all 9 links fit comfortably.
                • justify-start at lg/xl so the nav grows to the RIGHT (never eating
                  the logo on the left).
                • Below 2xl we hide the 3 least-critical links (Insights,
                  Work With Us, Price Checker) into the hamburger.
                • Below xl we additionally hide Brands to give breathing room at
                  the 1024–1279px range. */}
          <nav
            className="hidden lg:flex items-center justify-start 2xl:justify-center gap-x-1 min-w-0 overflow-hidden pl-2"
            aria-label="Primary"
          >
            <NavLink to="/" label="Home" />
            <NavLink to="/products" label="Catalog" />
            <span className="hidden xl:inline-flex">
              <BrandsMenu onPickBrand={(slug) => navigate(`/brand/${slug}`)} />
            </span>
            <NavLink to="/find-parts" label="Find Parts" />
            <NavLink to="/price-checker" label="Price Checker" className="hidden 2xl:inline-flex" />
            <NavLink to="/blog" label="Insights" className="hidden 2xl:inline-flex" />
            <NavLink to="/about" label="About" />
            <NavLink to="/work-with-us" label="Work With Us" className="hidden 2xl:inline-flex" />
            <NavLink to="/contact" label="Contact" />
          </nav>

          {/* right cluster ── R28.4: added ml-6 + a vertical divider so the last
              nav link ("Contact") is always separated from the utility cluster.
              Currency picker was moved out to the utility strip. */}
          <div className="flex items-center gap-x-2 sm:gap-x-3 shrink-0 justify-end pl-6 ml-2 border-l border-slate-200">
            <div className="hidden md:flex items-center gap-1">
              <CartIcon />
              <SignInLink />
            </div>
            <Button
              asChild
              size="sm"
              className="hidden md:inline-flex bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
              data-testid="btn-quote"
            >
              <Link href="/get-quote">Request a Quote</Link>
            </Button>

            {/* Mobile: cart icon + hamburger */}
            <div className="md:hidden flex items-center">
              <CartIcon />
            </div>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden text-slate-900"
                  data-testid="btn-mobile-menu"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 bg-white text-slate-900 border-l border-slate-200">
                <div className="mt-6 flex flex-col gap-1">
                  {NAV.map((n) => (
                    <Link key={n.to} href={n.to}>
                      <a
                        onClick={() => setOpen(false)}
                        className="px-3 py-2.5 rounded-md text-sm font-medium hover:bg-slate-100"
                        data-testid={`mobile-link-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {n.label}
                      </a>
                    </Link>
                  ))}
                  <div className="mt-3 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    Brands ({BRAND_WALL.length})
                  </div>
                  <div className="max-h-[40vh] overflow-y-auto pr-1">
                    {BRAND_WALL.map((b) => (
                      <Link key={b.name} href={`/brand/${b.slug}`}>
                        <a
                          onClick={() => setOpen(false)}
                          className="px-3 py-2 rounded-md text-sm font-medium hover:bg-slate-100 flex items-center gap-2.5"
                          data-testid={`mobile-brand-${b.slug}`}
                        >
                          <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                          <span className="flex-1">{b.name}</span>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                            {b.category === "truck" ? "Truck" : "Equip"}
                          </span>
                        </a>
                      </Link>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button asChild variant="outline" size="sm" data-testid="btn-mobile-track">
                      <Link href="/track-consignment"><a onClick={() => setOpen(false)}>Track</a></Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" data-testid="btn-mobile-login">
                      <Link href="/customer/login"><a onClick={() => setOpen(false)}>Sign In</a></Link>
                    </Button>
                  </div>
                  <Button
                    asChild
                    className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                    data-testid="btn-mobile-quote"
                  >
                    <Link href="/get-quote">
                      <a onClick={() => setOpen(false)}>Request a Quote</a>
                    </Link>
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <Footer />

      {/* Floating WhatsApp — kept, but NO other floating pills. R28.2 shipped a
          "Sticky Get Quote" pill that produced the ghost "GET QUOTATION" text
          under the utility bar; that component is intentionally removed from
          the layout. */}
      <a
        href={whatsappLink("7909083806", "Hello Narmada Mobility, I'd like to enquire.")}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] hover:bg-[#1da851] text-white px-4 py-3 font-medium text-sm shadow-lg shadow-[#25D366]/30 transition-all hover:scale-105"
        data-testid="float-whatsapp"
        aria-label="Chat on WhatsApp"
      >
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">WhatsApp</span>
      </a>
    </div>
  );
}

/* ───────────────────────────────────────────────────────── nav sub-components */

function NavLink({ to, label, className = "" }: { to: string; label: string; className?: string }) {
  const [location] = useLocation();
  const active = location === to;
  return (
    <Link href={to}>
      <a
        className={`px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap relative inline-flex items-center ${
          active
            ? "text-indigo-700"
            : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
        } ${className}`}
        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {label}
        {active && (
          <span className="absolute left-3 right-3 -bottom-0.5 h-0.5 bg-indigo-600 rounded-full" aria-hidden />
        )}
      </a>
    </Link>
  );
}

function BrandsMenu({ onPickBrand }: { onPickBrand: (slug: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="px-3 py-2 text-sm font-medium rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
        data-testid="menu-brands"
      >
        Brands <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[640px] bg-white border border-slate-200 text-slate-900 p-3 shadow-lg">
        <div className="grid grid-cols-2 gap-1">
          <div className="col-span-2 px-2 pb-2 pt-1 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-600">All Brands We Deal In</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              {BRAND_WALL.length} OEMs · 30+ more on request
            </span>
          </div>
          {BRAND_WALL.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => onPickBrand(b.slug)}
              data-testid={`menu-brand-${b.slug}`}
              className="group text-left px-3 py-2 rounded-md hover:bg-slate-100 flex items-center gap-3 transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 group-hover:scale-150 transition-transform" />
              <span className="flex-1">
                <span className="block font-semibold text-[13px] text-slate-900">{b.name}</span>
                <span className="block text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                  {b.category === "truck" ? "Trucks · Buses" : "Construction"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CartIcon() {
  const [count, setCount] = useState(cartCount());
  useEffect(() => subscribeCart(() => setCount(cartCount())), []);
  return (
    <Link href="/cart">
      <a
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        data-testid="link-cart"
        aria-label="Cart"
      >
        <ShoppingCart className="h-5 w-5" />
        {count > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold inline-flex items-center justify-center"
            data-testid="cart-badge"
          >
            {count}
          </span>
        )}
      </a>
    </Link>
  );
}

function CurrencyPicker({ compact = false }: { compact?: boolean } = {}) {
  const [cur, setCur] = useState<Currency>(getCurrency());
  const [rate, setRate] = useState<number>(getUsdInr());
  useEffect(() => {
    loadFxRate().then(() => setRate(getUsdInr()));
    return subscribeCurrency(() => { setCur(getCurrency()); setRate(getUsdInr()); });
  }, []);
  const flag = cur === "USD" ? "🇺🇸" : "🇮🇳";
  const code = cur === "USD" ? "USD" : "INR";
  // Compact variant is used in the utility strip (smaller height + xs text) so
  // the picker blends with the other utility links (Track Consignment / Get
  // Quotation / WhatsApp) instead of sitting as a full h-9 button.
  const triggerClass = compact
    ? "inline-flex items-center gap-1 h-6 px-1.5 rounded text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
    : "inline-flex items-center gap-1 h-9 px-2 rounded-md text-[13px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClass}
        data-testid="currency-picker"
        aria-label="Select currency"
      >
        <span className={compact ? "text-xs leading-none" : "text-sm leading-none"} aria-hidden>{flag}</span>
        <span className="font-semibold tracking-wide">{code}</span>
        <ChevronDown className={compact ? "h-3 w-3 opacity-70" : "h-3.5 w-3.5 opacity-70"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white border border-slate-200 text-slate-900 min-w-[200px]">
        <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">
          Live rate · 1 USD = ₹{rate.toFixed(2)}
        </div>
        <DropdownMenuItem onClick={() => setCurrency("INR")} data-testid="currency-inr" className="font-medium gap-2">
          <span aria-hidden>🇮🇳</span> ₹ INR — Indian Rupee
          {cur === "INR" && <Check className="h-4 w-4 ml-auto text-indigo-600" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCurrency("USD")} data-testid="currency-usd" className="font-medium gap-2">
          <span aria-hidden>🇺🇸</span> $ USD — US Dollar
          {cur === "USD" && <Check className="h-4 w-4 ml-auto text-indigo-600" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignInLink() {
  const { user, ready } = useShopAuth();
  if (ready && user) {
    return (
      <Link href="/customer/account">
        <a
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          data-testid="link-account"
        >
          <User className="h-4 w-4" /> {user.fullName?.split(" ")[0] || "Account"}
        </a>
      </Link>
    );
  }
  return (
    <Link href="/customer/login">
      <a
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        data-testid="link-signin"
      >
        <User className="h-4 w-4" /> Sign In
      </a>
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────── footer */

function Footer() {
  return (
    <footer className="bg-slate-100 text-slate-700 pt-20 pb-7 mt-24 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <Logo />
          <p className="mt-5 text-sm leading-relaxed text-slate-600 max-w-xs">
            India's spare parts source for the world. Genuine and OEM-equivalent components for Tata, BharatBenz, Ashok Leyland, Eicher and Volvo commercial vehicles since 2002.
          </p>
          <div className="mt-5 space-y-2.5 text-xs text-slate-600">
            <div className="flex items-start gap-2.5"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500" /> J-157, J Sector, Kankarbagh, Patna-800020, Bihar, India</div>
            <div className="flex items-center gap-2.5"><Mail className="h-3.5 w-3.5 text-indigo-500" /> sales@Narmadamobility.com</div>
            <div className="flex items-center gap-2.5"><Phone className="h-3.5 w-3.5 text-indigo-500" /> +91 79090 83806</div>
          </div>
        </div>
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Top Brands</h4>
          <ul className="space-y-2.5 text-[13px] columns-2 gap-x-6">
            {BRAND_WALL.map((b) => (
              <li key={b.name} className="break-inside-avoid">
                <Link href={`/brand/${b.slug}`}>
                  <a className="text-slate-600 hover:text-indigo-600 transition-colors inline-flex items-center gap-2 font-medium">
                    <span className="h-1 w-1 rounded-full bg-indigo-500" />{b.name}
                  </a>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Company</h4>
          <ul className="space-y-2.5 text-[13px]">
            <li><Link href="/about"><a className="text-slate-600 hover:text-indigo-600 transition-colors">About Narmada</a></Link></li>
            <li><Link href="/work-with-us"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Work With Us</a></Link></li>
            <li><Link href="/products"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Parts Catalog</a></Link></li>
            <li><Link href="/find-parts"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Find Parts</a></Link></li>
            <li><Link href="/get-quote"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Get Quotation</a></Link></li>
            <li><Link href="/contact"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Contact</a></Link></li>
            <li><Link href="/blog"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Insights &amp; Blog</a></Link></li>
            <li><Link href="/price-checker"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Price Checker</a></Link></li>
            <li><Link href="/track-consignment"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Track Consignment</a></Link></li>
            <li><Link href="/privacy"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Privacy Policy</a></Link></li>
            <li><Link href="/disclaimer"><a className="text-slate-600 hover:text-indigo-600 transition-colors">Disclaimer</a></Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Global Presence</h4>
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Exporting to UAE, Saudi Arabia, Russia, Mexico, USA, Australia, Sri Lanka, Kenya, Nigeria, Uganda, Mozambique, Tanzania, Ghana, Egypt and 40+ more countries.
          </p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-14 pt-6 border-t border-slate-200 flex flex-col md:flex-row justify-between gap-3 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
        <span>© {new Date().getFullYear()} Narmada Mobility · A unit of Narmada Motors</span>
        <span>GST · IEC Certified · Authorized OEM Source</span>
      </div>
    </footer>
  );
}
