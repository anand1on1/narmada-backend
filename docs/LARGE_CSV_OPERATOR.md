# Backend-only large price-list CSV import

This adds an authorized operator path beyond the existing website upload limits.
It does not change the frontend, require a GoDaddy upload, or grant permission to
import or publish production data. Review and approve backend deployment first.

## Before importing

- **Clean source:** Obtain a valid UTF-8 CSV, ideally a fresh export from the
  original spreadsheet. The supplied 19,276,411-byte / 262,489-record CSV contains
  damaged description bytes and is not valid UTF-8. Strict import will reject it.
  Selecting Windows-1252 is not a repair for this mostly-UTF-8 file. No supplied
  file, description, price or row was modified.
- **Blank prices:** The supplied file also has 48 blank MRPs. Existing behavior
  remains: these can be staged as null MRP, but publication rejects them; they do
  not create a zero public price. Decide how to correct source data separately.
- **Permission:** Use your own existing admin login. Never send a password or
  session token to an assistant, paste a token into a command, or share console
  network headers. The helper reads the existing token locally and sends it only
  to the fixed existing HTTPS backend, using the same header as the admin app.
- **Publication:** The helper displays current future-upload sync and asks for
  confirmation. If sync is enabled when a complete import finishes, it queues the
  existing publication job; if disabled, no job is created. The helper changes no
  setting. A waiting-FX or queued job is not evidence that prices are already live.
- **Capacity:** Ensure the backend's persistent disk has capacity for another
  list and audit history before an approved production import. No full-size
  database import or production capacity measurement was performed for this work.

## Operator steps after deployment and approval

- **Sign in:** Open `https://narmadamobility.com/admin/price-lists` (or the `www`
  equivalent) and sign in as an admin. Keep this tab open.
- **Load the reviewed helper:** Open browser Developer Tools, then Console. Paste
  the reviewed contents of `scripts/operator-import-price-list.js`. This local
  helper does not fetch executable code or install a page; loading it starts no
  import. Do not paste scripts from untrusted sources or bypass browser warnings.
- **Choose and confirm:** Enter `narmadaLargeCsv.chooseAndImport()`. Choose the
  local CSV and provide brand code, version label, effective date and confirmed
  encoding. Carefully review the file, metadata and potential publication effects
  in the confirmation dialog. Cancel if anything is wrong.
- **Watch status:** The console reports import ID, received bytes, staged rows,
  errors and final SHA-256. Note the numeric import ID. Run
  `narmadaLargeCsv.status()` to read current state; this performs no import.
- **Interrupted connection:** Wait at least five seconds, then run
  `narmadaLargeCsv.retry()`. It reuses the same retained File and import ID. A live
  competing stream must finish; after a crashed worker, allow the two-minute
  lease to expire. Committed chunks are verified, not duplicated.
- **After refreshing the tab:** Reinstall the same reviewed helper, then run
  `narmadaLargeCsv.resume()`. Enter the saved import ID and choose the exact
  original file. Completed imports return status without another upload.
- **Invalid source data:** Retrying identical malformed data will fail again.
  Obtain or explicitly correct the source, refresh the tab, reinstall the helper
  and start a new import for the corrected file. Do not resume an old import with
  a changed file. Old staging remains incomplete and excluded from lookup and
  publication; retained import records cannot be deleted through the list API.

No terminal installation, token extraction, Render shell access, file placement
on the server, remote-file URL or frontend deployment is required. This is an
operator workflow in a signed-in desktop browser, not a new customer-facing page.

## Input and safety limits

- **File:** Uncompressed raw CSV, 1 byte through 64 MiB (67,108,864 bytes).
  At most 500,000 data records, 32,768 characters per record and 16 fields.
  Required headers are `part_number,mrp`; optional headers are `description`,
  `dealer_price`, `hsn_code`, `gst_percent`, `uom`, `currency`. Header names are
  trimmed, lowercased and spaces become underscores; unknown/duplicate headers,
  inconsistent widths and malformed quoting are rejected.
- **Encoding:** `utf-8` by default, strictly decoded. Explicit `windows-1252`
  is available only for a source known to be that encoding; its undefined bytes
  are rejected. No encoding guessing, replacement characters or automatic
  transliteration. Errors identify zero-based byte offset, one-based CSV record
  (header is record 1), and column where possible. Quoted newlines belong to one
  record; CSV record numbers are not necessarily physical text-line numbers.
- **Identifiers and numbers:** Part identifiers remain text, including leading
  zeros. Quotes, commas, embedded newlines and escaped quotes are supported.
  Existing metadata validation and same-brand/part dealer/GST carryforward apply;
  explicit zeros remain explicit. Blank/invalid part rows remain staged for
  explicit publication rejection, matching the existing backend behavior.
- **Concurrency:** One active large CSV stream per database, with a persisted
  two-minute renewable lease. Six new sessions per admin per hour, five-second
  same-session retry interval, 45-second upload inactivity timeout and 15-minute
  total request timeout. Status polling and existing-session lookup do not consume
  the new-session quota.
- **Visibility:** Rows are staged in batches of at most 500. A complete strict
  parse, exact observed byte count, all retry digests, and final staged-row/chunk
  reconciliation must pass before finalization. Failed, disconnected or truncated
  imports stay excluded. Existing lists and public products are not removed.
- **Pricing:** Existing positive GST-inclusive INR MRP → observed-FX USD pricing,
  private dealer/GST fields, public ownership, audit and publication rules remain
  unchanged. Partial replacement files do not delete absent products.

## Backend API and audit

All routes require the existing admin role and `x-admin-token`; no token belongs
in a URL or log. The helper has a fixed backend origin
`https://narmada-backend.onrender.com`, refuses other page origins, uses no
credentials in query strings, and refuses redirects.

- **Create/reuse:** `POST /api/admin/catalog-sync/csv-imports` with JSON
  `requestKey`, `brand`, `encoding`, `bytes`, and optional `versionLabel`,
  `effectiveDate`, `notes`. Identical request-key metadata reuses the session;
  different metadata conflicts.
- **Status:** `GET /api/admin/catalog-sync/csv-imports/:id`. Returns state,
  source/staged row counts, byte progress, error and final source SHA-256.
- **Stream:** `PUT /api/admin/catalog-sync/csv-imports/:id/content` with
  `Content-Type: text/csv` and the File body. Browser-controlled Content-Length is
  optional; actual bytes are counted, including chunked transfer. Response is
  newline-delimited JSON progress/completion/error. After streaming begins,
  validation errors appear as `event: error` despite HTTP 200; always inspect
  terminal event or status, not HTTP status alone.

The additive `catalog_csv_imports` table records encoding, expected/observed bytes,
source hash, staging linkage, actor, timestamps, latest attempt time, leases and errors.
Existing chunks/finish routes cannot bypass complete-file CSV validation.
No remote URL retrieval, background provider, new login endpoint or auth bypass
was added.

## Verification boundary

Tests exercise actual authenticated backend routes in isolated SQLite, strict
parsing, corrupt bytes, malformed metadata, CORS preflight using the current
server middleware, chunked transfer, interruption, leases, row reconciliation,
retries, blank-MRP/part behavior and current pricing/publication semantics.
The parser also processes 400,000 generated rows larger than the supplied file,
in 500-row batches, without materializing a file or large database fixture.

Browser QA runs the actual helper with a native picker and confirmation dialogs
against intercepted offline API fixtures. No live request, real file import,
production publication, full-size database performance benchmark, deployment or
GoDaddy build was performed. The existing website uploader's limits are unchanged.
