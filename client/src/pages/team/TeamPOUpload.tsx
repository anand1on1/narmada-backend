/**
 * R8 — PO Upload Wizard (Team Portal)
 * 4-step wizard: Select Customer → Upload PDF → AI Review & Edit → Confirm
 */
import { useState, useRef } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Upload, ChevronRight, ChevronLeft, Check, Loader2, X, Plus } from "lucide-react";
import { CompanyPicker } from "@/components/common/CompanyPicker";

interface Customer { id: number; name: string; }
interface ParsedItem {
  partNumber: string | null;
  brand: string | null;
  description: string | null;
  qty: number;
  customerRate: number | null;
}
interface ParsedData {
  customerName: string | null;
  customerPoNumber: string | null;
  poDate: string | null;
  shipTo: { name: string | null; address: string | null; phone: string | null } | null;
  items: ParsedItem[];
}

type Step = 1 | 2 | 3 | 4;

export default function TeamPOUpload() {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<Step>(1);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedData>({ customerName: null, customerPoNumber: null, poDate: null, shipTo: null, items: [] });
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["team-customers"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/customers`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
  });

  // Step 2 → 3: upload and parse
  async function uploadAndParse() {
    if (!file || !customerId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("customer_id", customerId);
      if (companyId != null) form.append("company_id", String(companyId));
      const r = await fetch(`${(window as any).__API_BASE__ || ""}/api/team/po/upload-customer-po`, {
        method: "POST",
        headers: { "x-team-token": token || "" },
        body: form,
      });
      const j = await r.json();
      // 422 = extraction returned 0 items. The server still sends a blank editable
      // row so the operator can type lines manually — fall through and show step 3.
      if (!r.ok && r.status !== 422) {
        toast({ title: "Upload failed", description: j.error, variant: "destructive" });
        return;
      }
      if (r.status === 422) {
        toast({ title: "No items auto-detected", description: "Please enter the line items manually.", variant: "destructive" });
      }
      setFileUrl(j.fileUrl || "");
      const p: ParsedData = j.parsed || { customerName: null, customerPoNumber: null, poDate: null, shipTo: null, items: [] };
      // Ensure at least one editable row exists
      if (!p.items || p.items.length === 0) {
        p.items = [{ partNumber: "", brand: "", description: "", qty: 1, customerRate: null }];
      }
      setParsed(p);
      setStep(3);
    } catch (e: any) {
      toast({ title: "Upload error", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // Step 4: create PO
  async function createPO() {
    if (!token) return;
    setCreating(true);
    try {
      const r = await teamFetch(token, `/api/team/po/create-from-parsed`, {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          company_id: companyId,
          customer_po_number: parsed.customerPoNumber || "",
          po_date: parsed.poDate || "",
          customer_po_url: fileUrl,
          ship_to_name: parsed.shipTo?.name || "",
          ship_to_address: parsed.shipTo?.address || "",
          ship_to_phone: parsed.shipTo?.phone || "",
          items: parsed.items,
        }),
      });
      const j = await r.json();
      if (!r.ok) { toast({ title: "Failed to create PO", description: j.error, variant: "destructive" }); return; }
      toast({ title: `PO ${j.poNumber} created!`, description: "Assign sellers from the PO list." });
      // R11: vendor assignment happens later on the merged PO page — return to the list.
      navigate(`/team/purchase-orders`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  function setItem(idx: number, field: keyof ParsedItem, value: any) {
    const next = [...parsed.items];
    (next[idx] as any)[field] = value;
    setParsed({ ...parsed, items: next });
  }

  function addItem() {
    setParsed({ ...parsed, items: [...parsed.items, { partNumber: "", brand: "", description: "", qty: 1, customerRate: null }] });
  }

  function removeItem(idx: number) {
    setParsed({ ...parsed, items: parsed.items.filter((_, i) => i !== idx) });
  }

  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  return (
    <TeamLayout title="Upload Customer PO">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-8">
        {([1, 2, 3, 4] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step > s ? "bg-emerald-500 text-white" :
              step === s ? "bg-accent text-accent-foreground" :
              "bg-muted text-muted-foreground"
            }`}>
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            <span className={`text-xs font-semibold hidden sm:block ${step === s ? "text-foreground" : "text-muted-foreground"}`}>
              {["Select Customer", "Upload PDF", "Review & Edit", "Confirm"][i]}
            </span>
            {i < 3 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <div className="bg-card border rounded-xl p-6 shadow-sm max-w-3xl">
        {/* Step 1: Select Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg">Step 1: Select Company & Customer</h2>
            <p className="text-sm text-muted-foreground">Choose which of our companies the order is for, then the customer.</p>
            <label className="text-xs font-semibold block">Ordered Company *
              <div className="mt-1">
                <CompanyPicker value={companyId} onChange={setCompanyId} required />
              </div>
            </label>
            <label className="text-xs font-semibold block">Customer *
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-background text-sm font-normal"
              >
                <option value="">— Select customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!customerId || companyId == null}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Upload PDF */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg">Step 2: Upload Customer PO (PDF or Image)</h2>
            <p className="text-sm text-muted-foreground">
              Customer: <strong>{selectedCustomer?.name}</strong>
            </p>
            <div
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                file ? "border-emerald-400 bg-emerald-50" : "border-muted hover:border-accent"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {file ? (
                <div>
                  <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="font-semibold text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-semibold">Click to upload PDF / Image</p>
                  <p className="text-xs text-muted-foreground mt-1">Max 20MB · PDF, JPG, PNG</p>
                </div>
              )}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={uploadAndParse}
                disabled={!file || uploading}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Parsing…</> : <>Upload & Parse <ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Edit */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg">Step 3: Review & Edit Extracted Data</h2>
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Parsed values shown. Verify before saving.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold block">Customer PO Number
                <input
                  value={parsed.customerPoNumber || ""}
                  onChange={(e) => setParsed({ ...parsed, customerPoNumber: e.target.value })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                  placeholder="e.g. PO/2026/001"
                />
              </label>
              <label className="text-xs font-semibold block">PO Date
                <input
                  value={parsed.poDate || ""}
                  onChange={(e) => setParsed({ ...parsed, poDate: e.target.value })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="text-xs font-semibold block">Ship To Name
                <input
                  value={parsed.shipTo?.name || ""}
                  onChange={(e) => setParsed({ ...parsed, shipTo: { ...parsed.shipTo, name: e.target.value, address: parsed.shipTo?.address || null, phone: parsed.shipTo?.phone || null } })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                  placeholder="Recipient name"
                />
              </label>
              <label className="text-xs font-semibold block col-span-2">Ship To Address
                <input
                  value={parsed.shipTo?.address || ""}
                  onChange={(e) => setParsed({ ...parsed, shipTo: { name: parsed.shipTo?.name || null, ...parsed.shipTo, address: e.target.value, phone: parsed.shipTo?.phone || null } })}
                  className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                  placeholder="Delivery address"
                />
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Line Items ({parsed.items.length})</div>
                <button type="button" onClick={addItem} className="px-2.5 py-1 border rounded text-xs font-semibold inline-flex items-center gap-1 hover:bg-muted">
                  <Plus className="w-3 h-3" /> Add Row
                </button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-2 text-left">Part #</th>
                      <th className="px-2 py-2 text-left">Brand</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right w-16">Qty</th>
                      <th className="px-2 py-2 text-right w-24">Cust. Rate ₹</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsed.items.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No items extracted. Add rows manually.</td></tr>
                    )}
                    {parsed.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-2 py-1">
                          <input value={item.partNumber || ""} onChange={(e) => setItem(idx, "partNumber", e.target.value)}
                            className="w-full border rounded px-1.5 py-1 bg-background font-mono" placeholder="Part #" />
                        </td>
                        <td className="px-2 py-1">
                          <input value={item.brand || ""} onChange={(e) => setItem(idx, "brand", e.target.value)}
                            className="w-full border rounded px-1.5 py-1 bg-background" placeholder="Brand" />
                        </td>
                        <td className="px-2 py-1">
                          <input value={item.description || ""} onChange={(e) => setItem(idx, "description", e.target.value)}
                            className="w-full border rounded px-1.5 py-1 bg-background" placeholder="Description" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={1} value={item.qty} onChange={(e) => setItem(idx, "qty", parseFloat(e.target.value) || 1)}
                            className="w-full border rounded px-1.5 py-1 bg-background text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" value={item.customerRate ?? ""} onChange={(e) => setItem(idx, "customerRate", e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-full border rounded px-1.5 py-1 bg-background text-right" placeholder="0" />
                        </td>
                        <td className="px-1 py-1">
                          <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700"><X className="w-3 h-3" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={parsed.items.length === 0}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                Review & Confirm <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="font-bold text-lg">Step 4: Confirm & Create PO</h2>
            <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-1">
              <div><span className="font-semibold">Customer:</span> {selectedCustomer?.name}</div>
              <div><span className="font-semibold">Customer PO #:</span> {parsed.customerPoNumber || "—"}</div>
              <div><span className="font-semibold">PO Date:</span> {parsed.poDate || "—"}</div>
              <div><span className="font-semibold">Ship To:</span> {parsed.shipTo?.name || "—"} {parsed.shipTo?.address ? `— ${parsed.shipTo.address}` : ""}</div>
              <div><span className="font-semibold">Items:</span> {parsed.items.length} line item(s)</div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Part #</th>
                    <th className="px-3 py-2 text-left">Brand</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Rate ₹</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-1.5 font-mono">{item.partNumber || "—"}</td>
                      <td className="px-3 py-1.5">{item.brand || "—"}</td>
                      <td className="px-3 py-1.5 text-right">{item.qty}</td>
                      <td className="px-3 py-1.5 text-right">{item.customerRate != null ? `₹${item.customerRate.toLocaleString("en-IN")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(3)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2">
                <ChevronLeft className="w-4 h-4" /> Edit
              </button>
              <button
                onClick={createPO}
                disabled={creating}
                className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Check className="w-4 h-4" /> Create PO</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </TeamLayout>
  );
}
