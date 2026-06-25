// PartSetu R27.23 — pluggable object storage (Cloudflare R2 ↔ local disk).
// Catalog images (and optionally the catalog PDFs) are written through this
// backend. When the R2 env vars are present we use the S3-compatible R2 API;
// otherwise everything falls back to the local persistent disk under DATA_DIR,
// so the feature works unchanged in dev / on Render without R2 provisioned.
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const LOCAL_ROOT = path.join(DATA_DIR, "uploads", "partsetu");

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";

export type StorageType = "r2" | "local";

export interface StorageBackend {
  // Persist a local file under `key`. Returns where it landed.
  uploadFile(localPath: string, key: string): Promise<{ storage_type: StorageType; key_or_path: string }>;
  // A URL the caller can hand to a browser (presigned for R2, file path for local).
  getFileUrl(key: string, storage_type: StorageType): Promise<string>;
  // A readable stream of the stored object (for serving through our own route).
  getFileStream(key: string, storage_type: StorageType): Promise<NodeJS.ReadableStream>;
}

export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

// ---- Local-disk backend ----------------------------------------------------
class LocalBackend implements StorageBackend {
  async uploadFile(localPath: string, key: string): Promise<{ storage_type: StorageType; key_or_path: string }> {
    const dest = path.join(LOCAL_ROOT, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(localPath) !== path.resolve(dest)) fs.copyFileSync(localPath, dest);
    return { storage_type: "local", key_or_path: dest };
  }
  async getFileUrl(key: string): Promise<string> {
    // `key` for local rows is the absolute on-disk path stored at upload time.
    return key;
  }
  async getFileStream(key: string): Promise<NodeJS.ReadableStream> {
    return fs.createReadStream(key);
  }
}

// ---- Cloudflare R2 backend (S3-compatible) ---------------------------------
// AWS SDK is loaded lazily through a non-literal require so `tsc` does not need
// the @aws-sdk/* type packages present to type-check, and esbuild keeps them
// external. The R2 path only executes when isR2Configured() is true.
class R2Backend implements StorageBackend {
  private client: any;
  private s3mod: any;
  private presignMod: any;

  private getClient() {
    if (!this.client) {
      const clientPkg = "@aws-sdk/client-s3";
      const presignPkg = "@aws-sdk/s3-request-presigner";
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.s3mod = (require as any)(clientPkg);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.presignMod = (require as any)(presignPkg);
      this.client = new this.s3mod.S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      });
    }
    return this.client;
  }

  private contentType(key: string): string {
    const ext = path.extname(key).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".pdf") return "application/pdf";
    return "application/octet-stream";
  }

  async uploadFile(localPath: string, key: string): Promise<{ storage_type: StorageType; key_or_path: string }> {
    const client = this.getClient();
    const body = fs.readFileSync(localPath);
    await client.send(new this.s3mod.PutObjectCommand({
      Bucket: R2_BUCKET, Key: key, Body: body, ContentType: this.contentType(key),
    }));
    return { storage_type: "r2", key_or_path: key };
  }

  async getFileUrl(key: string): Promise<string> {
    const client = this.getClient();
    const cmd = new this.s3mod.GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    return this.presignMod.getSignedUrl(client, cmd, { expiresIn: 3600 });
  }

  async getFileStream(key: string): Promise<NodeJS.ReadableStream> {
    const client = this.getClient();
    const out = await client.send(new this.s3mod.GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return out.Body as NodeJS.ReadableStream;
  }
}

let _backend: StorageBackend | null = null;
export function getStorageBackend(): StorageBackend {
  if (!_backend) {
    if (isR2Configured()) {
      _backend = new R2Backend();
      console.log("[r2-storage] backend=r2");
    } else {
      _backend = new LocalBackend();
      console.log("[r2-storage] backend=local");
    }
  }
  return _backend;
}
