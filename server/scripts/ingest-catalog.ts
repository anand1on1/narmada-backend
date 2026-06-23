// PartSetu AI v1 — catalog ingestion.
// Parses a TATA-style spare-parts catalogue PDF (e.g. signa-4232.pdf) into
// partsetu_catalogs + partsetu_parts. Idempotent: re-running upserts the catalog
// by vc_no and fully replaces that catalog's parts.
//
// Usage:  npx tsx server/scripts/ingest-catalog.ts <pdf> [--oem TATA] [--diagrams]
//
// Page layout (pdftotext -layout):
//   Header per table:  VC No : <vc> Group : (<gc>) <NAME> Table : ( <code>-<assembly> )
//   Part rows:         <fig>  <part_no>  <description>  <qty> [<remarks>]
//   Kit:               a real part followed by a "CONSISTS OF:" line, then child
//                      rows whose part_no is "-" (not serviced) belong to it.
//   Footer note:       "Items without Part No. are not serviced."
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { rawSqlite as db } from "../storage";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const pdfPath = process.argv[2];
if (!pdfPath || pdfPath.startsWith("--")) {
  console.error("Usage: npx tsx server/scripts/ingest-catalog.ts <pdf> [--oem TATA] [--diagrams]");
  process.exit(1);
}
if (!fs.existsSync(pdfPath)) {
  console.error(`[ingest-catalog] file not found: ${pdfPath}`);
  process.exit(1);
}

const OEM = arg("--oem") || "TATA";
const RENDER_DIAGRAMS = flag("--diagrams");
const DATA_DIR = process.env.DATA_DIR || ".";

function pdfText(): string {
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
}
function pdfPageCount(): number {
  try {
    const info = execFileSync("pdfinfo", [pdfPath]).toString("utf8");
    const m = info.match(/Pages:\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch { return 0; }
}

const HEADER_RE = /VC No\s*:\s*(\S+)\s+Group\s*:\s*\((\w+)\)\s*(.*?)\s+Table\s*:\s*\(\s*(.+?)\s*\)/;

interface ParsedPart {
  group_code: string; table_code: string; assembly_name: string;
  fig_no: string | null; part_number: string | null; description: string;
  qty: number | null; remarks: string | null; is_kit_parent: boolean;
  is_child: boolean; is_serviceable: boolean; page_no: number;
}

function parseCatalogMeta(firstPage: string): { vcNo: string; model: string; chassis: string; engine: string } {
  const text = firstPage.replace(/[ \t]+/g, " ");
  const vc = text.match(/VC No\s*:?\s*(\S+)/i);
  // Model block: the descriptive SIGNA... lines on the cover. The literal "Model"
  // label sits mid-block (a layout quirk), so capture from the SIGNA descriptor
  // through to "Model Cat egory" and strip the stray "Model" label.
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
    // No trailing qty — the last token is part of the description.
    desc = (desc ? desc + " " : "") + last;
  }
  return { fig, partNo, desc: desc.trim(), qty, remarks };
}

function main() {
  console.log(`[ingest-catalog] reading ${pdfPath}`);
  const totalPages = pdfPageCount();
  const raw = pdfText();
  const pages = raw.split("\f");
  console.log(`[ingest-catalog] pdfinfo pages=${totalPages}, text pages=${pages.length}`);

  const meta = parseCatalogMeta(pages[0] || "");
  console.log(`[ingest-catalog] meta: vc_no=${meta.vcNo} model="${meta.model.slice(0, 60)}..." engine="${meta.engine}"`);

  // Upsert catalog by vc_no.
  const ts = Date.now();
  db.prepare(
    `INSERT INTO partsetu_catalogs (oem, model, variant, vc_no, pdf_filename, total_pages, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(vc_no) DO UPDATE SET
       oem=excluded.oem, model=excluded.model, variant=excluded.variant,
       pdf_filename=excluded.pdf_filename, total_pages=excluded.total_pages, ingested_at=excluded.ingested_at`,
  ).run(OEM, meta.model, meta.chassis, meta.vcNo, path.basename(pdfPath), totalPages || pages.length, ts);
  const catalog = db.prepare(`SELECT id FROM partsetu_catalogs WHERE vc_no = ?`).get(meta.vcNo) as any;
  const catalogId = catalog.id;
  console.log(`[ingest-catalog] catalog id=${catalogId}`);

  // Idempotency: clear this catalog's parts before re-inserting.
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
  let count = 0, kitParents = 0, kitChildren = 0, nonServiced = 0;

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
        if (!curTable) continue; // not yet inside a table
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip the column header and footer/running lines.
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
            kitParents++;
          }
          continue;
        }

        const row = parsePartRow(line);
        if (!row) continue;
        // A genuine data row must have a fig token of digits or "-" and a part/desc.
        const figIsValid = row.fig === "-" || /^\d+$/.test(row.fig);
        if (!figIsValid) continue;
        if (!row.desc) continue;

        const isChild = row.partNo === "-" && kitParentId != null;
        const partNumber = row.partNo === "-" ? null : row.partNo;
        const serviceable = partNumber != null;
        if (!serviceable) nonServiced++;

        const res = insert.run(
          catalogId, curGroup, curTable, curAssembly,
          row.fig === "-" ? null : row.fig,
          partNumber, row.desc, row.qty, row.remarks,
          0, isChild ? kitParentId : null, serviceable ? 1 : 0, pageNo, diagram, Date.now(),
        );
        count++;
        if (isChild) kitChildren++;
        if (!isChild) { lastRealPartId = Number(res.lastInsertRowid); }
      }
    }
  });
  tx();

  console.log(`[ingest-catalog] inserted ${count} parts (kit parents=${kitParents}, kit children=${kitChildren}, non-serviced=${nonServiced})`);

  if (RENDER_DIAGRAMS) {
    try {
      const outDir = path.resolve(DATA_DIR, "uploads", "partsetu", "diagrams", String(catalogId));
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`[ingest-catalog] rendering diagrams -> ${outDir} (this can take a while)`);
      execFileSync("pdftoppm", ["-png", "-r", "100", pdfPath, path.join(outDir, "page")], { maxBuffer: 64 * 1024 * 1024 });
      const n = fs.readdirSync(outDir).filter((f) => f.endsWith(".png")).length;
      console.log(`[ingest-catalog] rendered ${n} diagram pages`);
    } catch (e: any) {
      console.error(`[ingest-catalog] diagram render failed (non-fatal): ${e?.message || e}`);
    }
  } else {
    console.log(`[ingest-catalog] diagrams skipped (pass --diagrams to render). diagram_path columns are still set.`);
  }

  console.log(`[ingest-catalog] done.`);
}

main();
