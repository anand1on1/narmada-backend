import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { adminFetch, useAdminAuth } from "@/lib/admin-auth";
import type { Contact } from "@shared/schema";
import { Mail, Phone, Globe, Package, Clock } from "lucide-react";

export default function AdminContacts() {
  const { token } = useAdminAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<"all" | "new" | "replied" | "archived">("all");
  const [open, setOpen] = useState<Contact | null>(null);

  async function load() {
    if (!token) return;
    const r = await adminFetch(token, "/api/admin/contacts");
    setContacts(await r.json());
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function setStatus(id: number, status: string) {
    if (!token) return;
    await adminFetch(token, `/api/admin/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
    setOpen(null);
  }

  const filtered = contacts.filter((c) => filter === "all" || c.status === filter);

  return (
    <AdminLayout title="Customer Enquiries">
      <div className="flex gap-2 mb-6">
        {(["all", "new", "replied", "archived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize ${filter === f ? "bg-accent text-accent-foreground" : "bg-card border hover:bg-muted"}`}
            data-testid={`filter-${f}`}
          >
            {f} {f !== "all" && `(${contacts.filter((c) => c.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-[hsl(220_60%_12%)]/75 font-medium">No enquiries in this view.</div>
        ) : (
          <div className="divide-y">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpen(c)}
                className="w-full text-left p-5 hover:bg-muted/50 transition flex items-start gap-4"
                data-testid={`row-contact-${c.id}`}
              >
                <div className={`w-2 h-2 rounded-full mt-2 ${c.status === "new" ? "bg-accent" : c.status === "replied" ? "bg-emerald-500" : "bg-slate-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-sm text-[hsl(220_60%_12%)]/75 font-medium">{c.email}</span>
                    {c.country && <span className="text-xs px-2 py-0.5 bg-muted rounded">{c.country}</span>}
                    {c.productInterest && <span className="text-xs px-2 py-0.5 bg-accent/10 text-accent rounded">{c.productInterest}</span>}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">{c.subject || c.message}</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">{open.name}</h2>
                <p className="text-sm text-[hsl(220_60%_12%)]/75 font-medium">{new Date(open.createdAt).toLocaleString()}</p>
              </div>
              <button onClick={() => setOpen(null)} className="px-3 py-1.5 hover:bg-muted rounded text-sm">Close</button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid sm:grid-cols-2 gap-3">
                <InfoRow icon={Mail} label="Email" value={open.email} link={`mailto:${open.email}`} />
                {open.phone && <InfoRow icon={Phone} label="Phone" value={open.phone} link={`tel:${open.phone}`} />}
                {open.country && <InfoRow icon={Globe} label="Country" value={open.country} />}
                {open.productInterest && <InfoRow icon={Package} label="Interest" value={open.productInterest} />}
              </div>

              {open.subject && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Subject</div>
                  <div className="font-semibold">{open.subject}</div>
                </div>
              )}

              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Message</div>
                <div className="bg-muted/50 p-4 rounded-lg whitespace-pre-wrap leading-relaxed">{open.message}</div>
              </div>

              <div className="flex flex-wrap gap-3 pt-3 border-t">
                <a
                  href={`mailto:${open.email}?subject=Re: ${encodeURIComponent(open.subject || "Your enquiry")}`}
                  className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-semibold text-sm"
                  data-testid="link-reply-email"
                >
                  Reply by Email
                </a>
                {open.phone && (
                  <a
                    href={`https://wa.me/${open.phone.replace(/\D/g, "")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="px-4 py-2 bg-emerald-600 text-[hsl(220_60%_12%)] rounded-lg font-semibold text-sm"
                    data-testid="link-reply-whatsapp"
                  >
                    Reply on WhatsApp
                  </a>
                )}
                <div className="flex-1" />
                <button onClick={() => setStatus(open.id, "replied")} className="px-3 py-2 border rounded-lg text-sm font-semibold" data-testid="button-mark-replied">Mark Replied</button>
                <button onClick={() => setStatus(open.id, "archived")} className="px-3 py-2 border rounded-lg text-sm font-semibold" data-testid="button-archive">Archive</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function InfoRow({ icon: Icon, label, value, link }: { icon: any; label: string; value: string; link?: string }) {
  const inner = (
    <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
      <Icon className="w-4 h-4 text-accent flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="font-semibold truncate">{value}</div>
      </div>
    </div>
  );
  return link ? <a href={link} className="hover:opacity-80">{inner}</a> : inner;
}
