import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  budgetPolicies,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import type { PermissionKey } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { costRoutes } = await import("../routes/costs.js");
  const { companyRoutes } = await import("../routes/companies.js");
  const { agentRoutes } = await import("../routes/agents.js");
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes(db));
  app.use("/api", costRoutes(db));
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("budget management permission", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-budget-manage-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "budget-manage");
    vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-budget-manage-");
    db = createDb(tempDb.connectionString);
    // Load the route modules once here so their cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/costs.js");
    await import("../routes/companies.js");
    await import("../routes/agents.js");
  }, 180_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(budgetPolicies);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    vi.unstubAllEnvs();
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function seed(role: string, grants: PermissionKey[] = []) {
    const company = await db.insert(companies).values({
      name: "Budget Co",
      issuePrefix: `BM${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Budgeted Partner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      status: "active",
      membershipRole: role,
    });
    if (grants.length > 0) {
      await db.insert(principalPermissionGrants).values(grants.map((permissionKey) => ({
        companyId: company.id,
        principalType: "user",
        principalId: "member",
        permissionKey,
        scope: null,
        grantedByUserId: null,
      })));
    }
    const app = await createApp(db, boardActor("member", company.id));
    return { company, agent, app };
  }

  async function budgetWriteStatuses(role: string, grants: PermissionKey[] = []) {
    const { company, agent, app } = await seed(role, grants);
    return {
      companyBudget: (await request(app).patch(`/api/companies/${company.id}/budgets`).send({ budgetMonthlyCents: 5_000 })).status,
      agentBudget: (await request(app).patch(`/api/agents/${agent.id}/budgets`).send({ budgetMonthlyCents: 1_000 })).status,
      policy: (await request(app).post(`/api/companies/${company.id}/budgets/policies`).send({
        scopeType: "agent",
        scopeId: agent.id,
        amount: 2_000,
      })).status,
      companySettingsBudget: (await request(app).patch(`/api/companies/${company.id}`).send({ budgetMonthlyCents: 9_000 })).status,
    };
  }

  it.each(["owner", "admin"])("lets a company %s change budgets by role default", async (role) => {
    expect(await budgetWriteStatuses(role)).toEqual({
      companyBudget: 200,
      agentBudget: 200,
      policy: 200,
      companySettingsBudget: 200,
    });
  }, 60_000);

  it("denies budget changes to an operator", async () => {
    expect(await budgetWriteStatuses("operator")).toEqual({
      companyBudget: 403,
      agentBudget: 403,
      policy: 403,
      companySettingsBudget: 403,
    });
  }, 60_000);

  it("denies budget changes to an operator who can only view costs", async () => {
    expect(await budgetWriteStatuses("operator", ["costs:view"])).toEqual({
      companyBudget: 403,
      agentBudget: 403,
      policy: 403,
      companySettingsBudget: 403,
    });
  }, 60_000);

  it("lets an operator granted budgets:manage change budgets", async () => {
    expect(await budgetWriteStatuses("operator", ["budgets:manage"])).toEqual({
      companyBudget: 200,
      agentBudget: 200,
      policy: 200,
      companySettingsBudget: 200,
    });
  }, 60_000);

  it("denies resolving a budget incident without budgets:manage", async () => {
    const { company, app } = await seed("operator");
    const response = await request(app)
      .post(`/api/companies/${company.id}/budget-incidents/${randomUUID()}/resolve`)
      .send({ action: "keep_paused" });
    expect(response.status, JSON.stringify(response.body)).toBe(403);
  }, 60_000);

  it("requires budgets:manage to change an agent budget through agent settings", async () => {
    const { agent, app } = await seed("operator", ["agents:configure"]);
    const rename = await request(app).patch(`/api/agents/${agent.id}`).send({ name: "Renamed Partner" });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);
    const budget = await request(app).patch(`/api/agents/${agent.id}`).send({ budgetMonthlyCents: 3_000 });
    expect(budget.status, JSON.stringify(budget.body)).toBe(403);
  }, 60_000);

  it("keeps non-budget company settings available to an operator", async () => {
    const { company, app } = await seed("operator");
    const response = await request(app).patch(`/api/companies/${company.id}`).send({ description: "Updated" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }, 60_000);
});
