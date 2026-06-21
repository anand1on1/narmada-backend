import { AdminLayout } from "./AdminLayout";
import { useAdminAuth, adminFetch } from "@/lib/admin-auth";
import { AccountsBodyAdmin } from "@/pages/roles/AccountsDashboard";

// R27.8 #5/#6 — admin-panel mirror of the Finance accounts dashboard. Renders the
// exact same tabs (Cash, Headers, Expenses, Current, Advances, Employees, Person
// Ledger, Attendance, Salary) but drives every request through adminFetch so the
// admin token authenticates (isAdminAcct=true => full, unmasked salary).
//
// #5 "Staff" 404 fix: this component is registered for /admin/staff (employee
// master with salary/advances/attendance via the Employees, Salary, Advances and
// Attendance tabs). #6 the same component backs the admin "Accounts" group.
export default function AdminAccounts({ title = "Accounts" }: { title?: string }) {
  const { token } = useAdminAuth();
  return (
    <AdminLayout title={title}>
      <AccountsBodyAdmin token={token} adminFetch={adminFetch} />
    </AdminLayout>
  );
}
