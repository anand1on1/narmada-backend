import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AdminFreight() {
  const { token } = useAdminAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [zeroOnly, setZeroOnly] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newPart, setNewPart] = useState("");
  const [newFreight, setNewFreight] = useState("");

  // R27.1b BUG-5 — debounce the search box so typing filters live (300ms) instead of
  // only firing on Enter/submit. dq is the debounced query actually sent to the server.
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  async function load() {
    if (!token) return;
    const params = new URLSearchParams();
    if (dq) params.set("q", dq);
    if (zeroOnly) params.set("zero_only", "1");
    params.set("limit", "200");
    const r = await adminFetch(token, `/api/admin/freight-charges?${params.toString()}`);
    if (r.ok) { const d = await r.json(); setRows(d.rows || []); setTotal(d.total || 0); }
  }
  useEffect(() => { load(); }, [token, zeroOnly, dq]); // eslint-disable-line

  async function saveOne(partNumber: string) {
    const val = edits[partNumber];
    if (val === undefined) return;
    const r = await adminFetch(token, `/api/admin/freight-charges/${encodeURIComponent(partNumber)}`, { method: "PATCH", body: JSON.stringify({ freight_inr: Number(val) || 0 }) });
    if (r.ok) { toast({ title: "Saved", description: partNumber }); setEdits((e) => { const n = { ...e }; delete n[partNumber]; return n; }); load(); }
  }

  async function addNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newPart.trim()) return;
    const r = await adminFetch(token, `/api/admin/freight-charges/${encodeURIComponent(newPart.trim())}`, { method: "PATCH", body: JSON.stringify({ freight_inr: Number(newFreight) || 0 }) });
    if (r.ok) { toast({ title: "Added", description: newPart }); setNewPart(""); setNewFreight(""); load(); }
  }

  async function uploadCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(apiUrl("/api/admin/freight-charges/csv"), { method: "POST", headers: { "x-admin-token": token }, body: fd });
    const j = await r.json();
    if (r.ok) { toast({ title: "CSV imported", description: `${j.upserted} row(s)` }); load(); }
    else { toast({ title: "Error", description: j.error, variant: "destructive" }); }
    e.target.value = "";
  }

  return (
    <AdminLayout title="Freight Charges">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part # or product" className="px-3 py-1.5 rounded-lg border bg-card text-sm w-64" data-testid="search-input" />
          <button type="submit" className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="search-btn">Search</button>
          {q && <button type="button" onClick={() => setQ("")} className="px-3 py-1.5 rounded-lg border text-sm font-semibold hover:bg-muted" data-testid="search-clear">Show all</button>}
        </form>
        <label className="flex items-center gap-2 text-sm ml-2"><input type="checkbox" checked={zeroOnly} onChange={(e) => setZeroOnly(e.target.checked)} data-testid="zero-only" /> Zero freight only</label>
        <label className="ml-auto px-3 py-1.5 rounded-lg border text-sm font-semibold cursor-pointer hover:bg-muted" data-testid="csv-upload-label">
          Import CSV
          <input type="file" accept=".csv" onChange={uploadCsv} className="hidden" data-testid="csv-upload" />
        </label>
      </div>

      <form onSubmit={addNew} className="flex gap-2 mb-6 items-end bg-card border rounded-xl p-4">
        <div><label className="text-xs text-muted-foreground">Part Number</label><input value={newPart} onChange={(e) => setNewPart(e.target.value)} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-48" data-testid="new-part" /></div>
        <div><label className="text-xs text-muted-foreground">Freight (₹)</label><input type="number" value={newFreight} onChange={(e) => setNewFreight(e.target.value)} className="block px-3 py-1.5 rounded-lg border bg-background text-sm w-32" data-testid="new-freight" /></div>
        <button className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold" data-testid="add-freight">Add / Update</button>
      </form>

      <div className="bg-card border rounded-xl overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">{dq ? `No freight charges match "${dq}". Try a different part # or product name, or click Show all.` : "No freight charges configured yet. Add one above or import a CSV (columns: part_number, freight_inr)."}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">Part #</th><th className="p-3">Product</th><th className="p-3">Freight (₹)</th><th className="p-3"></th></tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30" data-testid={`freight-row-${r.id}`}>
                  <td className="p-3 font-mono">{r.partNumber}</td>
                  <td className="p-3 text-muted-foreground">{r.productName || "—"}</td>
                  <td className="p-3">
                    <input type="number" value={edits[r.partNumber] ?? r.freightInr} onChange={(e) => setEdits((ed) => ({ ...ed, [r.partNumber]: e.target.value }))} className="px-2 py-1 rounded border bg-background w-28" data-testid={`freight-input-${r.id}`} />
                  </td>
                  <td className="p-3">{edits[r.partNumber] !== undefined && <button onClick={() => saveOne(r.partNumber)} className="px-2 py-1 rounded bg-accent text-accent-foreground text-xs font-semibold" data-testid={`freight-save-${r.id}`}>Save</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-3">{total} freight rule(s)</p>
    </AdminLayout>
  );
}
