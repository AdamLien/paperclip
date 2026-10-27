import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { accessRoutes } = await import("../routes/access.js");
  const { costRoutes } = await import("../routes/costs.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", accessRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }));
  app.use("/api", costRoutes(db));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("cost permission grants", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-cost-permission-grants-");
    db = createDb(tempDb.connectionString);
    // Load the route modules once here so their cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/access.js");
    await import("../routes/costs.js");
  }, 180_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seed() {
    const company = await db.insert(companies).values({
      name: "Grant Co",
      issuePrefix: `GC${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const [, accountant] = await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: "owner", status: "active", membershipRole: "owner" },
      { companyId: company.id, principalType: "user", principalId: "accountant", status: "active", membershipRole: "operator" },
    ]).returning();
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: "owner",
      permissionKey: "users:manage_permissions",
      scope: null,
      grantedByUserId: null,
    });
    return { company, accountant: accountant! };
  }

  async function setAccountantGrants(companyId: string, memberId: string, actorUserId: string, permissionKeys: string[]) {
    return request(await createApp(db, boardActor(actorUserId, companyId)))
      .patch(`/api/companies/${companyId}/members/${memberId}/permissions`)
      .send({ grants: permissionKeys.map((permissionKey) => ({ permissionKey })) });
  }

  async function accountantCostStatus(companyId: string) {
    return (await request(await createApp(db, boardActor("accountant", companyId)))
      .get(`/api/companies/${companyId}/costs/summary`)).status;
  }

  async function costFlagsFor(userId: string, companyId: string) {
    const response = await request(await createApp(db, boardActor(userId, companyId))).get("/api/cli-auth/me");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const membership = response.body.memberships.find((item: { companyId: string }) => item.companyId === companyId);
    return { canViewCosts: membership?.canViewCosts, canManageBudgets: membership?.canManageBudgets };
  }

  it("lets an owner grant and revoke costs:view, effective immediately and audited", async () => {
    const { company, accountant } = await seed();
    expect(await accountantCostStatus(company.id)).toBe(403);

    const granted = await setAccountantGrants(company.id, accountant.id, "owner", ["costs:view"]);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(await accountantCostStatus(company.id)).toBe(200);

    const revoked = await setAccountantGrants(company.id, accountant.id, "owner", []);
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(await accountantCostStatus(company.id)).toBe(403);

    const audit = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, company.id),
      eq(activityLog.action, "company_member.permissions_updated"),
    ));
    expect(audit).toHaveLength(2);
  }, 60_000);

  it("does not let a member without users:manage_permissions grant cost permissions", async () => {
    const { company, accountant } = await seed();
    const response = await setAccountantGrants(company.id, accountant.id, "accountant", ["costs:view", "budgets:manage"]);
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(await accountantCostStatus(company.id)).toBe(403);
  }, 60_000);

  it("reports each member's own cost permissions in the board access snapshot", async () => {
    const { company, accountant } = await seed();
    expect(await costFlagsFor("owner", company.id)).toEqual({ canViewCosts: true, canManageBudgets: true });
    expect(await costFlagsFor("accountant", company.id)).toEqual({ canViewCosts: false, canManageBudgets: false });

    await setAccountantGrants(company.id, accountant.id, "owner", ["costs:view"]);
    expect(await costFlagsFor("accountant", company.id)).toEqual({ canViewCosts: true, canManageBudgets: false });
  }, 60_000);
});
