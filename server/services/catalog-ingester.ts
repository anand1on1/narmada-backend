// PartSetu AI v1.3 — callable catalog ingestion.
// Lifts the PDF parsing + DB-insert logic out of scripts/ingest-catalog.ts so it
// can be driven by the admin upload route (and the CLI, which now delegates here).
// Parses a TATA-style spare-parts catalogue PDF into partsetu_catalogs +
// partsetu_parts. Idempotent per vc_no: re-ingest fully replaces that catalog's
// parts. The stored PDF lives on the persistent disk as <catalog_id>.pdf.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { rawSqlite as db } from "../storage";
import { copyToCatalog, getCatalogPdfPath, catalogPdfSize } from "./catalog-storage";

function pdfText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
}
function pdfPageCount(pdfPath: string): number {
  try {
    const info = execFileSync("pdfinfo", [pdfPath]).toString("utf8");
    const m = info.match(/Pages:\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch { return 0; }
}

const HEADER_RE = /VC No\s*:\s*(\S+)\s+Group\s*:\s*\((\w+)\)\s*(.*?)\s+Table\s*:\s*\(\s*(.+?)\s*\)/;

function parseCatalogMeta(firstPage: string): { vcNo: string; model: string; chassis: string; engine: string } {
  const text = firstPage.replace(/[ \t]+/g, " ");
  const vc = text.match(/VC No\s*:?\s*(\S+)/i);
  let model = "";
  const sigBlock = firstPage.match(/(SIGNA[\s\S]*?)Model Cat/i);
  if (sigBlock) {
    model = sigBlock[1].replace(/\bModel\b/gi, " ").replace(/\s+/g, " ").trim();
  }
  if (!model) {
    const sig = firstPage.match(/(SIGNA[^\n]+)/i);
    model = sig ? sig[1].replace(/\s+/g, " ").trim() : "";
  }
  const chassis = (text.match(/Chassis Type\s+(\S+)/i) || [])[1] || "";
  const engine = (text.match(/Engine Type\s+([^\n]+?)\s{2,}/i) || text.match(/Engine Type\s+([^\n]+)/i) || [])[1] || "";
  return {
    vcNo: (vc && vc[1]) || `UNKNOWN-${Date.now()}`,
    model: model.slice(0, 300),
    chassis: chassis.trim(),
    engine: engine.replace(/\s+/g, " ").trim(),
  };
}

function parsePartRow(line: string): { fig: string; partNo: string; desc: string; qty: number | null; remarks: string | null } | null {
  const tokens = line.trim().split(/\s{2,}/).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length < 3) return null;
  const fig = tokens[0];
  const partNo = tokens[1];
  const last = tokens[tokens.length - 1];
  let desc = tokens.slice(2, tokens.length - 1).join(" ");
  let qty: number | null = null;
  let remarks: string | null = null;
  const qm = last.match(/^(\d+)\b\s*(.*)$/);
  if (qm) {
    qty = parseInt(qm[1], 10);
    remarks = qm[2].trim() || null;
  } else {
    desc = (desc ? desc + " " : "") + last;
  }
  return { fig, partNo, desc: desc.trim(), qty, remarks };
}

// Parse the part rows from the already-read text pages and (re)insert them for a
// catalog. Returns the number of parts inserted. Clears the catalog's existing
// parts first so re-ingest is idempotent.
function parsePartsIntoCatalog(pages: string[], catalogId: number): number {
  db.prepare(`DELETE FROM partsetu_parts WHERE catalog_id = ?`).run(catalogId);

  const diagramRel = (pageNo: number) =>
    `/uploads/partsetu/diagrams/${catalogId}/page-${String(pageNo).padStart(3, "0")}.png`;

  const insert = db.prepare(
    `INSERT INTO partsetu_parts
       (catalog_id, group_code, table_code, assembly_name, fig_no, part_number, description, qty, remarks,
        is_kit_parent, parent_part_id, is_serviceable, page_no, diagram_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const markKitParent = db.prepare(`UPDATE partsetu_parts SET is_kit_parent = 1 WHERE id = ?`);

  let curGroup = "", curTable = "", curAssembly = "";
  let lastRealPartId: number | null = null;
  let kitParentId: number | null = null;
  let count = 0;

  const tx = db.transaction(() => {
    for (let p = 0; p < pages.length; p++) {
      const pageNo = p + 1;
      const lines = pages[p].split("\n");
      const diagram = diagramRel(pageNo);
      for (const line of lines) {
        const hdr = line.match(HEADER_RE);
        if (hdr) {
          curGroup = hdr[2];
          curAssembly = (hdr[3] || "").replace(/\s+/g, " ").trim();
          curTable = (hdr[4] || "").replace(/\s+/g, " ").trim();
          lastRealPartId = null;
          kitParentId = null;
          continue;
        }
        if (!curTable) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^Fig\.?\s+Part No/i.test(trimmed)) continue;
        if (/^Updated on/i.test(trimmed)) continue;
        if (/^Items? wi/i.test(trimmed)) continue;
        if (/Commercial Vehicle Business Unit/i.test(trimmed)) continue;
        if (/^SIG\s*N\s*A/i.test(trimmed)) continue;
        if (/^Page \d+ of/i.test(trimmed)) continue;
        if (/^Table Of Contents/i.test(trimmed)) continue;

        if (/CONSISTS OF\s*:/i.test(trimmed)) {
          if (lastRealPartId != null) {
            markKitParent.run(lastRealPartId);
            kitParentId = lastRealPartId;
          }
          continue;
        }

        const row = parsePartRow(line);
        if (!row) continue;
        const figIsValid = row.fig === "-" || /^\d+$/.test(row.fig);
        if (!figIsValid) continue;
        if (!row.desc) continue;

        const isChild = row.partNo === "-" && kitParentId != null;
        const partNumber = row.partNo === "-" ? null : row.partNo;
        const serviceable = partNumber != null;

        const res = insert.run(
          catalogId, curGroup, curTable, curAssembly,
          row.fig === "-" ? null : row.fig,
          partNumber, row.desc, row.qty, row.remarks,
          0, isChild ? kitParentId : null, serviceable ? 1 : 0, pageNo, diagram, Date.now(),
        );
        count++;
        if (!isChild) lastRealPartId = Number(res.lastInsertRowid);
      }
    }
  });
  tx();
  return count;
}

export interface IngestResult { catalogId: number; partsCount: number; vcNo: string; model: string; }

// Ingest a freshly-uploaded (or CLI-provided) PDF. Upserts the catalog by vc_no,
// stores the PDF as <id>.pdf on the persistent disk, parses parts, and flips
// status active. On failure the row is kept with status='failed' + ingest_error
// so the admin can see and retry it. `cleanupSrc` deletes the source (tmp upload).
export async function ingestCatalogPdf(opts: {
  pdfPath: string;
  uploadedBy: string;
  oem?: string;
  cleanupSrc?: boolean;
}): Promise<IngestResult> {
  const { pdfPath, uploadedBy, oem = "TATA", cleanupSrc = false } = opts;
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);

  const totalPages = pdfPageCount(pdfPath);
  const raw = pdfText(pdfPath);
  const pages = raw.split("\f");
  const meta = parseCatalogMeta(pages[0] || "");
  const ts = Date.now();

  // Upsert catalog (by vc_no) and mark it ingesting.
  db.prepare(
    `INSERT INTO partsetu_catalogs (oem, model, variant, vc_no, pdf_filename, total_pages, ingested_at, status, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ingesting', ?, ?)
     ON CONFLICT(vc_no) DO UPDATE SET
       oem=excluded.oem, model=excluded.model, variant=excluded.variant,
       pdf_filename=excluded.pdf_filename, total_pages=excluded.total_pages, ingested_at=excluded.ingested_at,
       status='ingesting', uploaded_by=excluded.uploaded_by, uploaded_at=excluded.uploaded_at`,
  ).run(oem, meta.model, meta.chassis, meta.vcNo, path.basename(pdfPath), totalPages || pages.length, ts, uploadedBy, ts);

  const catalogId = (db.prepare(`SELECT id FROM partsetu_catalogs WHERE vc_no = ?`).get(meta.vcNo) as any).id as number;

  try {
    const finalPath = copyToCatalog(pdfPath, catalogId);
    db.prepare(`UPDATE partsetu_catalogs SET file_path = ?, file_size_bytes = ? WHERE id = ?`)
      .run(finalPath, catalogPdfSize(catalogId), catalogId);

    const partsCount = parsePartsIntoCatalog(pages, catalogId);

    db.prepare(`UPDATE partsetu_catalogs SET status = 'active', ingest_error = NULL WHERE id = ?`).run(catalogId);
    if (cleanupSrc) { try { fs.unlinkSync(pdfPath); } catch { /* non-fatal */ } }
    return { catalogId, partsCount, vcNo: meta.vcNo, model: meta.model };
  } catch (err: any) {
    db.prepare(`UPDATE partsetu_catalogs SET status = 'failed', ingest_error = ? WHERE id = ?`)
      .run(String(err?.message || err).slice(0, 1000), catalogId);
    if (cleanupSrc) { try { fs.unlinkSync(pdfPath); } catch { /* non-fatal */ } }
    throw err;
  }
}

// Re-parse a catalog's already-stored PDF (admin "Re-ingest" button). Replaces
// the catalog's parts from the on-disk <id>.pdf without needing a re-upload.
export async function reingestCatalog(catalogId: number, uploadedBy: string): Promise<IngestResult> {
  const pdfPath = getCatalogPdfPath(catalogId);
  if (!fs.existsSync(pdfPath)) throw new Error("Stored PDF not found for this catalog");
  const existing = db.prepare(`SELECT vc_no, oem FROM partsetu_catalogs WHERE id = ?`).get(catalogId) as any;
  if (!existing) throw new Error("Catalog not found");

  db.prepare(`UPDATE partsetu_catalogs SET status = 'ingesting', uploaded_by = ?, uploaded_at = ? WHERE id = ?`)
    .run(uploadedBy, Date.now(), catalogId);

  try {
    const raw = pdfText(pdfPath);
    const pages = raw.split("\f");
    const meta = parseCatalogMeta(pages[0] || "");
    db.prepare(`UPDATE partsetu_catalogs SET model = ?, variant = ?, total_pages = ?, file_size_bytes = ? WHERE id = ?`)
      .run(meta.model, meta.chassis, pdfPageCount(pdfPath) || pages.length, catalogPdfSize(catalogId), catalogId);

    const partsCount = parsePartsIntoCatalog(pages, catalogId);

    db.prepare(`UPDATE partsetu_catalogs SET status = 'active', ingest_error = NULL WHERE id = ?`).run(catalogId);
    return { catalogId, partsCount, vcNo: existing.vc_no, model: meta.model };
  } catch (err: any) {
    db.prepare(`UPDATE partsetu_catalogs SET status = 'failed', ingest_error = ? WHERE id = ?`)
      .run(String(err?.message || err).slice(0, 1000), catalogId);
    throw err;
  }
}
