import RoleLogin from "./RoleLogin";
import { SalesAuth } from "@/lib/role-auth";
import { Briefcase } from "lucide-react";

export default function SalesLogin() {
  return <RoleLogin role="sales" title="Sales Portal" accent="text-amber-600" icon={Briefcase} redirectTo="/sales/dashboard" auth={SalesAuth} />;
}
