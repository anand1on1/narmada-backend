import { safeBlogCode as sharedCode, blogAction as sharedAction } from "../shared/blog-diagnostics";

// Keep new backend diagnostics out of client-imported modules: the existing
// GoDaddy frontend already renders each job's server-provided nextAction.
const actions: Record<string, string> = {
  PROVIDER_TIMEOUT: "The provider request or response body exceeded its timeout. Bounded retries apply; no partial output is published.",
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
