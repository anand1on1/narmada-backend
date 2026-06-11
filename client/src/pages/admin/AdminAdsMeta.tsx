import { AdminLayout } from "./AdminLayout";
import { useToast } from "@/hooks/use-toast";
import { Facebook, Plug, BarChart3 } from "lucide-react";

export default function AdminAdsMeta() {
  const { toast } = useToast();
  return (
    <AdminLayout title="Meta Ads (Facebook / Instagram)">
      <div className="bg-card border rounded-xl p-8 shadow-sm text-center max-w-2xl mx-auto">
        <Facebook className="w-12 h-12 mx-auto mb-4 text-blue-600" />
        <h2 className="font-bold text-xl mb-2">Meta Ads Dashboard</h2>
        <p className="text-muted-foreground mb-6">Connect your Meta Business account to view campaign performance, spend, leads, and ROAS directly here. Leads captured from Lead Ads will flow into the Leads CRM automatically.</p>
        <button onClick={() => toast({ title: "Coming soon", description: "Meta Ads integration is not yet connected. Contact your administrator to set up the Meta Business API." })}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2">
          <Plug className="w-4 h-4" /> Connect Meta Account
        </button>
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
