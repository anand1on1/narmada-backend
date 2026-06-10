import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useCustomerAuth, customerFetch } from "@/lib/customer-auth";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, Wallet, FileQuestion, FileText, ShoppingCart, CreditCard, LogOut, User, MessageCircle, Globe } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function PortalLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, customer, clear, ready } = useCustomerAuth();
  const [, navigate] = useLocation();
  // All hooks must run unconditionally on every render. Calling useI18n() after
  // the early returns below changed the hook count when `ready` flipped
  // false->true (right after OTP verify), triggering React error #300.
  const { t, lang, setLang } = useI18n();

  useEffect(() => {
    if (ready && !token) navigate("/portal");
  }, [ready, token, navigate]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-sm text-muted-foreground">Loading...</div>
    </div>;
  }
  if (!token) return null;

  const navItems = [
    { href: "/portal/dashboard", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/portal/ledger", label: t("ledger"), icon: Wallet },
    { href: "/portal/rfqs", label: t("rfqs"), icon: FileQuestion },
    { href: "/portal/quotes", label: t("quotes"), icon: FileText },
    { href: "/portal/purchase-orders", label: t("purchaseOrders"), icon: ShoppingCart },
    { href: "/portal/payments", label: t("payments"), icon: CreditCard },
    { href: "/portal/profile", label: t("myProfile"), icon: User },
    { href: "/portal/chat", label: t("chatAssistant"), icon: MessageCircle },
  ];

  async function logout() {
    if (token) {
      try { await customerFetch(token, "/api/customer/logout", { method: "POST" }); } catch {}
    }
    clear();
    navigate("/portal");
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <aside className="w-64 bg-card border-r flex flex-col flex-shrink-0">
        <div className="p-5 border-b">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Customer Portal</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((n) => <NavItem key={n.href} {...n} />)}
        </nav>
        <div className="p-4 border-t">
          {customer && <>
            <div className="text-sm font-semibold truncate">{customer.name}</div>
            <div className="text-xs text-muted-foreground truncate">{customer.loginEmail}</div>
          </>}
          {/* Language toggle */}
          <div className="flex items-center gap-1 mt-2 mb-1">
            <Globe className="w-3 h-3 text-muted-foreground" />
            <button onClick={() => setLang("en")} className={`text-xs px-1.5 py-0.5 rounded ${lang === "en" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>EN</button>
            <button onClick={() => setLang("hi")} className={`text-xs px-1.5 py-0.5 rounded ${lang === "hi" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>हि</button>
          </div>
          <button onClick={logout} className="mt-2 w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-muted inline-flex items-center gap-2">
            <LogOut className="w-4 h-4" /> {t("logout")}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto">
        <header className="bg-card border-b px-6 py-4">
          <h1 className="font-display text-2xl font-bold">{title}</h1>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}

function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: any }) {
  const [location] = useLocation();
  const active = location === href || location.startsWith(href + "/");
  return (
    <Link href={href}>
      <a className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold ${active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
        <Icon className="w-4 h-4" /> {label}
      </a>
    </Link>
  );
}
