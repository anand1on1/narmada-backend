import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth, AdminRole, adminFetch } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import AdminNotificationsBell from "@/components/AdminNotificationsBell";
import {
  LayoutDashboard, Package, MessageSquare, Map, Settings, LogOut, ExternalLink,
  FileText, Tag, Truck, Users,
  UserSquare, Wallet, CreditCard, FileQuestion, FileSpreadsheet, ShoppingCart, Landmark,
  Building2, UserCog, ScrollText, ClipboardList, Bell,
  Factory, Inbox, Search, Target, Megaphone, CheckSquare, Sparkles, Facebook, History,
  Gauge, Radar, Link2,
} from "lucide-react";

// Session A V2: 4-role sidebar matrix.
// admin     = full access
// logistics = consignments only
// accounts  = dashboard + consignments (read) + future ledger/payments/customers (Session B)
// sales     = dashboard + future customers/rfqs (Session B) + price lists + products + contacts
const ROLE_PAGES: Record<AdminRole, Set<string>> = {
  admin: new Set([
    "/admin/command-center", "/admin/chats",
    "/admin/dashboard", "/admin/products", "/admin/blog", "/admin/price-lists",
    "/admin/consignments", "/admin/contacts", "/admin/sitemap", "/admin/team", "/admin/settings",
    "/admin/customers", "/admin/ledger", "/admin/payments",
    "/admin/rfqs", "/admin/quotes", "/admin/parts", "/admin/purchase-orders", "/admin/purchase-history", "/admin/bank",
    "/admin/quoting-companies", "/admin/data-team", "/admin/audit-logs", "/admin/notification-log", "/admin/account-requests",
    "/admin/vendors", "/admin/vendor-ledger", "/admin/vendor-inbox", "/admin/market-radar", "/admin/companies",
    "/admin/ai-ledger", "/admin/leads", "/admin/leads-legacy", "/admin/targets", "/admin/announcements", "/admin/tasks", "/admin/tasks-legacy",
    "/admin/users", "/admin/sales-targets", "/admin/attendance",
    "/admin/ads-meta", "/admin/ads-google", "/admin/integrations",
    "/admin/marketing/campaigns", "/admin/marketing/audiences", "/admin/marketing/templates", "/admin/marketing/custom-templates",
  ]),
  logistics: new Set(["/admin/consignments"]),
  accounts: new Set([
    "/admin/dashboard", "/admin/consignments",
    "/admin/customers", "/admin/ledger", "/admin/payments",
    "/admin/rfqs", "/admin/quotes", "/admin/purchase-orders", "/admin/bank", "/admin/vendor-ledger",
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
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    // Only redirect once auth state is hydrated, otherwise we kick the user out during refresh
    if (ready && !token) navigate("/admin");
  }, [ready, token, navigate]);

  // R24.4 — sidebar unread badge for Chats, polled every 30s.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await adminFetch(token, "/api/admin/chats");
        if (!res.ok || !alive) return;
        const list: Array<{ unreadCount?: number }> = await res.json();
        if (alive) setUnreadChats(list.reduce((s, c) => s + (Number(c.unreadCount) || 0), 0));
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

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
    { href: "/admin/command-center", label: "Command Center", icon: Gauge },
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/chats", label: "Chats", icon: MessageSquare, badge: unreadChats },
    { href: "/admin/customers", label: "Customers", icon: UserSquare },
    { href: "/admin/ledger", label: "Ledger", icon: Wallet },
    { href: "/admin/payments", label: "Payments", icon: CreditCard },
    { href: "/admin/rfqs", label: "RFQs", icon: FileQuestion },
    { href: "/admin/quotes", label: "Quotes", icon: FileSpreadsheet },
    { href: "/admin/parts", label: "Parts", icon: Package },
    { href: "/admin/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
    { href: "/admin/purchase-history", label: "Purchase History", icon: History },
    { href: "/admin/bank", label: "Bank Accounts", icon: Landmark },
    { href: "/admin/companies", label: "Companies", icon: Building2 },
    { href: "/admin/vendors", label: "Vendors", icon: Factory },
    { href: "/admin/vendor-ledger", label: "Vendor Ledger", icon: Wallet },
    { href: "/admin/vendor-inbox", label: "Vendor Inbox", icon: Inbox },
    { href: "/admin/market-radar", label: "Market Radar", icon: Radar },
    { href: "/admin/leads", label: "Leads", icon: Target },
    { href: "/admin/leads-legacy", label: "Leads (Legacy)", icon: Target },
    { href: "/admin/ai-ledger", label: "AI Ledger", icon: Sparkles },
    { href: "/admin/targets", label: "Targets", icon: Target },
    { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
    { href: "/admin/tasks", label: "Tasks", icon: CheckSquare },
    { href: "/admin/tasks-legacy", label: "Tasks (Legacy)", icon: CheckSquare },
    { href: "/admin/users", label: "Create Users", icon: UserCog },
    { href: "/admin/ads-meta", label: "Meta Ads", icon: Facebook },
    { href: "/admin/ads-google", label: "Google Ads", icon: Search },
    { href: "/admin/marketing/campaigns", label: "Marketing", icon: Megaphone },
    { href: "/admin/integrations", label: "Integrations", icon: Link2 },
    { href: "/admin/data-team", label: "Data Team", icon: UserCog },
    { href: "/admin/account-requests", label: "Account Requests", icon: ClipboardList },
    { href: "/admin/audit-logs", label: "Audit Log", icon: ScrollText },
    { href: "/admin/notification-log", label: "Notification Log", icon: Bell },
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
    <div className="panel-admin min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-200">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-indigo-600 font-bold">Admin Panel</div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((n) => {
            const active = location.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  "group flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition " +
                  (active
                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                    : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900")
                }
                data-testid={`link-admin-${n.label.toLowerCase()}`}
              >
                <span className={
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition " +
                  (active ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600")
                }>
                  <n.icon className="w-4 h-4" />
                </span>
                <span className="flex-1">{n.label}</span>
                {"badge" in n && (n as any).badge > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full" data-testid="badge-unread-chats">
                    {(n as any).badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-1">
          {effectiveRole === "admin" && (
            <Link
              href="/team/quotations/new"
              className="flex items-center gap-3 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
              data-testid="link-team-portal"
              title="Opens the Quotation builder in the Team portal (requires a separate Data Team login)"
            >
              <ClipboardList className="w-4 h-4" /> New Quotation
            </Link>
          )}
          <Link
            href="/"
            className="flex items-center gap-3 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
            data-testid="link-view-site"
          >
            <ExternalLink className="w-4 h-4" /> View Site
          </Link>
          <button
            onClick={() => { clear(); navigate("/admin"); }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-xl transition"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
          {username && (
            <div className="px-4 pt-2 text-xs text-slate-500 font-medium">
              Signed in as <span className="font-semibold text-slate-900">{displayName || username}</span>
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
        <header className="bg-white border-b border-slate-200 px-8 py-5 sticky top-0 z-20 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-slate-900">{title}</h1>
          <AdminNotificationsBell adminToken={token} />
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
