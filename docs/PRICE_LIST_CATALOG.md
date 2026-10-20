# Price-list catalog — operations and release gate

## Approved pricing and boundaries

Public list price is positive INR MRP, already GST-inclusive, divided by an
observed INR-per-USD rate from the existing FX service, rounded to two decimals.
No markup, dealer cost, negotiated discount or additional GST is applied.
The public snapshot includes its FX observation date. All linked-product
HTML/UI/API/schema uses that same snapshot; re-upload/publication can refresh it.
A provider outage uses only the last **observed** rate, visibly dated, never the
service's hardcoded fallback. Without an observed rate, publication waits/fails
explicitly; no INR value is relabeled USD.

Private quotation/PO financial calculations and historical documents are unchanged.
Linked products retain price-list public precedence. Existing unrelated publisher
currency/zero-price issues are not repaired by this release. Unknown-brand automatic
publication of a catalog-owned part is deferred rather than guessing a brand.

No source-price rows are automatically published on startup/deploy. The worker only
resumes jobs already requested. Future-upload synchronization defaults off.

## After explicit merge/deployment approval

1. Back up the production SQLite database and persistent disk; verify disk capacity
   for additive identity, job/audit and trigram search indexes. Repository schema was
   inspected, but live schema and actual source-row counts were not verified.
2. Deploy the approved backend head. Upload the matching GoDaddy ZIP **contents**
   into the existing document root, retaining `.htaccess`, `seo-bridge.php`,
   `config.js`, `robots.txt` and `version.json`. `config.js` must point to
   `https://narmada-backend.onrender.com`. Do not deploy the offline QA harness.
3. Verify `version.json` commit/dirty marker, real product HTML with JS disabled,
   status/redirect/canonical behavior, and sitemap index plus child feeds.
4. In Admin → Price Lists, **Build resumable search index**. This explicitly indexes
   existing products in bounded batches; writes thereafter maintain the index.
   Until complete, legacy SQL substring search remains available. Searches shorter
   than three characters also use the legacy fallback.
5. **Dry run existing price lists**. Review counts and rejection audit before
   publication. For a specific list, use the authenticated job API with `listId`.
   Dry-run counts are projected actions, not published products.
6. **Publish 100-row pilot**, inspect actual prices, existing rich fields/URLs,
   enquiry target, missing-stock treatment, and public JSON/HTML/schema. A pilot
   scans 100 source rows, so superseded/rejected rows may reduce published count.
7. Only after the reviewed pilot and explicit bulk-activation authority, request
   **Publish full catalog**. It scans a fixed source high-water mark in transactions
   of at most 200 rows, with persisted cursor/counts and pause/resume controls.
8. Explicitly **Enable future upload sync** when desired. Uploads already completed
   while disabled do not silently backfill when enabled.

## Excel/CSV and matching

- Native Excel/CSV: first worksheet, at most 50,000 rows and 8 MB per file;
  split larger files safely. Browser reads one bounded workbook; requests carry
  at most 500 rows. Existing database backfill does not load all rows into memory.
- Required columns: `part_number`, `mrp`. Optional: `description`, `dealer_price`,
  `gst_percent`, `hsn_code`, `uom`, `currency` (INR only). Store long identifiers as text; unsafe numeric
  identifiers are rejected rather than silently losing precision.
- Valid dealer-price and GST-percent metadata is retained privately. Blank or
  omitted fields carry forward the most recent valid value for the same validated
  brand and exact normalized part only; new identities remain NULL. Explicit zero
  is retained, including zero-rated GST. Incomplete unrelated uploads are not a
  carry-forward source. Historical rows are never zeroed or rewritten.
- Private numeric fields must be finite, non-negative numbers; GST percent must be
  at most 100. Standard INR/grouped dealer values and a trailing GST `%` are accepted.
  Malformed private metadata rejects the entire chunk atomically. Correct the file
  and re-upload; an unfinished upload remains excluded from checker results.
- Authorized admins can inspect retained costs through
  `/api/admin/price-lists/search?part_number=...&brand=...`; unauthenticated checker
  output continues to omit dealer costs. GST metadata retention does not add GST
  again to the approved public MRP.
- Brand is selected explicitly from the existing supported-brand list.
  Identity ignores ASCII case and outer whitespace only. Leading zeros,
  punctuation and internal whitespace remain significant.
- Existing legacy punctuation-clean collisions and multiple existing products
  for one identity are quarantined for manual review, not merged.
- Chunk retries with the same payload are idempotent; changed retries fail.
  Exact file+metadata retries reuse the upload and publication job.
- Conflicting duplicate prices reject the identity. Identical duplicates are
  counted as skipped. Invalid/blank/non-positive/unsupported-currency rows never
  replace a last valid catalog price.
- Later completed brand uploads take precedence over older lists. Missing rows
  in a partial upload never delete or unpublish products. Existing rich content
  and stable IDs/URLs are retained; inactive products need separate approval.
- Future-dated rows are rejected with an explicit reason; rerun on/after their
  effective date. There is no hidden scheduler that publishes them later.

## Audit, recovery and reversal

Admin UI shows the newest 30 jobs and their first 100 audit rows. Fetch further
audit pages using authenticated
`GET /api/admin/catalog-sync/jobs/:id/audit?after=<last-audit-id>`.
The response is bounded to 100 records. Jobs pause/resume through the admin UI.

An explicit **Reverse** request processes only that publication operation.
Each recorded after-state must still match; later edits become reversal conflicts.
Existing products regain their prior price/ownership. New products are hidden,
never deleted. Search indexing changes no prices and has no publication reversal.
Never remove source lists needed by ownership/audit. Keep the newer schema when
rolling application code back; all migrations are additive.

## Testing and honest limits

Offline regression includes repeated imports, stable IDs/content, invalid and
foreign-currency rows, brand separation, duplicate/collision handling, explicit FX,
reversal, real concurrent SQLite workers, search-index maintenance and public SEO.
The full suite also exercises existing quotation/PO behavior.

The 400k benchmark is a synthetic in-memory identity/pagination/count/sitemap
fixture, not a production publication-throughput estimate. No production bulk job,
production schema write, merge, deployment or activation was performed.
Google indexing is not guaranteed.
