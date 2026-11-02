import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  principalPermissionGrants,
  toolApplications,
  toolConnectionInstalls,
  toolConnections,
  toolProfiles,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS } from "../services/agent-permissions.js";
import { agentJoinGrantsFromDefaults } from "../services/invite-grants.js";
import { toolAccessRoutes } from "../routes/tool-access.js";
import { errorHandler } from "../middleware/index.js";

/**
 * An AI partner uses the tools it is given; it does not decide which tool
 * connections or profiles exist. Connection and profile management stay with
 * people unless an operator grants them explicitly.
 */
const TOOL_MANAGEMENT_KEYS = ["tools:manage_connections", "tools:manage_profiles"] as const;

describe("new standard agent default grants", () => {
  it("do not include tool connection or profile management", () => {
    for (const key of TOOL_MANAGEMENT_KEYS) {
      expect(NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS).not.toContain(key);
    }
  });

  it("are not re-added by invitation approval", () => {
    const keys = agentJoinGrantsFromDefaults(null, "agent-1").map((grant) => grant.permissionKey);
    for (const key of TOOL_MANAGEMENT_KEYS) {
      expect(keys).not.toContain(key);
    }
  });

  it("keep an explicit invitation grant for tool connection management", () => {
    expect(agentJoinGrantsFromDefaults({
      agent: { grants: [{ permissionKey: "tools:manage_connections", scope: null }] },
    }, "agent-1")).toContainEqual({ permissionKey: "tools:manage_connections", scope: null });
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("agent actors and tool management routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-tool-mgmt-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(toolConnectionInstalls);
    await db.delete(toolProfiles);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(principalPermissionGrants);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /**
   * Existing agents created before the default changed still hold the
   * management grants, so the routes must refuse them on their own.
   */
  async function seedAgentHoldingManagementGrants() {
    const company = await db.insert(companies).values({
      name: `Agent tool mgmt ${randomUUID()}`,
      issuePrefix: `AT${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: `Partner ${randomUUID()}`,
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    }).returning().then((rows) => rows[0]!);
    await db.insert(principalPermissionGrants).values(
      [...new Set([...NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS, ...TOOL_MANAGEMENT_KEYS])].map((permissionKey) => ({
        companyId: company.id,
        principalType: "agent" as const,
        principalId: agent.id,
        permissionKey,
        scope: null,
      })),
    );
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `agent-mgmt-app-${randomUUID()}`,
      name: "Agent management app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Agent management connection",
      uid: `agent-mgmt-connection-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const profile = await db.insert(toolProfiles).values({
      companyId: company.id,
      profileKey: `agent-mgmt-profile-${randomUUID().slice(0, 8)}`,
      name: "Original profile",
    }).returning().then((rows) => rows[0]!);
    return { company, agent, connection, profile };
  }

  function agentApp(agentId: string, companyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "agent", agentId, companyId, runId: null, source: "agent_jwt" };
      next();
    });
    app.use("/api", toolAccessRoutes(db));
    app.use(errorHandler);
    return app;
  }

  it("refuses to create a tool connection", async () => {
    const { company, agent } = await seedAgentHoldingManagementGrants();
    const res = await request(agentApp(agent.id, company.id))
      .post(`/api/companies/${company.id}/tools/apps/connect`)
      .send({ link: "https://203.0.113.10/mcp", name: "Agent-made connection" });
    expect(res.status).toBe(403);
    const rows = await db.select().from(toolConnections).where(eq(toolConnections.companyId, company.id));
    expect(rows.map((row) => row.name)).toEqual(["Agent management connection"]);
  });

  it("refuses to create or change a tool profile", async () => {
    const { company, agent, profile } = await seedAgentHoldingManagementGrants();
    const app = agentApp(agent.id, company.id);
    const created = await request(app)
      .post(`/api/companies/${company.id}/tools/profiles`)
      .send({ profileKey: "agent-made", name: "Agent-made profile" });
    expect(created.status).toBe(403);
    const updated = await request(app)
      .patch(`/api/tool-profiles/${profile.id}`)
      .send({ name: "Changed by agent" });
    expect(updated.status).toBe(403);
    const rows = await db.select().from(toolProfiles).where(eq(toolProfiles.companyId, company.id));
    expect(rows.map((row) => row.name)).toEqual(["Original profile"]);
  });

  it("refuses to install a connection on an agent", async () => {
    const { company, agent, connection } = await seedAgentHoldingManagementGrants();
    const res = await request(agentApp(agent.id, company.id))
      .put(`/api/tool-connections/${connection.id}/installs`)
      .send({ installs: [{ targetType: "agent", targetId: agent.id }] });
    expect(res.status).toBe(403);
    const installs = await db.select().from(toolConnectionInstalls)
      .where(eq(toolConnectionInstalls.connectionId, connection.id));
    expect(installs).toEqual([]);
  });
});
