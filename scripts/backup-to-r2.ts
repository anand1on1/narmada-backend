// R28 Session 1 — Nightly SQLite → Cloudflare R2 encrypted backup.
//
// Flow:
//   1. Snapshot   data.db with `sqlite3 <db> ".backup <tmp>"`
//                 (falls back to better-sqlite3 backup() if sqlite3 CLI missing).
//   2. Gzip       the snapshot.
//   3. Encrypt    with `age -p` (preferred) or openssl aes-256-cbc pbkdf2 (fallback).
//   4. Upload     to s3://$R2_BUCKET_NAME/YYYY/MM/DD/data.db.gz.age via S3-compatible API.
//   5. Verify     via HeadObject after PutObject (ETag round-trip).
//   6. Retention  keep 30 daily, 12 monthly (1st of month), 5 yearly (1st of year).
//   7. Audit      write a row to backup_log (success or failed).
//
// Env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
//   R2_ENDPOINT (default: https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com),
//   R2_REGION (default: auto),
//   BACKUP_ENCRYPTION_PASSPHRASE (required),
//   DATABASE_PATH (default: $DATA_DIR/data.db  or  ./data.db).
//
// Run:  npm run backup

import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";

// ---- helpers ----
function log(step: string, extra?: Record<string, unknown>) {
  const rec = { ts: new Date().toISOString(), step, ...extra };
  console.log(JSON.stringify(rec));
}
function fail(step: string, err: unknown): never {
  const msg = (err as Error)?.message || String(err);
  log(step + ":error", { error: msg });
  throw new Error(`${step}: ${msg}`);
}
function has(cmd: string): boolean {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return r.status === 0;
}
function nowUtcParts(): { yyyy: string; mm: string; dd: string; iso: string } {
  const d = new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd, iso: d.toISOString() };
}

// ---- backup_log (best-effort — never blocks the exit code) ----
function writeBackupLog(row: { started_at: number; finished_at: number | null; status: "success" | "failed"; file_key: string | null; size_bytes: number | null; error_message: string | null }) {
  try {
    const dbPath = getDbPath();
    if (!existsSync(dbPath)) return;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        file_key TEXT,
        size_bytes INTEGER,
        error_message TEXT
      );
    `);
    db.prepare(`INSERT INTO backup_log (started_at, finished_at, status, file_key, size_bytes, error_message)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.started_at, row.finished_at, row.status, row.file_key, row.size_bytes, row.error_message);
    db.close();
  } catch (e: any) {
    console.error("[backup] backup_log write failed:", e?.message || e);
  }
}

function getDbPath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const dataDir = process.env.DATA_DIR || ".";
  return path.join(dataDir, "data.db");
}

// ---- 1. snapshot ----
function snapshotSqlite(src: string, dst: string): void {
  if (has("sqlite3")) {
    const r = spawnSync("sqlite3", [src, `.backup '${dst.replace(/'/g, "'\\''")}'`], { stdio: "inherit", shell: false });
    if (r.status !== 0) fail("snapshot.sqlite3-cli", new Error(`exit ${r.status}`));
    return;
  }
  // Fallback: better-sqlite3 backup API is async but returns a Promise-like object.
  log("snapshot.fallback", { note: "sqlite3 CLI not found; using better-sqlite3 backup API" });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  // @ts-expect-error better-sqlite3 types miss .backup at 11.x but the API exists at runtime.
  const p = db.backup(dst);
  if (p && typeof (p as Promise<unknown>).then === "function") {
    // top-level await workaround via deasync-ish: block on a tiny loop is not clean;
    // instead we just await in the outer async main() (called below). Return the promise via throwing.
    throw p;
  }
  db.close();
}

// ---- 2. gzip ----
async function gzipFile(src: string, dst: string): Promise<void> {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dst));
}

// ---- 3. encrypt ----
function encryptFile(src: string, dst: string, passphrase: string): { tool: "age" | "openssl" } {
  const passFile = path.join(tmpdir(), `narmada-backup-pass-${randomBytes(8).toString("hex")}.txt`);
  writeFileSync(passFile, passphrase, { mode: 0o600 });
  try {
    if (has("age")) {
      const r = spawnSync("age", ["-p", "-o", dst, src], { input: passphrase + "\n" + passphrase + "\n", encoding: "utf8" });
      if (r.status !== 0) fail("encrypt.age", new Error(r.stderr || `exit ${r.status}`));
      return { tool: "age" };
    }
    // openssl fallback — always installed in most Linux containers.
    if (!has("openssl")) fail("encrypt.no-tool", new Error("neither age nor openssl available"));
    const r = spawnSync("openssl", [
      "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt",
      "-in", src, "-out", dst, "-pass", `file:${passFile}`,
    ]);
    if (r.status !== 0) fail("encrypt.openssl", new Error(r.stderr?.toString() || `exit ${r.status}`));
    return { tool: "openssl" };
  } finally {
    try { unlinkSync(passFile); } catch {}
  }
}

// ---- 4. upload ----
function buildClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!endpoint) fail("client.endpoint", new Error("R2_ENDPOINT or R2_ACCOUNT_ID required"));
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
  });
}

async function uploadWithVerify(client: S3Client, bucket: string, key: string, filePath: string): Promise<{ size: number; etag: string | undefined }> {
  const size = statSync(filePath).size;
  const body = readFileSync(filePath);
  const put = await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/octet-stream",
  }));
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (!head.ContentLength || head.ContentLength !== size) {
    fail("upload.verify", new Error(`size mismatch: local=${size} remote=${head.ContentLength}`));
  }
  return { size, etag: put.ETag || head.ETag };
}

// ---- 5. retention ----
async function applyRetention(client: S3Client, bucket: string): Promise<{ kept: number; deleted: number }> {
  const objects: Array<{ Key: string; LastModified: Date }> = [];
  let token: string | undefined;
  do {
    const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    (out.Contents || []).forEach((o) => {
      if (o.Key && o.LastModified) objects.push({ Key: o.Key, LastModified: o.LastModified });
    });
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const keep = new Set<string>();

  // Sort newest first.
  objects.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());

  // 30 daily (last 30 days, one per day, newest).
  const seenDay = new Set<string>();
  for (const o of objects) {
    if (now - o.LastModified.getTime() > 30 * day) break;
    const k = o.LastModified.toISOString().slice(0, 10);
    if (!seenDay.has(k)) { seenDay.add(k); keep.add(o.Key); if (seenDay.size >= 30) break; }
  }
  // 12 monthly — first-of-month backups (day == 01). Newest 12.
  const seenMonth = new Set<string>();
  for (const o of objects) {
    const d = o.LastModified.getUTCDate();
    if (d !== 1) continue;
    const k = o.LastModified.toISOString().slice(0, 7);
    if (!seenMonth.has(k)) { seenMonth.add(k); keep.add(o.Key); if (seenMonth.size >= 12) break; }
  }
  // 5 yearly — Jan 1 backups. Newest 5.
  const seenYear = new Set<string>();
  for (const o of objects) {
    const d = o.LastModified.getUTCDate();
    const m = o.LastModified.getUTCMonth() + 1;
    if (!(d === 1 && m === 1)) continue;
    const k = String(o.LastModified.getUTCFullYear());
    if (!seenYear.has(k)) { seenYear.add(k); keep.add(o.Key); if (seenYear.size >= 5) break; }
  }

  const toDelete = objects.filter((o) => !keep.has(o.Key)).map((o) => ({ Key: o.Key }));
  if (!toDelete.length) return { kept: keep.size, deleted: 0 };

  // DeleteObjects accepts up to 1000 keys per call.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 1000) {
    const chunk = toDelete.slice(i, i + 1000);
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk, Quiet: true } }));
    deleted += chunk.length;
  }
  return { kept: keep.size, deleted };
}

// ---- main ----
async function main(): Promise<void> {
  const startedAt = Date.now();

  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE || "";
  if (!passphrase) {
    writeBackupLog({ started_at: startedAt, finished_at: Date.now(), status: "failed", file_key: null, size_bytes: null, error_message: "BACKUP_ENCRYPTION_PASSPHRASE missing" });
    fail("env.passphrase", new Error("BACKUP_ENCRYPTION_PASSPHRASE required"));
  }
  const bucket = process.env.R2_BUCKET_NAME || "";
  if (!bucket) {
    writeBackupLog({ started_at: startedAt, finished_at: Date.now(), status: "failed", file_key: null, size_bytes: null, error_message: "R2_BUCKET_NAME missing" });
    fail("env.bucket", new Error("R2_BUCKET_NAME required"));
  }
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    writeBackupLog({ started_at: startedAt, finished_at: Date.now(), status: "failed", file_key: null, size_bytes: null, error_message: `db not found: ${dbPath}` });
    fail("env.db", new Error(`sqlite db not found at ${dbPath}`));
  }
  log("start", { dbPath, bucket });

  const workDir = path.join(tmpdir(), `narmada-backup-${randomBytes(6).toString("hex")}`);
  mkdirSync(workDir, { recursive: true });
  const snapPath = path.join(workDir, "data.db");
  const gzPath = path.join(workDir, "data.db.gz");
  const encPath = path.join(workDir, "data.db.gz.age");

  const { yyyy, mm, dd } = nowUtcParts();
  const key = `${yyyy}/${mm}/${dd}/data.db.gz.age`;
  let fileKey: string | null = null;
  let size: number | null = null;

  try {
    log("snapshot.begin");
    try {
      snapshotSqlite(dbPath, snapPath);
    } catch (maybePromise) {
      // fallback path returns a Promise via `throw`.
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        await (maybePromise as Promise<unknown>);
      } else {
        throw maybePromise;
      }
    }
    log("snapshot.done", { size: statSync(snapPath).size });

    log("gzip.begin");
    await gzipFile(snapPath, gzPath);
    log("gzip.done", { size: statSync(gzPath).size });

    log("encrypt.begin");
    const { tool } = encryptFile(gzPath, encPath, passphrase);
    log("encrypt.done", { tool, size: statSync(encPath).size });

    log("upload.begin", { key });
    const client = buildClient();
    const { size: uploadedSize, etag } = await uploadWithVerify(client, bucket, key, encPath);
    fileKey = key;
    size = uploadedSize;
    log("upload.done", { key, size: uploadedSize, etag });

    log("retention.begin");
    const ret = await applyRetention(client, bucket);
    log("retention.done", ret);

    writeBackupLog({
      started_at: startedAt,
      finished_at: Date.now(),
      status: "success",
      file_key: fileKey,
      size_bytes: size,
      error_message: null,
    });
    log("done", { status: "success" });
  } catch (e: any) {
    const msg = e?.message || String(e);
    writeBackupLog({
      started_at: startedAt,
      finished_at: Date.now(),
      status: "failed",
      file_key: fileKey,
      size_bytes: size,
      error_message: msg,
    });
    log("done", { status: "failed", error: msg });
    process.exitCode = 1;
    throw e;
  } finally {
    for (const f of [snapPath, gzPath, encPath]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
    try { const fs = await import("node:fs/promises"); await fs.rm(workDir, { recursive: true, force: true }); } catch {}
  }
}

// Support dry-run: DRY_RUN=1 skips upload + retention, still exercises snapshot/gzip/encrypt.
if (process.env.DRY_RUN === "1") {
  (async () => {
    log("dry-run.start");
    const startedAt = Date.now();
    const dbPath = getDbPath();
    const workDir = path.join(tmpdir(), `narmada-backup-dry-${randomBytes(6).toString("hex")}`);
    mkdirSync(workDir, { recursive: true });
    const snapPath = path.join(workDir, "data.db");
    const gzPath = path.join(workDir, "data.db.gz");
    const encPath = path.join(workDir, "data.db.gz.age");
    try {
      try {
        snapshotSqlite(dbPath, snapPath);
      } catch (maybePromise) {
        if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
          await (maybePromise as Promise<unknown>);
        } else throw maybePromise;
      }
      log("snapshot.done", { size: statSync(snapPath).size });
      await gzipFile(snapPath, gzPath);
      log("gzip.done", { size: statSync(gzPath).size });
      const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE || "dry-run-placeholder";
      const { tool } = encryptFile(gzPath, encPath, passphrase);
      log("encrypt.done", { tool, size: statSync(encPath).size });
      log("dry-run.done", { elapsedMs: Date.now() - startedAt });
    } finally {
      for (const f of [snapPath, gzPath, encPath]) { try { if (existsSync(f)) unlinkSync(f); } catch {} }
      try { const fs = await import("node:fs/promises"); await fs.rm(workDir, { recursive: true, force: true }); } catch {}
    }
  })().catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
