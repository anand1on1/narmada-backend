// R26.3: OAuth auth routes (Google + Meta) mounted at /api/auth.
// Session middleware + passport.initialize/session are set up in server/index.ts BEFORE this router.
import { Router, type Request, type Response, type NextFunction } from "express";
import passport, { isStrategyRegistered, META_SCOPES } from "./passport.js";
import { rawSqlite as sqlite } from "../storage.js";
import { rehydrateSession, type TokenMap } from "../routes-v2.js";

const router = Router();

const FRONTEND_ADMIN = "https://narmadamobility.com/#/admin";

// Admin-token guard mirroring the legacy requireAdmin (x-admin-token header), validated against
// the persisted admin_sessions table via rehydrateSession. Only role "admin" passes.
function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers["x-admin-token"] as string) || "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const info = rehydrateSession(new Map() as TokenMap, token);
  if (!info) return res.status(401).json({ error: "Unauthorized" });
  if (info.role !== "admin") return res.status(403).json({ error: "Admin role required" });
  (req as any).user = info;
  next();
}

function connectionFor(provider: "google" | "meta") {
  try {
    const row = sqlite
      .prepare(
        `SELECT account_email, account_name FROM oauth_tokens
         WHERE provider = ? AND is_active = 1
         ORDER BY connected_at DESC LIMIT 1`,
      )
      .get(provider) as { account_email?: string; account_name?: string } | undefined;
    if (!row) return { connected: false, email: null, name: null };
    return { connected: true, email: row.account_email ?? null, name: row.account_name ?? null };
  } catch (e: any) {
    console.error(`[auth] connectionFor(${provider}) failed:`, e?.message || e);
    return { connected: false, email: null, name: null };
  }
}

// ---- Google ----
router.get("/google", (req, res, next) => {
  if (!isStrategyRegistered("google")) {
    return res.status(503).json({ error: "Google OAuth not configured" });
  }
  passport.authenticate("google", {
    scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"],
    accessType: "offline",
    prompt: "consent",
  })(req, res, next);
});

router.get(
  "/google/callback",
  (req, res, next) => {
    if (!isStrategyRegistered("google")) {
      return res.redirect(`${FRONTEND_ADMIN}?google=failed`);
    }
    passport.authenticate("google", {
      failureRedirect: `${FRONTEND_ADMIN}?google=failed`,
    })(req, res, next);
  },
  (_req, res) => res.redirect(`${FRONTEND_ADMIN}?google=connected`),
);

// ---- Meta (Facebook) ----
router.get("/meta", (req, res, next) => {
  if (!isStrategyRegistered("facebook")) {
    return res.status(503).json({ error: "Meta OAuth not configured" });
  }
  passport.authenticate("facebook", { scope: META_SCOPES })(req, res, next);
});

router.get(
  "/meta/callback",
  (req, res, next) => {
    if (!isStrategyRegistered("facebook")) {
      return res.redirect(`${FRONTEND_ADMIN}?meta=failed`);
    }
    passport.authenticate("facebook", {
      failureRedirect: `${FRONTEND_ADMIN}?meta=failed`,
    })(req, res, next);
  },
  (_req, res) => res.redirect(`${FRONTEND_ADMIN}?meta=connected`),
);

// ---- Status (no admin token; reflects active connections in DB) ----
router.get("/me", (_req: Request, res: Response) => {
  res.json({
    google: connectionFor("google"),
    meta: connectionFor("meta"),
  });
});

// ---- Disconnect (admin only) ----
function disconnect(provider: "google" | "meta", res: Response) {
  try {
    const info = sqlite
      .prepare(`UPDATE oauth_tokens SET is_active = 0 WHERE provider = ? AND is_active = 1`)
      .run(provider);
    return res.json({ ok: true, provider, disconnected: info.changes });
  } catch (e: any) {
    console.error(`[auth] disconnect(${provider}) failed:`, e?.message || e);
    return res.status(500).json({ error: "Disconnect failed" });
  }
}

router.post("/google/disconnect", requireAdminToken, (_req, res) => disconnect("google", res));
router.post("/meta/disconnect", requireAdminToken, (_req, res) => disconnect("meta", res));

// ---- Connections list (admin only) ----
router.get("/connections", requireAdminToken, (_req, res) => {
  try {
    const rows = sqlite
      .prepare(
        `SELECT id, provider, account_email, account_name, account_id, scopes,
                connected_at, last_used_at, is_active
         FROM oauth_tokens ORDER BY connected_at DESC`,
      )
      .all();
    res.json({ connections: rows });
  } catch (e: any) {
    console.error("[auth] connections list failed:", e?.message || e);
    res.status(500).json({ error: "Failed to list connections" });
  }
});

export default router;
