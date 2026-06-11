import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Send, Trophy } from "lucide-react";

interface RfqItem { id: number; partNumber: string | null; brand: string | null; description: string | null; qty: number; }
interface RfqVendor { id: number; vendorId: number; status: string; sentAt: number | null; }
interface RfqQuote { id: number; vendorId: number; itemId: number | null; rate: number | null; moq: number | null; leadTimeDays: number | null; notes: string | null; extractedBy: string; isWinner: boolean; }
interface RFQ { id: number; rfqNumber: string; status: string; items: RfqItem[]; vendors: RfqVendor[]; quotes: RfqQuote[]; }
interface Vendor { id: number; name: string; }

export default function TeamRFQDetail() {
  const { id } = useParams<{ id: string }>();
  const rfqId = parseInt(id, 10);
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rfq } = useQuery<RFQ>({
    queryKey: ["team-rfq", rfqId],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/rfqs/${rfqId}`); return r.ok ? r.json() : null; },
    enabled: !!token && !!rfqId,
    refetchInterval: 30000,
  });
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["team-vendors-min"],
    queryFn: async () => { const r = await teamFetch(token, `/api/team/vendors`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });
  const vname = (vid: number) => vendors.find((v) => v.id === vid)?.name || `#${vid}`;

  const send = useMutation({
    mutationFn: async () => { const r = await teamFetch(token, `/api/team/rfqs/${rfqId}/send`, { method: "POST" }); if (!r.ok) throw new Error("Send failed"); return r.json(); },
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ["team-rfq", rfqId] }); toast({ title: "RFQ sent", description: `Sent to ${d.sentTo} vendor(s) via WhatsApp.` }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const selectWinner = useMutation({
    mutationFn: async (quoteId: number) => { const r = await teamFetch(token, `/api/team/rfq-quotes/${quoteId}/select-winner`, { method: "POST" }); if (!r.ok) throw new Error("Failed"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-rfq", rfqId] }); toast({ title: "Winner selected" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!rfq) return <TeamLayout title="RFQ"><div className="p-12 text-center text-muted-foreground">Loading…</div></TeamLayout>;

  return (
    <TeamLayout title={`RFQ ${rfq.rfqNumber}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm">Status: <span className="font-bold">{rfq.status}</span></span>
        <button onClick={() => send.mutate()} disabled={send.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          <Send className="w-4 h-4" /> {rfq.status === "sent" ? "Resend to Vendors" : "Send to Vendors"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <h3 className="font-bold mb-2">Items</h3>
          {rfq.items.length === 0 ? <div className="text-sm text-muted-foreground">No items.</div> :
            <ul className="text-sm space-y-1">{rfq.items.map((it) => <li key={it.id} className="border-b last:border-0 py-1"><span className="font-semibold">{it.partNumber || "—"}</span> {it.brand} {it.description} <span className="text-muted-foreground">×{it.qty}</span></li>)}</ul>}
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <h3 className="font-bold mb-2">Vendors</h3>
          {rfq.vendors.length === 0 ? <div className="text-sm text-muted-foreground">No vendors attached.</div> :
            <ul className="text-sm space-y-1">{rfq.vendors.map((rv) => <li key={rv.id} className="flex justify-between border-b last:border-0 py-1"><span>{vname(rv.vendorId)}</span><span className="text-xs text-muted-foreground">{rv.sentAt ? "sent" : rv.status}</span></li>)}</ul>}
        </div>
      </div>

      <div className="mt-4 bg-card border rounded-xl overflow-x-auto shadow-sm">
        <div className="px-4 py-3 font-bold border-b">Quotes Received</div>
        {rfq.quotes.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No quotes yet. Vendor replies arrive via WhatsApp webhook.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-semibold">Vendor</th>
              <th className="px-3 py-2 font-semibold text-right">Rate</th>
              <th className="px-3 py-2 font-semibold text-right">MOQ</th>
              <th className="px-3 py-2 font-semibold text-right">Lead (d)</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y">{rfq.quotes.map((q) => (
              <tr key={q.id} className={q.isWinner ? "bg-emerald-500/5" : "hover:bg-muted/30"}>
                <td className="px-3 py-2 font-semibold">{vname(q.vendorId)} {q.isWinner && <Trophy className="w-3.5 h-3.5 inline text-emerald-600" />}</td>
                <td className="px-3 py-2 text-right">{q.rate != null ? `₹${q.rate.toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-3 py-2 text-right">{q.moq ?? "—"}</td>
                <td className="px-3 py-2 text-right">{q.leadTimeDays ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{q.extractedBy}</td>
                <td className="px-3 py-2 text-right">
                  {!q.isWinner && <button onClick={() => selectWinner.mutate(q.id)} className="text-xs px-2 py-1 rounded bg-accent text-accent-foreground font-semibold">Select winner</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </TeamLayout>
  );
}
