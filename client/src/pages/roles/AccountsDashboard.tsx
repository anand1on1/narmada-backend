import { useEffect, useState } from "react";
import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Calculator } from "lucide-react";

type Tab = "cash" | "headers" | "current" | "advances" | "employees" | "attendance" | "salary";

// R27.4 — extracted body so the Finance portal landing page (FinanceDashboard)
// can render the full accounts dashboard, not just a placeholder.
export function AccountsBody() {
  const { token, user } = FinanceAuth.useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>("cash");
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        {([["cash", "Cash in Hand"], ["headers", "Expense Headers"], ["current", "Current Expenses"], ["advances", "Advances"], ["employees", "Employees"], ["attendance", "Attendance"], ["salary", "Salary"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`accounts-tab-${k}`} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>{label}</button>
        ))}
      </div>
      {tab === "cash" && <CashTab token={token} />}
      {tab === "headers" && <HeadersTab token={token} />}
      {tab === "current" && <CurrentTab token={token} />}
      {tab === "advances" && <AdvancesTab token={token} />}
      {tab === "employees" && <EmployeesTab token={token} isAdmin={isAdmin} />}
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

const f = FinanceAuth.roleFetch;

function CashTab({ token }: { token: string | null }) {
  const [data, setData] = useState<{ rows: any[]; balance: number }>({ rows: [], balance: 0 });
  const [form, setForm] = useState({ source: "", amount: "", reference: "" });
  async function load() { const r = await f(token, "/api/finance/cash"); if (r.ok) setData(await r.json()); }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() {
    if (!form.source || !form.amount) return;
    const r = await f(token, "/api/finance/cash", { method: "POST", body: JSON.stringify({ source: form.source, amount: Number(form.amount), reference: form.reference }) });
    if (r.ok) { setForm({ source: "", amount: "", reference: "" }); load(); }
  }
  return (
    <div>
      <div className="bg-card border rounded-xl p-5 mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Current cash balance</span>
        <span className="text-2xl font-bold text-emerald-600">₹{(data.balance || 0).toLocaleString("en-IN")}</span>
      </div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Source</label><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48" /></div>
        <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" /></div>
        <div><label className="text-xs text-muted-foreground">Reference</label><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Entry</button>
      </div>
      <Table cols={["Source", "Amount", "Reference", "Date"]} rows={data.rows.map((r) => [r.source, `₹${r.amount}`, r.reference || "—", r.date ? new Date(r.date).toLocaleDateString("en-IN") : "—"])} />
    </div>
  );
}

function HeadersTab({ token }: { token: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState("");
  async function load() { const r = await f(token, "/api/finance/expense-headers"); if (r.ok) setRows(await r.json()); }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() { if (!name.trim()) return; const r = await f(token, "/api/finance/expense-headers", { method: "POST", body: JSON.stringify({ name: name.trim(), fields: [] }) }); if (r.ok) { setName(""); load(); } }
  async function del(id: number) { const r = await f(token, `/api/finance/expense-headers/${id}`, { method: "DELETE" }); if (r.ok) load(); }
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New header (e.g. Office Rent)" className="px-3 py-1.5 rounded-lg border bg-background text-sm w-64" />
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Header</button>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden">
        {rows.length === 0 ? <div className="p-8 text-center text-muted-foreground">No expense headers yet.</div> : (
          <table className="w-full text-sm"><tbody className="divide-y">
            {rows.map((r) => (<tr key={r.id} className="hover:bg-muted/30"><td className="p-3 font-semibold">{r.name}</td><td className="p-3 text-right"><button onClick={() => del(r.id)} className="text-red-600 text-xs font-semibold hover:underline">Delete</button></td></tr>))}
          </tbody></table>
        )}
      </div>
    </div>
  );
}

function CurrentTab({ token }: { token: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<any[]>([]);
  const [form, setForm] = useState({ expense_header_id: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) });
  async function load() {
    const [r, h] = await Promise.all([f(token, "/api/finance/current-expenses"), f(token, "/api/finance/expense-headers")]);
    if (r.ok) setRows(await r.json());
    if (h.ok) setHeaders(await h.json());
  }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() {
    if (!form.expense_header_id || !form.amount) return;
    const r = await f(token, "/api/finance/current-expenses", { method: "POST", body: JSON.stringify({ expense_header_id: Number(form.expense_header_id), amount: Number(form.amount), expense_date: form.expense_date }) });
    if (r.ok) { setForm({ ...form, amount: "" }); load(); }
  }
  return (
    <div>
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Header</label><select value={form.expense_header_id} onChange={(e) => setForm({ ...form, expense_header_id: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48"><option value="">Select…</option>{headers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
        <div><label className="text-xs text-muted-foreground">Amount (₹)</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" /></div>
        <div><label className="text-xs text-muted-foreground">Date</label><input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Expense</button>
      </div>
      <Table cols={["Header", "Amount", "Date"]} rows={rows.map((r) => [r.headerName || "—", `₹${r.amount}`, r.expense_date])} />
    </div>
  );
}

function AdvancesTab({ token }: { token: string | null }) {
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
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", contact: "", per_day_rate: "", retention_pct: "10" });
  async function load() { const r = await f(token, "/api/finance/employees"); if (r.ok) setRows(await r.json()); }
  useEffect(() => { if (token) load(); }, [token]); // eslint-disable-line
  async function add() {
    if (!form.name.trim()) return;
    const body: any = { name: form.name.trim(), contact: form.contact, retention_pct: Number(form.retention_pct) || 10 };
    if (isAdmin && form.per_day_rate) body.per_day_rate = Number(form.per_day_rate);
    const r = await f(token, "/api/finance/employees", { method: "POST", body: JSON.stringify(body) });
    if (r.ok) { setForm({ name: "", contact: "", per_day_rate: "", retention_pct: "10" }); load(); }
  }
  return (
    <div>
      {!isAdmin && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Salary rates are masked. Sign in as admin to view/edit per-day rates.</p>}
      <div className="flex gap-2 mb-4 bg-card border rounded-xl p-4 items-end flex-wrap">
        <div><label className="text-xs text-muted-foreground">Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-40" /></div>
        <div><label className="text-xs text-muted-foreground">Contact</label><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-36" /></div>
        {isAdmin && <div><label className="text-xs text-muted-foreground">Per-day (₹)</label><input type="number" value={form.per_day_rate} onChange={(e) => setForm({ ...form, per_day_rate: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-28" /></div>}
        <div><label className="text-xs text-muted-foreground">Retention %</label><input type="number" value={form.retention_pct} onChange={(e) => setForm({ ...form, retention_pct: e.target.value })} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-24" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold">Add Employee</button>
      </div>
      <Table cols={["Name", "Contact", "Per-day", "Retention %", "Active"]} rows={rows.map((r) => [r.name, r.contact || "—", r.per_day_rate != null ? `₹${r.per_day_rate}` : (isAdmin ? "—" : "•••"), `${r.retention_pct ?? 10}%`, r.active ? "Yes" : "No"])} />
    </div>
  );
}

function AttendanceTab({ token }: { token: string | null }) {
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
