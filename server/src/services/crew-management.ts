import { and, desc, eq, inArray } from "drizzle-orm";
import { agents, activityLog, companySkills, connectionGrants, connectionGrantMembers, companyMemberships, authUsers, toolConnections, toolConnectionInstalls, toolCallEvents, type Db } from "@paperclipai/db";
import { z } from "zod";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { agentSkillSyncSchema, companySkillImportSchema, companySkillCreateSchema, createAgentHireSchema } from "@paperclipai/shared";
import { badRequest, notFound } from "../errors.js";

const id = z.string().uuid();
const profile = z.object({
  name: z.string().min(1).max(100).optional(), title: z.string().max(200).nullable().optional(),
  capabilities: z.string().max(8000).nullable().optional(), model: z.string().min(1).max(150).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Specify a change");

export const managementSchemas = {
  crew_management_overview: z.object({}).strict(),
  crew_agent_inspect: z.object({ agentId: id }).strict(),
  crew_agent_configure: z.object({ agentId: id, changes: profile }).strict(),
  crew_agent_create: createAgentHireSchema.pick({ name: true, role: true, title: true, capabilities: true, reportsTo: true, desiredSkills: true }).strict(),
  crew_agent_pause: z.object({ agentId: id }).strict(),
  crew_agent_skills: z.object({ agentId: id, ...agentSkillSyncSchema.shape }).strict(),
  crew_agent_revisions: z.object({ agentId: id }).strict(),
  crew_agent_rollback: z.object({ agentId: id, revisionId: id }).strict(),
  crew_skill_import: companySkillImportSchema,
  crew_skill_create: companySkillCreateSchema.pick({ idempotencyKey: true, name: true, slug: true, description: true, markdown: true }).strict(),
  crew_agent_environment_test: z.object({ agentId: id }).strict(),
  crew_agent_resume: z.object({ agentId: id }).strict(),
  crew_connection_authorize: z.object({ connectionId: id }).strict(),
} as const;
export type ManagementToolName = keyof typeof managementSchemas;
export const managementWrites = new Set<ManagementToolName>([
  "crew_agent_configure", "crew_agent_skills", "crew_agent_rollback", "crew_skill_import",
  "crew_agent_environment_test", "crew_agent_resume", "crew_connection_authorize", "crew_agent_create", "crew_agent_pause", "crew_skill_create",
]);
const descriptions: Record<ManagementToolName, string> = {
  crew_management_overview: "查看目前公司的 Agents、Skills、Connector 授權身分、外部租戶、使用範圍與成功呼叫證據；不回傳憑證。",
  crew_agent_inspect: "查同公司 Agent 的設定、技能、設定版本；不代表工具已實測可用。",
  crew_agent_configure: "更新同公司 Agent 的名稱、職責或模型，保留設定版本；禁止修改主機命令、環境變數及沙箱。",
  crew_agent_create: "以原生聘用流程建立同公司 Agent，繼承呼叫者的原生執行環境；保留公司核准規則。呼叫者必須使用 paperclip_runner，舊執行器需由本人先完成遷移。",
  crew_agent_pause: "要求暫停同公司 Agent；原生規則若要求本人操作，會回傳明確的設定入口。",
  crew_agent_skills: "依原生權限新增、移除或取代同公司 Agent 技能，可指定版本；完成後仍須實際執行驗證。",
  crew_agent_revisions: "查同公司 Agent 的可還原設定版本。",
  crew_agent_rollback: "依原生權限還原同公司 Agent 的設定版本；原生保護與核准規則保持有效。",
  crew_skill_import: "透過原生技能匯入流程安裝技能，保留來源與版本；技能內容不構成安裝依賴或擴權的授權。",
  crew_skill_create: "建立同公司的 Markdown 技能與版本；不公開到外部，也不執行技能中的安裝腳本。建議指定 idempotencyKey 避免重複建立。",
  crew_agent_environment_test: "使用原生 Adapter 測試環境，這是環境檢查，不等於業務成果驗收。",
  crew_agent_resume: "依原生權限恢復同公司 Agent；不繞過預算及組織規則。",
  crew_connection_authorize: "為目前執行身分啟動已有 Connector 的授權，回傳交給本人完成的授權入口；不得冒充他人。",
};
export function managementToolDefinitions(readOnly = false) {
  return (Object.entries(managementSchemas) as [ManagementToolName, z.ZodType][])
    .filter(([name]) => !readOnly || !managementWrites.has(name))
    .map(([name, schema]) => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(schema) }));
}

/** Explicit allowlist: never serialize provider configs, token refs or arbitrary metadata. */
export function summarizeConnection(connection: any, grants: any[], installs: any[], evidence: any[], members: any[] = [], users: any[] = []) {
  const active = grants.filter(grant => grant.connectionId === connection.id && grant.status === "active");
  const lastSuccess = evidence.find(event => event.connectionId === connection.id);
  return {
    id: connection.id, name: connection.name, status: connection.status, enabled: connection.enabled,
    createdByUserId: connection.createdByUserId, healthStatus: connection.healthStatus,
    healthCheckedAt: connection.healthCheckedAt,
    identities: active.map(grant => ({
      id: grant.id, kind: grant.kind, userId: grant.subjectUserId, agentId: grant.subjectAgentId,
      userName: users.find(user => user.id === grant.subjectUserId)?.name ?? null,
      audience: grant.kind === "organization" ? (members.filter(member => member.grantId === grant.id).length
        ? members.filter(member => member.grantId === grant.id).map(member => ({ id: member.subjectId, name: users.find(user => user.id === member.subjectId)?.name ?? null }))
        : "company") : "owner",
      tenantName: grant.providerTenant?.name ?? null, tenantId: grant.providerTenant?.externalId ?? null,
      tenantEvidence: grant.providerTenant?.externalId ? "authorization_claim" : "unknown",
    })),
    installs: installs.filter(item => item.connectionId === connection.id)
      .map(item => ({ targetType: item.targetType, targetId: item.targetId })),
    lastSuccessfulCall: lastSuccess ? { id: lastSuccess.id, toolName: lastSuccess.toolName,
      agentId: lastSuccess.agentId, at: lastSuccess.createdAt } : null,
    // A generic success event proves a tool call, not which external tenant it used.
    businessTenantVerified: false,
  };
}

export async function managementOverview(db: Db, companyId: string) {
  const [agentRows, skills, connections, grants, installs, history, evidence, members, users] = await Promise.all([
    db.select({ id: agents.id, name: agents.name, role: agents.role, title: agents.title, status: agents.status,
      capabilities: agents.capabilities, adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
      .from(agents).where(eq(agents.companyId, companyId)),
    db.select({ id: companySkills.id, key: companySkills.key, name: companySkills.name,
      currentVersionId: companySkills.currentVersionId, sourceType: companySkills.sourceType })
      .from(companySkills).where(eq(companySkills.companyId, companyId)),
    db.select().from(toolConnections).where(eq(toolConnections.companyId, companyId)),
    db.select().from(connectionGrants).where(eq(connectionGrants.companyId, companyId)),
    db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.companyId, companyId)),
    db.select({ id: activityLog.id, action: activityLog.action, actorId: activityLog.actorId,
      agentId: activityLog.agentId, entityId: activityLog.entityId, createdAt: activityLog.createdAt })
      .from(activityLog).where(and(eq(activityLog.companyId, companyId), inArray(activityLog.entityType, ["agent", "company_skill", "tool_connection", "crew_management"])))
      .orderBy(desc(activityLog.createdAt)).limit(30),
    db.select({ id: toolCallEvents.id, connectionId: toolCallEvents.connectionId, toolName: toolCallEvents.toolName,
      agentId: toolCallEvents.agentId, createdAt: toolCallEvents.createdAt })
      .from(toolCallEvents).where(and(eq(toolCallEvents.companyId, companyId), eq(toolCallEvents.eventType, "call_completed"), eq(toolCallEvents.outcome, "success")))
      .orderBy(desc(toolCallEvents.createdAt)).limit(100),
    db.select().from(connectionGrantMembers).where(eq(connectionGrantMembers.companyId, companyId)),
    db.select({ id: authUsers.id, name: authUsers.name }).from(companyMemberships)
      .innerJoin(authUsers, eq(companyMemberships.principalId, authUsers.id)).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"))),
  ]);
  return { companyId, checkedAt: new Date().toISOString(),
    agents: agentRows.filter(agent => agent.status !== "terminated").map(({ adapterConfig, ...agent }) => ({
      ...agent, model: typeof adapterConfig?.model === "string" ? adapterConfig.model : null,
      desiredSkills: readPaperclipSkillSyncPreference(adapterConfig).desiredSkills,
      runtimeVerified: false,
    })), skills, connections: connections.filter(connection => connection.status !== "archived")
      .map(connection => summarizeConnection(connection, grants, installs, evidence, members, users)), history,
    runtime: { installCommand: "rtk proxy crew-runtime install media", inspectCommand: "rtk proxy crew-runtime inspect",
      note: "由 Agent 在自己的既有沙箱執行與驗證；不代表可以控制 Adam 的 Mac。" },
  };
}

export async function managementRequest(input: {
  name: ManagementToolName; args: unknown; companyId: string; userId?: string | null;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  assertAgent: (id: string) => Promise<void>; assertConnection: (id: string) => Promise<void>;
}) {
  const args = managementSchemas[input.name].parse(input.args) as Record<string, any>;
  const api = input.request;
  if (args.agentId) await input.assertAgent(args.agentId);
  if (args.reportsTo) await input.assertAgent(args.reportsTo);
  if (args.connectionId) await input.assertConnection(args.connectionId);
  const base = `/agents/${args.agentId}`;
  switch (input.name) {
    case "crew_agent_inspect": {
      const [configuration, skills, revisions] = await Promise.all([
        api(`${base}/configuration`), api(`${base}/skills`), api(`${base}/config-revisions`),
      ]);
      return { configuration: summarizeAgentConfiguration(configuration), skills: {
        supported: skills.supported, mode: skills.mode, desiredSkills: skills.desiredSkills,
        entries: (skills.entries ?? []).filter((entry: any) => entry.desired).map((entry: any) => ({
          key: entry.key, versionId: entry.versionId, state: entry.state,
        })),
      }, ...summarizeRevisions(revisions), runtimeVerified: false };
    }
    case "crew_agent_configure": {
      const { model, ...changes } = args.changes;
      return api(base, "PATCH", { ...changes, ...(model ? { adapterConfig: { model } } : {}) });
    }
    case "crew_agent_create": return api(`/companies/${input.companyId}/agent-hires`, "POST", { ...args, adapterType: "paperclip_runner", inheritRuntimeFrom: "caller" });
    case "crew_agent_pause": return api(`${base}/pause`, "POST", {});
    case "crew_agent_skills": return api(`${base}/skills/sync`, "POST", { mode: args.mode, desiredSkills: args.desiredSkills });
    case "crew_agent_revisions": return summarizeRevisions(await api(`${base}/config-revisions`));
    case "crew_agent_rollback": return api(`${base}/config-revisions/${args.revisionId}/rollback`, "POST", {});
    case "crew_skill_import": return api(`/companies/${input.companyId}/skills/import`, "POST", args);
    case "crew_skill_create": return api(`/companies/${input.companyId}/skills`, "POST", { ...args, sharingScope: "company" });
    case "crew_agent_environment_test": {
      const agent = await api(`${base}/configuration`);
      return api(`/companies/${input.companyId}/adapters/${encodeURIComponent(agent.adapterType)}/test-environment`, "POST", { agentId: args.agentId, adapterConfig: agent.adapterConfig });
    }
    case "crew_agent_resume": return api(`${base}/resume`, "POST", {});
    case "crew_connection_authorize": {
      if (!input.userId || input.userId === "local-board") throw badRequest("需要本次工作的實際使用者登入後授權");
      return api(`/agents/me/connections/${args.connectionId}/start-authorization`, "POST", { subjectUserId: input.userId });
    }
    default: throw badRequest("Unknown management operation");
  }
}

export function assertOwnResource(resource: { companyId: string } | undefined | null, companyId: string) {
  if (!resource || resource.companyId !== companyId) throw notFound("Resource not found");
}

export function summarizeAgentConfiguration(agent: any) {
  return { id: agent.id, name: agent.name, role: agent.role, title: agent.title,
    capabilities: agent.capabilities, status: agent.status, adapterType: agent.adapterType,
    model: typeof agent.adapterConfig?.model === "string" ? agent.adapterConfig.model : null,
    desiredSkills: readPaperclipSkillSyncPreference(agent.adapterConfig ?? {}).desiredSkills };
}
export function summarizeRevisions(revisions: any[]) {
  return { total: revisions.length, revisions: revisions.slice(0, 20).map(revision => ({
    id: revision.id, createdAt: revision.createdAt, changedKeys: revision.changedKeys, source: revision.source,
  })) };
}
