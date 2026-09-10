// R28 Session 3 — Part Image Cache management (grid view + replace / delete).
// Endpoints:
//   GET    /api/admin/part-images?limit=&offset=
//   POST   /api/admin/part-images/:id/replace   (multipart 'image')
//   DELETE /api/admin/part-images/:id
import { useRef, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth, getAdminToken } from "@/lib/admin-auth";
import { apiUrl } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Upload, ImageIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatTs, isRepresentationalImage } from "@/lib/r28-utils";

interface PartImage {
  id: number;
  cacheKey: string;
  imageUrl: string;
  imageSource: string;
  usageCount: number;
  lastUsedAt: number | null;
  generatedAt: number;
}

export default function AdminPartImages() {
  const { token } = useAdminAuth();
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["part-images"],
    queryFn: async () => {
      const r = await adminFetch(token, `/api/admin/part-images?limit=200`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: !!token,
  });
  const rows: PartImage[] = Array.isArray(data) ? data : (data?.rows ?? []);

  const replace = async (id: number, file: File) => {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const t = getAdminToken();
      const r = await fetch(apiUrl(`/api/admin/part-images/${id}/replace`), {
        method: "POST",
        headers: t ? { "x-admin-token": t } : {},
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      toast({ title: "Image replaced" });
      refetch();
    } catch (e: any) {
      toast({ title: "Replace failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this cache entry? A future auto-publish request will regenerate it.")) return;
    try {
      const r = await adminFetch(token, `/api/admin/part-images/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Cache entry deleted" });
      refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="Part Image Cache">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            <ImageIcon className="inline w-4 h-4 mr-1 text-indigo-500" />
            {rows.length} cached representational images. Replace any of them with a real product photo.
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {isLoading && <div className="text-center text-slate-500 py-8">Loading…</div>}
        {!isLoading && rows.length === 0 && <div className="text-center text-slate-500 py-8">No cached images yet. They appear here after auto-publish generates or reuses one.</div>}

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((p) => (
            <div key={p.id} className="bg-white rounded-lg border p-3 space-y-2">
              <div className="aspect-square bg-slate-100 rounded overflow-hidden flex items-center justify-center">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.cacheKey} className="w-full h-full object-cover" loading="lazy" />
                ) : <ImageIcon className="w-8 h-8 text-slate-300" />}
              </div>
              {isRepresentationalImage(p.imageSource) && (
                <div className="text-[10px] italic text-slate-500 -mt-1">* Image is for representation purpose only</div>
              )}
              <div className="text-xs">
                <div className="font-mono text-[11px] truncate" title={p.cacheKey}>{p.cacheKey}</div>
                <div className="text-slate-500">source: {p.imageSource}</div>
                <div className="text-slate-500">used {p.usageCount ?? 0}× {p.lastUsedAt ? `· last ${formatTs(p.lastUsedAt)}` : ""}</div>
              </div>
              <div className="flex gap-1">
                <input
                  ref={(el) => { inputRefs.current[p.id] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && replace(p.id, e.target.files[0])}
                />
                <Button size="sm" variant="outline" className="flex-1" onClick={() => inputRefs.current[p.id]?.click()}>
                  <Upload className="w-3 h-3 mr-1" /> Replace
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove(p.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
