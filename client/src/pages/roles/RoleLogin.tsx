import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { Logo } from "@/components/Logo";
import { User, Lock } from "lucide-react";
import type { PortalRole } from "@/lib/role-auth";

// R26.5 — shared login screen for the Sales/Finance/HR/Consignment portals.
export default function RoleLogin({
  role, title, accent, icon: Icon, redirectTo, auth,
}: {
  role: PortalRole;
  title: string;
  accent: string;
  icon: React.ElementType;
  redirectTo: string;
  auth: { useAuth: () => { token: string | null; ready: boolean; setAuth: (t: string, u: any) => void }; };
}) {
  const { token, ready, setAuth } = auth.useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (ready && token) navigate(redirectTo);
  }, [ready, token, navigate, redirectTo]);

  async function login() {
    if (!username.trim() || !password.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(apiUrl(`/api/${role}/login`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Login failed"); return; }
      setAuth(j.token, j.user);
      setTimeout(() => navigate(redirectTo), 30);
    } catch (e: any) {
      setErr(e.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-block"><Logo /></div>
          <div className={`mt-2 text-xs uppercase tracking-widest font-bold inline-flex items-center gap-1 justify-center ${accent}`}>
            <Icon className="w-3.5 h-3.5" /> {title}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold mb-1">Username</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username"
                className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background" autoFocus data-testid={`input-${role}-username`}
                onKeyDown={(e) => e.key === "Enter" && document.getElementById(`${role}-pass-input`)?.focus()} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id={`${role}-pass-input`} value={password} onChange={(e) => setPassword(e.target.value)}
                type="password" placeholder="••••••••" data-testid={`input-${role}-password`}
                className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background"
                onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid={`error-${role}-login`}>{err}</div>}
          <button onClick={login} disabled={busy || !username.trim() || !password.trim()}
            className="w-full px-4 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50" data-testid={`button-${role}-login`}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </div>
        <div className="mt-6 text-xs text-muted-foreground text-center">
          Account managed by admin. Contact your administrator for access.
        </div>
      </div>
    </div>
  );
}
