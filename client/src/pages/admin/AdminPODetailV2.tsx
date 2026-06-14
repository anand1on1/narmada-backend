import { useRoute, Link } from "wouter";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Truck, Package, CreditCard } from "lucide-react";

// R26.6a (5) — dedicated admin PO detail page. Reads GET /api/admin/purchase-orders-v2/:id
// which returns { po, customer, vendor, lines, dispatches, payments }.
interface PoDetail {
  po: any;
  customer: any | null;
  vendor: { names: string[] } | null;
  lines: any[];
  dispatches: any[];
  payments: any[];
}

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDate = (v: any) => (v ? new Date(Number(v) || v).toLocaleDateString("en-IN") : "—");

export default function AdminPODetailV2() {
  const { token } = useAdminAuth();
  const [, params] = useRoute("/admin/purchase-orders-v2/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;

  const { data, isLoading, error } = useQuery<PoDetail>({
    queryKey: ["admin-po-v2-detail", id],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/purchase-orders-v2/${id}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
      return r.json();
    },
    enabled: !!token && !Number.isNaN(id),
  });

  const po = data?.po;
  const poNo = po?.customerPoNumber || po?.customer_po_number || po?.poNumber || po?.po_number || (po ? `#${po.id}` : "");

  return (
    <AdminLayout title="Purchase Order">
      <div className="mb-4">
        <Link href="/admin/purchase-orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Purchase Orders
        </Link>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading…</div>
      ) : error || !data || !po ? (
        <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
          <Package className="w-10 h-10 opacity-30" />
          <span>{(error as any)?.message || "Purchase order not found."}</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-card border rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-display text-2xl font-bold">PO {poNo}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {data.customer?.name || po.customerName || (po.customerId ? `Customer #${po.customerId}` : "—")}
                  {" · "}
                  {fmtDate(po.poDate || po.po_date || po.createdAt || po.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/15 text-indigo-700 text-xs font-bold uppercase tracking-wider">{po.status || "—"}</span>
                <a href={`/#/team/po/${po.id}`} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold border rounded-lg hover:bg-muted">
                  <ExternalLink className="w-3 h-3" /> Open in Team portal
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <Stat label="Customer Total" value={inr(po.custTotal ?? po.total)} strong />
              <Stat label="Cost Total" value={inr(po.costTotal)} />
              <Stat label="Lines" value={String(data.lines.length)} />
              <Stat label="Dispatches" value={String(data.dispatches.length)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
              {data.customer && (
                <div>
                  <div className="text-xs uppercase font-bold text-muted-foreground mb-1">Customer</div>
                  <div>{data.customer.name}</div>
                  <div className="text-muted-foreground">{[data.customer.phone, data.customer.email, data.customer.gst_number].filter(Boolean).join(" · ") || null}</div>
                </div>
              )}
              {data.vendor?.names?.length ? (
                <div>
                  <div className="text-xs uppercase font-bold text-muted-foreground mb-1">Vendor(s)</div>
                  <div>{data.vendor.names.join(", ")}</div>
                </div>
              ) : null}
            </div>
            {po.notes && (
              <div className="mt-4">
                <div className="text-xs uppercase font-bold text-muted-foreground mb-1">Notes</div>
                <div className="whitespace-pre-wrap text-sm">{po.notes}</div>
              </div>
            )}
          </div>

          {/* Line items */}
          <Section title="Line Items" icon={Package}>
            {data.lines.length === 0 ? (
              <Empty>No line items.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-4 py-2 font-semibold">Part #</th>
                    <th className="px-4 py-2 font-semibold">Description</th>
                    <th className="px-4 py-2 font-semibold">Brand</th>
                    <th className="px-4 py-2 font-semibold text-right">Qty</th>
                    <th className="px-4 py-2 font-semibold text-right">Rate</th>
                    <th className="px-4 py-2 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.lines.map((l: any, i: number) => {
                    const qty = Number(l.qty ?? l.quantity ?? 0);
                    const rate = Number(l.unitPrice ?? l.unit_price ?? 0);
                    const amount = l.lineTotal ?? l.line_total ?? qty * rate;
                    return (
                      <tr key={l.id ?? i}>
                        <td className="px-4 py-2 font-mono text-xs">{l.partNumber || l.part_number || "—"}</td>
                        <td className="px-4 py-2 text-xs">{l.description || l.name || "—"}</td>
                        <td className="px-4 py-2 text-xs">{l.brand || "—"}</td>
                        <td className="px-4 py-2 text-right">{qty}</td>
                        <td className="px-4 py-2 text-right">{inr(rate)}</td>
                        <td className="px-4 py-2 text-right font-semibold">{inr(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {/* Dispatches */}
          <Section title="Dispatches" icon={Truck}>
            {data.dispatches.length === 0 ? (
              <Empty>No dispatches yet.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-4 py-2 font-semibold">Round</th>
                    <th className="px-4 py-2 font-semibold">Docket</th>
                    <th className="px-4 py-2 font-semibold">Carrier</th>
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">Slip</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.dispatches.map((d: any, i: number) => {
                    const slip = d.pdf_url || d.docket_photo_url;
                    return (
                      <tr key={d.id ?? i}>
                        <td className="px-4 py-2 text-xs">{d.round_no ?? "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs">{d.docket_no || "—"}</td>
                        <td className="px-4 py-2 text-xs">{d.courier_name || "—"}</td>
                        <td className="px-4 py-2 text-xs">{fmtDate(d.dispatch_date)}</td>
                        <td className="px-4 py-2 text-xs">
                          {slip ? (
                            <a href={slip} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> View
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {/* Payments */}
          <Section title="Customer Payments" icon={CreditCard}>
            {data.payments.length === 0 ? (
              <Empty>No payment records for this customer.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">Mode</th>
                    <th className="px-4 py-2 font-semibold">Reference</th>
                    <th className="px-4 py-2 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.payments.map((p: any, i: number) => (
                    <tr key={p.id ?? i}>
                      <td className="px-4 py-2 text-xs">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-2 text-xs">{p.payment_mode || "—"}</td>
                      <td className="px-4 py-2 text-xs">{p.reference_no || "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold">{inr(p.amount_inr ?? p.amount)}</td>
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

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase font-bold text-muted-foreground">{label}</div>
      <div className={strong ? "text-lg font-bold" : "text-sm"}>{value}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: any }) {
  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b flex items-center gap-2 font-semibold">
        <Icon className="w-4 h-4 text-muted-foreground" /> {title}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: any }) {
  return <div className="p-8 text-center text-muted-foreground text-sm">{children}</div>;
}
