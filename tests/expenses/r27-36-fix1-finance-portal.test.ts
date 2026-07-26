// R27.36-FIX-1 — the Finance Portal (/#/finance/*) must reach the R27.36 expense
// endpoints.
//
// The portal logs in at POST /api/finance/login, which issues a *data_team* session
// token — the same store the team panel uses. role-auth.tsx sends it as BOTH
// x-finance-token and x-team-token. These tests pin both header spellings so the
// portal keeps working even if roleFetch stops double-sending, and pin that widening
// the header list did not widen *access*.
//
// No HTTP harness exists in this repo, so the exported middleware factories are
// exercised directly with mocked stores, exactly as r27-32c-team-auth.test.ts does.
import { describe, it, expect } from "vitest";
import {
  createAdminOrTeamAuth, createAdminOrTeamRole,
  type DualAuthDeps, type TokenMap, type TokenInfo,
} from "../../server/routes-v2";
import { hasExpenseAccess, EXPENSE_ROLES, APPROVER_USERNAME } from "../../server/routes-expenses";

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

// One shared world: an admin token plus one data_team user per role.
const deps: DualAuthDeps = (() => {
  const tokenMap: TokenMap = new Map<string, TokenInfo>([
    ["admin-tok", { username: "narmadamobility123", role: "admin", displayName: "Owner" }],
  ]);
  const sessions: Record<string, number> = {
    "fin-portal-tok": 2, "team-fin-tok": 2, "sales-tok": 3,
    "proc-tok": 4, "store-tok": 5, "inactive-fin-tok": 6,
  };
  const users: Record<number, { username: string; role: string; name: string | null; active: boolean | null }> = {
    2: { username: "fin_meera", role: "finance", name: "Meera", active: true },
    3: { username: "sales1", role: "sales", name: "Sales One", active: true },
    4: { username: "proc1", role: "procurement", name: "Proc One", active: true },
    5: { username: "store1", role: "store_incharge", name: "Store One", active: true },
    6: { username: "fin_old", role: "finance", name: "Ex Finance", active: false },
  };
  return {
    tokenMap,
    rehydrate: () => null,
    getSession: async (t: string) => (sessions[t] != null ? { userId: sessions[t] } : undefined),
    getUser: async (id: number) => users[id],
  };
})();

// The exact guard registerExpenseRoutes uses for /api/expenses/*.
const expenseGuard = createAdminOrTeamRole(createAdminOrTeamAuth(deps))("finance");

describe("R27.36-FIX-1 — Finance Portal token reaches the R27.36 expense endpoints", () => {
  it("accepts the portal token sent as x-finance-token alone", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-finance-token": "fin-portal-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ username: "fin_meera", role: "finance", displayName: "Meera" });
  });

  it("accepts the portal token sent as both headers, which is what roleFetch actually does", async () => {
    const { req, res, next, nextRan } = makeReqRes({
      "x-finance-token": "fin-portal-tok",
      "x-team-token": "fin-portal-tok",
    });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(true);
    expect(req.user.username).toBe("fin_meera");
  });

  it("still accepts a team-panel finance token (x-team-token) — R27.36 behaviour preserved", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "team-fin-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(true);
    expect(req.user.role).toBe("finance");
  });

  it("still accepts an admin token — R27.36 behaviour preserved", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-admin-token": "admin-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(true);
    expect(req.user.username).toBe(APPROVER_USERNAME);
  });

  it("resolveActor can still identify the acting user from a portal token", async () => {
    // The approval gate keys off username; it must survive the portal header path.
    const { req, res, next } = makeReqRes({ "x-finance-token": "fin-portal-tok" });
    await expenseGuard(req, res, next);
    expect(req.user.username).toBe("fin_meera");
    expect(req.teamUser.username).toBe("fin_meera"); // raw data_team row still attached
  });
});

describe("R27.36-FIX-1 — widening the header list did not widen access", () => {
  it("rejects a sales portal token on its own header with 403", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-sales-token": "sales-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects procurement — allowed on payments, not on expenses", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-team-token": "proc-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a store portal token on its own header with 403", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-store-token": "store-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a deactivated finance user with 401 even on the portal header", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-finance-token": "inactive-fin-tok" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown portal token with 401", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-finance-token": "bogus" });
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects no token at all with 401", async () => {
    const { req, res, next, nextRan } = makeReqRes({});
    await expenseGuard(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe("R27.36-FIX-1 — approval gate is unchanged by the portal path", () => {
  // The three approval endpoints use requireRole() with NO roles = admin-only,
  // then the handler additionally requires username === narmadamobility123.
  const adminOnly = createAdminOrTeamRole(createAdminOrTeamAuth(deps))();

  it("a finance portal user cannot pass the admin-only approval guard", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-finance-token": "fin-portal-tok" });
    await adminOnly(req, res, next);
    expect(nextRan()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("the owner admin token still passes the approval guard", async () => {
    const { req, res, next, nextRan } = makeReqRes({ "x-admin-token": "admin-tok" });
    await adminOnly(req, res, next);
    expect(nextRan()).toBe(true);
    expect(req.user.username).toBe(APPROVER_USERNAME);
  });

  it("APPROVER_USERNAME is still narmadamobility123", () => {
    expect(APPROVER_USERNAME).toBe("narmadamobility123");
  });
});

describe("R27.36-FIX-1 — EXPENSE_ROLES unchanged", () => {
  it("is still admin + finance only", () => {
    expect([...EXPENSE_ROLES]).toEqual(["admin", "finance"]);
    expect(hasExpenseAccess("finance")).toBe(true);
    expect(hasExpenseAccess("admin")).toBe(true);
    expect(hasExpenseAccess("procurement")).toBe(false);
    expect(hasExpenseAccess("sales")).toBe(false);
    expect(hasExpenseAccess("data_team")).toBe(false);
  });
});
