// PartSetu R27.22 — AI-driven cross-reference (xref) format detector.
// Given an uploaded workbook it (1) fingerprints the layout, (2) checks a
// persistent cache so similar re-uploads skip the AI, (3) otherwise asks Haiku
// to propose a per-sheet column-mapping plan, and (4) stages the file so the
// confirm step can ingest it without a re-upload. The user always confirms the
// plan in the UI before any rows are written; if AI is unavailable the caller
// falls back to the deterministic R27.19/R27.21 handlers ("Skip Detection").
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as XLSXns from "xlsx";
import { rawSqlite as db } from "../storage";
import { callClaudeHaiku, isPartSetuClaudeConfigured } from "./claude";
import type { XrefMappingPlan } from "./xref-ingester";

const XLSX: any = (XLSXns as any).read ? XLSXns : (XLSXns as any).default || XLSXns;

const STAGING_DIR = path.join(process.env.DATA_DIR || ".", "uploads", "partsetu", "xrefs", "staging");
function ensureStaging(): void { try { fs.mkdirSync(STAGING_DIR, { recursive: true }); } catch { /* non-fatal */ } }
export function xrefStagingPath(fingerprint: string): string {
  return path.join(STAGING_DIR, `${fingerprint}.xlsx`);
}

const PREVIEW_ROWS = 5;
const PREVIEW_COLS = 15;

export interface XrefSheetPreview { sheet: string; rows: any[][] }
export interface XrefDetectResult {
  fingerprint: string;
  cached: boolean;
  plan: XrefMappingPlan | null;
  preview: XrefSheetPreview[];
  ai?: { ok: boolean; error?: string; latencyMs?: number };
}

// Fingerprint = sha256 of (sorted sheet names + first row of each sheet), lowercased.
function computeFingerprint(wb: any): string {
  const parts: string[] = [];
  const names = [...wb.SheetNames].sort((a: string, b: string) => a.localeCompare(b));
  for (const sn of names) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" }) as any[][];
    const first = (rows[0] || []).map((c) => String(c ?? "").trim()).join("|");
    parts.push(`${sn}::${first}`);
  }
  return createHash("sha256").update(parts.join("\n").toLowerCase()).digest("hex");
}

function buildPreviews(wb: any): XrefSheetPreview[] {
  const out: XrefSheetPreview[] = [];
  for (const sn of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" }) as any[][];
    const clipped = rows.slice(0, PREVIEW_ROWS).map((r) => (r || []).slice(0, PREVIEW_COLS).map((c) => String(c ?? "")));
    out.push({ sheet: sn, rows: clipped });
  }
  return out;
}

const SYSTEM_PROMPT = `You are a strict spreadsheet-layout detector for an automotive cross-reference upload pipeline. You will receive sheet names + a preview of each sheet (first 5 rows × first 15 columns). Identify, for each sheet:
- Whether it contains cross-reference data (action="ingest") or should be skipped (action="skip"; provide reason)
- The column indices (0-based) for: source_col (the OEM/customer part number), customer_col (the seller brand's part number), desc_col (description if any, else -1)
- The source brand if detectable from sheet name or vehicle-application column (TML/AL/Eicher/BharatBenz/Volvo/SML/AMW/BEML/Caterpillar/Escorts/ManForce/FML/EML/OEM)
- The header_row index (0-based)

Determine the file-level brand (the seller whose part numbers we're storing as cross-references):
- From sheet names if every sheet is named with an OEM brand
- From filename otherwise
- From column headers like "<BRAND> Part No"

Classify the layout as: "brand-per-sheet" | "wide-pair" | "filename-brand" | "single-sheet" | "superseded".

Output STRICT JSON only (no prose), matching this schema:
{"file_brand":"MEI","layout":"filename-brand","confidence":0.0,"sheets":[{"name":"Table 4","action":"ingest","source_brand":"TML","source_col":2,"customer_col":3,"desc_col":1,"header_row":0,"reason":"..."},{"name":"Table 72","action":"skip","reason":"employee contact list"}]}
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

function normalizePlan(raw: any): XrefMappingPlan | null {
  if (!raw || !Array.isArray(raw.sheets)) return null;
  const sheets = raw.sheets.map((s: any) => ({
    name: String(s?.name ?? ""),
    action: s?.action === "skip" ? "skip" : "ingest",
    source_brand: s?.source_brand != null ? String(s.source_brand) : undefined,
    source_col: s?.source_col != null ? Number(s.source_col) : undefined,
    customer_col: s?.customer_col != null ? Number(s.customer_col) : undefined,
    desc_col: s?.desc_col != null ? Number(s.desc_col) : -1,
    header_row: s?.header_row != null ? Number(s.header_row) : 0,
    reason: s?.reason != null ? String(s.reason) : undefined,
  })).filter((s: any) => s.name);
  if (!sheets.length) return null;
  return {
    file_brand: String(raw.file_brand ?? "").trim() || "OEM",
    layout: raw.layout != null ? String(raw.layout) : undefined,
    confidence: raw.confidence != null ? Number(raw.confidence) : undefined,
    sheets,
  };
}

// Look up a cached plan by fingerprint; bumps hit_count / last_used_at on hit.
export function lookupXrefCache(fingerprint: string): { plan: XrefMappingPlan; label: string | null } | null {
  const row = db.prepare(
    `SELECT * FROM partsetu_xref_format_cache WHERE fingerprint = ? ORDER BY last_used_at DESC, id DESC LIMIT 1`,
  ).get(fingerprint) as any;
  if (!row) return null;
  try {
    const plan = normalizePlan(JSON.parse(row.plan_json));
    if (!plan) return null;
    db.prepare(`UPDATE partsetu_xref_format_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?`)
      .run(Date.now(), row.id);
    return { plan, label: row.format_label || null };
  } catch { return null; }
}

// Persist a confirmed plan to the cache. source: 'user-confirmed' | 'user-edited' | 'ai'.
export function saveXrefCache(opts: {
  fingerprint: string; plan: XrefMappingPlan; source: string; label?: string | null; createdBy?: string;
}): void {
  const ts = Date.now();
  db.prepare(
    `INSERT INTO partsetu_xref_format_cache
       (fingerprint, format_label, file_brand, plan_json, source, confidence, hit_count, last_used_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    opts.fingerprint, opts.label || null, opts.plan.file_brand || null,
    JSON.stringify(opts.plan), opts.source, opts.plan.confidence ?? null,
    ts, opts.createdBy || null, ts,
  );
}

// Detect the format of an uploaded xref workbook buffer. Stages the file under
// its fingerprint so confirmXref can ingest it. Returns cached plan if present.
export async function detectXrefFormat(opts: {
  buffer: Buffer; filename: string;
}): Promise<XrefDetectResult> {
  const wb = XLSX.read(opts.buffer, { type: "buffer" });
  const fingerprint = computeFingerprint(wb);
  const preview = buildPreviews(wb);

  ensureStaging();
  fs.writeFileSync(xrefStagingPath(fingerprint), opts.buffer);

  const cached = lookupXrefCache(fingerprint);
  if (cached) {
    return { fingerprint, cached: true, plan: cached.plan, preview };
  }

  if (!isPartSetuClaudeConfigured()) {
    return { fingerprint, cached: false, plan: null, preview, ai: { ok: false, error: "AI not configured" } };
  }

  const userPrompt = `Filename: ${opts.filename}\nSheets and previews:\n${JSON.stringify(preview)}`;
  const res = await callClaudeHaiku(SYSTEM_PROMPT, [{ role: "user", content: userPrompt }], 2048);
  if (!res.ok) {
    return { fingerprint, cached: false, plan: null, preview, ai: { ok: false, error: res.error, latencyMs: res.latencyMs } };
  }
  const plan = normalizePlan(extractJson(res.text));
  // Confidence < 0.30 → treat as no usable plan; UI falls back to legacy handlers.
  if (!plan || (plan.confidence != null && plan.confidence < 0.3)) {
    return { fingerprint, cached: false, plan: null, preview, ai: { ok: true, latencyMs: res.latencyMs } };
  }
  return { fingerprint, cached: false, plan, preview, ai: { ok: true, latencyMs: res.latencyMs } };
}
