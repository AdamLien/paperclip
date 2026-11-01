import { morbitBaseNativeRoutes } from "./morbit-base-native.js";
import express, { Router, type Request } from "express";
import { z } from "zod";
import { assertAuthenticated, assertBoard, assertCompanyAccess, assertInstanceAdmin, getActorInfo } from "./authz.js";
import { trustedBoardMutationOrigin } from "../middleware/board-mutation-guard.js";
import { badRequest, conflict, forbidden, notFound, HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import type { MorbitConsoleProxy, MorbitConsoleProxyRequest, MorbitNativeEntry } from "../services/morbit-native-entry.js";
import {
  accessMethods,
  createMorbitCompanyConnectionService,
  MorbitCompanyConnectionRevisionConflict,
  providers,
  type MorbitAccessMethod,
  type MorbitProvider,
} from "../services/morbit-company-connection.js";

export type ModelObservation = {
  state: "unconfigured" | "authorization_required" | "unverified" | "ready" | "degraded";
  model?: string;
  version?: string;
  checkedAt?: string;
};

/** `model` lists the models that responded; `results` has one entry per tested service. */
export type ModelTestResult = {
  model: string;
  text: string;
  checkedAt: string;
  results: Array<{ model: string; ok: boolean }>;
};

export interface ManagementDependencies {
  companies(): Promise<Array<{ id: string; name: string; issuePrefix: string }>>;
  company(id: string): Promise<{ id: string; name: string; issuePrefix: string } | null>;
  canManage(companyId: string, userId: string): Promise<boolean>;
  wiki(): Promise<{ id: string; status: string; version: string } | null>;
  modelStatus(): Promise<ModelObservation>;
  modelTest(): Promise<ModelTestResult>;
  wikiCall(key: string, params: Record<string, unknown>, action: boolean, pluginId: string, req: Request): Promise<unknown>;
  audit(req: Request, companyId: string, action: string, details: Record<string, unknown>): Promise<void>;
  companyConnection: ReturnType<typeof createMorbitCompanyConnectionService>;
  nativeEntry?: () => MorbitNativeEntry | null;
  consoleProxy?: MorbitConsoleProxy | null;
}

const wikiReadKeys = ["overview", "pages", "sources", "page-content", "spaces", "space"];
const wikiActionKeys = ["capture-source", "write-page", "start-query"];
const callSchema = z.object({
  key: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
}).strict();

function nativeSettingsUrl(deps: ManagementDependencies): string | null {
  return deps.consoleProxy ? "/api/morbit/base/console/" : null;
}

function requiresNativeConsoleSession(path: string): boolean {
  return path.startsWith("/api/") || path.startsWith("/v1/");
}

function preserveCspWithSelfFrameAncestor(value: string): string {
  const directives = value.split(";").map(directive => directive.trim()).filter(Boolean);
  const index = directives.findIndex(directive => directive.toLowerCase().startsWith("frame-ancestors "));
  if (index < 0) return value;
  directives[index] = "frame-ancestors 'self'";
  return directives.join("; ");
}

function readCompanyUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw badRequest("companyUrl must be a string or null");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("unsafe company URL");
    }
    return url.origin;
  } catch {
    throw badRequest("companyUrl must be an HTTPS origin without credentials, path, query, or fragment");
  }
}

function readObservedUrl(): string | null {
  const raw = process.env.PAPERCLIP_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || !url.host) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function companyConnectionResponse(connection: Awaited<ReturnType<ManagementDependencies["companyConnection"]["get"]>>) {
  return { ...connection, observedUrl: readObservedUrl() };
}

function parseCompanyConnectionUpdate(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Invalid company connection payload");
  const source = body as Record<string, unknown>;
  const aliases: Record<string, string> = {
    expected_revision: "expectedRevision",
    company_url: "companyUrl",
    access_method: "accessMethod",
  };
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const canonical = aliases[key] ?? key;
    if (normalized[canonical] !== undefined) throw badRequest("Duplicate company connection field");
    normalized[canonical] = value;
  }
  const allowed = new Set(["expectedRevision", "companyUrl", "accessMethod", "provider", "instructions"]);
  if (Object.keys(normalized).some(key => !allowed.has(key))) throw badRequest("Unknown company connection field");
  if (!Number.isInteger(normalized.expectedRevision) || (normalized.expectedRevision as number) < 0) {
    throw badRequest("expectedRevision must be a non-negative integer");
  }
  if (typeof normalized.accessMethod !== "string" || !accessMethods.includes(normalized.accessMethod as MorbitAccessMethod)) {
    throw badRequest("Invalid accessMethod");
  }
  if (typeof normalized.provider !== "string" || !providers.includes(normalized.provider as MorbitProvider)) {
    throw badRequest("Invalid provider");
  }
  if (typeof normalized.instructions !== "string" || normalized.instructions.length > 4000) {
    throw badRequest("instructions must be at most 4000 characters");
  }
  const accessMethod = normalized.accessMethod as MorbitAccessMethod;
  const provider = normalized.provider as MorbitProvider;
  const compatible = accessMethod === "direct"
    ? provider === "none"
    : accessMethod === "vpn"
      ? ["tailscale", "wireguard", "openvpn", "other"].includes(provider)
      : ["cloudflare", "other"].includes(provider);
  if (!compatible) throw badRequest("provider is incompatible with accessMethod");
  return {
    expectedRevision: normalized.expectedRevision as number,
    companyUrl: readCompanyUrl(normalized.companyUrl),
    accessMethod,
    provider,
    instructions: normalized.instructions,
  };
}

function assertCompanyConnectionMutationOrigin(req: Request) {
  if (req.actor.source === "local_implicit") return;
  const origin = req.header("origin")?.trim().toLowerCase();
  if (!origin || trustedBoardMutationOrigin(req) !== origin) {
    throw forbidden("Company connection mutation requires trusted browser origin");
  }
}

/** The adapter reuses host identity; it cannot accept browser-selected scopes or upstreams. */
export function morbitManagementRoutes(deps: ManagementDependencies) {
  const router = Router();
  const root = "/companies/:companyId/morbit";

  const consoleProxy = async (req: Request, res: express.Response) => {
    assertAuthenticated(req);
    assertBoard(req);
    assertInstanceAdmin(req);
    if (!deps.consoleProxy) throw notFound("Native OCX console is not configured");

    const rawCredential = req.header("x-opencodex-api-key")?.trim();
    if (req.header("authorization") || req.header("x-opencodex-admin-bridge")
      || req.header("x-opencodex-bridge-origin") || req.header("x-opencodex-trusted-proxy")) {
      throw forbidden("Browser upstream credentials are not accepted");
    }
    if (rawCredential?.startsWith("ocx_admin_")) throw forbidden("Browser admin credentials are not accepted");

    const mountedPath = `${req.baseUrl}${req.path}`;
    const prefix = "/api/morbit/base/console";
    const path = mountedPath.slice(mountedPath.indexOf(prefix) + prefix.length) || "/";
    const bridge = path === "/opencodex-session" || (path === "/" && !rawCredential);
    if (!bridge && requiresNativeConsoleSession(path) && !rawCredential) throw forbidden("Native console session is required");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      const origin = req.header("origin")?.trim().toLowerCase();
      if (!origin || trustedBoardMutationOrigin(req) !== origin) {
        throw forbidden("Native console mutation requires trusted browser origin");
      }
      if (!req.header("x-opencodex-csrf-token")) throw forbidden("Native console mutation requires CSRF token");
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const body = req.body === undefined || req.body === null || req.body === ""
      ? (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase()) ? undefined : req as unknown as AsyncIterable<Uint8Array>)
      : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const input: MorbitConsoleProxyRequest = { method: req.method, path: `${path}${new URL(req.originalUrl, "http://mdeck.invalid").search}`, headers, body, bridge };
    const upstream = await deps.consoleProxy.forward(input);
    const responseHeaders = new Headers();
    for (const [name, value] of upstream.headers) {
      if (["set-cookie", "content-length", "content-encoding", "connection", "transfer-encoding", "upgrade", "sec-websocket-accept", "sec-websocket-protocol", "authorization",
        "www-authenticate", "x-opencodex-api-key", "x-opencodex-admin-key", "x-opencodex-admin-bridge",
        "x-opencodex-bridge-origin", "x-opencodex-trusted-proxy"].includes(name.toLowerCase())) continue;
      responseHeaders.set(name, value);
    }
    const csp = responseHeaders.get("content-security-policy");
    if (csp?.toLowerCase().includes("frame-ancestors")) {
      responseHeaders.set("Content-Security-Policy", preserveCspWithSelfFrameAncestor(csp));
    }
    responseHeaders.delete("x-frame-options");
    res.status(upstream.status);
    responseHeaders.forEach((value, name) => res.setHeader(name, value));
    if (req.method === "HEAD" || upstream.status === 204) { res.end(); return; }
    if (!upstream.body) { res.end(); return; }
    const { Readable } = await import("node:stream");
    const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    res.once("close", () => {
      if (!res.writableFinished) void upstream.body?.cancel().catch(() => {});
    });
    stream.on("error", () => { if (!res.headersSent) res.status(502); res.end(); });
    stream.pipe(res);
  };

  router.use(morbitBaseNativeRoutes(deps));
  router.use("/morbit/base/console", consoleProxy);

  router.get("/morbit/company-connection", async (req, res) => {
    assertAuthenticated(req);
    assertInstanceAdmin(req);
    reply(res, companyConnectionResponse(await deps.companyConnection.get()));
  });

  router.put("/morbit/company-connection", async (req, res) => {
    assertAuthenticated(req);
    assertInstanceAdmin(req);
    assertCompanyConnectionMutationOrigin(req);
    try {
      const actor = getActorInfo(req);
      const updated = await deps.companyConnection.update(parseCompanyConnectionUpdate(req.body), {
        actorType: actor.actorType, actorId: actor.actorId, actorSource: actor.actorSource,
      });
      const auditCompanyId = req.actor.companyIds?.[0] ?? req.actor.memberships?.[0]?.companyId;
      if (auditCompanyId) {
        try {
          await deps.audit(req, auditCompanyId, "morbit.company_connection_updated", {
            revision: updated.revision, accessMethod: updated.accessMethod, provider: updated.provider,
          });
        } catch (error) {
          logger.warn({ err: error, revision: updated.revision }, "Morbit company connection secondary activity audit failed after durable save");
        }
      } else {
        logger.warn({ actorId: actor.actorId, revision: updated.revision }, "Morbit company connection secondary activity audit skipped because the actor has no company scope");
      }
      reply(res, companyConnectionResponse(updated));
    } catch (error) {
      if (error instanceof MorbitCompanyConnectionRevisionConflict) {
        throw conflict(error.message, { expectedRevision: error.expectedRevision, actualRevision: error.actualRevision });
      }
      throw error;
    }
  });

  const scope = (req: Request, requireManager = false) => managementScope(deps, req, String(req.params.companyId), requireManager);

  router.get("/morbit/base/settings", (req, res) => {
    res.set("Cache-Control", "no-store");
    assertAuthenticated(req);
    assertBoard(req);
    assertInstanceAdmin(req);
    if (Object.keys(req.query).length > 0) throw badRequest("Destination parameters are not supported");
    const entry = deps.nativeEntry?.();
    if (!entry) throw notFound("Native OCX management is not configured");
    res.redirect(302, entry.url);
  });

  router.get("/morbit/workspaces", async (req, res) => {
    const workspaces = await managementWorkspaces(deps, req);
    // Instance authority permits service status, never another workspace's data.
    const instance = req.actor.isInstanceAdmin === true || req.actor.source === "local_implicit";
    const model = instance ? await deps.modelStatus() : undefined;
    const nativeEntry = instance ? deps.nativeEntry?.() : null;
    const settingsUrl = instance ? nativeSettingsUrl(deps) : null;
    reply(res, { workspaces, ...(model ? {instance:{can_manage_instance:true,
      base:{state:model.state,...(model.version?{version:model.version}:{}),...(model.model?{model:model.model}:{}),
        ...(settingsUrl ? { settings_url: settingsUrl, ...(nativeEntry?.localOnly ? { settings_local_only: true } : {}) } : {})},
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
    const nativeEntry = s.instance ? deps.nativeEntry?.() : null;
    const settingsUrl = s.instance ? nativeSettingsUrl(deps) : null;
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
        ...(wiki ? { wiki: `${prefix}/wiki` } : {}),
        ...(s.instance ? { instance: `${prefix}/company/settings/instance/access`,
          plugins: `${prefix}/company/settings/instance/plugins` } : {}),
      },
      brain: { state: !wiki || wiki.status === "uninstalled" ? "dependency_missing" : wiki.status === "ready" ? "unverified" : "degraded",
        ...(wiki ? { version: wiki.version } : {}) },
      base: { state: base.state, ...("model" in base ? { model: base.model } : {}),
        ...("version" in base ? { version: base.version } : {}),
        ...("checkedAt" in base ? { checked_at: base.checkedAt } : {}),
        ...(settingsUrl ? { settings_url: settingsUrl, ...(nativeEntry?.localOnly ? { settings_local_only: true } : {}) } : {}) },
      identity: { local: "configured", ldap: "unconfigured" },
    });
  });

  router.post(`${root}/base/test`, async (req, res) => {
    const s = await scope(req, true);
    assertInstanceAdmin(req);
    if (!z.object({}).strict().safeParse(req.body).success) throw badRequest("This test accepts no upstream URL or credentials");
    const result = await deps.modelTest();
    await deps.audit(req, s.company.id, "morbit.model_tested", { model: result.model, results: result.results });
    reply(res, { model: result.model, text: result.text, checked_at: result.checkedAt, results: result.results });
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
    const folderWorkspace = req.path.match(/^\/companies\/([^/]+)\/local-folders\/[^/]+(?:\/validate)?\/?$/i)?.[1];
    const isMutation = action !== undefined || path.startsWith("/api/") || folderWorkspace !== undefined;
    if (!isMutation || action === "start-query") return next();
    const key = String(req.params.pluginId);
    const wiki = await deps.wiki();
    if (key !== "paperclipai.plugin-llm-wiki" && key !== wiki?.id) return next();
    assertAuthenticated(req);
    // Agent execution retains the existing tool/host authorization boundary.
    if (req.actor.type === "agent") return next();
    const companyId = folderWorkspace ?? req.body?.companyId ?? req.body?.params?.companyId ?? req.query.companyId;
    if (typeof companyId !== "string") throw badRequest("Explicit Wiki workspace required");
    await managementScope(deps, req, companyId, true);
    next();
  });
  return router;
}
