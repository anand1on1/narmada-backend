import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { ConsignmentAuth } from "@/lib/role-auth";
import { apiUrl } from "@/lib/queryClient";
import { Truck, Plus, Edit3, Trash2, X, FileText, PackageCheck } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";

// R26.6b — Consignment portal full rebuild. Two tabs:
//   A) Consignments — table + filters + Create (From Patna) + From-Delhi pill + view modal
//   B) Customers — directory CRUD (mirror of admin)
// All backed by /api/consignment/* endpoints (requireConsignment middleware).
interface Consignment {
  id: number; docketNumber: string; carrier: string | null; origin: string; destination: string;
  customerId?: number | null; customerName: string | null; customerPhone: string | null; customerEmail?: string | null;
  bundlesCount: number | null; invoiceNumber: string | null; invoiceAmount: number | null;
  status: string; dispatchDate: number | null; etaDate: number | null; deliveredDate: number | null;
  notes?: string | null; invoiceUrl?: string | null; docketUrl?: string | null;
  dispatchOrigin?: string | null;
}
interface FromDelhiPO {
  id: number; poNumber: string; customerName: string | null; customerPhone: string | null;
  consignmentStatus: string | null; itemCount: number; totalBundles: number; custTotal: number;
  docketUrl: string | null; docketNumber: string | null;
}
interface FromDelhiItem { name: string; partNumber: string | null; brand: string | null; qty: number; unitPrice: number; total: number; }
interface FromDelhiDetail {
  id: number; poNumber: string; customerName: string | null; customerPhone: string | null;
  origin: string; destination: string | null; status: string | null;
  itemCount: number; totalBundles: number; totalValue: number;
  items: FromDelhiItem[]; docketUrl: string | null; invoiceUrl: string | null; docketNumber: string | null;
  docketTransport?: string | null; carrier?: string | null;
}
interface CustomerRow {
  id: number; name: string; phone: string | null; email: string | null;
  city: string | null; state: string | null; gstNumber: string | null; contactPerson: string | null;
}

const INP = "w-full border rounded-lg px-3 py-2 bg-background text-sm";
const STATUSES = ["pending", "in_transit", "out_for_delivery", "delivered", "cancelled"];
// R27.13 T5 — dispatch origin lets the consignment team record where a shipment left
// from (e.g. Delhi), regardless of its destination. Free choice from common origins.
const DISPATCH_ORIGINS = ["Delhi", "Patna", "Other"];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-700", in_transit: "bg-amber-500/15 text-amber-700",
  out_for_delivery: "bg-blue-500/15 text-blue-700", delivered: "bg-emerald-500/15 text-emerald-700",
  cancelled: "bg-rose-500/15 text-rose-700",
};
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-IN") : "—");
const inr = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");
const toMs = (s: string) => (s ? new Date(s).getTime() : null);
const toDateInput = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
function openFile(url: string | null | undefined) {
  if (!url) return;
  window.open(apiUrl(url), "_blank", "noopener,noreferrer");
}

const emptyConsignment: any = {
  docketNumber: "", carrier: "", origin: "Patna", destination: "",
  customerId: null, customerName: "", customerPhone: "", customerEmail: "", bundlesCount: 1,
  invoiceNumber: "", invoiceAmount: 0, dispatchDate: "", etaDate: "", deliveredDate: "",
  status: "pending", notes: "",
};
const emptyCustomer: any = { name: "", phone: "", email: "", city: "", state: "", gstNumber: "", contactPerson: "" };

export default function ConsignmentDashboard() {
  const { token } = ConsignmentAuth.useAuth();
  const [tab, setTab] = useState<"consignments" | "from-delhi" | "customers">("consignments");

  return (
    <RolePortalShell title="Consignment Portal" accent="text-blue-600" icon={Truck} auth={ConsignmentAuth} loginPath="/consignment/login"
      right={<NotificationsBell roleFetch={ConsignmentAuth.roleFetch} token={token} />}>
      <div className="flex gap-2 mb-4 border-b">
        <TabBtn active={tab === "consignments"} onClick={() => setTab("consignments")} testid="tab-consignments"><Truck className="w-4 h-4" /> Consignments</TabBtn>
        <TabBtn active={tab === "from-delhi"} onClick={() => setTab("from-delhi")} testid="tab-from-delhi"><PackageCheck className="w-4 h-4" /> From Delhi</TabBtn>
        <TabBtn active={tab === "customers"} onClick={() => setTab("customers")} testid="tab-customers"><Plus className="w-4 h-4" /> Customers</TabBtn>
      </div>
      {tab === "consignments" && <ConsignmentsTab token={token} />}
      {tab === "from-delhi" && <FromDelhiTab token={token} />}
      {tab === "customers" && <CustomersTab token={token} />}
    </RolePortalShell>
  );
}

function TabBtn({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: React.ReactNode; testid: string }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className={`px-4 py-2 text-sm font-semibold flex items-center gap-1.5 border-b-2 -mb-px ${active ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function statusBadge(s: string) {
  return <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_COLOR[s] || "bg-muted"}`}>{s.replace(/_/g, " ")}</span>;
}

// ---------------- Tab A: Consignments ----------------
function ConsignmentsTab({ token }: { token: string | null }) {
  const [items, setItems] = useState<Consignment[]>([]);
  const [statusF, setStatusF] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any | null>(null);
  const [view, setView] = useState<Consignment | null>(null);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  async function load() {
    if (!token) return;
    const p = new URLSearchParams();
    if (statusF !== "all") p.set("status", statusF);
    if (q.trim()) p.set("q", q.trim());
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/consignments?${p}`);
    if (r.ok) setItems(await r.json()); else setItems([]);
  }
  async function loadCustomers() {
    if (!token) return;
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/customers`);
    if (r.ok) setCustomers(await r.json());
  }
  useEffect(() => { load(); }, [token, statusF]); // eslint-disable-line
  useEffect(() => { loadCustomers(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const body: any = {
        ...open,
        dispatchDate: toMs(open.dispatchDate),
        etaDate: toMs(open.etaDate),
        deliveredDate: toMs(open.deliveredDate),
        invoiceAmount: open.invoiceAmount ? Number(open.invoiceAmount) : null,
        bundlesCount: open.bundlesCount ? Number(open.bundlesCount) : null,
      };
      const isEdit = !!open.id;
      const url = isEdit ? `/api/consignment/consignments/${open.id}` : `/api/consignment/consignments`;
      const r = await ConsignmentAuth.roleFetch(token, url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { setOpen(null); load(); }
      else { const e = await r.json().catch(() => ({})); alert(e.error || "Save failed"); }
    } finally { setSaving(false); }
  }
  async function remove(id: number) {
    if (!token || !confirm("Delete this consignment?")) return;
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/consignments/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="filter-consignment-status">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search docket / invoice / customer…" className="border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-48" data-testid="search-consignments" />
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Search</button>
        <button onClick={() => setOpen({ ...emptyConsignment })} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-1" data-testid="btn-create-consignment"><Plus className="w-4 h-4" /> Create (From Patna)</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No consignments in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">Docket</th>
              <th className="px-4 py-3 font-semibold">Route</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Invoice</th>
              <th className="px-4 py-3 font-semibold">Dispatch</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id} data-testid={`row-consignment-${c.id}`}>
                  <td className="px-4 py-3 font-mono font-semibold">{c.docketNumber}<div className="text-[11px] text-muted-foreground font-sans">{c.carrier || ""}</div>
                    {c.origin === "Delhi" && <span className="ml-1 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-700">From Delhi</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{c.origin} → {c.destination}</td>
                  <td className="px-4 py-3 text-xs">{c.customerName || "—"}<div className="text-muted-foreground">{c.customerPhone || ""}</div></td>
                  <td className="px-4 py-3 text-xs">{c.invoiceNumber || "—"}{c.invoiceAmount != null && <div className="text-muted-foreground">{inr(c.invoiceAmount)}</div>}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(c.dispatchDate)}</td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setView(c)} className="px-2 py-1 border rounded text-xs font-semibold hover:bg-muted mr-1" data-testid={`btn-view-${c.id}`}>View</button>
                    <button onClick={() => setOpen({ ...c, dispatchDate: toDateInput(c.dispatchDate), etaDate: toDateInput(c.etaDate), deliveredDate: toDateInput(c.deliveredDate) })} className="p-1.5 border rounded hover:bg-muted mr-1" data-testid={`btn-edit-${c.id}`}><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(c.id)} className="p-1.5 border rounded hover:bg-rose-50 text-rose-600" data-testid={`btn-delete-${c.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={open.id ? "Edit Consignment" : "Create Consignment (From Patna)"} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Docket Number *"><input value={open.docketNumber || ""} onChange={(e) => setOpen({ ...open, docketNumber: e.target.value })} className={INP} data-testid="inp-docket" /></Field>
            <Field label="Carrier"><input value={open.carrier || ""} onChange={(e) => setOpen({ ...open, carrier: e.target.value })} className={INP} /></Field>
            <Field label="Origin"><input value={open.origin || ""} onChange={(e) => setOpen({ ...open, origin: e.target.value })} className={INP} /></Field>
            <Field label="Destination *"><input value={open.destination || ""} onChange={(e) => setOpen({ ...open, destination: e.target.value })} className={INP} /></Field>
            <Field label="Customer">
              <select value={open.customerId ?? ""} onChange={(e) => {
                const cid = e.target.value ? Number(e.target.value) : null;
                const cust = customers.find((c) => c.id === cid);
                setOpen({ ...open, customerId: cid, customerName: cust?.name || "", customerPhone: cust?.phone || "", customerEmail: cust?.email || "" });
              }} className={INP} data-testid="sel-customer">
                <option value="">— Select customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Customer Phone"><input value={open.customerPhone || ""} onChange={(e) => setOpen({ ...open, customerPhone: e.target.value })} className={INP} /></Field>
            <Field label="Invoice Number"><input value={open.invoiceNumber || ""} onChange={(e) => setOpen({ ...open, invoiceNumber: e.target.value })} className={INP} /></Field>
            <Field label="Invoice Amount"><input type="number" value={open.invoiceAmount ?? ""} onChange={(e) => setOpen({ ...open, invoiceAmount: e.target.value })} className={INP} /></Field>
            <Field label="Bundles"><input type="number" value={open.bundlesCount ?? ""} onChange={(e) => setOpen({ ...open, bundlesCount: e.target.value })} className={INP} /></Field>
            <Field label="Status">
              <select value={open.status} onChange={(e) => setOpen({ ...open, status: e.target.value })} className={INP}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Dispatch Origin">
              <select value={open.dispatchOrigin || ""} onChange={(e) => setOpen({ ...open, dispatchOrigin: e.target.value })} className={INP} data-testid="sel-dispatch-origin">
                <option value="">—</option>
                {DISPATCH_ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Dispatch Date"><input type="date" value={open.dispatchDate || ""} onChange={(e) => setOpen({ ...open, dispatchDate: e.target.value })} className={INP} /></Field>
            <Field label="ETA Date"><input type="date" value={open.etaDate || ""} onChange={(e) => setOpen({ ...open, etaDate: e.target.value })} className={INP} /></Field>
            <Field label="Notes" full><textarea value={open.notes || ""} onChange={(e) => setOpen({ ...open, notes: e.target.value })} className={INP} rows={2} /></Field>
          </div>
          {open.id ? (
            <UploadSection token={token} consignment={open} onUploaded={(patch) => { setOpen({ ...open, ...patch }); load(); }} />
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Save the consignment first, then re-open it to attach docket / invoice files.</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button onClick={save} disabled={saving || !open.docketNumber || !open.destination} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="btn-save-consignment">{saving ? "Saving…" : "Save"}</button>
          </div>
        </Modal>
      )}

      {view && (
        <Modal title={`Consignment ${view.docketNumber}`} onClose={() => setView(null)}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Info label="Route" value={`${view.origin} → ${view.destination}`} />
            <Info label="Carrier" value={view.carrier || "—"} />
            <Info label="Customer" value={view.customerName || "—"} />
            <Info label="Phone" value={view.customerPhone || "—"} />
            <Info label="Invoice #" value={view.invoiceNumber || "—"} />
            <Info label="Invoice Amount" value={inr(view.invoiceAmount)} />
            <Info label="Bundles" value={String(view.bundlesCount ?? "—")} />
            <Info label="Status" value={view.status.replace(/_/g, " ")} />
            <Info label="Dispatch Origin" value={view.dispatchOrigin || "—"} />
            <Info label="Dispatch" value={fmtDate(view.dispatchDate)} />
            <Info label="ETA" value={fmtDate(view.etaDate)} />
          </dl>
          <div className="flex gap-2 mt-4">
            {view.docketUrl && <button onClick={() => openFile(view.docketUrl)} className="px-3 py-1.5 border rounded text-xs font-semibold inline-flex items-center gap-1 text-blue-600"><FileText className="w-3 h-3" /> View Docket</button>}
            {view.invoiceUrl && <button onClick={() => openFile(view.invoiceUrl)} className="px-3 py-1.5 border rounded text-xs font-semibold inline-flex items-center gap-1 text-blue-600"><FileText className="w-3 h-3" /> View Invoice</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- From Delhi tab ----------------
function FromDelhiTab({ token }: { token: string | null }) {
  const [pos, setPos] = useState<FromDelhiPO[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<FromDelhiDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  async function load() {
    if (!token) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/from-delhi?${p}`);
    if (r.ok) setPos(await r.json()); else setPos([]);
  }
  async function openDetail(poId: number) {
    if (!token) return;
    setLoadingDetail(true);
    setDetail(null);
    try {
      const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/from-delhi/${poId}`);
      if (r.ok) setDetail(await r.json());
      else { const e = await r.json().catch(() => ({})); alert(e.error || "Failed to load PO detail"); }
    } finally { setLoadingDetail(false); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search PO / customer…" className="border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-48" data-testid="search-from-delhi" />
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Search</button>
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto">
        {pos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No Delhi-dispatched POs.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">PO #</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Items</th>
              <th className="px-4 py-3 font-semibold">Bundles</th>
              <th className="px-4 py-3 font-semibold">Value</th>
              <th className="px-4 py-3 font-semibold">Docket</th>
            </tr></thead>
            <tbody className="divide-y">
              {pos.map((p) => (
                <tr key={p.id} data-testid={`from-delhi-${p.id}`} className="hover:bg-muted/40 cursor-pointer" onClick={() => openDetail(p.id)}>
                  <td className="px-4 py-3 font-mono font-bold text-blue-600 underline" data-testid={`btn-po-detail-${p.id}`}>{p.poNumber}</td>
                  <td className="px-4 py-3">{p.customerName || "—"}{p.customerPhone ? <div className="text-xs text-muted-foreground">{p.customerPhone}</div> : null}</td>
                  <td className="px-4 py-3">{p.itemCount}</td>
                  <td className="px-4 py-3">{p.totalBundles}</td>
                  <td className="px-4 py-3">{inr(p.custTotal)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.docketUrl ? (
                      <button onClick={(e) => { e.stopPropagation(); openFile(p.docketUrl); }} className="px-2.5 py-1 border rounded text-xs font-semibold text-blue-600 hover:bg-muted inline-flex items-center gap-1" data-testid={`btn-view-docket-${p.id}`}><FileText className="w-3 h-3" /> View Docket</button>
                    ) : (
                      <span title="No docket uploaded yet" className="px-2.5 py-1 border rounded text-xs font-semibold text-muted-foreground opacity-50 cursor-not-allowed inline-flex items-center gap-1"><FileText className="w-3 h-3" /> View Docket</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {loadingDetail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"><div className="bg-card border rounded-xl px-6 py-4 text-sm">Loading PO detail…</div></div>
      )}
      {detail && (
        <Modal title={`PO ${detail.poNumber} — From Delhi`} onClose={() => setDetail(null)}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
            <Info label="Customer" value={detail.customerName || "—"} />
            <Info label="Phone" value={detail.customerPhone || "—"} />
            <Info label="Route" value={`${detail.origin} → ${detail.destination || "—"}`} />
            <Info label="Status" value={(detail.status || "—").replace(/_/g, " ")} />
            <Info label="Items" value={String(detail.itemCount)} />
            <Info label="Bundles" value={String(detail.totalBundles)} />
            <Info label="Docket #" value={detail.docketNumber || "—"} />
            <Info label="Carrier" value={detail.docketTransport || detail.carrier || "—"} />
            <Info label="Total Value" value={inr(detail.totalValue)} />
          </dl>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-po-items">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-semibold">Part</th>
                <th className="px-3 py-2 font-semibold text-right">Qty</th>
                <th className="px-3 py-2 font-semibold text-right">Unit Price</th>
                <th className="px-3 py-2 font-semibold text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y">
                {detail.items.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No line items.</td></tr>
                ) : detail.items.map((it, i) => (
                  <tr key={i} data-testid={`po-item-${i}`}>
                    <td className="px-3 py-2">{it.name}<div className="text-[11px] text-muted-foreground">{[it.partNumber, it.brand].filter(Boolean).join(" · ")}</div></td>
                    <td className="px-3 py-2 text-right">{it.qty}</td>
                    <td className="px-3 py-2 text-right">{inr(it.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-medium">{inr(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t font-semibold"><td className="px-3 py-2" colSpan={3}>Total</td><td className="px-3 py-2 text-right">{inr(detail.totalValue)}</td></tr></tfoot>
            </table>
          </div>
          <div className="flex gap-2 mt-4">
            {detail.docketUrl ? (
              <button onClick={() => openFile(detail.docketUrl)} className="px-3 py-1.5 border rounded text-xs font-semibold inline-flex items-center gap-1 text-blue-600" data-testid="btn-detail-docket"><FileText className="w-3 h-3" /> View Docket</button>
            ) : (
              <span title="No docket slip image uploaded by Delhi yet" className="px-3 py-1.5 border rounded text-xs font-semibold inline-flex items-center gap-1 text-muted-foreground opacity-50 cursor-not-allowed"><FileText className="w-3 h-3" /> View Docket</span>
            )}
            {detail.invoiceUrl && <button onClick={() => openFile(detail.invoiceUrl)} className="px-3 py-1.5 border rounded text-xs font-semibold inline-flex items-center gap-1 text-blue-600" data-testid="btn-detail-invoice"><FileText className="w-3 h-3" /> Download Invoice</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Tab B: Customers ----------------
function CustomersTab({ token }: { token: string | null }) {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!token) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/customers?${p}`);
    if (r.ok) setRows(await r.json()); else setRows([]);
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const isEdit = !!open.id;
      const url = isEdit ? `/api/consignment/customers/${open.id}` : `/api/consignment/customers`;
      const r = await ConsignmentAuth.roleFetch(token, url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(open),
      });
      if (r.ok) { setOpen(null); load(); }
      else { const e = await r.json().catch(() => ({})); alert(e.error || "Save failed"); }
    } finally { setSaving(false); }
  }
  async function remove(id: number) {
    if (!token || !confirm("Delete this customer?")) return;
    const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/customers/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search name / phone / city…" className="border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-48" data-testid="search-customers" />
        <button onClick={load} className="px-3 py-2 border rounded-lg text-sm">Search</button>
        <button onClick={() => setOpen({ ...emptyCustomer })} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-1" data-testid="btn-create-customer"><Plus className="w-4 h-4" /> Add Customer</button>
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No customers.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">City</th>
              <th className="px-4 py-3 font-semibold">GST</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} data-testid={`row-customer-${c.id}`}>
                  <td className="px-4 py-3 font-semibold">{c.name}<div className="text-xs text-muted-foreground">{c.contactPerson || ""}</div></td>
                  <td className="px-4 py-3">{c.phone || "—"}</td>
                  <td className="px-4 py-3">{c.city || "—"}</td>
                  <td className="px-4 py-3 text-xs">{c.gstNumber || "—"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpen({ ...c })} className="p-1.5 border rounded hover:bg-muted mr-1" data-testid={`btn-edit-customer-${c.id}`}><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(c.id)} className="p-1.5 border rounded hover:bg-rose-50 text-rose-600" data-testid={`btn-delete-customer-${c.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={open.id ? "Edit Customer" : "Add Customer"} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *"><input value={open.name || ""} onChange={(e) => setOpen({ ...open, name: e.target.value })} className={INP} data-testid="inp-customer-name" /></Field>
            <Field label="Phone"><input value={open.phone || ""} onChange={(e) => setOpen({ ...open, phone: e.target.value })} className={INP} /></Field>
            <Field label="Email"><input value={open.email || ""} onChange={(e) => setOpen({ ...open, email: e.target.value })} className={INP} /></Field>
            <Field label="Contact Person"><input value={open.contactPerson || ""} onChange={(e) => setOpen({ ...open, contactPerson: e.target.value })} className={INP} /></Field>
            <Field label="City"><input value={open.city || ""} onChange={(e) => setOpen({ ...open, city: e.target.value })} className={INP} /></Field>
            <Field label="State"><input value={open.state || ""} onChange={(e) => setOpen({ ...open, state: e.target.value })} className={INP} /></Field>
            <Field label="GST Number" full><input value={open.gstNumber || ""} onChange={(e) => setOpen({ ...open, gstNumber: e.target.value })} className={INP} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button onClick={save} disabled={saving || !open.name} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-testid="btn-save-customer">{saving ? "Saving…" : "Save"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- shared bits ----------------
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></>);
}

// D1 — docket + invoice upload for an existing consignment.
function UploadSection({ token, consignment, onUploaded }: { token: string | null; consignment: Consignment; onUploaded: (patch: Partial<Consignment>) => void; }) {
  const [busy, setBusy] = useState<"docket" | "invoice" | null>(null);
  async function upload(kind: "docket" | "invoice", file: File) {
    if (!token || !consignment.id) return;
    setBusy(kind);
    try {
      const fd = new FormData();
      fd.append(kind, file);
      const r = await ConsignmentAuth.roleFetch(token, `/api/consignment/consignments/${consignment.id}/upload`, { method: "POST", body: fd });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        onUploaded({ docketUrl: data.docketUrl ?? consignment.docketUrl, invoiceUrl: data.invoiceUrl ?? consignment.invoiceUrl });
      } else {
        const e = await r.json().catch(() => ({}));
        alert(e.error || "Upload failed");
      }
    } finally { setBusy(null); }
  }
  const fileName = (url: string | null | undefined) => (url ? url.split("/").pop() : null);
  return (
    <div className="mt-4 border-t pt-4 grid grid-cols-2 gap-3">
      {(["docket", "invoice"] as const).map((kind) => {
        const url = kind === "docket" ? consignment.docketUrl : consignment.invoiceUrl;
        return (
          <div key={kind}>
            <span className="text-xs font-semibold text-muted-foreground capitalize">{kind} (PDF / JPG / PNG)</span>
            <div className="mt-1 flex items-center gap-2">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={busy === kind}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(kind, f); e.target.value = ""; }}
                className="text-xs flex-1" data-testid={`upload-${kind}`} />
            </div>
            {busy === kind && <div className="text-[11px] text-muted-foreground mt-1">Uploading…</div>}
            {url && (
              <div className="text-[11px] mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3 text-blue-600" />
                <button type="button" onClick={() => openFile(url)} className="text-blue-600 underline truncate" data-testid={`link-${kind}`}>{fileName(url)}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
