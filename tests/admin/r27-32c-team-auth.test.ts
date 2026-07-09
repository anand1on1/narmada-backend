// R27.32c — Dual-auth guard for /api/payments/*.
//
// The payments endpoints must accept BOTH an admin token (x-admin-token) and a Data Team
// token (x-team-token / Bearer), while still gating on role. There is no HTTP harness in
// this repo, so we exercise the exported middleware factories directly with mocked token
// stores (no Express boot, no supertest). The resolver populates (req as any).user with
// the same shape requireAuth sets, so downstream resolveActor works regardless of token.
import { describe, it, expect } from "vitest";
import {
  createAdminOrTeamAuth, createAdminOrTeamRole,
  type DualAuthDeps, type TokenMap, type TokenInfo,
} from "../../server/routes-v2";
import { hasPaymentAccess } from "../../server/routes-payments";

// Minimal Express req/res doubles capturing status + whether next() ran.
function makeReqRes(headers: Record<string, string>) {
  const req: any = { headers };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, nextRan: () => nextCalled };
}

// Build a dual-auth resolver over mocked stores.
function makeDeps(opts: {
  adminUsers?: Record<string, TokenInfo>;
  teamSessions?: Record<string, number>;                       // token -> userId
  teamUsers?: Record<number, { username: string; role: string; name: string | null; active: boolean | null }>;
}): DualAuthDeps {
  const tokenMap: TokenMap = new Map(Object.entries(opts.adminUsers || {}));
  return {
    tokenMap,
    rehydrate: () => null, // DB rehydration not needed for these unit tests
    getSession: async (token: string) => {
      const userId = (opts.teamSessions || {})[token];
      return userId != null ? { userId } : undefined;
    },
    getUser: async (id: number) => (opts.teamUsers || {})[id],
  };
}

describe("R27.32c — hasPaymentAccess role whitelist", () => {
  it("allows admin / procurement / finance and rejects others", () => {
    expect(hasPaymentAccess("admin")).toBe(true);
    expect(hasPaymentAccess("procurement")).toBe(true);
    expect(hasPaymentAccess("finance")).toBe(true);
    expect(hasPaymentAccess("sales")).toBe(false);
    expect(hasPaymentAccess("dispatch_incharge")).toBe(false);
    expect(hasPaymentAccess(undefined)).toBe(false);
  });
});

describe("R27.32c — requireAdminOrTeamAuth (dual-auth resolver)", () => {
  it("passes with a valid admin token and sets req.user from tokenMap", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({
      adminUsers: { "admin-tok": { username: "root", role: "admin", displayName: "Primary Administrator" } },
    }));
    const { req, res, next, nextRan } = makeReqRes({ "x-admin-token": "admin-tok" });
    await auth(req, res, next);
    expect(nextRan()).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ username: "root", role: "admin", displayName: "Primary Administrator" });
  });

  it("passes with a valid team token and normalizes req.user shape (name -> displayName)", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({
      teamSessions: { "team-tok": 7 },
      teamUsers: { 7: { username: "proc1", role: "procurement", name: "Procure One", active: true } },
    }));
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "team-tok" });
    await auth(req, res, next);
    expect(nextRan()).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ username: "proc1", role: "procurement", displayName: "Procure One" });
    expect(req.teamUser.username).toBe("proc1"); // raw team row still attached
  });

  it("accepts the team token via Authorization: Bearer as well", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({
      teamSessions: { "team-tok": 7 },
      teamUsers: { 7: { username: "fin1", role: "finance", name: null, active: true } },
    }));
    const { req, res, next, nextRan } = makeReqRes({ authorization: "Bearer team-tok" });
    await auth(req, res, next);
    expect(nextRan()).toBe(true);
    expect(req.user.username).toBe("fin1");
    expect(req.user.displayName).toBe("fin1"); // falls back to username when name is null
  });

  it("401s when neither token is present", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({}));
    const { req, res, next, nextRan } = makeReqRes({});
    await auth(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("401s when the team token is invalid / session missing", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({ teamSessions: {}, teamUsers: {} }));
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "bogus" });
    await auth(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("401s when the team user is inactive", async () => {
    const auth = createAdminOrTeamAuth(makeDeps({
      teamSessions: { "team-tok": 9 },
      teamUsers: { 9: { username: "x", role: "procurement", name: "X", active: false } },
    }));
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "team-tok" });
    await auth(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe("R27.32c — requireAdminOrTeamRole (role gate over dual-auth)", () => {
  const guardDeps = makeDeps({
    adminUsers: { "admin-tok": { username: "root", role: "admin", displayName: "Root" } },
    teamSessions: { "proc-tok": 1, "fin-tok": 2, "sales-tok": 3, "disp-tok": 4 },
    teamUsers: {
      1: { username: "proc1", role: "procurement", name: "Proc", active: true },
      2: { username: "fin1", role: "finance", name: "Fin", active: true },
      3: { username: "sales1", role: "sales", name: "Sales", active: true },
      4: { username: "disp1", role: "dispatch_incharge", name: "Disp", active: true },
    },
  });
  const guard = createAdminOrTeamRole(createAdminOrTeamAuth(guardDeps))("procurement", "finance");

  it("admin token always passes regardless of allowlist", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-admin-token": "admin-tok" });
    await guard(req, res, next);
    expect(nextRan()).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("procurement team token passes", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "proc-tok" });
    await guard(req, res, next);
    expect(nextRan()).toBe(true);
  });

  it("finance team token passes", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "fin-tok" });
    await guard(req, res, next);
    expect(nextRan()).toBe(true);
  });

  it("sales team token is rejected with 403", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "sales-tok" });
    await guard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("dispatch team token is rejected with 403", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "disp-tok" });
    await guard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("no token is rejected with 401 (before role check)", async () => {
    const { req, res, next, nextRan } = makeReqRes({});
    await guard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
