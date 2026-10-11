// Only these codes may leave the server. Raw exception/provider text never does.
const codes = `INTERNAL_JOB_ERROR ARTICLE_SCHEMA_INVALID ARTICLE_STRUCTURE_INVALID ARTICLE_TOO_SIMILAR CLAIM_NOT_GROUNDED
DISCOVERED_TOPIC_UNGROUNDED EVIDENCE_INSUFFICIENT EVIDENCE_SOURCES_UNREACHABLE INTERNAL_LINK_INVALID LINK_EVIDENCE_INSUFFICIENT
PRIVACY_CHECK_FAILED PRODUCT_LINK_INVALID SOURCE_ADDRESS_REJECTED SOURCE_COPY_OVERLAP SOURCE_DNS_TIMEOUT SOURCE_TIMEOUT
SOURCE_TOO_LARGE SOURCE_UNREACHABLE SOURCE_URL_REJECTED SOURCE_REDIRECT_REJECTED UNCITED_EXTERNAL_LINK UNSAFE_HTML
UNSUPPORTED_COMMERCIAL_CLAIM CONTEXT_BUDGET_EXCEEDED GENERATION_JSON_INVALID GENERATION_NOT_CONFIGURED GENERATION_TRUNCATED
NO_SUPPORTED_CHANGE PROVIDER_EMPTY_RESPONSE PROVIDER_NETWORK_ERROR PROVIDER_RESPONSE_INVALID PROVIDER_RESPONSE_TOO_LARGE
RESEARCH_NOT_CONFIGURED PROVIDER_RATE_LIMIT PROVIDER_REQUEST_FAILED PROVIDER_AUTH_FAILED PROVIDER_MODEL_UNAVAILABLE
ARTICLE_CHANGED_DURING_JOB ARTICLE_NOT_FOUND DAILY_PROVIDER_BUDGET DRAFT_DAILY_CAP DUPLICATE_SLUG EDITORIAL_REVIEW_FAILED
LEASE_EXPIRED LEGACY_TITLE_UNSAFE NEW_PUBLICATION_DAILY_CAP PAUSED_DURING_JOB PROVIDERS_UNAVAILABLE PUBLIC_CATALOG_INSUFFICIENT
REVISION_NOT_FOUND TOPIC_QUEUE_EMPTY MISSED_DAY ATTEMPTS_EXHAUSTED BUDGET_RESERVED_FOR_NEW_POSTS`;
const known = new Set(codes.split(/\s+/));
export function safeBlogCode(error: unknown) {
  const code = error instanceof Error ? error.message : String(error || "");
  return known.has(code) ? code : "INTERNAL_JOB_ERROR";
}
export function blogAction(code: string | null) {
  const actions: Record<string, string> = {
    DEPLOYMENT_NOT_ENABLED: "AUTO_BLOGGER_ENABLED is off. Verify the public blog/SEO bridge, then set AUTO_BLOGGER_ENABLED=true on Render and restart the service.",
    PROVIDERS_NOT_CONFIGURED: "Set CLAUDE_API_KEY (or ANTHROPIC_API_KEY) and TAVILY_API_KEY (or PERPLEXITY_API_KEY) on Render. Never paste keys here.",
    PAUSED: "Save Auto mode to resume validated publication, or Draft mode for non-public testing.",
    PROVIDER_AUTH_FAILED: "Check the configured provider key, account access and billing in the provider console; replace the Render secret if needed.",
    PROVIDER_MODEL_UNAVAILABLE: "Check that the Anthropic account can use claude-sonnet-4-5.",
    PROVIDER_RATE_LIMIT: "Provider rate or credit limit reached. Check account limits; the slot uses bounded retries.",
    PROVIDER_NETWORK_ERROR: "Provider could not be reached. Check Render outbound connectivity; bounded retries apply.",
    EVIDENCE_SOURCES_UNREACHABLE: "Authoritative sources were blocked, redirected outside the allowlist or not readable HTML/text. No article was published; retry or use a different grounded topic.",
    EVIDENCE_INSUFFICIENT: "Research did not yield two distinct, readable authoritative references. No filler will be published.",
    CONTEXT_BUDGET_EXCEEDED: "Evidence/article exceeded the safe provider context limit. Shorten the article/evidence; do not remove factual checks.",
    GENERATION_JSON_INVALID: "Generation returned invalid JSON. The bounded retry may recover; inspect recurring provider output failures without exposing raw content.",
    GENERATION_TRUNCATED: "Provider output was incomplete. The bounded retry may recover; do not publish partial content.",
    DAILY_PROVIDER_BUDGET: "Daily reservation budget is exhausted. Review calls/tokens and wait for the next IST day or explicitly adjust the limits.",
    BUDGET_RESERVED_FOR_NEW_POSTS: "Budget is protected for the remaining new-post slots. Optional draft/improvement work was deferred.",
    NO_SUPPORTED_CHANGE: "No eligible older article or no substantive supported improvement. Nothing changed.",
    EDITORIAL_REVIEW_FAILED: "Factual/privacy review rejected this article. Keep it unpublished and review its evidence.",
    TOPIC_QUEUE_EMPTY: "Use Plan topics after confirming active, supported catalog categories.",
    PUBLIC_CATALOG_INSUFFICIENT: "No eligible public catalog facts were available for a grounded topic.",
  };
  return code ? actions[code] || "The safety check stopped publication. Review this diagnostic and the stored article/evidence; do not bypass validation." : "";
}
