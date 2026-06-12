import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, FileText, FilePlus, Users, Package, LogOut, ShoppingCart, Send, Upload, X, Megaphone, MessageSquare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { href: "/team/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/team/quotations", label: "Quotations", icon: FileText },
  { href: "/team/quotations/new", label: "New Quotation", icon: FilePlus },
  { href: "/team/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
  { href: "/team/po/upload", label: "Upload Customer PO", icon: Upload },
  { href: "/team/rfqs", label: "RFQs", icon: Send },
  { href: "/team/chats", label: "Chats", icon: MessageSquare },
  { href: "/team/customers", label: "Customers", icon: Users },
  { href: "/team/parts", label: "Parts Master", icon: Package },
];

export function TeamLayout({ children, title }: { children: ReactNode; title: string }) {
  const { token, user, clear, ready } = useTeamAuth();
  const [, navigate] = useLocation();
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("team_announcement_dismissed") === "1"; } catch { return false; }
  });

  const { data: announcement } = useQuery<{ id: number; title: string; body: string | null } | null>({
    queryKey: ["team-announcement"],
    queryFn: async () => {
      if (!token) return null;
      const r = await teamFetch(token, `/api/team/announcements`);
      if (!r.ok) return null;
      const arr = await r.json();
      return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  function dismissBanner() {
    setBannerDismissed(true);
    try { sessionStorage.setItem("team_announcement_dismissed", "1"); } catch {}
  }

  useEffect(() => {
    if (ready && !token) navigate("/team/login");
  }, [ready, token, navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!token) return null;

  async function logout() {
    if (token) {
      try { await teamFetch(token, "/api/team/logout", { method: "POST" }); } catch {}
    }
    clear();
    navigate("/team/login");
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <aside className="w-64 bg-card border-r flex flex-col flex-shrink-0">
        <div className="p-5 border-b">
          <Logo />
          <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Data Team</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((n) => <NavItem key={n.href} {...n} />)}
        </nav>
        <div className="p-4 border-t">
          {user && (
            <>
              <div className="text-sm font-semibold truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.username}</div>
            </>
          )}
          <button onClick={logout}
            className="mt-3 w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-muted inline-flex items-center gap-2 text-red-600 hover:bg-red-50">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto flex flex-col">
        {announcement && !bannerDismissed && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-start gap-3">
            <Megaphone className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-amber-800">
              <span className="font-semibold">{announcement.title}</span>
              {announcement.body && <span className="ml-2">{announcement.body}</span>}
            </div>
            <button onClick={dismissBanner} className="text-amber-500 hover:text-amber-700 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <header className="bg-card border-b px-6 py-4">
          <h1 className="font-display text-2xl font-bold">{title}</h1>
        </header>
        <div className="p-6 flex-1">{children}</div>
      </main>
    </div>
  );
}

function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  const [location] = useLocation();
  // "New Quotation" should only be active on exact match
  const active = href === "/team/quotations/new"
    ? location === href
    : location === href || (location.startsWith(href + "/") && href !== "/team/quotations");
  return (
    <Link href={href}>
      <a className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition ${active ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground/80 hover:text-foreground"}`}>
        <Icon className="w-4 h-4" /> {label}
      </a>
    </Link>
  );
}
