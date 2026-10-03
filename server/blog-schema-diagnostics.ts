import type { ZodIssue } from "zod";

// Deliberately retain only validator metadata, NEVER values, messages, source URLs,
// unknown property names, prompts or provider bodies. Safe for admin status/logs.
const fields = new Set(["title", "excerpt", "content", "metaTitle", "metaDescription",
  "claims", "claim", "sourceUrl", "evidenceQuote", "productSlugs", "improvementSummary", "followUpTopics"]);
const rules = new Set(["invalid_type", "too_small", "too_big", "invalid_string", "unrecognized_keys"]);
export type SchemaDiagnostic = {
  field: string; rule: string; receivedType: string; actualLength?: number;
  minimum?: number; maximum?: number; extraFieldCount?: number;
};
export function summarizeSchemaIssues(input: unknown, issues: ZodIssue[]): SchemaDiagnostic[] {
  return issues.slice(0, 12).map(issue => {
    let value: any = input;
    for (const part of issue.path) {
      if ((typeof part === "string" && !fields.has(part)) || value === null || typeof value !== "object" ||
          !Object.prototype.hasOwnProperty.call(value, part)) { value = undefined; break; }
      value = value[part];
    }
    const detail = issue as any;
    return {
      field: issue.path.map(p => typeof p === "number" ? `[${p}]` : fields.has(p) ? p : "$unknown").join(".") || "$",
      rule: rules.has(issue.code) ? issue.code : "invalid",
      receivedType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      ...(typeof value === "string" || Array.isArray(value) ? { actualLength: value.length } : {}),
      ...(typeof detail.minimum === "number" ? { minimum: detail.minimum } : {}),
      ...(typeof detail.maximum === "number" ? { maximum: detail.maximum } : {}),
      ...(issue.code === "unrecognized_keys" ? { extraFieldCount: issue.keys.length } : {}),
    };
  });
}
export class ArticleSchemaValidationError extends Error {
  readonly diagnostics: SchemaDiagnostic[];
  constructor(input: unknown, issues: ZodIssue[]) {
    super("ARTICLE_SCHEMA_INVALID");
    this.name = "ArticleSchemaValidationError";
    this.diagnostics = summarizeSchemaIssues(input, issues);
  }
}
export function schemaDiagnosticSummary(issues: SchemaDiagnostic[]): string {
  return issues.map(i => `${i.field}: ${i.rule} (${i.receivedType}${i.actualLength === undefined ? "" : ` length/count ${i.actualLength}`}${i.minimum === undefined ? "" : `, minimum ${i.minimum}`}${i.maximum === undefined ? "" : `, maximum ${i.maximum}`}${i.extraFieldCount === undefined ? "" : `, extra field count ${i.extraFieldCount}`})`).join("; ");
}
