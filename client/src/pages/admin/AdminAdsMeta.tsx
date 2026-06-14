import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "./AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/queryClient";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import { Facebook, Plug, BarChart3, CheckCircle2 } from "lucide-react";

// R26.6a (10) — reflect the real Meta OAuth connection state via /api/admin/oauth/status.
type MetaStatus = { connected: boolean; account_name: string | null; app_id: string | null };

export default function AdminAdsMeta() {
  const { toast } = useToast();
  const { token } = useAdminAuth();
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [status, setStatus] = useState<MetaStatus | null>(null);

  const loadStatus = useCallback(async () => {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/oauth/status");
      if (r.ok) { const j = await r.json(); setStatus(j.meta); }
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
    if (!token || !confirm("Disconnect the Meta account?")) return;
    const r = await adminFetch(token, "/api/admin/oauth/meta", { method: "DELETE" });
    if (r.ok) { toast({ title: "Meta account disconnected." }); loadStatus(); }
    else toast({ title: "Disconnect failed." });
  }

  return (
    <AdminLayout title="Meta Ads (Facebook / Instagram)">
      <div className="bg-card border rounded-xl p-8 shadow-sm text-center max-w-2xl mx-auto">
        <Facebook className="w-12 h-12 mx-auto mb-4 text-blue-600" />
        <h2 className="font-bold text-xl mb-2">Meta Ads Dashboard</h2>
        <p className="text-muted-foreground mb-6">Connect your Meta Business account to view campaign performance, spend, leads, and ROAS directly here. Leads captured from Lead Ads will flow into the Leads CRM automatically.</p>

        {status?.connected ? (
          <div className="flex flex-col items-center gap-3" data-testid="meta-connected">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Connected{status.account_name ? ` as ${status.account_name}` : ""}
            </div>
            {status.app_id && <div className="text-xs text-muted-foreground">App ID: {status.app_id}</div>}
            <button onClick={disconnect} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted" data-testid="button-meta-disconnect">
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={() => {
              if (oauthEnabled) window.location.href = apiUrl("/api/admin/marketing/meta/connect");
              else toast({ title: "Meta integration setup pending — credentials will be added shortly." });
            }}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2" data-testid="button-meta-connect">
            <Plug className="w-4 h-4" /> Connect Meta Account
          </button>
        )}

        <div className="grid grid-cols-3 gap-4 mt-8 text-left">
          {["Spend", "Leads", "ROAS"].map((m) => (
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
