const { default: assert }=await import("node:assert/strict");
const { mkdir,open:openFile,unlink }=await import("node:fs/promises");
const { createHash }=await import("node:crypto");
export async function testDashboardLargeCsv(browser,{baseURL,outputDir}) {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  const checks=[],pageErrors=[],sessions=new Map(),puts=[];
  let mode="success",syncEnabled=false,authFailure=false,legacyCreates=0,fixtureDigest="";
  page.on("pageerror",e=>pageErrors.push(e.message));
  await context.addInitScript(()=>{
    localStorage.setItem("narmada_admin_token","fixture");localStorage.setItem("narmada_admin_role","admin");
    window.__csvMaterialized=0;
    const original=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=function(){
      if(this.name.endsWith(".csv")) {window.__csvMaterialized++;throw Error("CSV must not be materialized");}
      return original.call(this);
    };
  });
  await context.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(baseURL).origin)return route.abort();
    if(url.pathname==="/config.js")return route.fulfill({contentType:"text/javascript",body:"window.__API_BASE__=window.location.origin;"});
    if(!url.pathname.startsWith("/api/"))return route.continue();
    const send=(json,status=200)=>route.fulfill({json,status});
    if(url.pathname==="/api/admin/me")return send({username:"fixture",role:"admin"});
    if(url.pathname==="/api/admin/price-lists")return send([]);
    if(url.pathname==="/api/admin/catalog-sync")return authFailure?send({error:"Unauthorized"},401):send({enabled:syncEnabled,fx:null,jobs:[]});
    if(url.pathname.endsWith("/uploads")) {legacyCreates++;return send({id:999});}
    const csvBase="/api/admin/catalog-sync/csv-imports";
    if(url.pathname===csvBase) {
      assert.equal(req.headers()["x-admin-token"],"fixture");
      const b=req.postDataJSON();
      const existing=[...sessions.values()].find(s=>s.key===b.requestKey);
      if(existing)return send(existing);
      const value={upload_id:sessions.size+1,key:b.requestKey,state:"pending",brand:b.brand,version_label:b.versionLabel,
        effective_date:b.effectiveDate?Date.parse(b.effectiveDate):null,encoding:b.encoding,
        expected_bytes:b.bytes,received_bytes:0,staged_rows:0,parsed_rows:0};
      sessions.set(value.upload_id,value);return send(value);
    }
    if(url.pathname.startsWith(csvBase+"/")) {
      const id=Number(url.pathname.slice(csvBase.length+1).split("/")[0]),s=sessions.get(id);
      if(req.method()==="GET")return send(s);
      assert.equal(req.method(),"PUT");assert.equal(req.headers()["content-type"],"text/csv");
      assert.equal(req.headers()["x-admin-token"],"fixture");
      const raw=req.postDataBuffer(),bytes=raw.length;assert.equal(bytes,s.expected_bytes);
      assert.equal(createHash("sha256").update(raw).digest("hex"),fixtureDigest);
      puts.push({id,bytes});
      s.received_bytes=bytes;s.staged_rows=500;s.state="failed";
      const progress={event:"progress",...s,state:"streaming"};
      if(mode==="auth")return send({error:"Unauthorized"},401);
      if(mode==="utf8") {
        s.error="Invalid utf-8 byte at offset 9000000, CSV record 1249, column description. Obtain a clean UTF-8 export; no bytes were replaced.";
        return route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify(progress)+"\n"+JSON.stringify({event:"error",error:s.error})+"\n"});
      }
      if(mode==="missing")return route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify(progress)+"\n"});
      s.state="complete";s.staged_rows=300000;s.parsed_rows=300000;s.error=null;
      if(mode==="committed-disconnect")return route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify(progress)+"\n"});
      const done={event:"complete",...s,publication:{rows:300000,autoSync:syncEnabled,job:syncEnabled?{id:55,state:"waiting_fx"}:null}};
      return route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify(progress)+"\n"+JSON.stringify(done)+"\n"});
    }
    return send([]);
  });
  const dialog=page.getByRole("dialog"),save=page.getByTestId("button-upload-list-save");
  const file=page.getByTestId("input-csv-file");
  const bytes=Buffer.from("part_number,description,mrp\n"+"000-A,synthetic description,835\n".repeat(300000));
  fixtureDigest=createHash("sha256").update(bytes).digest("hex");
  assert(bytes.length>8*1024*1024 && bytes.length<64*1024*1024);
  const select=async(buffer=bytes,name="native-large.csv")=>file.setInputFiles({name,mimeType:"text/csv",buffer});
  const open=async()=>{await page.getByTestId("button-upload-list").click();await page.getByTestId("select-brand").selectOption("tata");};
  const confirm=async()=>{
    await save.click();await page.getByTestId("csv-publication-notice").waitFor();
    assert(await save.isDisabled());await page.getByTestId("checkbox-csv-confirm").check();await save.click();
  };
  const error=async text=>{
    await dialog.getByRole("alert").filter({hasText:text}).waitFor({state:"visible"});
    const box=await dialog.getByRole("alert").boundingBox();
    assert(box && box.y>=0 && box.y+box.height<=page.viewportSize().height,"Error must fit in viewport");
  };
  try {
    await page.goto(baseURL+"/admin/price-lists");await open();await select();
    assert.equal(legacyCreates,0);assert.equal(sessions.size,0);
    await confirm();await dialog.waitFor({state:"detached"});
    assert.equal(puts[0].bytes,bytes.length);assert.equal(legacyCreates,0);
    assert.equal(await page.evaluate(()=>window.__csvMaterialized),0);
    await page.getByRole("status").filter({hasText:"no publication job was created"}).waitFor();
    checks.push("Native CSV >8 MiB sends unchanged File bytes via streaming route, never worksheet parsing or legacy upload");
    await open();await select();authFailure=true;await save.click();await error("authorized admin account");
    assert.equal(sessions.size,1);authFailure=false;
    await save.click();await page.getByTestId("checkbox-csv-confirm").check();
    syncEnabled=true;await save.click();
    await page.getByTestId("csv-publication-notice").filter({hasText:"currently ENABLED"}).waitFor();
    assert(await save.isDisabled());assert(!(await page.getByTestId("checkbox-csv-confirm").isChecked()));
    assert.equal(sessions.size,1);checks.push("Auth failure creates no import; changed sync state requires renewed explicit approval");
    mode="utf8";await page.getByTestId("checkbox-csv-confirm").check();await save.click();
    await error("Invalid utf-8");assert(await page.getByTestId("select-brand").isDisabled());
    await mkdir(outputDir,{recursive:true});
    await page.screenshot({path:outputDir+"/csv-encoding-error-desktop.png"});
    await page.setViewportSize({width:375,height:812});await error("Invalid utf-8");
    await page.screenshot({path:outputDir+"/csv-encoding-error-mobile.png"});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    checks.push("HTTP 200 NDJSON encoding error remains visible inside modal at desktop/mobile; no success or silent repair");
    const failedId=puts.at(-1).id,created=sessions.size;
    mode="missing";await save.click();await error("without a completion event");
    assert.equal(sessions.size,created);assert.equal(puts.at(-1).id,failedId);
    mode="auth";await save.click();await error("authorized admin account");
    checks.push("Missing terminal event and stream auth failure remain failed; retries reuse the same session");
    await page.reload();await page.getByTestId("button-resume-csv").click();
    assert(await page.getByTestId("select-brand").isDisabled());
    await select(Buffer.from("part_number,mrp\nA,1\n"),"wrong-size.csv");
    await error("exact original CSV");
    await select();mode="success";await confirm();await dialog.waitFor({state:"detached"});
    assert.equal(sessions.size,created);
    await page.getByRole("status").filter({hasText:"waiting_fx"}).waitFor();
    assert((await page.getByRole("status").filter({hasText:"waiting_fx"}).innerText()).includes("not confirmation that prices are live"));
    checks.push("Refresh-resume restores original metadata, rejects wrong-sized file, reuses import and distinguishes waiting-FX from live");
    const checkpoint={id:failedId,fileName:"native-large.csv",bytes:bytes.length},putCount=puts.length;
    await page.evaluate(v=>localStorage.setItem("narmada_price_csv_import",JSON.stringify(v)),checkpoint);
    await page.reload();await page.getByTestId("button-resume-csv").click();
    await page.getByRole("status").filter({hasText:"completion alone"}).waitFor();
    assert.equal(puts.length,putCount);
    checks.push("Completed saved import is reconciled without another PUT");
    await open();await select();mode="utf8";await confirm();await error("Invalid utf-8");
    const oldId=puts.at(-1).id;
    await page.getByTestId("button-new-csv").click();
    assert(!(await page.getByTestId("select-brand").isDisabled()));
    await select(bytes,"corrected.csv");mode="committed-disconnect";await confirm();
    await dialog.waitFor({state:"detached"});
    assert.notEqual(puts.at(-1).id,oldId);
    await page.getByRole("status").filter({hasText:"completion alone"}).waitFor();
    checks.push("Corrected-file action creates a new session; lost terminal response succeeds only after authenticated complete status");
    await open();
    const capPath=outputDir+"/oversize-native.csv",capFile=await openFile(capPath,"w");
    await capFile.truncate(64*1024*1024+1);await capFile.close();
    try {await file.setInputFiles(capPath);await error("at most 64 MiB");}
    finally {await unlink(capPath);}
    checks.push("CSV 64 MiB cap rejected before creating any session");
    assert.equal(pageErrors.length,0,pageErrors.join("\n"));
    return {checks,pageErrors,nativeCsvBytes:bytes.length,scope:"Actual frontend/native Files with exclusively mocked APIs; no real source import"};
  } finally {await context.close();}
}
