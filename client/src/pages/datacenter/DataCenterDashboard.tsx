// v1.4a — Data Center home. Welcome card + the Products tile with a live count.
// Renders under the standalone DataCenterLayout.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { DataCenterLayout } from "./DataCenterLayout";
import { useDataCenterAuth, dcFetch } from "@/hooks/useDataCenterAuth";
import { Package } from "lucide-react";

export default function DataCenterDashboard() {
  const { token, displayName, username } = useDataCenterAuth();
  const [productCount, setProductCount] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const r = await dcFetch(token, "/api/admin/products");
        if (alive && r.ok) { const d = await r.json(); setProductCount(Array.isArray(d) ? d.length : null); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <DataCenterLayout title="Data Center">
      <div className="mb-6 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-6">
        <h2 className="font-display text-xl font-bold text-slate-900">Welcome to Narmada Data Center</h2>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as <span className="font-semibold">{displayName || username}</span>. You can upload and edit
          public products — deletion is reserved for admins.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/datacenter/products">
          <a className="block border rounded-xl p-6 hover:bg-muted/30 transition-colors" data-testid="tile-manage-products">
            <Package className="w-7 h-7 mb-3 text-cyan-600" />
            <div className="font-semibold text-lg">Manage Products</div>
            <div className="text-sm text-muted-foreground">Public web-shop product catalog</div>
            <div className="mt-3 text-2xl font-bold text-slate-900">{productCount ?? "—"}<span className="ml-1 text-sm font-medium text-muted-foreground">products</span></div>
          </a>
        </Link>
      </div>
    </DataCenterLayout>
  );
}
