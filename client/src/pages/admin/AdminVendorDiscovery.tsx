import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, Plus } from "lucide-react";

interface Candidate { name: string; city: string | null; phone: string | null; website: string | null; source_url: string | null; confidence: number; }

export default function AdminVendorDiscovery() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [citations, setCitations] = useState<string[]>([]);

  const search = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendor-discovery`, { method: "POST", body: JSON.stringify({ query }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      return d;
    },
    onSuccess: (d) => { setCandidates(d.candidates || []); setCitations(d.citations || []); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addVendor = useMutation({
    mutationFn: async (c: Candidate) => {
      const r = await adminFetch(token, `/api/admin/vendors`, { method: "POST", body: JSON.stringify({ name: c.name, city: c.city, phone: c.phone, notes: c.website || undefined }) });
      if (!r.ok) throw new Error("Add failed");
    },
    onSuccess: () => toast({ title: "Vendor added" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout title="AI Vendor Discovery">
      <div className="bg-card border rounded-xl p-5 shadow-sm mb-6">
        <p className="text-sm text-muted-foreground mb-3">Find new suppliers/manufacturers via AI web search (Perplexity).</p>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && search.mutate()}
            placeholder="e.g. brake pad manufacturers for Tata trucks in Delhi NCR"
            className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
          <button onClick={() => search.mutate()} disabled={!query.trim() || search.isPending}
            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
          </button>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="bg-card border rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-3 font-semibold">Name</th>
              <th className="px-3 py-3 font-semibold">City</th>
              <th className="px-3 py-3 font-semibold">Phone</th>
              <th className="px-3 py-3 font-semibold">Website</th>
              <th className="px-3 py-3 font-semibold text-right">Conf.</th>
              <th className="px-3 py-3 font-semibold text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y">{candidates.map((c, i) => (
              <tr key={i} className="hover:bg-muted/30">
                <td className="px-3 py-3 font-semibold">{c.name}</td>
                <td className="px-3 py-3">{c.city || "—"}</td>
                <td className="px-3 py-3">{c.phone || "—"}</td>
                <td className="px-3 py-3 text-xs">{c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="text-accent underline">{c.website}</a> : "—"}</td>
                <td className="px-3 py-3 text-right">{c.confidence != null ? `${Math.round(c.confidence * 100)}%` : "—"}</td>
                <td className="px-3 py-3 text-right">
                  <button onClick={() => addVendor.mutate(c)} className="px-2.5 py-1 border rounded text-xs font-semibold inline-flex items-center gap-1 hover:bg-muted">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {citations.length > 0 && (
        <div className="mt-4 text-xs text-muted-foreground">
          <div className="font-semibold mb-1">Sources:</div>
          <ul className="list-disc pl-5 space-y-0.5">{citations.map((c, i) => <li key={i}><a href={c} target="_blank" rel="noreferrer" className="underline">{c}</a></li>)}</ul>
        </div>
      )}
    </AdminLayout>
  );
}
