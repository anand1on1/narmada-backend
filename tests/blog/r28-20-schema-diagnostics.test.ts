import { describe, expect, it } from "vitest";
import { articleDraftSchema } from "../../shared/auto-blogger";
import { BLOG_POLICY } from "../../server/auto-blogger-providers";
import { ArticleSchemaValidationError, summarizeSchemaIssues } from "../../server/blog-schema-diagnostics";

const valid = () => ({
  title: "Commercial vehicle parts procurement checklist",
  excerpt: "A procurement checklist for identifying component references and confirming requirements.",
  content: "<p>" + "Public article fixture. ".repeat(90) + "</p>",
  metaTitle: "Commercial vehicle parts procurement",
  metaDescription: "Prepare a clear component enquiry with the relevant vehicle reference and ask the team to confirm fitment and availability.",
  claims: Array.from({ length: 2 }, () => ({ claim: "A claim with sufficient length.", sourceUrl: "https://www.tatamotors.com/technical",
    evidenceQuote: "Manufacturer source excerpt with sufficient detail." })),
  productSlugs: [], improvementSummary: "", followUpTopics: [],
});
function diagnostic(input: unknown) {
  const result = articleDraftSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected invalid fixture");
  return new ArticleSchemaValidationError(input, result.error.issues);
}
describe("R28.20 exact generation contract and safe validation metadata", () => {
  it("makes the formerly omitted limits and strict shape explicit without relaxing the schema", () => {
    expect(BLOG_POLICY).toContain("NO extra keys at any level");
    expect(BLOG_POLICY).toContain("1500–35000 characters");
    expect(BLOG_POLICY).toContain("claims: 2–15 objects");
    expect(BLOG_POLICY).toContain("15–700 characters");
    expect(BLOG_POLICY).toContain("30–1200 characters");
    expect(BLOG_POLICY).toContain("0–5 supplied slug strings");
    expect(BLOG_POLICY).toContain("0–600 characters");
    expect(articleDraftSchema.safeParse(valid()).success).toBe(true);
    expect(diagnostic({ ...valid(), claims: Array.from({ length: 16 }, () => valid().claims[0]) }).diagnostics)
      .toContainEqual(expect.objectContaining({ field: "claims", rule: "too_big", actualLength: 16, maximum: 15 }));
  });
  it("distinguishes known schema fields/types/bounds without disclosing any supplied values or keys", () => {
    const input = { ...valid(), excerpt: null, metaTitle: "secret-label".repeat(20), claims: [{ claim: "short",
      sourceUrl: "SECRET_PRIVATE_URL", evidenceQuote: "quote" }],
      PRIVATE_CUSTOMER_NAME: "private@example.com", secretKey: "credential-value" };
    const error = diagnostic(input), serialized = JSON.stringify(error.diagnostics);
    expect(error.message).toBe("ARTICLE_SCHEMA_INVALID");
    expect(error.diagnostics).toContainEqual(expect.objectContaining({ field: "excerpt", rule: "invalid_type", receivedType: "null" }));
    expect(error.diagnostics).toContainEqual(expect.objectContaining({ field: "metaTitle", maximum: 65 }));
    expect(error.diagnostics).toContainEqual(expect.objectContaining({ field: "claims.[0].sourceUrl", rule: "invalid_string" }));
    expect(error.diagnostics).toContainEqual(expect.objectContaining({ extraFieldCount: 2 }));
    expect(serialized).not.toMatch(/secret-label|SECRET_PRIVATE_URL|PRIVATE_CUSTOMER|private@example|credential-value|secretKey/);
  });
  it("caps diagnostic size and never echoes unexpected issue paths or custom messages", () => {
    const issues = Array.from({ length: 40 }, () => ({ code: "custom" as const, path: ["PRIVATE_KEY"], message: "secret response" }));
    const result = summarizeSchemaIssues({ PRIVATE_KEY: "secret input" }, issues);
    expect(result).toHaveLength(12);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY|secret|response|input/);
    expect(result[0]).toMatchObject({ field: "$unknown", rule: "invalid", receivedType: "undefined" });
  });
  it("does not coerce, truncate or silently accept nulls, extra wrappers or out-of-range evidence", () => {
    for (const input of [{ ...valid(), productSlugs: null }, { article: valid() }, { ...valid(), skip: false },
      { ...valid(), improvementSummary: "x".repeat(601) },
      { ...valid(), claims: [{ ...valid().claims[0], evidenceQuote: "x".repeat(1201) }, valid().claims[1]] }]) {
      expect(() => diagnostic(input)).not.toThrow();
      expect(articleDraftSchema.safeParse(input).success).toBe(false);
    }
  });
});
