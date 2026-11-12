const assert = (await import("node:assert/strict")).default;
const { mkdir, writeFile } = await import("node:fs/promises");
const { join } = await import("node:path");

/** Offline regression runner. Caller supplies installed Playwright browser. */
export async function runReferenceNoticeQa(browser, { baseURL, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const product = { id: 771, slug: "qa-filter", name: "QA Filter", brand: "tata", model: "Test",
    category: "filters", partNumber: "000771", oemNumber: "REF771", description: "Offline fixture filter",
    shortDescription: "Offline fixture", priceInr: 125, stockQty: 3, imageUrls: "[]", compatibleModels: "[]", active: true };
  const errors = [], checks = [];
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/quote/indent/parse") return route.fulfill({ status: 200, contentType: "text/html",
      body: "<!doctype html><html><body>Old backend SPA</body></html>" });
    const value = path === "/api/products" ? { products: [product], total: 1, pages: 1 } :
      path.startsWith("/api/products/") ? product : path === "/api/settings/fx" ? { usdInr: 83.5 } :
      path === "/api/quote/otp/send" ? { ok: true } :
      path === "/api/quote/otp/verify" ? { verification_token: "offline-test-token" } : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  const id = name => page.getByTestId(name);
  const position = () => id("notice-position").innerText();
  try {
    await page.clock.install();
    await page.goto(baseURL + "/products", { waitUntil: "domcontentloaded" });
    await id("reference-notice").waitFor();
    assert.equal(await id("notice-full").getAttribute("open"), "");
    await id("notice-next").click(); assert.match(await position(), /2 of 3/);
    await id("notice-next").press("Enter"); assert.match(await position(), /3 of 3/);
    await id("notice-prev").press("Space"); assert.match(await position(), /2 of 3/);
    checks.push("Catalog keyboard Previous/Next and expanded full disclaimer");
    await id("notice-play").click();
    await id("input-search").focus(); await page.mouse.move(0, 0);
    const start = await position(); await page.clock.runFor(8100); assert.notEqual(await position(), start);
    await id("reference-notice").hover();
    const hover = await position(); await page.clock.runFor(9000); assert.equal(await position(), hover);
    await page.mouse.move(0, 0); await id("notice-next").focus();
    const focus = await position(); await page.clock.runFor(9000); assert.equal(await position(), focus);
    await id("notice-play").click(); await id("input-search").focus(); await page.mouse.move(0, 0);
    const paused = await position(); await page.clock.runFor(9000); assert.equal(await position(), paused);
    checks.push("Autoplay, hover/focus pause and explicit pause/play");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Automatic rotation disabled by reduced-motion preference" }).waitFor();
    const reduced = await position(); await page.clock.runFor(17000); assert.equal(await position(), reduced);
    await id("notice-next").click(); assert.notEqual(await position(), reduced);
    checks.push("Reduced-motion no autoplay; manual navigation remains usable");
    await id("input-search").fill("filter"); await page.clock.runFor(400);
    await id("products-count").waitFor(); assert.match(await id("products-count").innerText(), /1 PRODUCT FOUND/i);
    checks.push("Catalog search and result count retained");
    await id("reference-notice").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "catalog-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("body").evaluate(e => e.scrollWidth > innerWidth), false);
    await id("reference-notice").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "catalog-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(baseURL + "/product/000771/qa-filter", { waitUntil: "domcontentloaded" });
    await id("reference-notice").waitFor();
    await id("notice-next").click(); await id("notice-next").press("Enter");
    assert.match(await position(), /3 of 3/);
    assert.match(await id("notice-slide").innerText(), /independent seller/);
    assert.equal((await page.locator("body").innerText()).includes("OEM Verified"), false);
    assert.match(await id("product-part-number").innerText(), /OEM reference #\s*REF771/);
    await id("qty-inc").click(); await id("button-add-cart").click();
    assert.equal(await id("qty-input").inputValue(), "2");
    await page.getByText("Added to cart", { exact: true }).waitFor();
    checks.push("Product keyboard controls, reference identifiers, quantity and Add to Cart");
    await page.clock.runFor(5000);
    await id("reference-notice").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "product-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("body").evaluate(e => e.scrollWidth > innerWidth), false);
    await id("reference-notice").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outputDir, "product-mobile.png") });
    checks.push("Both pages desktop and 390px mobile without horizontal overflow");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(baseURL + "/get-quote", { waitUntil: "domcontentloaded" });
    for (const [key, value] of Object.entries({ company_name: "Offline QA", contact_name: "Test Contact",
      mobile: "9876543210", email: "qa@example.test" })) await id("quote-" + key).fill(value);
    await id("quote-send-otp").click(); await id("quote-otp").fill("123456");
    await id("quote-verify").click(); await id("quote-next").click();
    await id("quote-manual-mode").click(); await id("quote-part-0").fill("000771");
    await id("quote-name-0").fill("Retained seal"); await id("quote-qty-0").fill("2");
    await id("quote-upload-mode").click();
    await id("quote-file").setInputFiles({ name: "indent.png", mimeType: "image/png", buffer: Buffer.from("offline fixture") });
    await id("quote-consent").check(); await id("quote-parse").click();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /matching backend can be deployed/);
    assert.match(await page.getByRole("alert").innerText(), /Re-uploading the file will not fix/);
    assert.equal(await id("quote-part-0").inputValue(), "000771"); assert.equal(await id("quote-qty-0").inputValue(), "2");
    await id("quote-manual-mode").click(); assert.equal(await id("quote-review").isDisabled(), false);
    await page.screenshot({ path: join(outputDir, "upload-version-mismatch.png") });
    checks.push("HTTP200 HTML upload mismatch gives actionable error, retains draft and manual fallback");
    assert.deepEqual(errors, []);
    const receipt = { baseURL, mode: "Offline API fixtures; no live email, AI or production writes", checks, pageErrors: errors };
    await writeFile(join(outputDir, "browser-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } finally { await context.close(); }
}
