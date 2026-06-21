import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { formatINR } from "@/lib/utils-app";
import { useToast } from "@/hooks/use-toast";

const STATUS_FLOW = ["placed", "confirmed", "processing", "dispatched", "delivered", "cancelled"];

export default function AdminShopOrderDetail() {
  const [, params] = useRoute<{ id: string }>("/admin/orders/:id");
  const [, params2] = useRoute<{ id: string }>("/admin/shop-orders/:id");
  const id = params?.id || params2?.id;
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [order, setOrder] = useState<any>(null);
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [docket, setDocket] = useState("");

  async function load() {
    if (!token || !id) return;
    const r = await adminFetch(token, `/api/admin/shop-orders/${id}`);
    if (r.ok) { const o = await r.json(); setOrder(o); setCarrier(o.dispatchedCarrier || ""); setDocket(o.dispatchedDocket || ""); }
  }
  useEffect(() => { load(); }, [token, id]); // eslint-disable-line

  async function setStatus(status: string) {
    const r = await adminFetch(token, `/api/admin/shop-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) });
    if (r.ok) { setNote(""); toast({ title: `Status → ${status}` }); load(); }
    else { const j = await r.json(); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  async function saveDispatch() {
    const r = await adminFetch(token, `/api/admin/shop-orders/${id}/dispatch`, { method: "PATCH", body: JSON.stringify({ carrier, docket }) });
    if (r.ok) { toast({ title: "Dispatch saved" }); load(); }
    else { const j = await r.json(); toast({ title: "Error", description: j.error, variant: "destructive" }); }
  }

  if (!order) return <AdminLayout title="Order"><div className="p-12 text-center text-muted-foreground">Loading…</div></AdminLayout>;

  const s = order.ship || {};
  return (
    <AdminLayout title={`Order ${order.orderNumber}`}>
      <Link href="/admin/orders"><a className="text-sm text-accent hover:underline mb-4 inline-block">← All web orders</a></Link>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold mb-3">Items</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {order.items.map((it: any) => (
                  <tr key={it.id}><td className="py-2">{it.name}{it.partNumber ? ` (${it.partNumber})` : ""}</td><td className="py-2 text-center">×{it.qty}</td><td className="py-2 text-right">{formatINR(it.totalInr)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="border-t mt-3 pt-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatINR(order.subtotalInr)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Freight</span><span>{formatINR(order.freightInr)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{formatINR(order.totalInr)}</span></div>
              <div className="text-xs text-muted-foreground">Payment: {order.paymentMode} · {order.paymentStatus}</div>
            </div>
          </div>

          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold mb-3">Status history</h3>
            <div className="space-y-2 text-sm">
              {(order.statusHistory || []).map((h: any) => (
                <div key={h.id} className="flex justify-between border-b pb-1">
                  <span className="capitalize font-medium">{h.status}{h.note ? ` — ${h.note}` : ""}</span>
                  <span className="text-muted-foreground text-xs">{new Date(h.createdAt).toLocaleString("en-IN")} · {h.createdBy}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold mb-1">Customer</h3>
            <div className="text-sm">{order.customerName}<div className="text-muted-foreground">{order.customerEmail}</div><div className="text-muted-foreground">{order.customerPhone}</div></div>
            <h3 className="font-semibold mt-4 mb-1">Ship to</h3>
            <div className="text-sm text-muted-foreground">{s.fullName}, {s.phone}<br />{s.line1}{s.line2 ? `, ${s.line2}` : ""}<br />{s.city}, {s.state} - {s.pincode}</div>
          </div>

          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold mb-2">Update status <span className="capitalize text-accent">({order.status})</span></h3>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full px-3 py-2 rounded-lg border bg-background text-sm mb-2" data-testid="status-note" />
            <div className="grid grid-cols-2 gap-2">
              {STATUS_FLOW.map((st) => (
                <button key={st} onClick={() => setStatus(st)} className="px-3 py-1.5 rounded-lg border text-sm font-semibold capitalize hover:bg-muted" data-testid={`set-status-${st}`}>{st}</button>
              ))}
            </div>
          </div>

          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold mb-2">Dispatch details</h3>
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" className="w-full px-3 py-2 rounded-lg border bg-background text-sm mb-2" data-testid="dispatch-carrier" />
            <input value={docket} onChange={(e) => setDocket(e.target.value)} placeholder="Docket / Tracking #" className="w-full px-3 py-2 rounded-lg border bg-background text-sm mb-2" data-testid="dispatch-docket" />
            <button onClick={saveDispatch} className="w-full px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="dispatch-save">Save Dispatch</button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
