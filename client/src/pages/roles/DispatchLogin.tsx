import RoleLogin from "./RoleLogin";
import { DispatchAuth } from "@/lib/role-auth";
import { Truck } from "lucide-react";

export default function DispatchLogin() {
  return <RoleLogin role="dispatch" title="Dispatch Portal" accent="text-indigo-600" icon={Truck} redirectTo="/dispatch/dashboard" auth={DispatchAuth} />;
}
