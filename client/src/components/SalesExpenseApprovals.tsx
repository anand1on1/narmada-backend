import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Pencil, History, Paperclip } from "lucide-react";

// R27.10 #4/#5/#6/#7 — shared sales-expense approval queue used by both the admin
// Operations page and the finance approval mirror. `fetcher` is the role-aware fetch
// (adminFetch or FinanceAuth.roleFetch); `role` drives which actions render. The
// server enforces the real rules; the UI just mirrors them.
type Fetcher = (token: string | null, url: string, init?: RequestInit) => Promise<Response>;

const TIER_THRESHOLD = 1000;

// normalize either column to a display state
function stateOf(e: any): string {
  return String(e.approval_status ?? e.status ?? "pending").trim().toLowerCase();
}
function stateLabel(e: any): { text: string; cls: string } {
  const s = stateOf(e);
  if (s === "approved") return { text: "Approved", cls: "bg-emerald-600 text-white" };
  if (s === "rejected") return { text: "Rejected", cls: "bg-rose-500/15 text-rose-700" };
  if (s === "admin_approved") return { text: "Pending Finance", cls: "bg-sky-500/15 text-sky-700" };
  return { text: "Pending Admin", cls: "bg-amber-500/15 text-amber-700" };
}

export function SalesExpenseApprovals({ token, fetcher, role, base }: {
  token: string | null;
  fetcher: Fetcher;
  role: "admin" | "finance";
  base: string; // "/api/admin/sales-expenses" or "/api/finance/sales-expenses"
}) {
  // Default chip differs per role: finance lands on its own queue.
  const [status, setStatus] = useState(role === "finance" ? "admin_approved" : "pending");
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  async function load() {
    if (!token) return;
    const r = await fetcher(token, `${base}?status=${encodeURIComponent(status)}`);
    if (r.ok) setRows(await r.json());
  }
  useEffect(() => { load(); }, [token, status]); // eslint-disable-line

  async function act(id: number, action: "approve" | "reject") {
    if (!token) return;
    const r = await fetcher(token, `${base}/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(`Expense #${id} ${action === "approve" ? "approved" : "rejected"}.`); load(); setTimeout(() => setMsg(null), 3500); }
    else { setMsg(j.error || `Failed to ${action} #${id}`); setTimeout(() => setMsg(null), 5000); }
  }
  async function saveAmount(id: number) {
    if (!token) return;
    const amount = Number(editVal);
    if (!(amount > 0)) { setMsg("Enter a valid amount."); return; }
    const r = await fetcher(token, `${base}/${id}`, { method: "PATCH", body: JSON.stringify({ amount }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(`Amount for #${id} updated.`); setEditing(null); load(); setTimeout(() => setMsg(null), 3500); }
    else { setMsg(j.error || "Failed to edit amount"); setTimeout(() => setMsg(null), 5000); }
  }

  // R27.10 #5 — which buttons this role may press for a given row state.
  function canApprove(e: any): boolean {
    const s = stateOf(e);
    if (s === "approved" || s === "rejected") return false;
    const amt = Number(e.amount) || 0;
    if (amt <= TIER_THRESHOLD) return true; // single-step, either role
    if (role === "admin") return s === "pending"; // admin does the first stage
    return s === "admin_approved"; // finance finalizes high-value
  }
  function isTerminal(e: any): boolean { const s = stateOf(e); return s === "approved" || s === "rejected"; }

  const CHIPS: Array<[string, string]> = [
    ["pending", "Pending Admin"],
    ["admin_approved", "Pending Finance"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["", "All"],
  ];

  return (
    <div>
      {msg && <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex gap-2 mb-3 flex-wrap">
        {CHIPS.map(([val, label]) => (
          <button key={label} onClick={() => setStatus(val)} className={`px-2.5 py-1 rounded-md text-xs font-semibold ${status === val ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>{label}</button>
        ))}
      </div>
      <div className="bg-card border rounded-xl overflow-x-auto">
        {rows.length === 0 ? <div className="p-10 text-center text-muted-foreground">No expenses.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">#</th><th className="p-3">Type</th><th className="p-3">Rep</th><th className="p-3 text-right">Amount</th><th className="p-3">Date</th><th className="p-3">Proof</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((e) => {
                const lbl = stateLabel(e);
                const proof = e.proof_url || e.attachment_url || e.receipt_url;
                const isImg = proof && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(String(proof));
                return (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="p-3 font-mono">#{e.id}</td>
                    <td className="p-3">{e.expense_type || "—"}</td>
                    <td className="p-3">{e.salesName || e.salesUsername || e.sales_user_id || "—"}</td>
                    <td className="p-3 text-right">
                      {editing === e.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="number" value={editVal} onChange={(ev) => setEditVal(ev.target.value)} className="w-24 px-2 py-1 rounded border bg-background text-sm text-right" data-testid={`edit-amount-${e.id}`} />
                          <button onClick={() => saveAmount(e.id)} className="text-emerald-600 text-xs font-semibold hover:underline">Save</button>
                          <button onClick={() => setEditing(null)} className="text-muted-foreground text-xs hover:underline">Cancel</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          ₹{Number(e.amount || 0).toLocaleString("en-IN")}
                          {!isTerminal(e) && (
                            <button onClick={() => { setEditing(e.id); setEditVal(String(e.amount || "")); }} title="Edit amount" data-testid={`edit-btn-${e.id}`} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                          )}
                          {Number(e.editCount) > 0 && (
                            <span title={`edited from ₹${Number(e.firstAmount ?? 0).toLocaleString("en-IN")} by ${e.lastEditedBy || "?"} on ${e.lastEditedAt ? new Date(e.lastEditedAt).toLocaleString("en-IN") : "?"}`} className="text-amber-600"><History className="w-3 h-3" /></span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{e.expense_date || "—"}</td>
                    <td className="p-3">
                      {proof ? (
                        isImg ? (
                          <a href={proof} target="_blank" rel="noreferrer" title="View slip"><img src={proof} alt="slip" className="w-10 h-10 object-cover rounded border hover:ring-2 hover:ring-accent" /></a>
                        ) : (
                          <a href={proof} target="_blank" rel="noreferrer" className="text-accent text-xs font-semibold inline-flex items-center gap-1 hover:underline"><Paperclip className="w-3.5 h-3.5" /> View Slip</a>
                        )
                      ) : <span className="text-xs text-muted-foreground">No proof</span>}
                    </td>
                    <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${lbl.cls}`}>{lbl.text}</span></td>
                    <td className="p-3 text-right">
                      {!isTerminal(e) ? (
                        <div className="inline-flex gap-1">
                          {canApprove(e) && <button onClick={() => act(e.id, "approve")} data-testid={`approve-${e.id}`} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button>}
                          <button onClick={() => act(e.id, "reject")} data-testid={`reject-${e.id}`} className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-semibold inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Reject</button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
