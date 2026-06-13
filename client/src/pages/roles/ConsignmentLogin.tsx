import RoleLogin from "./RoleLogin";
import { ConsignmentAuth } from "@/lib/role-auth";
import { Truck } from "lucide-react";

export default function ConsignmentLogin() {
  return <RoleLogin role="consignment" title="Consignment Portal" accent="text-blue-600" icon={Truck} redirectTo="/consignment/dashboard" auth={ConsignmentAuth} />;
}
