import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { useTeamAuth } from "@/lib/team-auth";
import { Logo } from "@/components/Logo";
import { User, Lock } from "lucide-react";

export default function TeamLogin() {
  const { token, setAuth, ready } = useTeamAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ssoTried, setSsoTried] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

  useEffect(() => {
    if (ready && token) navigate("/team/dashboard");
  }, [ready, token, navigate]);

  // Admin SSO: if an admin is already signed in, auto-provision a team session
  // so "New Quotation" works without a second login. Falls back to the manual
  // form if there's no admin token or the SSO call fails.
  useEffect(() => {
    if (!ready || token || ssoTried) return;
    const adminToken = (() => {
      try { return localStorage.getItem("narmada_admin_token") ?? sessionStorage.getItem("narmada_admin_token"); }
      catch { return null; }
    })();
    if (!adminToken) { setSsoTried(true); return; }
    setSsoTried(true);
    setSsoBusy(true);
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/team/login-as-admin"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-token": adminToken, "Authorization": `Bearer ${adminToken}` },
        });
        const j = await r.json();
        if (!r.ok) { setErr(j.error || null); return; }
        setAuth(j.token, j.user);
        setTimeout(() => navigate("/team/quotations/new"), 30);
      } catch {
        /* network — show manual form */
      } finally {
        setSsoBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, ssoTried]);

  async function login() {
    if (!username.trim() || !password.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(apiUrl("/api/team/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Login failed"); return; }
      setAuth(j.token, j.user);
      setTimeout(() => navigate("/team/dashboard"), 30);
    } catch (e: any) {
      setErr(e.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (ssoBusy) {
    return (
      <div className="panel-team min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          <div className="inline-block mb-4"><Logo /></div>
          <div className="text-sm font-semibold text-slate-900">Signing you in…</div>
          <div className="text-xs text-slate-500 mt-1">Using your admin session.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-team min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-block"><Logo /></div>
          <div className="mt-2 text-xs uppercase tracking-widest font-bold text-violet-600">Data Team Portal</div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold mb-1">Username</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username"
                className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background" autoFocus
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("team-pass-input")?.focus()} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="team-pass-input" value={password} onChange={(e) => setPassword(e.target.value)}
                type="password" placeholder="••••••••"
                className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background"
                onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
          <button onClick={login} disabled={busy || !username.trim() || !password.trim()}
            className="w-full px-4 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50">
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
