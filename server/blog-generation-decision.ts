import { z } from "zod";

export type GenerationOperation = "new" | "improve";
const reasons = ["INSUFFICIENT_RELEVANT_EVIDENCE", "POLICY_CONSTRAINT", "NO_SUPPORTED_IMPROVEMENT", "UNSPECIFIED"] as const;
const abstention = z.object({
  skip: z.literal(true),
  reasonCode: z.enum(reasons).default("UNSPECIFIED"),
}).strict();
export type GenerationDecisionDiagnostic = {
  stage: "generate"; operation: GenerationOperation; decision: "abstained" | "invalid";
  reasonCode?: typeof reasons[number];
  rule?: "INVALID_ABSTENTION_SHAPE" | "REASON_OPERATION_MISMATCH";
};
export class GenerationDecisionError extends Error {
  constructor(readonly diagnostics: GenerationDecisionDiagnostic, readonly tokens: number) {
    super(diagnostics.decision === "abstained" ? "GENERATION_ABSTAINED" : "GENERATION_DECISION_INVALID");
    this.name = "GenerationDecisionError";
  }
}
export function checkGenerationDecision(data: unknown, operation: GenerationOperation, tokens: number): void {
  // Article output continues through the existing strict article validators.
  // A decision-bearing object must match the abstention shape exactly; never
  // coerce false/string/number values or discard decision keys from an article.
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (!Object.hasOwn(data, "skip") && !Object.hasOwn(data, "reasonCode"))) return;
  const parsed = abstention.safeParse(data);
  if (!parsed.success) throw new GenerationDecisionError({
    stage: "generate", operation, decision: "invalid", rule: "INVALID_ABSTENTION_SHAPE",
  }, tokens);
  if (operation === "new" && parsed.data.reasonCode === "NO_SUPPORTED_IMPROVEMENT")
    throw new GenerationDecisionError({
      stage: "generate", operation, decision: "invalid", rule: "REASON_OPERATION_MISMATCH",
    }, tokens);
  throw new GenerationDecisionError({
    stage: "generate", operation, decision: "abstained", reasonCode: parsed.data.reasonCode,
  }, tokens);
}
export function generationContract(operation: GenerationOperation): string {
  const task = operation === "new"
    ? `Operation: NEW_ARTICLE (including manual drafts). Create a new article; no previous article or substantive change is required.
improvementSummary must be an empty string. Judge whether the supplied evidence supports a useful NEW article, not an improvement.`
    : `Operation: IMPROVE_ARTICLE. Improve the supplied previousArticle only with a substantive supported addition or correction.
improvementSummary must describe that change. If no supported improvement is possible, abstain with NO_SUPPORTED_IMPROVEMENT.`;
  return `${task}
Return either the complete article object under the common article schema (with no skip/reasonCode keys), OR exactly
{"skip":true,"reasonCode":"<allowed code>"} when you cannot safely complete this operation.
Allowed reasonCode values: ${reasons.filter(r => operation === "improve" || r !== "NO_SUPPORTED_IMPROVEMENT").join(", ")}.
Use UNSPECIFIED if no more specific code applies. No free-text reasons, extra keys, skip:false or string booleans.
Never invent claims, weaken evidence, or evade safety rules to avoid abstaining.`;
}
