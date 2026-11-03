/*
 * One-time, reviewed operator helper. No installation, remote code loading or
 * website deployment. Run only in your signed-in Narmada admin browser tab.
 * Loading this script does not import anything. Then explicitly run:
 *   narmadaLargeCsv.chooseAndImport()
 * Retry interrupted same-file upload: narmadaLargeCsv.retry()
 * Read status: narmadaLargeCsv.status()
 * After a page refresh: narmadaLargeCsv.resume() and enter the saved import ID.
 * File/session state is memory-only and is forgotten on page refresh.
 */
(() => {
  "use strict";
  const BACKEND = "https://narmada-backend.onrender.com";
  const SITES = ["https://narmadamobility.com", "https://www.narmadamobility.com"];
  if (!SITES.includes(location.origin) || !location.pathname.startsWith("/admin")) {
    throw new Error("Open your signed-in https://narmadamobility.com/admin/price-lists tab first.");
  }
  if (window.narmadaLargeCsv) throw new Error("Helper already installed. Use its retry/status methods or refresh to forget it.");
  let file, metadata, importId, running = false, choosing = false;
  const token = () => {
    const value = localStorage.getItem("narmada_admin_token") || sessionStorage.getItem("narmada_admin_token");
    if (!value) throw new Error("Sign in as an admin first. Never paste your session token into this console or a chat.");
    return value;
  };
  const request = async (path, init = {}) => {
    const r = await fetch(BACKEND + path, {
      ...init, redirect: "error", credentials: "omit",
      headers: { ...init.headers, "x-admin-token": token() },
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || body.message || `Request failed (HTTP ${r.status})`);
    }
    return r;
  };
  const base = "/api/admin/catalog-sync/csv-imports";
  const pickFile = () => new Promise((resolve,reject) => {
    const picker=document.createElement("input");picker.type="file";picker.accept=".csv,text/csv";
    picker.addEventListener("change",()=>picker.files[0] ? resolve(picker.files[0]) : reject(new Error("No file selected")),{once:true});
    picker.addEventListener("cancel",()=>reject(new Error("File selection cancelled")),{once:true});picker.click();
  });
  const show = data => {
    console.info("CSV import", {
      importId: data.upload_id || data.uploadId,
      state: data.state || data.event,
      stagedRows: data.staged_rows,
      bytesReceived: data.received_bytes,
      totalBytes: data.expected_bytes,
      error: data.error,
      sha256: data.sha256,
    });
  };
  const status = async () => {
    if (!importId) throw new Error("No import started in this tab.");
    const data = await (await request(`${base}/${importId}`)).json();
    show(data);return data;
  };
  const send = async () => {
    if (running) throw new Error("An import is already running in this tab.");
    if (!file || !metadata) throw new Error("Choose the file and confirm metadata first.");
    running = true;let timer, polling = false;
    try {
      if (!importId) {
        const started = await (await request(base, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(metadata) })).json();
        importId = started.upload_id;show(started);
      }
      const before = await status();
      if (before.state === "complete") return before;
      timer = setInterval(async () => {
        if (polling) return;polling = true;
        try { await status(); } catch (e) { console.info("Status unavailable:",e.message); }
        finally { polling = false; }
      },3000);
      const response = await request(`${base}/${importId}/content`, { method:"PUT",headers:{"Content-Type":"text/csv"},body:file });
      if (!(response.headers.get("Content-Type") || "").includes("application/x-ndjson")) return await status();
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let pending = "", completed = false;
      for (;;) {
        const {value,done} = await reader.read();
        pending += decoder.decode(value || new Uint8Array(),{stream:!done});
        let newline;
        while ((newline=pending.indexOf("\n"))!==-1) {
          const line=pending.slice(0,newline);pending=pending.slice(newline+1);
          if (!line) continue;
          const event=JSON.parse(line);show(event);
          if (event.event==="error") throw new Error(event.error);
          if (event.event==="complete") {
            completed=true;
            console.info("Import received completely. Publication:",event.publication.job ?
              {jobId:event.publication.job.id,state:event.publication.job.state} : "No publication job; future upload sync is disabled.");
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error("Connection ended without completion. Check status before retrying the same file.");
      return await status();
    } catch (e) {
      console.error("CSV import stopped:",e.message);
      if (importId) { try { await status(); } catch {} }
      throw e;
    } finally { clearInterval(timer);running=false; }
  };
  const chooseAndImport = async () => {
    if (running || choosing || metadata || importId) throw new Error("An import already exists in this helper. Use retry/status. Refresh only when intentionally starting a different import.");
    choosing = true;
    try {
    token(); // Fail without touching the file if the existing session is absent.
    file = await pickFile();
    if (!file.size || file.size>64*1024*1024) throw new Error("Choose a CSV between 1 byte and 64 MiB. The data-row limit is 500,000.");
    const brand=prompt("Brand code (for example tata, eicher, ashok-leyland, bharatbenz):","");
    if (!brand) return;
    const versionLabel=prompt("Version label for this price list:","");
    if (versionLabel === null) return;
    const effectiveDate=prompt("Effective date YYYY-MM-DD (blank for current):","");
    if (effectiveDate === null) return;
    const encoding=prompt("Confirmed source encoding: utf-8 or windows-1252. Do not guess or use windows-1252 to repair damaged UTF-8.","utf-8");
    if (!["utf-8","windows-1252"].includes(encoding)) throw new Error("Encoding was not confirmed.");
    const sync=await (await request("/api/admin/catalog-sync")).json();
    if (!confirm(`Import ${file.name} (${file.size.toLocaleString()} bytes)?\nBrand: ${brand}\nVersion: ${versionLabel || "(blank)"}\nEffective: ${effectiveDate || "(current)"}\nEncoding: ${encoding}\n\nExisting lists/products will not be deleted. Current future-upload sync: ${sync.enabled?"ENABLED":"DISABLED"}. If enabled at completion, this import queues PUBLIC catalog updates under the existing pricing rules. No setting will be changed.\n\nOnly continue if authorized for these effects.`)) return;
    metadata={requestKey:crypto.randomUUID(),brand,versionLabel,effectiveDate,encoding,bytes:file.size};
    return send();
    } finally { choosing=false; }
  };
  const resume = async () => {
    if (running || choosing || importId || metadata) throw new Error("Use retry/status for this tab's existing import.");
    choosing=true;
    try {
      const id=Number(prompt("Saved numeric import ID (not a password or session token):",""));
      if (!Number.isSafeInteger(id) || id<1) return;
      const saved=await (await request(`${base}/${id}`)).json();show(saved);
      if (saved.state==="complete") return saved;
      const selected=await pickFile();
      if (selected.size!==saved.expected_bytes) throw new Error("File size differs. Select the exact original file, not a corrected replacement.");
      const date=saved.effective_date ? new Date(saved.effective_date).toISOString().slice(0,10) : "(current)";
      if (!confirm(`Resume import ${id}, list ${saved.list_id}, using the EXACT ORIGINAL file?\nBrand: ${saved.brand}\nVersion: ${saved.version_label || "(blank)"}\nEffective: ${date}\nEncoding: ${saved.encoding}\nBytes: ${saved.expected_bytes}\nExisting chunks will be verified. Changed files need a new import. If future-upload sync is enabled at completion, PUBLIC updates will be queued. Proceed only if authorized.`)) return;
      importId=id;file=selected;metadata={encoding:saved.encoding,bytes:saved.expected_bytes};
      return send();
    } finally {choosing=false;}
  };
  window.narmadaLargeCsv=Object.freeze({chooseAndImport,status,resume,retry:async()=>{
    if (!confirm("Retry the same retained file and metadata? Committed chunks will be verified, not duplicated. Current future-upload sync settings still apply.")) return;
    return send();
  }});
  console.info("Large CSV helper ready. No import has started. Run narmadaLargeCsv.chooseAndImport() when authorized. Never share your session token.");
})();
