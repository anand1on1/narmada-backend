import { useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquare } from "lucide-react";

interface Conv { id: number; direction: string; messageText: string; createdAt: number; sentBy: string | null; }
interface InboxRow { vendor: { id: number; name: string; phone: string | null; whatsapp: string | null }; latest: Conv | null; count: number; }

function fmt(d: number | null) { return d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }

export default function AdminVendorInbox() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [reply, setReply] = useState("");

  const { data: inbox = [] } = useQuery<InboxRow[]>({
    queryKey: ["vendor-inbox"],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/vendor-inbox`); return r.ok ? r.json() : []; },
    enabled: !!token, refetchInterval: 30000,
  });

  const { data: convs = [] } = useQuery<Conv[]>({
    queryKey: ["vendor-convs", selected],
    queryFn: async () => { const r = await adminFetch(token, `/api/admin/vendors/${selected}/conversations`); return r.ok ? r.json() : []; },
    enabled: !!token && !!selected,
  });

  const send = useMutation({
    mutationFn: async () => {
      const r = await adminFetch(token, `/api/admin/vendors/${selected}/reply`, { method: "POST", body: JSON.stringify({ message: reply }) });
      if (!r.ok) throw new Error("Send failed");
    },
    onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["vendor-convs"] }); qc.invalidateQueries({ queryKey: ["vendor-inbox"] }); toast({ title: "Sent" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout title="Vendor Inbox">
      <div className="grid grid-cols-3 gap-4 h-[70vh]">
        <div className="bg-card border rounded-xl overflow-y-auto shadow-sm">
          {inbox.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No vendor conversations yet.</div> :
            inbox.map((row) => (
              <button key={row.vendor.id} onClick={() => setSelected(row.vendor.id)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-muted/40 ${selected === row.vendor.id ? "bg-muted/60" : ""}`}>
                <div className="font-semibold text-sm flex items-center justify-between">{row.vendor.name}
                  <span className="text-[10px] bg-muted rounded-full px-2 py-0.5">{row.count}</span></div>
                <div className="text-xs text-muted-foreground truncate">{row.latest?.messageText || "—"}</div>
                <div className="text-[10px] text-muted-foreground">{fmt(row.latest?.createdAt || null)}</div>
              </button>
            ))}
        </div>
        <div className="col-span-2 bg-card border rounded-xl flex flex-col shadow-sm">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground"><MessageSquare className="w-5 h-5 mr-2" /> Select a vendor</div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {[...convs].reverse().map((c) => (
                  <div key={c.id} className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${c.direction === "out" ? "ml-auto bg-accent text-accent-foreground" : "bg-muted"}`}>
                    {c.messageText}
                    <div className="text-[10px] opacity-70 mt-1">{fmt(c.createdAt)}{c.sentBy ? ` · ${c.sentBy}` : ""}</div>
                  </div>
                ))}
              </div>
              <div className="border-t p-3 flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reply.trim() && send.mutate()}
                  placeholder="Type a reply…" className="flex-1 border rounded-lg px-3 py-2 bg-background text-sm" />
                <button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}
                  className="px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                  <Send className="w-4 h-4" /> Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
