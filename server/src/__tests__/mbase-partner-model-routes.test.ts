import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createMbasePartnerModelService } from "../services/mbase-partner-model.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const TOKEN = "ocx-client-token-routes";
const SONNET = "anthropic/claude-sonnet-5-5";

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("AI partners on mBase models", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let home = "";
  let tokenFile = "";

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "paperclip-mbase-partners-"));
    tokenFile = path.join(home, "ocx-token");
    await writeFile(tokenFile, TOKEN);
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "mbase-partners");
    vi.stubEnv("PAPERCLIP_IN_WORKTREE", "false");
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-mbase-partners-");
    db = createDb(tempDb.connectionString);
    await import("../routes/agents.js");
  }, 90_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    vi.unstubAllEnvs();
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function createApp(actor: Express.Request["actor"], configured = true) {
    const { agentRoutes } = await import("../routes/agents.js");
    const { errorHandler } = await import("../middleware/index.js");
    const mbasePartnerModels = createMbasePartnerModelService(configured
      ? {
        endpoint: "http://ocx.internal:8080/v1",
        tokenFile,
        fetcher: vi.fn(async () => new Response(JSON.stringify({ data: [{ id: SONNET }, { id: "gpt-6.1-sol" }] }), { status: 200 })) as unknown as typeof fetch,
      }
      : { endpoint: "", tokenFile: "" });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", agentRoutes(db, { mbasePartnerModels }));
    app.use(errorHandler);
    return app;
  }

  async function seed() {
    const company = await db.insert(companies).values({
      name: "mBase Partner Co",
      issuePrefix: `MB${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const insertAgent = (name: string, adapterType: string, extra: Partial<typeof agents.$inferInsert> = {}) =>
      db.insert(agents).values({
        companyId: company.id,
        name,
        role: "engineer",
        status: "active",
        adapterType,
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        ...extra,
      }).returning().then((rows) => rows[0]!);
    const writer = await insertAgent("Writer", "claude_local");
    const probe = await insertAgent("Probe", "process");
    const reviewer = await insertAgent("Reviewer", "claude_local", { permissions: { trustPreset: "low_trust_review" } });
    const connected = await insertAgent("Connected", "claude_local", {
      runtimeConfig: { aiConnection: { provider: "anthropic", method: "oauth", mode: "responsible_user" } },
    });
    for (const [userId, membershipRole] of [["boss", "owner"], ["staff", "operator"]] as const) {
      await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole });
    }
    await db.insert(principalPermissionGrants).values([
      { companyId: company.id, principalType: "user", principalId: "boss", permissionKey: "agents:create", scope: null, grantedByUserId: null },
      { companyId: company.id, principalType: "user", principalId: "boss", permissionKey: "agents:configure", scope: null, grantedByUserId: null },
      { companyId: company.id, principalType: "user", principalId: "staff", permissionKey: "tasks:assign", scope: null, grantedByUserId: null },
    ]);
    return { company, writer, probe, reviewer, connected };
  }

  async function storedRuntimeConfig(agentId: string) {
    const row = await db.select({ runtimeConfig: agents.runtimeConfig }).from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0]!);
    return row.runtimeConfig as Record<string, unknown>;
  }

  it("lets a manager switch a Claude partner to an mBase model without storing or showing the token", async () => {
    const { company, writer } = await seed();
    const app = await createApp(boardActor("boss", company.id));

    const before = await request(app).get(`/api/agents/${writer.id}/model-source`);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body).toEqual({
      source: "default", model: null, supported: true,
      mbase: { configured: true, models: [SONNET], unavailableReason: null },
    });

    const saved = await request(app).put(`/api/agents/${writer.id}/model-source`).send({ source: "mbase", model: SONNET });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ source: "mbase", model: SONNET });
    expect(await storedRuntimeConfig(writer.id)).toEqual({ mbase: { model: SONNET } });

    const detail = await request(app).get(`/api/agents/${writer.id}`);
    expect(detail.status).toBe(200);
    for (const body of [before.body, saved.body, detail.body]) expect(JSON.stringify(body)).not.toContain(TOKEN);

    const activity = await db.select().from(activityLog).where(eq(activityLog.action, "agent.model_source_updated"));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.details).toEqual({ source: "mbase", model: SONNET });

    const back = await request(app).put(`/api/agents/${writer.id}/model-source`).send({ source: "default" });
    expect(back.status).toBe(200);
    expect(await storedRuntimeConfig(writer.id)).toEqual({});
  }, 30_000);

  it("denies members and agents from reading or changing the model source", async () => {
    const { company, writer } = await seed();
    const staff = await createApp(boardActor("staff", company.id));
    expect((await request(staff).get(`/api/agents/${writer.id}/model-source`)).status).toBe(403);
    expect((await request(staff).put(`/api/agents/${writer.id}/model-source`).send({ source: "mbase", model: SONNET })).status).toBe(403);

    const agentActor = await createApp({ type: "agent", agentId: writer.id, companyId: company.id, source: "agent_key" } as Express.Request["actor"]);
    expect((await request(agentActor).put(`/api/agents/${writer.id}/model-source`).send({ source: "mbase", model: SONNET })).status).toBe(403);
    expect(await storedRuntimeConfig(writer.id)).toEqual({});
  }, 30_000);

  it("refuses models mBase does not offer, unsupported or low-trust partners, AI-connection partners and a missing mBase", async () => {
    const { company, writer, probe, reviewer, connected } = await seed();
    const app = await createApp(boardActor("boss", company.id));
    const put = (id: string, body: object) => request(app).put(`/api/agents/${id}/model-source`).send(body);

    expect((await put(writer.id, { source: "mbase", model: "gpt-6.1-sol" })).status).toBe(422);
    expect((await put(writer.id, { source: "mbase", model: "anthropic/claude-opus-1" })).status).toBe(422);
    expect((await put(probe.id, { source: "mbase", model: SONNET })).status).toBe(422);
    expect((await put(reviewer.id, { source: "mbase", model: SONNET })).status).toBe(422);
    expect((await put(connected.id, { source: "mbase", model: SONNET })).status).toBe(422);
    expect((await put(writer.id, { source: "mbase", model: SONNET, endpoint: "https://evil.example" })).status).toBe(400);

    const unconfigured = await createApp(boardActor("boss", company.id), false);
    const state = await request(unconfigured).get(`/api/agents/${writer.id}/model-source`);
    expect(state.body.mbase).toMatchObject({ configured: false, models: [] });
    expect((await request(unconfigured).put(`/api/agents/${writer.id}/model-source`).send({ source: "mbase", model: SONNET })).status).toBe(422);

    for (const agent of [writer, probe, reviewer]) expect(await storedRuntimeConfig(agent.id)).toEqual({});
  }, 30_000);

  it("keeps mBase out of the general agent create and edit paths", async () => {
    const { company, writer } = await seed();
    const app = await createApp(boardActor("boss", company.id));
    await request(app).put(`/api/agents/${writer.id}/model-source`).send({ source: "mbase", model: SONNET }).expect(200);

    const smuggle = await request(app).patch(`/api/agents/${writer.id}`).send({ runtimeConfig: { mbase: { model: "anthropic/claude-haiku-4-5" } } });
    expect(smuggle.status).toBe(422);

    const unrelated = await request(app).patch(`/api/agents/${writer.id}`).send({ runtimeConfig: { debug: {} } });
    expect(unrelated.status, JSON.stringify(unrelated.body)).toBe(200);
    expect(await storedRuntimeConfig(writer.id)).toMatchObject({ mbase: { model: SONNET } });

    const created = await request(app).post(`/api/companies/${company.id}/agents`).send({
      name: "Sneaky", adapterType: "claude_local", runtimeConfig: { mbase: { model: SONNET } },
    });
    expect(created.status).toBe(422);
  }, 30_000);
});
