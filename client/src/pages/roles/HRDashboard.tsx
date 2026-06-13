import RolePortalShell from "./RolePortalShell";
import { HRAuth } from "@/lib/role-auth";
import { Users } from "lucide-react";
import NotificationsBell from "@/components/NotificationsBell";

export default function HRDashboard() {
  const { token } = HRAuth.useAuth();
  return (
    <RolePortalShell title="HR Portal" accent="text-indigo-600" icon={Users} auth={HRAuth} loginPath="/hr/login"
      right={<NotificationsBell roleFetch={HRAuth.roleFetch} token={token} />}>
      <div className="bg-card border rounded-2xl p-10 text-center">
        <Users className="w-10 h-10 mx-auto mb-3 text-indigo-500 opacity-60" />
        <h2 className="text-lg font-bold mb-1">HR Portal</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          You're signed in. HR tools (attendance review, team roster, leave) will appear here as they're rolled out.
        </p>
      </div>
    </RolePortalShell>
  );
}
