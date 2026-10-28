import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
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

describePostgres("agent cost reads on behalf of a user", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-on-behalf-costs-");
    db = createDb(tempDb.connectionString);
    // Load the route module once here so its cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/costs.js");
  }, 180_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seed(userRole: string) {
    const company = await db.insert(companies).values({
      name: "Partner Co",
      issuePrefix: `PO${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Finance Partner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning().then((rows) => rows[0]!);
    await db.insert(authUsers).values({
      id: "employee",
      name: "Employee",
      email: "employee@paperclip.test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: "employee",
      status: "active",
      membershipRole: userRole,
    });
    return { company, agent };
  }

  function agentActor(agentId: string, companyId: string, onBehalfOfUserId: string | null, userRole = "operator") {
    return {
      type: "agent",
      agentId,
      companyId,
      runId: null,
      source: "agent_jwt",
      ...(onBehalfOfUserId
        ? {
            onBehalfOfUserId,
            onBehalfOfMemberships: [{ companyId, membershipRole: userRole, status: "active" }],
          }
        : {}),
    } as Express.Request["actor"];
  }

  async function costSummary(actor: Express.Request["actor"], companyId: string) {
    return request(await createApp(db, actor)).get(`/api/companies/${companyId}/costs/summary`);
  }

  it("denies an agent working for an employee who cannot view costs, with a readable reason", async () => {
    const { company, agent } = await seed("operator");
    const response = await costSummary(agentActor(agent.id, company.id, "employee"), company.id);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("The person this agent is working for does not have permission to view company costs.");
    expect(JSON.stringify(response.body)).not.toContain("employee");
  }, 60_000);

  it("lets an agent working for an employee granted costs:view read costs", async () => {
    const { company, agent } = await seed("operator");
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: "employee",
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
    const response = await costSummary(agentActor(agent.id, company.id, "employee"), company.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }, 60_000);

  it("lets an agent working for an owner read costs", async () => {
    const { company, agent } = await seed("owner");
    const response = await costSummary(agentActor(agent.id, company.id, "employee", "owner"), company.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }, 60_000);

  it("keeps cost reads unchanged for an agent with no responsible user", async () => {
    const { company, agent } = await seed("operator");
    const response = await costSummary(agentActor(agent.id, company.id, null), company.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }, 60_000);
});
