import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth, AdminRole } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, Package, MessageSquare, Map, Settings, LogOut, ExternalLink,
  FileText, Tag, Truck, Users,
  UserSquare, Wallet, CreditCard, FileQuestion, FileSpreadsheet, ShoppingCart, Landmark,
} from "lucide-react";

// Session A V2: 4-role sidebar matrix.
// admin     = full access
// logistics = consignments only
// accounts  = dashboard + consignments (read) + future ledger/payments/customers (Session B)
// sales     = dashboard + future customers/rfqs (Session B) + price lists + products + contacts
const ROLE_PAGES: Record<AdminRole, Set<string>> = {
  admin: new Set([
    "/admin/dashboard", "/admin/products", "/admin/blog", "/admin/price-lists",
    "/admin/consignments", "/admin/contacts", "/admin/sitemap", "/admin/team", "/admin/settings",
    "/admin/customers", "/admin/ledger", "/admin/payments",
    "/admin/rfqs", "/admin/quotes", "/admin/purchase-orders", "/admin/bank",
  ]),
  logistics: new Set(["/admin/consignments"]),
  accounts: new Set([
    "/admin/dashboard", "/admin/consignments",
    "/admin/customers", "/admin/ledger", "/admin/payments",
    "/admin/rfqs", "/admin/quotes", "/admin/purchase-orders", "/admin/bank",
  ]),
  sales: new Set([
    "/admin/dashboard", "/admin/price-lists", "/admin/products", "/admin/contacts",
    "/admin/customers", "/admin/rfqs", "/admin/quotes", "/admin/purchase-orders",
  ]),
};

const ROLE_BADGE: Record<AdminRole, string> = {
  admin: "bg-purple-500/15 text-purple-700",
  logistics: "bg-blue-500/15 text-blue-700",
  accounts: "bg-emerald-500/15 text-emerald-700",
  sales: "bg-amber-500/15 text-amber-700",
};

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, username, role, displayName, clear, ready } = useAdminAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    // Only redirect once auth state is hydrated, otherwise we kick the user out during refresh
    if (ready && !token) navigate("/admin");
  }, [ready, token, navigate]);

  if (!ready) {
    // Brief loading state while /api/admin/me validates token on first paint
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (!token) return null;

  const allItems = [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/customers", label: "Customers", icon: UserSquare },
    { href: "/admin/ledger", label: "Ledger", icon: Wallet },
    { href: "/admin/payments", label: "Payments", icon: CreditCard },
    { href: "/admin/rfqs", label: "RFQs", icon: FileQuestion },
    { href: "/admin/quotes", label: "Quotes", icon: FileSpreadsheet },
    { href: "/admin/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
    { href: "/admin/bank", label: "Bank Accounts", icon: Landmark },
    { href: "/admin/products", label: "Products", icon: Package },
    { href: "/admin/blog", label: "Blog", icon: FileText },
    { href: "/admin/price-lists", label: "Price Lists", icon: Tag },
    { href: "/admin/consignments", label: "Consignments", icon: Truck },
    { href: "/admin/contacts", label: "Enquiries", icon: MessageSquare },
    { href: "/admin/sitemap", label: "Sitemap & SEO", icon: Map },
    { href: "/admin/team", label: "Team", icon: Users },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  // Default to admin if role is somehow missing (legacy sessions)
  const effectiveRole: AdminRole = role || "admin";
  const allowed = ROLE_PAGES[effectiveRole] || ROLE_PAGES.admin;
  const navItems = allItems.filter((i) => allowed.has(i.href));

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r flex flex-col flex-shrink-0">
        <div className="p-5 border-b">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Admin Panel</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((n) => {
            const active = location.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition " +
                  (active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-slate-100 dark:hover:bg-slate-900 text-foreground/80 hover:text-foreground")
                }
                data-testid={`link-admin-${n.label.toLowerCase()}`}
              >
                <n.icon className="w-4 h-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t space-y-1">
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-view-site"
          >
            <ExternalLink className="w-4 h-4" /> View Site
          </Link>
          <button
            onClick={() => { clear(); navigate("/admin"); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 rounded-lg"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
          {username && (
            <div className="px-3 pt-2 text-xs text-[hsl(220_60%_12%)]/75 font-medium">
              Signed in as <span className="font-semibold text-foreground">{displayName || username}</span>
              {role && (
                <span
                  className={`ml-1.5 inline-block text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${ROLE_BADGE[role] || ROLE_BADGE.admin}`}
                  data-testid="badge-role"
                >
                  {role}
                </span>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <header className="bg-card border-b px-8 py-5">
          <h1 className="font-display text-2xl font-bold">{title}</h1>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
