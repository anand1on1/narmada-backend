// PartSetu AI v1.3 — catalog PDF storage on Render's persistent disk.
// PDFs live under ${DATA_DIR}/partsetu/catalogs/<catalog_id>.pdf so they survive
// deploys (DATA_DIR is the mounted persistent disk on Render). Pre-row uploads
// land in a tmp file and are promoted to <id>.pdf once the catalog row exists.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || ".";
const CATALOG_DIR = path.join(DATA_DIR, "partsetu", "catalogs");
const TMP_DIR = path.join(DATA_DIR, "partsetu", "tmp");

// Idempotent — also called at boot from server/index.ts.
export function ensureCatalogDirs(): void {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export function getCatalogPdfPath(catalogId: number): string {
  return path.join(CATALOG_DIR, `${catalogId}.pdf`);
}

// Write an uploaded buffer straight to <id>.pdf (used when the row already exists).
export function saveCatalogPdf(buffer: Buffer, catalogId: number): string {
  ensureCatalogDirs();
  const dest = getCatalogPdfPath(catalogId);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// Stage an upload before the catalog row (and therefore its id) exists.
export function saveTmpPdf(buffer: Buffer): string {
  ensureCatalogDirs();
  const dest = path.join(TMP_DIR, `tmp_${randomBytes(16).toString("hex")}.pdf`);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// Copy a source PDF (tmp upload or CLI input) to its final <id>.pdf location.
// Copy (not rename) so it works across filesystems and leaves CLI inputs intact;
// callers delete the tmp file separately via cleanup.
export function copyToCatalog(srcPath: string, catalogId: number): string {
  ensureCatalogDirs();
  const dest = getCatalogPdfPath(catalogId);
  if (path.resolve(srcPath) !== path.resolve(dest)) fs.copyFileSync(srcPath, dest);
  return dest;
}

export function deleteTmp(tmpPath: string): void {
  try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* non-fatal */ }
}

export function deleteCatalogPdf(catalogId: number): void {
  const p = getCatalogPdfPath(catalogId);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* non-fatal */ }
}

export function catalogPdfExists(catalogId: number): boolean {
  return fs.existsSync(getCatalogPdfPath(catalogId));
}

export function catalogPdfSize(catalogId: number): number {
  try { return fs.statSync(getCatalogPdfPath(catalogId)).size; } catch { return 0; }
}
