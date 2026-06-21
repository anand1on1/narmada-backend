// R27.2 + R27.3 storage layer. All raw better-sqlite3 against rawSqlite (same handle
// the rest of the app uses). Additive tables created in migrations.ts (runR27_2/3).
// Kept in one module so the procurement/store/dispatch/accounts/AI features are cohesive.
import { rawSqlite as sqlite } from "./storage";

const nowIso = () => new Date().toISOString();

// ===========================================================================
// R27.2-1 — Procurement invoice flow (AI client copy + Delhi invoice + deviations)
// ===========================================================================

export interface InvoiceLine { part_number?: string; name?: string; qty?: number; unit_price?: number; total?: number; }

function poLineItemsSnapshot(poId: number, itemIds?: number[]): InvoiceLine[] {
  let items: any[];
  if (Array.isArray(itemIds) && itemIds.length) {
    const placeholders = itemIds.map(() => "?").join(",");
    items = sqlite.prepare(`SELECT id, part_number, description, qty, unit_price, line_total FROM po_items WHERE po_id = ? AND id IN (${placeholders})`).all(poId, ...itemIds) as any[];
  } else {
    items = sqlite.prepare(`SELECT id, part_number, description, qty, unit_price, line_total FROM po_items WHERE po_id = ?`).all(poId) as any[];
  }
  return items.map((it) => ({
    part_number: it.part_number || "",
    name: it.description || "",
    qty: Number(it.qty) || 0,
    unit_price: Number(it.unit_price) || 0,
    total: Number(it.line_total) || (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
  }));
}

function sumLines(lines: InvoiceLine[]) {
  const subtotal = lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
  return { subtotal, tax: 0, total: subtotal };
}

// Create or refresh the AI client copy snapshot from current PO line items.
export function generateInvoiceCopy(poId: number, createdBy?: string) {
  const lines = poLineItemsSnapshot(poId);
  const { subtotal, tax, total } = sumLines(lines);
  // Replace any existing ai_client_copy (idempotent refresh).
  const existing = sqlite.prepare(`SELECT id FROM po_invoice_copies WHERE po_id = ? AND kind = 'ai_client_copy'`).get(poId) as any;
  if (existing) {
    sqlite.prepare(`UPDATE po_invoice_copies SET line_items_json = ?, subtotal = ?, tax = ?, total = ?, created_by = ?, created_at = ? WHERE id = ?`)
      .run(JSON.stringify(lines), subtotal, tax, total, createdBy || null, nowIso(), existing.id);
    return getInvoiceCopy(existing.id);
  }
  const info = sqlite.prepare(
    `INSERT INTO po_invoice_copies (po_id, kind, line_items_json, subtotal, tax, total, created_by, created_at)
     VALUES (?, 'ai_client_copy', ?, ?, ?, ?, ?, ?)`,
  ).run(poId, JSON.stringify(lines), subtotal, tax, total, createdBy || null, nowIso());
  const id = Number(info.lastInsertRowid);
  sqlite.prepare(`UPDATE purchase_orders_v2 SET ai_invoice_copy_id = ? WHERE id = ?`).run(id, poId);
  return getInvoiceCopy(id);
}

export function getInvoiceCopy(id: number) {
  const row = sqlite.prepare(`SELECT * FROM po_invoice_copies WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  return { ...row, line_items: safeParse(row.line_items_json) };
}

// Procurement edits the AI client copy (rates/qty/line items) before sending to client.
export function updateInvoiceCopy(poId: number, body: { line_items?: InvoiceLine[]; invoice_number?: string; invoice_date?: string }, editedBy?: string) {
  const existing = sqlite.prepare(`SELECT id FROM po_invoice_copies WHERE po_id = ? AND kind = 'ai_client_copy'`).get(poId) as any;
  if (!existing) {
    // create it first, then patch
    generateInvoiceCopy(poId, editedBy);
  }
  const cur = sqlite.prepare(`SELECT * FROM po_invoice_copies WHERE po_id = ? AND kind = 'ai_client_copy'`).get(poId) as any;
  const lines: InvoiceLine[] = Array.isArray(body.line_items) ? body.line_items : safeParse(cur.line_items_json);
  const { subtotal, tax, total } = sumLines(lines);
  sqlite.prepare(`UPDATE po_invoice_copies SET line_items_json = ?, subtotal = ?, tax = ?, total = ?, invoice_number = COALESCE(?, invoice_number), invoice_date = COALESCE(?, invoice_date) WHERE id = ?`)
    .run(JSON.stringify(lines), subtotal, tax, total, body.invoice_number ?? null, body.invoice_date ?? null, cur.id);
  return getInvoiceCopy(cur.id);
}

// Delhi creates an invoice post-pack; compares to AI copy and auto-flags deviations.
export function createDelhiInvoice(poId: number, body: { line_items?: InvoiceLine[]; item_ids?: number[]; invoice_number?: string; invoice_date?: string; invoice_pdf_url?: string }, createdBy?: string) {
  // BUG-6 — item-level selection. When item_ids[] is provided, the invoice covers
  // only the selected PO line items; otherwise it covers all (or the explicit lines).
  const itemIds = Array.isArray(body.item_ids) && body.item_ids.length
    ? body.item_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : undefined;
  const lines: InvoiceLine[] = Array.isArray(body.line_items) && body.line_items.length
    ? body.line_items
    : poLineItemsSnapshot(poId, itemIds);
  const { subtotal, tax, total } = sumLines(lines);
  const info = sqlite.prepare(
    `INSERT INTO po_invoice_copies (po_id, kind, invoice_number, invoice_date, invoice_pdf_url, line_items_json, item_ids_json, subtotal, tax, total, created_by, created_at)
     VALUES (?, 'delhi_invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(poId, body.invoice_number ?? null, body.invoice_date ?? null, body.invoice_pdf_url ?? null, JSON.stringify(lines), itemIds ? JSON.stringify(itemIds) : null, subtotal, tax, total, createdBy || null, nowIso());
  const id = Number(info.lastInsertRowid);
  sqlite.prepare(`UPDATE purchase_orders_v2 SET delhi_invoice_id = ?, delhi_invoice_created_at = ? WHERE id = ?`).run(id, nowIso(), poId);

  // R27.5 #6 — procurement invoice received at Delhi adds stock at Delhi. Idempotent
  // per invoice: only record movements the first time this invoice copy is created.
  try {
    for (const l of lines) {
      const qty = Math.trunc(Number(l.qty) || 0);
      if (qty <= 0) continue;
      recordStockMovement({
        branch: "Delhi",
        partNumber: l.part_number || null,
        delta: qty,
        rate: Number(l.unit_price) || null,
        reason: "procurement_invoice",
        referenceId: id,
        referenceTable: "po_invoice_copies",
        notes: body.invoice_number ? `Invoice ${body.invoice_number}` : null,
      });
    }
  } catch (e: any) { console.error("[R27.5 #6] Delhi stock-in on invoice failed:", e?.message || e); }

  // Compare against the AI client copy and flag deviations per mismatched line/field.
  const ai = sqlite.prepare(`SELECT line_items_json FROM po_invoice_copies WHERE po_id = ? AND kind = 'ai_client_copy'`).get(poId) as any;
  if (ai) {
    const aiLines: InvoiceLine[] = safeParse(ai.line_items_json);
    const byPart = new Map<string, InvoiceLine>();
    for (const l of aiLines) byPart.set(String(l.part_number || ""), l);
    for (const dl of lines) {
      const key = String(dl.part_number || "");
      const al = byPart.get(key);
      if (!al) {
        addDeviation(poId, "part_number", "(absent in AI copy)", key, "system", "delhi_invoice");
        continue;
      }
      if (Number(al.qty) !== Number(dl.qty)) addDeviation(poId, "qty", String(al.qty), String(dl.qty), "system", "delhi_invoice", `Part ${key}`);
      if (Number(al.unit_price) !== Number(dl.unit_price)) addDeviation(poId, "rate", String(al.unit_price), String(dl.unit_price), "system", "delhi_invoice", `Part ${key}`);
    }
  }
  return getInvoiceCopy(id);
}

export function listInvoices(poId: number) {
  const rows = sqlite.prepare(`SELECT * FROM po_invoice_copies WHERE po_id = ? ORDER BY id ASC`).all(poId) as any[];
  return rows.map((r) => ({ ...r, line_items: safeParse(r.line_items_json) }));
}

// R27.8 #10 — standalone PDF upload for a procurement invoice copy. Attaches the
// uploaded file URL to the existing po_invoice_copies row (Delhi invoice or AI copy).
export function setInvoiceCopyPdf(id: number, pdfUrl: string) {
  const row = sqlite.prepare(`SELECT id FROM po_invoice_copies WHERE id = ?`).get(id) as any;
  if (!row) throw new Error("Invoice not found");
  sqlite.prepare(`UPDATE po_invoice_copies SET invoice_pdf_url = ? WHERE id = ?`).run(pdfUrl, id);
  return getInvoiceCopy(id);
}

// ===========================================================================
// R27.2-4 — Deviation engine
// ===========================================================================

export function addDeviation(poId: number, field: string, expected: string, actual: string, detectedBy = "system", source = "manual", notes = "") {
  const info = sqlite.prepare(
    `INSERT INTO po_deviations (po_id, field, expected, actual, detected_at, detected_by, source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(poId, field, expected, actual, nowIso(), detectedBy, source, notes || null);
  return Number(info.lastInsertRowid);
}

export function listDeviations(opts: { status?: string; from?: string; to?: string; poId?: number } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.poId) { conds.push("d.po_id = ?"); params.push(opts.poId); }
  if (opts.status === "open") conds.push("d.resolved_at IS NULL");
  if (opts.status === "resolved") conds.push("d.resolved_at IS NOT NULL");
  if (opts.from) { conds.push("d.detected_at >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("d.detected_at <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT d.*, po.po_number AS poNumber
     FROM po_deviations d LEFT JOIN purchase_orders_v2 po ON po.id = d.po_id
     ${where} ORDER BY d.id DESC`,
  ).all(...params);
}

export function resolveDeviation(id: number, resolvedBy?: string, notes?: string) {
  sqlite.prepare(`UPDATE po_deviations SET resolved_at = ?, resolved_by = ?, notes = COALESCE(?, notes) WHERE id = ?`)
    .run(nowIso(), resolvedBy || null, notes ?? null, id);
  return sqlite.prepare(`SELECT * FROM po_deviations WHERE id = ?`).get(id);
}

// Create a sub-PO for the shortfall represented by a deviation (or an explicit po_id).
export async function createSubPoForDeviation(deviationId: number, createdBy?: string) {
  const dev = sqlite.prepare(`SELECT * FROM po_deviations WHERE id = ?`).get(deviationId) as any;
  if (!dev) throw new Error("Deviation not found");
  const v2 = await import("./storage-v2");
  const parent = sqlite.prepare(`SELECT * FROM purchase_orders_v2 WHERE id = ?`).get(dev.po_id) as any;
  if (!parent) throw new Error("Parent PO not found");
  // Build a shortfall line set: items present on the parent PO (the deviation references qty/rate).
  const items = sqlite.prepare(`SELECT * FROM po_items WHERE po_id = ?`).all(dev.po_id) as any[];
  const sub = await v2.createPurchaseOrderV2(
    {
      customerId: parent.customer_id ?? undefined,
      companyId: parent.company_id ?? undefined,
      status: "draft",
      notes: `Sub-PO for deviation #${deviationId} (${dev.field}: expected ${dev.expected}, actual ${dev.actual})`,
    } as any,
    items.map((it) => ({
      description: it.description, partNumber: it.part_number, brand: it.brand,
      qty: it.qty, unitPrice: it.unit_price, discountPct: it.discount_pct,
      taxPct: it.tax_pct, lineTotal: it.line_total,
    })) as any,
  );
  // Persist parent/sub flags directly (createPurchaseOrderV2 may ignore unknown fields).
  try { sqlite.prepare(`UPDATE purchase_orders_v2 SET parent_po_id = ?, is_sub_po = 1 WHERE id = ?`).run(dev.po_id, (sub as any).id); } catch {}
  sqlite.prepare(`UPDATE po_deviations SET sub_po_id = ? WHERE id = ?`).run((sub as any).id, deviationId);
  return sub;
}

export function deviationExportRows() {
  return sqlite.prepare(
    `SELECT d.id, po.po_number AS poNumber, d.field, d.expected, d.actual, d.source,
            d.detected_by, d.detected_at, d.resolved_by, d.resolved_at, d.notes
     FROM po_deviations d LEFT JOIN purchase_orders_v2 po ON po.id = d.po_id
     ORDER BY d.id DESC`,
  ).all() as any[];
}

// Per-PO deviation rollup used by the team PO list (hasDeviation/deviationCount).
export function deviationSummaryForPOs(poIds: number[]): Record<number, { count: number }> {
  const out: Record<number, { count: number }> = {};
  if (!poIds.length) return out;
  const rows = sqlite.prepare(
    `SELECT po_id, COUNT(*) c FROM po_deviations WHERE resolved_at IS NULL AND po_id IN (${poIds.map(() => "?").join(",")}) GROUP BY po_id`,
  ).all(...poIds) as any[];
  for (const r of rows) out[r.po_id] = { count: r.c };
  return out;
}

// ===========================================================================
// R27.2-2/3 — Branch transfers + stock (Delhi -> Patna), store + dispatch flows
// ===========================================================================

export function createBranchTransfer(opts: { poId?: number; consignmentId?: number; notes?: string; fromBranch?: string; toBranch?: string }) {
  // R27.5 #5 — also persist normalized lowercase branch keys so the store query can
  // match case-insensitively regardless of how the source branch name was cased.
  const from = opts.fromBranch || "Delhi";
  const to = opts.toBranch || "Patna";
  const info = sqlite.prepare(
    `INSERT INTO branch_transfers (po_id, consignment_id, from_branch, to_branch, from_branch_key, to_branch_key, dispatched_at, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'in_transit', ?, ?)`,
  ).run(
    opts.poId ?? null, opts.consignmentId ?? null, from, to,
    from.toLowerCase().trim(), to.toLowerCase().trim(),
    nowIso(), opts.notes ?? null, nowIso(),
  );
  return Number(info.lastInsertRowid);
}

export function listTransfers(opts: { status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.status) { conds.push("t.status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const transfers = sqlite.prepare(
    `SELECT t.*, po.po_number AS poNumber, po.customer_id AS customerId,
            po.customer_po_number AS customerPoNumber, c.name AS clientName
     FROM branch_transfers t
     LEFT JOIN purchase_orders_v2 po ON po.id = t.po_id
     LEFT JOIN customers c ON c.id = po.customer_id
     ${where} ORDER BY t.id DESC`,
  ).all(...params) as any[];
  // R27.7 #6 — attach a short item summary (part numbers + names) and the linked
  // transfer-invoice number (#4) so the store/dispatch lists can show real context
  // instead of just quantities.
  const itemSummary = (poId: number | null) => {
    if (!poId) return { items: "Internal Transfer", parts: "" };
    try {
      const rows = sqlite.prepare(`SELECT part_number AS pn, description AS name, qty FROM po_items WHERE po_id = ?`).all(poId) as any[];
      if (!rows.length) return { items: "Internal Transfer", parts: "" };
      return {
        items: rows.map((r) => `${r.name || r.pn}${r.qty ? ` ×${r.qty}` : ""}`).join(", "),
        parts: rows.map((r) => r.pn).filter(Boolean).join(", "),
      };
    } catch { return { items: "", parts: "" }; }
  };
  const invoiceNo = (transferId: number, src: string) => {
    try {
      const r = sqlite.prepare(`SELECT invoice_no FROM transfer_invoices WHERE transfer_id = ? AND transfer_source = ? ORDER BY id DESC LIMIT 1`).get(transferId, src) as any;
      return r?.invoice_no || null;
    } catch { return null; }
  };
  transfers.forEach((t) => {
    t.source = "branch_transfer";
    const sum = itemSummary(t.po_id);
    t.itemSummary = sum.items;
    t.partNumbers = sum.parts;
    t.clientName = t.clientName || (t.po_id ? "—" : "Internal Transfer");
    t.poNumber = t.poNumber || t.customerPoNumber || null;
    t.transferInvoiceNo = invoiceNo(t.id, "branch_transfer");
  });

  // R27.6 #4 — the store dashboard was empty because real Delhi→Patna movement
  // is recorded as a `consignment` (origin/destination), NOT as a branch_transfer
  // (which is only written on the Delhi PO-dispatch path the user rarely uses).
  // Surface every Patna-bound consignment from the last 4 days so the store sees
  // its incoming material. Case-insensitive on destination; excludes terminal
  // states. These are read-only context rows (negative id, has_po=false) so the
  // existing receive flow (which needs a parent PO) stays untouched.
  let consignmentRows: any[] = [];
  try {
    const cutoffMs = Date.now() - 4 * 24 * 60 * 60 * 1000;
    consignmentRows = (sqlite.prepare(
      `SELECT id, docket_number, carrier, origin, destination, status,
              dispatch_date, eta_date, bundles_count, invoice_number
       FROM consignments
       WHERE LOWER(TRIM(destination)) = 'patna'
         AND LOWER(TRIM(COALESCE(status,''))) NOT IN ('received','delivered','cancelled')
       ORDER BY dispatch_date DESC`,
    ).all() as any[])
      .filter((c) => {
        const d = Number(c.dispatch_date);
        // dispatch_date is stored as epoch-ms in this DB; keep last 4 days.
        return !d || d >= cutoffMs;
      })
      .map((c) => ({
        id: -c.id, // negative id namespace so it never collides with a transfer id
        source: "consignment",
        consignment_id: c.id,
        po_id: null,
        poNumber: c.docket_number || null,
        clientName: "Internal Transfer",
        itemSummary: c.carrier ? `Consignment via ${c.carrier}` : "Consignment",
        partNumbers: "",
        from_branch: c.origin || "Delhi",
        to_branch: c.destination || "Patna",
        carrier: c.carrier || null,
        bundles: c.bundles_count ?? null,
        invoice_number: c.invoice_number || null,
        transferInvoiceNo: invoiceNo(c.id, "consignment"),
        status: c.status || "in_transit",
        dispatched_at: c.dispatch_date ? new Date(Number(c.dispatch_date)).toISOString() : null,
        received_at: null,
        notes: c.carrier ? `Consignment via ${c.carrier}` : null,
      }));
    if (opts.status) consignmentRows = consignmentRows.filter((c) => c.status === opts.status);
  } catch { /* consignments table missing — ignore */ }

  return [...transfers, ...consignmentRows];
}

// R27.7 #4 — Transfer-invoice rule. When the store marks a transfer received we
// auto-create a PENDING transfer_invoices row (no invoice number yet). Dispatch
// later fills transport/freight/eway/remarks/PDF and "invoices" it, which assigns
// the running number NM/TRF-INV/26/0001 and flips status to 'invoiced'.
export function ensurePendingTransferInvoice(opts: {
  transferId: number; source: string; sourceBranch?: string | null; destBranch?: string | null; by?: number | null;
}): number | null {
  try {
    const existing = sqlite.prepare(
      `SELECT id FROM transfer_invoices WHERE transfer_id = ? AND transfer_source = ? ORDER BY id DESC LIMIT 1`,
    ).get(opts.transferId, opts.source) as any;
    if (existing) return Number(existing.id);
    const info = sqlite.prepare(
      `INSERT INTO transfer_invoices (transfer_id, transfer_source, source_branch, dest_branch, status, created_at, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(opts.transferId, opts.source, opts.sourceBranch ?? "Delhi", opts.destBranch ?? "Patna", nowIso(), opts.by ?? null);
    return Number(info.lastInsertRowid);
  } catch (e: any) { console.error("[r27.7 #4] ensurePendingTransferInvoice:", e?.message || e); return null; }
}

// Running number: NM/TRF-INV/<FY-yy>/<0001>. FY rolls over on April 1 (Indian FY).
function nextTransferInvoiceNo(): string {
  const now = new Date();
  const fyStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const yy = String((fyStartYear + 1) % 100).padStart(2, "0"); // e.g. FY2025-26 -> "26"
  const prefix = `NM/TRF-INV/${yy}/`;
  const last = sqlite.prepare(
    `SELECT invoice_no FROM transfer_invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`,
  ).get(prefix + "%") as any;
  let seq = 1;
  if (last?.invoice_no) {
    const m = String(last.invoice_no).match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return prefix + String(seq).padStart(4, "0");
}

export function listTransferInvoices(opts: { status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.status) { conds.push("ti.status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite.prepare(
    `SELECT ti.*, t.po_id AS po_id, po.po_number AS poNumber, po.customer_po_number AS customerPoNumber,
            c.name AS clientName
     FROM transfer_invoices ti
     LEFT JOIN branch_transfers t ON t.id = ti.transfer_id AND ti.transfer_source = 'branch_transfer'
     LEFT JOIN purchase_orders_v2 po ON po.id = t.po_id
     LEFT JOIN customers c ON c.id = po.customer_id
     ${where} ORDER BY ti.id DESC`,
  ).all(...params) as any[];
  rows.forEach((r) => {
    r.clientName = r.clientName || (r.po_id ? "—" : "Internal Transfer");
    r.poNumber = r.poNumber || r.customerPoNumber || null;
  });
  return rows;
}

export function getTransferInvoice(id: number) {
  return sqlite.prepare(`SELECT * FROM transfer_invoices WHERE id = ?`).get(id) as any;
}

// Dispatch fills the transfer-invoice details and finalizes it. Assigns the running
// invoice number on first finalize and flips status to 'invoiced'.
export function finalizeTransferInvoice(id: number, fields: {
  transport_vendor?: string | null; vehicle_no?: string | null; freight_charge?: number | null;
  eway_bill_no?: string | null; remarks?: string | null; pdf_url?: string | null;
}, by?: number | null) {
  const inv = getTransferInvoice(id);
  if (!inv) throw new Error("Transfer invoice not found");
  const invoiceNo = inv.invoice_no || nextTransferInvoiceNo();
  sqlite.prepare(
    `UPDATE transfer_invoices SET invoice_no = ?, transport_vendor = ?, vehicle_no = ?, freight_charge = ?,
        eway_bill_no = ?, remarks = ?, pdf_url = COALESCE(?, pdf_url), status = 'invoiced',
        invoiced_at = ?, created_by = COALESCE(created_by, ?)
     WHERE id = ?`,
  ).run(
    invoiceNo,
    fields.transport_vendor ?? inv.transport_vendor ?? null,
    fields.vehicle_no ?? inv.vehicle_no ?? null,
    fields.freight_charge != null ? Number(fields.freight_charge) : (inv.freight_charge ?? null),
    fields.eway_bill_no ?? inv.eway_bill_no ?? null,
    fields.remarks ?? inv.remarks ?? null,
    fields.pdf_url ?? null,
    nowIso(),
    by ?? null,
    id,
  );
  return getTransferInvoice(id);
}

// ============================================================================
// R27.8 #3 — Dispatch invoice flow (new dispatch_invoices + dispatch_invoice_items).
// Invoice numbers are USER-ENTERED text (not auto-generated). The store
// mark-received path no longer auto-creates these; dispatch creates them
// explicitly and assigns received stock items to them.
// ============================================================================

// Companies dropdown (reuses the existing R5.1 companies table).
export function listDispatchCompanies() {
  try {
    return sqlite.prepare(`SELECT id, name, code FROM companies WHERE COALESCE(is_active,1) = 1 ORDER BY name ASC`).all() as any[];
  } catch { return []; }
}

// Clients dropdown (customers master).
export function listDispatchClients() {
  try {
    return sqlite.prepare(`SELECT id, name FROM customers ORDER BY name ASC`).all() as any[];
  } catch { return []; }
}

// Stock tab: every received transfer line item, with its current invoice assignment.
export function listDispatchStockItems() {
  // branch_received_items holds one row per received line. Join the parent transfer
  // + PO + customer for context, and the dispatch_invoice_items row (if assigned)
  // to surface the assignment + tick state. processed invoices drop out of the
  // assignable pool but their items still show (read-only, marked processed).
  const rows = sqlite.prepare(
    `SELECT ri.id AS transfer_item_id, ri.transfer_id, ri.part_number AS partNo, ri.received_qty AS quantity,
            t.po_id AS po_id, po.po_number AS poNumber, po.customer_po_number AS customerPoNumber,
            c.name AS clientName,
            dii.id AS dispatch_invoice_item_id, dii.dispatch_invoice_id AS dispatchInvoiceId,
            dii.ticked_at AS tickedAt, di.invoice_no AS invoiceNo, di.status AS invoiceStatus
     FROM branch_received_items ri
     LEFT JOIN branch_transfers t ON t.id = ri.transfer_id
     LEFT JOIN purchase_orders_v2 po ON po.id = t.po_id
     LEFT JOIN customers c ON c.id = po.customer_id
     LEFT JOIN dispatch_invoice_items dii ON dii.transfer_item_id = ri.id
     LEFT JOIN dispatch_invoices di ON di.id = dii.dispatch_invoice_id
     WHERE ri.received_qty > 0
     ORDER BY ri.id DESC`,
  ).all() as any[];
  // Attach item name from po_items by part number (best-effort).
  rows.forEach((r) => {
    r.poNumber = r.poNumber || r.customerPoNumber || (r.po_id ? String(r.po_id) : null);
    r.clientName = r.clientName || "Internal Transfer";
    if (r.partNo && r.po_id) {
      try {
        const it = sqlite.prepare(`SELECT description AS name FROM po_items WHERE po_id = ? AND part_number = ? LIMIT 1`).get(r.po_id, r.partNo) as any;
        r.itemName = it?.name || null;
      } catch { r.itemName = null; }
    } else r.itemName = null;
  });
  return rows;
}

export function createDispatchInvoice(opts: { invoice_no: string; company_id?: number | null; client_id?: number | null; by?: number | null }) {
  const invoiceNo = String(opts.invoice_no || "").trim();
  if (!invoiceNo) throw new Error("Invoice number is required");
  const info = sqlite.prepare(
    `INSERT INTO dispatch_invoices (invoice_no, company_id, client_id, status, created_by, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(invoiceNo, opts.company_id ?? null, opts.client_id ?? null, opts.by ?? null, nowIso());
  return getDispatchInvoice(Number(info.lastInsertRowid));
}

export function getDispatchInvoice(id: number) {
  return sqlite.prepare(
    `SELECT di.*, co.name AS companyName, cu.name AS clientName,
            (SELECT COUNT(*) FROM dispatch_invoice_items WHERE dispatch_invoice_id = di.id) AS itemsCount
     FROM dispatch_invoices di
     LEFT JOIN companies co ON co.id = di.company_id
     LEFT JOIN customers cu ON cu.id = di.client_id
     WHERE di.id = ?`,
  ).get(id) as any;
}

export function listDispatchInvoices(opts: { status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.status) { conds.push("di.status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT di.*, co.name AS companyName, cu.name AS clientName,
            (SELECT COUNT(*) FROM dispatch_invoice_items WHERE dispatch_invoice_id = di.id) AS itemsCount
     FROM dispatch_invoices di
     LEFT JOIN companies co ON co.id = di.company_id
     LEFT JOIN customers cu ON cu.id = di.client_id
     ${where} ORDER BY di.id DESC`,
  ).all(...params) as any[];
}

export function getDispatchInvoiceDetail(id: number) {
  const inv = getDispatchInvoice(id);
  if (!inv) return undefined;
  const items = sqlite.prepare(`SELECT * FROM dispatch_invoice_items WHERE dispatch_invoice_id = ? ORDER BY id ASC`).all(id) as any[];
  return { ...inv, items };
}

// Assign a received stock line to a pending invoice (snapshots its context columns).
export function assignDispatchItem(invoiceId: number, transferItemId: number) {
  const inv = getDispatchInvoice(invoiceId);
  if (!inv) throw new Error("Invoice not found");
  if (String(inv.status) !== "pending") throw new Error("Cannot assign to a processed invoice");
  const ri = sqlite.prepare(
    `SELECT ri.id, ri.part_number AS partNo, ri.received_qty AS quantity, t.po_id AS po_id,
            po.po_number AS poNumber, po.customer_po_number AS customerPoNumber, c.name AS clientName
     FROM branch_received_items ri
     LEFT JOIN branch_transfers t ON t.id = ri.transfer_id
     LEFT JOIN purchase_orders_v2 po ON po.id = t.po_id
     LEFT JOIN customers c ON c.id = po.customer_id
     WHERE ri.id = ?`,
  ).get(transferItemId) as any;
  if (!ri) throw new Error("Stock item not found");
  // One assignment per stock line: clear any existing assignment first.
  sqlite.prepare(`DELETE FROM dispatch_invoice_items WHERE transfer_item_id = ?`).run(transferItemId);
  let itemName: string | null = null;
  if (ri.partNo && ri.po_id) {
    try { itemName = (sqlite.prepare(`SELECT description AS name FROM po_items WHERE po_id = ? AND part_number = ? LIMIT 1`).get(ri.po_id, ri.partNo) as any)?.name || null; } catch { /* ignore */ }
  }
  sqlite.prepare(
    `INSERT INTO dispatch_invoice_items (dispatch_invoice_id, transfer_item_id, po_no, client_name, item_name, part_no, quantity, assigned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(invoiceId, transferItemId, ri.poNumber || ri.customerPoNumber || (ri.po_id ? String(ri.po_id) : null), ri.clientName || "Internal Transfer", itemName, ri.partNo || null, ri.quantity ?? null, nowIso());
  return getDispatchInvoiceDetail(invoiceId);
}

export function removeDispatchItem(transferItemId: number) {
  sqlite.prepare(`DELETE FROM dispatch_invoice_items WHERE transfer_item_id = ?`).run(transferItemId);
  return { ok: true };
}

export function tickDispatchItem(transferItemId: number, ticked: boolean) {
  sqlite.prepare(`UPDATE dispatch_invoice_items SET ticked_at = ? WHERE transfer_item_id = ?`)
    .run(ticked ? nowIso() : null, transferItemId);
  return { ok: true };
}

export function markDispatchInvoiceProcessed(id: number) {
  const inv = getDispatchInvoice(id);
  if (!inv) throw new Error("Invoice not found");
  if (Number(inv.itemsCount) < 1) throw new Error("Add at least one item before processing");
  if (String(inv.status) === "processed") throw new Error("Invoice already processed");
  sqlite.prepare(`UPDATE dispatch_invoices SET status = 'processed', processed_at = ? WHERE id = ?`).run(nowIso(), id);
  return getDispatchInvoice(id);
}

// Same-day unlock: a processed invoice can be reopened within 24h of processing.
export function unlockDispatchInvoice(id: number) {
  const inv = getDispatchInvoice(id);
  if (!inv) throw new Error("Invoice not found");
  if (String(inv.status) !== "processed") throw new Error("Invoice is not processed");
  const processedMs = inv.processed_at ? Date.parse(inv.processed_at) : 0;
  if (!processedMs || (Date.now() - processedMs) > 24 * 60 * 60 * 1000) throw new Error("Unlock window (24h) has passed");
  sqlite.prepare(`UPDATE dispatch_invoices SET status = 'pending', unlocked_at = ? WHERE id = ?`).run(nowIso(), id);
  return getDispatchInvoice(id);
}

export function getTransferDetail(id: number) {
  const t = sqlite.prepare(
    `SELECT t.*, po.po_number AS poNumber FROM branch_transfers t LEFT JOIN purchase_orders_v2 po ON po.id = t.po_id WHERE t.id = ?`,
  ).get(id) as any;
  if (!t) return undefined;
  // Expected items = parent PO line items (or already-recorded received items if present).
  let expected: any[] = [];
  if (t.po_id) {
    expected = sqlite.prepare(`SELECT part_number AS partNumber, description AS name, qty AS expectedQty, unit_price AS rate FROM po_items WHERE po_id = ?`).all(t.po_id) as any[];
  }
  const received = sqlite.prepare(`SELECT * FROM branch_received_items WHERE transfer_id = ?`).all(id) as any[];
  return { ...t, expected, received };
}

// Store incharge marks received quantities. Shortfall -> deviation + sub-PO; stock rows added.
export async function receiveTransfer(transferId: number, items: Array<{ part_number: string; product_id?: number; expected_qty: number; received_qty: number; rate?: number; reason?: string }>, receivedBy?: number) {
  const t = sqlite.prepare(`SELECT * FROM branch_transfers WHERE id = ?`).get(transferId) as any;
  if (!t) throw new Error("Transfer not found");
  // R27.8 #2 — idempotency: reject a second receive on an already-received transfer.
  if (String(t.status) === "received") throw new Error("Transfer already received");
  let anyShort = false;
  const tx = sqlite.transaction(() => {
    for (const it of items) {
      const dev = (Number(it.expected_qty) || 0) - (Number(it.received_qty) || 0);
      sqlite.prepare(
        `INSERT INTO branch_received_items (transfer_id, part_number, product_id, expected_qty, received_qty, deviation_qty, reason, marked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(transferId, it.part_number || null, it.product_id ?? null, Number(it.expected_qty) || 0, Number(it.received_qty) || 0, dev, it.reason ?? (dev > 0 ? "short" : null), nowIso());
      if (Number(it.received_qty) > 0) {
        sqlite.prepare(
          `INSERT INTO branch_stock (branch, branch_key, product_id, part_number, po_id, qty, rate, received_at, status)
           VALUES ('Patna', 'patna', ?, ?, ?, ?, ?, ?, 'in_stock')`,
        ).run(it.product_id ?? null, it.part_number || null, t.po_id ?? null, Number(it.received_qty) || 0, it.rate ?? null, nowIso());
        // R27.5 #6 — also log the inbound to the stock ledger (transfer received at Patna).
        sqlite.prepare(
          `INSERT INTO stock_movements (branch, branch_key, product_id, part_number, delta, reason, reference_id, reference_table, created_at)
           VALUES ('Patna', 'patna', ?, ?, ?, 'transfer_received', ?, 'branch_transfers', ?)`,
        ).run(it.product_id ?? null, it.part_number || null, Number(it.received_qty) || 0, transferId, nowIso());
      }
      if (dev > 0 && t.po_id) { anyShort = true; addDeviation(t.po_id, "qty", String(it.expected_qty), String(it.received_qty), "store", "store_receive", `Part ${it.part_number} short by ${dev}`); }
    }
    const allReceived = items.every((it) => (Number(it.received_qty) || 0) >= (Number(it.expected_qty) || 0));
    sqlite.prepare(`UPDATE branch_transfers SET received_at = ?, received_by = ?, status = ? WHERE id = ?`)
      .run(nowIso(), receivedBy ?? null, allReceived ? "received" : "partial_received", transferId);
  });
  tx();
  // R27.8 #3 — store mark-received now ONLY updates transfer status. The R27.7
  // auto-created pending transfer_invoice is removed; dispatch invoices are created
  // explicitly via the new dispatch_invoices flow. (transfer_invoices kept as legacy.)
  // Create one sub-PO for the whole transfer if there was any shortfall (R27.2-4 link).
  if (anyShort && t.po_id) {
    try {
      const devs = sqlite.prepare(`SELECT id FROM po_deviations WHERE po_id = ? AND source = 'store_receive' AND sub_po_id IS NULL ORDER BY id DESC LIMIT 1`).get(t.po_id) as any;
      if (devs) await createSubPoForDeviation(devs.id, "store");
    } catch (e: any) { console.error("[r27.2] sub-PO on receive failed:", e?.message || e); }
  }
  return getTransferDetail(transferId);
}

// R27.5 #6 — single source of truth for stock changes. Adjusts branch_stock for the
// given branch/part and writes an append-only stock_movements ledger row. Positive
// delta = inbound (procurement / transfer receipt), negative = outbound (customer order).
export function recordStockMovement(opts: {
  branch: string;
  productId?: number | null;
  partNumber?: string | null;
  delta: number;
  reason: string;
  referenceId?: number | null;
  referenceTable?: string | null;
  rate?: number | null;
  notes?: string | null;
}) {
  const branch = (opts.branch || "Delhi").trim();
  const branchKey = branch.toLowerCase();
  const delta = Math.trunc(Number(opts.delta) || 0);
  if (!delta) return;
  const tx = sqlite.transaction(() => {
    if (delta > 0) {
      sqlite.prepare(
        `INSERT INTO branch_stock (branch, branch_key, product_id, part_number, po_id, qty, rate, received_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
      ).run(branch, branchKey, opts.productId ?? null, opts.partNumber ?? null, opts.referenceId ?? null, delta, opts.rate ?? null, nowIso());
    } else {
      // Deduct FIFO from in-stock rows at this branch matching the part.
      let remaining = -delta;
      const rows = sqlite.prepare(
        `SELECT id, qty FROM branch_stock WHERE LOWER(TRIM(branch)) = ? AND status = 'in_stock'
           AND (part_number = ? OR product_id = ?) AND qty > 0 ORDER BY id ASC`,
      ).all(branchKey, opts.partNumber ?? null, opts.productId ?? null) as any[];
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, row.qty);
        sqlite.prepare(`UPDATE branch_stock SET qty = qty - ? WHERE id = ?`).run(take, row.id);
        remaining -= take;
      }
    }
    sqlite.prepare(
      `INSERT INTO stock_movements (branch, branch_key, product_id, part_number, delta, reason, reference_id, reference_table, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(branch, branchKey, opts.productId ?? null, opts.partNumber ?? null, delta, opts.reason, opts.referenceId ?? null, opts.referenceTable ?? null, opts.notes ?? null, nowIso());
  });
  tx();
}

export function listStockMovements(opts: { branch?: string; partNumber?: string; limit?: number } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.branch) { conds.push("LOWER(TRIM(branch)) = ?"); params.push(opts.branch.toLowerCase().trim()); }
  if (opts.partNumber) { conds.push("part_number = ?"); params.push(opts.partNumber); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(1000, Math.max(1, opts.limit || 200));
  return sqlite.prepare(`SELECT * FROM stock_movements ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
}

export function listBranchStock(branch = "Patna", status = "in_stock") {
  return sqlite.prepare(
    `SELECT s.*, p.name AS productName FROM branch_stock s LEFT JOIN products p ON p.id = s.product_id
     WHERE s.branch = ? AND s.status = ? ORDER BY s.id DESC`,
  ).all(branch, status);
}

// R27.4 BUG-8 — admin stock view: per-product per-branch stock with optional
// branch filter + free-text search (part number or product name). Branch column
// surfaces Delhi vs Patna; when no branch is given, both are returned.
export function listBranchStockAdmin(opts: { branch?: string; q?: string; status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  // R27.5 #6 — case-insensitive branch match (LOWER) so 'delhi'/'Delhi' both work.
  if (opts.branch) { conds.push("LOWER(TRIM(s.branch)) = ?"); params.push(opts.branch.toLowerCase().trim()); }
  if (opts.status) { conds.push("s.status = ?"); params.push(opts.status); }
  if (opts.q) {
    const like = `%${opts.q}%`;
    conds.push("(s.part_number LIKE ? OR p.name LIKE ?)");
    params.push(like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT s.*, p.name AS productName FROM branch_stock s LEFT JOIN products p ON p.id = s.product_id
     ${where} ORDER BY s.branch ASC, s.id DESC`,
  ).all(...params);
}

// R27.5 #6 — live aggregated stock: net qty per part per branch (sums all in-stock rows
// after procurement / transfer / order movements). Powers the Stock page summary view.
export function listBranchStockSummary(opts: { branch?: string; q?: string } = {}) {
  const conds: string[] = ["s.status = 'in_stock'"]; const params: any[] = [];
  if (opts.branch) { conds.push("LOWER(TRIM(s.branch)) = ?"); params.push(opts.branch.toLowerCase().trim()); }
  if (opts.q) { const like = `%${opts.q}%`; conds.push("(s.part_number LIKE ? OR p.name LIKE ?)"); params.push(like, like); }
  const where = `WHERE ${conds.join(" AND ")}`;
  return sqlite.prepare(
    `SELECT MIN(s.id) AS id, s.branch AS branch, s.part_number AS part_number,
            MAX(s.product_id) AS product_id, MAX(p.name) AS productName,
            SUM(s.qty) AS qty, AVG(s.rate) AS rate, MAX(s.received_at) AS received_at, 'in_stock' AS status
     FROM branch_stock s LEFT JOIN products p ON p.id = s.product_id
     ${where}
     GROUP BY LOWER(TRIM(s.branch)), s.part_number
     HAVING SUM(s.qty) <> 0
     ORDER BY branch ASC, productName ASC`,
  ).all(...params);
}

export function dispatchReady(branch = "Patna") {
  return listBranchStock(branch, "in_stock");
}

export function dispatchHandover(stockIds: number[], customerId?: number, invoiceNumber?: string) {
  if (!Array.isArray(stockIds) || !stockIds.length) throw new Error("No stock items selected");
  const tx = sqlite.transaction(() => {
    for (const id of stockIds) {
      sqlite.prepare(`UPDATE branch_stock SET status = 'dispatched', client_id = COALESCE(?, client_id) WHERE id = ?`).run(customerId ?? null, id);
    }
  });
  tx();
  return { ok: true, dispatched: stockIds.length, invoiceNumber: invoiceNumber || null };
}

// ===========================================================================
// R27.2-5 — Auto-product creation from procurement (on dispatched)
// ===========================================================================

function getMarkupPct(): number {
  const row = sqlite.prepare(`SELECT value FROM shop_settings WHERE key = 'auto_product_markup_pct'`).get() as any;
  const pct = Number(row?.value);
  return Number.isFinite(pct) && pct > 0 ? pct : 20;
}

function slugify(s: string): string {
  return String(s || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `product-${Date.now()}`;
}

// For each PO line item, create a draft (inactive) product if part_number not present.
export function autoCreateProductsForPo(poId: number): { created: number; skipped: number } {
  const markup = getMarkupPct();
  const items = sqlite.prepare(`SELECT part_number, description, brand, unit_price, purchase_cost, vendor_id, vendor_name FROM po_items WHERE po_id = ?`).all(poId) as any[];
  let created = 0, skipped = 0;
  for (const it of items) {
    const pn = String(it.part_number || "").trim();
    if (!pn) { skipped++; continue; }
    const exists = sqlite.prepare(`SELECT id FROM products WHERE part_number = ?`).get(pn) as any;
    if (exists) { skipped++; continue; }
    const vendorPrice = Number(it.purchase_cost ?? it.unit_price) || 0;
    const sell = Math.round(vendorPrice * (1 + markup / 100));
    const name = String(it.description || pn).slice(0, 200);
    // R27.5 #7 — populate brand so the public product page shows it. Priority:
    // PO line item brand → seller (vendor) default brand (vendors.brands, first entry).
    // Only falls back to "Genuine OEM" when nothing is available (never blank).
    let brand = String(it.brand || "").trim();
    if (!brand && it.vendor_id) {
      const v = sqlite.prepare(`SELECT brands FROM vendors WHERE id = ?`).get(it.vendor_id) as any;
      const raw = String(v?.brands || "").trim();
      if (raw) brand = raw.split(/[,;|]/)[0].trim();
    }
    if (!brand) brand = "Genuine OEM";
    let slug = slugify(name + "-" + pn);
    // ensure unique slug
    if (sqlite.prepare(`SELECT id FROM products WHERE slug = ?`).get(slug)) slug = `${slug}-${Date.now()}`;
    try {
      sqlite.prepare(
        `INSERT INTO products (slug, name, brand, model, category, part_number, description, short_description, price_inr, stock_qty, image_urls, compatible_models, featured, active, created_at)
         VALUES (?, ?, ?, '', 'other', ?, ?, ?, ?, 0, '[]', '[]', 0, 0, ?)`,
      ).run(slug, name, brand, pn, name, name, sell, Date.now());
      created++;
    } catch (e: any) { console.error("[r27.2] auto-product failed for", pn, e?.message || e); skipped++; }
  }
  return { created, skipped };
}

// ===========================================================================
// R27.2-6 — Sales expense approval
// ===========================================================================

export function listSalesExpensesAdmin(opts: { status?: string; userId?: number; from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.status) { conds.push("e.approval_status = ?"); params.push(opts.status); }
  if (opts.userId) { conds.push("e.sales_user_id = ?"); params.push(opts.userId); }
  if (opts.from) { conds.push("e.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("e.expense_date <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT e.*, u.name AS salesName, u.username AS salesUsername
     FROM sales_expenses e LEFT JOIN data_team_users u ON u.id = e.sales_user_id
     ${where} ORDER BY e.id DESC`,
  ).all(...params).map((r: any) => ({ ...r, fields: safeParse(r.fields_json) }));
}

export function approveSalesExpense(id: number, approverId?: number, note?: string) {
  sqlite.prepare(`UPDATE sales_expenses SET approval_status = 'approved', approver_id = ?, approval_note = ?, approved_at = ?, status = 'approved' WHERE id = ?`)
    .run(approverId ?? null, note ?? null, nowIso(), id);
  // R27.6 #7 — on approval, mirror into the unified expenses table so it shows in
  // the accounts dashboard. Idempotent + best-effort (never block the approval).
  try { syncSalesExpenseToAccounts(id, approverId); } catch (e: any) { console.error("[R27.6] sales-expense sync failed:", e?.message || e); }
  return sqlite.prepare(`SELECT * FROM sales_expenses WHERE id = ?`).get(id);
}

export function rejectSalesExpense(id: number, approverId?: number, note?: string) {
  sqlite.prepare(`UPDATE sales_expenses SET approval_status = 'rejected', approver_id = ?, approval_note = ?, rejected_at = ?, status = 'rejected' WHERE id = ?`)
    .run(approverId ?? null, note ?? null, nowIso(), id);
  return sqlite.prepare(`SELECT * FROM sales_expenses WHERE id = ?`).get(id);
}

// ===========================================================================
// R27.3-1 — Accounts dashboard
// ===========================================================================

// Expense headers
export function listExpenseHeaders() {
  return sqlite.prepare(`SELECT * FROM expense_headers ORDER BY name ASC`).all().map((r: any) => ({ ...r, fields: safeParse(r.fields_json) }));
}
export function createExpenseHeader(name: string, fields: any[], extra?: { gl_code?: string; budget?: number; parent_id?: number }) {
  const info = sqlite.prepare(`INSERT INTO expense_headers (name, fields_json, gl_code, budget, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(name, JSON.stringify(fields || []), extra?.gl_code ?? null, extra?.budget ?? null, extra?.parent_id ?? null, nowIso());
  return sqlite.prepare(`SELECT * FROM expense_headers WHERE id = ?`).get(Number(info.lastInsertRowid));
}
export function updateExpenseHeader(id: number, name?: string, fields?: any[], extra?: { gl_code?: string; budget?: number; parent_id?: number }) {
  sqlite.prepare(`UPDATE expense_headers SET name = COALESCE(?, name), fields_json = COALESCE(?, fields_json), gl_code = COALESCE(?, gl_code), budget = COALESCE(?, budget), parent_id = COALESCE(?, parent_id) WHERE id = ?`)
    .run(name ?? null, fields ? JSON.stringify(fields) : null, extra?.gl_code ?? null, extra?.budget ?? null, extra?.parent_id ?? null, id);
  return sqlite.prepare(`SELECT * FROM expense_headers WHERE id = ?`).get(id);
}
export function deleteExpenseHeader(id: number) { sqlite.prepare(`DELETE FROM expense_headers WHERE id = ?`).run(id); return { ok: true }; }

// Cash in hand — R27.5 #8: per-branch register. `direction` ('in'|'out') is stored
// for display; the signed `amount` (negative for outflow) is the source of truth for
// the running balance, so totals stay correct even on legacy rows with no direction.
export function listCash(branch?: string) {
  let rows: any[];
  if (branch && branch !== "all") {
    rows = sqlite.prepare(`SELECT * FROM cash_in_hand WHERE LOWER(TRIM(COALESCE(branch,'Delhi'))) = LOWER(TRIM(?)) ORDER BY id DESC`).all(branch) as any[];
  } else {
    rows = sqlite.prepare(`SELECT * FROM cash_in_hand ORDER BY id DESC`).all() as any[];
  }
  const balance = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  // per-branch breakdown for the register header
  const byBranch = sqlite.prepare(
    `SELECT COALESCE(branch,'Delhi') branch, COALESCE(SUM(amount),0) balance FROM cash_in_hand GROUP BY COALESCE(branch,'Delhi')`,
  ).all() as any[];
  return { rows, balance, byBranch };
}
export function createCash(body: { source: string; amount: number; reference?: string; notes?: string; date?: string; branch?: string; direction?: string }, by?: number) {
  const direction = body.direction === "out" ? "out" : "in";
  // store a signed amount so SUM() gives the true balance regardless of direction
  const signed = direction === "out" ? -Math.abs(Number(body.amount) || 0) : Math.abs(Number(body.amount) || 0);
  const info = sqlite.prepare(`INSERT INTO cash_in_hand (source, amount, reference, date, notes, branch, direction, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(body.source, signed, body.reference ?? null, body.date ?? nowIso(), body.notes ?? null, body.branch ?? "Delhi", direction, by ?? null);
  return sqlite.prepare(`SELECT * FROM cash_in_hand WHERE id = ?`).get(Number(info.lastInsertRowid));
}

// Advance expenses + reconciliations
export function listAdvances(opts: { employeeId?: number; status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.employeeId) { conds.push("a.employee_id = ?"); params.push(opts.employeeId); }
  if (opts.status) { conds.push("a.status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT a.*, e.name AS employeeName,
       (SELECT COALESCE(SUM(amount),0) FROM advance_reconciliations r WHERE r.advance_id = a.id) AS reconciledAmount
     FROM advance_expenses a LEFT JOIN employees e ON e.id = a.employee_id ${where} ORDER BY a.id DESC`,
  ).all(...params);
}
export function createAdvance(body: { employee_id: number; amount_given: number; purpose?: string }, by?: number) {
  const info = sqlite.prepare(`INSERT INTO advance_expenses (employee_id, amount_given, given_at, purpose, status, given_by) VALUES (?, ?, ?, ?, 'open', ?)`)
    .run(body.employee_id, Number(body.amount_given) || 0, nowIso(), body.purpose ?? null, by ?? null);
  const id = Number(info.lastInsertRowid);
  addPersonLedger(body.employee_id, "advance_given", Number(body.amount_given) || 0, id, "advance_expenses", body.purpose);
  return sqlite.prepare(`SELECT * FROM advance_expenses WHERE id = ?`).get(id);
}
export function reconcileAdvance(advanceId: number, body: { expense_header_id?: number; amount: number; description?: string; proof_url?: string }) {
  const info = sqlite.prepare(`INSERT INTO advance_reconciliations (advance_id, expense_header_id, amount, description, proof_url, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(advanceId, body.expense_header_id ?? null, Number(body.amount) || 0, body.description ?? null, body.proof_url ?? null, nowIso());
  // recompute status
  const adv = sqlite.prepare(`SELECT * FROM advance_expenses WHERE id = ?`).get(advanceId) as any;
  const recon = sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM advance_reconciliations WHERE advance_id = ?`).get(advanceId) as any;
  const status = recon.s >= adv.amount_given ? "reconciled" : (recon.s > 0 ? "partial" : "open");
  sqlite.prepare(`UPDATE advance_expenses SET status = ?, reconciled_at = ? WHERE id = ?`).run(status, status === "reconciled" ? nowIso() : null, advanceId);
  addPersonLedger(adv.employee_id, "reconciled", -(Number(body.amount) || 0), Number(info.lastInsertRowid), "advance_reconciliations", body.description);
  return sqlite.prepare(`SELECT * FROM advance_expenses WHERE id = ?`).get(advanceId);
}

// Current expenses
export function listCurrentExpenses(opts: { from?: string; to?: string; headerId?: number; branch?: string; status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.headerId) { conds.push("c.expense_header_id = ?"); params.push(opts.headerId); }
  if (opts.from) { conds.push("c.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("c.expense_date <= ?"); params.push(opts.to); }
  if (opts.branch && opts.branch !== "all") { conds.push("LOWER(TRIM(COALESCE(c.branch,''))) = LOWER(TRIM(?))"); params.push(opts.branch); }
  if (opts.status && opts.status !== "all") { conds.push("COALESCE(c.approval_status,'approved') = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT c.*, h.name AS headerName FROM current_expenses c LEFT JOIN expense_headers h ON h.id = c.expense_header_id ${where} ORDER BY c.id DESC`,
  ).all(...params).map((r: any) => ({ ...r, fields_data: safeParse(r.fields_data_json) }));
}
export function createCurrentExpense(body: { expense_header_id: number; amount: number; fields_data?: any; proof_url?: string; expense_date: string; branch?: string }, by?: number) {
  // R27.5 #8 — approval workflow: amounts at/under the configured limit auto-approve;
  // larger ones land as 'pending' until an admin approves.
  let limit = 5000;
  try { const s = sqlite.prepare(`SELECT value FROM shop_settings WHERE key='expense_auto_approve_limit'`).get() as any; if (s?.value) limit = Number(s.value) || 5000; } catch {}
  const amount = Number(body.amount) || 0;
  const status = amount <= limit ? "approved" : "pending";
  const info = sqlite.prepare(`INSERT INTO current_expenses (expense_header_id, amount, fields_data_json, proof_url, expense_date, branch, approval_status, approved_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(body.expense_header_id, amount, JSON.stringify(body.fields_data || {}), body.proof_url ?? null, body.expense_date, body.branch ?? null, status, status === "approved" ? nowIso() : null, by ?? null, nowIso());
  return sqlite.prepare(`SELECT * FROM current_expenses WHERE id = ?`).get(Number(info.lastInsertRowid));
}
export function approveCurrentExpense(id: number, by?: number) {
  sqlite.prepare(`UPDATE current_expenses SET approval_status='approved', approved_by=?, approved_at=? WHERE id=?`).run(by ?? null, nowIso(), id);
  return sqlite.prepare(`SELECT * FROM current_expenses WHERE id = ?`).get(id);
}
export function rejectCurrentExpense(id: number, by?: number) {
  sqlite.prepare(`UPDATE current_expenses SET approval_status='rejected', approved_by=?, approved_at=? WHERE id=?`).run(by ?? null, nowIso(), id);
  return sqlite.prepare(`SELECT * FROM current_expenses WHERE id = ?`).get(id);
}

// Person ledger
export function addPersonLedger(personId: number, kind: string, amount: number, refId?: number, refTable?: string, notes?: string) {
  sqlite.prepare(`INSERT INTO person_ledger (person_id, kind, amount, reference_id, reference_table, notes, entry_date) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(personId, kind, amount, refId ?? null, refTable ?? null, notes ?? null, nowIso());
}
export function getPersonLedger(personId: number) {
  const rows = sqlite.prepare(`SELECT * FROM person_ledger WHERE person_id = ? ORDER BY id ASC`).all(personId) as any[];
  let running = 0;
  const withBalance = rows.map((r) => { running += Number(r.amount) || 0; return { ...r, balance: running }; });
  return { rows: withBalance, balance: running };
}

// ===========================================================================
// R27.6 #6 — Unified expense model: ADVANCE flow (staff gets cash first, expenses
// settle against the balance, auto-settle at 0, Return Cash) + DIRECT flow
// (accounts enters straight, payment_mode, posts to person/cash ledger).
// Reads also UNION approved sales_expenses so #7 syncs into the same dashboard.
// ===========================================================================

// ---- Expense advances ----
export function listExpenseAdvances(opts: { staffId?: number; status?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.staffId) { conds.push("a.staff_id = ?"); params.push(opts.staffId); }
  if (opts.status && opts.status !== "all") { conds.push("a.status = ?"); params.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return sqlite.prepare(
    `SELECT a.*, e.name AS staffName,
       (SELECT COALESCE(SUM(x.amount),0) FROM expenses x WHERE x.advance_id = a.id) AS settledAmount
     FROM expense_advances a LEFT JOIN employees e ON e.id = a.staff_id ${where} ORDER BY a.id DESC`,
  ).all(...params);
}

export function createExpenseAdvance(body: { staff_id: number; amount: number; purpose?: string; branch_id?: string }, by?: number) {
  const amount = Number(body.amount) || 0;
  if (!body.staff_id) throw new Error("staff_id required");
  if (amount <= 0) throw new Error("amount must be > 0");
  const info = sqlite.prepare(
    `INSERT INTO expense_advances (staff_id, branch_id, amount, balance, purpose, issued_at, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(body.staff_id, body.branch_id ?? null, amount, amount, body.purpose ?? null, nowIso(), by ?? null);
  const id = Number(info.lastInsertRowid);
  // Ledger: staff now holds company cash → debit (negative balance to company).
  addPersonLedger(body.staff_id, "advance_issued", amount, id, "expense_advances", body.purpose);
  // R27.7 #2 — issuing a cash advance leaves the branch till.
  addCashMovement({ branch: body.branch_id, direction: "out", amount, source: "advance_issue", reference_id: id, reference_table: "expense_advances", notes: body.purpose ?? null, by });
  return sqlite.prepare(`SELECT * FROM expense_advances WHERE id = ?`).get(id);
}

// Return unspent cash: settles the advance by zeroing its balance and crediting
// the returned amount back on the staff ledger.
export function returnAdvanceCash(advanceId: number, by?: number) {
  const adv = sqlite.prepare(`SELECT * FROM expense_advances WHERE id = ?`).get(advanceId) as any;
  if (!adv) throw new Error("advance not found");
  const remaining = Number(adv.balance) || 0;
  if (remaining <= 0) { sqlite.prepare(`UPDATE expense_advances SET status='settled' WHERE id=?`).run(advanceId); return sqlite.prepare(`SELECT * FROM expense_advances WHERE id=?`).get(advanceId); }
  sqlite.prepare(`UPDATE expense_advances SET balance=0, status='settled' WHERE id=?`).run(advanceId);
  addPersonLedger(adv.staff_id, "advance_returned", -remaining, advanceId, "expense_advances", "Return Cash");
  // R27.7 #2 — returned cash comes back into the branch till.
  addCashMovement({ branch: adv.branch_id, direction: "in", amount: remaining, source: "advance_return", reference_id: advanceId, reference_table: "expense_advances", notes: "Return Cash", by });
  return sqlite.prepare(`SELECT * FROM expense_advances WHERE id=?`).get(advanceId);
}

// ---- R27.7 #2: cash ledger (per-branch till) ----
// A single row per real cash movement. Balance per branch = SUM(in) - SUM(out).
// We deliberately do NOT backfill historical null-payment_mode expenses, so only
// movements recorded from R27.7 onward count toward the till balance.
function normalizeBranch(b?: string | null): string {
  const s = String(b ?? "").trim();
  return s ? s : "unassigned";
}
export function addCashMovement(m: {
  branch?: string | null; direction: "in" | "out"; amount: number;
  source: string; reference_id?: number | null; reference_table?: string | null;
  notes?: string | null; by?: number | null;
}) {
  const amount = Number(m.amount) || 0;
  if (amount <= 0) return null;
  try {
    const info = sqlite.prepare(
      `INSERT INTO cash_movements (branch, direction, amount, source, reference_id, reference_table, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(normalizeBranch(m.branch), m.direction, amount, m.source, m.reference_id ?? null, m.reference_table ?? null, m.notes ?? null, m.by ?? null, nowIso());
    return Number(info.lastInsertRowid);
  } catch (e: any) {
    console.error("[R27.7] addCashMovement failed:", e?.message || e);
    return null;
  }
}

// Per-branch running balance plus the overall total.
export function getCashBalances(): { branch: string; inflow: number; outflow: number; balance: number }[] {
  try {
    const rows = sqlite.prepare(
      `SELECT branch,
         COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) AS inflow,
         COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS outflow
       FROM cash_movements GROUP BY branch ORDER BY branch`,
    ).all() as any[];
    return rows.map((r) => ({ branch: r.branch, inflow: Number(r.inflow) || 0, outflow: Number(r.outflow) || 0, balance: (Number(r.inflow) || 0) - (Number(r.outflow) || 0) }));
  } catch { return []; }
}

// Record a cash receipt / collection / sale → money INTO the branch till.
export function recordCashReceipt(body: { branch?: string; amount: number; source?: string; notes?: string }, by?: number) {
  const amount = Number(body.amount) || 0;
  if (amount <= 0) throw new Error("amount must be > 0");
  const id = addCashMovement({ branch: body.branch, direction: "in", amount, source: body.source || "cash_receipt", notes: body.notes ?? null, by });
  return { id, branch: normalizeBranch(body.branch), amount };
}

// Chronological drill-down, optionally filtered by branch.
export function listCashMovements(opts: { branch?: string; from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.branch && opts.branch !== "all") { conds.push("branch = ?"); params.push(normalizeBranch(opts.branch)); }
  if (opts.from) { conds.push("date(created_at) >= date(?)"); params.push(opts.from); }
  if (opts.to) { conds.push("date(created_at) <= date(?)"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    return sqlite.prepare(`SELECT * FROM cash_movements ${where} ORDER BY id ASC`).all(...params);
  } catch { return []; }
}

// ---- R27.7 #1: accounts export aggregations ----
// Cash received within a date range (the 'in' side of the till).
export function reportCashReceived(opts: { from?: string; to?: string; branch?: string } = {}) {
  const conds = ["direction = 'in'"]; const params: any[] = [];
  if (opts.branch && opts.branch !== "all") { conds.push("branch = ?"); params.push(normalizeBranch(opts.branch)); }
  if (opts.from) { conds.push("date(created_at) >= date(?)"); params.push(opts.from); }
  if (opts.to) { conds.push("date(created_at) <= date(?)"); params.push(opts.to); }
  try {
    return sqlite.prepare(
      `SELECT date(created_at) AS date, branch, source, amount, notes, reference_id FROM cash_movements WHERE ${conds.join(" AND ")} ORDER BY created_at ASC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// Staff-wise expense rollup: per staff member, sum of advance settlements + direct
// expenses, plus a grand total. Used by the staff-expenses export.
export function reportStaffExpenses(opts: { from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.from) { conds.push("x.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("x.expense_date <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    return sqlite.prepare(
      `SELECT COALESCE(e.name, 'Unassigned') AS staffName, x.staff_id AS staffId,
         COALESCE(SUM(CASE WHEN x.expense_type='advance' THEN x.amount ELSE 0 END),0) AS advanceTotal,
         COALESCE(SUM(CASE WHEN x.expense_type='direct'  THEN x.amount ELSE 0 END),0) AS directTotal,
         COALESCE(SUM(x.amount),0) AS total, COUNT(*) AS items
       FROM expenses x LEFT JOIN employees e ON e.id = x.staff_id
       ${where} GROUP BY x.staff_id, e.name ORDER BY total DESC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// Day-wise complete expense rollup (every expense grouped by day).
export function reportDayExpenses(opts: { from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.from) { conds.push("x.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("x.expense_date <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    return sqlite.prepare(
      `SELECT x.expense_date AS date,
         COALESCE(SUM(CASE WHEN x.expense_type='advance' THEN x.amount ELSE 0 END),0) AS advanceTotal,
         COALESCE(SUM(CASE WHEN x.expense_type='direct'  THEN x.amount ELSE 0 END),0) AS directTotal,
         COALESCE(SUM(x.amount),0) AS total, COUNT(*) AS items
       FROM expenses x ${where} GROUP BY x.expense_date ORDER BY x.expense_date DESC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// ============================================================================
// R27.8 #4 — full-detail export rows (every transaction, not a rollup). Each
// helper honours from/to. These back the accounts cash/staff/day exports.
// ============================================================================

// Every cash receipt (and any inbound cash movement) with full context.
export function reportCashReceivedDetail(opts: { from?: string; to?: string; branch?: string } = {}) {
  const conds = ["cm.direction = 'in'"]; const params: any[] = [];
  if (opts.branch && opts.branch !== "all") { conds.push("cm.branch = ?"); params.push(normalizeBranch(opts.branch)); }
  if (opts.from) { conds.push("date(cm.created_at) >= date(?)"); params.push(opts.from); }
  if (opts.to) { conds.push("date(cm.created_at) <= date(?)"); params.push(opts.to); }
  try {
    return sqlite.prepare(
      `SELECT cm.id, date(cm.created_at) AS date, time(cm.created_at) AS time, cm.branch, cm.amount, cm.source,
              cm.reference_id, cm.reference_table, cm.notes, e.name AS recordedBy, cm.created_at
       FROM cash_movements cm LEFT JOIN employees e ON e.id = cm.created_by
       WHERE ${conds.join(" AND ")} ORDER BY cm.created_at ASC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// Every staff expense (advance + direct) line with full context.
export function reportStaffExpensesDetail(opts: { from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.from) { conds.push("x.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("x.expense_date <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    return sqlite.prepare(
      `SELECT x.id, e.name AS staffName, e.role AS role, COALESCE(x.branch_id, e.branch) AS branch,
              x.expense_date AS date, x.expense_type AS expenseType, h.name AS header, x.amount,
              x.payment_mode AS paymentMode, x.advance_id AS advanceId, x.description,
              COALESCE(x.attachment_url, x.proof_url) AS attachmentUrl, ab.name AS approvedBy,
              x.created_at
       FROM expenses x
       LEFT JOIN employees e ON e.id = x.staff_id
       LEFT JOIN expense_headers h ON h.id = x.expense_header_id
       LEFT JOIN employees ab ON ab.id = x.created_by
       ${where} ORDER BY x.expense_date ASC, x.id ASC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// Every expense line, day-ordered, with full context (day-wise complete detail).
export function reportDayExpensesDetail(opts: { from?: string; to?: string } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.from) { conds.push("x.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("x.expense_date <= ?"); params.push(opts.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    return sqlite.prepare(
      `SELECT x.id, x.expense_date AS date, e.name AS staffName, COALESCE(x.branch_id, e.branch) AS branch,
              h.name AS header, x.expense_type AS subCategory, x.amount, x.payment_mode AS paymentMode,
              x.description, x.advance_id AS referenceNo, COALESCE(x.attachment_url, x.proof_url) AS attachmentUrl,
              x.source, x.source_id AS sourceId, ab.name AS approvedBy, x.created_at
       FROM expenses x
       LEFT JOIN employees e ON e.id = x.staff_id
       LEFT JOIN expense_headers h ON h.id = x.expense_header_id
       LEFT JOIN employees ab ON ab.id = x.created_by
       ${where} ORDER BY x.expense_date ASC, x.id ASC`,
    ).all(...params) as any[];
  } catch { return []; }
}

// ---- Expenses (advance settlement + direct) ----
export function listExpenses(opts: { from?: string; to?: string; type?: string; advanceId?: number; branch?: string; includeSales?: boolean } = {}) {
  const conds: string[] = []; const params: any[] = [];
  if (opts.type && opts.type !== "all") { conds.push("x.expense_type = ?"); params.push(opts.type); }
  if (opts.advanceId) { conds.push("x.advance_id = ?"); params.push(opts.advanceId); }
  if (opts.from) { conds.push("x.expense_date >= ?"); params.push(opts.from); }
  if (opts.to) { conds.push("x.expense_date <= ?"); params.push(opts.to); }
  if (opts.branch && opts.branch !== "all") { conds.push("LOWER(TRIM(COALESCE(x.branch_id,''))) = LOWER(TRIM(?))"); params.push(opts.branch); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite.prepare(
    `SELECT x.*, h.name AS headerName, e.name AS staffName
     FROM expenses x
     LEFT JOIN expense_headers h ON h.id = x.expense_header_id
     LEFT JOIN employees e ON e.id = x.staff_id
     ${where} ORDER BY x.expense_date DESC, x.id DESC`,
  ).all(...params) as any[];

  // R27.6 #7 — also surface approved sales expenses that have NOT already been
  // synced into the expenses table (defensive: synced ones carry sales_expense_id).
  if (opts.includeSales !== false) {
    try {
      // R27.7 #3 — the prior query referenced se.description which does NOT exist
      // (the column is `notes`), so the prepared statement threw and was swallowed
      // by the catch → sync always saw 0 rows. Use the real columns.
      const salesRows = sqlite.prepare(
        `SELECT se.id, se.amount, se.expense_type AS category, se.expense_date, se.notes, se.proof_url, u.name AS staffName
         FROM sales_expenses se LEFT JOIN data_team_users u ON u.id = se.sales_user_id
         WHERE LOWER(TRIM(COALESCE(se.approval_status, se.status, 'pending'))) = 'approved'
           AND se.id NOT IN (SELECT sales_expense_id FROM expenses WHERE sales_expense_id IS NOT NULL)
         ORDER BY se.id DESC`,
      ).all() as any[];
      for (const s of salesRows) {
        rows.push({
          id: -100000 - Number(s.id), expense_type: "direct", advance_id: null, staff_id: null,
          branch_id: null, expense_header_id: null, amount: Number(s.amount) || 0,
          payment_mode: "sales_reimbursement", description: [s.category, s.notes].filter(Boolean).join(" — ") || "Sales expense",
          proof_url: s.proof_url || null, attachment_url: s.proof_url || null, expense_date: s.expense_date,
          sales_expense_id: Number(s.id), source: "sales", source_id: Number(s.id),
          headerName: s.category || "Sales", staffName: s.staffName || "Sales rep",
        });
      }
    } catch { /* sales_expenses may not exist in older DBs */ }
  }
  rows.sort((a, b) => String(b.expense_date || "").localeCompare(String(a.expense_date || "")));
  return rows;
}

// Create a DIRECT expense (no advance). Posts to person ledger if staff tagged.
export function createDirectExpense(body: { amount: number; expense_header_id?: number; payment_mode?: string; description?: string; proof_url?: string; expense_date: string; branch_id?: string; staff_id?: number }, by?: number) {
  const amount = Number(body.amount) || 0;
  if (amount <= 0) throw new Error("amount must be > 0");
  if (!body.expense_date) throw new Error("expense_date required");
  const info = sqlite.prepare(
    `INSERT INTO expenses (expense_type, advance_id, staff_id, branch_id, expense_header_id, amount, payment_mode, description, proof_url, expense_date, created_by, created_at)
     VALUES ('direct', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(body.staff_id ?? null, body.branch_id ?? null, body.expense_header_id ?? null, amount, body.payment_mode ?? "cash", body.description ?? null, body.proof_url ?? null, body.expense_date, by ?? null, nowIso());
  const id = Number(info.lastInsertRowid);
  // R27.7 #2 — a cash-paid direct expense leaves the branch till.
  if (String(body.payment_mode ?? "cash").toLowerCase() === "cash") {
    addCashMovement({ branch: body.branch_id, direction: "out", amount, source: "direct_expense", reference_id: id, reference_table: "expenses", notes: body.description ?? null, by });
  }
  return sqlite.prepare(`SELECT * FROM expenses WHERE id = ?`).get(id);
}

// Settle an expense AGAINST an advance. Decrements the advance balance and
// auto-settles the advance when the balance hits 0.
export function createAdvanceExpense(body: { advance_id: number; amount: number; expense_header_id?: number; description?: string; proof_url?: string; expense_date: string }, by?: number) {
  const amount = Number(body.amount) || 0;
  if (amount <= 0) throw new Error("amount must be > 0");
  const adv = sqlite.prepare(`SELECT * FROM expense_advances WHERE id = ?`).get(body.advance_id) as any;
  if (!adv) throw new Error("advance not found");
  if (adv.status === "settled") throw new Error("advance already settled");
  if (amount > Number(adv.balance) + 0.001) throw new Error(`amount exceeds advance balance (₹${adv.balance})`);
  const info = sqlite.prepare(
    `INSERT INTO expenses (expense_type, advance_id, staff_id, branch_id, expense_header_id, amount, payment_mode, description, proof_url, expense_date, created_by, created_at)
     VALUES ('advance', ?, ?, ?, ?, ?, 'advance', ?, ?, ?, ?, ?)`,
  ).run(body.advance_id, adv.staff_id, adv.branch_id ?? null, body.expense_header_id ?? null, amount, body.description ?? null, body.proof_url ?? null, body.expense_date, by ?? null, nowIso());
  const newBalance = Math.round((Number(adv.balance) - amount) * 100) / 100;
  const settled = newBalance <= 0.001;
  sqlite.prepare(`UPDATE expense_advances SET balance = ?, status = ? WHERE id = ?`).run(Math.max(0, newBalance), settled ? "settled" : "open", body.advance_id);
  // Ledger: expense consumes part of the held advance → credit back to staff.
  addPersonLedger(adv.staff_id, "advance_expense", -amount, Number(info.lastInsertRowid), "expenses", body.description);
  return { expense: sqlite.prepare(`SELECT * FROM expenses WHERE id = ?`).get(Number(info.lastInsertRowid)), advanceBalance: Math.max(0, newBalance), advanceStatus: settled ? "settled" : "open" };
}

// R27.6 #7 — sync a single approved sales expense into the expenses table as a
// direct expense (idempotent via unique sales_expense_id index).
// R27.8 #1 — re-runnable bulk sync. Scans EVERY approved sales expense (tolerant of
// either `status` or `approval_status` carrying the value, any case) and creates the
// unified-expenses ledger row for any that are missing one. Returns real counts so the
// finance user sees "Synced N (M already synced of T approved)" instead of a bare 0.
export function syncAllApprovedSalesExpenses(by?: number): { synced: number; alreadySynced: number; totalApproved: number } {
  let approved: any[] = [];
  try {
    approved = sqlite.prepare(
      `SELECT id FROM sales_expenses
       WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(approval_status),''), NULLIF(TRIM(status),''), 'pending'))) = 'approved'
       ORDER BY id ASC`,
    ).all() as any[];
  } catch { approved = []; }
  let synced = 0, alreadySynced = 0;
  for (const row of approved) {
    try {
      const r: any = syncSalesExpenseToAccounts(Number(row.id), by);
      if (r?.skipped === "already synced") alreadySynced++;
      else if (r?.id) synced++;
    } catch { /* skip bad row */ }
  }
  return { synced, alreadySynced, totalApproved: approved.length };
}

export function syncSalesExpenseToAccounts(salesExpenseId: number, by?: number) {
  const se = sqlite.prepare(`SELECT * FROM sales_expenses WHERE id = ?`).get(salesExpenseId) as any;
  if (!se) throw new Error("sales expense not found");
  // Empty strings must fall through to the other column, so COALESCE alone is wrong
  // (it picks '' over a populated `status`). Treat either column carrying 'approved'.
  const a1 = String(se.approval_status ?? "").trim().toLowerCase();
  const a2 = String(se.status ?? "").trim().toLowerCase();
  if (a1 !== "approved" && a2 !== "approved") return { skipped: "not approved" };
  const existing = sqlite.prepare(`SELECT id FROM expenses WHERE sales_expense_id = ?`).get(salesExpenseId);
  if (existing) return { skipped: "already synced", id: (existing as any).id };
  const desc = [se.expense_type, se.notes].filter(Boolean).join(" — ") || "Sales expense";
  const receipt = se.proof_url ?? null;
  const info = sqlite.prepare(
    `INSERT INTO expenses (expense_type, amount, payment_mode, description, proof_url, attachment_url, expense_date, sales_expense_id, source, source_id, created_by, created_at)
     VALUES ('direct', ?, 'sales_reimbursement', ?, ?, ?, ?, ?, 'sales', ?, ?, ?)`,
  ).run(Number(se.amount) || 0, desc, receipt, receipt, se.expense_date, salesExpenseId, salesExpenseId, by ?? null, nowIso());
  return { id: Number(info.lastInsertRowid) };
}

// Employees (salary fields masked for finance role)
// R27.5 #8 — full master: role/branch/email/pan/bank_account/ifsc/gross_salary.
// maskSalary blanks every pay-related figure so the finance role sees *** in the UI.
function maskEmp(r: any) {
  return { ...r, per_day_rate: null, monthly_salary: null, gross_salary: null };
}
export function listEmployees(maskSalary: boolean, search?: string) {
  let rows: any[];
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    rows = sqlite.prepare(
      `SELECT * FROM employees WHERE name LIKE ? OR contact LIKE ? OR email LIKE ? OR role LIKE ? OR branch LIKE ? ORDER BY active DESC, name ASC`,
    ).all(q, q, q, q, q) as any[];
  } else {
    rows = sqlite.prepare(`SELECT * FROM employees ORDER BY active DESC, name ASC`).all() as any[];
  }
  if (!maskSalary) return rows;
  return rows.map(maskEmp);
}
export function getEmployee(id: number, maskSalary: boolean) {
  const r = sqlite.prepare(`SELECT * FROM employees WHERE id = ?`).get(id) as any;
  if (!r) return undefined;
  return maskSalary ? maskEmp(r) : r;
}
// R27.7 #8 — extended HR columns added by the R27.7 migration.
const EMP_HR_COLS = [
  "dob", "gender", "marital_status", "alt_contact", "family_contact_name",
  "family_contact_phone", "family_relationship", "permanent_address", "current_address",
  "reporting_manager", "bank_name", "photo_url", "aadhar_url", "pan_url", "notes",
];
export function createEmployee(body: any) {
  const info = sqlite.prepare(
    `INSERT INTO employees (name, contact, aadhar, image_url, role, branch, email, pan, bank_account, ifsc, gross_salary, working_days_default, per_day_rate, monthly_salary, retention_pct, joined_at, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    body.name, body.contact ?? null, body.aadhar ?? null, body.image_url ?? null,
    body.role ?? null, body.branch ?? null, body.email ?? null, body.pan ?? null,
    body.bank_account ?? null, body.ifsc ?? null,
    body.gross_salary ?? null, body.working_days_default ?? 26,
    body.per_day_rate ?? null, body.monthly_salary ?? null, body.retention_pct ?? 10,
    body.joined_at ?? null, nowIso(),
  );
  const id = Number(info.lastInsertRowid);
  // Apply the extended HR fields (best-effort; columns exist after R27.7 migration).
  for (const col of EMP_HR_COLS) {
    if (body[col] != null) {
      try { sqlite.prepare(`UPDATE employees SET ${col} = ? WHERE id = ?`).run(body[col], id); } catch { /* column missing */ }
    }
  }
  return sqlite.prepare(`SELECT * FROM employees WHERE id = ?`).get(id);
}
export function updateEmployee(id: number, body: any, allowSalary: boolean) {
  const fields: string[] = []; const params: any[] = [];
  const set = (col: string, val: any) => { fields.push(`${col} = ?`); params.push(val); };
  if (body.name != null) set("name", body.name);
  if (body.contact != null) set("contact", body.contact);
  if (body.aadhar != null) set("aadhar", body.aadhar);
  if (body.image_url != null) set("image_url", body.image_url);
  if (body.role != null) set("role", body.role);
  if (body.branch != null) set("branch", body.branch);
  if (body.email != null) set("email", body.email);
  if (body.pan != null) set("pan", body.pan);
  if (body.bank_account != null) set("bank_account", body.bank_account);
  if (body.ifsc != null) set("ifsc", body.ifsc);
  if (body.working_days_default != null) set("working_days_default", body.working_days_default);
  if (body.retention_pct != null) set("retention_pct", body.retention_pct);
  if (body.joined_at != null) set("joined_at", body.joined_at);
  if (body.active != null) set("active", body.active ? 1 : 0);
  // Only admin may set salary numbers.
  if (allowSalary && body.per_day_rate != null) set("per_day_rate", body.per_day_rate);
  if (allowSalary && body.monthly_salary != null) set("monthly_salary", body.monthly_salary);
  if (allowSalary && body.gross_salary != null) set("gross_salary", body.gross_salary);
  // R27.7 #8 — extended HR fields (non-salary; safe for finance too).
  for (const col of EMP_HR_COLS) {
    if (body[col] != null) set(col, body[col]);
  }
  if (!fields.length) return getEmployee(id, false);
  params.push(id);
  sqlite.prepare(`UPDATE employees SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return sqlite.prepare(`SELECT * FROM employees WHERE id = ?`).get(id);
}

// Attendance
export function upsertAttendance(employeeId: number, month: string, absentDays: number, by?: number) {
  sqlite.prepare(
    `INSERT INTO attendance (employee_id, month, absent_days, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, month) DO UPDATE SET absent_days = excluded.absent_days, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by`,
  ).run(employeeId, month, Number(absentDays) || 0, nowIso(), by ?? null);
  return sqlite.prepare(`SELECT * FROM attendance WHERE employee_id = ? AND month = ?`).get(employeeId, month);
}
export function listAttendance(month?: string) {
  if (month) return sqlite.prepare(`SELECT a.*, e.name AS employeeName FROM attendance a LEFT JOIN employees e ON e.id = a.employee_id WHERE a.month = ? ORDER BY e.name`).all(month);
  return sqlite.prepare(`SELECT a.*, e.name AS employeeName FROM attendance a LEFT JOIN employees e ON e.id = a.employee_id ORDER BY a.month DESC, e.name`).all();
}

// R27.7 #11 — per-day attendance calendar. attendance_days(employee_id, date, status).
// Bulk-mark a set of dates for one employee, then roll the absent-day count up into
// the existing monthly `attendance` table so salary math stays consistent.
export function bulkMarkAttendance(employeeId: number, days: Array<{ date: string; status: string }>, by?: number) {
  if (!employeeId || !Array.isArray(days)) throw new Error("employee_id and days required");
  const tx = sqlite.transaction(() => {
    for (const d of days) {
      if (!d?.date) continue;
      const status = String(d.status || "present").toLowerCase();
      sqlite.prepare(
        `INSERT INTO attendance_days (employee_id, date, status, marked_by, marked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
      ).run(employeeId, d.date, status, by ?? null, nowIso());
    }
  });
  tx();
  // Recompute absent counts per affected month and sync into the monthly table.
  const months = Array.from(new Set(days.map((d) => String(d.date || "").slice(0, 7)).filter(Boolean)));
  for (const month of months) {
    const row = sqlite.prepare(
      `SELECT COUNT(*) AS absent FROM attendance_days WHERE employee_id = ? AND substr(date,1,7) = ? AND LOWER(status) IN ('absent','leave','unpaid')`,
    ).get(employeeId, month) as any;
    upsertAttendance(employeeId, month, Number(row?.absent) || 0, by);
  }
  return listAttendanceDays(employeeId, months[0]);
}
export function listAttendanceDays(employeeId: number, month?: string) {
  if (month) {
    return sqlite.prepare(
      `SELECT * FROM attendance_days WHERE employee_id = ? AND substr(date,1,7) = ? ORDER BY date ASC`,
    ).all(employeeId, month) as any[];
  }
  return sqlite.prepare(`SELECT * FROM attendance_days WHERE employee_id = ? ORDER BY date ASC`).all(employeeId) as any[];
}

// Salary
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}
export function computeSalary(employeeId: number, month: string) {
  const emp = sqlite.prepare(`SELECT * FROM employees WHERE id = ?`).get(employeeId) as any;
  if (!emp) throw new Error("Employee not found");
  const att = sqlite.prepare(`SELECT absent_days FROM attendance WHERE employee_id = ? AND month = ?`).get(employeeId, month) as any;
  const absent = Number(att?.absent_days) || 0;
  const dim = daysInMonth(month);
  const workingDays = Math.max(0, dim - absent);
  const perDay = Number(emp.per_day_rate) || (Number(emp.monthly_salary) ? Number(emp.monthly_salary) / dim : 0);
  const gross = Math.round(perDay * workingDays);
  // open advances minus reconciled for this employee
  const adv = sqlite.prepare(
    `SELECT COALESCE(SUM(a.amount_given),0) given,
            COALESCE((SELECT SUM(r.amount) FROM advance_reconciliations r JOIN advance_expenses a2 ON a2.id = r.advance_id WHERE a2.employee_id = ?),0) reconciled
     FROM advance_expenses a WHERE a.employee_id = ? AND a.status != 'reconciled'`,
  ).get(employeeId, employeeId) as any;
  const advanceDeduction = Math.max(0, (Number(adv.given) || 0) - (Number(adv.reconciled) || 0));
  const retentionPct = Number(emp.retention_pct) || 0;
  const retentionAmount = Math.round((gross - advanceDeduction) * retentionPct / 100);
  const netPayable = gross - advanceDeduction - retentionAmount;
  return { employee_id: employeeId, month, working_days: workingDays, absent_days: absent, per_day_rate: perDay, gross, advance_deduction: advanceDeduction, retention_amount: retentionAmount, retention_pct: retentionPct, net_payable: netPayable, employeeName: emp.name };
}
export function finalizeSalary(employeeId: number, month: string, paymentRef?: string) {
  const c = computeSalary(employeeId, month);
  const existing = sqlite.prepare(`SELECT id FROM salary_runs WHERE employee_id = ? AND month = ?`).get(employeeId, month) as any;
  if (existing) {
    sqlite.prepare(
      `UPDATE salary_runs SET working_days=?, absent_days=?, per_day_rate=?, gross=?, advance_deduction=?, retention_amount=?, retention_pct=?, net_payable=?, paid_at=?, payment_ref=? WHERE id=?`,
    ).run(c.working_days, c.absent_days, c.per_day_rate, c.gross, c.advance_deduction, c.retention_amount, c.retention_pct, c.net_payable, nowIso(), paymentRef ?? null, existing.id);
  } else {
    sqlite.prepare(
      `INSERT INTO salary_runs (employee_id, month, working_days, absent_days, per_day_rate, gross, advance_deduction, retention_amount, retention_pct, net_payable, paid_at, payment_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(employeeId, month, c.working_days, c.absent_days, c.per_day_rate, c.gross, c.advance_deduction, c.retention_amount, c.retention_pct, c.net_payable, nowIso(), paymentRef ?? null, nowIso());
  }
  addPersonLedger(employeeId, "salary_paid", c.net_payable, undefined, "salary_runs", `Salary ${month}`);
  return sqlite.prepare(`SELECT * FROM salary_runs WHERE employee_id = ? AND month = ?`).get(employeeId, month);
}
export function markSalaryEmailed(employeeId: number, month: string) {
  sqlite.prepare(`UPDATE salary_runs SET emailed_at = ? WHERE employee_id = ? AND month = ?`).run(nowIso(), employeeId, month);
}
export function listSalaryRuns(month?: string) {
  if (month) return sqlite.prepare(`SELECT s.*, e.name AS employeeName FROM salary_runs s LEFT JOIN employees e ON e.id = s.employee_id WHERE s.month = ? ORDER BY e.name`).all(month);
  return sqlite.prepare(`SELECT s.*, e.name AS employeeName FROM salary_runs s LEFT JOIN employees e ON e.id = s.employee_id ORDER BY s.month DESC`).all();
}

// ===========================================================================
// R27.3-2 — Supreme AI Bar (read-only tools + deterministic fallback)
// ===========================================================================

export function aiBarLog(userId: number | null, prompt: string, summary: string, data: any) {
  try { sqlite.prepare(`INSERT INTO ai_bar_history (user_id, prompt, answer_summary, data_json, asked_at) VALUES (?, ?, ?, ?, ?)`).run(userId ?? null, prompt, summary, JSON.stringify(data ?? null), nowIso()); } catch {}
}
export function aiBarHistory(limit = 20) {
  return sqlite.prepare(`SELECT id, prompt, answer_summary, asked_at FROM ai_bar_history ORDER BY id DESC LIMIT ?`).all(limit);
}

function safeParse(s: any): any { try { return s ? JSON.parse(s) : (Array.isArray(s) ? s : []); } catch { return []; } }
