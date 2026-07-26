import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import { SalesExpenseApprovals } from "@/components/SalesExpenseApprovals";
import { FinanceNav, usePendingExpenseApprovals } from "./FinanceExpensePages";

// R27.10 #7 — finance-side mirror of the admin Operations → Expense Approvals
// queue. Same component, driven by the finance role token. Lands on the
// "Pending Finance" chip (high-value expenses already cleared by admin).
export default function FinanceApprovalsPage() {
  const { token } = FinanceAuth.useAuth();
  const pending = usePendingExpenseApprovals(token);
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login">
      <FinanceNav active="/finance/approvals" pendingExpenseApprovals={pending} />
      <h2 className="text-lg font-bold mb-3">Sales Expense Approvals</h2>
      <SalesExpenseApprovals token={token} fetcher={FinanceAuth.roleFetch} role="finance" base="/api/finance/sales-expenses" />
    </RolePortalShell>
  );
}
