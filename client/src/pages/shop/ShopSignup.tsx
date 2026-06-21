import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/queryClient";
import { SeoHead } from "@/components/SeoHead";

export default function ShopSignup() {
  const [, navigate] = useLocation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/shop/signup"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName, phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Signup failed");
      // R27.1a BUG 2 — signup no longer auto-logs in. Go verify the emailed OTP.
      navigate(`/customer/verify?email=${encodeURIComponent(j.email || email)}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <SeoHead title="Create Account — Narmada Mobility" description="Create a Narmada Mobility account to order spare parts with Cash on Delivery." />
      <section className="max-w-md mx-auto px-4 py-16">
        <Card className="p-8 border-card-border">
          <h1 className="font-display font-black text-2xl mb-1">Create Account</h1>
          <p className="text-sm text-muted-foreground mb-6">Order parts, track shipments, and save your addresses.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="input-fullname" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} data-testid="input-password" />
              <p className="text-xs text-muted-foreground mt-1">At least 6 characters.</p>
            </div>
            {err && <p className="text-sm text-red-600" data-testid="signup-error">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy} data-testid="button-submit">{busy ? "Creating…" : "Create Account"}</Button>
          </form>
          <p className="text-sm text-muted-foreground mt-5 text-center">
            Already have an account? <Link href="/customer/login"><a className="text-[hsl(212_95%_50%)] font-medium" data-testid="link-login">Sign in</a></Link>
          </p>
        </Card>
      </section>
    </>
  );
}
