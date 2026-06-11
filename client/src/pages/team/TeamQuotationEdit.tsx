import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, RefreshCw, Download, Send, Search } from "lucide-react";

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
  createdAt: number;
  updatedAt: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-700",
  sent: "bg-blue-500/15 text-blue-700",
  accepted: "bg-emerald-500/15 text-emerald-700",
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

  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [acIdx, setAcIdx] = useState<number | null>(null);
  const [acResults, setAcResults] = useState<any[]>([]);

  const { data: quotation, isLoading } = useQuery<Quotation>({
    queryKey: ["team-quotation", id],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}`);
      if (!r.ok) throw new Error("Failed to load");
      const resp = await r.json();
      // Backend returns { quotation, items } — flatten so the page can use a single object.
      if (resp && resp.quotation) {
        return { ...resp.quotation, items: resp.items || [] };
      }
      return resp;
    },
    enabled: !!token && !!id,
  });

  useEffect(() => {
    if (quotation) {
      setItems(quotation.items || []);
      setNotes(quotation.notes || "");
      setTerms(quotation.terms || "");
      setValidUntil(quotation.validUntil?.split("T")[0] || "");
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
    setItems((prev) => [...prev, {
      lineNo: prev.length + 1, partNumber: "", productName: "", hsn: "", brand: "",
      qty: 1, mrp: 0, discount: 0, gstPct: 18, lineTotal: 0, source: "manual",
    }]);
    setDirty(true);
  }

  function removeLine(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })));
    setDirty(true);
  }

  function onPartNumberChange(idx: number, val: string) {
    updateLine(idx, { partNumber: val });
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    if (val.length >= 2) {
      // Bug 3: 250 ms debounce to /api/team/part-suggestions
      acTimerRef.current = setTimeout(async () => {
        try {
          const r = await teamFetch(token, `/api/team/part-suggestions?q=${encodeURIComponent(val)}&limit=10`);
          if (r.ok) { setAcResults(await r.json()); setAcIdx(idx); }
        } catch { /* ignore network errors during autocomplete */ }
      }, 250);
    } else {
      setAcResults([]); setAcIdx(null);
    }
  }

  function applyAcResult(idx: number, part: any) {
    updateLine(idx, {
      partNumber: part.partNumber || part.part_number || "",
      productName: part.productName || part.name || "",
      brand: part.brand || "",
      mrp: part.mrp || 0,
      hsn: part.hsnCode || "",
      gstPct: part.gstPercent ?? items[idx]?.gstPct ?? 18,
    });
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

  const grandTotal = items.reduce((s, l) => s + (l.lineTotal || 0), 0);

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await teamFetch(token, `/api/team/quotations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes, terms, validUntil: validUntil || null,
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
      // Save first
      await saveMut.mutateAsync();
      const r = await teamFetch(token, `/api/team/quotations/${id}/finalize`, { method: "POST" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Finalize failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-quotation", id] });
      toast({ title: "Quotation finalized and sent!" });
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

  const canEdit = quotation.status === "draft";

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
            Customer: {quotation.customerName}
            <span className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs font-semibold">
              Currency: {currencySym(quotation.currency)} {quotation.currency || "INR"}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={downloadPdf}
          className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
          <Download className="w-4 h-4" /> Download PDF
        </button>
        {canEdit && (
          <>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !dirty}
              className="px-4 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
              {saveMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              {saveMut.isPending ? "Saving…" : "Save Draft"}
            </button>
            <button onClick={() => { if (confirm("Finalize and send to customer? This cannot be undone.")) finalizeMut.mutate(); }}
              disabled={finalizeMut.isPending}
              className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              <Send className="w-4 h-4" /> {finalizeMut.isPending ? "Sending…" : "Finalize & Send"}
            </button>
          </>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-x-auto border rounded-xl mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="px-3 py-2 w-10">#</th>
              <th className="px-3 py-2 min-w-[160px]">Part No</th>
              <th className="px-3 py-2 min-w-[220px]">Name</th>
              <th className="px-3 py-2 min-w-[110px]">HSN</th>
              <th className="px-3 py-2 min-w-[130px]">Brand</th>
              <th className="px-3 py-2 min-w-[90px]">Qty</th>
              <th className="px-3 py-2 min-w-[120px]">MRP</th>
              <th className="px-3 py-2 min-w-[100px]">Disc%</th>
              <th className="px-3 py-2 min-w-[90px]">GST%</th>
              <th className="px-3 py-2 min-w-[120px] text-right">Total</th>
              {canEdit && <th className="px-2 py-2 w-10"></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((line, idx) => (
              <tr key={idx} className="hover:bg-muted/20">
                <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                <td className="px-2 py-1 relative">
                  {canEdit ? (
                    <>
                      <input value={line.partNumber} onChange={(e) => onPartNumberChange(idx, e.target.value)}
                        className="w-full border rounded px-1.5 py-1 bg-background font-mono text-xs" />
                      {acIdx === idx && acResults.length > 0 && (
                        <div className="absolute z-20 top-full left-0 mt-1 bg-card border rounded-lg shadow-lg w-80 max-h-56 overflow-y-auto">
                          {acResults.map((p: any, pi: number) => {
                            const dateStr = p.entryDate
                              ? new Date(p.entryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                              : "";
                            const mrpStr = p.mrp != null ? `\u20b9${Number(p.mrp).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "";
                            return (
                              <button key={pi} onClick={() => applyAcResult(idx, p)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b last:border-0">
                                <div className="font-mono font-semibold text-foreground">{p.partNumber}</div>
                                <div className="text-muted-foreground truncate">
                                  {[p.productName, p.brand && `(${p.brand})`, mrpStr, dateStr].filter(Boolean).join(" — ")}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : <span className="font-mono">{line.partNumber || "—"}</span>}
                </td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <input value={line.productName} onChange={(e) => updateLine(idx, { productName: e.target.value })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                  ) : line.productName}
                </td>
                <td className="px-2 py-1 font-mono">
                  {canEdit ? (
                    <input value={line.hsn} onChange={(e) => updateLine(idx, { hsn: e.target.value })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                  ) : line.hsn}
                </td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <input value={line.brand} onChange={(e) => updateLine(idx, { brand: e.target.value })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs" />
                  ) : line.brand}
                </td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <input type="number" min={1} value={line.qty} onChange={(e) => updateLine(idx, { qty: parseFloat(e.target.value) || 1 })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                  ) : line.qty}
                </td>
                <td className="px-2 py-1 text-right">
                  {canEdit ? (
                    <input type="number" min={0} value={line.mrp} onChange={(e) => updateLine(idx, { mrp: parseFloat(e.target.value) || 0 })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                  ) : `${currencySym(quotation.currency)}${line.mrp}`}
                </td>
                <td className="px-2 py-1 text-right">
                  {canEdit ? (
                    <input type="number" min={0} max={100} value={line.discount} onChange={(e) => updateLine(idx, { discount: parseFloat(e.target.value) || 0 })}
                      className="w-full border rounded px-1.5 py-1 bg-background text-xs text-right" />
                  ) : `${line.discount}%`}
                </td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <select value={line.gstPct} onChange={(e) => updateLine(idx, { gstPct: parseFloat(e.target.value) })}
                      className="w-full border rounded px-1 py-1 bg-background text-xs">
                      {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
                    </select>
                  ) : `${line.gstPct}%`}
                </td>
                <td className="px-2 py-1 text-right font-semibold">
                  {currencySym(quotation.currency)}{(line.lineTotal || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </td>
                {canEdit && (
                  <td className="px-2 py-1">
                    {items.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="p-1 hover:bg-red-100 rounded text-red-500">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 font-semibold text-sm">
              <td colSpan={canEdit ? 9 : 8} className="px-3 py-2 text-right">Grand Total</td>
              <td className="px-3 py-2 text-right">{currencySym(quotation.currency)}{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="flex gap-2 mb-4">
          <button onClick={addLine} className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted">
            <Plus className="w-4 h-4" /> Add Row
          </button>
          <button onClick={handleMatchPrices} disabled={matchingPrices}
            className="px-4 py-2 border rounded-lg text-sm inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
            {matchingPrices ? <><RefreshCw className="w-4 h-4 animate-spin" /> Matching…</> : <><Search className="w-4 h-4" /> Match Prices from List</>}
          </button>
        </div>
      )}

      {/* Notes + Terms */}
      {canEdit ? (
        <div className="grid sm:grid-cols-2 gap-4">
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
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          {quotation.notes && <div><div className="text-xs font-bold text-muted-foreground uppercase mb-1">Notes</div><p className="text-sm">{quotation.notes}</p></div>}
          {quotation.terms && <div><div className="text-xs font-bold text-muted-foreground uppercase mb-1">Terms</div><p className="text-sm whitespace-pre-line">{quotation.terms}</p></div>}
        </div>
      )}
    </TeamLayout>
  );
}
