// R28 Session 2 — Public chassis catalog. GET /api/chassis?q=&limit=&offset=
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Search, Truck, ChevronRight } from "lucide-react";
import { isFeatureDisabledError } from "@/lib/r28-utils";

interface Chassis {
  id: number;
  slug: string;
  chassis_display_name: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  parts_count?: number | null;
}

export default function ChassisBrowse() {
  const [q, setQ] = useState("");

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["public-chassis", q],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "100");
      const r = await apiRequest("GET", `/api/chassis?${params}`);
      return r.json();
    },
  });

  const chassisList: Chassis[] = Array.isArray(data) ? data : (data?.rows ?? []);
  const disabled = isFeatureDisabledError(error);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Chassis Catalog</h1>
          <p className="text-slate-600 text-sm mt-1">Browse every chassis we stock parts for. Or <Link href="/parts-finder"><a className="text-indigo-600 font-medium">look up by registration number</a></Link>.</p>
        </div>

        <div className="mb-6 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search make / model / chassis…" className="pl-9 h-11" data-testid="input-chassis-search" />
        </div>

        {disabled && (
          <div className="rounded-xl bg-slate-100 border border-slate-200 p-6 text-center">
            <div className="text-lg font-medium text-slate-800">Chassis catalog is coming soon</div>
          </div>
        )}

        {!disabled && isLoading && <div className="text-center text-slate-500 py-12">Loading chassis…</div>}
        {!disabled && !isLoading && chassisList.length === 0 && <div className="text-center text-slate-500 py-12">No chassis found.</div>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {chassisList.map((c) => (
            <Link key={c.id} href={`/chassis/${c.slug}`}>
              <a className="bg-white rounded-xl border p-4 hover:border-indigo-300 hover:shadow-sm transition flex items-start gap-3" data-testid={`card-chassis-${c.slug}`}>
                <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{c.chassis_display_name}</div>
                  {(c.make || c.model) && <div className="text-xs text-slate-500 truncate">{[c.make, c.model, c.variant].filter(Boolean).join(" · ")}</div>}
                  {typeof c.parts_count === "number" && <div className="text-xs text-slate-400 mt-1">{c.parts_count} parts</div>}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
              </a>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
