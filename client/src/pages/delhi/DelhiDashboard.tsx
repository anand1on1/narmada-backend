import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/Logo";
import { LogOut, Package, Truck, PackageCheck } from "lucide-react";

interface QItem {
  id: number; partNumber: string | null; brand: string | null; qty: number;
  vendorName: string; vendorPhone: string; vendorAddress: string;
  clientName: string; clientCity: string; poNumber: string;
}
interface Queue { pickup: QItem[]; pack: QItem[]; dispatch: QItem[]; }

export default function DelhiDashboard() {
  const { token, user, clear, ready } = useTeamAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dispatchItem, setDispatchItem] = useState<QItem | null>(null);
  const [docket, setDocket] = useState(""); const [courier, setCourier] = useState("");

  useEffect(() => { if (ready && !token) navigate("/delhi"); }, [ready, token, navigate]);

  const { data: q } = useQuery<Queue>({
    queryKey: ["delhi-queue"],
    queryFn: async () => { const r = await teamFetch(token, `/api/delhi/queue`); return r.ok ? r.json() : { pickup: [], pack: [], dispatch: [] }; },
    enabled: !!token,
    refetchInterval: 30000,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status, docket_no, courier }: { id: number; status: string; docket_no?: string; courier?: string }) => {
      const r = await teamFetch(token, `/api/delhi/po-items/${id}/status`, { method: "POST", body: JSON.stringify({ status, docket_no, courier }) });
      if (!r.ok) throw new Error("Update failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["delhi-queue"] }); setDispatchItem(null); setDocket(""); setCourier(""); toast({ title: "Updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function logout() {
    if (token) { try { await teamFetch(token, "/api/team/logout", { method: "POST" }); } catch {} }
    clear(); navigate("/delhi");
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  if (!token) return null;

  const Card = ({ it, action }: { it: QItem; action: React.ReactNode }) => (
    <div className="bg-card border rounded-lg p-3 shadow-sm">
      <div className="font-semibold text-sm">{it.partNumber || "—"} {it.brand && <span className="text-muted-foreground font-normal">/ {it.brand}</span>}</div>
      <div className="text-xs text-muted-foreground mt-0.5">Qty {it.qty} · {it.poNumber}</div>
      <div className="text-xs mt-1"><span className="font-semibold">Vendor:</span> {it.vendorName} · {it.vendorPhone}</div>
      <div className="text-xs"><span className="font-semibold">Client:</span> {it.clientName} ({it.clientCity})</div>
      <div className="mt-2">{action}</div>
    </div>
  );

  const Col = ({ title, icon: Icon, items, action }: { title: string; icon: React.ElementType; items: QItem[]; action: (it: QItem) => React.ReactNode }) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3 font-bold"><Icon className="w-4 h-4" /> {title} <span className="text-xs font-normal text-muted-foreground">({items.length})</span></div>
      <div className="space-y-2">
        {items.length === 0 ? <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">Empty</div> : items.map((it) => <Card key={it.id} it={it} action={action(it)} />)}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="bg-card border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3"><Logo /><div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Delhi Warehouse</div></div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-muted-foreground">{user.name}</span>}
          <button onClick={logout} className="text-sm px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 inline-flex items-center gap-1"><LogOut className="w-4 h-4" /> Logout</button>
        </div>
      </header>
      <div className="p-6 flex flex-col lg:flex-row gap-6">
        <Col title="To Pick Up" icon={Package} items={q?.pickup || []} action={(it) => (
          <button onClick={() => setStatus.mutate({ id: it.id, status: "collected" })} className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold">Mark Collected</button>
        )} />
        <Col title="To Pack" icon={PackageCheck} items={q?.pack || []} action={(it) => (
          <button onClick={() => setStatus.mutate({ id: it.id, status: "packed" })} className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold">Mark Packed</button>
        )} />
        <Col title="To Dispatch" icon={Truck} items={q?.dispatch || []} action={(it) => (
          <button onClick={() => setDispatchItem(it)} className="w-full text-xs px-2 py-1.5 rounded bg-accent text-accent-foreground font-semibold">Dispatch…</button>
        )} />
      </div>

      {dispatchItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDispatchItem(null)}>
          <div className="bg-card rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Dispatch {dispatchItem.partNumber}</h2>
            <p className="text-xs text-muted-foreground mb-4">To {dispatchItem.clientName} ({dispatchItem.clientCity})</p>
            <div className="space-y-3">
              <label className="text-xs font-semibold block">Docket / AWB Number
                <input value={docket} onChange={(e) => setDocket(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
              <label className="text-xs font-semibold block">Courier
                <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. Delhivery, DTDC" className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" /></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDispatchItem(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={() => setStatus.mutate({ id: dispatchItem.id, status: "dispatched", docket_no: docket, courier })} disabled={setStatus.isPending} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold disabled:opacity-50">Confirm Dispatch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
