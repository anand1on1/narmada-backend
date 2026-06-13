import RoleLogin from "./RoleLogin";
import { HRAuth } from "@/lib/role-auth";
import { Users } from "lucide-react";

export default function HRLogin() {
  return <RoleLogin role="hr" title="HR Portal" accent="text-indigo-600" icon={Users} redirectTo="/hr/dashboard" auth={HRAuth} />;
}
