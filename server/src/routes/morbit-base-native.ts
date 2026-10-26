import express, { Router, type Request } from "express";
import { assertAuthenticated, assertBoard, assertInstanceAdmin } from "./authz.js";
import { forbidden, notFound, badRequest, HttpError } from "../errors.js";
import { trustedBoardMutationOrigin } from "../middleware/board-mutation-guard.js";
import { logger } from "../middleware/logger.js";
import type { ManagementDependencies } from "./morbit-management.js";
import {
  nativeForwardRequest,
  nativePathFromRequest,
  nativeRouteFor,
  projectNativeLogsPayload,
  projectNativeUsagePayload,
  safeNativeErrorPayload,
  sanitizeProviderPayload,
} from "../services/morbit-base-native.js";

function safeHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    if (["set-cookie", "content-length", "content-encoding", "connection", "transfer-encoding", "authorization", "www-authenticate", "x-opencodex-api-key", "x-opencodex-admin-key"].includes(name.toLowerCase())) continue;
    headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  return headers;
}

async function writeUpstreamResponse(req: Request, res: express.Response, upstream: Response, path: string) {
  if (!upstream.ok) {
    let payload: Record<string, string> = { error: "native_management_upstream_failed" };
    try {
      payload = safeNativeErrorPayload(await upstream.clone().json());
    } catch { /* use the generic safe error */ }
    const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
    res.status(status).set("Cache-Control", "no-store").json(payload);
    return;
  }
  const headers = safeHeaders(upstream);
  let body: Uint8Array | undefined;
  if (req.method !== "HEAD" && upstream.status !== 204 && upstream.body) {
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if ((upstream.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        const projected = path === "/api/logs"
          ? projectNativeLogsPayload(parsed)
          : path === "/api/usage" ? projectNativeUsagePayload(parsed) : sanitizeProviderPayload(parsed);
        if (projected === null) {
          res.status(502).set("Cache-Control", "no-store").json({ error: "Invalid native management response" });
          return;
        }
        body = new TextEncoder().encode(JSON.stringify(projected));
        headers.delete("content-length");
        headers.set("content-type", "application/json");
      } catch {
        res.status(502).set("Cache-Control", "no-store").json({ error: "Invalid native management response" });
        return;
      }
    } else body = bytes;
  }
  res.status(upstream.status);
  headers.forEach((value, name) => res.setHeader(name, value));
  if (!body || req.method === "HEAD" || upstream.status === 204) { res.end(); return; }
  res.end(Buffer.from(body));
}

export function morbitBaseNativeRoutes(deps: ManagementDependencies) {
  const router = Router();
  const auditCompanyIds = async (req: Request): Promise<string[]> => {
    const owned = req.actor.companyIds ?? [];
    if (owned.length > 0) return owned;
    const companies = await deps.companies();
    return companies.map(company => company.id);
  };
  router.use(async (req, res, next) => {
    const rawPath = req.originalUrl.split("?", 1)[0];
    const routePrefix = "/api/morbit/base/native/api/";
    if (!rawPath.startsWith(routePrefix)) {
      next();
      return;
    }
    res.set("Cache-Control", "no-store");
    assertAuthenticated(req);
    assertBoard(req);
    assertInstanceAdmin(req);
    if (!deps.consoleProxy) throw notFound("Native OCX console is not configured");

    const native = nativePathFromRequest(req);
    const forbiddenHeaders = [
      "authorization", "x-opencodex-api-key", "x-opencodex-admin-key", "x-opencodex-admin-bridge",
      "x-opencodex-bridge-origin", "x-opencodex-trusted-proxy",
    ];
    if (forbiddenHeaders.some(name => req.header(name) !== undefined)) throw forbidden("Browser upstream credentials are not accepted");
    if (!native || !nativeRouteFor(native.path, req.method, native.search)) throw badRequest("Unsupported native management operation");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.header("origin")?.trim().toLowerCase();
      if (!origin || trustedBoardMutationOrigin(req) !== origin) throw forbidden("Native management mutation requires trusted browser origin");
      if (!(req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) throw badRequest("Native management mutations require application/json");
    }
    const auditIds = req.method !== "GET" && req.method !== "HEAD" ? await auditCompanyIds(req) : [];
    if (req.method !== "GET" && req.method !== "HEAD" && auditIds.length === 0) {
      throw forbidden("Native management mutation requires auditable company context");
    }

    let upstream: Response;
    try {
      upstream = await nativeForwardRequest(deps.consoleProxy, req, native.path, native.search);
    } catch {
      throw new HttpError(502, "Native management upstream unavailable");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      const details = { scope: "instance", method: req.method, path: native.path, status: upstream.status };
      try {
        await Promise.all(auditIds.map(companyId => deps.audit(req, companyId, "morbit.base_native_mutation", details)));
      } catch {
        logger.error({ action: "morbit.base_native_mutation", method: req.method, path: native.path, status: upstream.status }, "Native management audit failed");
        res.status(502).json({ error: "Native management audit unavailable" });
        return;
      }
    }
    await writeUpstreamResponse(req, res, upstream, native.path);
  });
  return router;
}
