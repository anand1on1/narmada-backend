import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, Package, MessageSquare, Map, Settings, LogOut, ExternalLink, FileText, Tag, Truck, Users } from "lucide-react";

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, username, clear } = useAdminAuth();
  const [location, navigate] = useLocation();
  const [role, setRole] = useState<"admin" | "logistics" | null>(null);

  useEffect(() => {
    if (!token) navigate("/admin");
  }, [token, navigate]);

  // Fetch the current user's role so the sidebar can be filtered for sub-users
  useEffect(() => {
    if (!token) return;
    adminFetch(token, "/api/v2/me")
      .then((r) => r.ok ? r.json() : null)
      .then((info) => { if (info?.role) setRole(info.role); })
      .catch(() => {});
  }, [token]);

  if (!token) return null;

  // Items the logistics role is allowed to see. Admin sees everything.
  const LOGISTICS_ONLY = new Set(["/admin/consignments"]);
  const allItems = [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/products", label: "Products", icon: Package },
    { href: "/admin/blog", label: "Blog", icon: FileText },
    { href: "/admin/price-lists", label: "Price Lists", icon: Tag },
    { href: "/admin/consignments", label: "Consignments", icon: Truck },
    { href: "/admin/contacts", label: "Enquiries", icon: MessageSquare },
    { href: "/admin/sitemap", label: "Sitemap & SEO", icon: Map },
    { href: "/admin/team", label: "Team", icon: Users },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];
  const navItems = role === "logistics"
    ? allItems.filter((i) => LOGISTICS_ONLY.has(i.href))
    : allItems;

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
              Signed in as <span className="font-semibold text-foreground">{username}</span>
              {role && <span className={`ml-1.5 inline-block text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${role === "admin" ? "bg-purple-500/15 text-purple-700" : "bg-blue-500/15 text-blue-700"}`}>{role}</span>}
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
