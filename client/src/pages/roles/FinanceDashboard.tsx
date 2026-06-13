import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";

export default function FinanceDashboard() {
  const { token } = FinanceAuth.useAuth();
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login"
      right={<NotificationsBell roleFetch={FinanceAuth.roleFetch} token={token} />}>
      <div className="bg-card border rounded-2xl p-10 text-center">
        <Wallet className="w-10 h-10 mx-auto mb-3 text-emerald-500 opacity-60" />
        <h2 className="text-lg font-bold mb-1">Finance Portal</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          You're signed in. Finance tools (ledger review, payment approvals, receivables) will appear here as they're rolled out.
        </p>
      </div>
    </RolePortalShell>
  );
}
