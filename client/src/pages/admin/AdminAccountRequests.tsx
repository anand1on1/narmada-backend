import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { CheckCircle, XCircle, Clock, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface AccountRequest {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  gstin: string | null;
  address: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

type Tab = "pending" | "approved" | "rejected";

export default function AdminAccountRequests() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [rejectTarget, setRejectTarget] = useState<AccountRequest | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const { data: items = [], isLoading, refetch } = useQuery<AccountRequest[]>({
    queryKey: ["account-requests", tab],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/account-requests?status=${tab}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!token,
  });

  const approveMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await adminFetch(token, `/api/admin/account-requests/${id}/approve`, { method: "POST" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Approve failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-requests"] });
      toast({ title: "Request approved", description: "Customer account created and OTP sent via WhatsApp." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const r = await adminFetch(token, `/api/admin/account-requests/${id}/reject`, {
        method: "POST", body: JSON.stringify({ notes }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Reject failed"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-requests"] });
      setRejectTarget(null);
      setRejectNotes("");
      toast({ title: "Request rejected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tabLabels: Record<Tab, string> = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  };

  const tabIcon = (t: Tab) => {
    if (t === "pending") return <Clock className="w-4 h-4" />;
    if (t === "approved") return <CheckCircle className="w-4 h-4" />;
    return <XCircle className="w-4 h-4" />;
  };

  return (
    <AdminLayout title="Account Requests">
      <div className="flex gap-2 mb-4">
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 ${tab === t ? "bg-accent text-accent-foreground" : "border hover:bg-muted"}`}>
            {tabIcon(t)}
            {tabLabels[t]}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => refetch()} className="p-2 border rounded-lg hover:bg-muted" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-x-auto">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No {tab} requests.
            {tab === "pending" && " All caught up!"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Company / GSTIN</th>
                <th className="px-4 py-3 font-semibold">Address</th>
                <th className="px-4 py-3 font-semibold">Requested</th>
                {tab !== "pending" && <th className="px-4 py-3 font-semibold">Notes</th>}
                {tab === "pending" && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((req) => (
                <tr key={req.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-semibold">{req.name}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{req.email}</div>
                    <div className="text-muted-foreground">{req.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium">{req.company || "—"}</div>
                    <div className="text-muted-foreground font-mono">{req.gstin || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{req.address || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(req.createdAt).toLocaleDateString("en-IN")}
                  </td>
                  {tab !== "pending" && (
                    <td className="px-4 py-3 text-xs text-muted-foreground">{req.reviewNotes || "—"}</td>
                  )}
                  {tab === "pending" && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => { if (confirm(`Approve request from ${req.name}? This will create a customer account and send login OTP.`)) approveMut.mutate(req.id); }}
                        disabled={approveMut.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 mr-2">
                        <CheckCircle className="w-3 h-3" /> Approve
                      </button>
                      <button
                        onClick={() => { setRejectTarget(req); setRejectNotes(""); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700">
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reject dialog */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Reject Request</h2>
              <button onClick={() => setRejectTarget(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Rejecting request from <strong>{rejectTarget.name}</strong> ({rejectTarget.email}).
              </p>
              <label className="block text-sm">
                <div className="text-xs font-bold uppercase tracking-wider mb-1 text-muted-foreground">Notes (optional)</div>
                <textarea value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3}
                  placeholder="Reason for rejection (visible to admin only)..."
                  className="w-full border rounded-lg px-3 py-2 bg-background text-sm" />
              </label>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setRejectTarget(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => rejectMut.mutate({ id: rejectTarget.id, notes: rejectNotes })}
                disabled={rejectMut.isPending}
                className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold">
                {rejectMut.isPending ? "Rejecting…" : "Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
