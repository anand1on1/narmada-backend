# Price-list publication — pending QA inventory

QA inventory. Completed checks and exclusions are recorded in the release handoff;
this list is not blanket browser signoff for every existing private workflow.

Offline browser checks completed: native Excel upload/retry with one update, one
new product and one invalid-price rejection; stable product URL and USD price;
catalog search/pagination; desktop/mobile screens; initial HTML and JSON-LD through
the real PHP bridge using a local-only transport stub; missing product 404.
Existing private PO/quotation workflows are covered by regression tests, not
claimed as fully exercised in the browser.

## Price Checker
- Choose Tata, search a known part, open an enquiry.
- Verify public-safe price details, empty/invalid search and no supplier/private data.

## Admin upload
- Download the template; upload a small brand file.
- Repeat it, update one price, add a part, omit an existing part.
- Expect stable IDs/URLs, no duplicates or deletion, and exact progress/counts.
- Test invalid prices, significant zeros/punctuation, duplicate rows, collisions,
  two brands, future dates, native Excel formatting, retries and concurrency.
- Import dealer-price/GST metadata privately; omit it on a subsequent upload and
  verify latest same-brand/same-part values survive. Explicit zero remains zero;
  new identities stay NULL. Malformed metadata rejects the chunk atomically.
- Verify authorized private checker access and no dealer-cost field/value in
  public checker/product API, initial HTML or structured data.

## Quotations
- Create/save/edit INR and USD quotations; switch currency and re-save.
- Verify approved currency/discount/tax handling and no public zero-price products.
- Preserve private values; price-list public precedence must not flip-flop.

## PO Notify Delhi
- Process positive-price PO and notify Delhi; repeat and overlap with import.
- Verify publication/notification behavior and brand isolation.
- Disable actual email/image-provider/AI calls in fixtures.

## Catalog/cart
- Search, filter brand/category, paginate, use Back, open a product.
- Inspect rich images/descriptions/fitment; exercise quantity, cart and enquiry.
- Test desktop and 375px mobile, resize back, inspect console and overflow.

## Initial HTML
- Disable JavaScript; follow product/category/pagination links.
- Compare USD HTML/UI/API/schema; check one canonical, real 404, valid redirects.
- Same content for every visitor; no fabricated availability or compatibility.

## Sitemap/robots
- Exercise sitemap index/children through local PHP harness.
- Verify unique canonical URLs, trustworthy lastmod and bounded URL/byte size.
- Preserve fixed upstream restrictions, PHP/.htaccess and dynamic routing.

## Jobs/reversal
- Dry run, small pilot, bounded 400k identity fixture under /dev/shm.
- Pause/resume/retry, partial failure, concurrent upload, conflict-safe reversal.
- Preserve omitted rows and last valid prices; no automatic startup backfill.

## Delivery
- Stable final changes: full suite, typecheck/build, browser QA and offline fixtures.
- Reviewable exact-head PR and GoDaddy ZIP with marker/checksum.
- No merge/deploy/production activation without explicit authority.
