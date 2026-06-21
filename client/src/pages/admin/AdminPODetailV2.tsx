import { useRoute, Link } from "wouter";
import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Truck, Package, CreditCard, CheckCircle2, FileText, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const qc = useQueryClient();
  const { toast } = useToast();
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

  // R27.1a BUG 6 — Process PO: split confirmed lines (status -> processed). Enabled for
  // statuses that can still be processed; refreshes the detail + list on success.
  const status = String(po?.status || "").toLowerCase();
  const canProcess = ["sent", "accepted", "draft", "partial", "open"].includes(status);
  const processMut = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/purchase-orders/${id}/mark-processed`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Process failed");
      return j;
    },
    onSuccess: (res: any) => {
      toast({ title: "PO processed", description: res?.pending_po ? `Confirmed lines processed; ${res.pending_po.moved_count} pending line(s) moved to ${res.pending_po.po_number}.` : "Confirmed lines processed." });
      qc.invalidateQueries({ queryKey: ["admin-po-v2-detail", id] });
      qc.invalidateQueries({ queryKey: ["admin-pos-v2"] });
    },
    onError: (e: any) => toast({ title: "Could not process PO", description: e.message, variant: "destructive" }),
  });

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
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${status === "processed" ? "bg-emerald-600 text-white" : "bg-indigo-500/15 text-indigo-700"}`}>{po.status || "—"}</span>
                {status === "processed" ? (
                  <span className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white"><CheckCircle2 className="w-3 h-3" /> Processed</span>
                ) : (
                  <button
                    onClick={() => processMut.mutate()}
                    disabled={!canProcess || processMut.isPending}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-process-po"
                  >
                    <CheckCircle2 className="w-3 h-3" /> {processMut.isPending ? "Processing…" : "Process PO"}
                  </button>
                )}
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

          {/* R27.4 BUG-6 + BUG-14 — Delhi invoice: item-level selection + PDF upload */}
          <DelhiInvoiceSection poId={id} lines={data.lines} token={token} />
        </div>
      )}
    </AdminLayout>
  );
}

// R27.4 BUG-6 (item-level invoice selection) + BUG-14 (invoice PDF upload widget).
function DelhiInvoiceSection({ poId, lines, token }: { poId: number; lines: any[]; token: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: invoices } = useQuery<any[]>({
    queryKey: ["admin-po-invoices", poId],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/purchase-orders/${poId}/invoices`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token && !Number.isNaN(poId),
  });

  const toggle = (lineId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
  };
  const allIds = lines.map((l: any) => l.id).filter((x: any) => x != null);
  const allSelected = allIds.length > 0 && allIds.every((idv: number) => selected.has(idv));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));

  const uploadPdf = async (file: File) => {
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await adminFetch(token, `/api/admin/upload-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setPdfUrl(j.url || j.path);
      toast({ title: "Invoice PDF uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (selected.size > 0) body.item_ids = Array.from(selected);
      if (invoiceNumber.trim()) body.invoice_number = invoiceNumber.trim();
      if (invoiceDate) body.invoice_date = invoiceDate;
      if (pdfUrl) body.invoice_pdf_url = pdfUrl;
      const r = await adminFetch(token, `/api/admin/purchase-orders/${poId}/delhi-invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Failed to create invoice");
      return j;
    },
    onSuccess: () => {
      toast({ title: "Delhi invoice created", description: selected.size > 0 ? `${selected.size} item(s) invoiced.` : "All items invoiced." });
      setSelected(new Set()); setInvoiceNumber(""); setInvoiceDate(""); setPdfUrl("");
      qc.invalidateQueries({ queryKey: ["admin-po-invoices", poId] });
    },
    onError: (e: any) => toast({ title: "Could not create invoice", description: e.message, variant: "destructive" }),
  });

  // R27.8 #10 — standalone PDF upload for an existing invoice row (multipart).
  const [rowUploading, setRowUploading] = useState<number | null>(null);
  const uploadRowPdf = async (invoiceId: number, file: File) => {
    setRowUploading(invoiceId);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const r = await adminFetch(token, `/api/admin/invoice/${invoiceId}/upload-pdf`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Upload failed");
      toast({ title: "Invoice PDF attached" });
      qc.invalidateQueries({ queryKey: ["admin-po-invoices", poId] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally { setRowUploading(null); }
  };

  return (
    <Section title="Delhi Invoice" icon={FileText}>
      <div className="p-4 space-y-4">
        {lines.length === 0 ? (
          <Empty>No line items to invoice.</Empty>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">Select the line items this invoice covers (leave all unchecked to invoice everything).</div>
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} data-testid="invoice-select-all" /></th>
                  <th className="px-3 py-2 font-semibold">Part #</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 font-semibold text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l: any, i: number) => (
                  <tr key={l.id ?? i}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} disabled={l.id == null} data-testid={`invoice-item-${l.id}`} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.partNumber || l.part_number || "—"}</td>
                    <td className="px-3 py-2 text-xs">{l.description || l.name || "—"}</td>
                    <td className="px-3 py-2 text-right">{Number(l.qty ?? l.quantity ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Invoice Number</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="INV-…" data-testid="invoice-number" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Invoice Date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" data-testid="invoice-date" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Invoice PDF</label>
                <label className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                  <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : pdfUrl ? "Replace PDF" : "Upload PDF"}
                  <input type="file" accept="application/pdf,image/*" className="hidden" data-testid="invoice-pdf-upload"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(f); }} />
                </label>
                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"><ExternalLink className="w-3 h-3" /> View uploaded</a>}
              </div>
            </div>

            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              data-testid="button-create-delhi-invoice"
            >
              <FileText className="w-4 h-4" /> {createMut.isPending ? "Creating…" : "Create Delhi Invoice"}
            </button>
          </>
        )}

        {invoices && invoices.length > 0 && (
          <div className="mt-2">
            <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Existing Invoices</div>
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold">Kind</th>
                  <th className="px-3 py-2 font-semibold">Number</th>
                  <th className="px-3 py-2 font-semibold">Items</th>
                  <th className="px-3 py-2 font-semibold text-right">Total</th>
                  <th className="px-3 py-2 font-semibold">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((iv: any) => {
                  let itemCount = "all";
                  try { const ids = iv.item_ids_json ? JSON.parse(iv.item_ids_json) : null; if (Array.isArray(ids)) itemCount = String(ids.length); } catch {}
                  return (
                    <tr key={iv.id}>
                      <td className="px-3 py-2 text-xs">{iv.kind}</td>
                      <td className="px-3 py-2 text-xs">{iv.invoice_number || "—"}</td>
                      <td className="px-3 py-2 text-xs">{itemCount}</td>
                      <td className="px-3 py-2 text-right">{inr(iv.total)}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          {iv.invoice_pdf_url && <a href={iv.invoice_pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View</a>}
                          <label className="inline-flex items-center gap-1 border rounded px-2 py-1 cursor-pointer hover:bg-muted" data-testid={`row-upload-pdf-${iv.id}`}>
                            <Upload className="w-3 h-3" /> {rowUploading === iv.id ? "Uploading…" : iv.invoice_pdf_url ? "Replace" : "Upload"}
                            <input type="file" accept="application/pdf" className="hidden"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRowPdf(iv.id, f); e.currentTarget.value = ""; }} />
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
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
