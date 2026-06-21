import { useEffect, useState } from "react";
import { TeamLayout } from "./TeamLayout";
import { teamFetch, useTeamAuth } from "@/lib/team-auth";
import { Download, GitBranch, CheckCircle2 } from "lucide-react";

// R27.4 BUG-13 — Procurement (Data Team) Deviation tab. Mirrors the admin
// Operations → Deviations view using team-token endpoints (/api/team/deviations).
export default function TeamDeviations() {
  const { token } = useTeamAuth();
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    const r = await teamFetch(token, `/api/team/deviations${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    if (r.ok) setRows(await r.json());
  }
  useEffect(() => { load(); }, [token, status]); // eslint-disable-line

  async function resolve(id: number) {
    if (!token) return;
    const r = await teamFetch(token, `/api/team/deviations/${id}/resolve`, { method: "POST", body: JSON.stringify({}) });
    if (r.ok) { setMsg(`Deviation #${id} resolved.`); load(); setTimeout(() => setMsg(null), 3000); }
  }
  async function subPo(id: number) {
    if (!token) return;
    const r = await teamFetch(token, `/api/team/deviations/${id}/create-sub-po`, { method: "POST", body: JSON.stringify({}) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(`Sub-PO created for deviation #${id}.`); load(); setTimeout(() => setMsg(null), 3000); }
    else setMsg(j.error || "Failed to create sub-PO");
  }
  async function exportXlsx() {
    if (!token) return;
    const r = await teamFetch(token, "/api/team/deviations/export.xlsx");
    if (!r.ok) { setMsg("Export failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "deviations.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <TeamLayout title="Deviations">
      {msg && <div className="mb-4 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          {["open", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setStatus(s === "all" ? "" : s)} data-testid={`team-deviation-filter-${s}`}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize ${(status === s || (s === "all" && !status)) ? "bg-violet-600 text-white" : "border hover:bg-muted"}`}>{s}</button>
          ))}
        </div>
        <button onClick={exportXlsx} className="px-3 py-1.5 rounded-lg border text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted" data-testid="team-deviation-export"><Download className="w-4 h-4" /> Export xlsx</button>
      </div>
      <div className="bg-card border rounded-xl overflow-hidden">
        {rows.length === 0 ? <div className="p-10 text-center text-muted-foreground">No deviations.</div> : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr><th className="p-3">#</th><th className="p-3">PO</th><th className="p-3">Field</th><th className="p-3">Expected</th><th className="p-3">Actual</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30">
                  <td className="p-3 font-mono">#{d.id}</td>
                  <td className="p-3">{d.poNumber || d.po_id || "—"}</td>
                  <td className="p-3">{d.field}</td>
                  <td className="p-3">{d.expected ?? "—"}</td>
                  <td className="p-3">{d.actual ?? "—"}</td>
                  <td className="p-3"><span className={`text-xs font-bold rounded px-2 py-1 ${d.resolved_at ? "bg-emerald-600 text-white" : "bg-amber-500/15 text-amber-700"}`}>{d.resolved_at ? "resolved" : "open"}</span></td>
                  <td className="p-3 text-right">
                    {!d.resolved_at ? (
                      <div className="inline-flex gap-1">
                        <button onClick={() => subPo(d.id)} className="px-2 py-1 rounded bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-1" data-testid={`team-deviation-subpo-${d.id}`}><GitBranch className="w-3.5 h-3.5" /> Sub-PO</button>
                        <button onClick={() => resolve(d.id)} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1" data-testid={`team-deviation-resolve-${d.id}`}><CheckCircle2 className="w-3.5 h-3.5" /> Resolve</button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </TeamLayout>
  );
}
