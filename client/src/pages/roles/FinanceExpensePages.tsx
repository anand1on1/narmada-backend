// R27.36-FIX-1 — Finance Portal entry points for the three R27.36 expense pages.
//
// The finance team logs in at /#/finance/login, not the team or admin panel, so the
// R27.36 pages were unreachable for them. These wrappers render the exact same page
// bodies driven by FinanceAuth's token instead of the team/admin token — no logic is
// duplicated. FinanceAuth.roleFetch already sends the data_team session token, which
// the expense routes accept (see r27-36-fix1-finance-portal.test.ts).
import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Wallet } from "lucide-react";
import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { ExpensesBody } from "@/pages/team/TeamExpenses";
import { ExpenseLedgerBody } from "@/pages/team/TeamExpenseLedger";
import { ExpenseApprovalsBody } from "@/pages/admin/AdminExpenseApprovals";
import { ExpensesUnifiedBody } from "@/pages/ExpensesUnified"; // R27.36a-part-2

const NAV = [
  { href: "/finance/dashboard", label: "Accounts" },
  { href: "/finance/approvals", label: "Sales Expense Approvals" },
  // R27.36a-part-2 — unified Expenses button (Ledger + Advances + Cash + Person + Categories).
  // The R27.36 buttons below remain for now until this is validated on prod.
  { href: "/finance/expenses-unified", label: "Expenses (Unified)" },
  { href: "/finance/expenses", label: "Expenses" },
  { href: "/finance/expense-ledger", label: "Expense Ledger" },
  { href: "/finance/expense-approvals", label: "Expense Approvals" },
];

// Shared top nav. The pending badge is only rendered on the Expense Approvals entry.
export function FinanceNav({ active, pendingExpenseApprovals = 0 }: { active: string; pendingExpenseApprovals?: number }) {
  return (
    <div className="flex gap-2 mb-5 flex-wrap">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={
            "px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 " +
            (active === n.href ? "bg-accent text-accent-foreground" : "border hover:bg-muted")
          }
          data-testid={`nav-finance-${n.href.split("/").pop()}`}
        >
          {n.label}
          {n.href === "/finance/expense-approvals" && pendingExpenseApprovals > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold"
              data-testid="badge-finance-expense-approvals"
            >
              {pendingExpenseApprovals}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

// Polls the same endpoint on the same 60s cadence as the admin sidebar badge.
export function usePendingExpenseApprovals(token: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await FinanceAuth.roleFetch(token, "/api/admin/expense-approvals/pending?status=pending_approval");
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setCount(Number(d.pending_count) || 0);
      } catch { /* badge is cosmetic — never surface a toast for it */ }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);
  return count;
}

// Must be a stable module-level component: the page bodies receive it as the `Layout`
// prop, and a new function identity on each render would remount the page and wipe
// open forms. It derives `active` from the router rather than taking it as a prop.
function FinanceExpenseLayout({ title, children }: { title: string; children: ReactNode }) {
  const { token } = FinanceAuth.useAuth();
  const [location] = useLocation();
  const pending = usePendingExpenseApprovals(token);
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login">
      <FinanceNav active={location} pendingExpenseApprovals={pending} />
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      {children}
    </RolePortalShell>
  );
}

export function FinanceExpenses() {
  const { token } = FinanceAuth.useAuth();
  return <ExpensesBody token={token} fetcher={FinanceAuth.roleFetch} Layout={FinanceExpenseLayout} />;
}

export function FinanceExpenseLedger() {
  const { token } = FinanceAuth.useAuth();
  return <ExpenseLedgerBody token={token} fetcher={FinanceAuth.roleFetch} Layout={FinanceExpenseLayout} />;
}

export function FinanceExpenseApprovals() {
  const { token } = FinanceAuth.useAuth();
  return <ExpenseApprovalsBody token={token} fetcher={FinanceAuth.roleFetch} Layout={FinanceExpenseLayout} />;
}

// R27.36a-part-2 — unified Expenses page for the Finance portal.
export function FinanceExpensesUnified() {
  const { token } = FinanceAuth.useAuth();
  return <ExpensesUnifiedBody token={token} fetcher={FinanceAuth.roleFetch} Layout={FinanceExpenseLayout} />;
}
