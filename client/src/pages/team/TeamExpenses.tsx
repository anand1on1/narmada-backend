// R27.36 — Expenses.
//
// Book an expense against a user-defined category and either a saved payee or a
// typed name. GST mode mirrors R27.33a (exclusive adds on top, inclusive extracts).
// Anything over ₹5,000 GST-inclusive goes to the approval queue and cannot be
// slipped until narmadamobility123 releases it.
import { useEffect, useMemo, useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, RefreshCw, FileText, Trash2, Search, X } from "lucide-react";

type GstMode = "exclusive" | "inclusive";
type ApprovalStatus = "auto_approved" | "pending_approval" | "approved" | "rejected";

interface Category { id: number; name: string; description: string | null }
interface Payee { id: number; name: string; phone: string | null; gst_number: string | null }
interface Expense {
  id: number;
  expense_date: number;
  expense_date_display: string;
  slip_number: string | null;
  category_name: string | null;
  payee_name: string;
  description: string | null;
  amount: number;
  gst_percent: number;
  gst_mode: GstMode;
  gst_amount: number;
  total_amount: number;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  is_recurring: number;
  recurring_frequency: string | null;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BADGES: Record<ApprovalStatus, { label: string; dot: string; cls: string }> = {
  approved: { label: "Approved", dot: "🟢", cls: "bg-emerald-500/15 text-emerald-700" },
  pending_approval: { label: "Pending Approval", dot: "🟡", cls: "bg-amber-500/15 text-amber-800" },
  rejected: { label: "Rejected", dot: "🔴", cls: "bg-rose-500/15 text-rose-700" },
  auto_approved: { label: "Auto-Approved", dot: "⚪", cls: "bg-slate-500/15 text-slate-600" },
};
function Badge({ status }: { status: ApprovalStatus }) {
  const b = BADGES[status] || BADGES.auto_approved;
  return (
    <span className={"text-[10px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1 " + b.cls} data-testid={`badge-expense-${status}`}>
      <span aria-hidden>{b.dot}</span>{b.label}
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export default function TeamExpenses() {
  const { token } = useTeamAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<Expense[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [loading, setLoading] = useState(false);

  const [fCat, setFCat] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [q, setQ] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [slipPreview, setSlipPreview] = useState<{ url: string; slip: string } | null>(null);

  // ---- new expense form ----
  const [categoryId, setCategoryId] = useState("");
  const [payeeMode, setPayeeMode] = useState<"quick" | "saved">("quick");
  const [payeeText, setPayeeText] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [gstPercent, setGstPercent] = useState("0");
  const [gstMode, setGstMode] = useState<GstMode>("exclusive");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState("monthly");
  const [nextDate, setNextDate] = useState("");
  const [saving, setSaving] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [showNewPayee, setShowNewPayee] = useState(false);
  const [newPayee, setNewPayee] = useState<Record<string, string>>({});

  async function api(pathname: string, init?: RequestInit) {
    const r = await teamFetch(token!, pathname, init);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    return r;
  }

  async function loadRefs() {
    if (!token) return;
    try {
      setCats(await (await api("/api/expenses/categories")).json());
      setPayees(await (await api("/api/expenses/payees")).json());
    } catch (e: any) {
      toast({ title: "Failed to load categories/payees", description: e.message, variant: "destructive" });
    }
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (fCat) p.set("category_id", fCat);
      if (fStatus && fStatus !== "all") p.set("status", fStatus);
      if (fFrom) p.set("from", fFrom);
      if (fTo) p.set("to", fTo);
      if (q.trim()) p.set("q", q.trim());
      setRows(await (await api(`/api/expenses?${p.toString()}`)).json());
    } catch (e: any) {
      toast({ title: "Failed to load expenses", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRefs(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, fCat, fStatus, fFrom, fTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview uses the same math as the server so the number never jumps on save.
  const preview = useMemo(() => {
    const base = parseFloat(amount) || 0;
    const pct = parseFloat(gstPercent) || 0;
    if (gstMode === "inclusive") {
      const taxable = pct > 0 ? base / (1 + pct / 100) : base;
      return { taxable, gst: base - taxable, total: base };
    }
    const gst = base * (pct / 100);
    return { taxable: base, gst, total: base + gst };
  }, [amount, gstPercent, gstMode]);

  const overThreshold = preview.total > 5000;

  function resetForm() {
    setCategoryId(""); setPayeeMode("quick"); setPayeeText(""); setPayeeId("");
    setAmount(""); setGstPercent("0"); setGstMode("exclusive"); setDescription("");
    setExpenseDate(today()); setIsRecurring(false); setFrequency("monthly"); setNextDate("");
  }

  async function submit() {
    if (!categoryId) { toast({ title: "Pick a category", variant: "destructive" }); return; }
    if (!(parseFloat(amount) > 0)) { toast({ title: "Enter an amount", variant: "destructive" }); return; }
    if (payeeMode === "quick" && !payeeText.trim()) { toast({ title: "Enter a payee name", variant: "destructive" }); return; }
    if (payeeMode === "saved" && !payeeId) { toast({ title: "Pick a saved payee", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        category_id: Number(categoryId),
        amount: parseFloat(amount),
        gst_percent: parseFloat(gstPercent) || 0,
        gst_mode: gstMode,
        description: description.trim() || undefined,
        expense_date: expenseDate,
      };
      if (payeeMode === "saved") body.payee_id = Number(payeeId);
      else body.payee_name_freetext = payeeText.trim();
      if (isRecurring) {
        body.is_recurring = true;
        body.recurring_frequency = frequency;
        if (nextDate) body.recurring_next_date = nextDate;
      }
      const created = await (await api("/api/expenses", { method: "POST", body: JSON.stringify(body) })).json();
      toast({
        title: `Expense booked — ${inr(created.total_amount)}`,
        description: created.approval_status === "pending_approval"
          ? "Over ₹5,000 — sent to Expense Approvals for release by narmadamobility123."
          : "Auto-approved. You can generate the slip now.",
      });
      setShowNew(false);
      resetForm();
      await load();
    } catch (e: any) {
      toast({ title: "Could not save expense", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    if (!newCatName.trim()) return;
    try {
      const c = await (await api("/api/expenses/categories", { method: "POST", body: JSON.stringify({ name: newCatName.trim() }) })).json();
      setShowNewCat(false); setNewCatName("");
      await loadRefs();
      setCategoryId(String(c.id));
      toast({ title: `Category "${c.name}" added` });
    } catch (e: any) {
      toast({ title: "Could not add category", description: e.message, variant: "destructive" });
    }
  }

  async function addPayee() {
    if (!newPayee.name?.trim()) return;
    try {
      const p = await (await api("/api/expenses/payees", { method: "POST", body: JSON.stringify(newPayee) })).json();
      setShowNewPayee(false); setNewPayee({});
      await loadRefs();
      setPayeeMode("saved");
      setPayeeId(String(p.id));
      toast({ title: `Payee "${p.name}" saved` });
    } catch (e: any) {
      toast({ title: "Could not add payee", description: e.message, variant: "destructive" });
    }
  }

  async function generateSlip(e: Expense) {
    if (!window.confirm(`Generate a slip for ${inr(e.total_amount)} to ${e.payee_name}?`)) return;
    try {
      const r = await teamFetch(token!, `/api/expenses/${e.id}/generate-slip`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const slip = r.headers.get("X-Slip-Number") || "";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slip.replace(/\//g, "-") || "expense-slip"}.jpg`;
      a.click();
      setSlipPreview({ url, slip });
      await load();
    } catch (err: any) {
      toast({ title: "Slip generation failed", description: err.message, variant: "destructive" });
    }
  }

  async function remove(e: Expense) {
    if (!window.confirm(`Delete this ${inr(e.total_amount)} expense? It disappears from the ledger.`)) return;
    try {
      await api(`/api/expenses/${e.id}/soft-delete`, { method: "POST" });
      toast({ title: "Expense deleted" });
      await load();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  }

  const total = rows.reduce((s, r) => s + r.total_amount, 0);

  return (
    <TeamLayout title="Expenses">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <p className="text-sm text-muted-foreground" data-testid="heading-expenses">
            Expenses over ₹5,000 (GST-inclusive) need approval before a slip can be generated.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={load} className="px-3 py-2 border rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted" data-testid="button-refresh-expenses">
              <RefreshCw className={"w-4 h-4 " + (loading ? "animate-spin" : "")} /> Refresh
            </button>
            <button onClick={() => setShowNew(true)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-2" data-testid="button-new-expense">
              <Plus className="w-4 h-4" /> New Expense
            </button>
          </div>
        </div>

        <div className="flex items-end gap-2 flex-wrap mb-4 bg-card border rounded-xl p-3">
          <label className="text-xs font-semibold text-slate-600">Category
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="filter-category">
              <option value="">All</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Status
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="filter-status">
              <option value="all">All</option>
              <option value="auto_approved">Auto-Approved</option>
              <option value="pending_approval">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">From
            <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="filter-from" />
          </label>
          <label className="text-xs font-semibold text-slate-600">To
            <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="filter-to" />
          </label>
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-semibold text-slate-600">Search</label>
            <div className="relative mt-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="Description, slip #, payee…"
                className="w-full pl-8 pr-3 py-1.5 border rounded-lg bg-background text-sm"
                data-testid="input-search-expenses"
              />
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm" data-testid="empty-expenses">No expenses match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-3 font-semibold">Date</th>
                    <th className="px-3 py-3 font-semibold">Slip #</th>
                    <th className="px-3 py-3 font-semibold">Category</th>
                    <th className="px-3 py-3 font-semibold">Payee</th>
                    <th className="px-3 py-3 font-semibold">Description</th>
                    <th className="px-3 py-3 font-semibold text-right">Amount</th>
                    <th className="px-3 py-3 font-semibold text-right">GST</th>
                    <th className="px-3 py-3 font-semibold text-right">Total</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((e) => (
                    <tr key={e.id} data-testid={`row-expense-${e.id}`}>
                      <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{e.expense_date_display}</td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold text-indigo-700">{e.slip_number || "—"}</td>
                      <td className="px-3 py-3">{e.category_name || "—"}</td>
                      <td className="px-3 py-3">
                        {e.payee_name}
                        {!!e.is_recurring && <span className="ml-1.5 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-700">{e.recurring_frequency}</span>}
                      </td>
                      <td className="px-3 py-3 text-slate-600 max-w-[220px] truncate">{e.description || "—"}</td>
                      <td className="px-3 py-3 text-right">{inr(e.amount)}</td>
                      <td className="px-3 py-3 text-right text-slate-500">{inr(e.gst_amount)}<span className="text-[10px] ml-1">{e.gst_percent}% {e.gst_mode === "inclusive" ? "inc" : "exc"}</span></td>
                      <td className="px-3 py-3 text-right font-semibold">{inr(e.total_amount)}</td>
                      <td className="px-3 py-3">
                        <Badge status={e.approval_status} />
                        {e.rejection_reason && <div className="text-[10px] text-rose-700 mt-0.5">{e.rejection_reason}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => generateSlip(e)}
                            disabled={!!e.slip_number || e.approval_status === "pending_approval" || e.approval_status === "rejected"}
                            title={e.slip_number ? "Slip already generated" : e.approval_status === "pending_approval" ? "Waiting for approval" : e.approval_status === "rejected" ? "Rejected" : "Generate slip"}
                            className="px-2 py-1 text-xs rounded bg-indigo-500/15 text-indigo-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                            data-testid={`button-generate-slip-${e.id}`}
                          >
                            <FileText className="w-3.5 h-3.5" /> Slip
                          </button>
                          <button
                            onClick={() => remove(e)}
                            className="px-2 py-1 text-xs rounded bg-rose-500/15 text-rose-700 font-semibold inline-flex items-center gap-1"
                            data-testid={`button-delete-expense-${e.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={7} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total on screen</td>
                    <td className="px-3 py-2 text-right" data-testid="text-expenses-total">{inr(total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---- new expense modal ---- */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowNew(false)}>
          <div className="bg-card border rounded-xl w-full max-w-2xl p-5 my-8" onClick={(ev) => ev.stopPropagation()} data-testid="dialog-new-expense">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Expense</h2>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Category</label>
                <div className="flex gap-2 mt-1">
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="select-expense-category">
                    <option value="">Select a category…</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => setShowNewCat(true)} className="px-3 py-2 border rounded-lg text-sm font-semibold whitespace-nowrap" data-testid="button-new-category">+ New Category</button>
                </div>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Payee</label>
                <div className="inline-flex rounded-lg border overflow-hidden ml-2 text-xs" role="group" aria-label="Payee mode">
                  {(["quick", "saved"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayeeMode(m)}
                      className={`px-2.5 py-1 capitalize transition-colors ${payeeMode === m ? "bg-indigo-600 text-white" : "bg-background text-slate-600 hover:bg-slate-100"}`}
                      data-testid={`toggle-payee-mode-${m}`}
                    >
                      {m === "quick" ? "Quick name" : "Saved payee"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-1">
                  {payeeMode === "quick" ? (
                    <input value={payeeText} onChange={(e) => setPayeeText(e.target.value)} placeholder="Type a payee name" className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-payee-freetext" />
                  ) : (
                    <select value={payeeId} onChange={(e) => setPayeeId(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="select-payee">
                      <option value="">Select a saved payee…</option>
                      {payees.map((p) => <option key={p.id} value={p.id}>{p.name}{p.gst_number ? ` · ${p.gst_number}` : ""}</option>)}
                    </select>
                  )}
                  <button onClick={() => setShowNewPayee(true)} className="px-3 py-2 border rounded-lg text-sm font-semibold whitespace-nowrap" data-testid="button-new-payee">+ New Payee</button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">Amount</label>
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full mt-1 border rounded-lg px-3 py-2 bg-background text-sm text-right" data-testid="input-expense-amount" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Date</label>
                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-full mt-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-expense-date" />
              </div>

              <div className="col-span-2 flex items-center gap-4 flex-wrap">
                {/* R27.33a — same exclusive/inclusive pill toggle as the payment slip builder */}
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <span>GST Mode</span>
                  <div className="inline-flex rounded-lg border overflow-hidden" role="group" aria-label="GST mode">
                    {(["exclusive", "inclusive"] as GstMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setGstMode(m)}
                        className={`px-2.5 py-1 capitalize transition-colors ${gstMode === m ? "bg-indigo-600 text-white" : "bg-background text-slate-600 hover:bg-slate-100"}`}
                        data-testid={`toggle-expense-gstmode-${m}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <span>GST%</span>
                  <input type="number" step="0.01" min="0" max="28" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} className="w-16 border rounded-lg px-2 py-1 bg-background text-right" data-testid="input-expense-gst" />
                  {[0, 5, 12, 18, 28].map((p) => (
                    <button key={p} type="button" onClick={() => setGstPercent(String(p))} className="px-1.5 py-0.5 rounded border text-[10px] hover:bg-muted">{p}%</button>
                  ))}
                </div>
              </div>

              <div className="col-span-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between" data-testid="preview-expense-total">
                <span className="text-xs text-muted-foreground">
                  Taxable {inr(preview.taxable)} · GST {inr(preview.gst)}
                </span>
                <span className="font-bold">{inr(preview.total)}</span>
              </div>
              {overThreshold && (
                <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="warning-over-threshold">
                  Over ₹5,000 — this will go to Expense Approvals and cannot be slipped until narmadamobility123 releases it.
                </div>
              )}

              <div className="col-span-2">
                <label className="text-xs font-semibold text-slate-600">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-expense-description" />
              </div>

              <div className="col-span-2">
                <label className="inline-flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} data-testid="toggle-recurring" />
                  Recurring expense
                </label>
                {isRecurring && (
                  <div className="flex gap-3 mt-2">
                    <label className="text-xs font-semibold text-slate-600">Frequency
                      <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="select-frequency">
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Next date
                      <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="block mt-1 border rounded-lg px-2 py-1.5 bg-background text-sm" data-testid="input-next-date" />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
              <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-expense">
                {saving ? "Saving…" : "Save Expense"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- inline new category ---- */}
      {showNewCat && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowNewCat(false)}>
          <div className="bg-card border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} data-testid="dialog-new-category">
            <h3 className="font-bold mb-3">New Category</h3>
            <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} autoFocus placeholder="e.g. Office Rent" className="w-full border rounded-lg px-3 py-2 bg-background text-sm" data-testid="input-new-category-name" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewCat(false)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={addCategory} disabled={!newCatName.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-category">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- inline new payee ---- */}
      {showNewPayee && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowNewPayee(false)}>
          <div className="bg-card border rounded-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()} data-testid="dialog-new-payee">
            <h3 className="font-bold mb-3">New Payee</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                ["name", "Name *"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"],
                ["gst_number", "GSTIN"], ["pan_number", "PAN"], ["bank_account", "Account No."],
                ["ifsc", "IFSC"], ["bank_name", "Bank"],
              ] as const).map(([k, label]) => (
                <label key={k} className="text-xs font-semibold text-slate-600">
                  {label}
                  <input
                    value={newPayee[k] || ""}
                    onChange={(e) => setNewPayee((p) => ({ ...p, [k]: e.target.value }))}
                    className="w-full mt-1 border rounded-lg px-3 py-2 bg-background text-sm font-normal"
                    data-testid={`input-payee-${k}`}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewPayee(false)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={addPayee} disabled={!newPayee.name?.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-payee">Save Payee</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- slip preview ---- */}
      {slipPreview && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setSlipPreview(null)}>
          <div className="bg-card border rounded-xl p-4 max-w-lg" onClick={(e) => e.stopPropagation()} data-testid="dialog-slip-preview">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold font-mono text-sm">{slipPreview.slip}</h3>
              <button onClick={() => setSlipPreview(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
            </div>
            <img src={slipPreview.url} alt={`Expense slip ${slipPreview.slip}`} className="max-h-[70vh] rounded border" />
            <p className="text-xs text-muted-foreground mt-2">The JPG has also been downloaded.</p>
          </div>
        </div>
      )}
    </TeamLayout>
  );
}
