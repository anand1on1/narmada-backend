import { useState } from "react";
import { useAdminAuth } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import { Lock, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function AdminLogin() {
  const { setAuth } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      let data: any;
      try {
        const res = await apiRequest("POST", "/api/admin/login", { username, password });
        data = await res.json();
      } catch (err: any) {
        setError("Invalid credentials");
        return;
      }
      // Session A V2: pass role + displayName so context tracks them and we don't need a 2nd fetch
      const role = (data.role || "admin") as "admin" | "logistics" | "accounts" | "sales";
      setAuth(data.token, data.username, role, data.displayName || data.username);
      // Per-role redirect destination
      let redirectPath = '/admin/dashboard';
      if (role === 'logistics') redirectPath = '/admin/consignments';
      // (accounts and sales land on dashboard — Session B will add their dedicated pages)
      // Defer navigation so React commits the auth state first.
      setTimeout(() => {
        window.location.hash = redirectPath;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, 30);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>
        <div className="bg-card border rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent/15 border border-accent/30 rounded-lg flex items-center justify-center">
              <Lock className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold">Admin Panel</h1>
              <p className="text-xs text-[hsl(220_60%_12%)]/75 font-medium">Narmada Mobility — restricted access</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-2.5 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-accent/50"
                data-testid="input-username"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-accent/50"
                data-testid="input-password"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-accent text-accent-foreground rounded-lg font-bold hover:bg-accent/90 transition disabled:opacity-60"
              data-testid="button-login"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Unauthorized access is prohibited. All actions are logged.
        </p>
      </div>
    </div>
  );
}
