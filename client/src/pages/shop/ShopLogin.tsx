import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/queryClient";
import { useShopAuth } from "@/lib/shop-auth";
import { SeoHead } from "@/components/SeoHead";

export default function ShopLogin() {
  const { setAuth } = useShopAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // R27.1a BUG 3 — support redirect-back after login via ?next=checkout (hash routing).
  const nextParam = (() => {
    try { return new URLSearchParams(window.location.hash.split("?")[1] || "").get("next"); } catch { return null; }
  })();
  const destFor = (next: string | null) => (next === "checkout" ? "/checkout" : "/customer/account");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/shop/login"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      // R27.1a BUG 2 — unverified accounts are blocked (403); route to OTP verify screen.
      if (r.status === 403 && j.error === "verify_required") {
        navigate(`/customer/verify?email=${encodeURIComponent(j.email || email)}${nextParam ? `&next=${encodeURIComponent(nextParam)}` : ""}`);
        return;
      }
      if (!r.ok) throw new Error(j.error || "Login failed");
      setAuth(j.token, j.user);
      navigate(destFor(nextParam));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <SeoHead title="Sign In — Narmada Mobility" description="Sign in to your Narmada Mobility account to track orders and manage addresses." />
      <section className="max-w-md mx-auto px-4 py-16">
        <Card className="p-8 border-card-border">
          <h1 className="font-display font-black text-2xl mb-1">Sign In</h1>
          <p className="text-sm text-muted-foreground mb-6">Welcome back. Track your orders and manage your account.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-password" />
            </div>
            {err && <p className="text-sm text-red-600" data-testid="login-error">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy} data-testid="button-submit">{busy ? "Signing in…" : "Sign In"}</Button>
          </form>
          <p className="text-sm text-muted-foreground mt-5 text-center">
            New here? <Link href="/customer/signup"><a className="text-[hsl(212_95%_50%)] font-medium" data-testid="link-signup">Create an account</a></Link>
          </p>
        </Card>
      </section>
    </>
  );
}
