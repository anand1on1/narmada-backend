// PartSetu R27.22 — AI-driven catalog-PDF metadata detector.
// Given an uploaded catalog PDF it (1) fingerprints the first-page text, (2)
// checks a persistent cache so similar re-uploads skip the AI, (3) otherwise
// asks Haiku to extract the catalog metadata (oem/model/variant/etc.), and (4)
// stages the PDF under its fingerprint so confirm-upload can ingest it without a
// re-upload. The user always confirms the metadata in the UI before the catalog
// row is written; if AI is unavailable the caller falls back to the deterministic
// parser by uploading via the legacy route ("Skip Detection").
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { rawSqlite as db } from "../storage";
import { callClaudeHaiku, isPartSetuClaudeConfigured } from "./claude";
import type { CatalogMetaOverride } from "./catalog-ingester";

const STAGING_DIR = path.join(process.env.DATA_DIR || ".", "uploads", "partsetu", "catalogs", "staging");
function ensureStaging(): void { try { fs.mkdirSync(STAGING_DIR, { recursive: true }); } catch { /* non-fatal */ } }
export function catalogStagingPath(fingerprint: string): string {
  return path.join(STAGING_DIR, `${fingerprint}.pdf`);
}

// First N pages of layout-preserved text — enough for the cover + spec pages.
function pdfFirstPagesText(pdfPath: string, lastPage = 2): string {
  try {
    return execFileSync(
      "pdftotext",
      ["-f", "1", "-l", String(lastPage), "-layout", "-enc", "UTF-8", pdfPath, "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    ).toString("utf8");
  } catch { return ""; }
}

export interface CatalogMetadata {
  oem?: string | null; model?: string | null; variant?: string | null;
  chassis_no?: string | null; vc_no?: string | null;
  emission_stage?: string | null; body_type?: string | null; drive_type?: string | null;
  tyre_count?: number | null; fuel_type?: string | null; engine_family?: string | null;
  short_desc?: string | null; long_desc?: string | null;
}

export interface CatalogDetectResult {
  fingerprint: string;
  cached: boolean;
  metadata: CatalogMetadata | null;
  confidence: number | null;
  snippets: string[];
  ai?: { ok: boolean; error?: string; latencyMs?: number };
}

// Fingerprint = sha256 of the first-page text, lowercased and whitespace-collapsed.
function computeFingerprint(firstPageText: string): string {
  const norm = String(firstPageText || "").toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex");
}

const SNIPPET_LINES = 12;
function buildSnippets(text: string): string[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .slice(0, SNIPPET_LINES);
}

const SYSTEM_PROMPT = `You are an automotive catalog metadata extractor for a commercial-vehicle spare-parts pipeline. You will receive the first 1-2 pages of text from a vehicle spare-parts catalogue PDF (typically a TATA Motors / Ashok Leyland style cover + spec page). Extract the catalog-level metadata.

Fields to extract (use null when the value is genuinely absent — do NOT guess):
- oem: the vehicle manufacturer (e.g. TATA, Ashok Leyland, Eicher, BharatBenz, Volvo, SML, AMW, BEML)
- model: the vehicle model/range (e.g. "SIGNA 2825.K", "PRIMA 2830.K")
- variant: the chassis/variant code or sub-model
- chassis_no: chassis type/number if printed
- vc_no: the VC No (vehicle configuration number) if printed
- emission_stage: emission norm if printed (e.g. BS3, BS4, BS6, BSVI)
- body_type: e.g. tipper, haulage, tractor, cargo, bus
- drive_type: drive configuration (e.g. 4X2, 6X4, 8X4, 10X2)
- tyre_count: number of tyres, derived from drive_type when not explicit: 4X2=4, 6X4=10, 10X2=10, ac10x2=12, 8X4=12 (else null)
- fuel_type: diesel/cng/electric if printed
- engine_family: engine model/family if printed
- short_desc: a one-line human summary (<= 120 chars)
- long_desc: a 1-3 sentence description

Output STRICT JSON only (no prose), matching this schema:
{"oem":"TATA","model":"SIGNA 2825.K","variant":null,"chassis_no":null,"vc_no":"...","emission_stage":"BS6","body_type":"tipper","drive_type":"8X4","tyre_count":12,"fuel_type":"diesel","engine_family":null,"short_desc":"...","long_desc":"...","confidence":0.0}
Confidence is your honest 0..1 estimate.`;

function extractJson(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function str(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeMetadata(raw: any): { metadata: CatalogMetadata; confidence: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const tyre = raw.tyre_count != null && Number.isFinite(Number(raw.tyre_count)) ? Number(raw.tyre_count) : null;
  const metadata: CatalogMetadata = {
    oem: str(raw.oem), model: str(raw.model), variant: str(raw.variant),
    chassis_no: str(raw.chassis_no), vc_no: str(raw.vc_no),
    emission_stage: str(raw.emission_stage), body_type: str(raw.body_type), drive_type: str(raw.drive_type),
    tyre_count: tyre, fuel_type: str(raw.fuel_type), engine_family: str(raw.engine_family),
    short_desc: str(raw.short_desc), long_desc: str(raw.long_desc),
  };
  const confidence = raw.confidence != null && Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null;
  return { metadata, confidence };
}

// Look up a cached metadata row by fingerprint; bumps hit_count / last_used_at on hit.
export function lookupCatalogMetaCache(fingerprint: string): { metadata: CatalogMetadata; confidence: number | null } | null {
  const row = db.prepare(
    `SELECT * FROM partsetu_catalog_metadata_cache WHERE fingerprint = ? ORDER BY last_used_at DESC, id DESC LIMIT 1`,
  ).get(fingerprint) as any;
  if (!row) return null;
  db.prepare(`UPDATE partsetu_catalog_metadata_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?`)
    .run(Date.now(), row.id);
  return {
    metadata: {
      oem: row.oem ?? null, model: row.model ?? null, variant: row.variant ?? null,
      chassis_no: row.chassis_no ?? null, vc_no: row.vc_no ?? null,
      emission_stage: row.emission_stage ?? null, body_type: row.body_type ?? null, drive_type: row.drive_type ?? null,
      tyre_count: row.tyre_count ?? null, fuel_type: row.fuel_type ?? null, engine_family: row.engine_family ?? null,
      short_desc: row.short_desc ?? null, long_desc: row.long_desc ?? null,
    },
    confidence: row.confidence ?? null,
  };
}

// Persist confirmed metadata to the cache. source: 'user-confirmed' | 'user-edited' | 'ai'.
export function saveCatalogMetaCache(opts: {
  fingerprint: string; metadata: CatalogMetadata; confidence?: number | null; source: string; createdBy?: string;
}): void {
  const m = opts.metadata;
  const ts = Date.now();
  db.prepare(
    `INSERT INTO partsetu_catalog_metadata_cache
       (fingerprint, oem, model, variant, chassis_no, vc_no, emission_stage, body_type, drive_type,
        tyre_count, fuel_type, engine_family, short_desc, long_desc, confidence, source, hit_count, last_used_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    opts.fingerprint, m.oem ?? null, m.model ?? null, m.variant ?? null, m.chassis_no ?? null, m.vc_no ?? null,
    m.emission_stage ?? null, m.body_type ?? null, m.drive_type ?? null,
    m.tyre_count ?? null, m.fuel_type ?? null, m.engine_family ?? null, m.short_desc ?? null, m.long_desc ?? null,
    opts.confidence ?? null, opts.source, ts, opts.createdBy || null, ts,
  );
}

// Detect the metadata of an uploaded catalog PDF buffer. Stages the PDF under its
// fingerprint so confirmUpload can ingest it. Returns cached metadata if present.
export async function detectCatalogMetadata(opts: {
  buffer: Buffer; filename: string;
}): Promise<CatalogDetectResult> {
  ensureStaging();

  // Stage the PDF to a temp path first so pdftotext has a file to read; we then
  // rename it to its fingerprint-keyed final staging path.
  const tmpPath = path.join(STAGING_DIR, `tmp_${createHash("sha1").update(opts.filename + Date.now()).digest("hex").slice(0, 16)}.pdf`);
  fs.writeFileSync(tmpPath, opts.buffer);

  const firstPages = pdfFirstPagesText(tmpPath, 2);
  const fingerprint = computeFingerprint(firstPages);
  const snippets = buildSnippets(firstPages);

  const finalPath = catalogStagingPath(fingerprint);
  try { fs.renameSync(tmpPath, finalPath); } catch { try { fs.copyFileSync(tmpPath, finalPath); fs.unlinkSync(tmpPath); } catch { /* non-fatal */ } }

  const cached = lookupCatalogMetaCache(fingerprint);
  if (cached) {
    return { fingerprint, cached: true, metadata: cached.metadata, confidence: cached.confidence, snippets };
  }

  if (!isPartSetuClaudeConfigured()) {
    return { fingerprint, cached: false, metadata: null, confidence: null, snippets, ai: { ok: false, error: "AI not configured" } };
  }

  const userPrompt = `Filename: ${opts.filename}\nFirst pages text:\n${firstPages.slice(0, 12000)}`;
  const res = await callClaudeHaiku(SYSTEM_PROMPT, [{ role: "user", content: userPrompt }], 1536);
  if (!res.ok) {
    return { fingerprint, cached: false, metadata: null, confidence: null, snippets, ai: { ok: false, error: res.error, latencyMs: res.latencyMs } };
  }
  const norm = normalizeMetadata(extractJson(res.text));
  // Confidence < 0.30 → treat as no usable metadata; UI still lets the user fill it in.
  if (!norm || (norm.confidence != null && norm.confidence < 0.3)) {
    return { fingerprint, cached: false, metadata: norm?.metadata ?? null, confidence: norm?.confidence ?? null, snippets, ai: { ok: true, latencyMs: res.latencyMs } };
  }
  return { fingerprint, cached: false, metadata: norm.metadata, confidence: norm.confidence, snippets, ai: { ok: true, latencyMs: res.latencyMs } };
}

// Convert detected/confirmed metadata into the CatalogMetaOverride the ingester
// expects (same shape; passthrough kept explicit so future divergence is local).
export function toCatalogMetaOverride(m: CatalogMetadata): CatalogMetaOverride {
  return {
    oem: m.oem, model: m.model, variant: m.variant, vc_no: m.vc_no, chassis_no: m.chassis_no,
    emission_stage: m.emission_stage, body_type: m.body_type, drive_type: m.drive_type,
    tyre_count: m.tyre_count, fuel_type: m.fuel_type, engine_family: m.engine_family,
    short_desc: m.short_desc, long_desc: m.long_desc,
  };
}
