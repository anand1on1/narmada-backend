// =============================================================================
// R28 Session 2 — Manual SurePass verification helper.
// -----------------------------------------------------------------------------
// Not committed as an automated test — SurePass calls cost real wallet credits.
// Usage:
//   tsx scripts/test-surepass.ts BR01AB1234
// or:
//   SUREPASS_API_TOKEN=... SUREPASS_BASE_URL=https://kyc-api.surepass.app \
//     SUREPASS_RC_ENDPOINT=/api/v1/rc/rc-v2 tsx scripts/test-surepass.ts BR01AB1234
//
// The script imports the same module as the customer endpoint, so a green run
// here confirms the endpoint will work end-to-end.
//
// IMPORTANT: Do NOT commit real customer registration numbers. Use throwaway
// dummy values like BR01AB1234 (or scrub before push).
// =============================================================================
import { lookupRegistration, normalizeRegNumber } from "../server/surepass";

async function main() {
  const arg = process.argv[2] || "BR01AB1234";
  const normalized = normalizeRegNumber(arg);
  console.log(`[test-surepass] input: ${arg} -> normalized: ${normalized}`);
  const result = await lookupRegistration(normalized, "127.0.0.1");
  console.log("[test-surepass] result:");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[test-surepass] fatal:", e);
  process.exit(2);
});
