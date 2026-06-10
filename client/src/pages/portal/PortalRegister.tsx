import { useState } from "react";
import { apiUrl } from "@/lib/queryClient";
import { Logo } from "@/components/Logo";
import { Link } from "wouter";
import { CheckCircle } from "lucide-react";

export default function PortalRegister() {
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "", gstin: "", address: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(field: keyof typeof form, val: string) {
    setForm((prev) => ({ ...prev, [field]: val }));
  }

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setSubmitting(true); setErr(null);
    try {
      const r = await fetch(apiUrl("/api/public/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Submission failed"); return; }
      setSuccess(true);
    } catch (e: any) {
      setErr(e.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="bg-card border rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
          <h2 className="font-display text-xl font-bold mb-2">Request Submitted!</h2>
          <p className="text-muted-foreground text-sm">
            Your request has been submitted. Our team will review and contact you within 24 hours.
          </p>
          <Link href="/portal">
            <a className="mt-6 inline-block px-5 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold text-sm">
              Back to Login
            </a>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-card border rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-block"><Logo /></div>
          <div className="mt-2 text-xs uppercase tracking-widest font-bold text-muted-foreground">Request Account Access</div>
        </div>
        <div className="space-y-4">
          <Field label="Full Name *">
            <input value={form.name} onChange={(e) => update("name", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background" autoFocus />
          </Field>
          <Field label="Email Address *">
            <input value={form.email} onChange={(e) => update("email", e.target.value)}
              type="email" className="w-full border rounded-lg px-3 py-2 bg-background" />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={(e) => update("phone", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background" />
          </Field>
          <Field label="Company / Organisation">
            <input value={form.company} onChange={(e) => update("company", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background" />
          </Field>
          <Field label="GSTIN">
            <input value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())}
              className="w-full border rounded-lg px-3 py-2 bg-background font-mono uppercase" />
          </Field>
          <Field label="Address">
            <textarea value={form.address} onChange={(e) => update("address", e.target.value)}
              rows={2} className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
          </Field>
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
          )}
          <button onClick={submit} disabled={submitting || !form.name.trim() || !form.email.trim()}
            className="w-full px-4 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50">
            {submitting ? "Submitting…" : "Request Access"}
          </button>
        </div>
        <div className="mt-4 text-sm text-center text-muted-foreground">
          Already have an account?{" "}
          <Link href="/portal">
            <a className="text-accent hover:underline font-semibold">Sign In</a>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
