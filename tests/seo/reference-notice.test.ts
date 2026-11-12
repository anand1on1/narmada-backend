import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ReferenceNotice } from "../../client/src/components/ReferenceNotice";
import { REFERENCE_NOTICES, renderReferenceNotice } from "../../shared/reference-notice";
import { renderProductPage } from "../../server/seo-templates";

describe("Shared price and part-reference disclaimer", () => {
  it("provides all three faithful statements in React and no-JS SSR, expanded by default", () => {
    const client = renderToStaticMarkup(createElement(ReferenceNotice));
    const server = renderReferenceNotice();
    expect(REFERENCE_NOTICES).toHaveLength(3);
    for (const statement of REFERENCE_NOTICES) {
      expect(client).toContain(statement);
      expect(server).toContain(statement);
    }
    expect(client).toContain("<details open");
    expect(server).toContain("<details open");
    expect(server).not.toContain("<script");
    expect(client).toContain('aria-label="Previous reference notice"');
    expect(client).toContain('aria-label="Next reference notice"');
    expect(client).toContain('aria-label="Pause notice rotation"');
  });
  it("product SSR includes the complete disclaimer without changing displayed price or identifiers", () => {
    const html = renderProductPage({ id: 1, slug: "qa-part", name: "QA Part", brand: "tata", model: "", category: "filters",
      partNumber: "000771", oemNumber: "REF771", description: "Test", shortDescription: "", priceInr: 125,
      stockQty: 2, imageUrls: "[]", compatibleModels: "[]" }, [], { baseUrl: "https://narmadamobility.com" });
    for (const statement of REFERENCE_NOTICES) expect(html).toContain(statement);
    expect(html).toContain("000771"); expect(html).toContain("REF771");
    expect(html).toContain('price">'); expect(html).toContain('"price":"125.00"');
    expect(html).toContain("OEM reference number");
  });
  it("both existing page components reuse the notice, preserving search/cart controls", () => {
    const catalog = readFileSync("client/src/pages/ProductsPage.tsx", "utf8");
    const product = readFileSync("client/src/pages/ProductDetailPage.tsx", "utf8");
    for (const text of [catalog, product]) expect(text).toContain("<ReferenceNotice />");
    expect(catalog).toContain('data-testid="input-search"');
    expect(product).toContain('data-testid="button-add-cart"');
    expect(product).toContain("Confirm fitment");
    expect(product).not.toContain("OEM Verified");
    expect(readFileSync("server/public-catalog.ts","utf8")).toContain("${renderReferenceNotice()}");
  });
});
