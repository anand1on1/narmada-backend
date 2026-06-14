import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, getAdminToken } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConsignmentDetailModal } from "./ConsignmentDetailModal";
import { Plus, Edit3, Trash2, Truck, Search, PackageCheck, Eye, FileDown, Loader2 } from "lucide-react";

interface Consignment {
  id: number;
  docketNumber: string;
  carrier: string | null;
  origin: string;
  destination: string;
  customerId?: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail?: string | null;
  bundlesCount: number | null;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  dispatchDate: string | null;
  etaDate: string | null;
  deliveredDate: string | null;
  status: "pending" | "in_transit" | "out_for_delivery" | "delivered" | "cancelled";
  notes: string | null;
  invoiceUrl?: string | null;
  docketUrl?: string | null;
  createdBy: string | null;
  createdAt: string;
}

const STATUSES: Consignment["status"][] = ["pending", "in_transit", "out_for_delivery", "delivered", "cancelled"];

// Open an uploaded file (invoice/docket) in a new tab. Stored URLs may be absolute
// (Render host) or relative; apiUrl() passes absolute through and prepends the API base
// to relative paths so the link never resolves against the frontend SPA origin (which
// would hit the hash-router fallback and bounce to "/").
function openFile(url: string | null | undefined) {
  if (!url) return;
  window.open(apiUrl(url), "_blank", "noopener,noreferrer");
}

const emptyConsignment: Partial<Consignment> = {
  docketNumber: "", carrier: "", origin: "Patna", destination: "",
  customerName: "", customerPhone: "", customerEmail: "", bundlesCount: 1,
  invoiceNumber: "", invoiceAmount: 0, dispatchDate: "", etaDate: "",
  deliveredDate: "", status: "pending", notes: "",
};

interface CustomerOption {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
}

// R22.1 — a PO that Delhi has dispatched, surfaced in the consignment view.
interface FromDelhiPO {
  id: number;
  poNumber: string;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  delhiSubmittedAt: number | null;
  consignmentStatus: string | null;
  consignmentReceivedAt: number | null;
  itemCount: number;
  custTotal: number;
  costTotal: number;
  totalBundles: number;
}

// R26 — default date range = last 30 days, formatted as YYYY-MM-DD for <input type=date>.
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
function isoToday(): string { return new Date().toISOString().slice(0, 10); }

export default function AdminConsignments() {
  const { token } = useAdminAuth();
  const [tab, setTab] = useState<"consignments" | "from-delhi">("consignments");
  const [delhiPos, setDelhiPos] = useState<FromDelhiPO[]>([]);
  const [delhiBusy, setDelhiBusy] = useState<number | null>(null);
  // R26 — From-Delhi tab controls
  const [delhiStatusFilter, setDelhiStatusFilter] = useState<string>("all");
  const [delhiFrom, setDelhiFrom] = useState<string>(isoDaysAgo(30));
  const [delhiTo, setDelhiTo] = useState<string>(isoToday());
  const [delhiQ, setDelhiQ] = useState<string>("");
  const [delhiSel, setDelhiSel] = useState<Set<number>>(new Set());
  const [delhiViewId, setDelhiViewId] = useState<number | null>(null);
  const [delhiExporting, setDelhiExporting] = useState(false);
  const [items, setItems] = useState<Consignment[]>([]);
  const [filter, setFilter] = useState<"all" | Consignment["status"]>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Partial<Consignment> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function loadCustomers() {
    if (!token) return;
    try {
      const r = await adminFetch(token, "/api/admin/customers");
      const _d = await r.json();
      setCustomers(Array.isArray(_d) ? _d : []);
    } catch { setCustomers([]); }
  }
  useEffect(() => { loadCustomers(); }, [token]); // eslint-disable-line

  function selectCustomer(c: CustomerOption) {
    setOpen((prev) => prev ? {
      ...prev,
      customerId: c.id,
      customerName: c.name,
      customerPhone: c.phone ?? "",
      customerEmail: c.email ?? "",
    } : prev);
    setPickerOpen(false);
  }

  async function saveAsCustomer() {
    if (!token || !open) return;
    const name = (open.customerName || "").trim();
    if (!name) { alert("Enter a customer name first."); return; }
    setSavingCustomer(true);
    try {
      const r = await adminFetch(token, "/api/admin/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          phone: (open.customerPhone || "").trim() || null,
          email: (open.customerEmail || "").trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Could not create customer"); return; }
      // Link the new customer to this consignment.
      setOpen((prev) => prev ? { ...prev, customerId: j.id, customerName: j.name, customerPhone: j.phone ?? prev.customerPhone, customerEmail: j.email ?? prev.customerEmail } : prev);
      setPickerOpen(false);
      await loadCustomers();
      alert(`Customer "${j.name}" created and linked.`);
    } finally { setSavingCustomer(false); }
  }

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (q.trim()) params.set("q", q.trim());
    const r = await adminFetch(token, `/api/admin/consignments?${params.toString()}`);
    { const _d = await r.json(); setItems(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token, filter]); // eslint-disable-line

  // R22.1 / R26 — load Delhi-dispatched POs (status/date/search filters) and poll while open.
  async function loadDelhi() {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (delhiStatusFilter !== "all") params.set("status", delhiStatusFilter);
      if (delhiQ.trim()) params.set("q", delhiQ.trim());
      if (delhiFrom) params.set("from", String(new Date(delhiFrom + "T00:00:00").getTime()));
      if (delhiTo) params.set("to", String(new Date(delhiTo + "T23:59:59").getTime()));
      const r = await adminFetch(token, `/api/admin/consignment/from-delhi?${params.toString()}`);
      const _d = await r.json();
      setDelhiPos(Array.isArray(_d) ? _d : []);
    } catch { /* keep last */ }
  }
  useEffect(() => {
    if (tab !== "from-delhi") return;
    loadDelhi();
    const id = setInterval(loadDelhi, 20000);
    return () => clearInterval(id);
  }, [tab, token, delhiStatusFilter, delhiFrom, delhiTo]); // eslint-disable-line

  function toggleDelhiSel(id: number) {
    setDelhiSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleDelhiSelAll(ids: number[]) {
    setDelhiSel((prev) => {
      const allSelected = ids.length > 0 && ids.every((i) => prev.has(i));
      return allSelected ? new Set() : new Set(ids);
    });
  }

  async function exportDelhiPdf() {
    if (delhiSel.size === 0) { alert("Select at least one consignment to export."); return; }
    setDelhiExporting(true);
    try {
      const t = getAdminToken();
      const r = await fetch(apiUrl("/api/admin/consignments/export-pdf"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { "x-admin-token": t } : {}) },
        body: JSON.stringify({ po_ids: Array.from(delhiSel) }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Export failed"); return; }
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `consignments-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`;
      a.click();
      URL.revokeObjectURL(u);
    } finally { setDelhiExporting(false); }
  }

  async function setDelhiStatus(poId: number, status: "received" | "processing" | "completed") {
    if (!token) return;
    setDelhiBusy(poId);
    try {
      const r = await adminFetch(token, `/api/admin/consignment/${poId}/status`, {
        method: "POST", body: JSON.stringify({ status }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "Update failed"); return; }
      await loadDelhi();
    } finally { setDelhiBusy(null); }
  }

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

  async function uploadDocs(kind: "invoice" | "docket", file: File) {
    if (!open?.id) return;
    setUploadingDocs(true);
    try {
      const form = new FormData();
      form.append(kind, file);
      const t = getAdminToken();
      const r = await fetch(apiUrl(`/api/admin/consignments/${open.id}/upload`), {
        method: "POST",
        headers: t ? { "x-admin-token": t } : {},
        body: form,
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Upload failed"); return; }
      setOpen((prev) => prev ? { ...prev, invoiceUrl: j.invoiceUrl ?? prev.invoiceUrl, docketUrl: j.docketUrl ?? prev.docketUrl } : prev);
      await load();
    } finally { setUploadingDocs(false); }
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
      <div className="flex gap-1 mb-4 border-b">
        <button onClick={() => setTab("consignments")}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px " + (tab === "consignments" ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-consignments">Consignments</button>
        <button onClick={() => setTab("from-delhi")}
          className={"px-4 py-2 text-sm font-semibold border-b-2 -mb-px inline-flex items-center gap-1.5 " + (tab === "from-delhi" ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-from-delhi"><PackageCheck className="w-4 h-4" /> From Delhi{delhiPos.length > 0 && <span className="bg-emerald-600 text-white text-[10px] px-1.5 rounded-full">{delhiPos.length}</span>}</button>
      </div>

      {tab === "from-delhi" ? (
        <FromDelhiTab
          pos={delhiPos} busyId={delhiBusy} onStatus={setDelhiStatus}
          statusFilter={delhiStatusFilter} setStatusFilter={setDelhiStatusFilter}
          from={delhiFrom} setFrom={setDelhiFrom} to={delhiTo} setTo={setDelhiTo}
          q={delhiQ} setQ={setDelhiQ} onSearch={loadDelhi}
          selected={delhiSel} onToggle={toggleDelhiSel} onToggleAll={toggleDelhiSelAll}
          onView={setDelhiViewId} onExport={exportDelhiPdf} exporting={delhiExporting}
        />
      ) : (
      <>
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
                <th className="px-4 py-3 font-semibold">Docket</th>
                <th className="px-4 py-3 font-semibold">Docs</th>
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
                  <td className="px-4 py-3 whitespace-nowrap">
                    {c.docketUrl ? (
                      <button type="button" onClick={() => openFile(c.docketUrl)} className="text-xs font-semibold text-blue-600 hover:underline" data-testid={`link-docket-slip-${c.id}`}>View Docket</button>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold bg-slate-500/15 text-slate-600" data-testid={`badge-docket-pending-${c.id}`}>Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {c.invoiceUrl ? (
                      <button type="button" onClick={() => openFile(c.invoiceUrl)} className="text-accent hover:underline mr-2" data-testid={`link-invoice-${c.id}`}>Invoice</button>
                    ) : <span className="text-muted-foreground mr-2">—</span>}
                    {c.docketUrl ? (
                      <button type="button" onClick={() => openFile(c.docketUrl)} className="text-accent hover:underline" data-testid={`link-docket-${c.id}`}>Docket</button>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
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
      </>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="font-display text-xl font-bold">{open.id ? "Edit Consignment" : "New Consignment"}</h2>
              <button onClick={() => { setOpen(null); setPickerOpen(false); }} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
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
                <Field label="Customer">
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          value={open.customerName || ""}
                          onChange={(e) => { setOpen({ ...open, customerName: e.target.value, customerId: null }); setPickerOpen(true); }}
                          onFocus={() => setPickerOpen(true)}
                          placeholder="Search customers…"
                          autoComplete="off"
                          className="w-full border rounded-lg px-3 py-2 bg-background"
                          data-testid="input-customer"
                        />
                        {open.customerId ? (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 font-bold uppercase tracking-wider">✓ Linked</span>
                        ) : null}
                      </div>
                    </div>
                    {pickerOpen && (
                      <div className="absolute z-20 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        {(() => {
                          const term = (open.customerName || "").trim().toLowerCase();
                          const matches = term
                            ? customers.filter((c) =>
                                c.name.toLowerCase().includes(term) ||
                                (c.phone || "").toLowerCase().includes(term) ||
                                (c.email || "").toLowerCase().includes(term))
                            : customers;
                          return (
                            <>
                              {matches.slice(0, 50).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                                  className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-b-0"
                                  data-testid={`customer-option-${c.id}`}
                                >
                                  <div className="font-semibold text-sm">{c.name}</div>
                                  <div className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ") || "no phone/email"}</div>
                                </button>
                              ))}
                              {matches.length === 0 && (
                                <div className="px-3 py-2 text-xs text-muted-foreground">No matching customers.</div>
                              )}
                              <button
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); saveAsCustomer(); }}
                                disabled={savingCustomer || !(open.customerName || "").trim()}
                                className="w-full text-left px-3 py-2 bg-muted/50 hover:bg-muted text-accent font-semibold text-sm disabled:opacity-50"
                                data-testid="button-save-customer"
                              >
                                {savingCustomer ? "Creating…" : `+ Create new customer "${(open.customerName || "").trim() || "…"}"`}
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </Field>
                <Field label="Customer Phone">
                  <input value={open.customerPhone || ""} onChange={(e) => setOpen({ ...open, customerPhone: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-customer-phone" />
                </Field>
                <Field label="Customer Email">
                  <input value={open.customerEmail || ""} onChange={(e) => setOpen({ ...open, customerEmail: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-customer-email" />
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
                <textarea value={open.notes || ""} onChange={(e) => setOpen({ ...open, notes: e.target.value })}
                  rows={3} className="w-full border rounded-lg px-3 py-2 bg-background" data-testid="input-notes" />
              </Field>

              {/* R10 — invoice & docket document uploads */}
              <div className="border-t pt-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Documents</div>
                {!open.id ? (
                  <p className="text-xs text-muted-foreground">Save the consignment first, then re-open it to attach invoice / docket files.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Invoice (PDF/JPG/PNG)">
                      {open.invoiceUrl && (
                        <button type="button" onClick={() => openFile(open.invoiceUrl)} className="block text-xs text-accent hover:underline mb-1 truncate">View current invoice</button>
                      )}
                      <input type="file" accept=".pdf,image/jpeg,image/png" disabled={uploadingDocs}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocs("invoice", f); }}
                        className="w-full text-xs" data-testid="input-invoice-file" />
                    </Field>
                    <Field label="Docket (PDF/JPG/PNG)">
                      {open.docketUrl && (
                        <button type="button" onClick={() => openFile(open.docketUrl)} className="block text-xs text-accent hover:underline mb-1 truncate">View current docket</button>
                      )}
                      <input type="file" accept=".pdf,image/jpeg,image/png" disabled={uploadingDocs}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocs("docket", f); }}
                        className="w-full text-xs" data-testid="input-docket-file" />
                    </Field>
                  </div>
                )}
              </div>
            </div>
            <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => { setOpen(null); setPickerOpen(false); }} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm disabled:opacity-50"
                data-testid="button-save-consignment">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {delhiViewId != null && (
        <ConsignmentDetailModal poId={delhiViewId} onClose={() => setDelhiViewId(null)} />
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

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN");

// R26 — the "Processing" backend status maps to the user-facing "Processed" badge.
const DELHI_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "received", label: "Received" },
  { value: "processing", label: "Processed" },
  { value: "completed", label: "Completed" },
];
// Map a raw consignment_status to the StatusBadge status token + label.
function delhiBadge(s: string | null) {
  if (!s) return <StatusBadge status="pending" label="Pending" />;
  if (s === "received") return <StatusBadge status="open" label="Received" />;
  if (s === "processing") return <StatusBadge status="processed" label="Processed" />;
  if (s === "completed") return <StatusBadge status="fulfilled" label="Completed" />;
  return <StatusBadge status={s} />;
}

// R22.1 / R26 — POs dispatched by Delhi. Shows ALL POs (processed stay visible), with
// status/date/search filters, bundles count, View modal, multi-select + PDF export.
function FromDelhiTab({
  pos, busyId, onStatus,
  statusFilter, setStatusFilter, from, setFrom, to, setTo, q, setQ, onSearch,
  selected, onToggle, onToggleAll, onView, onExport, exporting,
}: {
  pos: FromDelhiPO[];
  busyId: number | null;
  onStatus: (poId: number, status: "received" | "processing" | "completed") => void;
  statusFilter: string; setStatusFilter: (s: string) => void;
  from: string; setFrom: (s: string) => void;
  to: string; setTo: (s: string) => void;
  q: string; setQ: (s: string) => void;
  onSearch: () => void;
  selected: Set<number>; onToggle: (id: number) => void; onToggleAll: (ids: number[]) => void;
  onView: (id: number) => void;
  onExport: () => void; exporting: boolean;
}) {
  const ids = pos.map((p) => p.id);
  const allSelected = ids.length > 0 && ids.every((i) => selected.has(i));
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-end">
        <div>
          <label className="text-[11px] block mb-0.5 text-muted-foreground">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="delhi-status-filter">
            {DELHI_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] block mb-0.5 text-muted-foreground">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="delhi-from" />
        </div>
        <div>
          <label className="text-[11px] block mb-0.5 text-muted-foreground">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="delhi-to" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] block mb-0.5 text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="PO #, customer, item, brand…"
              className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" data-testid="delhi-search" />
          </div>
        </div>
        <button onClick={onSearch} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm" data-testid="delhi-search-btn">Search</button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-lg px-4 py-2">
          <span className="text-sm font-semibold" data-testid="delhi-sel-count">{selected.size} consignment{selected.size > 1 ? "s" : ""} selected</span>
          <button onClick={onExport} disabled={exporting}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="delhi-export-btn">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Export Selected as PDF
          </button>
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-x-auto">
        {pos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No Delhi-dispatched POs match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={() => onToggleAll(ids)} data-testid="delhi-select-all" />
                </th>
                <th className="px-4 py-3 font-semibold">PO #</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Items</th>
                <th className="px-4 py-3 font-semibold">Bundles</th>
                <th className="px-4 py-3 font-semibold">Value</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pos.map((p) => (
                <tr key={p.id} data-testid={`delhi-po-${p.id}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} data-testid={`delhi-sel-${p.id}`} />
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{p.poNumber}</td>
                  <td className="px-4 py-3">{delhiBadge(p.consignmentStatus)}</td>
                  <td className="px-4 py-3">{p.customerName || "—"}{p.customerPhone ? <div className="text-xs text-muted-foreground">{p.customerPhone}</div> : null}</td>
                  <td className="px-4 py-3">{p.itemCount}</td>
                  <td className="px-4 py-3" data-testid={`delhi-bundles-${p.id}`}>{p.totalBundles}</td>
                  <td className="px-4 py-3">{inr(p.custTotal)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => onView(p.id)}
                      className="px-2.5 py-1 border rounded text-xs font-semibold hover:bg-muted inline-flex items-center gap-1 mr-2" data-testid={`btn-view-${p.id}`}><Eye className="w-3 h-3" /> View</button>
                    {p.consignmentStatus !== "received" && p.consignmentStatus !== "processing" && p.consignmentStatus !== "completed" && (
                      <button onClick={() => onStatus(p.id, "received")} disabled={busyId === p.id}
                        className="px-2.5 py-1 border rounded text-xs font-semibold hover:bg-muted disabled:opacity-50 mr-2" data-testid={`btn-received-${p.id}`}>Mark Received</button>
                    )}
                    {p.consignmentStatus !== "processing" && p.consignmentStatus !== "completed" && (
                      <button onClick={() => onStatus(p.id, "processing")} disabled={busyId === p.id}
                        className="px-2.5 py-1 border rounded text-xs font-semibold hover:bg-muted disabled:opacity-50 mr-2" data-testid={`btn-process-${p.id}`}>Process</button>
                    )}
                    {p.consignmentStatus !== "completed" && (
                      <button onClick={() => onStatus(p.id, "completed")} disabled={busyId === p.id}
                        className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50" data-testid={`btn-complete-${p.id}`}>Complete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
