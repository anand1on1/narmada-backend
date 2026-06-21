import RolePortalShell from "./RolePortalShell";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";
import { AccountsBody } from "./AccountsDashboard";

export default function FinanceDashboard() {
  const { token } = FinanceAuth.useAuth();
  return (
    <RolePortalShell title="Finance Portal" accent="text-emerald-600" icon={Wallet} auth={FinanceAuth} loginPath="/finance/login"
      right={<NotificationsBell roleFetch={FinanceAuth.roleFetch} token={token} />}>
      <AccountsBody />
    </RolePortalShell>
  );
}
