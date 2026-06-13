import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { LogOut } from "lucide-react";

// R26.5 — minimal chrome for the role portals (Sales/Finance/HR/Consignment).
export default function RolePortalShell({
  title, accent, icon: Icon, auth, loginPath, children, right,
}: {
  title: string;
  accent: string;
  icon: React.ElementType;
  auth: { useAuth: () => { token: string | null; ready: boolean; user: any; clear: () => void } };
  loginPath: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { token, ready, user, clear } = auth.useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (ready && !token) navigate(loginPath);
  }, [ready, token, navigate, loginPath]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  }
  if (!token) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center gap-3">
          <Logo />
          <div className={`text-xs uppercase tracking-widest font-bold inline-flex items-center gap-1 ${accent}`}>
            <Icon className="w-3.5 h-3.5" /> {title}
          </div>
          <div className="flex-1" />
          {right}
          {user && <span className="text-xs text-slate-500">Hi, <span className="font-semibold text-slate-900">{user.name || user.username}</span></span>}
          <button onClick={() => { clear(); navigate(loginPath); }} className="px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-lg inline-flex items-center gap-1.5" data-testid="button-role-logout">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-6">{children}</main>
    </div>
  );
}
