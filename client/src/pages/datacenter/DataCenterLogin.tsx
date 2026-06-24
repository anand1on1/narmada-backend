// v1.4a — Data Center login. Same Narmada Mobility branding as the admin login, but
// posts to /api/datacenter/login and ONLY admits role=data_center accounts. On success
// it stores a dc_-prefixed token (separate from the admin session) and lands the user
// on the Data Center dashboard.
import { useState } from "react";
import { useLocation } from "wouter";
import { useDataCenterAuth } from "@/hooks/useDataCenterAuth";
import { Logo } from "@/components/Logo";
import { Lock, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function DataCenterLogin() {
  const { setAuth } = useDataCenterAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function destination(): string {
    const qIdx = window.location.hash.indexOf("?");
    if (qIdx !== -1) {
      const params = new URLSearchParams(window.location.hash.slice(qIdx + 1));
      const from = params.get("from");
      if (from && from.startsWith("/datacenter") && !from.startsWith("/datacenter/login")) return from;
    }
    return "/datacenter/dashboard";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      let data: any;
      try {
        const res = await apiRequest("POST", "/api/datacenter/login", { username, password });
        data = await res.json();
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (msg.startsWith("403")) setError("This login is for Data Center users only.");
        else setError("Invalid credentials");
        return;
      }
      setAuth(data.token, data.username, data.displayName || data.username);
      const redirectPath = destination();
      setTimeout(() => {
        window.location.hash = redirectPath;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }, 30);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel-admin min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-cyan-500/15 border border-cyan-500/30 rounded-lg flex items-center justify-center">
              <Lock className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold">Data Center Login</h1>
              <p className="text-xs text-[hsl(220_60%_12%)]/75 font-medium">Narmada Mobility — Data Center access</p>
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
                className="w-full px-4 py-2.5 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                data-testid="input-dc-username"
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
                className="w-full px-4 py-2.5 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                data-testid="input-dc-password"
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
              className="w-full px-6 py-3 bg-cyan-600 text-white rounded-lg font-bold hover:bg-cyan-700 transition disabled:opacity-60"
              data-testid="button-dc-login"
            >
              {loading ? "Authenticating…" : "Sign In"}
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
