import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Phone, Mail, MapPin, MessageCircle, ChevronDown, Globe, ArrowUpRight, MapPinned, ShoppingCart, User, Check } from "lucide-react";
import { BRANDS, BRAND_WALL } from "@/data/brands";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { whatsappLink } from "@/lib/utils-app";
import { StickyGetQuote } from "./StickyGetQuote";
import { PartSetuChat } from "./PartSetuChat";
import { cartCount, subscribeCart } from "@/lib/cart";
import { getCurrency, setCurrency, subscribeCurrency, loadFxRate, getUsdInr, Currency } from "@/lib/currency";
import { useShopAuth } from "@/lib/shop-auth";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/products", label: "Catalog" },
  { to: "/price-checker", label: "Price Checker" },
  { to: "/blog", label: "Insights" },
  { to: "/about", label: "About" },
  { to: "/work-with-us", label: "Work With Us" },
  { to: "/contact", label: "Contact" },
];

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col surface-obsidian text-foreground">
      {/* Top utility strip */}
      <div className="hidden md:flex items-center justify-between gap-6 px-6 py-2 text-[11px] surface-obsidian text-[hsl(220_60%_12%)]/75 border-b border-[hsl(220_45%_20%)]/5">
        <div className="flex items-center gap-5">
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3 w-3 text-[hsl(212_95%_55%)]" /> J-157, J Sector, Kankarbagh, Patna-800020</span>
          <span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-[hsl(212_95%_55%)]" /> sales@Narmadamobility.com</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/track-consignment"><a className="inline-flex items-center gap-1.5 text-[hsl(220_60%_12%)]/85 hover:text-[hsl(212_95%_65%)] transition-colors" data-testid="link-track-top"><MapPinned className="h-3 w-3" /> Track Consignment</a></Link>
          <span className="inline-flex items-center gap-1.5"><span className="signal-dot" /> Live · Serving 60+ countries</span>
          <a href={whatsappLink("7909083806", "Hello, I'm interested in spare parts.")} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[hsl(220_60%_12%)]/85 hover:text-[hsl(212_95%_65%)] transition-colors" data-testid="link-whatsapp-top">
            <MessageCircle className="h-3 w-3" /> WhatsApp +91 79090 83806
          </a>
        </div>
      </div>

      {/* Main nav */}
      <header className={`sticky top-0 z-40 transition-all border-b ${scrolled ? "bg-[hsl(210_30%_96%)]/92 backdrop-blur-xl border-[hsl(220_45%_20%)]/10 shadow-sm" : "bg-[hsl(210_30%_96%)]/75 backdrop-blur-md border-[hsl(220_45%_20%)]/8"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[68px] flex items-center justify-between gap-3">
          {/* R27.5 #2 — logo constrained with shrink-0 + max-width so its wordmark can
              no longer bleed into / overlap the nav. Nav lives in its own min-w-0
              flex container and collapses to a hamburger below xl (1280px). */}
          <Link href="/"><a className="flex items-center shrink-0 max-w-[230px] overflow-hidden" data-testid="link-home-logo"><Logo /></a></Link>

          <nav className="hidden xl:flex items-center gap-0.5 min-w-0 flex-1 justify-center">
            {NAV.slice(0, 2).map((n) => <NavLink key={n.to} {...n} />)}
            <DropdownMenu>
              <DropdownMenuTrigger className="px-2.5 py-2 text-[13px] font-medium rounded-md text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5 inline-flex items-center gap-1 transition-colors whitespace-nowrap" data-testid="menu-brands">
                Brands <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[640px] bg-[hsl(210_35%_98%)] border-[hsl(220_45%_20%)]/10 text-[hsl(220_60%_12%)] p-3">
                <div className="grid grid-cols-2 gap-1">
                  <div className="col-span-2 px-2 pb-2 pt-1 flex items-center justify-between">
                    <span className="eyebrow text-[hsl(212_95%_55%)]">All Brands We Deal In</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[hsl(220_60%_12%)]/40">{BRAND_WALL.length} OEMs · 30+ more on request</span>
                  </div>
                  {BRAND_WALL.map((b) => (
                    <button
                      key={b.name}
                      type="button"
                      onClick={() => navigate(`/brand/${b.slug}`)}
                      data-testid={`menu-brand-${b.slug}`}
                      className="group text-left px-3 py-2 rounded-md hover:bg-[hsl(220_45%_20%)]/8 flex items-center gap-3 transition-colors"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(212_95%_55%)] shrink-0 group-hover:scale-150 transition-transform" />
                      <span className="flex-1">
                        <span className="block font-semibold text-[13px] text-[hsl(220_60%_12%)]">{b.name}</span>
                        <span className="block text-[10px] text-[hsl(220_60%_12%)]/75 font-mono uppercase tracking-wider">{b.category === "truck" ? "Trucks · Buses" : "Construction"}</span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-[hsl(220_60%_12%)]/30 group-hover:text-[hsl(212_95%_65%)] transition-colors" />
                    </button>
                  ))}
                  <Link href="/contact">
                    <a className="col-span-2 mt-2 px-3 py-2.5 rounded-md bg-[hsl(212_95%_55%)]/10 border border-[hsl(212_95%_55%)]/25 text-[13px] text-[hsl(212_95%_65%)] hover:bg-[hsl(212_95%_55%)]/15 flex items-center justify-between">
                      Don't see your brand? Ask us about Cummins, AMW, Hino, Sany, XCMG, Doosan
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </Link>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {NAV.slice(2).map((n) => <NavLink key={n.to} {...n} />)}
          </nav>

          <div className="hidden md:flex items-center gap-2 shrink-0">
            <HeaderActions />
            <Button asChild size="sm" className="hidden xl:inline-flex bg-[hsl(212_95%_55%)] hover:bg-[hsl(212_95%_50%)] text-[hsl(220_60%_12%)] font-semibold rounded-md shadow-none" data-testid="btn-quote">
              <Link href="/contact">Request a Quote</Link>
            </Button>
          </div>

          {/* Mobile cart icon (always visible) */}
          <div className="md:hidden flex items-center">
            <CartIcon />
          </div>

          {/* Mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="xl:hidden text-[hsl(220_60%_12%)] shrink-0" data-testid="btn-mobile-menu"><Menu className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 bg-[hsl(210_30%_96%)] text-[hsl(220_60%_12%)] border-[hsl(220_45%_20%)]/10">
              <div className="mt-6 flex flex-col gap-1">
                {NAV.map((n) => (
                  <Link key={n.to} href={n.to}><a onClick={() => setOpen(false)} className="px-3 py-2.5 rounded-md text-[14px] font-medium hover:bg-[hsl(220_45%_20%)]/5" data-testid={`mobile-link-${n.label.toLowerCase()}`}>{n.label}</a></Link>
                ))}
                <div className="mt-3 px-3 py-1 eyebrow text-[hsl(220_60%_12%)]/40">Brands ({BRAND_WALL.length})</div>
                <div className="max-h-[40vh] overflow-y-auto pr-1">
                  {BRAND_WALL.map((b) => (
                    <Link key={b.name} href={`/brand/${b.slug}`}>
                      <a
                        onClick={() => setOpen(false)}
                        className="px-3 py-2 rounded-md text-[14px] font-medium hover:bg-[hsl(220_45%_20%)]/5 flex items-center gap-2.5"
                        data-testid={`mobile-brand-${b.slug}`}
                      >
                        <div className="h-1.5 w-1.5 rounded-full bg-[hsl(212_95%_55%)]" />
                        <span className="flex-1">{b.name}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(220_60%_12%)]/82">{b.category === "truck" ? "Truck" : "Equip"}</span>
                      </a>
                    </Link>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Button asChild variant="outline" size="sm" className="border-[hsl(220_45%_20%)]/15 text-[hsl(220_60%_12%)]" data-testid="btn-mobile-track">
                    <Link href="/track-consignment"><a onClick={() => setOpen(false)}>Track</a></Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="border-[hsl(220_45%_20%)]/15 text-[hsl(220_60%_12%)]" data-testid="btn-mobile-login">
                    <Link href="/portal"><a onClick={() => setOpen(false)}>Login</a></Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="border-[hsl(220_45%_20%)]/15 text-[hsl(220_60%_12%)]" data-testid="btn-mobile-register">
                    <Link href="/portal/register"><a onClick={() => setOpen(false)}>Register</a></Link>
                  </Button>
                </div>
                <Button asChild className="mt-3 bg-[hsl(212_95%_55%)] text-[hsl(220_60%_12%)] hover:bg-[hsl(212_95%_50%)] font-semibold" data-testid="btn-mobile-quote">
                  <Link href="/contact"><a onClick={() => setOpen(false)}>Request a Quote</a></Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <Footer />

      {/* Floating WhatsApp */}
      <a
        href={whatsappLink("7909083806", "Hello Narmada Mobility, I'd like to enquire.")}
        target="_blank" rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] hover:bg-[#1da851] text-white px-4 py-3 font-medium text-sm shadow-lg shadow-[#25D366]/30 transition-all hover:scale-105"
        data-testid="float-whatsapp"
        aria-label="Chat on WhatsApp"
      >
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">WhatsApp</span>
      </a>

      {/* Sticky Get-Quote button (bottom-left) */}
      <StickyGetQuote />

      {/* PartSetu AI chatbot (bottom-right, above WhatsApp) */}
      <PartSetuChat />
    </div>
  );
}

function CartIcon() {
  const [count, setCount] = useState(cartCount());
  useEffect(() => subscribeCart(() => setCount(cartCount())), []);
  return (
    <Link href="/cart">
      <a className="relative inline-flex items-center justify-center h-9 w-9 rounded-md text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5 transition-colors" data-testid="link-cart" aria-label="Cart">
        <ShoppingCart className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[hsl(212_95%_50%)] text-white text-[10px] font-bold inline-flex items-center justify-center" data-testid="cart-badge">{count}</span>
        )}
      </a>
    </Link>
  );
}

function CurrencyPicker() {
  const [cur, setCur] = useState<Currency>(getCurrency());
  const [rate, setRate] = useState<number>(getUsdInr());
  useEffect(() => {
    loadFxRate().then(() => setRate(getUsdInr()));
    return subscribeCurrency(() => { setCur(getCurrency()); setRate(getUsdInr()); });
  }, []);
  // R27.5 #1 — reverted the oversized R27.4 pill back to a compact, unobtrusive
  // inline dropdown (flag + code + chevron, ~64px). Visual weight now matches the
  // cart icon. The live rate moved into the dropdown menu rather than inline.
  const flag = cur === "USD" ? "🇺🇸" : "🇮🇳";
  const code = cur === "USD" ? "USD" : "INR";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 h-9 px-2 rounded-md text-[13px] font-medium text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5 transition-colors"
        data-testid="currency-picker"
        aria-label="Select currency"
      >
        <span className="text-sm leading-none" aria-hidden>{flag}</span>
        <span className="font-semibold tracking-wide">{code}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white border-[hsl(220_45%_20%)]/10 text-[hsl(220_60%_12%)] min-w-[200px]">
        <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[hsl(220_60%_12%)]/45">Live rate · 1 USD = ₹{rate.toFixed(2)}</div>
        <DropdownMenuItem onClick={() => setCurrency("INR")} data-testid="currency-inr" className="font-medium gap-2">
          <span aria-hidden>🇮🇳</span> ₹ INR — Indian Rupee
          {cur === "INR" && <Check className="h-4 w-4 ml-auto text-[hsl(212_95%_50%)]" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCurrency("USD")} data-testid="currency-usd" className="font-medium gap-2">
          <span aria-hidden>🇺🇸</span> $ USD — US Dollar
          {cur === "USD" && <Check className="h-4 w-4 ml-auto text-[hsl(212_95%_50%)]" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderActions() {
  const { user, ready } = useShopAuth();
  return (
    <div className="flex items-center gap-1">
      <CurrencyPicker />
      <CartIcon />
      {ready && user ? (
        <Link href="/customer/account">
          <a className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5 transition-colors" data-testid="link-account">
            <User className="h-4 w-4" /> {user.fullName?.split(" ")[0] || "Account"}
          </a>
        </Link>
      ) : (
        <Link href="/customer/login">
          <a className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5 transition-colors" data-testid="link-signin">
            <User className="h-4 w-4" /> Sign In
          </a>
        </Link>
      )}
    </div>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  const [location] = useLocation();
  const active = location === to;
  return (
    <Link href={to}>
      <a className={`px-2.5 py-2 text-[13px] font-medium rounded-md transition-colors whitespace-nowrap ${active ? "text-[hsl(212_95%_55%)]" : "text-[hsl(220_60%_12%)]/82 hover:text-[hsl(220_60%_12%)] hover:bg-[hsl(220_45%_20%)]/5"}`} data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}>{label}</a>
    </Link>
  );
}

function Footer() {
  return (
    <footer className="bg-[hsl(210_20%_87%)] text-[hsl(220_60%_12%)]/82 pt-20 pb-7 mt-24 border-t border-[hsl(220_45%_20%)]/10 relative overflow-hidden">
      <div className="absolute inset-0 pattern-grid opacity-40 pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <Logo />
          <p className="mt-5 text-[13px] leading-relaxed text-[hsl(220_60%_12%)]/75 max-w-xs">
            India's spare parts source for the world. Genuine and OEM-equivalent components for Tata, BharatBenz, Ashok Leyland, Eicher and Volvo commercial vehicles since 2002.
          </p>
          <div className="mt-5 space-y-2.5 text-[12px] text-[hsl(220_60%_12%)]/78">
            <div className="flex items-start gap-2.5"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[hsl(212_95%_55%)]" /> J-157, J Sector, Kankarbagh, Patna-800020, Bihar, India</div>
            <div className="flex items-center gap-2.5"><Mail className="h-3.5 w-3.5 text-[hsl(212_95%_55%)]" /> sales@Narmadamobility.com</div>
            <div className="flex items-center gap-2.5"><Phone className="h-3.5 w-3.5 text-[hsl(212_95%_55%)]" /> +91 79090 83806</div>
          </div>
        </div>
        <div>
          <h4 className="eyebrow text-[hsl(220_60%_12%)]/80 mb-4">Top Brands</h4>
          <ul className="space-y-2.5 text-[13px] columns-2 gap-x-6">
            {BRAND_WALL.map((b) => (
              <li key={b.name} className="break-inside-avoid">
                <Link href={`/brand/${b.slug}`}>
                  <a className="text-[hsl(220_60%_12%)]/75 hover:text-[hsl(212_95%_55%)] transition-colors inline-flex items-center gap-2 font-medium">
                    <span className="h-1 w-1 rounded-full bg-[hsl(212_95%_55%)]" />{b.name}
                  </a>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="eyebrow text-[hsl(220_60%_12%)]/80 mb-4">Company</h4>
          <ul className="space-y-2.5 text-[13px]">
            <li><Link href="/about"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">About Narmada</a></Link></li>
            <li><Link href="/work-with-us"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Work With Us</a></Link></li>
            <li><Link href="/products"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Parts Catalog</a></Link></li>
            <li><Link href="/contact"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Contact &amp; Quote</a></Link></li>
            <li><Link href="/blog"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Insights &amp; Blog</a></Link></li>
            <li><Link href="/price-checker"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Price Checker</a></Link></li>
            <li><Link href="/track-consignment"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Track Consignment</a></Link></li>
            <li><Link href="/privacy"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Privacy Policy</a></Link></li>
            <li><Link href="/disclaimer"><a className="text-[hsl(220_60%_12%)]/80 hover:text-[hsl(212_95%_55%)] transition-colors">Disclaimer</a></Link></li>
          </ul>
        </div>
        <div>
          <h4 className="eyebrow text-[hsl(220_60%_12%)]/80 mb-4">Global Presence</h4>
          <p className="text-[13px] text-[hsl(220_60%_12%)]/75 leading-relaxed">
            Exporting to UAE, Saudi Arabia, Russia, Mexico, USA, Australia, Sri Lanka, Kenya, Nigeria, Uganda, Mozambique, Tanzania, Ghana, Egypt and 40+ more countries.
          </p>
          <div className="mt-5 inline-flex items-center gap-2.5 rounded-full glass-panel px-3.5 py-2 text-[11px] font-mono">
            <span className="signal-dot" />
            <span className="text-[hsl(220_60%_12%)]/80 tracking-wider uppercase">Open for orders globally</span>
          </div>
        </div>
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 mt-14 pt-6 border-t border-[hsl(220_45%_20%)]/8 flex flex-col md:flex-row justify-between gap-3 text-[11px] font-mono text-[hsl(220_60%_12%)]/40 uppercase tracking-wider">
        <span>© {new Date().getFullYear()} Narmada Mobility · A unit of Narmada Motors</span>
        <span>GST · IEC Certified · Authorized OEM Source</span>
      </div>
    </footer>
  );
}
