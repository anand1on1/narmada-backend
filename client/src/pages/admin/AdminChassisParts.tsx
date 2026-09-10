// R28 Session 2 — Chassis Parts detail (bulk upload + parts CRUD).
// Endpoints:
//   GET  /api/admin/chassis/:id
//   GET  /api/admin/chassis/:id/parts?limit=&offset=&q=
//   POST /api/admin/chassis/:id/parts/bulk-upload (multipart 'file')
//   PATCH  /api/admin/chassis/:id/parts/:partId
//   DELETE /api/admin/chassis/:id/parts/:partId
//   GET  /api/admin/chassis/parts-template.xlsx
import { useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, getAdminToken } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Download, ChevronLeft, Pencil, Trash2, Link2, RefreshCw, Plus, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { copyToClipboardWithToast, chassisSeoUrl, formatINR, isRepresentationalImage } from "@/lib/r28-utils";

interface ChassisPart {
  id: number;
  chassis_id: number;
  part_number: string;
  oem_number: string | null;
  description: string;
  category: string | null;
  position_notes: string | null;
  purchase_price: number | null;
  sell_price: number | null;
  stock_qty: number | null;
  image_url: string | null;
  product_id: number | null;
  is_active: number;
}

interface ChassisMeta {
  id: number;
  chassis_display_name: string;
  chassis_code: string;
  slug: string;
  parts_count?: number;
}

interface PartForm {
  part_number: string;
  oem_number: string;
  description: string;
  category: string;
  position_notes: string;
  purchase_price: string;
  sell_price: string;
  stock_qty: string;
  image_url: string;
}
const emptyForm = (): PartForm => ({
  part_number: "", oem_number: "", description: "", category: "", position_notes: "",
  purchase_price: "", sell_price: "", stock_qty: "", image_url: "",
});

export default function AdminChassisParts() {
  const { id: idStr } = useParams<{ id: string }>();
  const chassisId = parseInt(idStr, 10);
  const { token } = useAdminAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState("");
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChassisPart | null>(null);
  const [form, setForm] = useState<PartForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: chassis } = useQuery<ChassisMeta>({
    queryKey: ["chassis", chassisId],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/chassis/${chassisId}`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: !!token && !!chassisId,
  });

  const params = new URLSearchParams();
  params.set("limit", "500");
  if (q) params.set("q", q);

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["chassis-parts", chassisId, q],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/chassis/${chassisId}/parts?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token && !!chassisId,
  });
  const parts: ChassisPart[] = Array.isArray(data) ? data : (data?.rows ?? []);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (p: ChassisPart) => {
    setEditing(p);
    setForm({
      part_number: p.part_number || "",
      oem_number: p.oem_number || "",
      description: p.description || "",
      category: p.category || "",
      position_notes: p.position_notes || "",
      purchase_price: p.purchase_price != null ? String(p.purchase_price) : "",
      sell_price: p.sell_price != null ? String(p.sell_price) : "",
      stock_qty: p.stock_qty != null ? String(p.stock_qty) : "",
      image_url: p.image_url || "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.part_number.trim()) { toast({ title: "part_number required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const numeric = (v: string) => (v.trim() === "" ? null : Number(v));
      if (editing) {
        // PATCH one row
        const body = {
          oem_number: form.oem_number.trim() || null,
          description: form.description.trim() || form.part_number.trim(),
          category: form.category.trim() || null,
          position_notes: form.position_notes.trim() || null,
          purchase_price: numeric(form.purchase_price),
          sell_price: numeric(form.sell_price),
          stock_qty: form.stock_qty.trim() === "" ? 0 : Number(form.stock_qty),
          image_url: form.image_url.trim() || null,
        };
        const r = await adminFetch(token, `/api/admin/chassis/${chassisId}/parts/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        toast({ title: "Part updated" });
      } else {
        // No POST create endpoint — use bulk-upload with a synthesized CSV of one row.
        const header = "part_number,oem_number,description,category,position_notes,purchase_price,sell_price,stock_qty,image_url\n";
        const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const line = [
          form.part_number, form.oem_number, form.description || form.part_number, form.category,
          form.position_notes, form.purchase_price, form.sell_price, form.stock_qty || "0", form.image_url,
        ].map((v) => escape(String(v))).join(",");
        const csv = header + line + "\n";
        const fd = new FormData();
        fd.append("file", new Blob([csv], { type: "text/csv" }), "manual-add.csv");
        const t = getAdminToken();
        const r = await fetch(apiUrl(`/api/admin/chassis/${chassisId}/parts/bulk-upload`), {
          method: "POST",
          headers: t ? { "x-admin-token": t } : {},
          body: fd,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        toast({ title: `Part added (created ${j.created ?? 0}, updated ${j.updated ?? 0})` });
      }
      setDialogOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const deactivatePart = async (p: ChassisPart) => {
    if (!confirm(`Deactivate part ${p.part_number}?`)) return;
    try {
      const r = await adminFetch(token, `/api/admin/chassis/${chassisId}/parts/${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Part deactivated" });
      refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const t = getAdminToken();
      const r = await fetch(apiUrl(`/api/admin/chassis/${chassisId}/parts/bulk-upload`), {
        method: "POST",
        headers: t ? { "x-admin-token": t } : {},
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setUploadResult(j);
      toast({ title: `Upload done`, description: `Created ${j.created ?? 0}, updated ${j.updated ?? 0}, errors ${j.errors?.length ?? 0}` });
      refetch();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    const t = getAdminToken();
    // The endpoint requires x-admin-token so build a fetch-then-download-blob flow.
    fetch(apiUrl(`/api/admin/chassis/parts-template.xlsx`), { headers: t ? { "x-admin-token": t } : {} })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "chassis-parts-template.xlsx";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((e) => toast({ title: "Template download failed", description: e?.message || String(e), variant: "destructive" }));
  };

  const copyPublicLink = (p: ChassisPart) => {
    // Prefer chassis SEO page with a highlight; product-per-part links only exist once auto-publish creates a slug.
    if (chassis?.slug) {
      const url = `${chassisSeoUrl(chassis.slug)}?highlight=${encodeURIComponent(p.part_number)}`;
      copyToClipboardWithToast(url);
    } else {
      toast({ title: "No chassis slug available yet" });
    }
  };

  return (
    <AdminLayout title={chassis?.chassis_display_name || "Chassis parts"}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/admin/chassis"><a className="text-indigo-600 inline-flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Back to catalog</a></Link>
          {chassis && (
            <div className="text-slate-500">
              <span className="font-mono">{chassis.chassis_code}</span> · {parts.length} parts loaded
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-medium">Bulk upload</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadTemplate}>
                <Download className="w-4 h-4 mr-1" /> Download template
              </Button>
              <label className="inline-flex">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  className="hidden"
                  data-testid="input-bulk-upload"
                />
                <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="w-4 h-4 mr-1" /> {uploading ? "Uploading…" : "Upload .xlsx / .csv"}
                </Button>
              </label>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Columns: part_number (required), oem_number, description, category, position_notes, purchase_price, sell_price, stock_qty, image_url.
            Upsert key = (chassis_id, part_number).
          </div>
          {uploadResult && (
            <div className="text-xs border rounded p-2 bg-slate-50">
              <div>Created <b>{uploadResult.created ?? 0}</b> · Updated <b>{uploadResult.updated ?? 0}</b> · Errors <b>{uploadResult.errors?.length ?? 0}</b> (of {uploadResult.total ?? 0} rows)</div>
              {uploadResult.errors?.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-slate-500"><th className="text-left px-1">Row</th><th className="text-left px-1">Error</th></tr></thead>
                    <tbody>
                      {uploadResult.errors.slice(0, 100).map((e: any, i: number) => (
                        <tr key={i} className="border-t"><td className="px-1 font-mono">{e.row}</td><td className="px-1 text-red-600">{e.error}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part_number / OEM / desc" className="pl-8 h-9" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Add part</Button>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Image</th>
                <th className="px-3 py-2 text-left">Part #</th>
                <th className="px-3 py-2 text-left">OEM</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Sell</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
              {!isLoading && parts.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No parts yet. Upload a sheet.</td></tr>}
              {parts.map((p) => (
                <tr key={p.id} className="border-t hover:bg-slate-50 align-top">
                  <td className="px-3 py-2">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded" loading="lazy" />
                    ) : <div className="w-10 h-10 bg-slate-100 rounded" />}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.part_number}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.oem_number || "—"}</td>
                  <td className="px-3 py-2 max-w-xs text-xs">{p.description}</td>
                  <td className="px-3 py-2 text-xs">{p.category || "—"}</td>
                  <td className="px-3 py-2 text-right text-xs">{formatINR(p.sell_price)}</td>
                  <td className="px-3 py-2 text-right text-xs">{p.stock_qty ?? 0}</td>
                  <td className="px-3 py-2 text-xs">{p.is_active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => copyPublicLink(p)} title="Copy public link"><Link2 className="w-3 h-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => deactivatePart(p)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {isLoading && <div className="text-center text-slate-500 py-6">Loading…</div>}
          {!isLoading && parts.length === 0 && <div className="text-center text-slate-500 py-6">No parts.</div>}
          {parts.map((p) => (
            <div key={p.id} className="bg-white rounded-lg border p-3 flex gap-3">
              {p.image_url ? (
                <div>
                  <img src={p.image_url} alt="" className="w-16 h-16 object-cover rounded" loading="lazy" />
                  {isRepresentationalImage(null) && <div className="text-[9px] italic text-slate-500 mt-0.5">* representation only</div>}
                </div>
              ) : <div className="w-16 h-16 bg-slate-100 rounded shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs">{p.part_number}</div>
                <div className="text-sm truncate">{p.description}</div>
                <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
                  <span>{p.category || "—"}</span>
                  <span>· Stock {p.stock_qty ?? 0}</span>
                  <span>· {formatINR(p.sell_price)}</span>
                </div>
                <div className="flex gap-1 pt-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => copyPublicLink(p)}><Link2 className="w-3 h-3 mr-1" /> Copy link</Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="w-3 h-3 mr-1" /> Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => deactivatePart(p)}><Trash2 className="w-3 h-3 mr-1" /> Off</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.part_number}` : "Add part"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <label>Part number
                <Input value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} className="mt-1 font-mono" disabled={!!editing} />
              </label>
              <label>OEM number
                <Input value={form.oem_number} onChange={(e) => setForm({ ...form, oem_number: e.target.value })} className="mt-1 font-mono" />
              </label>
            </div>
            <label>Description
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" rows={2} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>Category<Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" /></label>
              <label>Position notes<Input value={form.position_notes} onChange={(e) => setForm({ ...form, position_notes: e.target.value })} className="mt-1" /></label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label>Purchase price<Input type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} className="mt-1" /></label>
              <label>Sell price<Input type="number" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: e.target.value })} className="mt-1" /></label>
              <label>Stock qty<Input type="number" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} className="mt-1" /></label>
            </div>
            <label>Image URL
              <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="mt-1" placeholder="https://…" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : (editing ? "Update" : "Add")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
