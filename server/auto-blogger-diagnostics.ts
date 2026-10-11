import { safeBlogCode as sharedCode, blogAction as sharedAction } from "../shared/blog-diagnostics";

// Keep new backend diagnostics out of client-imported modules: the existing
// GoDaddy frontend already renders each job's server-provided nextAction.
const actions: Record<string, string> = {
  GENERATION_ABSTAINED: "The generator declined to draft from the supplied evidence for this operation. Article validation and independent review were not run. Its reported reason is a model decision, not a verified diagnosis; no blind retry or publication was performed.",
  GENERATION_DECISION_INVALID: "The generator returned an invalid abstention shape or an operation-incompatible reason. Nothing was published; no truthiness coercion or blind retry was applied.",
  PROVIDER_TIMEOUT: "The provider request or response body exceeded its timeout. Bounded retries apply; no partial output is published.",
  UNSUPPORTED_COMMERCIAL_CLAIM: "A conservative commercial phrase rule blocked the article. This alone does not establish an unsupported assertion: negated/advisory phrasing can also match. New jobs record safe field/rule IDs and allow at most one diagnostic-guided correction within existing attempts/budgets; repeated failures remain unpublished.",
  BUDGET_RESERVED_FOR_OTHER_NEW_SLOT: "This new-post retry cannot use the first-attempt budget protected for the other new-post slot. Daily caps are unchanged.",
  JOB_RECOVERY_NOT_ELIGIBLE: "Recovery requires today's failed new-post job, an allowlisted recoverable error, remaining attempts and no previous explicit recovery. Historical or exhausted jobs and safety rejections cannot be reopened.",
  TOPIC_QUEUE_EMPTY: "No eligible unused topic is ready. Failed topics recover after bounded cooldown; safety-blocked or repeatedly failing topics stay blocked. Check catalog coverage and topic status; do not replay old jobs.",
};
export function safeBlogCode(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error || "");
  return Object.prototype.hasOwnProperty.call(actions, code) ? code : sharedCode(error);
}
export function blogAction(code: string | null): string {
  return code && Object.prototype.hasOwnProperty.call(actions, code) ? actions[code] : sharedAction(code);
}
