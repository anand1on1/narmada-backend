// PartSetu AI v1 — catalog ingestion CLI.
// Thin wrapper around the shared ingester in server/services/catalog-ingester.ts
// so the CLI and the admin upload route run identical parsing/insert logic.
// The PDF is copied to ${DATA_DIR}/partsetu/catalogs/<id>.pdf (persistent disk).
//
// Usage:  npx tsx server/scripts/ingest-catalog.ts <pdf> [--oem TATA] [--diagrams]
//
// Note: --diagrams (page-image rendering) is no longer performed by the CLI; the
// part rows still carry their diagram_path. Render diagrams separately if needed.
import * as fs from "node:fs";
import { ingestCatalogPdf } from "../services/catalog-ingester";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdfPath = process.argv[2];
if (!pdfPath || pdfPath.startsWith("--")) {
  console.error("Usage: npx tsx server/scripts/ingest-catalog.ts <pdf> [--oem TATA]");
  process.exit(1);
}
if (!fs.existsSync(pdfPath)) {
  console.error(`[ingest-catalog] file not found: ${pdfPath}`);
  process.exit(1);
}

const OEM = arg("--oem") || "TATA";

(async () => {
  console.log(`[ingest-catalog] reading ${pdfPath}`);
  try {
    const r = await ingestCatalogPdf({ pdfPath, uploadedBy: "cli", oem: OEM, cleanupSrc: false });
    console.log(`[ingest-catalog] catalog id=${r.catalogId} vc_no=${r.vcNo} model="${r.model.slice(0, 60)}..."`);
    console.log(`[ingest-catalog] inserted ${r.partsCount} parts. done.`);
  } catch (e: any) {
    console.error(`[ingest-catalog] FAILED: ${e?.message || e}`);
    process.exit(1);
  }
})();
