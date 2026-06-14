import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "./AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/queryClient";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import { Plug, BarChart3, Search, CheckCircle2 } from "lucide-react";

// R26.6a (10) — reflect the real Google OAuth connection state via /api/admin/oauth/status.
type OAuthStatus = { google: { connected: boolean; email: string | null; scopes: string[] } };

export default function AdminAdsGoogle() {
  const { toast } = useToast();
  const { token } = useAdminAuth();
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [status, setStatus] = useState<OAuthStatus["google"] | null>(null);

  const loadStatus = useCallback(async () => {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/oauth/status");
      if (r.ok) { const j = await r.json(); setStatus(j.google); }
    } catch { /* leave previous */ }
  }, [token]);

  useEffect(() => {
    fetch(apiUrl("/api/public/config"))
      .then((r) => r.json())
      .then((j) => setOauthEnabled(!!j.marketingOauthEnabled))
      .catch(() => setOauthEnabled(false));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function disconnect() {
    if (!token || !confirm("Disconnect the Google account?")) return;
    const r = await adminFetch(token, "/api/admin/oauth/google", { method: "DELETE" });
    if (r.ok) { toast({ title: "Google account disconnected." }); loadStatus(); }
    else toast({ title: "Disconnect failed." });
  }

  return (
    <AdminLayout title="Google Ads">
      <div className="bg-card border rounded-xl p-8 shadow-sm text-center max-w-2xl mx-auto">
        <Search className="w-12 h-12 mx-auto mb-4 text-amber-500" />
        <h2 className="font-bold text-xl mb-2">Google Ads Dashboard</h2>
        <p className="text-muted-foreground mb-6">Connect your Google Ads account to track Search & Performance Max campaigns, keyword spend, and conversions. Form/Call leads will sync into the Leads CRM.</p>

        {status?.connected ? (
          <div className="flex flex-col items-center gap-3" data-testid="google-connected">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Connected as {status.email || "Google account"}
            </div>
            {status.scopes?.length > 0 && (
              <div className="text-xs text-muted-foreground max-w-md break-words">Scopes: {status.scopes.join(", ")}</div>
            )}
            <button onClick={disconnect} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted" data-testid="button-google-disconnect">
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={() => {
              if (oauthEnabled) window.location.href = apiUrl("/api/admin/marketing/google/connect");
              else toast({ title: "Google integration setup pending — credentials will be added shortly." });
            }}
            className="px-5 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2" data-testid="button-google-connect">
            <Plug className="w-4 h-4" /> Connect Google Account
          </button>
        )}

        <div className="grid grid-cols-3 gap-4 mt-8 text-left">
          {["Spend", "Clicks", "Conversions"].map((m) => (
            <div key={m} className="border rounded-lg p-4 opacity-50">
              <BarChart3 className="w-4 h-4 text-muted-foreground mb-2" />
              <div className="text-xs text-muted-foreground">{m}</div>
              <div className="text-lg font-bold">—</div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
