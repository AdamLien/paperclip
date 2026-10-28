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
  heartbeatRuns,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const RUN_COST_KEYS = ["costUsd", "cost_usd", "total_cost_usd", "cacheAdjustedCostUsd"];

async function createApp(db: Db, actor: Express.Request["actor"]) {
  const { agentRoutes } = await import("../routes/agents.js");
  const { activityRoutes } = await import("../routes/activity.js");
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use("/api", activityRoutes(db));
  app.use(errorHandler);
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

// Collects every cost amount a run payload exposes, wherever it sits.
function costValues(run: Record<string, any>) {
  const values: unknown[] = [run.resultTotalCostUsd, run.resultCostUsd, run.resultCostUsdCamel];
  for (const json of [run.usageJson, run.resultJson]) {
    if (json && typeof json === "object") values.push(...RUN_COST_KEYS.map((key) => json[key]));
  }
  return values.filter((value) => value !== undefined && value !== null);
}

describePostgres("run cost visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-run-costs-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "run-costs");
    vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-costs-");
    db = createDb(tempDb.connectionString);
    // Load the route modules once here so their cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/agents.js");
    await import("../routes/activity.js");
  }, 180_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(issues);
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

  async function seed() {
    const company = await db.insert(companies).values({
      name: "Run Cost Co",
      issuePrefix: `RC${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: "owner", status: "active", membershipRole: "owner" },
      { companyId: company.id, principalType: "user", principalId: "operator", status: "active", membershipRole: "operator" },
      { companyId: company.id, principalType: "user", principalId: "viewer", status: "active", membershipRole: "viewer" },
    ]);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Builder",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning().then((rows) => rows[0]!);
    const issue = await db.insert(issues).values({
      companyId: company.id,
      identifier: `${company.issuePrefix}-1`,
      title: "Build it",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agent.id,
    }).returning().then((rows) => rows[0]!);
    const run = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      invocationSource: "assignment",
      status: "succeeded",
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
      contextSnapshot: { issueId: issue.id },
      usageJson: { inputTokens: 120, outputTokens: 40, model: "gpt-x", costUsd: 0.42, cacheAdjustedCostUsd: 0.4 },
      resultJson: { summary: "Built it", total_cost_usd: 0.42, cost_usd: 0.42 },
    }).returning().then((rows) => rows[0]!);
    return { company, issue, run };
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

  async function readRuns(userId: string, seeded: Awaited<ReturnType<typeof seed>>) {
    const app = await createApp(db, boardActor(userId, seeded.company.id));
    const responses = {
      list: await request(app).get(`/api/companies/${seeded.company.id}/heartbeat-runs`),
      summaryList: await request(app).get(`/api/companies/${seeded.company.id}/heartbeat-runs?summary=true`),
      detail: await request(app).get(`/api/heartbeat-runs/${seeded.run.id}`),
      issueRuns: await request(app).get(`/api/issues/${seeded.issue.id}/runs`),
    };
    for (const [name, response] of Object.entries(responses)) {
      expect(response.status, `${name}: ${JSON.stringify(response.body)}`).toBe(200);
    }
    const pick = (body: any) => (Array.isArray(body) ? body : body.items ?? body.runs).find((run: any) => (run.id ?? run.runId) === seeded.run.id);
    return {
      list: pick(responses.list.body),
      summaryList: pick(responses.summaryList.body),
      detail: responses.detail.body,
      issueRuns: pick(responses.issueRuns.body),
    };
  }

  it("withholds per-run cost from members without costs:view on every run read", async () => {
    const seeded = await seed();
    for (const userId of ["operator", "viewer"]) {
      const runs = await readRuns(userId, seeded);
      for (const [name, run] of Object.entries(runs)) {
        expect(run, `${userId} ${name}`).toBeTruthy();
        expect(costValues(run), `${userId} ${name}`).toEqual([]);
      }
    }
  }, 60_000);

  it("keeps the rest of the run intact when cost is withheld", async () => {
    const seeded = await seed();
    const runs = await readRuns("viewer", seeded);
    expect(runs.detail.status).toBe("succeeded");
    expect(runs.detail.usageJson).toMatchObject({ inputTokens: 120, outputTokens: 40, model: "gpt-x" });
    expect(runs.detail.resultJson).toMatchObject({ summary: "Built it" });
    expect(runs.list.status).toBe("succeeded");
    expect(runs.issueRuns.status).toBe("succeeded");
  }, 60_000);

  it("returns per-run cost to owners and to members granted costs:view", async () => {
    const seeded = await seed();
    await grantCostsView(seeded.company.id, "operator");
    for (const userId of ["owner", "operator"]) {
      // The summary list never carries cost, so only the full reads are compared.
      const { summaryList: _summaryList, ...runs } = await readRuns(userId, seeded);
      for (const [name, run] of Object.entries(runs)) {
        expect(costValues(run).length, `${userId} ${name}`).toBeGreaterThan(0);
      }
      expect(runs.detail.usageJson.costUsd).toBe(0.42);
      expect(runs.detail.resultJson.total_cost_usd).toBe(0.42);
    }
  }, 60_000);
});
