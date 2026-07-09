// R27.32d — expand Process Payment access to the `data_team` role.
//
// The 9 /api/payments/* endpoints share a single guard built from
// requireRole("procurement", "finance", "data_team") (admin auto-passes). There is
// no HTTP harness in this repo, so — exactly as R27.32c does — we exercise the
// exported middleware factory directly with mocked token stores, over the SAME
// role list the production guard uses, plus assert the PAYMENT_ROLES whitelist that
// feeds hasPaymentAccess / the frontend gate now includes data_team.
import { describe, it, expect } from "vitest";
import {
  createAdminOrTeamAuth, createAdminOrTeamRole,
  type DualAuthDeps, type TokenMap, type TokenInfo,
} from "../../server/routes-v2";
import { hasPaymentAccess, PAYMENT_ROLES } from "../../server/routes-payments";

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

function makeDeps(opts: {
  adminUsers?: Record<string, TokenInfo>;
  teamSessions?: Record<string, number>;
  teamUsers?: Record<number, { username: string; role: string; name: string | null; active: boolean | null }>;
}): DualAuthDeps {
  const tokenMap: TokenMap = new Map(Object.entries(opts.adminUsers || {}));
  return {
    tokenMap,
    rehydrate: () => null,
    getSession: async (token: string) => {
      const userId = (opts.teamSessions || {})[token];
      return userId != null ? { userId } : undefined;
    },
    getUser: async (id: number) => (opts.teamUsers || {})[id],
  };
}

// The exact role list the production payments guard is constructed with
// (server/routes-payments.ts registerPaymentRoutes: requireRole("procurement","finance","data_team")).
const PAYMENTS_GUARD_ROLES = ["procurement", "finance", "data_team"] as const;

// The 9 /api/payments/* endpoints all share ONE guard, so a single guard verdict
// applies to every endpoint. We enumerate them to make the coverage explicit.
const PAYMENT_ENDPOINTS = [
  "GET /api/payments/pos",
  "POST /api/payments/aggregate",
  "POST /api/payments/generate",
  "GET /api/payments/batches",
  "GET /api/payments/batches/:vendor_id/slip",
  "POST /api/payments/batches/:vendor_id/mark-paid",
  "POST /api/payments/batches/:vendor_id/mark-skipped",
  "POST /api/payments/batches/bulk-mark-paid",
  "POST /api/payments/proof-upload",
];

describe("R27.32d — PAYMENT_ROLES whitelist now includes data_team", () => {
  it("hasPaymentAccess allows admin/procurement/finance/data_team; still rejects sales/dispatch", () => {
    expect(hasPaymentAccess("admin")).toBe(true);
    expect(hasPaymentAccess("procurement")).toBe(true);
    expect(hasPaymentAccess("finance")).toBe(true);
    expect(hasPaymentAccess("data_team")).toBe(true); // R27.32d — newly allowed
    expect(hasPaymentAccess("sales")).toBe(false);
    expect(hasPaymentAccess("dispatch_incharge")).toBe(false);
    expect(hasPaymentAccess(undefined)).toBe(false);
  });

  it("PAYMENT_ROLES exports data_team alongside the prior three", () => {
    expect([...PAYMENT_ROLES]).toEqual(["admin", "procurement", "finance", "data_team"]);
  });
});

describe("R27.32d — payments guard over the production role list", () => {
  const guardDeps = makeDeps({
    adminUsers: { "admin-tok": { username: "root", role: "admin", displayName: "Root" } },
    teamSessions: { "proc-tok": 1, "fin-tok": 2, "sales-tok": 3, "disp-tok": 4, "dt-tok": 5 },
    teamUsers: {
      1: { username: "proc1", role: "procurement", name: "Proc", active: true },
      2: { username: "fin1", role: "finance", name: "Fin", active: true },
      3: { username: "sales1", role: "sales", name: "Sales", active: true },
      4: { username: "disp1", role: "dispatch_incharge", name: "Disp", active: true },
      5: { username: "dt1", role: "data_team", name: "Data Team One", active: true },
    },
  });
  // Rebuild the guard exactly as production does for the 9 shared endpoints.
  const guard = createAdminOrTeamRole(createAdminOrTeamAuth(guardDeps))(...PAYMENTS_GUARD_ROLES);

  async function verdict(headers: Record<string, string>) {
    const { req, res, next, nextRan } = makeReqRes(headers);
    await guard(req, res, next);
    return { passed: nextRan(), status: res.statusCode };
  }

  it("(a) a data_team team token passes the shared guard for every /api/payments/* endpoint", async () => {
    for (const ep of PAYMENT_ENDPOINTS) {
      const v = await verdict({ "x-team-token": "dt-tok" });
      expect(v.passed, `${ep} should allow data_team`).toBe(true);
      expect(v.status, `${ep} should not 403 for data_team`).toBe(200);
    }
  });

  it("(b) a sales team token is still rejected with 403 (regression guard)", async () => {
    const v = await verdict({ "x-team-token": "sales-tok" });
    expect(v.passed).toBe(false);
    expect(v.status).toBe(403);
  });

  it("(b2) a dispatch_incharge team token is still rejected with 403", async () => {
    const v = await verdict({ "x-team-token": "disp-tok" });
    expect(v.passed).toBe(false);
    expect(v.status).toBe(403);
  });

  it("(c) an admin token still passes (short-circuit, unaffected)", async () => {
    const v = await verdict({ "x-admin-token": "admin-tok" });
    expect(v.passed).toBe(true);
    expect(v.status).toBe(200);
  });

  it("(d) finance and procurement team tokens still pass", async () => {
    const fin = await verdict({ "x-team-token": "fin-tok" });
    expect(fin.passed).toBe(true);
    const proc = await verdict({ "x-team-token": "proc-tok" });
    expect(proc.passed).toBe(true);
  });

  it("(e) a data_team token via Authorization: Bearer also passes", async () => {
    const v = await verdict({ authorization: "Bearer dt-tok" });
    expect(v.passed).toBe(true);
    expect(v.status).toBe(200);
  });
});
