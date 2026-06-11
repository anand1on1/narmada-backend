# Narmada Mobility — Comprehensive Test Plan (R4 → R7)

**Deploy URL:** https://narmadamobility.com (frontend) · https://narmada-backend.onrender.com (backend)
**Test the LIVE backend after Render auto-deploy completes (~2 min after the last push).**
**Last commit on `main`:** `1041d00`

> **AiSensy caveat:** The new business number +91 91555 01082 is `Pending` with Meta. While Pending, any WhatsApp template send will fail and the code will use the free-text fallback. To exercise the template path, wait for Meta approval AND approve the new templates `vendor_rfq` + `payment_confirmation_vendor` in AiSensy.

## Pre-flight

1. **Render env vars** — confirm these are set (Settings → Environment):
   - `AISENSY_API_KEY`, `AISENSY_PHONE_NUMBER_ID=1069560402916909`, `AISENSY_WABA_ID=1747557796599432`, `AISENSY_FROM_NUMBER=919155501082`, `AISENSY_WEBHOOK_SECRET=<your value>`
   - `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY`, `PPLX_API_KEY`
   - SMTP_* + `BREVO_SMTP_KEY`
2. **Database migration** — happens automatically on boot (`server/migrations.ts`). After deploy, check Render logs for `[migrations] all R5 tables ensured` and `[seed-r5] companies/warehouses/delhi users seeded`.
3. **AiSensy webhook** — in AiSensy dashboard, point inbound webhook to `https://narmada-backend.onrender.com/api/webhooks/aisensy` with header `x-aisensy-secret: <AISENSY_WEBHOOK_SECRET value>`.

---

## 1 — Admin (login: any existing admin account; password literal `Mausami@@2026` with trailing space if using seed admin)

### 1.1 — Premium PDF (R4.3)
- Open an existing quotation → Download PDF.
- Expect: navy top strip, red accent line under company block, BILL TO / SHIP TO / SUMMARY cards on cream backgrounds, amount-in-words below totals, "Authorised Signatory" block at bottom-right, "Page X of Y" footer, no overlapping text on any row, table fits within margins.
- Try a 30+ line quotation — confirm it paginates cleanly without orphan headers.

### 1.2 — AI Ledger (R4.4)
- Go to `/#/admin/ai-ledger`.
- **Chat tab:** Ask "Which customers owe more than ₹50,000?" → expect a table answer and an explanation paragraph. Ask follow-ups.
- **Overdue tab:** Confirm table lists invoices > 30 days unpaid. Click "Send Reminder" on a row → check Render logs for the AiSensy + email attempt (will fall back to free-text while Meta pending).
- **Reconcile tab:** Upload a CSV `date,description,amount,ref`. Verify match preview shows matched + unmatched payments. Click Confirm → matched payments flip to `confirmed`.

### 1.3 — Vendor Master (R5.2)
- `/#/admin/vendors` → Add vendor (name, GSTIN, phone, whatsapp, brands "Tata, Ashok Leyland").
- Edit. Filter by brand. Toggle active.
- Bulk import: upload CSV with header `code,name,gstin,phone,whatsapp,address,brands,categories,payment_terms` → expect rows inserted (duplicates by `code` skipped).

### 1.4 — Company Master (R5.2)
- `/#/admin/companies` → Confirm NARMADA MOTORS row exists (auto-seeded with `is_default = true`).
- Edit logo (upload PNG; stored as base64 data URL).
- Add Company 2, Company 3, Company 4 once entity details arrive. Try "Set Default" to swap.

### 1.5 — RFQ + AiSensy thread mirror (R5.4 + R5.5)
- From an existing PO, create RFQ → select 2 vendors → Send. Expect AiSensy 4xx (template Pending) → free-text fallback fires.
- In `/#/admin/vendor-inbox`, confirm outgoing message appears in thread for both vendors.
- **Simulate inbound** (until webhook is live, you can curl):
  ```
  curl -X POST https://narmada-backend.onrender.com/api/webhooks/aisensy \
    -H "x-aisensy-secret: $AISENSY_WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"from":"919876543210","message":"Tata 254512-12340 — rate Rs 1850, MOQ 10, 7 days","message_id":"WAM_test_1"}'
  ```
  (Vendor with whatsapp=919876543210 must exist.)
- Confirm thread shows inbound, and if an active RFQ existed → an `rfq_quotes` row was extracted by Claude (rate 1850, moq 10, lead 7).
- Open RFQ detail → quote appears in matrix → click "Select winner" on the item.

### 1.6 — Rate history (R5.6)
- After 5.5, open Parts page → expand the part → confirm "Rate history" table shows the new vendor row with Latest / Avg / Min / Max.

### 1.7 — Vendor Discovery (R6.1)
- `/#/admin/vendor-discovery` → query "Tata 1109 air filter Patna".
- Expect a list of 5-10 candidates (PPLX-sourced) with name, city, phone, website, source URL.
- Click "Send RFQ" on a candidate → an RFQ draft opens prefilled. (Vendor will be auto-created if phone is present.)

### 1.8 — Vendor payment notify (R6.2)
- After marking a PO paid to a vendor, click "Notify Vendor" → expect WhatsApp + log entry. Free-text fallback active while template Pending.

### 1.9 — CRM Leads + Kanban (R7.1)
- `/#/admin/leads` → Add lead manually (name, phone, requirement, source=`whatsapp`, stage=`new`).
- Change stage via dropdown → row moves between visual columns.
- Bulk import CSV (header `name,phone,whatsapp,email,city,requirement,source,stage`) → confirm rows added.
- Filter by source / owner / city.

### 1.10 — Targets / Announcements / Tasks (R7.1)
- `/#/admin/targets` → create a target (user, period "2026-06", metric "quotations", value 50).
- `/#/admin/announcements` → create one for audience "patna".
- `/#/admin/tasks` → assign a task with due date and priority.

### 1.11 — Outreach automation (R7.2)
- On a lead, click "AI Outreach" → expect a Claude-drafted WA message in English or Hindi based on the requirement text. Click Send → AiSensy attempt logged.

### 1.12 — Ad dashboard shells (R7.2)
- `/#/admin/ads-meta` and `/#/admin/ads-google` — confirm "Connect" buttons render and toast "OAuth coming soon". Placeholder cards visible.

### 1.13 — Catalogue PDF (R7.2)
- On `/#/admin/products`, click "Generate Catalogue" → choose company NARMADA MOTORS → download PDF.
- Expect: same design language, brand+category sections, product images, MRP, tier discount.

---

## 2 — Patna Team / Sales (login: `/#/team/login`)

### 2.1 — Quotations list filters (R4.1)
- `/#/team/quotations` → use From/To pickers, customer dropdown, status pills, presets (Today / This Week / This Month / Last 30).
- Confirm result count badge updates. Clear filters works.

### 2.2 — Parts Master enrichment (R4.2)
- `/#/team/parts` → confirm columns: Brand · Last Customer · Last Discount · Last Quoted · Quote Count.
- Expand a row → last 10 quotes table visible.

### 2.3 — PO flow (R5.3)
- From a finalised quotation → "Convert to PO" button → PO created, redirect to `/#/team/pos/:id`.
- On PO detail, assign vendor + purchase cost per line. Save.
- Click "Download PO PDF" → expect navy/red premium PDF with PO number, line items, vendor sections.

### 2.4 — RFQ creation (R5.4)
- On a PO with vendors assigned → "Create RFQ" → choose items + vendors → Send.
- `/#/team/rfqs` shows the new RFQ. `/#/team/rfqs/:id` shows the matrix.

### 2.5 — Dashboard widgets (R7.1)
- `/#/team/dashboard` shows: my announcements (audience-filtered), my open tasks, my target progress.

---

## 3 — Delhi Warehouse (login: `/#/delhi/login`)

**Test users (default password `Narmada@2026`):**
- Kundan Kumar — phone `919155596461`
- Aditya Pawar — phone `918602535661`

### 3.1 — Login
- Open `/#/delhi/login`, login with one of the users above.

### 3.2 — Queue (R5.7)
- `/#/delhi/dashboard` shows three columns: Pickup → Pack → Dispatch.
- For a PO item visible in Pickup, click "Mark Collected" → moves to Pack.
- In Pack, click "Mark Packed" → moves to Dispatch.
- In Dispatch, click "Mark Dispatched" → enter docket_no + courier → submit.

### 3.3 — Auto-consignment + customer notify (R5.7 + R5.8)
- After 3.2 dispatch, verify in admin:
  - A new `consignments` row exists with client rate (NOT purchase cost), status `dispatched`.
  - In `AdminNotificationLog`, customer received AiSensy + email "Your order has been dispatched" entries.

### 3.4 — Pickup reminder (R5.8)
- Leave a PO item in pickup state. After 30 min cycle (or restart the server within 2 days), Delhi inbox should receive reminder (logged in notification table).

---

## 4 — Customer Portal (login: `/#/portal`)

### 4.1 — Existing flows untouched
- Login, view quotations, view invoices, view consignments, track consignment by ID — confirm no regressions from Session A/B/C/Round 3.

### 4.2 — New dispatch notification path (R5.7 + R5.8)
- Once a Delhi-dispatched order is in customer's account, the customer should see consignment status `dispatched` + docket details.

---

## 5 — Cross-cutting checks

### 5.1 — Existing routes unchanged
- Admin login still works with `Mausami@@2026 ` (trailing space).
- Team login, customer portal, public site (HomePage / BrandPage / ContactPage / WorkWithUsPage / BlogList) all load.
- Existing CSV imports (parts, customers) still work.
- Existing consignment tracking still works.

### 5.2 — Hash routing
- All new URLs use `/#/` prefix (e.g. `https://narmadamobility.com/#/admin/ai-ledger`). Direct URL paste from the address bar should work.

### 5.3 — Backend boot
- Render logs at startup should show:
  - `[migrations] all R5 tables ensured`
  - `[seed-r5] companies seeded` (or `companies already seeded — skip`)
  - `[seed-r5] warehouses seeded` (or skip)
  - `[seed-r5] delhi users seeded` (or skip)
  - `[reminders] dispatch reminder cron started`
- No `[error] table already exists` — CREATE TABLE IF NOT EXISTS handles re-deploy.

### 5.4 — Typecheck + build
Run locally if needed:
```
npx tsc --noEmit -p .
npm run build
```
Both should be clean.

---

## What to NOT test yet (blocked / deferred)

- Actual WhatsApp template delivery via `vendor_rfq` and `payment_confirmation_vendor` — blocked on Meta approval of (a) the business number +91 91555 01082 and (b) the templates themselves in AiSensy/Meta UI. Until both clear, free-text fallback path is exercised.
- Meta Ads + Google Ads OAuth — shells only; no real auth.
- Vendor-side bank reconciliation (mentioned as R6.3-extension; deferred).
- Logo files for Companies 2-4 — pending entity details from user.
- AiSensy inbound — test via curl simulation above until live webhook is configured.

---

## Bug-report template (please paste your findings here)

For each bug you find, give me:
- **Page / URL:** `/#/admin/...`
- **Role:** admin / patna team / delhi / customer
- **Steps to reproduce:** 1, 2, 3
- **Expected:**
- **Actual:**
- **Console error or Render log line (if any):**
- **Screenshot:** (optional)

I'll batch-fix them in Round 8.
