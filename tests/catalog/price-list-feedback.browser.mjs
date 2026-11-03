// Offline UI QA against the real frontend, with all network requests intercepted.
// Backend validation/retention is covered by private-price-metadata.test.ts.
// Pass an existing Playwright Browser; no browser/dependency download is needed.
const { default: assert } = await import("node:assert/strict");
const { createRequire } = await import("node:module");
const { mkdir } = await import("node:fs/promises");
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

export async function runPriceListFeedbackQa(browser, { baseURL, outputDir }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(), errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  let lists = [
    { id: 9, brand: "tata", versionLabel: "v2", itemCount: 185294, uploadedAt: 1793673000000 },
    { id: 12, brand: "volvo", versionLabel: "unused", itemCount: 1, uploadedAt: 1793673000000 },
  ];
  const uploads = new Map(), received = [];
  let chunkFailure = "", holdChunk = false, releaseChunk;
  const retained = "This price list is retained for catalog provenance and audit and cannot be deleted. Upload a replacement price list for the same brand; you do not need to delete the old list.";
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname === "/config.js") return route.fulfill({ contentType: "text/javascript", body: "window.__API_BASE__=window.location.origin;" });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === "/api/admin/me") return send({ username: "Offline QA", role: "admin" });
    if (url.pathname === "/api/admin/catalog-sync") return send({ enabled: false, fx: null, jobs: [] });
    if (url.pathname === "/api/admin/price-lists") return send(lists);
    if (req.method() === "DELETE") {
      if (url.pathname.endsWith("/9")) return send({ code: "PRICE_LIST_RETAINED", error: retained }, 409);
      lists = lists.filter(list => list.id !== 12);
      return send({ ok: true });
    }
    if (url.pathname.endsWith("/template.csv")) return route.fulfill({ contentType: "text/csv", body: "part_number,mrp\n001,835\n" });
    if (url.pathname.endsWith("/uploads")) {
      const body = req.postDataJSON();
      if (!uploads.has(body.requestKey)) uploads.set(body.requestKey, { id: uploads.size + 1 });
      return send(uploads.get(body.requestKey));
    }
    if (url.pathname.endsWith("/chunks")) {
      received.push(req.postDataJSON());
      if (holdChunk) await new Promise(resolve => { releaseChunk = resolve; });
      if (chunkFailure) return send({ error: chunkFailure }, 400);
      return send({ rows: req.postDataJSON().rows.length });
    }
    if (url.pathname.endsWith("/finish")) return send({ rows: 2, job: null });
    return send([]);
  });
  await context.addInitScript(() => {
    localStorage.setItem("narmada_admin_token", "fixture");
    localStorage.setItem("narmada_admin_role", "admin");
  });
  const dialog = page.getByRole("dialog");
  const save = page.getByTestId("button-upload-list-save");
  const paste = page.getByTestId("input-csv-text");
  const file = page.getByTestId("input-csv-file");
  const alertText = async text => {
    await dialog.getByRole("alert").filter({ hasText: text }).waitFor({ state: "visible" });
    const box = await dialog.getByRole("alert").boundingBox();
    assert(box && box.x >= 0 && box.y >= 0 && box.y + box.height <= page.viewportSize().height, "Error must be visible inside viewport");
  };
  const open = async () => { await page.getByTestId("button-upload-list").click(); await dialog.waitFor(); };
  const uploadFile = async (name, buffer) => {
    await file.setInputFiles({ name, mimeType: name.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", buffer });
    await page.waitForFunction(() => !document.querySelector('[data-testid="button-upload-list-save"]')?.disabled);
  };
  try {
    await page.goto(`${baseURL}/admin/price-lists`);
    await page.getByTestId("button-delete-list-9").click();
    await page.getByRole("alert").filter({ hasText: retained }).waitFor();
    assert(await page.getByTestId("row-list-9").isVisible());
    checks.push("Protected deletion displays actionable 409 and retains row");
    await page.getByTestId("button-delete-list-12").click();
    await page.getByTestId("row-list-12").waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert").count(), 0);
    checks.push("Permitted deletion refreshes list and clears old error");
    await open();
    await save.click(); await alertText("Pick a brand");
    await page.getByTestId("select-brand").selectOption("tata");
    await save.click(); await alertText("Paste CSV or choose");
    await paste.fill("part_number,mrp\nSTALE,835");
    await uploadFile("too-big.csv", Buffer.alloc(8 * 1024 * 1024 + 1, 32));
    await alertText("under 8 MB"); assert.equal(await paste.inputValue(), "");
    assert.equal(uploads.size, 0);
    checks.push("Oversized file error visible; stale pasted CSV cleared; no API upload");
    await paste.fill("description,mrp\nMissing part,835"); await save.click();
    await alertText("Required columns: part_number and mrp");
    const longCsv = Buffer.from("part_number,mrp\n" + "ROW,835\n".repeat(50001));
    await uploadFile("too-many.csv", longCsv); await save.click();
    await alertText("at most 50,000 rows"); assert.equal(uploads.size, 0);
    checks.push("Missing headers and 50,001 data rows rejected before API call");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["part_number", "mrp", "dealer_price", "gst_percent"],
      ["000123-A", 835, 600, "18%"], ["000456-B", 1670, 0, 0],
    ]), "First worksheet");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["ignored"]]), "Ignored worksheet");
    const excel = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        if (this.name === "parse-lock.xlsx") await new Promise(resolve => { window.__releasePriceListRead = resolve; });
        return original.call(this);
      };
    });
    await file.setInputFiles({ name: "parse-lock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: excel });
    assert(await save.isDisabled());
    assert(await file.isDisabled());
    assert(await page.getByTestId("button-upload-list").isDisabled());
    assert(await dialog.getByRole("button", { name: "Close", exact: true }).isDisabled());
    await dialog.getByRole("status").filter({ hasText: "Reading parse-lock.xlsx" }).waitFor();
    await page.evaluate(() => window.__releasePriceListRead());
    await page.waitForFunction(() => !document.querySelector('[data-testid="button-upload-list-save"]')?.disabled);
    checks.push("File parsing displays reading status and prevents submission/close/input races");
    chunkFailure = "Invalid dealer_price";
    await uploadFile("valid-native.xlsx", excel); await save.click();
    await alertText(chunkFailure);
    checks.push("HTTP 400 private metadata error visible in open dialog");
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: `${outputDir}/upload-error-desktop.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await alertText(chunkFailure);
    assert(await save.isVisible());
    await page.screenshot({ path: `${outputDir}/upload-error-mobile.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push("Error and retry controls visible at desktop and 375px; no page overflow");
    chunkFailure = "Invalid gst_percent";
    await save.click(); await alertText(chunkFailure);
    chunkFailure = ""; holdChunk = true;
    const response = page.waitForRequest(req => req.url().endsWith("/chunks"));
    await save.click(); await response;
    assert(await save.isDisabled());
    assert(await file.isDisabled());
    assert(await dialog.getByRole("button", { name: "Close", exact: true }).isDisabled());
    assert(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled());
    assert(await paste.isDisabled());
    assert(await page.getByTestId("select-brand").isDisabled());
    assert(releaseChunk, "Chunk request reached deliberate offline hold");
    holdChunk = false; releaseChunk();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("status").filter({ hasText: "2 rows received" }).waitFor();
    assert.equal(uploads.size, 1);
    assert.equal(JSON.stringify(received.at(-1).rows.map(row => row.partNumber)), JSON.stringify(["000123-A", "000456-B"]));
    assert.equal(received.at(-1).rows[1].dealerPrice, "0");
    checks.push("Native Excel first worksheet/text IDs/private zero fields retained; upload lock and same-file retry key stable");
    await open();
    assert.equal(await dialog.getByRole("alert").count(), 0);
    assert.equal(await dialog.getByRole("status").count(), 0);
    await page.getByTestId("select-brand").selectOption("tata");
    await uploadFile("valid-native.xlsx", excel); await save.click();
    await dialog.waitFor({ state: "detached" }); assert.equal(uploads.size, 1);
    checks.push("Fresh dialog clears state; identical completed-file retry reuses upload key");
    await page.setViewportSize({ width: 1280, height: 900 });
    const download = page.waitForEvent("download");
    await page.getByTestId("button-download-template").click();
    assert.equal((await download).suggestedFilename(), "narmada-price-list-template.csv");
    checks.push("CSV template download still works");
    assert.equal(errors.length, 0, errors.join("\n"));
    return { checks, pageErrors: errors, scope: "Actual frontend with offline mocked API; live production not accessed" };
  } finally { await context.close(); }
}
