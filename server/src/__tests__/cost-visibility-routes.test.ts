import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const COMPANY_COST_READ_PATHS = [
  "costs/summary",
  "costs/by-agent",
  "costs/by-agent-model",
  "costs/by-provider",
  "costs/by-biller",
  "costs/by-project",
  "costs/finance-summary",
  "costs/finance-by-biller",
  "costs/finance-by-kind",
  "costs/finance-events",
  "costs/window-spend",
  "budgets/overview",
];

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { costRoutes } = await import("../routes/costs.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", costRoutes(db));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

function boardActor(userId: string, companyIds: string[], isInstanceAdmin = false): Express.Request["actor"] {
  return { type: "board", userId, companyIds, source: "session", isInstanceAdmin };
}

describePostgres("company cost visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-cost-visibility-");
    db = createDb(tempDb.connectionString);
    // Load the route module once here so its cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/costs.js");
  }, 60_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seedCompany(name: string) {
    const company = await db.insert(companies).values({
      name,
      issuePrefix: `CV${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const issue = await db.insert(issues).values({
      companyId: company.id,
      identifier: `${company.issuePrefix}-1`,
      title: "Cost target",
      status: "todo",
      priority: "medium",
    }).returning().then((rows) => rows[0]!);
    return { company, issue };
  }

  async function addMember(companyId: string, userId: string, membershipRole: string) {
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole,
    });
  }

  async function grantCostsView(companyId: string, userId: string) {
    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
  }

  async function statusesFor(actor: Express.Request["actor"], companyId: string, issueId: string) {
    const app = await createApp(db, actor);
    const statuses: Record<string, number> = {};
    for (const path of COMPANY_COST_READ_PATHS) {
      statuses[path] = (await request(app).get(`/api/companies/${companyId}/${path}`)).status;
    }
    statuses["issue cost-summary"] = (await request(app).get(`/api/issues/${issueId}/cost-summary`)).status;
    return statuses;
  }

  function expectAll(statuses: Record<string, number>, expected: number) {
    for (const [path, status] of Object.entries(statuses)) {
      expect(status, path).toBe(expected);
    }
  }

  it.each(["owner", "admin"])("lets a company %s read company costs by role default", async (role) => {
    const { company, issue } = await seedCompany("Cost Co");
    await addMember(company.id, "manager", role);
    expectAll(await statusesFor(boardActor("manager", [company.id]), company.id, issue.id), 200);
  }, 30_000);

  it.each(["operator", "viewer"])("denies company costs to a %s without costs:view", async (role) => {
    const { company, issue } = await seedCompany("Cost Co");
    await addMember(company.id, "employee", role);
    const actor = boardActor("employee", [company.id]);
    expectAll(await statusesFor(actor, company.id, issue.id), 403);

    const quota = await request(await createApp(db, actor)).get(`/api/companies/${company.id}/costs/quota-windows`);
    expect(quota.status).toBe(403);
  }, 30_000);

  it("lets an operator with an explicit costs:view grant read costs until the grant is removed", async () => {
    const { company, issue } = await seedCompany("Cost Co");
    await addMember(company.id, "accountant", "operator");
    await grantCostsView(company.id, "accountant");
    const actor = boardActor("accountant", [company.id]);
    expectAll(await statusesFor(actor, company.id, issue.id), 200);

    await db.delete(principalPermissionGrants);
    expectAll(await statusesFor(actor, company.id, issue.id), 403);
  }, 30_000);

  it("does not carry a costs:view grant into another company", async () => {
    const home = await seedCompany("Home Co");
    const other = await seedCompany("Other Co");
    await addMember(home.company.id, "accountant", "operator");
    await grantCostsView(home.company.id, "accountant");
    await addMember(other.company.id, "accountant", "operator");
    expectAll(
      await statusesFor(boardActor("accountant", [home.company.id, other.company.id]), other.company.id, other.issue.id),
      403,
    );
  }, 30_000);

  it("lets an instance admin read company costs", async () => {
    const { company, issue } = await seedCompany("Cost Co");
    expectAll(await statusesFor(boardActor("root", [company.id], true), company.id, issue.id), 200);
  }, 30_000);

  it("keeps same-company agent access to company costs unchanged", async () => {
    const { company } = await seedCompany("Cost Co");
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Finance Agent",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning().then((rows) => rows[0]!);
    const response = await request(await createApp(db, {
      type: "agent", agentId: agent.id, companyId: company.id, runId: null, source: "agent_jwt",
    })).get(`/api/companies/${company.id}/costs/summary`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }, 30_000);
});
