const { default: assert } = await import("node:assert/strict");
const { readFile } = await import("node:fs/promises");

// Actual helper, native browser picker/dialogs, exclusively intercepted requests.
export async function testLargeCsvOperator(browser, helperPath) {
  const script=await readFile(helperPath,"utf8"),context=await browser.newContext();
  const page=await context.newPage(),messages=[],requests=[],checks=[];
  const token="offline-fixture-secret-do-not-log";
  const csv="part_number,description,mrp\n000-A,Valid,835\n";
  let phase="pending",attempts=0,confirmations=[];
  const prompts=["tata","offline-qa","2026-11-03","utf-8"];
  page.on("console",message=>messages.push(message.text()));
  page.on("dialog",async dialog=>{
    if(dialog.type()==="prompt") await dialog.accept(prompts.shift());
    else {confirmations.push(dialog.message());await dialog.accept();}
  });
  await context.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin==="https://narmadamobility.com" && req.resourceType()==="document")
      return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Offline authenticated admin fixture</title><body>Offline operator QA fixture</body>"});
    assert.equal(url.origin,"https://narmada-backend.onrender.com","No requests to any other origin");
    if(req.method()==="OPTIONS") return route.fulfill({status:204,headers:{"Access-Control-Allow-Origin":"https://narmadamobility.com","Access-Control-Allow-Methods":"GET,POST,PUT","Access-Control-Allow-Headers":"content-type,x-admin-token"}});
    assert.equal(req.headers()["x-admin-token"],token);
    requests.push({method:req.method(),path:url.pathname,body:req.postData()});
    const headers={"Access-Control-Allow-Origin":"https://narmadamobility.com"};
    const status={upload_id:7,brand:"tata",version_label:"offline-qa",effective_date:null,state:phase,staged_rows:phase==="complete"?1:0,expected_bytes:Buffer.byteLength(csv),received_bytes:Buffer.byteLength(csv),upload_status:phase==="complete"?"complete":"uploading"};
    if(url.pathname==="/api/admin/catalog-sync") return route.fulfill({headers,json:{enabled:true}});
    if(req.method()==="POST") return route.fulfill({headers,json:status});
    if(req.method()==="PUT") {
      attempts++;phase=attempts===1?"failed":"complete";
      const event=attempts===1 ? {event:"error",error:"Invalid utf-8 byte at offset 30, CSV record 2, column description."}
        : {event:"complete",...status,state:"complete",publication:{job:{id:19,state:"queued"}}};
      return route.fulfill({headers,contentType:"application/x-ndjson",body:JSON.stringify(event)+"\n"});
    }
    return route.fulfill({headers,json:status});
  });
  try {
    await page.goto("https://narmadamobility.com/admin/price-lists");
    await page.evaluate(value=>localStorage.setItem("narmada_admin_token",value),token);
    await page.addScriptTag({content:script});
    assert.equal(requests.length,0);checks.push("Installing helper sends no API request or import");
    const chooserEvent=page.waitForEvent("filechooser");
    const first=page.evaluate(()=>window.narmadaLargeCsv.chooseAndImport()).catch(e=>e.message);
    const chooser=await chooserEvent;
    await chooser.setFiles({name:"tiny-fixture.csv",mimeType:"text/csv",buffer:Buffer.from("part_number,description,mrp\n000-A,Valid,835\n")});
    assert.match(await first,/Invalid utf-8/);
    assert(confirmations[0].includes("ENABLED") && confirmations[0].includes("PUBLIC catalog updates"));
    checks.push("Native picker and metadata confirmation warn of existing enabled publication");
    assert.equal(requests.filter(r=>r.method==="POST").length,1);
    const metadata=JSON.parse(requests.find(r=>r.method==="POST").body);
    assert.equal(metadata.encoding,"utf-8");assert.equal(metadata.brand,"tata");
    assert.equal(requests.find(r=>r.method==="PUT").body,"part_number,description,mrp\n000-A,Valid,835\n");
    checks.push("Raw File body reaches only fixed HTTPS backend with existing admin header");
    const retry=await page.evaluate(()=>window.narmadaLargeCsv.retry());
    assert.equal(retry.state,"complete");assert.equal(requests.filter(r=>r.method==="POST").length,1);
    assert.equal(requests.filter(r=>r.method==="PUT").length,2);
    const again=await page.evaluate(()=>window.narmadaLargeCsv.retry());
    assert.equal(again.state,"complete");assert.equal(requests.filter(r=>r.method==="PUT").length,2);
    checks.push("Error surfaced; same-file retry reuses session; complete retry sends no file");
    phase="failed";await page.reload();await page.addScriptTag({content:script});prompts.push("7");
    const resumeChooser=page.waitForEvent("filechooser");
    const resumed=page.evaluate(()=>window.narmadaLargeCsv.resume());
    await (await resumeChooser).setFiles({name:"same-original.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
    assert.equal((await resumed).state,"complete");
    assert(confirmations.at(-1).includes("Brand: tata") && confirmations.at(-1).includes("Version: offline-qa"));
    assert.equal(requests.filter(r=>r.method==="POST").length,1);
    checks.push("After refresh, saved import ID and original file resume without a new session");
    assert(!messages.join("\n").includes(token));
    checks.push("Session token never appears in console output");
    await page.reload();await page.evaluate(()=>localStorage.removeItem("narmada_admin_token"));
    await page.addScriptTag({content:script});
    const before=requests.length;
    assert.match(await page.evaluate(()=>window.narmadaLargeCsv.chooseAndImport().catch(e=>e.message)),/Sign in as an admin/);
    assert.equal(requests.length,before);checks.push("Missing login fails before file access or API request");
    await page.route("https://untrusted.example/**",r=>r.fulfill({contentType:"text/html",body:"<body>Wrong origin fixture</body>"}));
    await page.goto("https://untrusted.example/");
    const error=await page.evaluate(text=>{try{Function(text)();return "";}catch(e){return e.message;}},script);
    assert.match(error,/signed-in https:\/\/narmadamobility.com/);
    checks.push("Wrong origin rejected before token access or requests");
    return {checks,requests:requests.length,scope:"Offline browser fixtures only; no production requests"};
  } finally {await context.close();}
}
