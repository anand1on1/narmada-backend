import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, RefreshCw, Download, Send, Search, Sparkles, Truck, Building2, User2, ShoppingCart } from "lucide-react";

function currencySym(c: string | undefined | null): string {
  if (c === "USD") return "$";
  if (c === "EUR") return "€";
  if (c === "AED") return "AED ";
  return "₹";
}

interface LineItem {
  id?: number;
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
  source: "manual" | "import" | "edukaan";
}

interface Quotation {
  id: number;
  quoteNo: string;
  status: string;
  customerId: number;
  customerName: string;
  quotingCompanyId?: number | null;
  companyId?: number | null;
  currency: string;
  fxRate: number;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  grandTotal: number;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  pdfUrl: string | null;
  items: LineItem[];
  shippingName?: string | null;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPincode?: string | null;
  shippingPhone?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface CustomerLite {
  id: number; name: string; phone: string | null; email?: string | null; gstNumber: string | null;
  defaultDiscountPct?: number | null;
}

interface QuotingCompanyLite {
  id: number; name: string; gstin: string | null; active: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  accepted: "bg-emerald-500/15 text-emerald-700",
  processed: "bg-green-600/15 text-green-700",
  expired: "bg-muted text-muted-foreground",
};

function computeLine(line: LineItem): LineItem {
  const base = line.mrp * line.qty;
  const afterDiscount = base * (1 - (line.discount || 0) / 100);
  const withGst = afterDiscount * (1 + (line.gstPct || 0) / 100);
  return { ...line, lineTotal: Math.round(withGst * 100) / 100 };
}

export default function TeamQuotationEdit() {
  const { id } = useParams<{ id: string }>();
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [items, setItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [dirty, setDirty] = useState(false);
  const [matchingPrices, setMatchingPrices] = useState(false);

  // Round 3: editable header
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [quotingCompanyId, setQuotingCompanyId] = useState<number | null>(null);

  // Round 3: shipping
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

  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [acIdx, setAcIdx] = useState<number | null>(null);
  const [acField, setAcField] = useState<"part" | "name">("part");
  const [acResults, setAcResults] = useState<any[]>([]);

  const { data: quotation, isLoading } = useQuery<Quotation>({
    queryKey: ["team-quotation", id],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}`);
      if (!r.ok) throw new Error("Failed to load");
      const resp = await r.json();
      if (resp && resp.quotation) return { ...resp.quotation, items: resp.items || [] };
      return resp;
    },
    enabled: !!token && !!id,
  });

  const { data: allCustomers = [] } = useQuery<CustomerLite[]>({
    queryKey: ["team-all-customers"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/customers?limit=500");
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    enabled: !!token,
  });

  const { data: allQuotingCompanies = [] } = useQuery<QuotingCompanyLite[]>({
    queryKey: ["team-all-quoting-companies"],
    queryFn: async () => {
      const r = await teamFetch(token, "/api/team/quoting-companies");
      if (!r.ok) return [];
      const j = await r.json();
      return (Array.isArray(j) ? j : []).filter((c: any) => c.active);
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (quotation) {
      setItems(quotation.items || []);
      setNotes(quotation.notes || "");
      setTerms(quotation.terms || "");
      setValidUntil(quotation.validUntil?.split("T")[0] || "");
      setCustomerId(quotation.customerId ?? null);
      setQuotingCompanyId((quotation as any).quotingCompanyId ?? null);
      setShippingName(quotation.shippingName || "");
      setShippingAddress(quotation.shippingAddress || "");
      setShippingCity(quotation.shippingCity || "");
      setShippingState(quotation.shippingState || "");
      setShippingPincode(quotation.shippingPincode || "");
      setShippingPhone(quotation.shippingPhone || "");
      setShipOpen(!!(quotation.shippingName || quotation.shippingAddress || quotation.shippingCity));
      setDirty(false);
    }
  }, [quotation]);

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = computeLine({ ...next[idx], ...patch });
      return next;
    });
    setDirty(true);
  }

  function addLine() {
    const dd = allCustomers.find((c) => c.id === customerId)?.defaultDiscountPct ?? 0;
    setItems((prev) => [...prev, {
      lineNo: prev.length + 1, partNumber: "", productName: "", hsn: "", brand: "",
      qty: 1, mrp: 0, discount: dd, gstPct: 18, lineTotal: 0, source: "manual",
    }]);
    setDirty(true);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })));
    setDirty(true);
  }

  function triggerAutocomplete(idx: number, val: string, field: "part" | "name") {
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    if (val.length >= 2) {
      acTimerRef.current = setTimeout(async () => {
        try {
          const r = await teamFetch(token, `/api/team/part-suggestions?q=${encodeURIComponent(val)}&limit=10`);
          if (r.ok) { setAcResults(await r.json()); setAcIdx(idx); setAcField(field); }
        } catch { /* ignore */ }
      }, 250);
    } else {
      setAcResults([]); setAcIdx(null);
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
    const dd = allCustomers.find((c) => c.id === customerId)?.defaultDiscountPct ?? 0;
    updateLine(idx, {
      partNumber: part.partNumber || part.part_number || "",
      productName: part.productName || part.name || "",
      brand: part.brand || "",
      mrp: part.mrp || 0,
      hsn: part.hsnCode || "",
      gstPct: part.gstPercent ?? items[idx]?.gstPct ?? 18,
      discount: items[idx]?.discount || dd,
    });
    setAcResults([]); setAcIdx(null);
  }

  // Dismiss the suggestion dropdown without touching the typed value. The free-text the
  // user already typed is committed to state on every keystroke via updateLine, so simply
  // hiding the list leaves their value intact — they can save any part name, in DB or not.
  function closeAc() {
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    setAcResults([]); setAcIdx(null);
  }

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
        source: p.source || "manual",
      }));
      if (updatedLines.length) { setItems(updatedLines); setDirty(true); }
      toast({ title: `Matched ${json.matchedCount} of ${json.matchedCount + json.unmatchedCount} items from price list` });
    } catch (e: any) {
      toast({ title: "Match error", description: e.message, variant: "destructive" });
    } finally {
      setMatchingPrices(false);
    }
  }

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
            customerName: quotation?.customerName,
            currency: quotation?.currency,
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
      setDirty(true);
      toast({ title: "AI updated line items", description: json.summary || "Review and save." });
      setAiPrompt("");
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  const grandTotal = items.reduce((s, l) => s + (l.lineTotal || 0), 0);

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          customerId, quotingCompanyId,
          notes, terms, validUntil: validUntil || null,
          shippingName: shippingName.trim() || null,
          shippingAddress: shippingAddress.trim() || null,
          shippingCity: shippingCity.trim() || null,
          shippingState: shippingState.trim() || null,
          shippingPincode: shippingPincode.trim() || null,
          shippingPhone: shippingPhone.trim() || null,
          items: items.map((l, i) => ({ ...l, lineNo: i + 1 })),
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Save failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-quotation", id] });
      setDirty(false);
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const finalizeMut = useMutation({
    mutationFn: async () => {
      await saveMut.mutateAsync();
      const r = await teamFetch(token, `/api/team/quotations/${id}/finalize`, { method: "POST" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Finalize failed"); }
      return r.json();
    },
    onSuccess: (json: any) => {
      qc.invalidateQueries({ queryKey: ["team-quotation", id] });
      const em = json?.email;
      if (em && em.ok) toast({ title: "Quotation finalized & emailed", description: `Sent via ${em.via || "SMTP"}.` });
      else if (em && !em.ok) toast({ title: "Saved, but email failed", description: em.error || "Check SMTP settings.", variant: "destructive" });
      else toast({ title: "Quotation finalized" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function downloadPdf() {
    const r = await teamFetch(token, `/api/team/quotations/${id}/pdf`);
    if (!r.ok) { toast({ title: "PDF unavailable", variant: "destructive" }); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quotation?.quoteNo || id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const convertMut = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not authenticated");
      const r = await teamFetch(token, `/api/team/quotations/${id}/convert-to-po`, { method: "POST", body: JSON.stringify({}) });
      const text = await r.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(text.slice(0, 200) || "Convert failed"); }
      if (!r.ok) throw new Error(body.error || "Convert failed");
      return body;
    },
    onSuccess: (json: any) => {
      const poNo = json?.poNumber || json?.poNo || (json?.poId ? `#${json.poId}` : "");
      toast({ title: "Purchase Order created", description: poNo ? `PO ${poNo}` : "Opening PO list…" });
      setTimeout(() => { window.location.hash = "#/team/purchase-orders"; }, 800);
    },
    onError: (e: Error) => toast({ title: "Convert failed", description: e.message, variant: "destructive" }),
  });

  // R20.1: soft-delete this quotation.
  const deleteMut = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}`, { method: "DELETE" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Delete failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-quotations"] });
      toast({ title: "Quotation deleted" });
      navigate("/team/quotations");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // R20.1: mark Processed — only valid from Accepted.
  const markProcessedMut = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}/mark-processed`, { method: "POST" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Could not mark processed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-quotation", id] });
      qc.invalidateQueries({ queryKey: ["team-quotations"] });
      toast({ title: "Marked Processed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <TeamLayout title="Quotation">
        <div className="p-12 text-center text-muted-foreground">Loading…</div>
      </TeamLayout>
    );
  }

  if (!quotation) {
    return (
      <TeamLayout title="Quotation">
        <div className="p-12 text-center text-muted-foreground">Quotation not found.</div>
      </TeamLayout>
    );
  }

  // Round 3: editing is allowed on ANY status (audit-logged on the server).
  const canEdit = true;

  return (
    <TeamLayout title={quotation.quoteNo}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-xl">{quotation.quoteNo}</span>
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_BADGE[quotation.status] || STATUS_BADGE.draft}`}>
              {quotation.status}
            </span>
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Currency: {currencySym(quotation.currency)} {quotation.currency || "INR"}
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={downloadPdf}
          className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
          <Download className="w-4 h-4" /> Download PDF
        </button>
        <button onClick={() => { if (confirm("Create a draft Purchase Order from this quotation?")) convertMut.mutate(); }}
          disabled={convertMut.isPending}
          className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
          {convertMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
          Convert to PO
        </button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !dirty}
          className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
          {saveMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { if (confirm("Finalize and send to customer? An email will be sent.")) finalizeMut.mutate(); }}
          disabled={finalizeMut.isPending}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          <Send className="w-4 h-4" /> {finalizeMut.isPending ? "Sending…" : "Save & Share"}
        </button>
        <button onClick={() => markProcessedMut.mutate()}
          disabled={markProcessedMut.isPending || (quotation.status !== "sent" && quotation.status !== "accepted")}
          title={(quotation.status !== "sent" && quotation.status !== "accepted") ? "Only a Sent or Accepted quotation can be marked Processed" : "Mark this quotation Processed"}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          {markProcessedMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
          Mark Processed
        </button>
        <button onClick={() => { if (confirm(`Delete quotation ${quotation.quoteNo}?`)) deleteMut.mutate(); }}
          disabled={deleteMut.isPending}
          className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-red-50 disabled:opacity-50">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>

      {/* R20.2: editable header cards — customer + quoting company (Ordered Company removed) */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <div className="border rounded-xl p-3 bg-card shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
            <User2 className="w-3 h-3" /> Customer
          </div>
          <select value={customerId ?? ""} onChange={(e) => { setCustomerId(e.target.value ? parseInt(e.target.value, 10) : null); setDirty(true); }}
            className="w-full border rounded-lg px-3 py-2 bg-background text-sm">
            <option value="">— Select customer —</option>
            {allCustomers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.gstNumber ? ` · ${c.gstNumber}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="border rounded-xl p-3 bg-card shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Quoting Company
          </div>
          <select value={quotingCompanyId ?? ""} onChange={(e) => { setQuotingCompanyId(e.target.value ? parseInt(e.target.value, 10) : null); setDirty(true); }}
            className="w-full border rounded-lg px-3 py-2 bg-background text-sm">
            <option value="">— Select quoting company —</option>
            {allQuotingCompanies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {/* AI prompt */}
      <div className="border rounded-xl p-3 mb-4 bg-card shadow-sm">
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
          <Sparkles className="w-4 h-4 text-accent" /> Ask AI to edit these items
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !aiBusy && runAiPrompt()}
            placeholder="e.g. 'decrease all rates by 10%', 'fill missing HSN codes'"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
          <button onClick={runAiPrompt} disabled={aiBusy || !aiPrompt.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground disabled:opacity-50 inline-flex items-center justify-center gap-1 whitespace-nowrap">
            {aiBusy ? <><RefreshCw className="w-4 h-4 animate-spin" /> Thinking…</> : <><Sparkles className="w-4 h-4" /> Apply</>}
          </button>
        </div>
      </div>

      {/* Items table (compact, sticky header, scrollable) */}
      <div className="border rounded-xl bg-card shadow-sm overflow-hidden mb-4">
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
                      onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); closeAc(); } }}
                      onBlur={() => setTimeout(closeAc, 150)}
                      className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" />
                    {acIdx === idx && acField === "part" && acResults.length > 0 && (
                      <AcDropdown results={acResults} onPick={(p) => applyAcResult(idx, p)} />
                    )}
                  </td>
                  <td className="px-1 py-1 relative">
                    <input value={line.productName} onChange={(e) => onProductNameChange(idx, e.target.value)}
                      onFocus={() => line.productName.length >= 2 && triggerAutocomplete(idx, line.productName, "name")}
                      onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); closeAc(); } }}
                      onBlur={() => setTimeout(closeAc, 150)}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                    {acIdx === idx && acField === "name" && acResults.length > 0 && (
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
                    {currencySym(quotation.currency)}{(line.lineTotal || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
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
          <span className="font-bold text-base">{currencySym(quotation.currency)}{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button onClick={addLine} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted">
          <Plus className="w-4 h-4" /> Add Row
        </button>
        <button onClick={handleMatchPrices} disabled={matchingPrices}
          className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
          {matchingPrices ? <><RefreshCw className="w-4 h-4 animate-spin" /> Matching…</> : <><Search className="w-4 h-4" /> Match Prices from List</>}
        </button>
      </div>

      {/* Notes + Terms */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <label className="block text-sm">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Valid Until</div>
          <input type="date" value={validUntil} onChange={(e) => { setValidUntil(e.target.value); setDirty(true); }}
            className="border rounded-lg px-3 py-2 bg-background" />
        </label>
        <div />
        <label className="block text-sm sm:col-span-2">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes</div>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} rows={2}
            className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
        </label>
        <label className="block text-sm sm:col-span-2">
          <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Terms</div>
          <textarea value={terms} onChange={(e) => { setTerms(e.target.value); setDirty(true); }} rows={3}
            className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
        </label>
      </div>

      {/* Shipping address */}
      <div className="border rounded-xl bg-card shadow-sm mb-6">
        <button type="button" onClick={() => setShipOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30">
          <span className="inline-flex items-center gap-2"><Truck className="w-4 h-4 text-accent" /> Ship To (different from billing)</span>
          <span className="text-xs text-muted-foreground">{shipOpen ? "Hide" : "Show"}</span>
        </button>
        {shipOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <FieldRow label="Site / Contact Name" value={shippingName} onChange={(v) => { setShippingName(v); setDirty(true); }} />
            <FieldRow label="Phone" value={shippingPhone} onChange={(v) => { setShippingPhone(v); setDirty(true); }} />
            <div className="sm:col-span-2">
              <FieldRow label="Address" value={shippingAddress} onChange={(v) => { setShippingAddress(v); setDirty(true); }} />
            </div>
            <FieldRow label="City" value={shippingCity} onChange={(v) => { setShippingCity(v); setDirty(true); }} />
            <FieldRow label="State" value={shippingState} onChange={(v) => { setShippingState(v); setDirty(true); }} />
            <FieldRow label="Pincode" value={shippingPincode} onChange={(v) => { setShippingPincode(v); setDirty(true); }} />
            <p className="text-xs text-muted-foreground sm:col-span-2">Leave all blank to use the customer's billing address.</p>
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
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/40 border-t">
        Suggestions only — keep typing to enter a new part. Press Enter or Esc to use what you typed.
      </div>
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
