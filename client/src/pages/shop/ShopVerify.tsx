import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/queryClient";
import { useShopAuth } from "@/lib/shop-auth";
import { SeoHead } from "@/components/SeoHead";

// R27.1a BUG 2 — email OTP verification screen. Pre-fills email from the ?email= query
// param. On success the account is verified, auto-logged-in, and we honor ?next=checkout.
export default function ShopVerify() {
  const { setAuth } = useShopAuth();
  const [, navigate] = useLocation();
  const params = (() => {
    try { return new URLSearchParams(window.location.hash.split("?")[1] || ""); } catch { return new URLSearchParams(); }
  })();
  const [email, setEmail] = useState(params.get("email") || "");
  const nextParam = params.get("next");
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const destFor = (next: string | null) => (next === "checkout" ? "/checkout" : "/customer/account");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/shop/verify-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Verification failed");
      setAuth(j.token, j.user);
      navigate(destFor(nextParam));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const resend = async () => {
    setErr(""); setMsg(""); setResendBusy(true);
    try {
      const r = await fetch(apiUrl("/api/shop/resend-otp"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not resend code");
      setMsg("A new code has been sent to your email.");
      setCooldown(60);
    } catch (e: any) { setErr(e.message); } finally { setResendBusy(false); }
  };

  return (
    <>
      <SeoHead title="Verify Email — Narmada Mobility" description="Enter the verification code sent to your email." />
      <section className="max-w-md mx-auto px-4 py-16">
        <Card className="p-8 border-card-border">
          <h1 className="font-display font-black text-2xl mb-1">Verify your email</h1>
          <p className="text-sm text-muted-foreground mb-6">We sent a 6-digit code to your email. Enter it below to activate your account.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
            </div>
            <div>
              <Label htmlFor="otp">Verification Code</Label>
              <Input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required placeholder="123456" data-testid="input-otp" />
            </div>
            {err && <p className="text-sm text-red-600" data-testid="verify-error">{err}</p>}
            {msg && <p className="text-sm text-green-600" data-testid="verify-msg">{msg}</p>}
            <Button type="submit" className="w-full" disabled={busy} data-testid="button-verify">{busy ? "Verifying…" : "Verify & Continue"}</Button>
          </form>
          <div className="mt-5 text-center text-sm text-muted-foreground">
            Didn't get a code?{" "}
            <button type="button" onClick={resend} disabled={resendBusy || cooldown > 0} className="text-[hsl(212_95%_50%)] font-medium disabled:opacity-50" data-testid="button-resend">
              {cooldown > 0 ? `Resend in ${cooldown}s` : resendBusy ? "Sending…" : "Resend code"}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-3 text-center">
            <Link href="/customer/login"><a className="text-[hsl(212_95%_50%)] font-medium" data-testid="link-login">Back to sign in</a></Link>
          </p>
        </Card>
      </section>
    </>
  );
}
