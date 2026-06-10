import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight, ChevronLeft, Plus, Trash2, Upload, Search, Check,
  FileText, RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuotingCompany {
  id: number; name: string; gstin: string | null; quotePrefix: string | null;
  logoUrl: string | null; active: boolean;
}

interface Customer { id: number; name: string; phone: string | null; gstNumber: string | null; }

interface LineItem {
  lineNo: number;
  partNumber: string;
  productName: string;
  hsn: string;
  brand: string;
  qty: number;
  mrp: number;
  discount: number;
  gstPct: number;
  lineTotal: number;
  source: "manual" | "import";
}

const emptyLine = (): LineItem => ({
  lineNo: 0, partNumber: "", productName: "", hsn: "", brand: "",
  qty: 1, mrp: 0, discount: 0, gstPct: 18, lineTotal: 0, source: "manual",
});

const CURRENCIES = ["INR", "USD", "EUR", "AED"];

function computeLine(line: LineItem): LineItem {
  const base = line.mrp * line.qty;
  const afterDiscount = base * (1 - (line.discount || 0) / 100);
  const withGst = afterDiscount * (1 + (line.gstPct || 0) / 100);
  return { ...line, lineTotal: Math.round(withGst * 100) / 100 };
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

const STEPS = ["Company", "Customer", "Items", "Currency", "Finish"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition ${i < step ? "bg-emerald-600 text-white" : i === step ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
            {i < step ? <Check className="w-3 h-3" /> : i + 1}
          </div>
          <span className={`text-xs font-semibold truncate ${i === step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
          {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TeamQuotationNew() {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [step, setStep] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<QuotingCompany | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [importMode, setImportMode] = useState<"manual" | "import">("manual");
  const [items, setItems] = useState<LineItem[]>([emptyLine()]);
  const [currency, setCurrency] = useState("INR");
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Autocomplete state
  const [acPartIndex, setAcPartIndex] = useState<number | null>(null);
  const [acResults, setAcResults] = useState<any[]>([]);
  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Data fetches ──────────────────────────────────────────────────────────

  const { data: companies = [] } = useQuery<QuotingCompany[]>({
    queryKey: ["quoting-companies-team"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/quoting-companies");
      if (!r.ok) return [];
      const all: QuotingCompany[] = await r.json();
      return (Array.isArray(all) ? all : []).filter((c) => c.active);
    },
    enabled: !!token,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["customers-team", customerSearch],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (customerSearch.trim()) p.set("q", customerSearch.trim());
      const r = await teamFetch(token, `/api/team/customers?${p}`);
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    enabled: !!token,
  });

  // ─── FX rate ──────────────────────────────────────────────────────────────

  async function fetchFX(cur: string) {
    if (cur === "INR") { setFxRate(1); return; }
    setFxLoading(true);
    try {
      const r = await teamFetch(token, `/api/team/quotations/fx-rate?from=${cur}&to=INR`);
      if (r.ok) { const j = await r.json(); setFxRate(j.rate); }
      else setFxRate(null);
    } catch { setFxRate(null); }
    finally { setFxLoading(false); }
  }

  // ─── Part autocomplete ────────────────────────────────────────────────────

  function onPartNumberChange(idx: number, val: string) {
    updateLine(idx, { partNumber: val });
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    if (val.length >= 3) {
      acTimerRef.current = setTimeout(async () => {
        const r = await teamFetch(token, `/api/team/parts?q=${encodeURIComponent(val)}`);
        if (r.ok) { setAcResults(await r.json()); setAcPartIndex(idx); }
      }, 300);
    } else {
      setAcResults([]); setAcPartIndex(null);
    }
  }

  function applyAcResult(idx: number, part: any) {
    updateLine(idx, {
      partNumber: part.partNumber || part.part_number,
      productName: part.name,
      hsn: part.hsn || "",
      brand: part.brand || "",
      gstPct: part.gstRate || part.gst_rate || 18,
      mrp: part.lastMrp || part.last_mrp || 0,
    });
    setAcResults([]); setAcPartIndex(null);
  }

  // ─── Line item helpers ────────────────────────────────────────────────────

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = computeLine({ ...next[idx], ...patch });
      return next;
    });
  }

  function addLine() { setItems((prev) => [...prev, emptyLine()]); }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })));
  }

  // ─── Document import ──────────────────────────────────────────────────────

  async function handleImport(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await teamFetch(token, "/api/team/quotations/extract", { method: "POST", body: fd });
      if (!r.ok) { const e = await r.json(); toast({ title: "Import failed", description: e.error, variant: "destructive" }); return; }
      const parsed: any[] = await r.json();
      const lines: LineItem[] = parsed.map((p, i) => computeLine({
        lineNo: i + 1,
        partNumber: p.part_number || p.partNumber || "",
        productName: p.name || p.productName || "",
        hsn: p.hsn || "",
        brand: p.brand || "",
        qty: p.qty || 1,
        mrp: p.mrp || 0,
        discount: 0,
        gstPct: 18,
        lineTotal: 0,
        source: "import",
      }));
      if (lines.length) setItems(lines);
      toast({ title: `Imported ${lines.length} item(s)`, description: "Review and edit before saving." });
    } catch (e: any) {
      toast({ title: "Import error", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // ─── Grand total ──────────────────────────────────────────────────────────

  const grandTotal = items.reduce((s, l) => s + (l.lineTotal || 0), 0);
  const subtotal = items.reduce((s, l) => s + l.mrp * l.qty * (1 - l.discount / 100), 0);

  // ─── Save ─────────────────────────────────────────────────────────────────

  async function saveDraft() {
    if (!selectedCompany || !selectedCustomer) return;
    setSaving(true);
    try {
      const payload = {
        quotingCompanyId: selectedCompany.id,
        customerId: selectedCustomer.id,
        currency,
        fxRate: fxRate || 1,
        notes, terms, validUntil: validUntil || null,
        items: items.map((l, i) => ({ ...l, lineNo: i + 1 })),
      };
      const r = await teamFetch(token, "/api/team/quotations", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      const created = await r.json();
      toast({ title: "Draft saved", description: `Quotation ${created.quoteNo} created.` });
      navigate(`/team/quotations/${created.id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveAndFinalize() {
    if (!selectedCompany || !selectedCustomer) return;
    setSaving(true);
    try {
      const payload = {
        quotingCompanyId: selectedCompany.id,
        customerId: selectedCustomer.id,
        currency,
        fxRate: fxRate || 1,
        notes, terms, validUntil: validUntil || null,
        items: items.map((l, i) => ({ ...l, lineNo: i + 1 })),
      };
      const r = await teamFetch(token, "/api/team/quotations", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      const created = await r.json();

      const rf = await teamFetch(token, `/api/team/quotations/${created.id}/finalize`, { method: "POST" });
      if (!rf.ok) { const e = await rf.json(); throw new Error(e.error || "Finalize failed"); }
      toast({ title: "Quotation sent!", description: `${created.quoteNo} finalized and sent to customer.` });
      navigate(`/team/quotations/${created.id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <TeamLayout title="New Quotation">
      <div className="max-w-4xl mx-auto">
        <StepBar step={step} />

        {/* Step 0: Pick company */}
        {step === 0 && (
          <div>
            <h2 className="font-semibold text-lg mb-4">Select Quoting Company</h2>
            {companies.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground border rounded-xl">
                No quoting companies configured. Ask admin to add one.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {companies.map((c) => (
                  <button key={c.id} onClick={() => setSelectedCompany(c)}
                    className={`border-2 rounded-xl p-4 text-left transition ${selectedCompany?.id === c.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}`}>
                    {c.logoUrl && <img src={c.logoUrl} alt={c.name} className="h-10 object-contain mb-2" />}
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">GSTIN: {c.gstin || "—"}</div>
                    <div className="text-xs text-muted-foreground">Prefix: <span className="font-mono font-bold">{c.quotePrefix || "—"}</span></div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button onClick={() => setStep(1)} disabled={!selectedCompany}
                className="px-6 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Pick customer */}
        {step === 1 && (
          <div>
            <h2 className="font-semibold text-lg mb-4">Select Customer</h2>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customers…"
                className="w-full border rounded-lg pl-9 pr-3 py-2 bg-background text-sm" />
            </div>
            <div className="border rounded-xl divide-y max-h-80 overflow-y-auto">
              {customers.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No customers found.</div>
              ) : customers.slice(0, 20).map((c) => (
                <button key={c.id} onClick={() => setSelectedCustomer(c)}
                  className={`w-full text-left p-3 flex items-center gap-3 hover:bg-muted/50 transition ${selectedCustomer?.id === c.id ? "bg-accent/10" : ""}`}>
                  <div className={`w-5 h-5 rounded-full border-2 ${selectedCustomer?.id === c.id ? "border-accent bg-accent" : "border-muted-foreground"} flex items-center justify-center shrink-0`}>
                    {selectedCustomer?.id === c.id && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone || ""} {c.gstNumber ? `· GST: ${c.gstNumber}` : ""}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(0)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setStep(2)} disabled={!selectedCustomer}
                className="px-6 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Items */}
        {step === 2 && (
          <div>
            <div className="flex gap-3 mb-4">
              {(["manual", "import"] as const).map((m) => (
                <button key={m} onClick={() => setImportMode(m)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${importMode === m ? "bg-accent text-accent-foreground border-accent" : "hover:bg-muted"}`}>
                  {m === "manual" ? "Manual Entry" : "Import from Document"}
                </button>
              ))}
            </div>

            {importMode === "import" && (
              <div className="border-2 border-dashed rounded-xl p-8 text-center mb-4">
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">Upload PDF, Excel, or image — AI will extract parts list</p>
                <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                  {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</> : <><Upload className="w-4 h-4" /> Choose File</>}
                </button>
              </div>
            )}

            {/* Editable table */}
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="px-2 py-2 min-w-[120px]">Part No</th>
                    <th className="px-2 py-2 min-w-[160px]">Name</th>
                    <th className="px-2 py-2 w-20">HSN</th>
                    <th className="px-2 py-2 w-24">Brand</th>
                    <th className="px-2 py-2 w-14">Qty</th>
                    <th className="px-2 py-2 w-20">MRP</th>
                    <th className="px-2 py-2 w-16">Disc%</th>
                    <th className="px-2 py-2 w-16">GST%</th>
                    <th className="px-2 py-2 w-24 text-right">Total</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((line, idx) => (
                    <tr key={idx} className="hover:bg-muted/20">
                      <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                      <td className="px-2 py-1 relative">
                        <input value={line.partNumber} onChange={(e) => onPartNumberChange(idx, e.target.value)}
                          className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" placeholder="Part #" />
                        {acPartIndex === idx && acResults.length > 0 && (
                          <div className="absolute z-20 top-full left-0 mt-1 bg-card border rounded-lg shadow-lg w-56 max-h-40 overflow-y-auto">
                            {acResults.map((p: any) => (
                              <button key={p.id} onClick={() => applyAcResult(idx, p)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted">
                                <div className="font-mono font-semibold">{p.partNumber || p.part_number}</div>
                                <div className="text-muted-foreground truncate">{p.name}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <input value={line.productName} onChange={(e) => updateLine(idx, { productName: e.target.value })}
                          className="w-full border rounded px-1.5 py-1 bg-background text-xs" placeholder="Product name" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={line.hsn} onChange={(e) => updateLine(idx, { hsn: e.target.value })}
                          className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={line.brand} onChange={(e) => updateLine(idx, { brand: e.target.value })}
                          className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" min={1} value={line.qty} onChange={(e) => updateLine(idx, { qty: parseFloat(e.target.value) || 1 })}
                          className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" min={0} value={line.mrp} onChange={(e) => updateLine(idx, { mrp: parseFloat(e.target.value) || 0 })}
                          className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" min={0} max={100} value={line.discount} onChange={(e) => updateLine(idx, { discount: parseFloat(e.target.value) || 0 })}
                          className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <select value={line.gstPct} onChange={(e) => updateLine(idx, { gstPct: parseFloat(e.target.value) })}
                          className="w-full border rounded px-1 py-1 bg-background text-xs">
                          {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right font-semibold">
                        ₹{line.lineTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-1">
                        {items.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="p-1 hover:bg-red-100 rounded text-red-500">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={9} className="px-3 py-2 text-right">Grand Total</td>
                    <td className="px-3 py-2 text-right text-base">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-3">
              <button onClick={addLine} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted">
                <Plus className="w-4 h-4" /> Add Row
              </button>
            </div>
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(1)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => { setStep(3); fetchFX(currency); }}
                disabled={items.every((l) => !l.productName && !l.partNumber)}
                className="px-6 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Currency */}
        {step === 3 && (
          <div>
            <h2 className="font-semibold text-lg mb-4">Currency &amp; FX Rate</h2>
            <div className="flex gap-3 mb-4 flex-wrap">
              {CURRENCIES.map((c) => (
                <button key={c} onClick={() => { setCurrency(c); fetchFX(c); }}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-bold transition ${currency === c ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}>
                  {c}
                </button>
              ))}
            </div>
            {currency !== "INR" && (
              <div className="bg-muted rounded-xl p-4 text-sm space-y-1">
                {fxLoading ? (
                  <div className="text-muted-foreground">Fetching FX rate…</div>
                ) : fxRate ? (
                  <>
                    <div><span className="font-semibold">1 {currency} = ₹{fxRate?.toFixed(4)}</span> <span className="text-muted-foreground text-xs">(locked at creation)</span></div>
                    <div className="text-muted-foreground">Grand total in {currency}: {currency} {(grandTotal / fxRate).toFixed(2)}</div>
                  </>
                ) : (
                  <div className="text-red-600">Could not fetch FX rate. Will save as INR equivalent.</div>
                )}
                <button onClick={() => fetchFX(currency)} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh rate
                </button>
              </div>
            )}
            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(2)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setStep(4)}
                className="px-6 py-2.5 bg-accent text-accent-foreground rounded-lg font-semibold inline-flex items-center gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Notes + finish */}
        {step === 4 && (
          <div>
            <h2 className="font-semibold text-lg mb-4">Notes &amp; Terms</h2>
            <div className="space-y-4">
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Valid Until</div>
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                  className="border rounded-lg px-3 py-2 bg-background" />
              </label>
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes</div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  className="w-full border rounded-lg px-3 py-2 bg-background text-sm" placeholder="Internal notes or special conditions…" />
              </label>
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Terms &amp; Conditions</div>
                <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4}
                  className="w-full border rounded-lg px-3 py-2 bg-background text-sm" placeholder="Payment terms, delivery terms…" />
              </label>
            </div>

            {/* Summary */}
            <div className="mt-4 bg-muted rounded-xl p-4 text-sm space-y-1">
              <div className="font-semibold text-base">Summary</div>
              <div><span className="text-muted-foreground">Company:</span> {selectedCompany?.name}</div>
              <div><span className="text-muted-foreground">Customer:</span> {selectedCustomer?.name}</div>
              <div><span className="text-muted-foreground">Items:</span> {items.filter((l) => l.productName || l.partNumber).length}</div>
              <div><span className="text-muted-foreground">Total:</span> <strong>₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></div>
              <div><span className="text-muted-foreground">Currency:</span> {currency}</div>
            </div>

            <div className="mt-6 flex justify-between flex-wrap gap-2">
              <button onClick={() => setStep(3)} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <div className="flex gap-2">
                <button onClick={saveDraft} disabled={saving}
                  className="px-5 py-2.5 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
                  <FileText className="w-4 h-4" /> {saving ? "Saving…" : "Save as Draft"}
                </button>
                <button onClick={saveAndFinalize} disabled={saving}
                  className="px-5 py-2.5 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                  {saving ? "Processing…" : "Save & Finalize →"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TeamLayout>
  );
}
