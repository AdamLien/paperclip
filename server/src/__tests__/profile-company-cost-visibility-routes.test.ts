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
  const { companyRoutes } = await import("../routes/companies.js");
  const { userProfileRoutes } = await import("../routes/user-profiles.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes(db));
  app.use("/api", userProfileRoutes(db));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
  });
  return app;
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("profile and company cost visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-profile-company-costs-");
    db = createDb(tempDb.connectionString);
    // Load the route modules once here so their cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/companies.js");
    await import("../routes/user-profiles.js");
  }, 60_000);

  afterEach(async () => {
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seed(memberRole: string) {
    const company = await db.insert(companies).values({
      name: "Profile Cost Co",
      issuePrefix: `PC${randomUUID().slice(0, 6).toUpperCase()}`,
      budgetMonthlyCents: 80_000,
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: "member", status: "active", membershipRole: memberRole },
      { companyId: company.id, principalType: "user", principalId: "colleague", status: "active", membershipRole: "operator" },
    ]);
    return company;
  }

  async function readAmounts(companyId: string) {
    const app = await createApp(db, boardActor("member", companyId));
    const profile = await request(app).get(`/api/companies/${companyId}/users/colleague/profile`);
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    const detail = await request(app).get(`/api/companies/${companyId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const list = await request(app).get("/api/companies");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const listed = list.body.find((row: { id: string }) => row.id === companyId);
    expect(listed).toBeDefined();
    expect(profile.body.stats.length).toBeGreaterThan(0);
    expect(profile.body.daily.length).toBeGreaterThan(0);
    return {
      profileStatsCost: [...new Set(profile.body.stats.map((entry: { costCents: unknown }) => entry.costCents))],
      profileDailyCost: [...new Set(profile.body.daily.map((entry: { costCents: unknown }) => entry.costCents))],
      detail: { budget: detail.body.budgetMonthlyCents, spent: detail.body.spentMonthlyCents },
      list: { budget: listed.budgetMonthlyCents, spent: listed.spentMonthlyCents },
    };
  }

  it.each(["owner", "admin"])("shows profile usage amounts and company budget to a %s", async (role) => {
    const company = await seed(role);
    expect(await readAmounts(company.id)).toEqual({
      profileStatsCost: [0],
      profileDailyCost: [0],
      detail: { budget: 80_000, spent: 0 },
      list: { budget: 80_000, spent: 0 },
    });
  }, 30_000);

  it.each(["operator", "viewer"])("withholds profile usage amounts and company budget from a %s", async (role) => {
    const company = await seed(role);
    expect(await readAmounts(company.id)).toEqual({
      profileStatsCost: [null],
      profileDailyCost: [null],
      detail: { budget: null, spent: null },
      list: { budget: null, spent: null },
    });
  }, 30_000);

  it("shows the amounts to an operator granted costs:view", async () => {
    const company = await seed("operator");
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: "member",
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
    expect(await readAmounts(company.id)).toEqual({
      profileStatsCost: [0],
      profileDailyCost: [0],
      detail: { budget: 80_000, spent: 0 },
      list: { budget: 80_000, spent: 0 },
    });
  }, 30_000);
});
