import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import { Link } from "wouter";
import NotificationsBell from "@/components/NotificationsBell";
import { AccountsBody } from "./AccountsDashboard";

export default function FinanceDashboard() {
  const { token } = FinanceAuth.useAuth();
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login"
      right={<NotificationsBell roleFetch={FinanceAuth.roleFetch} token={token} />}>
      {/* R27.10 #7 — nav to the sales-expense approval mirror. */}
      <div className="flex gap-2 mb-5">
        <Link href="/finance/dashboard" className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-accent-foreground">Accounts</Link>
        <Link href="/finance/approvals" className="px-3 py-1.5 rounded-lg text-sm font-semibold border hover:bg-muted">Sales Expense Approvals</Link>
      </div>
      <AccountsBody />
    </RolePortalShell>
  );
}
