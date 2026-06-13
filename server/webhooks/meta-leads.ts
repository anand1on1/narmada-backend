// R26.3: Meta (Facebook) Lead Ads webhook, mounted at /api/webhooks/meta.
//   GET  /leads -> verification handshake (hub.challenge echo)
//   POST /leads -> leadgen events; X-Hub-Signature-256 verified with META_APP_SECRET (HMAC-SHA256),
//                  raw payload stored in meta_leads_inbox. Lead processing arrives in R26.4.
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { rawSqlite as sqlite } from "../storage.js";

const router = Router();

// ---- Verification handshake ----
router.get("/leads", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    console.log("[meta-webhook] verification handshake OK");
    return res.status(200).send(String(challenge ?? ""));
  }
  console.log("[meta-webhook] verification handshake FAILED");
  return res.sendStatus(403);
});

// ---- Signature verification (X-Hub-Signature-256: sha256=<hex>) ----
function verifySignature(req: Request): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("[meta-webhook] META_APP_SECRET not set — rejecting");
    return false;
  }
  const header = (req.headers["x-hub-signature-256"] as string) || "";
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  // express.json (server/index.ts) captures the raw bytes on req.rawBody via its verify hook.
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) {
    console.error("[meta-webhook] rawBody missing — cannot verify signature");
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

router.post("/leads", (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    return res.sendStatus(403);
  }
  try {
    sqlite
      .prepare(
        `INSERT INTO meta_leads_inbox (raw_payload, received_at, processed)
         VALUES (?, ?, 0)`,
      )
      .run(JSON.stringify(req.body ?? {}), Date.now());
    console.log("[meta-webhook] leadgen payload stored");
  } catch (e: any) {
    console.error("[meta-webhook] failed to store payload:", e?.message || e);
    // Still 200 so Meta does not retry-storm; the failure is logged for follow-up.
  }
  // Meta expects a 200 to acknowledge receipt.
  return res.sendStatus(200);
});

export default router;
