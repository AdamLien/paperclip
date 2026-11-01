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
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { authorizationService } from "../services/authorization.js";

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

describePostgres("private AI partner visibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-private-agents-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "private-agents");
    vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-private-agents-");
    db = createDb(tempDb.connectionString);
    await import("../routes/agents.js");
  }, 90_000);

  afterEach(async () => {
    await db.delete(activityLog);
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

  async function addMember(companyId: string, userId: string, membershipRole: string) {
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole,
    });
  }

  async function seed(allowedUserIds: string[] = []) {
    const company = await db.insert(companies).values({
      name: "Private Partner Co",
      issuePrefix: `PP${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const insertAgent = (name: string, permissions: Record<string, unknown>) =>
      db.insert(agents).values({
        companyId: company.id,
        name,
        role: "engineer",
        status: "active",
        permissions,
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
      }).returning().then((rows) => rows[0]!);
    const finance = await insertAgent("Finance Lead", {
      authorizationPolicy: { agentVisibility: { mode: "private", allowedUserIds } },
    });
    const cashier = await insertAgent("Cashier", {});
    await addMember(company.id, "boss", "owner");
    await addMember(company.id, "staff", "operator");
    // Members carry their role's default grants. The operator's broad
    // tasks:assign grant must not reveal or reach a private partner.
    await db.insert(principalPermissionGrants).values([
      { companyId: company.id, principalType: "user", principalId: "boss", permissionKey: "agents:create", scope: null, grantedByUserId: null },
      { companyId: company.id, principalType: "user", principalId: "staff", permissionKey: "tasks:assign", scope: null, grantedByUserId: null },
    ]);
    return { company, finance, cashier };
  }

  async function listedNames(userId: string, companyId: string) {
    const app = await createApp(db, boardActor(userId, companyId));
    const list = await request(app).get(`/api/companies/${companyId}/agents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    return list.body.map((row: { name: string }) => row.name).sort();
  }

  it("hides a private partner from an employee in the list, org chart and detail", async () => {
    const { company, finance } = await seed();
    const app = await createApp(db, boardActor("staff", company.id));

    expect(await listedNames("staff", company.id)).toEqual(["Cashier"]);

    const org = await request(app).get(`/api/companies/${company.id}/org`);
    expect(org.status).toBe(200);
    expect(JSON.stringify(org.body)).not.toContain(finance.id);

    const detail = await request(app).get(`/api/agents/${finance.id}`);
    expect(detail.status).toBe(404);
    expect(JSON.stringify(detail.body)).not.toContain("Finance Lead");
  }, 30_000);

  it("denies an employee waking or assigning work to a private partner", async () => {
    const { company, finance } = await seed();
    const authz = authorizationService(db);
    const actor = { type: "board" as const, userId: "staff", source: "session" as const };

    await expect(authz.decide({
      actor,
      action: "agent:wake",
      resource: { type: "agent", companyId: company.id, agentId: finance.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_policy_restricted" });

    await expect(authz.decide({
      actor,
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: finance.id },
      scope: { assigneeAgentId: finance.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_policy_restricted" });
  }, 30_000);

  it("shows a private partner to listed members and to workspace owners", async () => {
    const { company, finance } = await seed(["staff"]);

    expect(await listedNames("staff", company.id)).toEqual(["Cashier", "Finance Lead"]);
    expect(await listedNames("boss", company.id)).toEqual(["Cashier", "Finance Lead"]);

    const app = await createApp(db, boardActor("staff", company.id));
    const detail = await request(app).get(`/api/agents/${finance.id}`);
    expect(detail.status).toBe(200);

    await expect(authorizationService(db).decide({
      actor: { type: "board", userId: "staff", source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, assigneeAgentId: finance.id },
      scope: { assigneeAgentId: finance.id },
    })).resolves.toMatchObject({ allowed: true });
  }, 30_000);

  it("lets an owner restrict a partner to named members and revoke them", async () => {
    const { company, cashier } = await seed();
    const owner = await createApp(db, boardActor("boss", company.id));

    const restricted = await request(owner)
      .put(`/api/agents/${cashier.id}/visibility`)
      .send({ mode: "private", allowedUserIds: ["staff"] });
    expect(restricted.status, JSON.stringify(restricted.body)).toBe(200);
    expect(restricted.body).toMatchObject({ mode: "private", allowedUserIds: ["staff"] });
    expect(await listedNames("staff", company.id)).toContain("Cashier");

    const revoked = await request(owner)
      .put(`/api/agents/${cashier.id}/visibility`)
      .send({ mode: "private", allowedUserIds: [] });
    expect(revoked.status).toBe(200);
    expect(await listedNames("staff", company.id)).not.toContain("Cashier");

    const reopened = await request(owner)
      .put(`/api/agents/${cashier.id}/visibility`)
      .send({ mode: "discoverable", allowedUserIds: [] });
    expect(reopened.status).toBe(200);
    expect(await listedNames("staff", company.id)).toContain("Cashier");
  }, 30_000);

  it("refuses visibility changes from employees and unknown members", async () => {
    const { company, cashier } = await seed();

    const employee = await createApp(db, boardActor("staff", company.id));
    const denied = await request(employee)
      .put(`/api/agents/${cashier.id}/visibility`)
      .send({ mode: "private", allowedUserIds: [] });
    expect(denied.status).toBe(403);

    const owner = await createApp(db, boardActor("boss", company.id));
    const stranger = await request(owner)
      .put(`/api/agents/${cashier.id}/visibility`)
      .send({ mode: "private", allowedUserIds: ["someone-else"] });
    expect(stranger.status).toBe(422);
    expect(await listedNames("staff", company.id)).toContain("Cashier");
  }, 30_000);

  it("reports the access list only to people who can manage it", async () => {
    const { company, finance } = await seed(["staff"]);

    const owner = await createApp(db, boardActor("boss", company.id));
    const managed = await request(owner).get(`/api/agents/${finance.id}/visibility`);
    expect(managed.status).toBe(200);
    expect(managed.body).toEqual({ mode: "private", allowedUserIds: ["staff"] });

    const employee = await createApp(db, boardActor("staff", company.id));
    const denied = await request(employee).get(`/api/agents/${finance.id}/visibility`);
    expect(denied.status).toBe(403);
    const detail = await request(employee).get(`/api/agents/${finance.id}`);
    expect(JSON.stringify(detail.body)).not.toContain("allowedUserIds");
  }, 30_000);
});
