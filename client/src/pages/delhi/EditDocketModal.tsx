/**
 * R26.2b — EditDocketModal.tsx
 * Post-dispatch "Edit Docket" dialog for the Delhi panel. A near-replica of the dispatch modal
 * in DelhiPODetail.tsx (same fields, labels, styling) but used to RE-UPLOAD / EDIT transport
 * details for an already-dispatched PO. Pre-fills from GET /api/delhi/po/:id/docket and submits
 * a multipart POST to /api/delhi/po/:id/docket (transport, docket number, bundles, slip).
 */
import { useState } from "react";
import { useTeamAuth, teamFetch } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/queryClient";
import { Upload, X, Loader2, FileText } from "lucide-react";

interface DocketData {
  docketTransport: string | null;
  docketNumber: string | null;
  docketDate: number | null;
  docketSlipPath: string | null;
  docketBundles: number | null;
}

export default function EditDocketModal({ poId, poNumber, onClose, onDone }: {
  poId: number; poNumber: string; onClose: () => void; onDone: () => void;
}) {
  const { token } = useTeamAuth();
  const { toast } = useToast();
  const [courier, setCourier] = useState("");
  const [docketNumber, setDocketNumber] = useState("");
  const [bundles, setBundles] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingSlip, setExistingSlip] = useState<string | null>(null);

  // Carrier autocomplete — same source as the dispatch modal.
  const { data: carriers = [] } = useQuery<string[]>({
    queryKey: ["delhi-carriers"],
    queryFn: async () => { const r = await teamFetch(token, `/api/delhi/dispatch/carriers`); return r.ok ? r.json() : []; },
    enabled: !!token,
  });

  // Pre-fill from the stored docket fields on open.
  const { isLoading } = useQuery<DocketData | null>({
    queryKey: ["delhi-po-docket", poId],
    queryFn: async () => {
      const r = await teamFetch(token, `/api/delhi/po/${poId}/docket`);
      if (!r.ok) return null;
      const d: DocketData = await r.json();
      setCourier(d.docketTransport || "");
      setDocketNumber(d.docketNumber || "");
      if (d.docketBundles != null) setBundles(String(d.docketBundles));
      setExistingSlip(d.docketSlipPath || null);
      return d;
    },
    enabled: !!token,
    staleTime: 0,
    gcTime: 0,
  });

  async function submit() {
    const b = parseInt(bundles, 10);
    if (!courier.trim()) { toast({ title: "Courier is required", variant: "destructive" }); return; }
    if (!docketNumber.trim()) { toast({ title: "Docket number is required", variant: "destructive" }); return; }
    if (!Number.isInteger(b) || b < 1) { toast({ title: "Bundles count (min 1) is required", variant: "destructive" }); return; }
    if (file && file.size > 10 * 1024 * 1024) { toast({ title: "File too large (max 10MB)", variant: "destructive" }); return; }
    if (!file && !existingSlip) { toast({ title: "Docket slip upload is required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("docketTransport", courier.trim());
      fd.append("docketNumber", docketNumber.trim());
      fd.append("docketBundles", String(b));
      if (file) fd.append("docketSlip", file);
      const r = await fetch(apiUrl(`/api/delhi/po/${poId}/docket`), {
        method: "POST", headers: { "x-team-token": token || "" }, body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Update failed");
      toast({ title: "Docket updated", description: `Transport details saved for ${poNumber}.` });
      onDone();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Edit Docket — {poNumber}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Re-upload or edit the transport details for this dispatched PO.
        </p>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading current details…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold">Courier <span className="text-red-500">*</span></label>
              <input value={courier} onChange={(e) => setCourier(e.target.value)} list="edit-carrier-list"
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder="e.g. Delhivery, DTDC" />
              <datalist id="edit-carrier-list">{carriers.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="text-xs font-semibold">Docket Number <span className="text-red-500">*</span></label>
              <input value={docketNumber} onChange={(e) => setDocketNumber(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" placeholder="AWB / docket #" />
            </div>
            <div>
              <label className="text-xs font-semibold">Bundles <span className="text-red-500">*</span></label>
              <input type="number" min={1} value={bundles} onChange={(e) => setBundles(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-background" />
            </div>
            <div>
              <label className="text-xs font-semibold">Docket Slip <span className="text-red-500">*</span> <span className="font-normal text-muted-foreground">(image/PDF, max 10MB)</span></label>
              <label className="mt-1 flex items-center gap-2 border border-dashed rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{file ? file.name : "Choose file…"}</span>
                <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              {existingSlip && !file && (
                <a href={apiUrl(existingSlip)} target="_blank" rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                  <FileText className="w-3.5 h-3.5" /> View current slip
                </a>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={submitting || isLoading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Save Docket
          </button>
        </div>
      </div>
    </div>
  );
}
