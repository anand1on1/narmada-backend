// v1.4a — Data Center shell. Standalone chrome (does NOT import AdminLayout) with the
// same Narmada Mobility branding. Sidebar is limited to the public Products
// page. No admin links, ever.
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useDataCenterAuth } from "@/hooks/useDataCenterAuth";
import { Logo } from "@/components/Logo";
import {
  BookOpen, Link2, Tag, FileSpreadsheet, Sparkles, MessageSquare, FileQuestion,
  Package, LogOut, ExternalLink, LayoutDashboard,
} from "lucide-react";

const NAV = [
  { href: "/datacenter/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/datacenter/products", label: "Products", icon: Package, group: "Products" },
];
const GROUP_ORDER = ["Overview", "Products"];

export function DataCenterLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, username, displayName, clear, ready } = useDataCenterAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (ready && !token) navigate(`/datacenter/login?from=${encodeURIComponent(location)}`);
  }, [ready, token, navigate, location]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!token) return null;

  const renderItem = (n: typeof NAV[number]) => {
    const active = location.startsWith(n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        className={
          "group flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition " +
          (active
            ? "bg-cyan-50 text-cyan-700 font-semibold"
            : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900")
        }
        data-testid={`link-datacenter-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className={
          "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition " +
          (active ? "bg-cyan-100 text-cyan-700" : "bg-slate-100 text-slate-500 group-hover:bg-cyan-100 group-hover:text-cyan-600")
        }>
          <n.icon className="w-4 h-4" />
        </span>
        <span className="flex-1">{n.label}</span>
      </Link>
    );
  };

  return (
    <div className="panel-admin min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-200">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-cyan-600 font-bold">Data Center</div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {GROUP_ORDER.map((g) => {
            const items = NAV.filter((n) => n.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-bold text-slate-400">{g}</div>
                <div className="space-y-0.5 mb-1">{items.map(renderItem)}</div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-1">
          <Link
            href="/"
            className="flex items-center gap-3 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
            data-testid="link-view-site"
          >
            <ExternalLink className="w-4 h-4" /> View Site
          </Link>
          <button
            onClick={() => { clear(); navigate("/datacenter/login"); }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-xl transition"
            data-testid="button-datacenter-logout"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
          {username && (
            <div className="px-4 pt-2 text-xs text-slate-500 font-medium">
              Signed in as <span className="font-semibold text-slate-900">{displayName || username}</span>
              <span className="ml-1.5 inline-block text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider bg-cyan-500/15 text-cyan-700">
                Data Center
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-slate-200 px-8 py-5 sticky top-0 z-20 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-slate-900">{title}</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[10px] uppercase tracking-widest font-bold text-cyan-600">Data Center</span>
            {username && <span className="font-semibold text-slate-700">{displayName || username}</span>}
          </div>
        </header>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
