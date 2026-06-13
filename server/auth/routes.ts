// R26.3: OAuth auth routes (Google + Meta) mounted at /api/auth.
// Session middleware + passport.initialize/session are set up in server/index.ts BEFORE this router.
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import passport, { isStrategyRegistered, META_SCOPES, upsertOAuthToken } from "./passport.js";
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

// ---- Meta (Facebook Login for Business) ----
// FBL4B rejects the `scope` param and requires `config_id` instead, so we drive the
// authorize/callback flow manually (passport-facebook can't emit config_id). The
// passport Facebook strategy registration in passport.ts is kept only for serialize/
// deserialize parity and is otherwise unused by this flow.
const META_CONFIG_ID = process.env.META_CONFIG_ID || "769372276202202";
const META_GRAPH_VERSION = "v18.0";

router.get("/meta", (req, res) => {
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return res.status(503).json({ error: "Meta OAuth not configured" });
  }
  const state = randomBytes(16).toString("hex");
  (req.session as any).metaOAuthState = state;

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    config_id: META_CONFIG_ID,
  });
  res.redirect(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`);
});

router.get("/meta/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;

  if (error) {
    console.error("[meta-oauth] callback error:", error, error_description);
    return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
  }

  const sessionState = (req.session as any)?.metaOAuthState;
  if (!state || state !== sessionState) {
    console.error("[meta-oauth] state mismatch");
    return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
  }
  delete (req.session as any).metaOAuthState;

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    console.error("[meta-oauth] missing Meta env at callback");
    return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
  }

  try {
    // 1. Exchange code for a short-lived access token.
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code: code as string,
    });
    const tokenRes = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${tokenParams.toString()}`,
    );
    const tokenData = (await tokenRes.json()) as any;
    if (!tokenData.access_token) {
      console.error("[meta-oauth] no access_token in response:", tokenData);
      return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
    }

    // 2. Exchange short-lived for a long-lived (~60-day) token.
    const longLivedParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenData.access_token,
    });
    const longLivedRes = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${longLivedParams.toString()}`,
    );
    const longLivedData = (await longLivedRes.json()) as any;
    const finalToken = longLivedData.access_token || tokenData.access_token;
    const expiresIn = Number(longLivedData.expires_in || tokenData.expires_in || 3600);

    // 3. Fetch the user profile.
    const profileRes = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/me?fields=id,name,email&access_token=${encodeURIComponent(finalToken)}`,
    );
    const profile = (await profileRes.json()) as any;
    if (!profile.id) {
      console.error("[meta-oauth] no profile id:", profile);
      return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
    }

    // 4. Upsert into oauth_tokens (same path the passport verify callback used).
    upsertOAuthToken({
      provider: "meta",
      accountEmail: profile.email || null,
      accountName: profile.name || null,
      accountId: profile.id,
      accessToken: finalToken,
      refreshToken: null,
      tokenExpiresAt: Date.now() + expiresIn * 1000,
      scopes: META_SCOPES.join(" "),
    });

    return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=connected`);
  } catch (err) {
    console.error("[meta-oauth] callback exception:", err);
    return res.redirect(`${FRONTEND_ADMIN}/integrations?meta=failed`);
  }
});

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
