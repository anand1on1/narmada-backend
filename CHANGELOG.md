# Narmada Mobility — Round 4 & 5 & 6 & 7 Changelog

**Build date:** 2026-06-11
**Branches/commits:**
- `8bd01cb` — Round 4 (partial): quotation filters + parts enrichment + premium PDF
- `ba29f79` — Round 5.1: additive schema + boot migrations & seed
- `e550362` — R4.4–R7.2 backend: storage, routes, whatsapp, claude, PDF (PO + catalogue)
- `1041d00` — R4.4–R7.2 frontend: admin pages, team PO/RFQ flows, Delhi portal, layout/dashboard updates

> Important: no existing tables or columns were modified or dropped. All new tables created via `CREATE TABLE IF NOT EXISTS` on boot in `server/migrations.ts`. Session A/B/C and Round 3 functionality untouched.

---

## Round 4 — Polish

### R4.1 — Quotations list filters
- `GET /api/team/quotations` now accepts `from`, `to`, `q`, `customerId`, `status` params.
- `TeamQuotations.tsx` rebuilt (308 lines): From/To date pickers, customer dropdown, status pills, presets (Today / This Week / This Month / Last 30), Clear filters, result count badge.

### R4.2 — Parts Master enrichment + history
- New backend functions `searchPartsEnriched` and `getPartQuoteHistory` in `storage-v2.ts`.
- `TeamParts.tsx` rebuilt (240 lines) with columns: Brand · Last Customer · Last Discount · Last Quoted · Quote Count.
- Expandable rows show the last 10 quotes per part with date, customer, qty, rate, discount.

### R4.3 — Premium PDF
- `server/pdf-service.ts` rewritten (664 lines).
- Design language: navy `#1A2540` + Narmada red `#C8102E` accent strips (never behind text), cream `#F9F8F7` cards for BILL TO / SHIP TO / SUMMARY.
- Adds amount-in-words (Indian lakh/crore), authorised-signatory block, page X of Y footer, logo placeholder (red circle with company initial).
- Same `generateQuotationPDF` API; backward compatible.

### R4.4 — AI Ledger basics
- New table `ledger_queries` (id, user_id, question, answer, sql, created_at).
- `POST /api/admin/ledger/ask` — Claude converts NL → safe SELECT SQL → executes → returns rows + explanation.
- `GET  /api/admin/ledger/overdue` — customers with invoices > 30 days unpaid.
- `POST /api/admin/ledger/remind/:customerId` — fires AiSensy + email reminder (fire-and-forget; text fallback if template fails).
- `POST /api/admin/ledger/reconcile` — accepts bank CSV (date, description, amount, ref), matches by amount + ±7-day window, returns matched / unmatched, confirms matched payments.
- New page `AdminAILedger.tsx` with three tabs: Chat NL · Overdue · Reconcile.

---

## Round 5 — Procurement & branch ops

### R5.1 — Additive schema (`server/migrations.ts`)
New tables (all `CREATE TABLE IF NOT EXISTS`):

| Table | Purpose |
|---|---|
| `vendors` | Vendor master (code, name, GSTIN, brands, payment terms, rating, active) |
| `vendor_contacts` | Multiple contacts per vendor (name, role, phone, whatsapp) |
| `companies` | Multi-company billing (NARMADA MOTORS + future entities) |
| `purchase_orders_v` | PO header (suffix `_v` to avoid collision with legacy PO table) |
| `po_items` | PO line items + vendor assignment + purchase_cost + warehouse |
| `rfqs_v` | RFQ header |
| `rfq_items` | RFQ items |
| `rfq_vendors` | RFQ → vendor fan-out + whatsapp_message_id |
| `rfq_quotes` | Vendor responses (raw + Claude-extracted JSON) |
| `vendor_conversations` | WhatsApp mirror — direction in/out, media, extracted JSON |
| `warehouses` | Patna HQ + Delhi seeded on boot |
| `warehouse_transfers` | Inter-warehouse stock moves |
| `rate_history` | Denormalised vendor × part rate timeline |
| `leads` | CRM lead pipeline (source, stage, owner, score, tags) |
| `lead_activities` | Per-lead call/whatsapp/email/note log |
| `targets` | Per-user period targets (month/quarter, metric, target/current) |
| `announcements` | Audience-scoped admin announcements |
| `task_items` | Assigned tasks (title, due, status, priority) |
| `ledger_queries` | AI ledger NL query log (R4.4) |

Boot-time seeding (`server/seed-r5.ts`):
- Company 1 — **NARMADA MOTORS** (Bihar GSTIN 10ASWPP6442P1ZZ, ICICI Exhibition Road A/c, signatory Piyush Anand). Inserted only if `companies` table empty; marked `is_default = true`.
- Warehouses — `PAT` Patna HQ + `DEL` Delhi Warehouse.
- Delhi team users — **Kundan Kumar** (+91 91555 96461) and **Aditya Pawar** (+91 86025 35661), role `delhi_warehouse`, default password `Narmada@2026` (bcrypt).

### R5.2 — Vendor Master + Company Master
- `AdminVendors.tsx` (160 lines) — list + search + add/edit + bulk CSV import + brand/category filter + active toggle.
- `AdminCompanies.tsx` (133 lines) — list + add/edit + set-default + logo upload (base64 data URL).
- Endpoints: `/api/admin/vendors` CRUD + `/bulk-import`, `/api/admin/companies` CRUD + `/:id/set-default`.

### R5.3 — PO flow
- `POST /api/team/quotations/:id/convert-to-po` — produces PO with same items (idempotent per quotation).
- `/api/team/purchase-orders` CRUD; `PUT /api/team/po-items/:id/assign-vendor` body `{vendor_id, purchase_cost}`.
- `GET /api/team/purchase-orders/:id/pdf` — produces PO PDF (same design language).
- `TeamPOs.tsx` + `TeamPODetail.tsx` — list, vendor dropdown per line, purchase cost input (admin-only sees cost), Convert-to-RFQ button.

### R5.4 — RFQ workflow + Claude extraction
- `POST /api/team/rfqs` — create RFQ from PO items or standalone; select vendors.
- `POST /api/team/rfqs/:id/send` — for each rfq_vendor: AiSensy template `vendor_rfq` send (fire-and-forget). **Falls back to free-text WhatsApp on AiSensy 4xx (template not yet approved by Meta).**
- `TeamRFQs.tsx` + `TeamRFQDetail.tsx` — list with status pills; items × vendors matrix with quotes; Select winner per item.
- Claude prompt in `server/claude-service.ts` extracts `{part_number, brand, rate, moq, lead_time_days, notes, confidence}` from raw vendor messages.

### R5.5 — AiSensy inbound webhook + conversation thread
- `POST /api/webhooks/aisensy` — verifies `AISENSY_WEBHOOK_SECRET` header, parses body `{from, message, media_url, message_id, timestamp}`, looks up vendor by phone, inserts `vendor_conversations` direction=in. If an active RFQ exists for that vendor → Claude extraction → writes `rfq_quotes`.
- All outbound WhatsApp sends also mirror into `vendor_conversations` direction=out.
- `AdminVendorInbox.tsx` (83 lines) — unified inbox: vendor list + thread view + reply form.
- Embedded thread component inside RFQ detail.

### R5.6 — Rate history per part per vendor
- Triggered when `rfq_quotes` saved or `po_items` vendor assigned → inserts `rate_history` row.
- `GET /api/team/parts/:partNumber/rates` (and admin variant) — timeline grouped by vendor with Latest / Avg / Min / Max.
- Comparison table embedded in TeamParts expandable section.

### R5.7 — Delhi warehouse dashboard
- New role `delhi_warehouse` + `requireDelhi` middleware.
- `/#/delhi/login` and `/#/delhi/dashboard`.
- `DelhiLogin.tsx` + `DelhiDashboard.tsx` — three-column queue: Pickup → Pack → Dispatch. Each card shows part / qty / vendor name+phone+address / client name + destination city (no purchase cost shown).
- `GET /api/delhi/queue` and `POST /api/delhi/po-items/:id/status` body `{status, docket_no?, courier?, photo_url?}`.
- On Mark Dispatched → auto-creates a `consignments` row using client rate (purchase cost hidden), status `dispatched`, fires customer AiSensy + email notifications.

### R5.8 — Dispatch reminders + client auto-notify
- `setInterval` on boot (every 30 min) scans PO items stuck in pickup > 2 days → fires Delhi reminder.
- Customer notify on dispatch already wired in R5.7.
- Existing `notification_log` is reused; admin view at `AdminNotificationLog.tsx`.

---

## Round 6 — AI & coordination

### R6.1 — AI vendor discovery (Claude + Perplexity)
- `AdminVendorDiscovery.tsx` (88 lines) — input part/brand/category, hits `POST /api/admin/vendor-discovery`.
- Backend calls Perplexity (`sonar-pro` model with web search) for vendor candidates in India; parses → returns name, city, phone (if found), website, source URL, confidence.
- Each candidate has "Send RFQ" — opens prefilled RFQ draft (Hindi+English auto-detected on requirement text).

### R6.2 — Multi-warehouse coordination + payment-to-vendor
- `warehouse_transfers` table created.
- Payment-to-vendor: `POST /api/admin/vendors/:id/payment-notify` fires `payment_confirmation_vendor` template (free-text fallback) with amount + UTR.

### R6.3 — AI ledger reconciliation
- Covered in R4.4. Vendor-side bank recon is out-of-scope (TODO for next round).

---

## Round 7 — Marketing / CRM

### R7.1 — Lead DB + CRM Kanban + targets / announcements / tasks
- `AdminLeads.tsx` (201 lines) — stage dropdown (no drag-drop dep added), source/owner/city filters, bulk CSV import. Indexes on `stage`, `owner_id`, `created_at`, `source` for 100k-scale.
- `AdminTargets.tsx` (109 lines) — set per-user period targets, show progress bars.
- `AdminAnnouncements.tsx` (87 lines) — create/view list with audience scope (all/patna/delhi/admin).
- `AdminTasks.tsx` (105 lines) — assignable tasks with due/priority/status.
- Team dashboard now shows: my announcements, my open tasks, my target progress.
- Endpoints: `/api/admin/leads` CRUD + `/bulk-import` + `/:id/outreach` + `/:id/activities`; `/api/admin/targets` CRUD; `/api/admin/announcements` CRUD + `/api/team/announcements` (audience-filtered); `/api/admin/tasks` CRUD.

### R7.2 — Outreach automation + Ad dashboard shells + Catalogue PDF
- `POST /api/admin/leads/:id/outreach` — Claude drafts WA message in English or Hindi (auto-detect); returns preview; user confirms → AiSensy send.
- `AdminAdsMeta.tsx` / `AdminAdsGoogle.tsx` (shells) — "Connect Meta" / "Connect Google" buttons that toast "OAuth coming soon"; placeholder Spend / Impressions / CTR / Leads cards.
- `POST /api/admin/catalogue/generate` body `{brand?, category?, company_id}` — produces catalogue PDF (same design language) with products, images, MRPs and customer-tier discount. Button on AdminProducts.

---

## Build & Verification

- `npx tsc --noEmit -p .` — **clean** (no errors).
- `npm run build` — **succeeds** (`dist/public` Vite client + `dist/index.cjs` server bundle).
- Last commit on `origin/main`: `1041d00`.

## Env vars to add on Render before R5+ deployment goes live

Already on Render: `SMTP_*`, `BREVO_SMTP_KEY`, `AISENSY_API_KEY`, `CLAUDE_API_KEY`, `ANTHROPIC_API_KEY`, `PPLX_API_KEY`.

**Add now:**
- `AISENSY_PHONE_NUMBER_ID=1069560402916909`
- `AISENSY_WABA_ID=1747557796599432`
- `AISENSY_FROM_NUMBER=919155501082`
- `AISENSY_WEBHOOK_SECRET=<set this in AiSensy webhook config and copy here>`

## Pending (out-of-scope this build, or blocked on Meta)

- WhatsApp number `+91 91555 01082` — status **Pending** with Meta review. Once approved, RFQ template sends will go through; until then, free-text fallback is used.
- New templates (`vendor_rfq`, `payment_confirmation_vendor`) — drafted in code as template calls with text fallback, but they must still be created and approved in AiSensy/Meta UI for the template path to fire.
- AiSensy webhook URL + secret — user must point AiSensy webhook to `https://narmada-backend.onrender.com/api/webhooks/aisensy` and set the shared secret in `AISENSY_WEBHOOK_SECRET` on both sides.
- Logos for NARMADA MOTORS and Companies 2–4 — to be uploaded via `AdminCompanies` UI.
- OAuth flows for Meta Ads + Google Ads connectors (D3 — deferred).
- Vendor-side bank reconciliation (mentioned in R6.3 — deferred).
