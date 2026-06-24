import { useEffect, useState } from "react";
import { ShellLayout, useShellAuth } from "@/lib/shell";
import { BRANDS, PRODUCT_CATEGORIES } from "@/data/brands";
import type { Product } from "@shared/schema";
import { toSlug, parseJsonArray } from "@/lib/utils-app";
import { Plus, Edit2, Trash2, X, Upload, Save, Search, Star, UploadCloud, Sparkles } from "lucide-react";
import { BulkUploadModal } from "./BulkUploadModal";

interface ProductForm {
  id?: number;
  slug: string; name: string; brand: string; model: string; category: string;
  partNumber: string; oemNumber: string;
  description: string; shortDescription: string;
  priceInr: number; stockQty: number;
  imageUrls: string[];
  compatibleModels: string[];
  metaTitle: string; metaDescription: string; metaKeywords: string;
  featured: boolean; active: boolean;
}

const EMPTY: ProductForm = {
  slug: "", name: "", brand: "tata", model: "", category: "engine-parts",
  partNumber: "", oemNumber: "",
  description: "", shortDescription: "",
  priceInr: 0, stockQty: 0,
  imageUrls: [], compatibleModels: [],
  metaTitle: "", metaDescription: "", metaKeywords: "",
  featured: false, active: true,
};

export default function AdminProducts() {
  const { shell, token, adminFetch, hideDelete } = useShellAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/products");
    { const _d = await r.json(); setProducts(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  function startEdit(p?: Product) {
    if (!p) { setEditing(EMPTY); return; }
    setEditing({
      id: p.id,
      slug: p.slug, name: p.name, brand: p.brand, model: p.model ?? "", category: p.category,
      partNumber: p.partNumber ?? "", oemNumber: p.oemNumber ?? "",
      description: p.description, shortDescription: p.shortDescription ?? "",
      priceInr: p.priceInr, stockQty: p.stockQty ?? 0,
      imageUrls: parseJsonArray(p.imageUrls),
      compatibleModels: parseJsonArray(p.compatibleModels),
      metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "", metaKeywords: p.metaKeywords ?? "",
      featured: !!p.featured, active: p.active !== false,
    });
  }

  async function save() {
    if (!editing || !token) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        ...editing,
        slug: editing.slug || toSlug(editing.name),
        priceInr: Number(editing.priceInr),
        stockQty: Number(editing.stockQty),
        imageUrls: JSON.stringify(editing.imageUrls),
        compatibleModels: JSON.stringify(editing.compatibleModels),
      };
      const url = editing.id ? `/api/admin/products/${editing.id}` : "/api/admin/products";
      const method = editing.id ? "PATCH" : "POST";
      const r = await adminFetch(token, url, { method, body: JSON.stringify(payload) });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error || "Save failed");
        return;
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    if (!token) return;
    await adminFetch(token, `/api/admin/products/${id}`, { method: "DELETE" });
    await load();
  }

  async function uploadImage(file: File) {
    if (!editing || !token) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const r = await adminFetch(token, "/api/admin/upload-image", {
        method: "POST",
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      if (r.ok) {
        const { url } = await r.json();
        setEditing((prev) => prev ? { ...prev, imageUrls: [...prev.imageUrls, url] } : prev);
      }
    };
    reader.readAsDataURL(file);
  }

  const [aiBusy, setAiBusy] = useState<string | null>(null);
  async function aiFill(kind: "discounts" | "specifications" | "short-description" | "seo-meta") {
    if (!editing || !token) return;
    setAiBusy(kind); setError(null);
    try {
      const r = await adminFetch(token, `/api/admin/ai-fill/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          name: editing.name, brand: editing.brand, part_number: editing.partNumber,
          description: editing.description, price_inr: editing.priceInr,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || "AI fill failed"); return; }
      setEditing((prev) => {
        if (!prev) return prev;
        if (kind === "short-description" && j.short_description) return { ...prev, shortDescription: j.short_description };
        if (kind === "seo-meta") return { ...prev, metaTitle: j.meta_title || prev.metaTitle, metaDescription: j.meta_description || prev.metaDescription, metaKeywords: j.meta_keywords || prev.metaKeywords };
        if (kind === "specifications" && Array.isArray(j.specifications)) {
          const block = "\n\nSpecifications:\n" + j.specifications.map((s: any) => `- ${s.key}: ${s.value}`).join("\n");
          return { ...prev, description: (prev.description || "").trim() + block };
        }
        if (kind === "discounts" && Array.isArray(j.discount_tiers)) {
          const block = "\n\nQuantity Discounts:\n" + j.discount_tiers.map((t: any) => `- Buy ${t.min_qty}+: ${t.discount_pct}% off`).join("\n");
          return { ...prev, description: (prev.description || "").trim() + block };
        }
        return prev;
      });
    } catch (e: any) { setError(e.message || "AI fill failed"); }
    finally { setAiBusy(null); }
  }

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.partNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.brand.includes(search.toLowerCase())
  );

  return (
    <ShellLayout title="Products">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(220_60%_12%)]/75 font-medium" />
          <input
            placeholder="Search by name, part number, brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border rounded-lg bg-card"
            data-testid="input-search-products"
          />
        </div>
        {shell === "admin" && (
          <button
            onClick={() => setShowBulk(true)}
            className="px-5 py-2.5 border border-accent/40 text-accent rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/10"
            data-testid="button-bulk-upload"
          >
            <UploadCloud className="w-4 h-4" /> Bulk Upload
          </button>
        )}
        <button
          onClick={() => startEdit()}
          className="px-5 py-2.5 bg-accent text-accent-foreground rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/90"
          data-testid="button-add-product"
        >
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {showBulk && token && (
        <BulkUploadModal
          token={token}
          onClose={() => setShowBulk(false)}
          onDone={() => load()}
        />
      )}

      {/* Table */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-slate-900 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Image</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Brand</th>
                <th className="px-4 py-3 font-semibold">Part No.</th>
                <th className="px-4 py-3 font-semibold">₹ Price</th>
                <th className="px-4 py-3 font-semibold">Stock</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[hsl(220_60%_12%)]/75 font-medium">
                    No products yet — click "Add Product" to create the first one.
                  </td>
                </tr>
              ) : filtered.map((p) => {
                const imgs = parseJsonArray(p.imageUrls);
                return (
                  <tr key={p.id} className="border-t hover:bg-slate-50 dark:hover:bg-[hsl(220_45%_20%)]/50" data-testid={`row-product-${p.id}`}>
                    <td className="px-4 py-3">
                      {imgs[0] ? (
                        <img src={imgs[0]} alt="" className="w-12 h-12 object-cover rounded border" />
                      ) : (
                        <div className="w-12 h-12 bg-muted rounded border" />
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold max-w-xs truncate">
                      {p.featured && <Star className="w-3 h-3 text-accent inline mr-1" />}
                      {p.name}
                    </td>
                    <td className="px-4 py-3 capitalize">{p.brand.replace("-", " ")}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.partNumber || "—"}</td>
                    <td className="px-4 py-3">₹{p.priceInr.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{p.stockQty}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${p.active ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-500/15 text-slate-600"}`}>
                        {p.active ? "Active" : "Hidden"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => startEdit(p)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded" data-testid={`button-edit-${p.id}`}>
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!hideDelete && (
                        <button onClick={() => remove(p.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-${p.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{editing.id ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setEditing(null)} className="p-2 hover:bg-muted rounded" data-testid="button-close-editor">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 rounded-lg text-sm">{error}</div>}

              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Product Name *" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v, slug: editing.slug || toSlug(v) })} testId="input-name" />
                <Field label="Slug (URL)" value={editing.slug} onChange={(v) => setEditing({ ...editing, slug: toSlug(v) })} placeholder="auto-from-name" testId="input-slug" />

                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Brand *</label>
                  <select value={editing.brand} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid="select-brand">
                    {Object.values(BRANDS).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Category *</label>
                  <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid="select-category">
                    {PRODUCT_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                </div>

                <Field label="Model (e.g. Tata Prima 2523)" value={editing.model} onChange={(v) => setEditing({ ...editing, model: v })} testId="input-model" />
                <Field label="Part Number" value={editing.partNumber} onChange={(v) => setEditing({ ...editing, partNumber: v })} testId="input-partnumber" />
                <Field label="OEM Number (cross-reference)" value={editing.oemNumber} onChange={(v) => setEditing({ ...editing, oemNumber: v })} testId="input-oemnumber" />
                <Field label="Compatible Models (comma-separated)" value={editing.compatibleModels.join(", ")} onChange={(v) => setEditing({ ...editing, compatibleModels: v.split(",").map((s) => s.trim()).filter(Boolean) })} testId="input-compatible" />

                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Price (INR) *</label>
                  <input type="number" min={0} value={editing.priceInr} onChange={(e) => setEditing({ ...editing, priceInr: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid="input-price" />
                  <p className="text-xs text-muted-foreground mt-1">Customers see USD converted at the current rate.</p>
                </div>

                <div>
                  <label className="text-sm font-semibold mb-1.5 block">Stock Quantity</label>
                  <input type="number" min={0} value={editing.stockQty} onChange={(e) => setEditing({ ...editing, stockQty: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid="input-stock" />
                </div>
              </div>

              {/* R27.3 — AI Fill toolbar */}
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                <span className="text-xs font-bold text-indigo-700 inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> AI Fill:</span>
                {([["short-description", "Short Description"], ["seo-meta", "SEO Meta"], ["specifications", "Specifications"], ["discounts", "Discounts"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => aiFill(k)} disabled={!editing.name || aiBusy !== null}
                    className="text-xs px-2.5 py-1 rounded-md bg-white border border-indigo-200 text-indigo-700 font-semibold hover:bg-indigo-100 disabled:opacity-50"
                    data-testid={`button-aifill-${k}`}>
                    {aiBusy === k ? "…" : label}
                  </button>
                ))}
                {!editing.name && <span className="text-xs text-muted-foreground">Enter a product name first</span>}
              </div>

              <div>
                <label className="text-sm font-semibold mb-1.5 block">Short Description (1-2 lines)</label>
                <input value={editing.shortDescription} onChange={(e) => setEditing({ ...editing, shortDescription: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid="input-short-desc" />
              </div>

              <div>
                <label className="text-sm font-semibold mb-1.5 block">Full Description * <span className="text-xs font-normal text-muted-foreground">(Specifications &amp; Discounts AI fills append here)</span></label>
                <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-background min-h-[120px]" data-testid="input-description" />
              </div>

              {/* Images */}
              <div>
                <label className="text-sm font-semibold mb-1.5 block">Product Images</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Upload one or more images. The first image is the main product photo. Recommended: square crop, 800×800px, &lt; 2 MB each (JPG/PNG/WebP).
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-3">
                  {editing.imageUrls.map((url, i) => (
                    <div key={url} className="relative group">
                      <img src={url} alt="" className="w-full aspect-square object-cover rounded-lg border" />
                      <button
                        onClick={() => setEditing({ ...editing, imageUrls: editing.imageUrls.filter((_, j) => j !== i) })}
                        className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-[hsl(220_60%_12%)] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        data-testid={`button-remove-image-${i}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <label className="flex flex-col items-center justify-center aspect-square border-2 border-dashed rounded-lg cursor-pointer hover:border-accent hover:bg-accent/5 transition" data-testid="label-upload-image">
                    <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                    <span className="text-xs text-[hsl(220_60%_12%)]/75 font-medium">Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }}
                    />
                  </label>
                </div>
              </div>

              {/* SEO */}
              <details className="border rounded-lg">
                <summary className="px-4 py-3 font-semibold cursor-pointer">SEO (optional — auto-derived from name otherwise)</summary>
                <div className="p-4 space-y-3 border-t">
                  <Field label="Meta Title" value={editing.metaTitle} onChange={(v) => setEditing({ ...editing, metaTitle: v })} testId="input-metatitle" />
                  <div>
                    <label className="text-sm font-semibold mb-1.5 block">Meta Description</label>
                    <textarea value={editing.metaDescription} onChange={(e) => setEditing({ ...editing, metaDescription: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-background min-h-[80px]" />
                  </div>
                  <Field label="Meta Keywords (comma-separated)" value={editing.metaKeywords} onChange={(v) => setEditing({ ...editing, metaKeywords: v })} testId="input-metakeywords" />
                </div>
              </details>

              {/* Flags */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editing.featured} onChange={(e) => setEditing({ ...editing, featured: e.target.checked })} data-testid="check-featured" />
                  <span className="font-semibold text-sm">Featured on homepage</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} data-testid="check-active" />
                  <span className="font-semibold text-sm">Visible on public site</span>
                </label>
              </div>
            </div>

            <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="px-5 py-2.5 border rounded-lg font-semibold hover:bg-muted">Cancel</button>
              <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-accent text-accent-foreground rounded-lg font-bold inline-flex items-center gap-2 hover:bg-accent/90 disabled:opacity-60" data-testid="button-save-product">
                <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ShellLayout>
  );
}

function Field({ label, value, onChange, placeholder, testId }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <div>
      <label className="text-sm font-semibold mb-1.5 block">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded-lg bg-background" data-testid={testId} />
    </div>
  );
}
