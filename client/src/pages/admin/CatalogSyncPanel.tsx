import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-auth";

export function CatalogSyncPanel({token}:{token:string|null}) {
  const [data,setData]=useState<any>(null),[error,setError]=useState(""),[audit,setAudit]=useState<any[]>([]);
  async function refresh() {
    if(!token) return;
    const r=await adminFetch(token,"/api/admin/catalog-sync");
    if(r.ok) setData(await r.json());
  }
  useEffect(()=>{void refresh(); const t=setInterval(()=>void refresh(),2500);return()=>clearInterval(t);},[token]);
  async function post(path:string,body:any) {
    if(!token) return;
    try {
      const r=await adminFetch(token,`/api/admin/catalog-sync/${path}`,{method:"POST",body:JSON.stringify(body)});
      const d=await r.json(); if(!r.ok) throw Error(d.error); setError(""); await refresh();
    } catch(e) {setError(String((e as Error).message));}
  }
  return <section className="bg-card border rounded-xl p-5 mb-6" aria-label="Public catalog publication">
    <h2 className="text-lg font-semibold">Public catalog publication</h2>
    <p className="text-sm my-2">Current MRP in INR, GST included → USD. No markup or automatic discount. Start with a dry run and review its rejected rows before a pilot.</p>
    <p className="text-sm mb-3">{data?.fx ? `Last verified FX: 1 USD = ${data.fx.rate} INR (${new Date(data.fx.at).toLocaleString()}). Jobs retain this conversion snapshot.` : "Publication waits for a verified FX-service rate. No hardcoded fallback is used."}</p>
    <div className="flex gap-3 flex-wrap">
      <button className="border rounded px-3 py-2" onClick={()=>void post("jobs",{requestKey:crypto.randomUUID(),mode:"search-index"})}>Build resumable search index</button>
      <button className="border rounded px-3 py-2" onClick={()=>void post("jobs",{requestKey:crypto.randomUUID(),mode:"dry-run"})}>Dry run existing price lists</button>
      <button className="border rounded px-3 py-2" onClick={()=>{if(confirm("Publish up to 100 price-list rows as a pilot?")) void post("jobs",{requestKey:crypto.randomUUID(),mode:"publish",limit:100});}}>Publish 100-row pilot</button>
      <button className="border rounded px-3 py-2" onClick={()=>{if(confirm("Publish all eligible current price-list rows in resumable batches? Review the dry run first.")) void post("jobs",{requestKey:crypto.randomUUID(),mode:"publish"});}}>Publish full catalog</button>
      <button className="border rounded px-3 py-2" onClick={()=>{if(confirm(`${data?.enabled?"Disable":"Enable"} automatic public sync after future uploads? This does not start a backfill.`)) void post("settings",{enabled:!data?.enabled});}}>
        {data?.enabled?"Disable":"Enable"} future upload sync
      </button>
    </div>
    <p role="status" className="text-sm mt-3">Future upload sync: {data?.enabled?"enabled":"disabled"}</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm"><thead><tr><th>Job</th><th>State</th><th>Progress</th><th>New / updated / skipped / rejected</th><th>Controls</th></tr></thead>
      <tbody>{data?.jobs?.map((j:any)=><tr key={j.id} className="border-t">
        <td className="p-2">{j.id} · {j.mode}</td><td>{j.state}{j.error && <p role="alert">{j.error}</p>}</td>
        <td>{j.processed.toLocaleString()} / {j.total.toLocaleString()}</td><td>{j.created} / {j.updated} / {j.skipped} / {j.rejected}</td>
        <td className="flex flex-wrap gap-2 p-2">
          <button className="underline" onClick={async()=>{if(token){const r=await adminFetch(token,`/api/admin/catalog-sync/jobs/${j.id}/audit`);setAudit(await r.json());}}}>First 100 audit rows</button>
          {["queued","running","waiting_fx"].includes(j.state) && <button onClick={()=>void post(`jobs/${j.id}/control`,{action:"pause"})}>Pause</button>}
          {["paused","failed"].includes(j.state) && <button onClick={()=>void post(`jobs/${j.id}/control`,{action:"resume"})}>Resume</button>}
          {j.mode==="publish" && ["complete","paused"].includes(j.state) && <button onClick={()=>{if(confirm("Reverse this job only where products have not changed since it ran? New products will be hidden; no product is deleted.")) void post(`jobs/${j.id}/control`,{action:"reverse",confirm:true});}}>Reverse</button>}
        </td></tr>)}</tbody></table>
    </div>
    {audit.length>0 && <div className="mt-3 max-h-64 overflow-auto text-sm">{audit.map(a=><p key={a.id}>Row {a.item_id}: {a.outcome} {a.reason}</p>)}</div>}
  </section>;
}
