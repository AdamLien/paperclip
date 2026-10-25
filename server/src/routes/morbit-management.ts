import express, { Router, type Request } from "express";
import { z } from "zod";
import { assertAuthenticated, assertBoard, assertCompanyAccess, assertInstanceAdmin } from "./authz.js";
import { badRequest, forbidden, notFound, HttpError } from "../errors.js";

export type ModelObservation = {
  state: "unconfigured" | "authorization_required" | "unverified" | "ready" | "degraded";
  model?: string;
  version?: string;
  checkedAt?: string;
};

export interface ManagementDependencies {
  companies(): Promise<Array<{ id: string; name: string; issuePrefix: string }>>;
  company(id: string): Promise<{ id: string; name: string; issuePrefix: string } | null>;
  canManage(companyId: string, userId: string): Promise<boolean>;
  wiki(): Promise<{ id: string; status: string; version: string } | null>;
  modelStatus(): Promise<ModelObservation>;
  modelTest(): Promise<{ model: string; text: string; checkedAt: string }>;
  wikiCall(key: string, params: Record<string, unknown>, action: boolean, pluginId: string, req: Request): Promise<unknown>;
  audit(req: Request, companyId: string, action: string, details: Record<string, unknown>): Promise<void>;
}

const wikiReadKeys = ["overview", "pages", "sources", "page-content", "spaces", "space"];
const wikiActionKeys = ["capture-source", "write-page", "start-query"];
const callSchema = z.object({
  key: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
}).strict();

/** The adapter reuses host identity; it cannot accept browser-selected scopes or upstreams. */
export function morbitManagementRoutes(deps: ManagementDependencies) {
  const router = Router();
  const root = "/companies/:companyId/morbit";

  const scope = (req: Request, requireManager = false) => managementScope(deps, req, String(req.params.companyId), requireManager);

  router.get("/morbit/workspaces", async (req, res) => {
    const workspaces = await managementWorkspaces(deps, req);
    // Instance authority permits service status, never another workspace's data.
    const instance = req.actor.isInstanceAdmin === true || req.actor.source === "local_implicit";
    const model = instance ? await deps.modelStatus() : undefined;
    reply(res, { workspaces, ...(model ? {instance:{can_manage_instance:true,
      base:{state:model.state,...(model.version?{version:model.version}:{}),...(model.model?{model:model.model}:{})},
      identity:{local:"configured",ldap:"unconfigured"}}} : {}) });
  });

  function reply(res: import("express").Response, data: unknown) {
    res.set("Cache-Control", "no-store").json({ code: "SUCCESS", message: "", data });
  }

  router.get(`${root}/access`, async (req, res) => {
    const s = await scope(req);
    reply(res, { company_id: s.company.id, company_name: s.company.name,
      prefix: s.company.issuePrefix, can_manage_workspace: s.manager, can_manage_instance: s.instance });
  });

  router.get(`${root}/management`, async (req, res) => {
    const s = await scope(req, true);
    const [wiki, base] = await Promise.all([
      deps.wiki(), s.instance ? deps.modelStatus() : Promise.resolve({ state: "restricted" }),
    ]);
    const prefix = `/${encodeURIComponent(s.company.issuePrefix)}`;
    reply(res, {
      company_id: s.company.id, company_name: s.company.name, prefix: s.company.issuePrefix,
      can_manage_workspace: s.manager, can_manage_instance: s.instance,
      links: {
        work: `${prefix}/dashboard`, agents: `${prefix}/agents/all`, skills: `${prefix}/skills`,
        connectors: `${prefix}/apps`, members: `${prefix}/company/settings/members`,
        settings: `${prefix}/company/settings`,
        ...(wiki ? { wiki: `${prefix}/plugins/${encodeURIComponent(wiki.id)}/wiki` } : {}),
        ...(s.instance ? { instance: `${prefix}/company/settings/instance/access`,
          plugins: `${prefix}/company/settings/instance/plugins` } : {}),
      },
      brain: { state: !wiki || wiki.status === "uninstalled" ? "dependency_missing" : wiki.status === "ready" ? "unverified" : "degraded",
        ...(wiki ? { version: wiki.version } : {}) },
      base: { state: base.state, ...("model" in base ? { model: base.model } : {}),
        ...("version" in base ? { version: base.version } : {}),
        ...("checkedAt" in base ? { checked_at: base.checkedAt } : {}) },
      identity: { local: "configured", ldap: "unconfigured" },
    });
  });

  router.post(`${root}/base/test`, async (req, res) => {
    const s = await scope(req, true);
    assertInstanceAdmin(req);
    if (!z.object({}).strict().safeParse(req.body).success) throw badRequest("This test accepts no upstream URL or credentials");
    const result = await deps.modelTest();
    await deps.audit(req, s.company.id, "morbit.model_tested", { model: result.model });
    reply(res, { model: result.model, text: result.text, checked_at: result.checkedAt });
  });

  for (const action of [false, true]) {
    router.post(`${root}/brain/${action ? "action" : "read"}`, async (req, res) => {
      const s = await scope(req, action && req.body?.key !== "start-query");
      const parsed = callSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid Wiki operation");
      const { key, params } = parsed.data;
      if (!(action ? wikiActionKeys : wikiReadKeys).includes(key)) throw badRequest("Unsupported Wiki operation");
      // A caller must never override company, plugin, root folder or actor context.
      const allowedParams = new Set(["wiki_id", "space_slug", "path", "query", "question", "prompt",
        "title", "content", "contents", "source_type", "filename", "expected_hash", "page_type", "limit"]);
      if (Object.keys(params).some(k => !allowedParams.has(k))) throw badRequest("Unsupported Wiki parameters");
      if (JSON.stringify(params).length > 250_000) throw badRequest("Wiki source exceeds 250 KB");
      const wiki = await deps.wiki();
      if (!wiki || wiki.status !== "ready") throw new HttpError(503, "mBrain Wiki is not installed or ready");
      const native = Object.fromEntries(Object.entries(params).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
      const result = await deps.wikiCall(key, { ...native, companyId: s.company.id }, action, wiki.id, req);
      if (action) await deps.audit(req, s.company.id, `morbit.wiki.${key}`, { key });
      reply(res, result);
    });
  }
  return router;
}

export async function managementScope(deps: ManagementDependencies, req: Request, companyId: string, requireManager = false) {
    assertAuthenticated(req);
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const membership = req.actor.memberships?.find(m => m.companyId === companyId && m.status === "active");
    const instance = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true;
    if (!instance && !membership) throw forbidden("Active workspace membership required");
    const manager = instance || (membership?.membershipRole !== "viewer" && (
      membership?.membershipRole === "owner" || membership?.membershipRole === "admin"
      || await deps.canManage(companyId, req.actor.userId ?? "")
    ));
    if (requireManager && !manager) throw forbidden("Workspace management access required");
    const company = await deps.company(companyId);
    if (!company) throw notFound("Workspace not found");
    return { company, manager, instance };
  }


/** Resolve only server-authorized workspaces; never bootstrap from browser tenant parameters. */
export async function managementWorkspaces(deps: ManagementDependencies, req: Request) {
  assertAuthenticated(req);
  assertBoard(req);
  const all = await deps.companies();
  const candidates = all.filter(c => req.actor.source === "local_implicit" || req.actor.companyIds?.includes(c.id));
  const scopes = await Promise.all(candidates.map(async c => {
    try { return await managementScope(deps, req, c.id, true); }
    catch (error) { if (error instanceof HttpError && error.status === 403) return null; throw error; }
  }));
  return scopes.flatMap(s => s ? [{company_id:s.company.id, company_name:s.company.name,
    prefix:s.company.issuePrefix, can_manage_workspace:s.manager, can_manage_instance:s.instance}] : []);
}

/** Assets are built in metabiz-web; the host supplies identity and denies unauthorized documents. */
export function morbitManagementAssets(deps: ManagementDependencies, directory: string | undefined) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const workspaces = await managementWorkspaces(deps, req);
    if (!workspaces.length && !req.actor.isInstanceAdmin && req.actor.source !== "local_implicit") throw forbidden("Workspace management access required");
    if (!directory) throw new HttpError(503, "Management UI assets are not installed");
    next();
  });
  if (directory) router.use(express.static(directory, { fallthrough: false, redirect: false }));
  return router;
}

/** Apply the same write policy to legacy Wiki entry points, so UI-only gating cannot be bypassed. */
export function morbitWikiWriteGuard(deps: ManagementDependencies) {
  const router = Router();
  router.post("/plugins/tools/execute", async (req, _res, next) => {
    const tool = req.body?.tool;
    if (typeof tool !== "string" || !tool.startsWith("paperclipai.plugin-llm-wiki:") || req.actor.type === "agent") return next();
    const readTools = new Set(["wiki_search", "wiki_read_page", "wiki_list_sources", "wiki_read_source", "wiki_list_backlinks", "wiki_list_pages"]);
    if (readTools.has(tool.slice("paperclipai.plugin-llm-wiki:".length))) return next();
    const companyId = req.body?.runContext?.companyId;
    if (typeof companyId !== "string") throw badRequest("Explicit Wiki workspace required");
    await managementScope(deps, req, companyId, true);
    next();
  });
  router.use("/plugins/:pluginId", async (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // Express routes are case-insensitive and allow a trailing slash by default.
    const path = req.path.toLowerCase().replace(/\/+$/, "");
    const action = path.startsWith("/actions/") ? path.slice("/actions/".length)
      : path === "/bridge/action" ? req.body?.key : undefined;
    const isMutation = action !== undefined || path.startsWith("/api/");
    if (!isMutation || action === "start-query") return next();
    const key = String(req.params.pluginId);
    const wiki = await deps.wiki();
    if (key !== "paperclipai.plugin-llm-wiki" && key !== wiki?.id) return next();
    assertAuthenticated(req);
    // Agent execution retains the existing tool/host authorization boundary.
    if (req.actor.type === "agent") return next();
    const companyId = req.body?.companyId ?? req.body?.params?.companyId ?? req.query.companyId;
    if (typeof companyId !== "string") throw badRequest("Explicit Wiki workspace required");
    await managementScope(deps, req, companyId, true);
    next();
  });
  return router;
}
