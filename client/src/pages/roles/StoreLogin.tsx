import RoleLogin from "./RoleLogin";
import { StoreAuth } from "@/lib/role-auth";
import { Warehouse } from "lucide-react";

export default function StoreLogin() {
  return <RoleLogin role="store" title="Store Portal" accent="text-amber-600" icon={Warehouse} redirectTo="/store/dashboard" auth={StoreAuth} />;
}
