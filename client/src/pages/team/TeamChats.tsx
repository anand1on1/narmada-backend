/**
 * R12 — TeamChats.tsx
 * Data-team chat hub. Lists every seller with chat activity in the last 30 days and opens
 * the shared VendorChatDrawer on click. This gives the data team a top-level entry point to
 * rate-negotiation chats without first drilling into a PO line.
 */
import { useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Loader2 } from "lucide-react";
import { VendorChatDrawer } from "./R9VendorQuotes";

interface ActiveChat {
  vendor_id: number;
  vendor_name: string | null;
  last_message_at: number;
  last_message_body: string | null;
  message_count: number;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function TeamChats() {
  const { token } = useTeamAuth();
  const [chatVendor, setChatVendor] = useState<{ vendorId: number; name: string } | null>(null);

  const { data: chats = [], isLoading, refetch } = useQuery<ActiveChat[]>({
    queryKey: ["team-active-chats"],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/team/rfq/active-chats`);
      return r.ok ? r.json() : [];
    },
    enabled: !!token,
    refetchInterval: 20000,
  });

  return (
    <TeamLayout title="Seller Chats">
      <div className="mb-4 text-sm text-muted-foreground">
        Sellers you have negotiated rates with in the last 30 days. Click to open the chat.
      </div>
      <div className="bg-card border rounded-xl shadow-sm divide-y">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading chats…
          </div>
        ) : chats.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No seller chats yet. Fire a rate request from a PO line to start one.</div>
        ) : (
          chats.map((c) => (
            <button
              key={c.vendor_id}
              onClick={() => setChatVendor({ vendorId: c.vendor_id, name: c.vendor_name || "Seller" })}
              className="w-full text-left px-4 py-3 hover:bg-muted/40 transition flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{c.vendor_name || `Seller #${c.vendor_id}`}</div>
                <div className="text-xs text-muted-foreground truncate">{c.last_message_body || "—"}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[11px] text-muted-foreground">{timeAgo(c.last_message_at)}</div>
                <div className="text-[11px] font-semibold text-accent">{c.message_count} msg</div>
              </div>
            </button>
          ))
        )}
      </div>

      {chatVendor && (
        <VendorChatDrawer
          vendorId={chatVendor.vendorId}
          vendorName={chatVendor.name}
          token={token}
          onClose={() => { setChatVendor(null); refetch(); }}
        />
      )}
    </TeamLayout>
  );
}
