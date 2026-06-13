// R26.3: Passport strategies for Google + Meta (Facebook) OAuth.
// Verify callbacks upsert into the additive oauth_tokens table (SQLite — see migrations R26.3).
// Strategies are registered only when their env credentials are present, so the server still
// boots in environments where OAuth is not configured (the routes then return a 503).
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { rawSqlite as sqlite } from "../storage";

export interface OAuthUser {
  provider: "google" | "meta";
  account_id: string;
}

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];

export const META_SCOPES = ["email", "public_profile"];

// Upsert a provider connection. Reconnects (same provider+account_id) refresh tokens/profile
// without creating duplicate rows. Tokens are stored as-is; meta_pages is JSON-stringified.
export function upsertOAuthToken(row: {
  provider: "google" | "meta";
  accountEmail?: string | null;
  accountName?: string | null;
  accountId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
  scopes?: string | null;
  metaPages?: unknown;
}): void {
  const now = Date.now();
  const metaPagesJson =
    row.metaPages == null ? null : JSON.stringify(row.metaPages);
  try {
    sqlite
      .prepare(
        `INSERT INTO oauth_tokens
           (provider, account_email, account_name, account_id, access_token,
            refresh_token, token_expires_at, scopes, meta_pages, connected_at,
            last_used_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(provider, account_id) DO UPDATE SET
           account_email   = excluded.account_email,
           account_name    = excluded.account_name,
           access_token    = excluded.access_token,
           -- keep an existing refresh_token if the provider didn't return a new one
           refresh_token   = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
           token_expires_at= excluded.token_expires_at,
           scopes          = excluded.scopes,
           meta_pages      = COALESCE(excluded.meta_pages, oauth_tokens.meta_pages),
           last_used_at    = excluded.last_used_at,
           is_active       = 1`,
      )
      .run(
        row.provider,
        row.accountEmail ?? null,
        row.accountName ?? null,
        row.accountId,
        row.accessToken,
        row.refreshToken ?? null,
        row.tokenExpiresAt ?? null,
        row.scopes ?? null,
        metaPagesJson,
        now,
        now,
      );
  } catch (e: any) {
    console.error("[auth] oauth_tokens upsert failed:", e?.message || e);
    throw e;
  }
}

let configured = false;

export function configurePassport(): void {
  if (configured) return;
  configured = true;

  // serialize/deserialize: store only {provider, account_id} in the session as JSON.
  passport.serializeUser((user: any, done) => {
    const u = user as OAuthUser;
    done(null, JSON.stringify({ provider: u.provider, account_id: u.account_id }));
  });

  passport.deserializeUser((raw: string, done) => {
    try {
      const parsed = JSON.parse(raw) as OAuthUser;
      done(null, parsed);
    } catch (e) {
      done(e as Error);
    }
  });

  // ---- Google ----
  const googleId = process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (googleId && googleSecret && googleRedirect) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleId,
          clientSecret: googleSecret,
          callbackURL: googleRedirect,
        },
        (accessToken: string, refreshToken: string, params: any, profile: any, done: (err: any, user?: any) => void) => {
          try {
            const accountId = profile.id;
            const email =
              profile.emails && profile.emails[0]
                ? profile.emails[0].value
                : null;
            const name = profile.displayName || null;
            const expiresAt =
              params && params.expires_in
                ? Date.now() + Number(params.expires_in) * 1000
                : null;
            upsertOAuthToken({
              provider: "google",
              accountEmail: email,
              accountName: name,
              accountId,
              accessToken,
              refreshToken: refreshToken || null,
              tokenExpiresAt: expiresAt,
              scopes: GOOGLE_SCOPES.join(" "),
            });
            const user: OAuthUser = { provider: "google", account_id: accountId };
            done(null, user);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
    console.log("[auth] Google strategy registered");
  } else {
    console.log("[auth] Google strategy NOT registered (missing env)");
  }

  // ---- Meta (Facebook) ----
  const metaId = process.env.META_APP_ID;
  const metaSecret = process.env.META_APP_SECRET;
  const metaRedirect = process.env.META_OAUTH_REDIRECT_URI;
  if (metaId && metaSecret && metaRedirect) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: metaId,
          clientSecret: metaSecret,
          callbackURL: metaRedirect,
          profileFields: ["id", "displayName", "emails"],
        },
        (accessToken, _refreshToken, profile: any, done) => {
          try {
            const accountId = profile.id;
            const email =
              profile.emails && profile.emails[0]
                ? profile.emails[0].value
                : null;
            const name = profile.displayName || null;
            // Meta returns a short-lived user token here; long-lived exchange happens in R26.4.
            upsertOAuthToken({
              provider: "meta",
              accountEmail: email,
              accountName: name,
              accountId,
              accessToken,
              refreshToken: null,
              tokenExpiresAt: null,
              scopes: META_SCOPES.join(" "),
            });
            const user: OAuthUser = { provider: "meta", account_id: accountId };
            done(null, user);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
    console.log("[auth] Meta strategy registered");
  } else {
    console.log("[auth] Meta strategy NOT registered (missing env)");
  }
}

export function isStrategyRegistered(name: "google" | "facebook"): boolean {
  return Boolean((passport as any)._strategies && (passport as any)._strategies[name]);
}

export default passport;
