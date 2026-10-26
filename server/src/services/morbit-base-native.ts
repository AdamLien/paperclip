import type { Request } from "express";
import type { MorbitConsoleProxy } from "./morbit-native-entry.js";

export const MORBIT_BASE_NATIVE_PREFIX = "/api/morbit/base/native";

type NativeRoute = {
  methods: ReadonlySet<string>;
  queryByMethod: ReadonlyMap<string, ReadonlySet<string>>;
};

const noQuery = new Set<string>();
const query = (...keys: string[]) => new Set(keys);
const route = (methods: string[], queryByMethod: Record<string, ReadonlySet<string>> = {}) => ({
  methods: new Set(methods),
  queryByMethod: new Map(Object.entries(queryByMethod)),
});
const routes: ReadonlyMap<string, NativeRoute> = new Map([
  ["/api/providers", route(["GET", "POST", "PATCH", "PUT", "DELETE"], { GET: query("name"), PATCH: query("name"), DELETE: query("name") })],
  ["/api/providers/test", route(["POST"], { POST: query("name") })],
  ["/api/providers/test-completion", route(["POST"], { POST: query("name") })],
  ["/api/providers/keys", route(["GET", "POST", "DELETE"], {
    GET: query("name", "quota", "refresh"),
    DELETE: query("name", "id"),
  })],
  ["/api/providers/keys/pause", route(["PUT"])],
  ["/api/providers/keys/active", route(["PUT"])],
  ["/api/providers/keys/alias", route(["PUT"])],
  ["/api/oauth/providers", route(["GET"])],
  ["/api/oauth/status", route(["GET"], { GET: query("provider", "flowId") })],
  ["/api/oauth/login", route(["POST"])],
  ["/api/oauth/login/cancel", route(["POST"])],
  ["/api/oauth/login/code", route(["POST"])],
  ["/api/oauth/logout", route(["POST"], { POST: query("provider") })],
  ["/api/oauth/accounts", route(["GET", "DELETE"], { GET: query("provider", "quota", "refresh"), DELETE: query("provider", "id") })],
  ["/api/oauth/accounts/active", route(["PUT"])],
  ["/api/oauth/accounts/alias", route(["PUT"])],
  ["/api/oauth/accounts/pause", route(["PUT"])],
  ["/api/oauth/accounts/auto-switch", route(["PUT"])],
  ["/api/oauth/accounts/pool", route(["GET", "PUT", "PATCH"], { GET: query("provider") })],
  ["/api/pool/settings", route(["GET", "PUT", "PATCH"], { GET: query("provider") })],
  ["/api/codex-auth/accounts", route(["GET", "DELETE"], { GET: query("refresh"), DELETE: query("id") })],
  ["/api/codex-auth/accounts/refresh", route(["POST"])],
  ["/api/codex-auth/accounts/alias", route(["PUT"])],
  ["/api/codex-auth/accounts/pause", route(["PUT"])],
  ["/api/codex-auth/accounts/pause-exhausted", route(["PUT"])],
  ["/api/codex-auth/accounts/credits", route(["PUT"])],
  ["/api/codex-auth/accounts/priority", route(["PUT"])],
  ["/api/codex-auth/active", route(["GET", "PUT"])],
  ["/api/codex-auth/auto-switch", route(["PUT"])],
  ["/api/codex-auth/failover", route(["PUT"])],
  ["/api/codex-auth/pool-strategy", route(["PUT", "PATCH"])],
  ["/api/codex-auth/login", route(["POST"])],
  ["/api/codex-auth/login/cancel", route(["POST"])],
  ["/api/codex-auth/login/code", route(["POST"])],
  ["/api/codex-auth/login-status", route(["GET"], { GET: query("flowId", "accountId", "reauth") })],
]);

export function nativeRouteFor(path: string, method: string, search: string): NativeRoute | null {
  const route = routes.get(path);
  if (!route || !route.methods.has(method.toUpperCase())) return null;
  const params = new URLSearchParams(search);
  const seen = new Set<string>();
  const allowedQuery = route.queryByMethod.get(method.toUpperCase()) ?? noQuery;
  for (const key of params.keys()) {
    if (!allowedQuery.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  return route;
}

const SECRET_FIELD = /^(?:key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|secret|password|credential)$/i;
const SAFE_ERROR_CODE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function sanitizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProviderPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_FIELD.test(key) ? null : sanitizeProviderPayload(child),
  ]));
}

function safeErrorCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value) ? value : null;
}

export function safeNativeErrorPayload(value: unknown): Record<string, string> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error)
    ? record.error as Record<string, unknown> : null;
  const code = safeErrorCode(record.code) ?? safeErrorCode(nested?.code);
  const error = safeErrorCode(record.error) ?? safeErrorCode(nested?.type) ?? safeErrorCode(nested?.message);
  return {
    error: error ?? "native_management_upstream_failed",
    ...(code ? { code } : {}),
  };
}

export function nativePathFromRequest(req: Request): { path: string; search: string } | null {
  const url = new URL(req.originalUrl, "http://mdeck.invalid");
  const prefix = `${MORBIT_BASE_NATIVE_PREFIX}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const path = url.pathname.slice(MORBIT_BASE_NATIVE_PREFIX.length);
  if (!path.startsWith("/api/") || path.includes("\\") || /%(?:2f|5c|2e)/i.test(path)) return null;
  return { path, search: url.search };
}

export function nativeForwardRequest(
  proxy: MorbitConsoleProxy,
  req: Request,
  path: string,
  search: string,
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (req.method !== "GET" && req.method !== "HEAD") headers.set("content-type", "application/json");
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {});
  return proxy.forward({ method: req.method, path: `${path}${search}`, headers, body, bridge: true });
}

export const nativeRouteAllowlist = [...routes.keys()];
