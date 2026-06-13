import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Trash2, Upload, Download } from "lucide-react";

interface Customer { id: number; name: string; }
interface Ledger {
  id: number; customerId: number; entryDate: number; voucherType: string; voucherNo: string | null;
  description: string | null; debitInr: number; creditInr: number; runningBalanceInr: number;
}
// R26.5 (A2) — PO/dispatch-derived shipped rows surfaced below the ledger.
interface ShippedEntry {
  poId: number; customerPoNumber: string | null; amount: number; shippedAt: number | null;
  consignmentStatus: string | null; isFullyDispatched: number | null;
  docketNo: string | null; courier: string | null; dispatchDate: string | null;
}

const VOUCHER_TYPES = ["opening", "invoice", "payment", "credit_note", "debit_note", "manual"];

export default function AdminLedger() {
  const { token } = useAdminAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Ledger[]>([]);
  const [shipped, setShipped] = useState<ShippedEntry[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [open, setOpen] = useState<any | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await adminFetch(token, `/api/admin/customers`);
        const data = await r.json();
        const list: Customer[] = Array.isArray(data) ? data : [];
        setCustomers(list);
        // Read ?customerId= from URL
        const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
        const initial = params.get("customerId");
        if (initial) setCustomerId(parseInt(initial, 10));
        else if (list[0]) setCustomerId(list[0].id);
      } catch (e) {
        console.error("[ledger] failed to load customers", e);
        setCustomers([]);
      }
    })();
  }, [token]);

  async function loadEntries() {
    if (!token || !customerId) return;
    try {
      // R26.5 (A2) — pass ?from=&to= (YYYY-MM-DD). Backend defaults to last 90 days when omitted.
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const r = await adminFetch(token, `/api/admin/customers/${customerId}/ledger${qs ? `?${qs}` : ""}`);
      const data = await r.json();
      // Endpoint returns { entries, shippedEntries, balanceInr }; older shapes may return a bare array.
      const list = Array.isArray(data) ? data : (data?.entries ?? []);
      setEntries(Array.isArray(list) ? list : []);
      setShipped(Array.isArray(data?.shippedEntries) ? data.shippedEntries : []);
    } catch (e) {
      console.error("[ledger] failed to load entries", e);
      setEntries([]); setShipped([]);
    }
  }
  useEffect(() => { loadEntries(); }, [customerId, token]); // eslint-disable-line

  async function save() {
    if (!token || !customerId || !open) return;
    // Convert UI date string (YYYY-MM-DD) → epoch ms timestamp for backend
    const payload = {
      ...open,
      entryDate: typeof open.entryDate === "string" ? new Date(open.entryDate).getTime() : open.entryDate,
      debitInr: Number(open.debitInr) || 0,
      creditInr: Number(open.creditInr) || 0,
    };
    const r = await adminFetch(token, `/api/admin/customers/${customerId}/ledger`, {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    setOpen(null); loadEntries();
  }

  async function del(id: number) {
    if (!token || !confirm("Delete this ledger entry? Running balance will be recomputed.")) return;
    const r = await adminFetch(token, `/api/admin/ledger/${id}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Failed"); return; }
    loadEntries();
  }

  function exportCsv() {
    if (entries.length === 0) return;
    const rows = [["Date", "Type", "Voucher", "Description", "Debit", "Credit", "Balance"]];
    entries.forEach((e) => rows.push([
      new Date(e.entryDate).toLocaleDateString("en-IN"),
      e.voucherType, e.voucherNo || "", e.description || "",
      String(e.debitInr || 0), String(e.creditInr || 0), String(e.runningBalanceInr || 0),
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-${customerId}-${Date.now()}.csv`;
    a.click();
  }

  const currentCustomer = customers.find((c) => c.id === customerId);
  const closingBalance = entries.length > 0 ? (Number(entries[entries.length - 1].runningBalanceInr) || 0) : 0;
  const totalDebit = entries.reduce((s, e) => s + (e.debitInr || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.creditInr || 0), 0);

  if (customers.length === 0) {
    return (
      <AdminLayout title="Ledger">
        <div className="bg-card border rounded-xl p-12 text-center" data-testid="ledger-no-customers">
          <div className="text-lg font-semibold mb-2">No customers yet</div>
          <p className="text-sm text-muted-foreground mb-5">Add a customer first — ledgers are kept per customer.</p>
          <a href="#/admin/customers" className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm">
            <Plus className="w-4 h-4" /> Go to Customers
          </a>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Ledger">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select value={customerId || ""} onChange={(e) => setCustomerId(parseInt(e.target.value, 10))}
          className="border rounded-lg px-3 py-2 bg-background text-sm min-w-72" data-testid="select-customer">
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {/* R26.5 (A2) — date range filter */}
        <div>
          <label className="text-[11px] block mb-0.5 text-muted-foreground">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="ledger-from" />
        </div>
        <div>
          <label className="text-[11px] block mb-0.5 text-muted-foreground">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-background text-sm" data-testid="ledger-to" />
        </div>
        <button onClick={loadEntries} className="px-3 py-2 border rounded-lg text-sm">Apply</button>
        <div className="flex-1" />
        <button onClick={exportCsv} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1.5"><Download className="w-4 h-4" />Export CSV</button>
        <button onClick={() => setCsvOpen(true)} className="px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-1.5"><Upload className="w-4 h-4" />Import CSV</button>
        <button onClick={() => setOpen({ entryDate: new Date().toISOString().slice(0, 10), voucherType: "manual", voucherNo: "", description: "", debitInr: 0, creditInr: 0 })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2" data-testid="button-new-entry">
          <Plus className="w-4 h-4" /> New Entry
        </button>
      </div>

      {currentCustomer && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Total Debit" value={`₹${totalDebit.toLocaleString("en-IN")}`} />
          <Stat label="Total Credit" value={`₹${totalCredit.toLocaleString("en-IN")}`} />
          <Stat label="Closing Balance" value={`₹${closingBalance.toLocaleString("en-IN")}`} accent={closingBalance > 0 ? "text-red-600" : "text-emerald-700"} />
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-x-auto">
        {!customerId ? (
          <div className="p-12 text-center text-muted-foreground" data-testid="ledger-select-prompt">Select a customer above to see their ledger.</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No ledger entries for this customer.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Voucher</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold text-right">Debit</th>
                <th className="px-4 py-3 font-semibold text-right">Credit</th>
                <th className="px-4 py-3 font-semibold text-right">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} data-testid={`row-ledger-${e.id}`}>
                  <td className="px-4 py-3 text-xs">{e.entryDate ? new Date(e.entryDate).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-muted">{e.voucherType ?? "—"}</span></td>
                  <td className="px-4 py-3 text-xs font-mono">{e.voucherNo || "—"}</td>
                  <td className="px-4 py-3 text-xs">{e.description || "—"}</td>
                  <td className="px-4 py-3 text-right">{e.debitInr ? `₹${(Number(e.debitInr) || 0).toLocaleString("en-IN")}` : ""}</td>
                  <td className="px-4 py-3 text-right">{e.creditInr ? `₹${(Number(e.creditInr) || 0).toLocaleString("en-IN")}` : ""}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{(e.runningBalanceInr || 0).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => del(e.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* R26.5 (A2) — shipped customers derived from PO/dispatch (no ledger row needed) */}
      {customerId && shipped.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">Shipped (from PO / dispatch)</h3>
          <div className="bg-card border rounded-xl overflow-x-auto" data-testid="shipped-entries">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-3 font-semibold">PO #</th>
                  <th className="px-4 py-3 font-semibold">Shipped</th>
                  <th className="px-4 py-3 font-semibold">Docket</th>
                  <th className="px-4 py-3 font-semibold">Courier</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shipped.map((s) => (
                  <tr key={s.poId} data-testid={`row-shipped-${s.poId}`}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{s.customerPoNumber || `PO-${s.poId}`}</td>
                    <td className="px-4 py-3 text-xs">{s.shippedAt ? new Date(s.shippedAt).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono">{s.docketNo || "—"}</td>
                    <td className="px-4 py-3 text-xs">{s.courier || "—"}</td>
                    <td className="px-4 py-3"><span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-muted">{s.consignmentStatus || (s.isFullyDispatched ? "dispatched" : "shipped")}</span></td>
                    <td className="px-4 py-3 text-right font-semibold">₹{(Number(s.amount) || 0).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">New Ledger Entry</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <Field label="Date"><input type="date" value={open.entryDate} onChange={(e) => setOpen({ ...open, entryDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Voucher Type"><select value={open.voucherType} onChange={(e) => setOpen({ ...open, voucherType: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background">
                {VOUCHER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></Field>
              <Field label="Voucher Number"><input value={open.voucherNo || ""} onChange={(e) => setOpen({ ...open, voucherNo: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <Field label="Description"><input value={open.description || ""} onChange={(e) => setOpen({ ...open, description: e.target.value })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Debit (₹)"><input type="number" value={open.debitInr || 0} onChange={(e) => setOpen({ ...open, debitInr: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
                <Field label="Credit (₹)"><input type="number" value={open.creditInr || 0} onChange={(e) => setOpen({ ...open, creditInr: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 bg-background" /></Field>
              </div>
              <div className="text-xs text-muted-foreground">Debit increases customer's outstanding (we owe them less, they owe us more). Credit reduces outstanding.</div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={save} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {csvOpen && <CsvImport customerId={customerId} onClose={() => setCsvOpen(false)} onDone={() => { setCsvOpen(false); loadEntries(); }} />}
    </AdminLayout>
  );
}

function CsvImport({ customerId, onClose, onDone }: any) {
  const { token } = useAdminAuth();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!token || !customerId) return;
    setBusy(true);
    try {
      const r = await adminFetch(token, `/api/admin/ledger/import-csv`, {
        method: "POST", body: JSON.stringify({ customerId, csv }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Failed"); return; }
      alert(`Imported ${j.inserted || 0} entries`);
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Import Ledger CSV</h2>
          <button onClick={onClose} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-xs text-muted-foreground">
            CSV columns: <code>entry_date, voucher_type, voucher_no, description, debit_inr, credit_inr</code>
            <br />Date format: YYYY-MM-DD or DD/MM/YYYY. Header row required.
          </div>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setCsv(await f.text());
          }} className="text-sm" />
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10} placeholder="Paste CSV here or upload file above" className="w-full border rounded-lg px-3 py-2 bg-background font-mono text-xs" />
        </div>
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={go} disabled={busy || !csv.trim()} className="px-6 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold">{busy ? "Importing…" : "Import"}</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="bg-card border rounded-xl p-4">
    <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${accent || ""}`}>{value}</div>
  </div>;
}

function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-sm"><div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">{label}</div>{children}</label>;
}
