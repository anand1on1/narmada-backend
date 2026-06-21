import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils-app";

// R27.1a BUG 4 — admin Web Customer detail. Profile + addresses + orders + wishlist,
// joined from GET /api/admin/shop-customers/:id.
export default function AdminShopCustomerDetail() {
  const { token } = useAdminAuth();
  const { id } = useParams();
  const [, navigate] = useLocation();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token || !id) return;
    (async () => {
      const r = await adminFetch(token, `/api/admin/shop-customers/${id}`);
      if (r.ok) setData(await r.json());
      else setErr("Customer not found");
    })();
  }, [token, id]);

  return (
    <AdminLayout title="Web Customer">
      <button onClick={() => navigate("/admin/web-customers")} className="text-sm text-muted-foreground hover:text-foreground mb-4" data-testid="back-link">← Back to Web Customers</button>
      {err && <div className="p-8 text-center text-red-600">{err}</div>}
      {!data && !err && <div className="p-8 text-center text-muted-foreground">Loading…</div>}
      {data && (
        <div className="space-y-6">
          <div className="bg-card border rounded-xl p-5" data-testid="profile-card">
            <h2 className="font-bold text-lg mb-3">{data.fullName || "—"}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><div className="text-muted-foreground">Email</div><div className="font-medium">{data.email}</div></div>
              <div><div className="text-muted-foreground">Phone</div><div className="font-medium">{data.phone || "—"}</div></div>
              <div><div className="text-muted-foreground">Email Verified</div><div className="font-medium">{Number(data.emailVerified) === 1 ? <span className="text-green-600">Yes</span> : <span className="text-amber-600">No</span>}</div></div>
              <div><div className="text-muted-foreground">Joined</div><div className="font-medium">{data.createdAt ? new Date(data.createdAt).toLocaleString("en-IN") : "—"}</div></div>
              <div><div className="text-muted-foreground">Last Login</div><div className="font-medium">{data.lastLoginAt ? new Date(data.lastLoginAt).toLocaleString("en-IN") : "—"}</div></div>
            </div>
          </div>

          <Section title={`Addresses (${(data.addresses || []).length})`}>
            {(data.addresses || []).length === 0 ? <Empty text="No saved addresses." /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-3">Label</th><th className="p-3">Recipient</th><th className="p-3">Address</th><th className="p-3">Default</th></tr></thead>
                <tbody className="divide-y">
                  {data.addresses.map((a: any) => (
                    <tr key={a.id} data-testid={`addr-${a.id}`}>
                      <td className="p-3">{a.label || "—"}</td>
                      <td className="p-3">{a.fullName} · {a.phone}</td>
                      <td className="p-3">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} - {a.pincode}</td>
                      <td className="p-3">{a.isDefault ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Orders (${(data.orders || []).length})`}>
            {(data.orders || []).length === 0 ? <Empty text="No orders yet." /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-3">Order #</th><th className="p-3">Date</th><th className="p-3">Items</th><th className="p-3">Total</th><th className="p-3">Status</th></tr></thead>
                <tbody className="divide-y">
                  {data.orders.map((o: any) => (
                    <tr key={o.id} onClick={() => navigate(`/admin/orders/${o.id}`)} className="hover:bg-muted/30 cursor-pointer" data-testid={`order-${o.id}`}>
                      <td className="p-3 font-medium">{o.orderNumber}</td>
                      <td className="p-3 text-muted-foreground">{o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="p-3">{o.itemCount}</td>
                      <td className="p-3 font-medium">{formatINR(o.totalInr || 0)}</td>
                      <td className="p-3 capitalize">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Wishlist (${(data.wishlist || []).length})`}>
            {(data.wishlist || []).length === 0 ? <Empty text="No wishlist items." /> : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-3">Product</th><th className="p-3">Part #</th><th className="p-3">Brand</th></tr></thead>
                <tbody className="divide-y">
                  {data.wishlist.map((w: any) => (
                    <tr key={w.id} data-testid={`wish-${w.id}`}>
                      <td className="p-3">{w.name || "—"}</td>
                      <td className="p-3">{w.partNumber || "—"}</td>
                      <td className="p-3">{w.brand || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </AdminLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b font-semibold text-sm">{title}</div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-muted-foreground text-sm">{text}</div>;
}
