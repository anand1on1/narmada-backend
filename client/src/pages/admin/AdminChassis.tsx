// R28 Session 2 — Chassis Catalog Manager (list + CRUD).
// Endpoints:
//   GET    /api/admin/chassis?limit=&offset=&q=
//   POST   /api/admin/chassis
//   PATCH  /api/admin/chassis/:id
//   DELETE /api/admin/chassis/:id
import { useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Package, RefreshCw, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface Chassis {
  id: number;
  chassis_code: string;
  chassis_display_name: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  slug: string;
  cover_image_url?: string | null;
  description?: string | null;
  is_active: number;
  parts_count?: number;
}

interface ChassisForm {
  chassis_code: string;
  chassis_display_name: string;
  make: string;
  model: string;
  variant: string;
  slug: string;
  cover_image_url: string;
  description: string;
  is_active: boolean;
}

const empty = (): ChassisForm => ({
  chassis_code: "", chassis_display_name: "", make: "", model: "", variant: "",
  slug: "", cover_image_url: "", description: "", is_active: true,
});

function toSlug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AdminChassis() {
  const { token } = useAdminAuth();
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Chassis | null>(null);
  const [form, setForm] = useState<ChassisForm>(empty());
  const [slugDirty, setSlugDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  params.set("limit", "200");
  if (q) params.set("q", q);

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["chassis-list", q],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/chassis?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });
  const rows: Chassis[] = useMemo(() => (Array.isArray(data) ? data : (data?.rows ?? [])), [data]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty());
    setSlugDirty(false);
    setDialogOpen(true);
  };
  const openEdit = (c: Chassis) => {
    setEditing(c);
    setForm({
      chassis_code: c.chassis_code || "",
      chassis_display_name: c.chassis_display_name || "",
      make: c.make || "",
      model: c.model || "",
      variant: c.variant || "",
      slug: c.slug || "",
      cover_image_url: c.cover_image_url || "",
      description: c.description || "",
      is_active: !!c.is_active,
    });
    setSlugDirty(true);
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.chassis_code.trim() || !form.chassis_display_name.trim()) {
      toast({ title: "Missing fields", description: "chassis_code and display name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        chassis_code: form.chassis_code.trim(),
        chassis_display_name: form.chassis_display_name.trim(),
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        variant: form.variant.trim() || null,
        slug: form.slug.trim() || undefined,
        cover_image_url: form.cover_image_url.trim() || null,
        description: form.description.trim() || null,
        is_active: form.is_active ? 1 : 0,
      };
      const url = editing ? `/api/admin/chassis/${editing.id}` : "/api/admin/chassis";
      const r = await adminFetch(token, url, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: editing ? "Chassis updated" : "Chassis created" });
      setDialogOpen(false);
      refetch();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || String(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const deactivate = async (c: Chassis) => {
    if (!confirm(`Deactivate "${c.chassis_display_name}"? Its parts stay in DB but customers won't see it.`)) return;
    try {
      const r = await adminFetch(token, `/api/admin/chassis/${c.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Chassis deactivated" });
      refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="Chassis Catalog">
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm text-slate-600 flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-500" />
            {rows.length} chassis {q && <span className="text-slate-400">(filtered)</span>}
          </div>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8 h-9 w-full md:w-56" />
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Add Chassis</Button>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Display Name</th>
                <th className="px-3 py-2 text-left">Make / Model</th>
                <th className="px-3 py-2 text-left">Slug</th>
                <th className="px-3 py-2 text-left">Parts</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No chassis. Add your first one.</td></tr>}
              {rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">{c.chassis_display_name}<div className="text-xs text-slate-400 font-mono">{c.chassis_code}</div></td>
                  <td className="px-3 py-2 text-xs">{[c.make, c.model, c.variant].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.slug}</td>
                  <td className="px-3 py-2 text-xs">{c.parts_count ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{c.is_active ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-400">No</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Link href={`/admin/chassis/${c.id}/parts`}><a><Button size="sm" variant="outline"><Package className="w-3 h-3 mr-1" /> Parts</Button></a></Link>
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => deactivate(c)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {isLoading && <div className="text-center text-slate-500 py-6">Loading…</div>}
          {!isLoading && rows.length === 0 && <div className="text-center text-slate-500 py-6">No chassis.</div>}
          {rows.map((c) => (
            <div key={c.id} className="bg-white rounded-lg border p-3 space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-medium">{c.chassis_display_name}</div>
                  <div className="text-xs text-slate-400 font-mono">{c.chassis_code}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded ${c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {c.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="text-xs text-slate-600">{[c.make, c.model, c.variant].filter(Boolean).join(" · ") || "—"}</div>
              <div className="text-xs text-slate-500">{c.parts_count ?? 0} parts · <span className="font-mono">{c.slug}</span></div>
              <div className="flex gap-2 pt-1 flex-wrap">
                <Link href={`/admin/chassis/${c.id}/parts`}><a><Button size="sm" variant="outline"><Package className="w-3 h-3 mr-1" /> Parts</Button></a></Link>
                <Button size="sm" variant="outline" onClick={() => openEdit(c)}><Pencil className="w-3 h-3 mr-1" /> Edit</Button>
                <Button size="sm" variant="outline" onClick={() => deactivate(c)}><Trash2 className="w-3 h-3 mr-1" /> Off</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit chassis" : "Add chassis"}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <label>Chassis code
                <Input value={form.chassis_code} onChange={(e) => setForm({ ...form, chassis_code: e.target.value })} className="mt-1" placeholder="TATA-407-EX2" />
              </label>
              <label>Variant
                <Input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} className="mt-1" placeholder="BS6" />
              </label>
            </div>
            <label>Display name
              <Input value={form.chassis_display_name} onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, chassis_display_name: v, slug: slugDirty ? f.slug : toSlug(v) }));
              }} className="mt-1" placeholder="Tata 407 EX2 BS6" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>Make<Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} className="mt-1" placeholder="TATA" /></label>
              <label>Model<Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="mt-1" placeholder="407 EX2" /></label>
            </div>
            <label>Slug (auto)
              <Input value={form.slug} onChange={(e) => { setSlugDirty(true); setForm({ ...form, slug: toSlug(e.target.value) }); }} className="mt-1 font-mono" />
            </label>
            <label>Cover image URL
              <Input value={form.cover_image_url} onChange={(e) => setForm({ ...form, cover_image_url: e.target.value })} className="mt-1" placeholder="https://…" />
            </label>
            <label>Description
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" rows={3} />
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
              <span>Active (visible to customers)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : (editing ? "Update" : "Create")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
