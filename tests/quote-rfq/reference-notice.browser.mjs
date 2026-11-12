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
  const animation = () => id("notice-track").evaluate(e => {
    const s = getComputedStyle(e);
    return { name: s.animationName, duration: s.animationDuration, timing: s.animationTimingFunction,
      state: s.animationPlayState, transform: s.transform };
  });
  try {
    await page.clock.install();
    await page.goto(baseURL + "/products", { waitUntil: "domcontentloaded" });
    await id("reference-notice").waitFor();
    assert.equal(await id("notice-full").getAttribute("open"), null);
    await id("input-search").focus(); await page.mouse.move(0, 0);
    const start = await animation();
    assert.equal(start.name, "reference-marquee"); assert.equal(start.timing, "linear");
    assert.equal(start.duration, "65s"); assert.equal(start.state, "running");
    await page.waitForFunction(previous => getComputedStyle(document.querySelector('[data-testid="notice-track"]')).transform !== previous, start.transform);
    const widths = await id("notice-track").locator(".reference-group").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
    assert.equal(widths.length, 2); assert.ok(Math.abs(widths[0] - widths[1]) < 1);
    assert.equal(await id("notice-track").locator('[aria-hidden="true"]').count(), 1);
    await id("notice-full").locator("summary").press("Enter");
    assert.equal(await id("notice-full").getAttribute("open"), "");
    assert.match(await id("notice-full").innerText(), /independent seller/);
    await id("notice-full").locator("summary").press("Enter");
    checks.push("Continuous linear horizontal ticker, equal seamless groups, aria-hidden duplicate and keyboard full disclaimer");
    await id("reference-notice").hover();
    assert.equal((await animation()).state, "paused");
    await page.mouse.move(0, 0); await id("notice-play").focus();
    assert.equal((await animation()).state, "paused");
    await id("notice-play").press("Enter"); await id("input-search").focus(); await page.mouse.move(0, 0);
    assert.equal((await animation()).state, "paused");
    await id("notice-play").press("Space"); await id("input-search").focus(); await page.mouse.move(0, 0);
    assert.equal((await animation()).state, "running");
    checks.push("Hover/focus pause and keyboard Pause/Play");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal((await animation()).name, "none");
    assert.equal(await id("notice-play").isVisible(), false);
    assert.equal(await id("notice-track").locator('[aria-hidden="true"]').isVisible(), false);
    assert.equal(await id("notice-track").locator(".reference-statement").first().evaluate(e => getComputedStyle(e).whiteSpace), "normal");
    checks.push("Reduced-motion static wrapped text and hidden duplicate");
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
    assert.match(await id("notice-track").innerText(), /independent seller/);
    await id("notice-play").press("Enter");
    assert.equal(await id("reference-notice").getAttribute("data-paused"), "true");
    await id("notice-full").locator("summary").press("Enter");
    assert.match(await id("notice-full").innerText(), /identification and reference only/);
    await id("notice-full").locator("summary").press("Enter");
    assert.equal((await page.locator("body").innerText()).includes("OEM Verified"), false);
    assert.match(await id("product-part-number").innerText(), /OEM reference #\s*REF771/);
    await id("qty-inc").click(); await id("button-add-cart").click();
    assert.equal(await id("qty-input").inputValue(), "2");
    await page.getByText("Added to cart", { exact: true }).waitFor();
    checks.push("Product ticker keyboard controls, reference identifiers, quantity and Add to Cart");
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
