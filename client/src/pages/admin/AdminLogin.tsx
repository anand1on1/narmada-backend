import { useState, useEffect, useRef } from "react";
import { useAdminAuth } from "@/lib/admin-auth";
import { Logo } from "@/components/Logo";
import { Lock, AlertCircle, ShieldCheck } from "lucide-react";
import { apiUrl } from "@/lib/queryClient";

// R27.30 — two-step admin login for the super-admin (narmadamobility123): password
// then a 6-digit WhatsApp OTP. Every other admin/DB user logs in in a single step.
export default function AdminLogin() {
  const { setAuth } = useAdminAuth();
  const [step, setStep] = useState<"password" | "otp">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDcLink, setShowDcLink] = useState(false);

  // OTP-step state
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mobileMasked, setMobileMasked] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);   // OTP expiry countdown
  const [resendIn, setResendIn] = useState(0);         // resend cooldown
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (step !== "otp") return;
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [step]);

  function completeLogin(data: any) {
    const role = (data.role || "admin") as "admin" | "logistics" | "accounts" | "sales" | "data_center";
    setAuth(data.token, data.username, role, data.displayName || data.username);
    let redirectPath = "/admin/dashboard";
    if (role === "logistics") redirectPath = "/admin/consignments";
    setTimeout(() => {
      window.location.hash = redirectPath;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }, 30);
  }

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setShowDcLink(false); setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(`Locked until ${fmtTime(data.locked_until)}. Too many attempts.`);
        return;
      }
      if (res.status === 403 && String(data.error || "").toLowerCase().includes("data center")) {
        setError("Use the Data Center login page."); setShowDcLink(true); return;
      }
      if (res.status === 502) { setError("Could not send the OTP. Please try again."); return; }
      if (!res.ok) { setError(data.error || "Invalid credentials"); return; }

      if (data.requires_otp) {
        setChallengeToken(data.challenge_token);
        setMobileMasked(data.mobile_masked || "");
        setSecondsLeft(data.expires_in_seconds || 300);
        setResendIn(30);
        setOtp("");
        setStep("otp");
        return;
      }
      // normal (non-super-admin) session
      completeLogin(data);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/admin/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token: challengeToken, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(`Locked for 15 minutes. Too many attempts.`);
        return;
      }
      if (!res.ok) {
        if (typeof data.remaining_attempts === "number") {
          setError(`Invalid code — ${data.remaining_attempts} attempt${data.remaining_attempts === 1 ? "" : "s"} left`);
        } else {
          setError(data.error === "Invalid or expired code" ? "Code expired — request a new one" : (data.error || "Invalid code"));
        }
        return;
      }
      completeLogin(data);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (resendIn > 0) return;
    setError(null); setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { setError(`Locked until ${fmtTime(data.locked_until)}.`); return; }
      if (res.ok && data.requires_otp) {
        setChallengeToken(data.challenge_token);
        setSecondsLeft(data.expires_in_seconds || 300);
        setResendIn(30);
      } else {
        setError("Could not resend the code.");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="panel-admin min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent/15 border border-accent/30 rounded-lg flex items-center justify-center">
              {step === "otp" ? <ShieldCheck className="w-5 h-5 text-accent" /> : <Lock className="w-5 h-5 text-accent" />}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold">{step === "otp" ? "Verify OTP" : "Admin Panel"}</h1>
              <p className="text-xs text-[hsl(220_60%_12%)]/75 font-medium">Narmada Mobility — restricted access</p>
            </div>
          </div>

          {step === "password" ? (
            <form onSubmit={onSubmitPassword} className="space-y-4">
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
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {error}
                    {showDcLink && (
                      <> <a href="#/datacenter/login" className="font-semibold underline" data-testid="link-datacenter-login">Go to Data Center login</a></>
                    )}
                  </span>
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
          ) : (
            <form onSubmit={onSubmitOtp} className="space-y-4">
              <p className="text-sm text-[hsl(220_60%_12%)]/75 font-medium">
                6-digit code sent to WhatsApp {mobileMasked}. Expires in <span className="font-mono font-bold" data-testid="otp-countdown">{mmss}</span>
              </p>
              <div>
                <label className="text-sm font-semibold mb-1.5 block">One-time code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  required
                  className="w-full px-4 py-2.5 border rounded-lg bg-background text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                  data-testid="input-otp"
                  autoFocus
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-600 text-sm" data-testid="otp-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6 || secondsLeft === 0}
                className="w-full px-6 py-3 bg-accent text-accent-foreground rounded-lg font-bold hover:bg-accent/90 transition disabled:opacity-60"
                data-testid="button-verify-otp"
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={onResend}
                  disabled={resendIn > 0 || loading}
                  className="font-semibold text-accent disabled:text-muted-foreground disabled:cursor-not-allowed"
                  data-testid="button-resend-otp"
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("password"); setError(null); setOtp(""); }}
                  className="text-muted-foreground hover:underline"
                  data-testid="button-back-to-password"
                >
                  Back
                </button>
              </div>
            </form>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Unauthorized access is prohibited. All actions are logged.
        </p>
      </div>
    </div>
  );
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "later";
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
  catch { return "later"; }
}
