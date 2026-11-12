# Public quotation update

This branch builds on the dashboard CSV head `7298eb8c2875ce033a111df94dbbb1d282ac8355`.
PR 34 is still a dependency, not assumed merged. No production changes, migrations,
paid document-reading calls, live emails or imports were performed for this work.

## Scope

- Existing `/get-quote` and RFQ tables reused. Contact details and same-page email
  verification precede upload/manual tiles, editable items, review and saved reference.
- CSV/XLSX are parsed locally on the server. PDF/JPG/PNG reuse the existing
  Anthropic integration, with visible consent naming the provider before upload.
- Files are limited to 4 MiB, 500 rows, 30 worksheet columns, 5 PDF pages and
  20 megapixels. XLSX expansion is bounded. CSV must be valid UTF-8.
- Parser access requires verified email, with global/email concurrency and hourly
  email/IP limits. Unknown identifiers and quantities remain blank. Scientific
  notation identifiers are cleared for correction, never expanded into guessed IDs.
- Request persistence and fixed per-recipient notification rows are atomic.
  The recipients are `anand@narmadamotors.in` and `sales@narmadamobility.com`.
  Same-key same-body submission returns the saved reference; changed-body reuse
  conflicts. Polling does not send mail. Known unstarted deliveries permit at most
  three attempts with a one-minute cooldown; ambiguous sends require operator
  reconciliation, not automatic resending.
- OTP delivery is bounded and truthful; failed sends invalidate the code.
  OTP log content is redacted. Token signing fails closed without a suitable secret.
- Public-only excluded-brand filters cover navigation, catalog, chassis, parts,
  public blog, SSR and sitemap projections. Internal brands, quotes, historical
  rows and importer access remain intact; no data deletion migration is included.

## Hosting and configuration

The frontend alone cannot enable the new backend endpoints. After separate release
approval, install the matching backend and GoDaddy frontend. The existing fixed-host
PHP SEO bridge now handles `/get-quote`; its upstream must run this backend version.
No deployment is part of this change.

Set a high-entropy `QUOTE_TOKEN_SECRET` of at least 32 characters, or retain a
suitable configured `SESSION_SECRET`/`AUTH_SECRET`. SMTP configuration and
`EMAIL_NOTIFICATIONS_ENABLED` must permit sending before verification works.
`CLAUDE_API_KEY` uses the existing provider integration. If absent, CSV/XLSX and
manual entry remain available and document reading gives an actionable error.

The existing one-hop Express trust-proxy setting supplies `req.ip`; the public
quotation flow no longer trusts the leftmost raw forwarded-for value. In-memory
hourly limits reset on restart and are per process, appropriate to the current
single-instance setup; a multi-instance rollout needs shared rate-limit storage.

An SMTP timeout is inherently ambiguous. The request remains saved, with recipient
status available for staff reconciliation. The browser keeps its draft and stable
request key in memory, not local storage; refreshing before saving discards it.

## Editorial and locations

The interactive and no-JavaScript guides share researched model/parts/FAQ content.
The server-rendered page contains all 36 state/union-territory groups, 1,229 selected
city entries and the existing country directory. These are enquiry destinations,
not claims of exhaustive coverage, established routes or guaranteed shipping.

City data derives from [Indian Cities JSON](https://github.com/nshntarora/Indian-Cities-JSON),
with its MIT licence preserved in `shared/data/india-cities-LICENSE.txt`.
Official additions are cited in the page alongside the community source.
Real illustrative photographs have visible creator, source and CC BY-SA 4.0 credits;
they do not represent owned fleet or current inventory. Resized WebP derivatives
are under the same licence.

## Verification

Automated tests use isolated temporary SQLite databases and mocked SMTP. Provider
keys are stripped by the test harness. New tests cover parser validation, missing
fields, scientific notation, token/consent gates, bounds, unavailable provider,
OTP failure invalidation, fixed recipients, idempotency, saved/pending status,
bounded retries, public exclusions and crawlable content. The pre-existing CSV
dashboard tests remain included.

Offline browser checks cover failed OTP, re-verification, consent, parser fallback,
editable/missing quantities, expired-token recovery with retained draft/key,
destination selection, saved reference, pending-versus-sent email status, price-brand
startup, desktop/mobile layout and absence of excluded/forbidden page copy.
Browser requests are intercepted, not sent to production.
