import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, issues, companies, companyMemberships, createDb, instanceSettings, pluginConfig, plugins, toolApplications, toolConnections, toolConnectionInstalls, toolProfiles, toolMcpGateways, toolProfileBindings, resourceLifecycleEvents, type Db } from "@paperclipai/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { pluginAgentRuntimeState } from "../services/plugin-agent-runtime-state.js";
import { pluginLifecycleInbox } from "../services/plugin-lifecycle-inbox.js";
import { registerPluginLifecycleDelivery } from "../services/plugin-lifecycle-delivery.js";
import { createDeliveryWorkCoordinator } from "../services/delivery-work-coordinator.js";
import { toolAccessService } from "../services/tool-access.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { connectionIntentService } from "../services/connection-intents.js";
import { aiConnectionService } from "../services/ai-connections.js";

vi.mock("../services/subscription-refresh.js", () => ({ refreshSubscriptionConnection: vi.fn().mockResolvedValue(undefined) }));

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

describeDatabase("connection assignment synchronization", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let agentId: string;
  let peerId: string;
  let pluginId: string;
  let applicationId: string;
  let connectionId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("paperclip-runtime-assignments-"); db = createDb(database.connectionString); }, 90_000);
  afterAll(async () => { await database?.cleanup(); });
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID(); peerId = randomUUID(); pluginId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Connector runtime fixture", issuePrefix: `C${companyId.slice(0, 6)}` });
    await db.insert(plugins).values({ id: pluginId, pluginKey: pluginId, packageName: "runtime-fixture", version: "1.0.0", status: "ready", manifestJson: { resourceLifecycle: ["agent_runtime"], capabilities: ["events.subscribe", "agents.lifecycle.manage"] } as never });
    await db.insert(agents).values([agentId, peerId].map(id => ({ id, companyId, name: id, adapterType: "paperclip_runner", lifecycleRequiredPluginIds: [pluginId] })));
    const [application] = await db.insert(toolApplications).values({ companyId, name: "Fixture MCP", type: "mcp_http" }).returning(); applicationId = application.id;
    const [connection] = await db.insert(toolConnections).values({ companyId, applicationId, name: "Fixture connection", uid: randomUUID(), transport: "mcp_remote", authKind: "none", enabled: true, status: "active" }).returning(); connectionId = connection.id;
  });
  const events = () => db.select().from(resourceLifecycleEvents).where(and(eq(resourceLifecycleEvents.companyId, companyId), eq(resourceLifecycleEvents.resourceType, "agent_runtime"))).orderBy(resourceLifecycleEvents.id);

  it("serializes named gateways targeting different agents without foreign-key lock upgrades", async () => {
    const [profile] = await db.insert(toolProfiles).values({ companyId, profileKey: "gateway-fixture", name: "Gateway fixture" }).returning();
    const [lower, higher] = [agentId, peerId].sort();
    let locked!: () => void; let release!: () => void;
    const held = new Promise<void>(resolve => { locked = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.select().from(agents).where(eq(agents.id, lower)).for("no key update");
      locked(); await resume;
    });
    await held;
    const pids: number[] = [];
    const saves = [higher, lower].map((target, index) => db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '8s'`);
      const [row] = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      pids.push(Number(row.pid));
      return createToolGatewayService(tx as unknown as Db).createNamedGateway({ companyId, body: { name: `Gateway ${index}`, profileId: profile.id, agentId: target } });
    }));
    const completed = Promise.allSettled(saves);
    try {
      await vi.waitFor(async () => {
        expect(pids).toHaveLength(2);
        const rows = await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE pid IN (${pids[0]}, ${pids[1]}) AND wait_event_type = 'Lock'`);
        expect(rows).toHaveLength(2);
      }, { timeout: 5000 });
    } finally { release(); await blocker; }
    const results = await completed;
    for (const result of results) if (result.status === "rejected") throw result.reason;
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.select().from(toolMcpGateways).where(eq(toolMcpGateways.companyId, companyId))).toHaveLength(2);
    expect(await db.select().from(toolProfileBindings).where(eq(toolProfileBindings.companyId, companyId))).toHaveLength(2);
  }, 15000);
  it("captures profile assignment and revocation without exposing another agent's assignments", async () => {
    const [profile] = await db.insert(toolProfiles).values({ companyId, profileKey: "fixture", name: "Fixture profile" }).returning();
    const [binding] = await db.insert(toolProfileBindings).values({ companyId, profileId: profile.id, targetType: "agent", targetId: agentId }).returning();
    const [install] = await db.insert(toolConnectionInstalls).values({ companyId, connectionId, targetType: "agent", targetId: agentId }).returning();
    const owner = await pluginAgentRuntimeState(db, pluginId, companyId, agentId);
    expect(owner!.connectionAssignments).toMatchObject({ connections: [expect.objectContaining({ id: connectionId })], profileIds: [profile.id] });
    expect((await pluginAgentRuntimeState(db, pluginId, companyId, peerId))!.connectionAssignments).toMatchObject({ connections: [], profileIds: [] });
    const before = (await events()).length;
    await db.delete(toolProfileBindings).where(eq(toolProfileBindings.id, binding.id));
    await db.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.id, install.id));
    expect(await events()).toHaveLength(before + 4);
    expect((await pluginAgentRuntimeState(db, pluginId, companyId, agentId))!.connectionAssignments).toMatchObject({ connections: [], profileIds: [] });
  });
  it("keeps connector changes and their events atomic and company-scoped", async () => {
    const before = await events();
    await expect(db.transaction(async tx => {
      await tx.update(toolConnections).set({ enabled: false }).where(eq(toolConnections.id, connectionId));
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await events()).toEqual(before);
    await db.execute(sql`ALTER TABLE resource_lifecycle_events ADD CONSTRAINT connector_fixture_failure CHECK (resource_type <> 'agent_runtime') NOT VALID`);
    try { await expect(db.update(toolConnections).set({ enabled: false }).where(eq(toolConnections.id, connectionId))).rejects.toThrow(); }
    finally { await db.execute(sql`ALTER TABLE resource_lifecycle_events DROP CONSTRAINT connector_fixture_failure`); }
    expect((await db.select().from(toolConnections).where(eq(toolConnections.id, connectionId)))[0].enabled).toBe(true);
    const other = randomUUID();
    await db.insert(companies).values({ id: other, name: "Other company", issuePrefix: `X${other.slice(0, 6)}` });
    await db.insert(toolApplications).values({ companyId: other, name: "Other MCP", type: "mcp_http" });
    expect(await events()).toEqual(before);
  });
  it("fails closed when standing assignments exceed the bounded snapshot", async () => {
    const added = await db.insert(toolConnections).values(Array.from({ length: 513 }, (_, index) => ({ companyId, applicationId, name: `bounded-${index}`, uid: randomUUID(), transport: "mcp_remote" as const, authKind: "none" as const }))).returning({ id: toolConnections.id });
    await db.insert(toolConnectionInstalls).values(added.map(connection => ({ companyId, connectionId: connection.id, targetType: "agent" as const, targetId: agentId })));
    await expect(pluginAgentRuntimeState(db, pluginId, companyId, agentId)).rejects.toMatchObject({ status: 422 });
  });
  it("invalidates connector feature switches and returns their effective standing state", async () => {
    await pluginAgentRuntimeState(db, pluginId, companyId, agentId);
    const before = (await events()).length;
    await db.update(instanceSettings).set({ experimental: { enableChatConnectors: true } });
    expect(await events()).toHaveLength(before + 2);
    expect((await pluginAgentRuntimeState(db, pluginId, companyId, agentId))!.connectionAssignments.features).toEqual({ publicMcp: false, chatConnectors: true });
  });
  it("refreshes acknowledged runtime state after managed feature overlays change across restarts", async () => {
    await pluginAgentRuntimeState(db, pluginId, companyId, agentId);
    await db.insert(pluginConfig).values({ pluginId, companyId, configJson: {} });
    const inbox = pluginLifecycleInbox(db, pluginId);
    for (const event of await events()) await inbox.acknowledge(companyId, String(event.id));
    for (const enabled of [true, false]) {
      vi.stubEnv("PAPERCLIP_MANAGED_CONFIG", JSON.stringify({ v: 1, mode: "cloud", catalogVersion: "2026.720.0", features: { enablePublicMcp: enabled, enableChatConnectors: enabled }, plugins: { autoInstall: [] } }));
      const before = (await events()).length;
      const snapshots: Array<{ publicMcp: boolean; chatConnectors: boolean }> = [];
      const call = vi.fn(async (_plugin, _method, event) => {
        const state = await pluginAgentRuntimeState(db, pluginId, companyId, event.resourceId);
        snapshots.push(state!.connectionAssignments.features);
        return { eventId: event.id, status: "acknowledged" };
      });
      const coordinator = createDeliveryWorkCoordinator({ owner: db, canRun: () => true, onError: error => { throw error; } });
      const delivery = registerPluginLifecycleDelivery(coordinator, db, { call, isRunning: () => true, onConfigApplied: () => () => {} } as never, new EventEmitter() as never);
      try {
        await delivery.ready;
        await vi.waitFor(() => expect(snapshots).toEqual(Array(2).fill({ publicMcp: enabled, chatConnectors: enabled })), { timeout: 5000 });
        await vi.waitFor(async () => expect(await inbox.list(companyId, 100, undefined, ["agent_runtime"])).toEqual([]), { timeout: 5000 });
        expect(await events()).toHaveLength(before + 2);
      } finally { delivery.dispose(); await coordinator.stop(); }
    }
  });

  it("versions every returned connection field and skips unrelated bookkeeping", async () => {
    await db.insert(toolConnectionInstalls).values({ companyId, connectionId, targetType: "company", targetId: companyId });
    const initial = await pluginAgentRuntimeState(db, pluginId, companyId, agentId);
    const before = await events();
    await db.update(toolConnections).set({ healthCheckedAt: new Date(), lastError: "fixture", config: { fixture: true }, updatedAt: new Date() }).where(eq(toolConnections.id, connectionId));
    expect(await events()).toEqual(before);
    await db.transaction(async tx => {
      await tx.update(toolConnections).set({ name: "Renamed", enabled: false }).where(eq(toolConnections.id, connectionId));
      await tx.update(toolConnections).set({ status: "disabled", transport: "local_stdio" }).where(eq(toolConnections.id, connectionId));
    });
    expect(await events()).toHaveLength(before.length + 2);
    const current = await pluginAgentRuntimeState(db, pluginId, companyId, agentId);
    expect(current!.revision).not.toBe(initial!.revision);
    expect(current!.connectionAssignments.connections).toEqual([{ id: connectionId, name: "Renamed", transport: "local_stdio", enabled: false, status: "disabled" }]);
    const [profile] = await db.insert(toolProfiles).values({ companyId, profileKey: "status-fixture", name: "Status fixture" }).returning();
    await db.insert(toolProfileBindings).values({ companyId, profileId: profile.id, targetType: "company", targetId: companyId });
    expect((await pluginAgentRuntimeState(db, pluginId, companyId, agentId))!.connectionAssignments.profileIds).toContain(profile.id);
    const active = await events();
    await db.update(toolProfiles).set({ name: "Cosmetic rename" }).where(eq(toolProfiles.id, profile.id));
    expect(await events()).toEqual(active);
    await db.update(toolProfiles).set({ status: "archived" }).where(eq(toolProfiles.id, profile.id));
    expect(await events()).toHaveLength(active.length + 2);
    expect((await pluginAgentRuntimeState(db, pluginId, companyId, agentId))!.connectionAssignments.profileIds).not.toContain(profile.id);
  });

  it("rejects excessive active profile assignments", async () => {
    const profiles = await db.insert(toolProfiles).values(Array.from({ length: 129 }, (_, index) => ({ companyId, profileKey: `bound-${index}`, name: `Bound ${index}` }))).returning();
    await db.insert(toolProfileBindings).values(profiles.map(profile => ({ companyId, profileId: profile.id, targetType: "company" as const, targetId: companyId })));
    await expect(pluginAgentRuntimeState(db, pluginId, companyId, agentId)).rejects.toMatchObject({ status: 422 });
  });

  it.each(["bind", "unbind", "reassign"] as const)("orders profile %s with setup finalization before assignment fanout", async change => {
    const [profile] = await db.insert(toolProfiles).values({ companyId, profileKey: `app:${connectionId}`, name: "Managed profile" }).returning();
    await db.insert(toolProfileBindings).values({ companyId, profileId: profile.id, targetType: "company", targetId: companyId });
    if (change === "unbind") await db.insert(toolProfileBindings).values({ companyId, profileId: profile.id, targetType: "agent", targetId: agentId });
    const [source] = change === "reassign" ? await db.insert(toolProfiles).values({ companyId, profileKey: "source", name: "Source profile" }).returning() : [];
    if (source) await db.insert(toolProfileBindings).values({ companyId, profileId: source.id, targetType: "agent", targetId: agentId });
    let locked!: () => void;
    let release!: () => void;
    const held = new Promise<void>(resolve => { locked = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.select().from(agents).where(eq(agents.id, [agentId, peerId].sort()[0])).for("no key update");
      locked(); await resume;
    });
    await held;
    const pids: number[] = [];
    const run = (work: (service: ReturnType<typeof toolAccessService>) => Promise<unknown>) => db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '8s'`);
      const [backend] = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      pids.push(Number(backend.pid));
      return work(toolAccessService(tx as unknown as Db));
    });
    const waitForLock = (index: number) => vi.waitFor(async () => {
      expect(pids.length).toBeGreaterThan(index);
      const [activity] = await db.execute(sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pids[index]}`);
      expect(activity.wait_event_type).toBe("Lock");
    }, { timeout: 5000 });
    const mutation = run(writer => change === "bind"
      ? writer.bindProfile(profile.id, { targetType: "agent", targetId: agentId })
      : change === "unbind" ? writer.unbindProfile(profile.id, { targetType: "agent", targetId: agentId })
        : writer.deleteProfile(source!.id, { reassignToProfileId: profile.id }));
    const mutationResult = Promise.allSettled([mutation]);
    let finishResult: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await waitForLock(0);
      finishResult = Promise.allSettled([run(writer => writer.finishGalleryAppConnection(companyId, connectionId, { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: "all_agents" }))]);
      await waitForLock(1);
    } finally { release(); await blocker; }
    for (const result of [...await mutationResult, ...await finishResult!]) if (result.status === "rejected") throw result.reason;
    expect((await db.select().from(toolProfiles).where(eq(toolProfiles.id, profile.id)))[0].status).toBe("active");
    if (source) expect(await db.select().from(toolProfiles).where(eq(toolProfiles.id, source.id))).toEqual([]);
  }, 15000);

  it("orders AI adoption with settings on another connection before locking the requesting agent", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "paperclip-adoption-fixture-")));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "adoption-fixture");
    const [lower, higher] = [agentId, peerId].sort();
    const userId = `adoption-${randomUUID()}`;
    const issueId = randomUUID();
    const runId = randomUUID();
    let release!: () => void;
    try {
      await db.update(toolConnections).set({ config: { url: "https://mcp.example.test/mcp" } }).where(eq(toolConnections.id, connectionId));
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" });
      await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } }).where(eq(agents.id, higher));
      await db.insert(issues).values({ id: issueId, companyId, title: "Legacy AI adoption", status: "in_progress", assigneeAgentId: higher, responsibleUserId: userId });
      await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId: higher, nativeIssueId: issueId, status: "failed", errorCode: "acpx_auth_required", responsibleUserId: userId, contextSnapshot: {} });
      const intents = connectionIntentService(db);
      const card = await intents.requestForRunAuthFailure(runId);
      const setup = await intents.setupOptions(card!.interactionId!);
      expect(setup.aiConnectionRequiresAdoption).toBe(true);
      const account = await aiConnectionService(db).save(companyId, userId, { provider: "openai", method: "api_key", ownership: "personal", name: "Adopted account", apiKey: "fixture", allAgents: true, agentIds: [] }, "fixture-api-key");
      const [agent] = await db.select().from(agents).where(eq(agents.id, higher));
      let locked!: () => void;
      const held = new Promise<void>(resolve => { locked = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.transaction(async tx => {
        await tx.select().from(agents).where(eq(agents.id, lower)).for("no key update");
        locked(); await resume;
      });
      await held;
      const pids: number[] = [];
      const run = (work: (client: Db) => Promise<unknown>) => db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL lock_timeout = '8s'`);
        const [backend] = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        pids.push(Number(backend.pid));
        return work(tx as unknown as Db);
      });
      const waitForLock = (index: number) => vi.waitFor(async () => {
        expect(pids.length).toBeGreaterThan(index);
        const [activity] = await db.execute(sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pids[index]}`);
        expect(activity.wait_event_type).toBe("Lock");
      }, { timeout: 5000 });
      const settings = run(client => toolAccessService(client, { remoteHttpEndpointLookup: async () => [{ address: "8.8.8.8", family: 4 }] }).updateConnection(connectionId, { name: "Concurrent settings" }));
      let adoption: Promise<unknown> | undefined;
      const settingsResult = Promise.allSettled([settings]);
      try {
        await waitForLock(0);
        adoption = run(client => connectionIntentService(client).complete(card!.interactionId!, account.connectionId, userId, { validatedAdoption: { agentUpdatedAt: agent.updatedAt, binding: setup.aiConnection! } }));
        await waitForLock(1);
      } finally { release(); await blocker; }
      const [saved] = await settingsResult;
      const [adopted] = await Promise.allSettled([adoption!]);
      if (saved.status === "rejected") throw saved.reason;
      if (adopted.status === "rejected") throw adopted.reason;
      expect((await db.select().from(agents).where(eq(agents.id, higher)))[0].runtimeConfig.aiConnection).toEqual(setup.aiConnection);
      expect((await db.select().from(toolConnections).where(eq(toolConnections.id, connectionId)))[0].name).toBe("Concurrent settings");
      expect(await toolAccessService(db).listConnectionInstalls(account.connectionId, companyId)).toEqual(expect.arrayContaining([expect.objectContaining({ targetType: "agent", targetId: higher })]));
      expect((await intents.setupOptions(card!.interactionId!)).interaction.status).toBe("accepted");
    } finally { release?.(); await rm(home, { recursive: true, force: true }); }
  }, 20000);

});
