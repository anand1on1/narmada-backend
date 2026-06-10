import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { useTeamAuth } from "@/lib/team-auth";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/queryClient";

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  gstNumber: string | null;
}

export default function TeamCustomers() {
  const { token } = useTeamAuth();
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["team-customers", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ.trim()) p.set("q", searchQ.trim());
      const r = await fetch(apiUrl(`/api/admin/customers?${p}`), {
        headers: { "x-team-token": token || "" },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!token,
  });

  return (
    <TeamLayout title="Customers">
      <p className="text-sm text-muted-foreground mb-4">Read-only customer list. Use when creating a quotation to find the right customer.</p>
      <div className="flex gap-2 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchQ(q)}
            placeholder="Search customers…"
            className="border rounded-lg pl-9 pr-3 py-2 bg-background text-sm w-72" />
        </div>
        <button onClick={() => setSearchQ(q)} className="px-4 py-2 border rounded-lg text-sm hover:bg-muted">Search</button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No customers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Location</th>
                <th className="px-4 py-3 font-semibold">GST</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{c.email || "—"}</div>
                    <div className="text-muted-foreground">{c.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-xs font-mono">{c.gstNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </TeamLayout>
  );
}
