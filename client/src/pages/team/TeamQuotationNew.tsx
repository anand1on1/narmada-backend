import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight, ChevronLeft, Plus, Trash2, Upload, Search, Check,
  FileText, RefreshCw, Sparkles, Truck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuotingCompany {
  id: number; name: string; gstin: string | null; quotePrefix: string | null;
  logoUrl: string | null; active: boolean;
}

interface Customer {
  id: number; name: string; phone: string | null; email?: string | null; gstNumber: string | null;
  defaultDiscountPct?: number | null;
  address?: string | null; city?: string | null; state?: string | null; pincode?: string | null;
}

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

const emptyLine = (defaultDisc = 0): LineItem => ({
  lineNo: 0, partNumber: "", productName: "", hsn: "", brand: "",
  qty: 1, mrp: 0, discount: defaultDisc, gstPct: 18, lineTotal: 0, source: "manual",
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
  const [matchingPrices, setMatchingPrices] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Round 3: shipping address (overrides customer billing for this quote)
  const [shipOpen, setShipOpen] = useState(false);
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingState, setShippingState] = useState("");
  const [shippingPincode, setShippingPincode] = useState("");
  const [shippingPhone, setShippingPhone] = useState("");

  // Round 3: AI prompt
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // Autocomplete state (works for both Part No. and Description)
  const [acPartIndex, setAcPartIndex] = useState<number | null>(null);
  const [acField, setAcField] = useState<"part" | "name">("part");
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

  // Round 3: auto-apply default discount to empty lines when a customer is picked.
  useEffect(() => {
    if (!selectedCustomer) return;
    const dd = selectedCustomer.defaultDiscountPct;
    if (dd == null || dd === 0) return;
    setItems((prev) =>
      prev.map((l) => {
        // Only touch rows where the user hasn't set a non-zero discount yet.
        if (l.discount && l.discount !== 0) return l;
        return computeLine({ ...l, discount: dd });
      }),
    );
  }, [selectedCustomer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Part autocomplete (works from BOTH Part No. and Description) ──────────

  function triggerAutocomplete(idx: number, val: string, field: "part" | "name") {
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    if (val.length >= 2) {
      acTimerRef.current = setTimeout(async () => {
        try {
          const r = await teamFetch(token, `/api/team/part-suggestions?q=${encodeURIComponent(val)}&limit=10`);
          if (r.ok) { setAcResults(await r.json()); setAcPartIndex(idx); setAcField(field); }
        } catch { /* ignore network errors during autocomplete */ }
      }, 250);
    } else {
      setAcResults([]); setAcPartIndex(null);
    }
  }

  function onPartNumberChange(idx: number, val: string) {
    updateLine(idx, { partNumber: val });
    triggerAutocomplete(idx, val, "part");
  }

  function onProductNameChange(idx: number, val: string) {
    updateLine(idx, { productName: val });
    triggerAutocomplete(idx, val, "name");
  }

  function applyAcResult(idx: number, part: any) {
    // Focus the qty input after filling the line item (quantity is the natural next field)
    const rowEl = document.querySelector<HTMLInputElement>(`[data-qty-idx="${idx}"]`);
    const defaultDisc = selectedCustomer?.defaultDiscountPct ?? 0;
    updateLine(idx, {
      partNumber: part.partNumber || part.part_number || "",
      productName: part.productName || part.name || "",
      brand: part.brand || "",
      mrp: part.mrp || 0,
      hsn: part.hsnCode || "",
      gstPct: part.gstPercent ?? items[idx]?.gstPct ?? 18,
      discount: items[idx]?.discount || defaultDisc,
    });
    setAcResults([]); setAcPartIndex(null);
    if (rowEl) setTimeout(() => rowEl.focus(), 50);
  }

  // ─── Line item helpers ────────────────────────────────────────────────────

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = computeLine({ ...next[idx], ...patch });
      return next;
    });
  }

  function addLine() {
    const dd = selectedCustomer?.defaultDiscountPct ?? 0;
    setItems((prev) => [...prev, emptyLine(dd)]);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })));
  }

  // ─── Document import (Round 3: APPEND + de-dupe instead of REPLACE) ──────

  async function handleImport(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await teamFetch(token, "/api/team/quotations/extract", { method: "POST", body: fd });
      if (!r.ok) { const e = await r.json(); toast({ title: "Import failed", description: e.error, variant: "destructive" }); return; }
      const json = await r.json();
      const parsed: any[] = Array.isArray(json) ? json : Array.isArray(json?.parts) ? json.parts : [];
      if (!parsed.length) { toast({ title: "No items detected", description: "The document parser returned no rows. Try a clearer file.", variant: "destructive" }); return; }
      const defaultDisc = selectedCustomer?.defaultDiscountPct ?? 0;
      const newLines: LineItem[] = parsed.map((p) => computeLine({
        lineNo: 0,
        partNumber: p.part_number || p.partNumber || "",
        productName: p.name || p.productName || "",
        hsn: p.hsn || "",
        brand: p.brand || "",
        qty: p.qty || 1,
        mrp: p.mrp || 0,
        discount: defaultDisc,
        gstPct: 18,
        lineTotal: 0,
        source: "import",
      }));

      // Round 3: APPEND to existing items instead of replacing; drop blank starter rows
      // and de-duplicate by partNumber (or productName when partNumber is empty).
      setItems((prev) => {
        const nonBlankExisting = prev.filter((l) => l.partNumber || l.productName);
        const merged = [...nonBlankExisting];
        const seen = new Set(
          merged.map((l) => (l.partNumber || `name:${l.productName}`).toLowerCase()),
        );
        let added = 0;
        let skipped = 0;
        for (const nl of newLines) {
          const key = (nl.partNumber || `name:${nl.productName}`).toLowerCase();
          if (!key.trim() || key === "name:") continue;
          if (seen.has(key)) { skipped++; continue; }
          seen.add(key);
          merged.push(nl);
          added++;
        }
        const renumbered = merged.map((l, i) => ({ ...l, lineNo: i + 1 }));
        toast({
          title: `Appended ${added} item(s)`,
          description: skipped > 0 ? `Skipped ${skipped} duplicate(s).` : "Review and edit before saving.",
        });
        return renumbered.length > 0 ? renumbered : [emptyLine(defaultDisc)];
      });
    } catch (e: any) {
      toast({ title: "Import error", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  // ─── Match prices from price list (Phase 2) ───────────────────────────────

  async function handleMatchPrices() {
    setMatchingPrices(true);
    try {
      const lines = items.map((l, i) => ({ ...l, lineNo: i + 1 }));
      const r = await teamFetch(token, "/api/team/quotes/match-price-list", {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      if (!r.ok) { const e = await r.json(); toast({ title: "Match failed", description: e.error, variant: "destructive" }); return; }
      const json = await r.json();
      const updatedLines: LineItem[] = (json.lines || []).map((p: any, i: number) => computeLine({
        lineNo: i + 1,
        partNumber: p.partNumber || p.part_number || "",
        productName: p.productName || p.name || "",
        hsn: p.hsn || "",
        brand: p.brand || "",
        qty: p.qty || 1,
        mrp: p.mrp || 0,
        discount: p.discount || 0,
        gstPct: p.gstPct || p.gstPercent || 18,
        lineTotal: 0,
        source: p.source || "import",
      }));
      if (updatedLines.length) setItems(updatedLines);
      toast({ title: `Matched ${json.matchedCount} of ${json.matchedCount + json.unmatchedCount} items from price list` });
    } catch (e: any) {
      toast({ title: "Match error", description: e.message, variant: "destructive" });
    } finally {
      setMatchingPrices(false);
    }
  }

  // ─── Round 3: AI prompt — Claude edits line items in place ────────────────

  async function runAiPrompt() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const r = await teamFetch(token, "/api/team/quotations/ai-edit", {
        method: "POST",
        body: JSON.stringify({
          instruction: aiPrompt.trim(),
          items: items.map((l, i) => ({ ...l, lineNo: i + 1 })),
          context: {
            customerName: selectedCustomer?.name,
            companyName: selectedCompany?.name,
            currency,
          },
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "AI request failed"); }
      const json = await r.json();
      const updated: any[] = Array.isArray(json?.items) ? json.items : [];
      if (!updated.length) { toast({ title: "AI returned no changes" }); return; }
      const merged: LineItem[] = updated.map((p: any, i: number) => computeLine({
        lineNo: i + 1,
        partNumber: p.partNumber ?? "",
        productName: p.productName ?? "",
        hsn: p.hsn ?? "",
        brand: p.brand ?? "",
        qty: Number(p.qty) || 1,
        mrp: Number(p.mrp) || 0,
        discount: Number(p.discount) || 0,
        gstPct: Number(p.gstPct) || 18,
        lineTotal: 0,
        source: items[i]?.source || "manual",
      }));
      setItems(merged);
      toast({ title: "AI updated line items", description: json.summary || "Review the changes before saving." });
      setAiPrompt("");
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  // ─── Grand total ──────────────────────────────────────────────────────────

  const grandTotal = items.reduce((s, l) => s + (l.lineTotal || 0), 0);
  const subtotal = items.reduce((s, l) => s + l.mrp * l.qty * (1 - l.discount / 100), 0);

  // ─── Save ─────────────────────────────────────────────────────────────────

  function buildPayload() {
    return {
      quotingCompanyId: selectedCompany!.id,
      customerId: selectedCustomer!.id,
      currency,
      fxRate: fxRate || 1,
      notes, terms, validUntil: validUntil || null,
      shippingName: shippingName.trim() || null,
      shippingAddress: shippingAddress.trim() || null,
      shippingCity: shippingCity.trim() || null,
      shippingState: shippingState.trim() || null,
      shippingPincode: shippingPincode.trim() || null,
      shippingPhone: shippingPhone.trim() || null,
      items: items.map((l, i) => ({ ...l, lineNo: i + 1 })),
    };
  }

  async function saveDraft() {
    if (!selectedCompany || !selectedCustomer) return;
    setSaving(true);
    try {
      const r = await teamFetch(token, "/api/team/quotations", { method: "POST", body: JSON.stringify(buildPayload()) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      const resp = await r.json();
      const created = resp.quotation || resp;
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
      const r = await teamFetch(token, "/api/team/quotations", { method: "POST", body: JSON.stringify(buildPayload()) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      const resp = await r.json();
      const created = resp.quotation || resp;

      const rf = await teamFetch(token, `/api/team/quotations/${created.id}/finalize`, { method: "POST" });
      if (!rf.ok) { const e = await rf.json(); throw new Error(e.error || "Finalize failed"); }
      const finJson = await rf.json().catch(() => ({}));
      const emailInfo = finJson?.email;
      if (emailInfo && emailInfo.ok) {
        toast({ title: "Quotation sent", description: `${created.quoteNo} emailed to ${selectedCustomer.email || "customer"}.` });
      } else if (emailInfo && !emailInfo.ok) {
        toast({ title: "Saved, but email failed", description: emailInfo.error || "Check SMTP settings.", variant: "destructive" });
      } else {
        toast({ title: "Quotation finalized", description: `${created.quoteNo} ready.` });
      }
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
      <div className="max-w-5xl mx-auto">
        <StepBar step={step} />

        {/* Step 0: Pick company */}
        {step === 0 && (
          <div>
            <h2 className="font-semibold text-lg mb-4">Select Quoting Company</h2>
            {companies.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground border rounded-xl bg-card">
                No quoting companies configured. Ask admin to add one.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {companies.map((c) => (
                  <button key={c.id} onClick={() => setSelectedCompany(c)}
                    className={`border-2 rounded-xl p-4 text-left transition bg-card ${selectedCompany?.id === c.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}`}>
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
            <div className="border rounded-xl divide-y max-h-80 overflow-y-auto bg-card shadow-sm">
              {customers.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No customers found.</div>
              ) : customers.slice(0, 20).map((c) => (
                <button key={c.id} onClick={() => setSelectedCustomer(c)}
                  className={`w-full text-left p-3 flex items-center gap-3 hover:bg-muted/50 transition ${selectedCustomer?.id === c.id ? "bg-accent/10" : ""}`}>
                  <div className={`w-5 h-5 rounded-full border-2 ${selectedCustomer?.id === c.id ? "border-accent bg-accent" : "border-muted-foreground"} flex items-center justify-center shrink-0`}>
                    {selectedCustomer?.id === c.id && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[c.phone, c.gstNumber && `GST: ${c.gstNumber}`, c.defaultDiscountPct != null && `Default Disc: ${c.defaultDiscountPct}%`]
                        .filter(Boolean).join(" · ")}
                    </div>
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
              <div className="border-2 border-dashed rounded-xl p-8 text-center mb-4 bg-card">
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-1">Upload PDF, Excel, or image — AI will extract parts list</p>
                <p className="text-xs text-muted-foreground mb-3">Multiple uploads <strong>append</strong> to existing items (duplicates skipped by Part No.)</p>
                <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { handleImport(f); e.target.value = ""; }
                  }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                  {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</> : <><Upload className="w-4 h-4" /> Choose File</>}
                </button>
                <button onClick={handleMatchPrices} disabled={matchingPrices || uploading}
                  className="ml-2 px-4 py-2 border border-accent text-accent rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2 hover:bg-accent/10">
                  {matchingPrices ? <><RefreshCw className="w-4 h-4 animate-spin" /> Matching…</> : <><Search className="w-4 h-4" /> Match Prices from List</>}
                </button>
              </div>
            )}

            {/* AI prompt box (Round 3) */}
            <div className="border rounded-xl p-3 mb-4 bg-card shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                <Sparkles className="w-4 h-4 text-accent" />
                Ask AI to edit these items
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !aiBusy && runAiPrompt()}
                  placeholder="e.g. 'decrease all rates by 10%', 'fill missing HSN codes', 'set GST to 18% on all rows'"
                  className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
                <button onClick={runAiPrompt} disabled={aiBusy || !aiPrompt.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground disabled:opacity-50 inline-flex items-center justify-center gap-1 whitespace-nowrap">
                  {aiBusy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Thinking…</> : <><Sparkles className="w-4 h-4" /> Apply</>}
                </button>
              </div>
            </div>

            {/* Editable table (Round 3: compact, sticky header, fixed layout, scrollable container) */}
            <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 200 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 36 }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr className="text-left">
                      <th className="px-2 py-2 font-semibold">#</th>
                      <th className="px-2 py-2 font-semibold">Part No</th>
                      <th className="px-2 py-2 font-semibold">Description</th>
                      <th className="px-2 py-2 font-semibold">HSN</th>
                      <th className="px-2 py-2 font-semibold">Brand</th>
                      <th className="px-2 py-2 font-semibold text-right">Qty</th>
                      <th className="px-2 py-2 font-semibold text-right">MRP</th>
                      <th className="px-2 py-2 font-semibold text-right">Disc%</th>
                      <th className="px-2 py-2 font-semibold text-right">GST%</th>
                      <th className="px-2 py-2 font-semibold text-right">Total</th>
                      <th className="px-1 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((line, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                        <td className="px-1 py-1 relative">
                          <input value={line.partNumber} onChange={(e) => onPartNumberChange(idx, e.target.value)}
                            onFocus={() => line.partNumber.length >= 2 && triggerAutocomplete(idx, line.partNumber, "part")}
                            className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" placeholder="Part #" />
                          {acPartIndex === idx && acField === "part" && acResults.length > 0 && (
                            <AcDropdown results={acResults} onPick={(p) => applyAcResult(idx, p)} />
                          )}
                        </td>
                        <td className="px-1 py-1 relative">
                          <input value={line.productName} onChange={(e) => onProductNameChange(idx, e.target.value)}
                            onFocus={() => line.productName.length >= 2 && triggerAutocomplete(idx, line.productName, "name")}
                            className="w-full border rounded px-1.5 py-1 bg-background text-xs" placeholder="Description / product name" />
                          {acPartIndex === idx && acField === "name" && acResults.length > 0 && (
                            <AcDropdown results={acResults} onPick={(p) => applyAcResult(idx, p)} />
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <input value={line.hsn} onChange={(e) => updateLine(idx, { hsn: e.target.value })}
                            className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={line.brand} onChange={(e) => updateLine(idx, { brand: e.target.value })}
                            className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min={1} value={line.qty} onChange={(e) => updateLine(idx, { qty: parseFloat(e.target.value) || 1 })}
                            data-qty-idx={idx}
                            className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min={0} value={line.mrp} onChange={(e) => updateLine(idx, { mrp: parseFloat(e.target.value) || 0 })}
                            className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min={0} max={100} value={line.discount} onChange={(e) => updateLine(idx, { discount: parseFloat(e.target.value) || 0 })}
                            className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={line.gstPct} onChange={(e) => updateLine(idx, { gstPct: parseFloat(e.target.value) })}
                            className="w-full border rounded px-1 py-1 bg-background text-xs">
                            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right font-semibold text-xs">
                          ₹{line.lineTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-1 py-1">
                          {items.length > 1 && (
                            <button onClick={() => removeLine(idx)} className="p-1 hover:bg-red-100 dark:hover:bg-red-950/30 rounded text-red-500">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t bg-muted/30 px-4 py-2 flex justify-end items-center gap-6 text-sm">
                <span className="text-muted-foreground">Grand Total</span>
                <span className="font-bold text-base">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="mt-3">
              <button onClick={addLine} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted">
                <Plus className="w-4 h-4" /> Add Row
              </button>
              <button onClick={handleMatchPrices} disabled={matchingPrices}
                className="ml-2 px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
                {matchingPrices ? <><RefreshCw className="w-4 h-4 animate-spin" /> Matching…</> : <><Search className="w-4 h-4" /> Match Prices from List</>}
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

        {/* Step 4: Notes + Shipping + finish */}
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

              {/* Shipping address (Round 3) */}
              <div className="border rounded-xl bg-card shadow-sm">
                <button type="button" onClick={() => setShipOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30">
                  <span className="inline-flex items-center gap-2"><Truck className="w-4 h-4 text-accent" /> Ship To (different from billing)</span>
                  <ChevronRight className={`w-4 h-4 transition ${shipOpen ? "rotate-90" : ""}`} />
                </button>
                {shipOpen && (
                  <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <FieldRow label="Site / Contact Name" value={shippingName} onChange={setShippingName} placeholder={selectedCustomer?.name || ""} />
                    <FieldRow label="Phone" value={shippingPhone} onChange={setShippingPhone} />
                    <div className="sm:col-span-2">
                      <FieldRow label="Address" value={shippingAddress} onChange={setShippingAddress} />
                    </div>
                    <FieldRow label="City" value={shippingCity} onChange={setShippingCity} />
                    <FieldRow label="State" value={shippingState} onChange={setShippingState} />
                    <FieldRow label="Pincode" value={shippingPincode} onChange={setShippingPincode} />
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Leave blank to use the customer's billing address. Fill any field to add a separate SHIP TO block on the PDF.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="mt-4 bg-card border rounded-xl p-4 text-sm space-y-1 shadow-sm">
              <div className="font-semibold text-base">Summary</div>
              <div><span className="text-muted-foreground">Company:</span> {selectedCompany?.name}</div>
              <div><span className="text-muted-foreground">Customer:</span> {selectedCustomer?.name} {selectedCustomer?.email && <span className="text-xs text-muted-foreground">· {selectedCustomer.email}</span>}</div>
              <div><span className="text-muted-foreground">Items:</span> {items.filter((l) => l.productName || l.partNumber).length}</div>
              <div><span className="text-muted-foreground">Total:</span> <strong>₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></div>
              <div><span className="text-muted-foreground">Currency:</span> {currency}</div>
              {(shippingName || shippingAddress || shippingCity) && (
                <div><span className="text-muted-foreground">Ship To:</span> {[shippingName, shippingCity].filter(Boolean).join(", ") || "custom address"}</div>
              )}
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
                  {saving ? "Processing…" : "Save & Share →"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TeamLayout>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function AcDropdown({ results, onPick }: { results: any[]; onPick: (p: any) => void }) {
  return (
    <div className="absolute z-30 top-full left-0 mt-1 bg-card border rounded-lg shadow-lg w-[420px] max-h-60 overflow-y-auto">
      {results.map((p: any, pi: number) => {
        const dateStr = p.lastQuotedAt
          ? new Date(p.lastQuotedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
          : p.entryDate
            ? new Date(p.entryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
            : "";
        const mrpStr = p.mrp != null ? `₹${Number(p.mrp).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "";
        const discStr = p.lastDiscount != null ? `${p.lastDiscount}% off` : "";
        return (
          <button key={pi} onClick={() => onPick(p)}
            className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b last:border-0">
            <div className="font-mono font-semibold text-foreground">{p.partNumber || "—"}</div>
            <div className="text-foreground truncate">{p.productName}</div>
            <div className="text-muted-foreground text-[11px] truncate">
              {[p.brand && `(${p.brand})`, mrpStr, discStr, dateStr, p.lastCustomerName].filter(Boolean).join(" · ")}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FieldRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm" />
    </label>
  );
}
