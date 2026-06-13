import { AdminLayout } from "./AdminLayout";
import { IntegrationsPanel } from "@/components/admin/IntegrationsPanel";

export default function AdminIntegrations() {
  return (
    <AdminLayout title="Integrations">
      <IntegrationsPanel />
    </AdminLayout>
  );
}
