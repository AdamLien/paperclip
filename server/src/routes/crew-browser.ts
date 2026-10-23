import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { agents, issues, heartbeatRuns, type Db } from "@paperclipai/db";
import { z } from "zod";
import { assertBoard, assertCompanyAccess, getAccessibleResource, getActorInfo } from "./authz.js";
import { crewBrowserService, type BrowserScope } from "../services/crew-browser.js";
import { forbidden, notFound } from "../errors.js";
import { logActivity } from "../services/activity-log.js";

const uuid = z.string().uuid();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("snapshot") }).strict(),
  z.object({ action: z.literal("navigate"), url: z.string().url().max(2048).refine(s => /^https:\/\//.test(s) && !new URL(s).username && !new URL(s).password) }).strict(),
  z.object({ action: z.literal("click"), x: z.number().int().min(0).max(8192), y: z.number().int().min(0).max(8192) }).strict(),
  z.object({ action: z.literal("type"), text: z.string().max(10000) }).strict(),
  z.object({ action: z.literal("key"), key: z.enum(["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) }).strict(),
  z.object({ action: z.literal("scroll"), deltaY: z.number().int().min(-4000).max(4000) }).strict(),
]);
const exchange = z.object({ url: z.string().max(2048), title: z.string().max(200),
  width: z.number().int().min(0).max(8192), height: z.number().int().min(0).max(8192),
  frame: z.string().max(1_500_000).regex(/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/).optional(),
  result: z.object({ id: uuid, text: z.string().max(50000).optional(), error: z.string().max(500).optional() }).strict().optional(),
}).strict();

export function crewBrowserRoutes(db: Db, service = crewBrowserService()) {
  const router = Router();
  // No browser cookies or ambient user identity authorize the relay.
  router.post("/browser-workspace/relay", (req, res) => {
    res.set("Cache-Control", "no-store");
    const token = /^[a-f0-9]{64}$/.exec(req.header("x-crew-browser-pairing") ?? "")?.[0];
    if (!token) throw forbidden("Browser pairing required");
    res.json(service.exchange(token, exchange.parse(req.body)));
  });
  const root = "/companies/:companyId/browser-workspace";
  router.use(root, (req, res, next) => {
    uuid.parse(req.params.companyId); assertCompanyAccess(req, req.params.companyId);
    res.set("Cache-Control", "no-store"); next();
  });
  const scope = (req: Parameters<typeof assertBoard>[0]): BrowserScope => {
    const ownerId = req.actor.type === "board" ? req.actor.userId : req.actor.onBehalfOfUserId;
    if (!ownerId) throw forbidden("A responsible user is required to access a shared browser");
    if (req.actor.type === "agent" && !req.actor.agentId) throw forbidden("Agent identity required");
    return { companyId: uuid.parse(req.params.companyId), ownerId, ...(req.actor.type === "agent" ? { agentId: req.actor.agentId } : {}) };
  };
  const activeTask = async (req: Parameters<typeof assertBoard>[0]) => {
    if (req.actor.type !== "agent") return null;
    const runId = uuid.safeParse(req.actor.runId);
    if (!runId.success) throw forbidden("An active task run is required");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId.data),
      eq(heartbeatRuns.companyId, scope(req).companyId), eq(heartbeatRuns.agentId, req.actor.agentId!))).limit(1);
    if (!run || run.status !== "running" || run.responsibleUserId !== scope(req).ownerId) throw forbidden("An active responsible-user task run is required");
    const issueId = run.nativeIssueId ?? run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId;
    if (typeof issueId !== "string") throw forbidden("Task identity required");
    return issueId;
  };
  const accessible = async (req: Parameters<typeof assertBoard>[0], res: Parameters<typeof getAccessibleResource>[1], sessionId: string) => {
    const s = service.read(sessionId, scope(req));
    const [row] = await db.select().from(issues).where(and(eq(issues.id, s.issueId), eq(issues.companyId, scope(req).companyId))).limit(1);
    const issue = await getAccessibleResource(req, res, row, "Browser session not found");
    if (!issue) return null;
    if (issue.assigneeAgentId !== s.agentId || (req.actor.type === "agent" && await activeTask(req) !== s.issueId)) throw forbidden("Browser task assignment has changed");
    return s;
  };
  router.get(root, async (req, res) => {
    const readable = [];
    const taskId = await activeTask(req);
    for (const s of service.list(scope(req))) {
      const [issue] = await db.select().from(issues).where(and(eq(issues.id, s.issueId), eq(issues.companyId, scope(req).companyId))).limit(1);
      // List is owner/agent scoped; issue access is rechecked by detail/commands.
      if (req.actor.type === "board" || (issue && issue.assigneeAgentId === s.agentId && taskId === s.issueId)) readable.push({ ...s, frame: null });
    }
    res.json(readable);
  });
  router.post(root, async (req, res) => {
    assertBoard(req); const owner = scope(req);
    const body = z.object({ issueId: uuid, agentId: uuid, mode: z.literal("chrome"), label: z.string().trim().min(1).max(80) }).strict().parse(req.body);
    const [row] = await db.select().from(issues).where(and(eq(issues.id, body.issueId), eq(issues.companyId, owner.companyId))).limit(1);
    const issue = await getAccessibleResource(req, res, row, "Task not found");
    if (!issue) return;
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, body.agentId), eq(agents.companyId, owner.companyId))).limit(1);
    if (!agent) throw notFound("Agent not found");
    // Keep browser authority with the task's assigned agent.
    if (issue.assigneeAgentId !== body.agentId) throw forbidden("Choose a task assigned to this agent");
    const s = service.create({ ...owner, ...body });
    try { await logActivity(db, { companyId: owner.companyId, actorType: "user", actorId: owner.ownerId,
      action: "browser_workspace.created", entityType: "browser_session", entityId: s.id, issueId: body.issueId,
      details: { mode: body.mode, agentId: body.agentId } }); }
    catch (error) { service.stop(s.id, owner); throw error; }
    res.status(201).json(s);
  });
  router.get(`${root}/:sessionId`, async (req, res) => {
    const s = await accessible(req, res, uuid.parse(req.params.sessionId)); if (s) res.json(s);
  });
  router.delete(`${root}/:sessionId`, async (req, res) => {
    assertBoard(req); const id = uuid.parse(req.params.sessionId);
    const s = service.read(id, scope(req));
    service.stop(id, scope(req));
    await logActivity(db, { companyId: scope(req).companyId, actorType: "user", actorId: getActorInfo(req).actorId,
      action: "browser_workspace.stopped", entityType: "browser_session", entityId: id, issueId: s.issueId });
    res.json({ stopped: true });
  });
  router.post(`${root}/:sessionId/commands`, async (req, res) => {
    const id = uuid.parse(req.params.sessionId); const s = await accessible(req, res, id); if (!s) return;
    const body = command.parse(req.body); const actor = getActorInfo(req);
    await logActivity(db, { companyId: scope(req).companyId, actorType: actor.actorType, actorId: actor.actorId,
      action: "browser_workspace.command_requested", entityType: "browser_session", entityId: id, issueId: s.issueId,
      details: { action: body.action } });
    res.status(202).json(service.command(id, scope(req), body));
  });
  router.get(`${root}/:sessionId/commands/:commandId`, async (req, res) => {
    const id = uuid.parse(req.params.sessionId); if (!await accessible(req, res, id)) return;
    res.json(service.result(id, scope(req), uuid.parse(req.params.commandId)));
  });
  return router;
}
