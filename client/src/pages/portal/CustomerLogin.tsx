import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { apiUrl } from "@/lib/queryClient";
import { useCustomerAuth } from "@/lib/customer-auth";
import { Logo } from "@/components/Logo";
import { Mail, KeyRound } from "lucide-react";

export default function CustomerLogin() {
  const { token, setAuth, ready } = useCustomerAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (ready && token) navigate("/portal/dashboard");
  }, [ready, token, navigate]);

  async function requestOtp() {
    if (!email.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(apiUrl("/api/customer/request-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Failed"); return; }
      const ch = j.channels || {};
      const where: string[] = [];
      if (ch.email) where.push("email");
      if (ch.whatsapp) where.push("WhatsApp");
      setMsg(where.length ? `Code sent via ${where.join(" and ")}.` : "Code sent — check your email.");
      setStep("code");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (!code.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(apiUrl("/api/customer/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Invalid code"); return; }
      setAuth(j.token, email.trim());
      // 30ms timeout fix — wait for context to commit before navigating (mirror admin login pattern)
      setTimeout(() => navigate("/portal/dashboard"), 30);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-card border rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-block"><Logo /></div>
          <div className="mt-2 text-xs uppercase tracking-widest font-bold text-muted-foreground">Customer Portal</div>
        </div>

        {step === "email" ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold mb-1">Email address</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
                  className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background" data-testid="input-email" autoFocus
                  onKeyDown={(e) => e.key === "Enter" && requestOtp()} />
              </div>
            </div>
            <button onClick={requestOtp} disabled={busy || !email.trim()}
              className="w-full px-4 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50" data-testid="button-request-otp">
              {busy ? "Sending..." : "Send Code"}
            </button>
            <div className="text-xs text-muted-foreground text-center">
              Don't have an account?{" "}
              <Link href="/portal/register"><a className="underline font-semibold text-accent">Request access</a></Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm">Code sent to <strong>{email}</strong></div>
            <div>
              <label className="block text-sm font-bold mb-1">6-digit code</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456"
                  className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background font-mono text-lg tracking-widest" maxLength={6} autoFocus data-testid="input-code"
                  onKeyDown={(e) => e.key === "Enter" && verify()} />
              </div>
            </div>
            <button onClick={verify} disabled={busy || !code.trim()}
              className="w-full px-4 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50" data-testid="button-verify">
              {busy ? "Verifying..." : "Sign In"}
            </button>
            <div className="flex gap-2 text-xs">
              <button onClick={() => { setStep("email"); setCode(""); setErr(null); }} className="text-muted-foreground underline">Use different email</button>
              <div className="flex-1" />
              <button onClick={requestOtp} className="text-muted-foreground underline">Resend code</button>
            </div>
          </div>
        )}

        {msg && <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-700">{msg}</div>}
        {err && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-700">{err}</div>}
      </div>
    </div>
  );
}
