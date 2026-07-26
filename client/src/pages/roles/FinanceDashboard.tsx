import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";
import { AccountsBody } from "./AccountsDashboard";
import { FinanceNav, usePendingExpenseApprovals } from "./FinanceExpensePages";

export default function FinanceDashboard() {
  const { token } = FinanceAuth.useAuth();
  // R27.36-FIX-1 — badge mirrors the admin sidebar's pending expense count.
  const pending = usePendingExpenseApprovals(token);
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login"
      right={<NotificationsBell roleFetch={FinanceAuth.roleFetch} token={token} />}>
      <FinanceNav active="/finance/dashboard" pendingExpenseApprovals={pending} />
      <AccountsBody />
    </RolePortalShell>
  );
}
