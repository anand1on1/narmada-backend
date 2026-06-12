/**
 * R20.6 — Shared quick-add Vendor modal.
 * Used from the PO processing "Add Seller" flow. R21.8: Name AND Phone are
 * mandatory; GSTIN + address optional. POSTs to /api/team/sellers.
 */
import { useState } from "react";
import { teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface CreatedVendor {
  id: number;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  gstin?: string | null;
}

export function AddVendorModal({
  token,
  onClose,
  onCreated,
}: {
  token: string | null;
  onClose: () => void;
  onCreated?: (vendor: CreatedVendor) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!phone.trim()) { toast({ title: "Phone is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await teamFetch(token, `/api/team/sellers`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), gstin: gstin.trim(), address: address.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: "Failed to create vendor", description: j.error || "Could not create vendor", variant: "destructive" });
        return;
      }
      toast({ title: "Vendor created", description: `${j.name || name} added.` });
      onCreated?.(j as CreatedVendor);
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg mb-4">New Vendor</h2>
        <div className="space-y-3">
          <label className="text-xs font-semibold block">Name *
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" placeholder="Vendor name" />
          </label>
          <label className="text-xs font-semibold block">Phone *
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" placeholder="9876543210" />
          </label>
          <label className="text-xs font-semibold block">GSTIN
            <input value={gstin} onChange={(e) => setGstin(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" placeholder="10ASWPP6442P1ZZ" />
          </label>
          <label className="text-xs font-semibold block">Address
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
              className="mt-1 w-full border rounded-lg px-3 py-2 bg-background text-sm font-normal" placeholder="Vendor address" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onClick={save} disabled={!name.trim() || !phone.trim() || saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Create Vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}
