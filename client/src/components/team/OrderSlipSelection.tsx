import { useState, type Dispatch, type SetStateAction } from "react";
import { teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";

interface SlipPayload {
  vendors: Array<{ vendorName: string; rows: Array<{ productName: string; poLastFour: string; quantity: number }> }>;
  warnings: string[];
}
export function OrderSlipSelection({ token, selecting, setSelecting, selected, setSelected, onStart }: {
  token: string | null; selecting: boolean; setSelecting: (value: boolean) => void;
  selected: Set<number>; setSelected: Dispatch<SetStateAction<Set<number>>>; onStart: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SlipPayload | null>(null);
  const [error, setError] = useState("");
  async function process() {
    if (!selecting) { setSelecting(true); onStart(); return; }
    if (!selected.size) return;
    setBusy(true); setError("");
    try {
      const poIds = Array.from(selected);
      const response = await teamFetch(token, "/api/team/purchase-orders/order-slips", {
        method: "POST", body: JSON.stringify({ poIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to prepare order slips.");
      setPreview(payload);
      if (!payload.vendors.length) return;
      const zip = await teamFetch(token, "/api/team/purchase-orders/order-slips", {
        method: "POST", body: JSON.stringify({ poIds, format: "zip" }),
      });
      if (!zip.ok) throw new Error((await zip.json().catch(() => ({}))).error || "Unable to download order slips.");
      const url = URL.createObjectURL(await zip.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "order-slips.zip";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast({ title: "Order slips downloaded", description: "Vendor-wise images only. No purchase order or payment status was changed." });
    } catch (e: any) {
      setError(e.message || "Unable to generate order slips. Please retry.");
    } finally { setBusy(false); }
  }
  return <>
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={process} disabled={busy || (selecting && !selected.size)}
        className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="process-order-slips">
        Process Order Slips
      </button>
      {busy && <span role="status" className="text-sm">Preparing ZIP…</span>}
      {selecting && <>
        <span className="text-sm font-semibold" data-testid="selected-po-count">{selected.size} selected / 100</span>
        <button disabled={busy || !selected.size} onClick={() => setSelected(new Set())} className="text-sm border rounded-lg px-3 py-2 disabled:opacity-40">Clear selection</button>
        <button disabled={busy} onClick={() => { setSelecting(false); setSelected(new Set()); setPreview(null); setError(""); }} className="text-sm border rounded-lg px-3 py-2">Cancel</button>
        <p className="w-full text-xs text-muted-foreground">Search all purchase orders, including those not notified. Selections stay selected across searches and pages. Click Process Order Slips again to download.</p>
      </>}
    </div>
    {error && <div role="alert" className="p-3 mb-4 border rounded-lg text-red-700 bg-red-50">{error}</div>}
    {preview && <section className="border rounded-xl p-4 mb-5 bg-card" aria-label="Order slip preview">
      <div className="flex justify-between gap-3 mb-3">
        <h2 className="font-semibold">Order slip preview</h2>
        <button className="text-sm underline" onClick={() => setPreview(null)}>Close preview</button>
      </div>
      {preview.warnings.map((warning, i) => <p key={i} role="status" className="text-sm text-amber-800 bg-amber-50 p-3 rounded mb-3">{warning}</p>)}
      <div className="max-h-96 overflow-auto space-y-4">
        {preview.vendors.map((vendor, i) => <div key={i} className="border rounded-lg overflow-hidden">
          <h3 className="bg-[#0b3d2e] text-white px-3 py-2 font-semibold break-words">{vendor.vendorName}</h3>
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left"><th className="p-2">Product name</th><th className="p-2 whitespace-nowrap">PO last 4</th><th className="p-2">Quantity</th></tr></thead>
            <tbody>{vendor.rows.map((row, j) => <tr key={j} className="border-t"><td className="p-2 break-words">{row.productName}</td><td className="p-2">{row.poLastFour || "—"}</td><td className="p-2">{row.quantity}</td></tr>)}</tbody>
          </table>
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground mt-3">ZIP contains vendor-wise images. Long lists split into multiple images. Any excluded lines are explained in excluded-lines.txt.</p>
    </section>}
  </>;
}
