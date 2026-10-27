import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { dashboardRoutes } = await import("../routes/dashboard.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", dashboardRoutes(db));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("dashboard cost visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-dashboard-costs-");
    db = createDb(tempDb.connectionString);
    // Load the route module once here so its cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/dashboard.js");
  }, 60_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seedMember(membershipRole: string) {
    const company = await db.insert(companies).values({
      name: "Dashboard Co",
      issuePrefix: `DC${randomUUID().slice(0, 6).toUpperCase()}`,
      budgetMonthlyCents: 50_000,
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      status: "active",
      membershipRole,
    });
    return company;
  }

  async function dashboardFor(companyId: string) {
    const response = await request(await createApp(db, boardActor("member", companyId)))
      .get(`/api/companies/${companyId}/dashboard`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  }

  it.each(["owner", "admin"])("includes month costs for a company %s", async (role) => {
    const company = await seedMember(role);
    const body = await dashboardFor(company.id);
    expect(body.costs).toEqual({
      monthSpendCents: 0,
      monthBudgetCents: 50_000,
      monthUtilizationPercent: 0,
    });
  }, 30_000);

  it.each(["operator", "viewer"])("returns null costs but the rest of the dashboard to a %s", async (role) => {
    const company = await seedMember(role);
    const body = await dashboardFor(company.id);
    expect(body.costs).toBeNull();
    expect(body.companyId).toBe(company.id);
    expect(body.agents).toBeDefined();
    expect(body.tasks).toBeDefined();
    expect(body.budgets).toBeDefined();
  }, 30_000);

  it("includes month costs for an operator granted costs:view", async () => {
    const company = await seedMember("operator");
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
    const body = await dashboardFor(company.id);
    expect(body.costs?.monthBudgetCents).toBe(50_000);
  }, 30_000);
});
