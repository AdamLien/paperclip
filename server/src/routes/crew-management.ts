import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { agents, toolConnections, type Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { accessService } from "../services/access.js";
import { logActivity } from "../services/activity-log.js";
import { projectToolContext } from "../services/project-tool-context.js";
import { forbidden } from "../errors.js";
import { assertOwnResource, managementOverview, managementRequest, managementSchemas, managementToolDefinitions, managementWrites, type ManagementToolName } from "../services/crew-management.js";

class OwnerActionRequired extends Error {}

export function crewManagementRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);
  async function authorize(req: Request, companyId: string, write = false) {
    assertCompanyAccess(req, companyId);
    const decision = await access.decide({ actor: req.actor,
      action: write ? "agent_config:update" : "agent_config:read",
      resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
  }
  router.get("/companies/:companyId/management", async (req, res) => {
    const companyId = String(req.params.companyId);
    await authorize(req, companyId);
    res.set("Cache-Control", "private, no-store");
    res.json(await managementOverview(db, companyId));
  });
  router.post("/mcp/crew-management", async (req, res) => {
    const { id = null, method, params } = req.body ?? {};
    const send = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });
    const name = params?.name as ManagementToolName;
    const write = method === "tools/call" && managementWrites.has(name);
    const context = await projectToolContext(db, req.actor, write, "Management");
    if (write && !context.userId) throw forbidden("管理異動需要本次工作對應的使用者");
    const companyId = context.run.companyId;
    await authorize(req, companyId, write);
    if (method === "initialize") return send({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mcrew-management", version: "1" } });
    if (method === "notifications/initialized") return res.status(202).end();
    if (method === "tools/list") return send({ tools: managementToolDefinitions(!["standard", "skill_test"].includes(context.issue.workMode)) });
    if (method !== "tools/call") return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    try {
      if (!Object.hasOwn(managementSchemas, name)) throw forbidden("Unknown management operation");
      managementSchemas[name].parse(params?.arguments ?? {});
      const actor = getActorInfo(req);
      const value = name === "crew_management_overview" ? await managementOverview(db, companyId) : await managementRequest({
        name, args: params?.arguments ?? {}, companyId, userId: context.userId,
        async assertAgent(agentId) {
          const [row] = await db.select({ companyId: agents.companyId }).from(agents).where(eq(agents.id, agentId));
          assertOwnResource(row, companyId);
        },
        async assertConnection(connectionId) {
          const [row] = await db.select({ companyId: toolConnections.companyId }).from(toolConnections).where(eq(toolConnections.id, connectionId));
          assertOwnResource(row, companyId);
        },
        async request(path, method = "GET", body) {
          // Fixed trusted origin; retain actual agent authority and native validators.
          const origin = process.env.PAPERCLIP_API_URL;
          if (!origin) throw new Error("Paperclip API origin is unavailable");
          const response = await fetch(`${origin.replace(/\/+$/, "").replace(/\/api$/, "")}/api${path}`, {
            method, headers: { Authorization: req.header("authorization")!, "Content-Type": "application/json" },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(120_000), redirect: "error",
          });
          const result = await response.json();
          if (!response.ok) {
            if (response.status === 403) throw new OwnerActionRequired("此操作需要原生權限或帳號持有人完成，尚未套用。");
            throw new Error(typeof result.error === "string" ? result.error : `Management request failed (${response.status})`);
          }
          return result;
        },
      });
      if (write) await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId, action: "crew_management.operation",
        entityType: "crew_management", entityId: String(params?.arguments?.agentId ?? params?.arguments?.connectionId ?? companyId),
        details: { operation: name, requiresOwnerAction: value?.requiresOwnerAction === true } });
      return send({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    } catch (error) {
      if (error instanceof OwnerActionRequired) return send({ isError: true,
        content: [{ type: "text", text: error.message }], structuredContent: {
          applied: false, requiresOwnerAction: true, settingsPath: "/company/settings/management",
        } });
      return send({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Management failed" }] });
    }
  });
  return router;
}
