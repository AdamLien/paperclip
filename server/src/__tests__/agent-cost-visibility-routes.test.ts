import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
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
  const { agentRoutes } = await import("../routes/agents.js");
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("agent cost visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-agent-costs-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "agent-costs");
    vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-costs-");
    db = createDb(tempDb.connectionString);
    // Load the route module once here so its cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/agents.js");
  }, 90_000);

  afterEach(async () => {
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

  async function seedMember(membershipRole: string) {
    const company = await db.insert(companies).values({
      name: "Agent Cost Co",
      issuePrefix: `AC${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Finance Partner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 20_000,
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      status: "active",
      membershipRole,
    });
    return { company, agent };
  }

  async function readAgentAmounts(companyId: string, agentId: string) {
    const app = await createApp(db, boardActor("member", companyId));
    const list = await request(app).get(`/api/companies/${companyId}/agents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const listed = list.body.find((row: { id: string }) => row.id === agentId);
    expect(listed).toBeDefined();
    const detail = await request(app).get(`/api/agents/${agentId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    return {
      list: { budget: listed.budgetMonthlyCents, spent: listed.spentMonthlyCents },
      detail: { budget: detail.body.budgetMonthlyCents, spent: detail.body.spentMonthlyCents },
    };
  }

  it.each(["owner", "admin"])("shows agent budget and spend to a company %s", async (role) => {
    const { company, agent } = await seedMember(role);
    expect(await readAgentAmounts(company.id, agent.id)).toEqual({
      list: { budget: 20_000, spent: 0 },
      detail: { budget: 20_000, spent: 0 },
    });
  }, 30_000);

  it.each(["operator", "viewer"])("withholds agent budget and spend from a %s", async (role) => {
    const { company, agent } = await seedMember(role);
    expect(await readAgentAmounts(company.id, agent.id)).toEqual({
      list: { budget: null, spent: null },
      detail: { budget: null, spent: null },
    });
  }, 30_000);

  it("shows agent budget and spend to an operator granted costs:view", async () => {
    const { company, agent } = await seedMember("operator");
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
    expect(await readAgentAmounts(company.id, agent.id)).toEqual({
      list: { budget: 20_000, spent: 0 },
      detail: { budget: 20_000, spent: 0 },
    });
  }, 30_000);
});
