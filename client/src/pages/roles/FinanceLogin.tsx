import RoleLogin from "./RoleLogin";
import { FinanceAuth } from "@/lib/role-auth";
import { Wallet } from "lucide-react";

export default function FinanceLogin() {
  return <RoleLogin role="finance" title="Finance Portal" accent="text-emerald-600" icon={Wallet} redirectTo="/finance/dashboard" auth={FinanceAuth} />;
}
