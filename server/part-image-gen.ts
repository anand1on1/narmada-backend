// =====================================================================
// R28 Session 3 — server/part-image-gen.ts
//
// Verbatim user requirements (preserved as inline comments per task rules):
//   * "on the image section an image resembling the item i.e if its a uj cross
//      then a cross image should be used with disclaimer the image is only for
//      representation purpose"
//   * "I GUESS YOU CAN YOU PERPLEXITY API TO GENERATE MINIMAL IMAGES WHICH DOES
//      NOT BURN CONSIDERABLE CREDITS"
//
// Behavior:
//   1. Normalize a `cache_key` from description keywords (e.g. "UJ Cross",
//      "U-Joint Cross" → 'uj-cross'; "Clutch Plate 380mm" → 'clutch-plate').
//   2. Look up part_image_cache by key. If hit → bump usage_count/last_used_at
//      and return {url, source:'reused'}.
//   3. Miss + AUTO_PUBLISH_IMAGE_GEN_ENABLED='true' → call Perplexity image API
//      (cheapest model via PERPLEXITY_IMAGE_MODEL env; default 'nano_banana_2'),
//      upload result to R2 (reuses Session 1 R2 env vars), cache and return
//      {url, source:'generated'}.
//   4. Miss + flag off (or any error) → return
//      {url:'/images/placeholder-part.png', source:'placeholder'}.
//   5. NEVER throws. Wrapped end-to-end in try/catch — falls back to placeholder.
//   6. 30-second hard timeout on the external image call (Promise.race with an
//      AbortController). This function IS awaited by the caller so a stuck API
//      must not block the notify-Delhi request chain.
// =====================================================================

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { rawSqlite } from "./storage";

export const DEFAULT_PLACEHOLDER_URL = "/images/placeholder-part.png";
const IMAGE_GEN_TIMEOUT_MS = 30_000;

// ---- Prompt template (kept minimal per "does not burn considerable credits" rule)
function buildPrompt(description: string): string {
  return (
    `Simple product illustration of an automotive spare part: ${description}. ` +
    `Clean white background, front-facing view, technical catalog style, ` +
    `no text, no logos, minimal detail, single centered object.`
  );
}

// ---- Cache-key normaliser
// Strategy: lowercase, strip punctuation, drop obvious measurement/model-code
// tokens (things containing digits or a slash), keep the first 2-3 significant
// words, kebab-case them.
export function normaliseCacheKey(input: string): string {
  const raw = String(input || "").toLowerCase().trim();
  if (!raw) return "generic-part";
  // Split on non-alphanum boundaries.
  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const significant: string[] = [];
  const STOPWORDS = new Set([
    "the", "a", "an", "of", "for", "with", "and", "or", "to", "on", "in",
    "type", "pcs", "pc", "no", "nos", "each", "set", "part", "spare",
  ]);
  for (const t of tokens) {
    if (significant.length >= 3) break;
    if (STOPWORDS.has(t)) continue;
    // Drop obvious size tokens: pure numeric or numeric+unit suffix (e.g. 380mm, 12v, 5kg).
    if (/^\d/.test(t)) continue;
    // Drop very short tokens unless they're the only signal.
    if (t.length < 2) continue;
    significant.push(t);
  }
  if (significant.length === 0) {
    // Fall back to first token as-is.
    return tokens[0] || "generic-part";
  }
  return significant.slice(0, 3).join("-");
}

// ---- Cache reads/writes on part_image_cache (raw sqlite for robustness)
interface PartImageCacheRow {
  id: number;
  cache_key: string;
  image_url: string;
  image_source: string;
  prompt_used: string | null;
  generated_at: number;
  usage_count: number;
  last_used_at: number | null;
}

function getFromCache(cacheKey: string): PartImageCacheRow | undefined {
  try {
    return rawSqlite
      .prepare(`SELECT * FROM part_image_cache WHERE cache_key = ?`)
      .get(cacheKey) as PartImageCacheRow | undefined;
  } catch {
    return undefined;
  }
}

function bumpUsage(id: number): void {
  try {
    rawSqlite
      .prepare(`UPDATE part_image_cache SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  } catch {
    // non-fatal
  }
}

function saveToCache(row: Omit<PartImageCacheRow, "id" | "usage_count" | "last_used_at">): number | null {
  try {
    const info = rawSqlite
      .prepare(
        `INSERT INTO part_image_cache (cache_key, image_url, image_source, prompt_used, generated_at, usage_count, last_used_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           image_url = excluded.image_url,
           image_source = excluded.image_source,
           prompt_used = excluded.prompt_used,
           generated_at = excluded.generated_at,
           usage_count = usage_count + 1,
           last_used_at = excluded.last_used_at`,
      )
      .run(row.cache_key, row.image_url, row.image_source, row.prompt_used, row.generated_at, Date.now());
    return Number(info.lastInsertRowid);
  } catch (e: any) {
    console.error("[part-image-gen] saveToCache failed:", e?.message || e);
    return null;
  }
}

// ---- R2 upload (reuses Session 1 R2 env vars)
function buildR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function uploadToR2(pngBytes: Uint8Array, cacheKey: string): Promise<string | null> {
  const bucket = process.env.R2_BUCKET_NAME || "";
  const publicBase = process.env.R2_PUBLIC_URL_BASE || "";
  const client = buildR2Client();
  if (!client || !bucket || !publicBase) {
    console.warn("[part-image-gen] R2 not configured — skipping upload");
    return null;
  }
  const key = `part-images/${cacheKey}-${Date.now()}.png`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pngBytes,
      ContentType: "image/png",
    }));
    // R2_PUBLIC_URL_BASE is expected without a trailing slash; be defensive.
    const base = publicBase.replace(/\/+$/, "");
    return `${base}/${key}`;
  } catch (e: any) {
    console.error("[part-image-gen] R2 upload failed:", e?.message || e);
    return null;
  }
}

// ---- Perplexity image generation
// The Perplexity SDK for image models is not yet standardised in this repo;
// we call the documented image endpoint via fetch so no new npm dep is needed.
// If the endpoint / response shape differs at prod, adjust here. Never throws.
//
// The task spec mentions nano_banana_2 / seedream_5 as the cheapest tiers; we
// simply forward whatever PERPLEXITY_IMAGE_MODEL is set to (default nano_banana_2).
async function callPerplexityImageApi(prompt: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY || "";
  const model = process.env.PERPLEXITY_IMAGE_MODEL || "nano_banana_2";
  const endpoint = process.env.PERPLEXITY_IMAGE_ENDPOINT || "https://api.perplexity.ai/images/generate";
  if (!apiKey) {
    console.warn("[part-image-gen] PERPLEXITY_API_KEY not set — skipping generation");
    return null;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: "1:1",       // small square — minimal credits per user rule
        n: 1,
      }),
    });
    if (!res.ok) {
      console.warn(`[part-image-gen] Perplexity image API ${res.status} ${res.statusText}`);
      return null;
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.startsWith("image/")) {
      // Direct binary response.
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf;
    }
    // JSON response — try common shapes: { data: [{ b64_json }] } or { url }.
    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json || json?.images?.[0]?.b64_json || json?.b64_json;
    if (b64) return Uint8Array.from(Buffer.from(String(b64), "base64"));
    const imgUrl = json?.data?.[0]?.url || json?.images?.[0]?.url || json?.url;
    if (imgUrl) {
      const dl = await fetch(String(imgUrl), { signal });
      if (!dl.ok) return null;
      return new Uint8Array(await dl.arrayBuffer());
    }
    console.warn("[part-image-gen] Unknown response shape from image API");
    return null;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      console.warn("[part-image-gen] image API timed out at 30s — falling back to placeholder");
    } else {
      console.error("[part-image-gen] image API error:", e?.message || e);
    }
    return null;
  }
}

// ---- Public API ----
export interface RepresentationalImageResult {
  url: string;
  source: "generated" | "reused" | "placeholder";
  cacheKey?: string;
}

export async function getRepresentationalImage(
  partNumber: string,
  description: string,
  category?: string,
): Promise<RepresentationalImageResult> {
  // NEVER throws — every path returns a valid placeholder on failure.
  try {
    const source = [category, description, partNumber].filter(Boolean).join(" ");
    const cacheKey = normaliseCacheKey(source);

    // 1. Cache hit?
    const hit = getFromCache(cacheKey);
    if (hit) {
      bumpUsage(hit.id);
      return { url: hit.image_url, source: "reused", cacheKey };
    }

    // 2. Miss + flag off → placeholder
    const genEnabled = String(process.env.AUTO_PUBLISH_IMAGE_GEN_ENABLED ?? "false").toLowerCase() === "true";
    if (!genEnabled) {
      return { url: DEFAULT_PLACEHOLDER_URL, source: "placeholder", cacheKey };
    }

    // 3. Miss + flag on → generate (30s hard timeout via AbortController)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);
    const prompt = buildPrompt(description || partNumber || "automotive spare part");
    let pngBytes: Uint8Array | null = null;
    try {
      pngBytes = await callPerplexityImageApi(prompt, controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (!pngBytes || pngBytes.byteLength === 0) {
      return { url: DEFAULT_PLACEHOLDER_URL, source: "placeholder", cacheKey };
    }

    // 4. Upload to R2
    const r2Url = await uploadToR2(pngBytes, cacheKey);
    if (!r2Url) {
      return { url: DEFAULT_PLACEHOLDER_URL, source: "placeholder", cacheKey };
    }

    // 5. Save to cache
    saveToCache({
      cache_key: cacheKey,
      image_url: r2Url,
      image_source: "generated",
      prompt_used: prompt,
      generated_at: Date.now(),
    });

    return { url: r2Url, source: "generated", cacheKey };
  } catch (e: any) {
    console.error("[part-image-gen] unexpected error, falling back to placeholder:", e?.message || e);
    return { url: DEFAULT_PLACEHOLDER_URL, source: "placeholder" };
  }
}

// ---- Admin helpers (used by admin endpoints in routes-v2.ts)

export function listCachedImages(opts: { limit?: number; offset?: number } = {}): PartImageCacheRow[] {
  const limit = Math.min(Math.max(Number(opts.limit ?? 100), 1), 500);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  try {
    return rawSqlite
      .prepare(
        `SELECT * FROM part_image_cache ORDER BY usage_count DESC, last_used_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as PartImageCacheRow[];
  } catch {
    return [];
  }
}

export function deleteCachedImage(id: number): boolean {
  try {
    const info = rawSqlite.prepare(`DELETE FROM part_image_cache WHERE id = ?`).run(id);
    return info.changes > 0;
  } catch {
    return false;
  }
}

export async function replaceCachedImage(
  id: number,
  pngBytes: Uint8Array,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const row = rawSqlite.prepare(`SELECT * FROM part_image_cache WHERE id = ?`).get(id) as PartImageCacheRow | undefined;
    if (!row) return { ok: false, error: "not_found" };
    const url = await uploadToR2(pngBytes, `${row.cache_key}-manual`);
    if (!url) return { ok: false, error: "r2_upload_failed" };
    rawSqlite
      .prepare(`UPDATE part_image_cache SET image_url = ?, image_source = 'manual-upload', generated_at = ?, last_used_at = ? WHERE id = ?`)
      .run(url, Date.now(), Date.now(), id);
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Simple backfill helper: find top-N placeholder auto-publish rows and try to
// regenerate. Returns per-row summary. Used by POST /api/admin/part-images/backfill.
export async function backfillPlaceholders(limit: number = 10): Promise<Array<{
  po_id: number;
  part_number: string;
  before: string;
  after: string;
  source: string;
}>> {
  const cap = Math.min(Math.max(limit, 1), 50);
  const rows = rawSqlite
    .prepare(
      `SELECT id, po_id, part_number, description, image_url
         FROM auto_publish_log
        WHERE image_source = 'placeholder'
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(cap) as Array<{ id: number; po_id: number; part_number: string; description: string; image_url: string | null }>;
  const results: Array<{ po_id: number; part_number: string; before: string; after: string; source: string }> = [];
  for (const r of rows) {
    const before = r.image_url || DEFAULT_PLACEHOLDER_URL;
    const img = await getRepresentationalImage(r.part_number, r.description);
    if (img.source !== "placeholder") {
      try {
        rawSqlite
          .prepare(`UPDATE auto_publish_log SET image_url = ?, image_source = ? WHERE id = ?`)
          .run(img.url, img.source, r.id);
      } catch { /* non-fatal */ }
    }
    results.push({ po_id: r.po_id, part_number: r.part_number, before, after: img.url, source: img.source });
  }
  return results;
}
