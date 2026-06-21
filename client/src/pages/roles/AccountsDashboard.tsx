import { useEffect, useState, createContext, useContext } from "react";
import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Calculator } from "lucide-react";

type Tab = "cash" | "headers" | "expenses" | "current" | "advances" | "employees" | "ledger" | "attendance" | "salary";

const BRANCHES = ["Delhi", "Patna"];

// R27.8 #5/#6 — the accounts dashboard was hard-wired to FinanceAuth.roleFetch.
// To mirror it inside the admin panel (admin token), the fetcher is now injected
// via context. Default is the finance roleFetch so the standalone portal is
// unchanged; the admin wrapper supplies adminFetch instead.
type Fetcher = (token: string | null, url: string, init?: RequestInit) => Promise<Response>;
const FetchCtx = createContext<Fetcher>(FinanceAuth.roleFetch);

// R27.4 — extracted body so the Finance portal landing page (FinanceDashboard)
// can render the full accounts dashboard, not just a placeholder.
// R27.5 #8 — fuller field sets per tab + a Person Ledger tab.
export function AccountsBody() {
  const { token, user } = FinanceAuth.useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("cash");
  return (
    <FetchCtx.Provider value={FinanceAuth.roleFetch}>
      <AccountsTabs token={token} isAdmin={isAdmin} tab={tab} setTab={setTab} />
    </FetchCtx.Provider>
  );
}

// R27.8 #5/#6 — admin-panel mirror. Renders the exact same tabs but drives every
// request through adminFetch (admin token => isAdminAcct=true => full salary).
export function AccountsBodyAdmin({ token, adminFetch }: { token: string | null; adminFetch: Fetcher }) {
  const [tab, setTab] = useState<Tab>("cash");
  return (
    <FetchCtx.Provider value={adminFetch}>
      <AccountsTabs token={token} isAdmin tab={tab} setTab={setTab} />
    </FetchCtx.Provider>
  );
}

function AccountsTabs({ token, isAdmin, tab, setTab }: { token: string | null; isAdmin: boolean; tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        {([["cash", "Cash in Hand"], ["headers", "Expense Headers"], ["expenses", "Expenses"], ["current", "Current Expenses"], ["advances", "Advances"], ["employees", "Employees"], ["ledger", "Person Ledger"], ["attendance", "Attendance"], ["salary", "Salary"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`accounts-tab-${k}`} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>{label}</button>
        ))}
      </div>
      {tab === "cash" && <CashTab token={token} />}
      {tab === "headers" && <HeadersTab token={token} />}
      {tab === "expenses" && <ExpensesTab token={token} />}
      {tab === "current" && <CurrentTab token={token} isAdmin={isAdmin} />}
      {tab === "advances" && <AdvancesTab token={token} />}
      {tab === "employees" && <EmployeesTab token={token} isAdmin={isAdmin} />}
      {tab === "ledger" && <LedgerTab token={token} />}
      {tab === "attendance" && <AttendanceTab token={token} />}
      {tab === "salary" && <SalaryTab token={token} isAdmin={isAdmin} />}
    </>
  );
}

export default function AccountsDashboard() {
  return (
    <RolePortalShell title="Accounts" accent="text-emerald-600" icon={Calculator} auth={FinanceAuth} loginPath="/finance/login">
      <AccountsBody />
    </RolePortalShell>
  );
}

// R27.8 #5/#6 — the active fetcher comes from context (finance roleFetch by
// default, adminFetch inside the admin mirror). Every sub-component reads it.
function useF(): Fetcher { return useContext(FetchCtx); }

// R27.7 #1 — token-aware file download (the plain <a href> can't send the role
// token header, so fetch as a blob and click a synthetic link).
async function downloadFile(f: Fetcher, token: string | null, url: string, filename: string) {
  const r = await f(token, url);
  if (!r.ok) return;
  const blob = await r.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(href);
}

// R27.7 #2 — the till balance is now COMPUTED from cash_movements: cash receipts
// (+), cash-paid direct expenses (−), advances issued (−) and returned (+). The
// drill-down lists those movements chronologically per branch.
function CashTab({ token }: { token: string | null }) {
  const f = useF();
  const [balances, setBalances] = useState<{ branch: string; inflow: number; outflow: number; balance: number }[]>([]);
  const [moves, setMoves] = useState<any[]>([]);
  const [branch, setBranch] = useState("all");
  const [form, setForm] = useState({ amount: "", notes: "", branch: "Delhi" });
  const [exFrom, setExFrom] = useState("");
  const [exTo, setExTo] = useState("");
  async function load() {
    const b = await f(token, "/api/finance/cash/balances"); if (b.ok) setBalances((await b.json()).branches || []);
    const m = await f(token, `/api/finance/cash/movements${branch !== "all" ? `?branch=${branch}` : ""}`); if (m.ok) setMoves(await m.json());
  }
  useEffect(() => { if (token) load(); }, [token, branch]); // eslint-disable-line
  async function addReceipt() {
    if (!form.amount) return;
    const r = await f(token, "/api/finance/cash/receipt", { method: "POST", body: JSON.stringify({ branch: form.branch, amount: Number(form.amount), notes: form.notes }) });
    if (r.ok) { setForm({ amount: "", notes: "", branch: form.branch }); load(); }
  }
  const total = balances.reduce((s, b) => s + (b.balance || 0), 0);
  const SRC_LABEL: Record<string, string> = { cash_receipt: "Cash receipt", direct_expense: "Expense (cash)", advance_issue: "Advance issued", advance_return: "Advance returned", sale: "Cash sale" };
  return (
    <div>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-card border rounded-xl p-5 flex flex-col justify-between">
          <span className="text-sm text-muted-foreground">Total cash in hand</span>
          <span className="text-2xl font-bold text-emerald-600" data-testid="cash-total">₹{total.toLocaleString("en-IN")}</span>
        </div>
        {balances.map((b) => (
          <div key={b.branch} className="bg-card border rounded-xl p-5 flex flex-col justify-between" data-testid={`cash-branch-${b.branch}`}>
            <span className="text-sm text-muted-foreground">{b.branch} till</span>
            <span className="text-xl font-bold">₹{(b.balance || 0).toLocaleString("en-IN")}</span>
            <span className="text-xs text-muted-foreground mt-1">in ₹{b.inflow.toLocaleString("en-IN")} · out ₹{b.outflow.toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div className="font-semibold text-sm self-center mr-2">Record cash receipt</div>
        <div><label className="text-xs text-muted-foreground">Branch</label><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" data-testid="cash-receipt-amount" /></div>
        <div><label className="text-xs text-muted-foreground">Notes</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48" placeholder="Collection / sale" /></div>
        <button onClick={addReceipt} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="cash-receipt-add">Add Receipt</button>
      </div>
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <label className="text-xs text-muted-foreground">Filter branch</label>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="px-2 py-1.5 rounded-lg border bg-background text-sm" data-testid="cash-branch-filter"><option value="all">All</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        <span className="mx-2 text-muted-foreground text-xs">Export cash received</span>
        <input type="date" value={exFrom} onChange={(e) => setExFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border bg-background text-sm" data-testid="cash-export-from" />
        <input type="date" value={exTo} onChange={(e) => setExTo(e.target.value)} className="px-2 py-1.5 rounded-lg border bg-background text-sm" data-testid="cash-export-to" />
        {(() => { const qs = `?${new URLSearchParams({ ...(exFrom ? { from: exFrom } : {}), ...(exTo ? { to: exTo } : {}), ...(branch !== "all" ? { branch } : {}) }).toString()}`; return (<>
          <button onClick={() => downloadFile(f, token, `/api/admin/accounts/cash-received.xlsx${qs}`, "cash-received.xlsx")} className="px-3 py-1.5 rounded-lg border text-sm font-semibold hover:bg-muted" data-testid="cash-export-xlsx">Export xlsx</button>
          <button onClick={() => downloadFile(f, token, `/api/admin/accounts/cash-received.csv${qs}`, "cash-received.csv")} className="px-3 py-1.5 rounded-lg border text-sm font-semibold hover:bg-muted" data-testid="cash-export-csv">Export csv</button>
        </>); })()}
      </div>
      <Table cols={["Date", "Branch", "Direction", "Source", "Amount", "Notes"]} rows={moves.map((r) => [r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "—", r.branch, r.direction === "in" ? "IN" : "OUT", SRC_LABEL[r.source] || r.source, `₹${Number(r.amount).toLocaleString("en-IN")}`, r.notes || "—"])} />
    </div>
  );
}

function HeadersTab({ token }: { token: string | null }) {
  const f = useF();
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", gl_code: "", budget: "", parent_id: "" });
  async function load() { const r = await f(token, "/api/finance/expense-headers"); if (r.ok) setRows(await r.json()); }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() {
    if (!form.name.trim()) return;
    const body: any = { name: form.name.trim(), fields: [], gl_code: form.gl_code || undefined, budget: form.budget ? Number(form.budget) : undefined, parent_id: form.parent_id ? Number(form.parent_id) : undefined };
    const r = await f(token, "/api/finance/expense-headers", { method: "POST", body: JSON.stringify(body) });
    if (r.ok) { setForm({ name: "", gl_code: "", budget: "", parent_id: "" }); load(); }
  }
  async function del(id: number) { const r = await f(token, `/api/finance/expense-headers/${id}`, { method: "DELETE" }); if (r.ok) load(); }
  const nameById = (id: number) => rows.find((x) => x.id === id)?.name || "—";
  return (
    <div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Office Rent" className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48" /></div>
        <div><label className="text-xs text-muted-foreground">GL code</label><input value={form.gl_code} onChange={(e) => setForm({ ...form, gl_code: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28" /></div>
        <div><label className="text-xs text-muted-foreground">Monthly budget (₹)</label><input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" /></div>
        <div><label className="text-xs text-muted-foreground">Parent</label><select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40"><option value="">None</option>{rows.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Header</button>
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto">
        {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No expense headers yet.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Name</th><th className="p-3">GL</th><th className="p-3 text-right">Budget</th><th className="p-3">Parent</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (<tr key={r.id} className="hover:bg-muted/30"><td className="p-3 font-semibold">{r.name}</td><td className="p-3 font-mono text-xs">{r.gl_code || "—"}</td><td className="p-3 text-right">{r.budget != null ? `₹${Number(r.budget).toLocaleString("en-IN")}` : "—"}</td><td className="p-3 text-xs">{r.parent_id ? nameById(r.parent_id) : "—"}</td><td className="p-3 text-right"><button onClick={() => del(r.id)} className="text-red-600 text-xs font-semibold hover:underline">Delete</button></td></tr>))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// R27.6 #6/#7 — unified Expenses: ADVANCE flow (issue cash → settle expenses →
// auto-settle at 0 / Return Cash) + DIRECT flow (post straight w/ payment mode).
// Approved sales-team expenses appear here too (synced server-side, #7).
const PAYMENT_MODES = ["cash", "upi", "bank", "card", "cheque"];
function ExpensesTab({ token }: { token: string | null }) {
  const f = useF();
  const [mode, setMode] = useState<"direct" | "advance">("direct");
  const [expenses, setExpenses] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [headers, setHeaders] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [direct, setDirect] = useState({ amount: "", payment_mode: "cash", expense_header_id: "", branch_id: "Delhi", description: "", expense_date: today });
  const [advForm, setAdvForm] = useState({ staff_id: "", amount: "", purpose: "", branch_id: "Delhi" });
  const [settle, setSettle] = useState({ advance_id: "", amount: "", expense_header_id: "", description: "", expense_date: today });

  async function load() {
    const [x, a, e, h] = await Promise.all([
      f(token, "/api/finance/expenses"), f(token, "/api/finance/expense-advances?status=open"),
      f(token, "/api/finance/employees"), f(token, "/api/finance/expense-headers"),
    ]);
    if (x.ok) setExpenses(await x.json());
    if (a.ok) setAdvances(await a.json());
    if (e.ok) setEmps(await e.json());
    if (h.ok) setHeaders(await h.json());
  }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 3000); }

  async function addDirect() {
    if (!direct.amount) return;
    const r = await f(token, "/api/finance/expenses/direct", { method: "POST", body: JSON.stringify({ ...direct, amount: Number(direct.amount), expense_header_id: direct.expense_header_id ? Number(direct.expense_header_id) : undefined }) });
    if (r.ok) { setDirect({ ...direct, amount: "", description: "" }); flash("Direct expense posted."); load(); }
    else flash((await r.json().catch(() => ({}))).error || "Failed");
  }
  async function issueAdvance() {
    if (!advForm.staff_id || !advForm.amount) return;
    const r = await f(token, "/api/finance/expense-advances", { method: "POST", body: JSON.stringify({ staff_id: Number(advForm.staff_id), amount: Number(advForm.amount), purpose: advForm.purpose, branch_id: advForm.branch_id }) });
    if (r.ok) { setAdvForm({ ...advForm, amount: "", purpose: "" }); flash("Advance issued."); load(); }
    else flash((await r.json().catch(() => ({}))).error || "Failed");
  }
  async function settleExpense() {
    if (!settle.advance_id || !settle.amount) return;
    const r = await f(token, "/api/finance/expenses/advance", { method: "POST", body: JSON.stringify({ advance_id: Number(settle.advance_id), amount: Number(settle.amount), expense_header_id: settle.expense_header_id ? Number(settle.expense_header_id) : undefined, description: settle.description, expense_date: settle.expense_date }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setSettle({ ...settle, amount: "", description: "" }); flash(j.advanceStatus === "settled" ? "Expense settled — advance fully settled." : `Expense settled. Balance ₹${j.advanceBalance}.`); load(); }
    else flash(j.error || "Failed");
  }
  async function returnCash(id: number) {
    if (!confirm("Return remaining advance cash and settle this advance?")) return;
    const r = await f(token, `/api/finance/expense-advances/${id}/return`, { method: "POST" });
    if (r.ok) { flash("Cash returned, advance settled."); load(); } else flash("Failed");
  }
  async function syncSales() {
    const r = await f(token, "/api/finance/expenses/sync-sales", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const synced = j.synced || 0, already = j.alreadySynced || 0, total = j.totalApproved || 0;
      flash(synced > 0
        ? `Synced ${synced} new sales expense(s). ${already} already in ledger (of ${total} approved).`
        : total > 0
          ? `All ${total} approved sales expense(s) already synced — nothing new.`
          : `No approved sales expenses to sync yet.`);
      load();
    } else flash("Failed");
  }

  return (
    <div>
      {msg && <div className="mb-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <button onClick={() => setMode("direct")} data-testid="expense-mode-direct" className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === "direct" ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>Direct Expense</button>
        <button onClick={() => setMode("advance")} data-testid="expense-mode-advance" className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === "advance" ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>Advance Expense</button>
        <button onClick={syncSales} data-testid="expense-sync-sales" className="ml-auto px-3 py-1.5 rounded-lg border text-sm font-semibold hover:bg-muted">Sync Sales Expenses</button>
      </div>
      {/* R27.7 #1 — staff-wise & day-wise expense exports */}
      <div className="flex gap-2 mb-4 items-center flex-wrap text-sm">
        <span className="text-xs text-muted-foreground">Exports:</span>
        <button onClick={() => downloadFile(f, token, "/api/admin/accounts/staff-expenses.xlsx", "staff-expenses.xlsx")} className="px-3 py-1.5 rounded-lg border font-semibold hover:bg-muted" data-testid="staff-export-xlsx">Staff-wise xlsx</button>
        <button onClick={() => downloadFile(f, token, "/api/admin/accounts/staff-expenses.csv", "staff-expenses.csv")} className="px-3 py-1.5 rounded-lg border font-semibold hover:bg-muted" data-testid="staff-export-csv">Staff-wise csv</button>
        <button onClick={() => downloadFile(f, token, "/api/admin/accounts/day-expenses.xlsx", "day-expenses.xlsx")} className="px-3 py-1.5 rounded-lg border font-semibold hover:bg-muted" data-testid="day-export-xlsx">Day-wise xlsx</button>
        <button onClick={() => downloadFile(f, token, "/api/admin/accounts/day-expenses.csv", "day-expenses.csv")} className="px-3 py-1.5 rounded-lg border font-semibold hover:bg-muted" data-testid="day-export-csv">Day-wise csv</button>
      </div>

      {mode === "direct" ? (
        <div className="flex gap-2 mb-5 bg-card border rounded-xl p-4 items-end flex-wrap">
          <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={direct.amount} onChange={(e) => setDirect({ ...direct, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" data-testid="direct-amount" /></div>
          <div><label className="text-xs text-muted-foreground">Payment mode</label><select value={direct.payment_mode} onChange={(e) => setDirect({ ...direct, payment_mode: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28">{PAYMENT_MODES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label className="text-xs text-muted-foreground">Header</label><select value={direct.expense_header_id} onChange={(e) => setDirect({ ...direct, expense_header_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40"><option value="">—</option>{headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          <div><label className="text-xs text-muted-foreground">Branch</label><select value={direct.branch_id} onChange={(e) => setDirect({ ...direct, branch_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          <div><label className="text-xs text-muted-foreground">Description</label><input value={direct.description} onChange={(e) => setDirect({ ...direct, description: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-44" /></div>
          <div><label className="text-xs text-muted-foreground">Date</label><input type="date" value={direct.expense_date} onChange={(e) => setDirect({ ...direct, expense_date: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm" /></div>
          <button onClick={addDirect} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="direct-submit">Post Direct</button>
        </div>
      ) : (
        <div className="space-y-4 mb-5">
          <div className="bg-card border rounded-xl p-4">
            <h4 className="text-sm font-bold mb-3">1 · Issue advance (staff receives cash first)</h4>
            <div className="flex gap-2 items-end flex-wrap">
              <div><label className="text-xs text-muted-foreground">Staff</label><select value={advForm.staff_id} onChange={(e) => setAdvForm({ ...advForm, staff_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-44"><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
              <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" data-testid="advance-amount" /></div>
              <div><label className="text-xs text-muted-foreground">Branch</label><select value={advForm.branch_id} onChange={(e) => setAdvForm({ ...advForm, branch_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
              <div><label className="text-xs text-muted-foreground">Purpose</label><input value={advForm.purpose} onChange={(e) => setAdvForm({ ...advForm, purpose: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-44" /></div>
              <button onClick={issueAdvance} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="advance-submit">Issue Advance</button>
            </div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <h4 className="text-sm font-bold mb-3">2 · Settle expense from an open advance</h4>
            <div className="flex gap-2 items-end flex-wrap">
              <div><label className="text-xs text-muted-foreground">Advance</label><select value={settle.advance_id} onChange={(e) => setSettle({ ...settle, advance_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-56" data-testid="settle-advance"><option value="">Select…</option>{advances.map((a) => <option key={a.id} value={a.id}>{a.staffName || a.staff_id} · bal ₹{a.balance}</option>)}</select></div>
              <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" data-testid="settle-amount" /></div>
              <div><label className="text-xs text-muted-foreground">Header</label><select value={settle.expense_header_id} onChange={(e) => setSettle({ ...settle, expense_header_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40"><option value="">—</option>{headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
              <div><label className="text-xs text-muted-foreground">Description</label><input value={settle.description} onChange={(e) => setSettle({ ...settle, description: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40" /></div>
              <button onClick={settleExpense} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="settle-submit">Settle</button>
            </div>
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-2">Open advances (auto-settle when balance hits ₹0)</div>
              <Table cols={["Staff", "Issued", "Balance", "Status", ""]} rows={advances.map((a) => [
                a.staffName || a.staff_id, `₹${Number(a.amount).toLocaleString("en-IN")}`, `₹${Number(a.balance).toLocaleString("en-IN")}`, a.status,
                <button key={a.id} onClick={() => returnCash(a.id)} className="text-accent text-xs font-semibold hover:underline" data-testid={`return-cash-${a.id}`}>Return Cash</button>,
              ])} />
            </div>
          </div>
        </div>
      )}

      <h4 className="text-sm font-bold mb-2">All expenses</h4>
      <Table cols={["Date", "Type", "Header", "Staff", "Mode", "Amount", "Description"]} rows={expenses.map((x) => [
        x.expense_date, x.source === "sales_expense" ? "sales" : x.expense_type, x.headerName || "—", x.staffName || "—",
        x.payment_mode || "—", `₹${Number(x.amount).toLocaleString("en-IN")}`, x.description || "—",
      ])} />
    </div>
  );
}

function CurrentTab({ token, isAdmin }: { token: string | null; isAdmin: boolean }) {
  const f = useF();
  const [rows, setRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({ expense_header_id: "", amount: "", expense_date: new Date().toISOString().slice(0, 10), branch: "Delhi" });
  async function load() {
    const [r, h] = await Promise.all([f(token, `/api/finance/current-expenses${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`), f(token, "/api/finance/expense-headers")]);
    if (r.ok) setRows(await r.json());
    if (h.ok) setHeaders(await h.json());
  }
  useEffect(() => { if (token) load(); }, [token, statusFilter]); // eslint-disable-line
  async function add() {
    if (!form.expense_header_id || !form.amount) return;
    const r = await f(token, "/api/finance/current-expenses", { method: "POST", body: JSON.stringify({ expense_header_id: Number(form.expense_header_id), amount: Number(form.amount), expense_date: form.expense_date, branch: form.branch }) });
    if (r.ok) { setForm({ ...form, amount: "" }); load(); }
  }
  async function decide(id: number, action: "approve" | "reject") {
    const r = await f(token, `/api/finance/current-expenses/${id}/${action}`, { method: "POST" });
    if (r.ok) load();
  }
  const statusBadge = (s: string) => s === "approved" ? "bg-emerald-600 text-white" : s === "rejected" ? "bg-red-600 text-white" : "bg-amber-500/15 text-amber-700";
  return (
    <div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Header</label><select value={form.expense_header_id} onChange={(e) => setForm({ ...form, expense_header_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48"><option value="">Select…</option>{headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Branch</label><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" /></div>
        <div><label className="text-xs text-muted-foreground">Date</label><input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Expense</button>
      </div>
      <div className="flex gap-2 mb-3 items-center"><label className="text-xs text-muted-foreground">Status</label><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 rounded-lg border bg-background text-sm"><option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><span className="text-xs text-muted-foreground">Expenses above the auto-approve limit (₹5,000) need admin approval.</span></div>
      <div className="bg-card border rounded-xl overflow-x-auto">
        {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No expenses.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Header</th><th className="p-3">Branch</th><th className="p-3 text-right">Amount</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="p-3">{r.headerName || "—"}</td>
                  <td className="p-3 text-xs">{r.branch || "—"}</td>
                  <td className="p-3 text-right">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                  <td className="p-3">{r.expense_date}</td>
                  <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${statusBadge(r.approval_status || "approved")}`}>{r.approval_status || "approved"}</span></td>
                  <td className="p-3">{isAdmin && (r.approval_status === "pending") && (<span className="flex gap-2"><button onClick={() => decide(r.id, "approve")} className="text-emerald-600 text-xs font-semibold hover:underline">Approve</button><button onClick={() => decide(r.id, "reject")} className="text-red-600 text-xs font-semibold hover:underline">Reject</button></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AdvancesTab({ token }: { token: string | null }) {
  const f = useF();
  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [form, setForm] = useState({ employee_id: "", amount_given: "", purpose: "" });
  async function load() {
    const [r, e] = await Promise.all([f(token, "/api/finance/advances"), f(token, "/api/finance/employees")]);
    if (r.ok) setRows(await r.json());
    if (e.ok) setEmps(await e.json());
  }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() {
    if (!form.employee_id || !form.amount_given) return;
    const r = await f(token, "/api/finance/advances", { method: "POST", body: JSON.stringify({ employee_id: Number(form.employee_id), amount_given: Number(form.amount_given), purpose: form.purpose }) });
    if (r.ok) { setForm({ employee_id: "", amount_given: "", purpose: "" }); load(); }
  }
  async function reconcile(id: number) {
    const amt = prompt("Reconcile amount (₹):");
    if (!amt) return;
    const r = await f(token, `/api/finance/advances/${id}/reconcile`, { method: "POST", body: JSON.stringify({ amount: Number(amt), description: "Reconciliation" }) });
    if (r.ok) load();
  }
  return (
    <div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Employee</label><select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48"><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={form.amount_given} onChange={(e) => setForm({ ...form, amount_given: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" /></div>
        <div><label className="text-xs text-muted-foreground">Purpose</label><input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Give Advance</button>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden">
        {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No advances given.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Employee</th><th className="p-3 text-right">Given</th><th className="p-3 text-right">Reconciled</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="p-3">{r.employeeName || r.employee_id}</td>
                  <td className="p-3 text-right">₹{r.amount_given}</td>
                  <td className="p-3 text-right">₹{r.reconciledAmount || 0}</td>
                  <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${r.status === "reconciled" ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700"}`}>{r.status}</span></td>
                  <td className="p-3">{r.status !== "reconciled" && <button onClick={() => reconcile(r.id)} className="text-accent text-xs font-semibold hover:underline">Reconcile</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EmployeesTab({ token, isAdmin }: { token: string | null; isAdmin: boolean }) {
  const f = useF();
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const blank = { name: "", contact: "", email: "", role: "", branch: "Delhi", pan: "", aadhar: "", bank_account: "", ifsc: "", joined_at: "", gross_salary: "", per_day_rate: "", retention_pct: "10", working_days_default: "26" };
  const [form, setForm] = useState<any>(blank);
  async function load() { const r = await f(token, `/api/finance/employees${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`); if (r.ok) setRows(await r.json()); }
  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(id); }, [search]);
  useEffect(() => { if (token) load(); }, [token, debounced]); // eslint-disable-line
  async function add() {
    if (!form.name.trim()) return;
    const body: any = {
      name: form.name.trim(), contact: form.contact, email: form.email, role: form.role, branch: form.branch,
      pan: form.pan, aadhar: form.aadhar, bank_account: form.bank_account, ifsc: form.ifsc, joined_at: form.joined_at || undefined,
      retention_pct: Number(form.retention_pct) || 10, working_days_default: Number(form.working_days_default) || 26,
    };
    if (isAdmin && form.gross_salary) body.gross_salary = Number(form.gross_salary);
    if (isAdmin && form.per_day_rate) body.per_day_rate = Number(form.per_day_rate);
    const r = await f(token, "/api/finance/employees", { method: "POST", body: JSON.stringify(body) });
    if (r.ok) { setForm(blank); setOpen(false); load(); }
  }
  async function toggleActive(emp: any) {
    const r = await f(token, `/api/finance/employees/${emp.id}`, { method: "PUT", body: JSON.stringify({ active: !emp.active }) });
    if (r.ok) load();
  }
  const inp = "block px-3 py-1.5 rounded-lg border bg-background text-sm w-full";
  return (
    <div>
      {!isAdmin && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Salary figures are masked. Sign in as admin to view/edit pay.</p>}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / contact / role / branch…" className="px-3 py-1.5 rounded-lg border bg-background text-sm w-72" data-testid="employee-search" />
        <button onClick={() => setOpen((o) => !o)} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">{open ? "Close" : "+ New Employee"}</button>
      </div>
      {open && (
        <div className="bg-card border rounded-xl p-4 mb-4 grid sm:grid-cols-3 gap-3">
          <div><label className="text-xs text-muted-foreground">Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Role</label><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Branch</label><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className={inp}>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          <div><label className="text-xs text-muted-foreground">Phone</label><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Joining date</label><input type="date" value={form.joined_at} onChange={(e) => setForm({ ...form, joined_at: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">PAN</label><input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Aadhaar</label><input value={form.aadhar} onChange={(e) => setForm({ ...form, aadhar: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Bank account</label><input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">IFSC</label><input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Working days/mo</label><input type="number" value={form.working_days_default} onChange={(e) => setForm({ ...form, working_days_default: e.target.value })} className={inp} /></div>
          <div><label className="text-xs text-muted-foreground">Retention %</label><input type="number" value={form.retention_pct} onChange={(e) => setForm({ ...form, retention_pct: e.target.value })} className={inp} /></div>
          {isAdmin && <div><label className="text-xs text-muted-foreground">Gross salary (₹)</label><input type="number" value={form.gross_salary} onChange={(e) => setForm({ ...form, gross_salary: e.target.value })} className={inp} /></div>}
          {isAdmin && <div><label className="text-xs text-muted-foreground">Per-day (₹)</label><input type="number" value={form.per_day_rate} onChange={(e) => setForm({ ...form, per_day_rate: e.target.value })} className={inp} /></div>}
          <div className="sm:col-span-3"><button onClick={add} className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Save Employee</button></div>
        </div>
      )}
      <div className="bg-card border rounded-xl overflow-x-auto">
        {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No employees{debounced ? " match your search." : "."}</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Branch</th><th className="p-3">Phone</th><th className="p-3">Gross</th><th className="p-3">Active</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30" data-testid={`employee-row-${r.id}`}>
                  <td className="p-3 font-semibold">{r.name}</td>
                  <td className="p-3 text-xs">{r.role || "—"}</td>
                  <td className="p-3 text-xs">{r.branch || "—"}</td>
                  <td className="p-3 text-xs">{r.contact || "—"}</td>
                  <td className="p-3">{r.gross_salary != null ? `₹${Number(r.gross_salary).toLocaleString("en-IN")}` : (isAdmin ? "—" : "•••")}</td>
                  <td className="p-3">{r.active ? <span className="text-emerald-600 text-xs font-semibold">Active</span> : <span className="text-muted-foreground text-xs">Inactive</span>}</td>
                  <td className="p-3"><button onClick={() => toggleActive(r)} className="text-accent text-xs font-semibold hover:underline">{r.active ? "Deactivate" : "Activate"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// R27.5 #8 — Person Ledger: running debit/credit balance per employee.
function LedgerTab({ token }: { token: string | null }) {
  const f = useF();
  const [emps, setEmps] = useState<any[]>([]);
  const [empId, setEmpId] = useState("");
  const [data, setData] = useState<{ rows: any[]; balance: number }>({ rows: [], balance: 0 });
  useEffect(() => { if (token) f(token, "/api/finance/employees").then((r) => { if (r.ok) r.json().then(setEmps); }); }, [token]); // eslint-disable-line
  async function load(id: string) {
    if (!id) { setData({ rows: [], balance: 0 }); return; }
    const r = await f(token, `/api/finance/person-ledger/${id}`); if (r.ok) setData(await r.json());
  }
  return (
    <div>
      <div className="flex gap-2 mb-4 items-end">
        <div><label className="text-xs text-muted-foreground">Employee</label><select value={empId} onChange={(e) => { setEmpId(e.target.value); load(e.target.value); }} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-56" data-testid="ledger-employee"><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        {empId && <div className="bg-card border rounded-xl px-4 py-2 ml-auto"><span className="text-xs text-muted-foreground mr-2">Running balance</span><span className={`font-bold ${data.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>₹{(data.balance || 0).toLocaleString("en-IN")}</span></div>}
      </div>
      <Table cols={["Date", "Kind", "Debit", "Credit", "Balance", "Notes"]} rows={data.rows.map((r) => [
        r.entry_date ? new Date(r.entry_date).toLocaleDateString("en-IN") : "—",
        r.kind,
        r.amount < 0 ? `₹${Math.abs(r.amount).toLocaleString("en-IN")}` : "—",
        r.amount > 0 ? `₹${Number(r.amount).toLocaleString("en-IN")}` : "—",
        `₹${Number(r.balance).toLocaleString("en-IN")}`,
        r.notes || "—",
      ])} />
    </div>
  );
}

function AttendanceTab({ token }: { token: string | null }) {
  const f = useF();
  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [form, setForm] = useState({ employee_id: "", month: new Date().toISOString().slice(0, 7), absent_days: "0" });
  async function load() {
    const [r, e] = await Promise.all([f(token, `/api/finance/attendance?month=${form.month}`), f(token, "/api/finance/employees")]);
    if (r.ok) setRows(await r.json());
    if (e.ok) setEmps(await e.json());
  }
  useEffect(() => { if (token) load(); }, [token, form.month]); // eslint-disable-line
  async function save() {
    if (!form.employee_id) return;
    const r = await f(token, "/api/finance/attendance", { method: "POST", body: JSON.stringify({ employee_id: Number(form.employee_id), month: form.month, absent_days: Number(form.absent_days) || 0 }) });
    if (r.ok) load();
  }
  return (
    <div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Employee</label><select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-44"><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Month</label><input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm" /></div>
        <div><label className="text-xs text-muted-foreground">Absent days</label><input type="number" value={form.absent_days} onChange={(e) => setForm({ ...form, absent_days: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28" /></div>
        <button onClick={save} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Save</button>
      </div>
      <Table cols={["Employee", "Month", "Absent days"]} rows={rows.map((r) => [r.employeeName || r.employee_id, r.month, r.absent_days])} />
    </div>
  );
}

function SalaryTab({ token, isAdmin }: { token: string | null; isAdmin: boolean }) {
  const f = useF();
  const [runs, setRuns] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [computed, setComputed] = useState<any | null>(null);
  const [empId, setEmpId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function load() {
    const [r, e] = await Promise.all([f(token, `/api/finance/salary/runs?month=${month}`), f(token, "/api/finance/employees")]);
    if (r.ok) setRuns(await r.json()); else setRuns([]);
    if (e.ok) setEmps(await e.json());
  }
  useEffect(() => { if (token && isAdmin) load(); }, [token, month]); // eslint-disable-line
  if (!isAdmin) return <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">Salary computation is admin-only. Sign in as admin to compute and finalize salaries.</p>;
  async function compute() {
    if (!empId) return;
    const r = await f(token, `/api/finance/salary/compute?employee_id=${empId}&month=${month}`);
    if (r.ok) setComputed(await r.json());
  }
  async function finalize() {
    if (!computed) return;
    const r = await f(token, "/api/finance/salary/finalize", { method: "POST", body: JSON.stringify({ employee_id: computed.employee_id, month }) });
    if (r.ok) { setMsg("Salary finalized."); setComputed(null); load(); setTimeout(() => setMsg(null), 3000); }
  }
  // R27.4 — email a salary slip for a finalized run to a chosen address.
  async function emailSlip(run: any) {
    const to = prompt(`Email salary slip for ${run.employeeName || run.employee_id} (${run.month}) to:`);
    if (!to) return;
    const r = await f(token, "/api/finance/salary/email", { method: "POST", body: JSON.stringify({ employee_id: run.employee_id, month: run.month, to }) });
    if (r.ok) { setMsg(`Salary slip emailed to ${to}.`); load(); setTimeout(() => setMsg(null), 3000); }
    else setMsg("Failed to email slip.");
  }
  return (
    <div>
      {msg && <div className="mb-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Employee</label><select value={empId} onChange={(e) => setEmpId(e.target.value)} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-44"><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="block px-3 py-1.5 rounded-lg border bg-background text-sm" /></div>
        <button onClick={compute} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Compute</button>
        <a href={`/api/finance/salary/export.xlsx?month=${month}`} className="px-3 py-1.5 rounded-lg border text-sm font-semibold hover:bg-muted">Export xlsx</a>
      </div>
      {computed && (
        <div className="bg-card border rounded-xl p-5 mb-4">
          <h3 className="font-bold mb-3">{computed.employeeName} — {computed.month}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Working days" value={computed.working_days} />
            <Stat label="Gross" value={`₹${computed.gross}`} />
            <Stat label="Advance ded." value={`₹${computed.advance_deduction}`} />
            <Stat label="Retention" value={`₹${computed.retention_amount}`} />
            <Stat label="Net payable" value={`₹${computed.net_payable}`} highlight />
          </div>
          <button onClick={finalize} className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">Finalize Salary</button>
        </div>
      )}
      <div className="bg-card border rounded-xl overflow-x-auto">
        {runs.length === 0 ? <div className="p-8 text-center text-muted-foreground">No salary runs.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Employee</th><th className="p-3">Month</th><th className="p-3">Working</th><th className="p-3">Gross</th><th className="p-3">Net</th><th className="p-3">Paid</th><th className="p-3">Emailed</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="p-3">{r.employeeName || r.employee_id}</td>
                  <td className="p-3">{r.month}</td>
                  <td className="p-3">{r.working_days}</td>
                  <td className="p-3">₹{r.gross}</td>
                  <td className="p-3">₹{r.net_payable}</td>
                  <td className="p-3">{r.paid_at ? "Yes" : "No"}</td>
                  <td className="p-3">{r.emailed_at ? "Yes" : "—"}</td>
                  <td className="p-3"><button onClick={() => emailSlip(r)} data-testid={`salary-email-${r.id}`} className="text-accent text-xs font-semibold hover:underline">Email Slip</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return <div className={`rounded-lg border p-3 ${highlight ? "bg-emerald-50 border-emerald-200" : ""}`}><div className="text-xs text-muted-foreground">{label}</div><div className={`font-bold ${highlight ? "text-emerald-700" : ""}`}>{value}</div></div>;
}

function Table({ cols, rows }: { cols: string[]; rows: any[][] }) {
  return (
    <div className="bg-card border rounded-xl overflow-x-auto">
      {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No records.</div> : (
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr>{cols.map((c) => <th key={c} className="p-3">{c}</th>)}</tr></thead>
          <tbody className="divide-y">{rows.map((r, i) => <tr key={i} className="hover:bg-muted/30">{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
