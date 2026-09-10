// R28 Session 4 — SEO template unit tests (no HTTP, no DB).
// Verifies the raw HTML emitted by renderProductPage / renderChassisPage /
// renderCategoryPage carries every SEO tag the spec requires, is mobile-first
// (viewport meta), never surfaces purchase_price, and shows the verbatim image
// disclaimer when image_source is placeholder or generated.

import { describe, it, expect } from "vitest";
import {
  renderProductPage,
  renderChassisPage,
  renderCategoryPage,
  renderNotFoundPage,
  isBotUA,
  BOT_UA_PATTERNS,
  type SeoConfig,
  type SeoProduct,
  type SeoChassis,
  type SeoChassisPart,
} from "../../server/seo-templates";

const CFG: SeoConfig = {
  baseUrl: "https://narmadamobility.com",
  siteName: "Narmada Mobility",
  whatsappNumber: "917909083806",
  spaBase: "https://narmadamobility.com",
};

function baseProduct(overrides: Partial<SeoProduct> = {}): SeoProduct {
  return {
    id: 42,
    slug: "tata-clutch-plate-clp-9001",
    name: "Tata Clutch Plate CLP-9001",
    brand: "tata",
    model: "TATA 1109 LPT",
    category: "clutch",
    partNumber: "CLP-9001",
    oemNumber: "OEM-77-XYZ",
    description: "Heavy-duty ceramic clutch plate for TATA 1109 LPT BS6. Direct fit, OE-grade.",
    shortDescription: "Ceramic clutch plate — direct fit.",
    priceInr: 3499.5,
    stockQty: 12,
    imageUrls: ["/uploads/products/clp9001.jpg"],
    compatibleModels: ["TATA 1109 LPT", "TATA 1109g"],
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    imageSource: null,
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("R28.4 seo-templates: renderProductPage", () => {
  it("emits doctype, viewport, and canonical /p/{slug}", () => {
    const html = renderProductPage(baseProduct(), [], CFG);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('rel="canonical" href="https://narmadamobility.com/p/tata-clutch-plate-clp-9001"');
  });

  it("emits OG, Twitter, and Product + Breadcrumb JSON-LD", () => {
    const html = renderProductPage(baseProduct(), [], CFG);
    expect(html).toContain('property="og:type" content="product"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    // Offer in INR
    expect(html).toContain('"priceCurrency":"INR"');
    expect(html).toContain('"price":"3499.50"');
    // SKU falls back to part_number
    expect(html).toContain('"sku":"CLP-9001"');
  });

  it("includes SPA alternate hash-route link back to the app", () => {
    const html = renderProductPage(baseProduct(), [], CFG);
    expect(html).toContain('rel="alternate" href="https://narmadamobility.com/#/product/CLP-9001/tata-clutch-plate-clp-9001"');
  });

  it("renders the mobile-first inline critical CSS", () => {
    const html = renderProductPage(baseProduct(), [], CFG);
    expect(html).toContain("<style>");
    expect(html).toMatch(/@media \(min-width:720px\)/);
    // No external stylesheet
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it("NEVER surfaces purchase_price", () => {
    const html = renderProductPage(baseProduct({ description: "internal cost note ignored" }), [], CFG);
    expect(html.toLowerCase()).not.toContain("purchase_price");
    expect(html.toLowerCase()).not.toContain("purchase price");
  });

  it("shows verbatim image disclaimer when image_source=placeholder", () => {
    const html = renderProductPage(baseProduct({ imageSource: "placeholder" }), [], CFG);
    expect(html).toContain("* Image is for representation purpose only");
  });

  it("shows verbatim image disclaimer when image_source=generated", () => {
    const html = renderProductPage(baseProduct({ imageSource: "generated" }), [], CFG);
    expect(html).toContain("* Image is for representation purpose only");
  });

  it("does NOT show disclaimer when image_source is null / manual / reused", () => {
    for (const src of [null, "manual-upload", "reused"]) {
      const html = renderProductPage(baseProduct({ imageSource: src as any }), [], CFG);
      expect(html).not.toContain("* Image is for representation purpose only");
    }
  });

  it("renders related products (4 max) with links to /p/{slug}", () => {
    const related = [
      baseProduct({ id: 1, slug: "brake-shoe-1", name: "Brake Shoe 1", partNumber: "BS-1" }),
      baseProduct({ id: 2, slug: "brake-shoe-2", name: "Brake Shoe 2", partNumber: "BS-2" }),
    ];
    const html = renderProductPage(baseProduct(), related, CFG);
    expect(html).toContain('href="https://narmadamobility.com/p/brake-shoe-1"');
    expect(html).toContain('href="https://narmadamobility.com/p/brake-shoe-2"');
  });

  it("has a WhatsApp CTA linking to wa.me with the shared number", () => {
    const html = renderProductPage(baseProduct(), [], CFG);
    expect(html).toContain("https://wa.me/917909083806");
    // rel=nofollow noopener for outbound
    expect(html).toContain('rel="nofollow noopener"');
  });

  it("escapes HTML in product fields (no XSS)", () => {
    const html = renderProductPage(baseProduct({ name: `<script>alert(1)</script>Malicious` }), [], CFG);
    expect(html).not.toContain("<script>alert(1)</script>Malicious");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("R28.4 seo-templates: renderChassisPage", () => {
  const chassis: SeoChassis = {
    id: 7,
    slug: "tata-407-ex2-bs6",
    chassisCode: "TATA-407-EX2",
    chassisDisplayName: "Tata 407 EX2 BS6",
    make: "TATA",
    model: "407 EX2",
    variant: "BS6",
    coverImageUrl: null,
    description: "Verified spare parts for the Tata 407 EX2 BS6 chassis.",
  };
  const parts: SeoChassisPart[] = [
    { id: 1, partNumber: "PN-100", description: "Cross joint", category: "transmission", sellPrice: 1200, productSlug: "cross-joint-pn-100" },
    { id: 2, partNumber: "PN-101", description: "Brake shoe kit", category: "brake", sellPrice: 3400, productSlug: null },
  ];

  it("emits canonical /c/{slug} + Breadcrumb + ItemList JSON-LD", () => {
    const html = renderChassisPage(chassis, parts, CFG);
    expect(html).toContain('rel="canonical" href="https://narmadamobility.com/c/tata-407-ex2-bs6"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"ItemList"');
  });

  it("links published parts to /p/{slug} and does NOT link unpublished parts", () => {
    const html = renderChassisPage(chassis, parts, CFG);
    expect(html).toContain('href="https://narmadamobility.com/p/cross-joint-pn-100"');
    // Second part has no productSlug -> no /p/ link
    expect(html.match(/href="https:\/\/narmadamobility\.com\/p\//g)?.length).toBe(1);
  });

  it("never surfaces purchase_price", () => {
    const html = renderChassisPage(chassis, parts, CFG);
    expect(html.toLowerCase()).not.toContain("purchase_price");
  });
});

describe("R28.4 seo-templates: renderCategoryPage", () => {
  it("emits canonical /cat/{category} + ItemList JSON-LD and grid", () => {
    const products = [baseProduct(), baseProduct({ id: 43, slug: "another", name: "Another" })];
    const html = renderCategoryPage("clutch", products, CFG);
    expect(html).toContain('rel="canonical" href="https://narmadamobility.com/cat/clutch"');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('href="https://narmadamobility.com/p/tata-clutch-plate-clp-9001"');
    expect(html).toContain('href="https://narmadamobility.com/p/another"');
  });
});

describe("R28.4 seo-templates: renderNotFoundPage", () => {
  it("returns HTML with noindex,follow robots meta", () => {
    const html = renderNotFoundPage(CFG, "product", "does-not-exist");
    expect(html).toContain('name="robots" content="noindex,follow"');
    expect(html).toContain("Page not found");
  });
});

describe("R28.4 seo-templates: isBotUA", () => {
  it("matches every bot pattern from the spec", () => {
    for (const p of BOT_UA_PATTERNS) {
      expect(isBotUA(`Mozilla/5.0 (compatible; ${p}/2.1; +http://example.com)`)).toBe(true);
    }
  });
  it("returns false for regular browsers", () => {
    expect(isBotUA("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605")).toBe(false);
    expect(isBotUA("")).toBe(false);
    expect(isBotUA(undefined)).toBe(false);
  });
});
