import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Truck, Search } from "lucide-react";

interface Consignment {
  id: number;
  docketNumber: string;
  carrier: string | null;
  origin: string;
  destination: string;
  customerName: string | null;
  customerPhone: string | null;
  bundlesCount: number | null;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  dispatchDate: string | null;
  etaDate: string | null;
  deliveredDate: string | null;
  status: "pending" | "in_transit" | "out_for_delivery" | "delivered" | "cancelled";
  internalNotes: string | null;
  createdBy: string | null;
  createdAt: string;
}

const STATUSES: Consignment["status"][] = ["pending", "in_transit", "out_for_delivery", "delivered", "cancelled"];

const emptyConsignment: Partial<Consignment> = {
  docketNumber: "", carrier: "", origin: "Patna", destination: "",
  customerName: "", customerPhone: "", bundlesCount: 1,
  invoiceNumber: "", invoiceAmount: 0, dispatchDate: "", etaDate: "",
  deliveredDate: "", status: "pending", internalNotes: "",
};

export default function AdminConsignments() {
  const { token } = useAdminAuth();
  const [items, setItems] = useState<Consignment[]>([]);
  const [filter, setFilter] = useState<"all" | Consignment["status"]>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Partial<Consignment> | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (q.trim()) params.set("q", q.trim());
    const r = await adminFetch(token, `/api/admin/consignments?${params.toString()}`);
    setItems(await r.json());
  }
  useEffect(() => { load(); }, [token, filter]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const isNew = !open.id;
      const url = isNew ? "/api/admin/consignments" : `/api/admin/consignments/${open.id}`;
      const r = await adminFetch(token, url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(open),
      });
      if (!r.ok) {
        const e = await r.json();
        alert(e.error || "Save failed");
      } else {
        await load();
        setOpen(null);
      }
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!token) return;
    if (!confirm("Delete this consignment?")) return;
    const r = await adminFetch(token, `/api/admin/consignments/${id}`, { method: "DELETE" });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Delete failed"); return; }
    await load();
  }

  const statusBadge = (s: Consignment["status"]) => {
    const map: Record<Consignment["status"], string> = {
      pending: "bg-slate-500/15 text-slate-700",
      in_transit: "bg-blue-500/15 text-blue-700",
      out_for_delivery: "bg-amber-500/15 text-amber-700",
      delivered: "bg-emerald-500/15 text-emerald-700",
      cancelled: "bg-red-500/15 text-red-700",
    };
    return <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${map[s]}`}>{s.replace("_", " ")}</span>;
  };

  return (
    <AdminLayout title="Consignments">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === "all" ? "bg-accent text-accent-foreground" : "bg-card border hover:bg-muted"}`}
          data-testid="filter-all"
        >All</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${filter === s ? "bg-accent text-accent-foreground" : "bg-card border hover:bg-muted"}`}
            data-testid={`filter-${s}`}>{s.replace("_", " ")}</button>
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search docket, invoice, customer…"
            className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-72" data-testid="input-search" />
        </div>
        <button onClick={() => setOpen({ ...emptyConsignment })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-new-consignment">
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No consignments. Click New to add one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Docket</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Route</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Bundles</th>
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">ETA</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id} data-testid={`row-cons-${c.id}`}>
                  <td className="px-4 py-3 font-mono font-bold">{c.docketNumber}</td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><Truck className="w-3 h-3 text-muted-foreground" /><span>{c.origin} → {c.destination}</span></div></td>
                  <td className="px-4 py-3">{c.customerName || "—"}</td>
                  <td className="px-4 py-3">{c.bundlesCount ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{c.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.etaDate || "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpen(c)} className="p-2 hover:bg-muted rounded" data-testid={`button-edit-${c.id}`}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => del(c.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-${c.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="font-display text-xl font-bold">{open.id ? "Edit Consignment" : "New Consignment"}</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Docket Number *">
                  <input value={open.docketNumber || ""} onChange={(e) => setOpen({ ...open, docketNumber: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background font-mono" data-testid="input-docket" />
                </Field>
                <Field label="Carrier (e.g. VRL, Delhivery, BlueDart)">
                  <input value={open.carrier || ""} onChange={(e) => setOpen({ ...open, carrier: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-carrier" />
                </Field>
                <Field label="Origin *">
                  <input value={open.origin || ""} onChange={(e) => setOpen({ ...open, origin: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-origin" />
                </Field>
                <Field label="Destination *">
                  <input value={open.destination || ""} onChange={(e) => setOpen({ ...open, destination: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-destination" />
                </Field>
                <Field label="Customer Name">
                  <input value={open.customerName || ""} onChange={(e) => setOpen({ ...open, customerName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-customer" />
                </Field>
                <Field label="Customer Phone">
                  <input value={open.customerPhone || ""} onChange={(e) => setOpen({ ...open, customerPhone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-customer-phone" />
                </Field>
                <Field label="Bundles">
                  <input type="number" value={open.bundlesCount ?? ""} onChange={(e) => setOpen({ ...open, bundlesCount: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-bundles" />
                </Field>
                <Field label="Status">
                  <select value={open.status || "pending"} onChange={(e) => setOpen({ ...open, status: e.target.value as any })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="select-status">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </Field>
                <Field label="Invoice Number">
                  <input value={open.invoiceNumber || ""} onChange={(e) => setOpen({ ...open, invoiceNumber: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-invoice" />
                </Field>
                <Field label="Invoice Amount (INR)">
                  <input type="number" value={open.invoiceAmount ?? ""} onChange={(e) => setOpen({ ...open, invoiceAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-amount" />
                </Field>
                <Field label="Dispatch Date">
                  <input type="date" value={open.dispatchDate || ""} onChange={(e) => setOpen({ ...open, dispatchDate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-dispatch" />
                </Field>
                <Field label="ETA Date">
                  <input type="date" value={open.etaDate || ""} onChange={(e) => setOpen({ ...open, etaDate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-eta" />
                </Field>
                <Field label="Delivered Date">
                  <input type="date" value={open.deliveredDate || ""} onChange={(e) => setOpen({ ...open, deliveredDate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-delivered" />
                </Field>
              </div>
              <Field label="Internal Notes">
                <textarea value={open.internalNotes || ""} onChange={(e) => setOpen({ ...open, internalNotes: e.target.value })}
                  rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-notes" />
              </Field>
            </div>
            <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm disabled:opacity-50"
                data-testid="button-save-consignment">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</div>
      {children}
    </div>
  );
}
