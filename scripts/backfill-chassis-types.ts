// R27.24a3.1 — backfill chassis_type for catalogs ingested before the extractor
// existed. Re-uses the app's storage + the exact seedChassisType logic so the
// DB path (DATA_DIR) and identifier seeding match the running server. Safe to
// re-run: the WHERE chassis_type IS NULL filter skips already-extracted rows.
//
// Run on Render:  npm run backfill-chassis-types
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { rawSqlite as db } from "../server/storage";
import { getCatalogPdfPath } from "../server/services/catalog-storage";
import { seedChassisType } from "../server/services/catalog-ingester";

function coverText(pdfPath: string): string {
  const raw = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
  return raw.split("\f")[0] || "";
}

function resolvePdf(row: any): string | null {
  // file_path is set at ingest; fall back to the canonical <id>.pdf location.
  if (row.file_path && fs.existsSync(row.file_path)) return row.file_path;
  const canonical = getCatalogPdfPath(row.id);
  if (fs.existsSync(canonical)) return canonical;
  return null;
}

function main() {
  const rows = db.prepare(
    `SELECT id, model, file_path FROM partsetu_catalogs WHERE chassis_type IS NULL OR chassis_type = ''`,
  ).all() as any[];
  let processed = 0, extracted = 0, skipped = 0;
  for (const row of rows) {
    processed++;
    const pdf = resolvePdf(row);
    if (!pdf) {
      skipped++;
      console.log(`[backfill] catalog_id=${row.id} model="${row.model || ""}" SKIP (no PDF on disk)`);
      continue;
    }
    let text = "";
    try { text = coverText(pdf); }
    catch (e: any) { skipped++; console.log(`[backfill] catalog_id=${row.id} SKIP (pdftotext failed: ${e?.message || e})`); continue; }
    const value = seedChassisType(row.id, text);
    if (value) extracted++; else skipped++;
  }
  console.log(`[backfill] processed: ${processed}, extracted: ${extracted}, skipped: ${skipped} (no PDF or no match)`);
}

main();
