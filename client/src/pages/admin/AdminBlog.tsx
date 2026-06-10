import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import { Plus, Edit3, Trash2, Eye, EyeOff, FileText, Star, Sparkles } from "lucide-react";

interface Post {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImageUrl: string | null;
  type: "blog" | "spotlight";
  productSlug: string | null;
  authorName: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
}

const empty: Partial<Post> = {
  slug: "", title: "", excerpt: "", content: "", coverImageUrl: "",
  type: "blog", productSlug: "", authorName: "Narmada Mobility",
  metaTitle: "", metaDescription: "", published: false,
};

export default function AdminBlog() {
  const { token } = useAdminAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<"all" | "blog" | "spotlight">("all");
  const [open, setOpen] = useState<Partial<Post> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function generateWithAi() {
    if (!token) return;
    const topic = prompt("Describe the blog topic (e.g. 'How to choose brake pads for Tata Prima trucks'):");
    if (!topic || !topic.trim()) return;
    setGenerating(true);
    try {
      const r = await adminFetch(token, "/api/admin/posts/ai-generate", {
        method: "POST",
        body: JSON.stringify({ topic: topic.trim(), type: filter === "spotlight" ? "spotlight" : "blog" }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "AI generation failed"); return; }
      setOpen({ ...empty, type: filter === "spotlight" ? "spotlight" : "blog", ...d, published: false });
    } catch (e: any) {
      alert("AI generation failed. Please try again.");
    } finally { setGenerating(false); }
  }

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/posts");
    { const _d = await r.json(); setPosts(Array.isArray(_d) ? _d : []); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function save() {
    if (!token || !open) return;
    setSaving(true);
    try {
      const isNew = !open.id;
      const url = isNew ? "/api/admin/posts" : `/api/admin/posts/${open.id}`;
      const r = await adminFetch(token, url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(open),
      });
      if (!r.ok) {
        const e = await r.json();
        alert(e.error || "Save failed");
      } else {
        await load();
        setOpen(null);
      }
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!token) return;
    if (!confirm("Delete this post permanently?")) return;
    await adminFetch(token, `/api/admin/posts/${id}`, { method: "DELETE" });
    await load();
  }

  async function togglePublish(p: Post) {
    if (!token) return;
    await adminFetch(token, `/api/admin/posts/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ published: !p.published }),
    });
    await load();
  }

  async function handleImageUpload(file: File) {
    if (!token || !open) return;
    if (file.size > 5 * 1024 * 1024) { alert("Image too large (max 5MB)"); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const r = await adminFetch(token, "/api/v2/upload-image", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result, filename: file.name }),
        });
        const data = await r.json();
        if (data.url) setOpen((o) => o ? { ...o, coverImageUrl: data.url } : o);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (e) { setUploading(false); }
  }

  const filtered = posts.filter((p) => filter === "all" || p.type === filter);

  return (
    <AdminLayout title="Content / Blog">
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {(["all", "blog", "spotlight"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize ${filter === f ? "bg-accent text-accent-foreground" : "bg-card border hover:bg-muted"}`}
            data-testid={`filter-${f}`}
          >
            {f} {f !== "all" && `(${posts.filter((p) => p.type === f).length})`}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={generateWithAi}
          disabled={generating}
          className="px-4 py-2 border border-accent text-accent rounded-lg font-semibold text-sm inline-flex items-center gap-2 hover:bg-accent/10 disabled:opacity-50"
          data-testid="button-ai-generate"
        >
          <Sparkles className="w-4 h-4" /> {generating ? "Generating…" : "Generate with AI"}
        </button>
        <button
          onClick={() => setOpen({ ...empty })}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm inline-flex items-center gap-2"
          data-testid="button-new-post"
        >
          <Plus className="w-4 h-4" /> New Post
        </button>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No posts yet. Click New Post to create one.</div>
        ) : (
          <div className="divide-y">
            {filtered.map((p) => (
              <div key={p.id} className="p-5 flex items-start gap-4" data-testid={`row-post-${p.id}`}>
                {p.coverImageUrl ? (
                  <img src={p.coverImageUrl} alt="" className="w-20 h-20 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                    {p.type === "spotlight" ? <Star className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold">{p.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${p.type === "spotlight" ? "bg-amber-500/15 text-amber-700" : "bg-blue-500/15 text-blue-700"}`}>{p.type}</span>
                    {p.published ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 uppercase font-bold tracking-wider">Live</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-500/15 text-slate-700 uppercase font-bold tracking-wider">Draft</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">{p.excerpt || p.content.slice(0, 120)}</div>
                  <div className="text-xs text-muted-foreground mt-1">/{p.slug}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => togglePublish(p)} className="p-2 hover:bg-muted rounded" data-testid={`button-toggle-${p.id}`} title={p.published ? "Unpublish" : "Publish"}>
                    {p.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => setOpen(p)} className="p-2 hover:bg-muted rounded" data-testid={`button-edit-${p.id}`}>
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => del(p.id)} className="p-2 hover:bg-red-500/10 text-red-600 rounded" data-testid={`button-delete-${p.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="font-display text-xl font-bold">{open.id ? "Edit Post" : "New Post"}</h2>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Type">
                  <select
                    value={open.type || "blog"}
                    onChange={(e) => setOpen({ ...open, type: e.target.value as any })}
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="select-type"
                  >
                    <option value="blog">Blog Article</option>
                    <option value="spotlight">Product Spotlight</option>
                  </select>
                </Field>
                <Field label="Slug (URL)">
                  <input
                    value={open.slug || ""}
                    onChange={(e) => setOpen({ ...open, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                    placeholder="auto-from-title"
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="input-slug"
                  />
                </Field>
              </div>
              <Field label="Title">
                <input
                  value={open.title || ""}
                  onChange={(e) => setOpen({ ...open, title: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 bg-background"
                  data-testid="input-title"
                />
              </Field>
              <Field label="Excerpt (short summary)">
                <textarea
                  value={open.excerpt || ""}
                  onChange={(e) => setOpen({ ...open, excerpt: e.target.value })}
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 bg-background"
                  data-testid="input-excerpt"
                />
              </Field>
              <Field label="Cover Image">
                <div className="flex items-center gap-3">
                  {open.coverImageUrl && (
                    <img src={open.coverImageUrl} alt="" className="w-20 h-20 object-cover rounded border" />
                  )}
                  <label className="px-3 py-2 border rounded-lg cursor-pointer hover:bg-muted text-sm font-semibold">
                    {uploading ? "Uploading…" : open.coverImageUrl ? "Change Image" : "Upload Image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                      data-testid="input-cover-image"
                    />
                  </label>
                  {open.coverImageUrl && (
                    <button onClick={() => setOpen({ ...open, coverImageUrl: "" })} className="text-xs text-red-600 hover:underline">Remove</button>
                  )}
                </div>
              </Field>
              {open.type === "spotlight" && (
                <Field label="Linked Product Slug (e.g. tata-prima-brake-pad)">
                  <input
                    value={open.productSlug || ""}
                    onChange={(e) => setOpen({ ...open, productSlug: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="input-product-slug"
                  />
                </Field>
              )}
              <Field label="Content (HTML or markdown)">
                <textarea
                  value={open.content || ""}
                  onChange={(e) => setOpen({ ...open, content: e.target.value })}
                  rows={12}
                  className="w-full border rounded-lg px-3 py-2 bg-background font-mono text-sm"
                  data-testid="input-content"
                  placeholder="Write your article here. HTML tags supported."
                />
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="SEO Meta Title">
                  <input
                    value={open.metaTitle || ""}
                    onChange={(e) => setOpen({ ...open, metaTitle: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="input-meta-title"
                  />
                </Field>
                <Field label="Author Name">
                  <input
                    value={open.authorName || ""}
                    onChange={(e) => setOpen({ ...open, authorName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 bg-background"
                    data-testid="input-author"
                  />
                </Field>
              </div>
              <Field label="SEO Meta Description">
                <textarea
                  value={open.metaDescription || ""}
                  onChange={(e) => setOpen({ ...open, metaDescription: e.target.value })}
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 bg-background"
                  data-testid="input-meta-description"
                />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!open.published}
                  onChange={(e) => setOpen({ ...open, published: e.target.checked })}
                  data-testid="checkbox-published"
                />
                <span className="text-sm font-semibold">Publish immediately (visible on the public site)</span>
              </label>
            </div>
            <div className="sticky bottom-0 bg-card border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setOpen(null)} className="px-4 py-2 border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm disabled:opacity-50" data-testid="button-save-post">
                {saving ? "Saving…" : "Save Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</div>
      {children}
    </div>
  );
}
