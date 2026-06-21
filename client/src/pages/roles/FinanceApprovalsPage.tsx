import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import { Link } from "wouter";
import { SalesExpenseApprovals } from "@/components/SalesExpenseApprovals";

// R27.10 #7 — finance-side mirror of the admin Operations → Expense Approvals
// queue. Same component, driven by the finance role token. Lands on the
// "Pending Finance" chip (high-value expenses already cleared by admin).
export default function FinanceApprovalsPage() {
  const { token } = FinanceAuth.useAuth();
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login">
      <div className="flex gap-2 mb-5">
        <Link href="/finance/dashboard" className="px-3 py-1.5 rounded-lg text-sm font-semibold border hover:bg-muted">Accounts</Link>
        <Link href="/finance/approvals" className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-accent-foreground">Sales Expense Approvals</Link>
      </div>
      <h2 className="text-lg font-bold mb-3">Sales Expense Approvals</h2>
      <SalesExpenseApprovals token={token} fetcher={FinanceAuth.roleFetch} role="finance" base="/api/finance/sales-expenses" />
    </RolePortalShell>
  );
}
