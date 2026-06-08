import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, Package, MessageSquare, Map, Settings, LogOut, ExternalLink } from "lucide-react";

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, username, clear } = useAdminAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!token) navigate("/admin");
  }, [token, navigate]);

  if (!token) return null;

  const navItems = [
    { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/products", label: "Products", icon: Package },
    { href: "/admin/contacts", label: "Enquiries", icon: MessageSquare },
    { href: "/admin/sitemap", label: "Sitemap", icon: Map },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

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
