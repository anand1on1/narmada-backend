import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/queryClient";
import { Plug, BarChart3, Search } from "lucide-react";

export default function AdminAdsGoogle() {
  const { toast } = useToast();
  const [oauthEnabled, setOauthEnabled] = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/public/config"))
      .then((r) => r.json())
      .then((j) => setOauthEnabled(!!j.marketingOauthEnabled))
      .catch(() => setOauthEnabled(false));
  }, []);

  return (
    <AdminLayout title="Google Ads">
      <div className="bg-card border rounded-xl p-8 shadow-sm text-center max-w-2xl mx-auto">
        <Search className="w-12 h-12 mx-auto mb-4 text-amber-500" />
        <h2 className="font-bold text-xl mb-2">Google Ads Dashboard</h2>
        <p className="text-muted-foreground mb-6">Connect your Google Ads account to track Search & Performance Max campaigns, keyword spend, and conversions. Form/Call leads will sync into the Leads CRM.</p>
        <button onClick={() => {
            if (oauthEnabled) {
              window.location.href = apiUrl("/api/admin/marketing/google/connect");
            } else {
              toast({ title: "Google integration setup pending — credentials will be added shortly." });
            }
          }}
          className="px-5 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plug className="w-4 h-4" /> Connect Google Account
        </button>
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
