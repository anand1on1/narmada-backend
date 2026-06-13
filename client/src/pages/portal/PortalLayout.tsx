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
    <div className="panel-customer min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-200">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-teal-600 font-bold">Customer Portal</div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((n) => <NavItem key={n.href} {...n} />)}
        </nav>
        <div className="p-4 border-t border-slate-200">
          {customer && <>
            <div className="text-sm font-semibold text-slate-900 truncate">{customer.name}</div>
            <div className="text-xs text-slate-500 truncate">{customer.loginEmail}</div>
          </>}
          {/* Language toggle */}
          <div className="flex items-center gap-1 mt-2 mb-1">
            <Globe className="w-3 h-3 text-slate-400" />
            <button onClick={() => setLang("en")} className={`text-xs px-1.5 py-0.5 rounded ${lang === "en" ? "bg-teal-100 text-teal-700 font-semibold" : "text-slate-500 hover:text-slate-900"}`}>EN</button>
            <button onClick={() => setLang("hi")} className={`text-xs px-1.5 py-0.5 rounded ${lang === "hi" ? "bg-teal-100 text-teal-700 font-semibold" : "text-slate-500 hover:text-slate-900"}`}>हि</button>
          </div>
          <button onClick={logout} className="mt-2 w-full text-left text-sm px-4 py-2 rounded-xl hover:bg-rose-50 text-rose-600 font-medium inline-flex items-center gap-2 transition">
            <LogOut className="w-4 h-4" /> {t("logout")}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20">
          <h1 className="font-display text-2xl font-bold text-slate-900">{title}</h1>
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
      <a className={`group flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition ${active ? "bg-teal-50 text-teal-700 font-semibold" : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900"}`}>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition ${active ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500 group-hover:bg-teal-100 group-hover:text-teal-600"}`}>
          <Icon className="w-4 h-4" />
        </span>
        {label}
      </a>
    </Link>
  );
}
