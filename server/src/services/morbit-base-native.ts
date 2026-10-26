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
  ["/api/provider-presets", route(["GET"])],
  ["/api/usage", route(["GET"], { GET: query("range", "surface", "since", "until") })],
  ["/api/logs", route(["GET"], { GET: query("limit", "offset", "provider", "model", "status") })],
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
  if (!validateNativeQuery(path, params)) return null;
  return route;
}

const USAGE_RANGES = new Set(["today", "7d", "30d", "all"]);
const USAGE_SURFACES = new Set(["all", "codex", "claude", "grok"]);
const MAX_USAGE_TIMESTAMP = 8_640_000_000_000_000;
const MAX_LOG_PAGE_SIZE = 50;
const MAX_LOG_OFFSET = 2000;

function nonEmptyFilter(value: string | null): boolean {
  return value !== null && value.length > 0 && value.length <= 200 && !/[\u0000\r\n]/.test(value);
}

function epochMilliseconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_USAGE_TIMESTAMP ? parsed : null;
}

function validUsageQuery(params: URLSearchParams): boolean {
  const range = params.get("range");
  const surface = params.get("surface");
  if (range !== null && !USAGE_RANGES.has(range)) return false;
  if (surface !== null && !USAGE_SURFACES.has(surface)) return false;
  const since = params.get("since");
  const until = params.get("until");
  if ((since === null) !== (until === null)) return false;
  if (since !== null && until !== null) {
    const start = epochMilliseconds(since);
    const end = epochMilliseconds(until);
    if (start === null || end === null || start >= end) return false;
  }
  return true;
}

function validLogsQuery(params: URLSearchParams): boolean {
  for (const key of ["provider", "model"]) {
    const value = params.get(key);
    if (value !== null && !nonEmptyFilter(value)) return false;
  }
  const limit = params.get("limit");
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_LOG_PAGE_SIZE)) return false;
  const offset = params.get("offset");
  if (offset !== null && (!/^\d+$/.test(offset) || Number(offset) > MAX_LOG_OFFSET)) return false;
  const status = params.get("status");
  if (status !== null && !/^(?:[1-5]\d{2}|[1-5]xx)$/.test(status)) return false;
  return true;
}

function validateNativeQuery(path: string, params: URLSearchParams): boolean {
  if (path === "/api/usage") return validUsageQuery(params);
  if (path === "/api/logs") return validLogsQuery(params);
  return true;
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

const USAGE_FIELDS = ["range", "surface", "since", "customWindow", "until", "generatedAt", "summary", "days", "models", "providers"] as const;
const USAGE_TOTAL_FIELDS = [
  "requests", "attemptCount", "measuredRequests", "reportedRequests", "unreportedRequests", "unsupportedRequests",
  "estimatedRequests", "inputTokens", "outputTokens", "cachedInputTokens", "cacheReadInputTokens",
  "cacheCreationInputTokens", "reasoningOutputTokens", "totalTokens", "coverageRatio", "estimatedCostUsd",
  "pricedRequests", "unpricedRequests", "unmeteredRequests", "sends", "settledSends", "unresolvedSends",
  "spendRequests", "cacheObservedInputTokens", "cacheObservedRequests", "cacheSynthesizedRequests",
  "cacheUnknownRequests", "throughputOutputTokens", "throughputDurationMs", "throughputSamples",
  "throughputTokensPerSec",
] as const;
const USAGE_DAY_FIELDS = ["date", "requests", "measuredRequests", "reportedRequests", "totalTokens", "estimatedCostUsd", "models"] as const;
const USAGE_DAY_MODEL_FIELDS = [
  "model", "provider", "hasUnresolvedRequestedModel", "requests", "attemptCount", "totalTokens", "inputTokens",
  "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "cacheHitRate", "cacheObservedInputTokens",
  "estimatedCostUsd",
] as const;
const USAGE_MODEL_FIELDS = [
  "provider", "model", "hasUnresolvedRequestedModel", "resolvedModel", "requests", "attemptCount", "measuredRequests",
  "reportedRequests", "estimatedRequests", "totalTokens", "inputTokens", "outputTokens", "throughputTokensPerSec",
  "throughputSamples", "cachedInputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "cacheHitRate",
  "cacheObservedInputTokens", "priceCoverageRatio", "pricedRequests", "unpricedRequests", "shareRatio", "estimatedCostUsd",
] as const;
const USAGE_PROVIDER_FIELDS = [
  "provider", "requests", "attemptCount", "measuredRequests", "reportedRequests", "estimatedRequests", "totalTokens",
  "inputTokens", "outputTokens", "throughputTokensPerSec", "throughputSamples", "cachedInputTokens",
  "cacheReadInputTokens", "cacheCreationInputTokens", "cacheHitRate", "cacheObservedInputTokens", "priceCoverageRatio",
  "pricedRequests", "unpricedRequests", "shareRatio", "estimatedCostUsd",
] as const;
const USAGE_BOOLEAN_METADATA = ["usageIncomplete", "historyTruncated", "entriesTruncated"] as const;
const USAGE_COUNT_METADATA = ["truncatedPrefixBytes", "entriesDropped"] as const;
const USAGE_WINDOW_METADATA = ["snapshotWindowStart", "snapshotWindowEnd"] as const;

function closedUsageRecord(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(source, field)).map(field => [
    field,
    sanitizeProviderPayload(source[field]),
  ]));
}

function closedUsageRecords(value: unknown, fields: readonly string[]): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const records = value.map(item => closedUsageRecord(item, fields));
  return records.some(item => item === null) ? null : records as Record<string, unknown>[];
}

export function projectNativeUsagePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(source, "error")
    && !USAGE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(source, field))) return null;
  const projected: Record<string, unknown> = {};
  for (const field of USAGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    if (field === "summary") {
      const summary = closedUsageRecord(source[field], USAGE_TOTAL_FIELDS);
      if (summary === null) return null;
      projected[field] = summary;
    } else if (field === "days") {
      const days = closedUsageRecords(source[field], USAGE_DAY_FIELDS);
      if (days === null) return null;
      const projectedDays = days.map(day => {
        if (!Object.prototype.hasOwnProperty.call(day, "models")) return day;
        const models = closedUsageRecords(day.models, USAGE_DAY_MODEL_FIELDS);
        return models === null ? null : { ...day, models };
      });
      if (projectedDays.some(day => day === null)) return null;
      projected[field] = projectedDays;
    } else if (field === "models") {
      const models = closedUsageRecords(source[field], USAGE_MODEL_FIELDS);
      if (models === null) return null;
      projected[field] = models;
    } else if (field === "providers") {
      const providers = closedUsageRecords(source[field], USAGE_PROVIDER_FIELDS);
      if (providers === null) return null;
      projected[field] = providers;
    } else {
      projected[field] = sanitizeProviderPayload(source[field]);
    }
  }
  for (const field of USAGE_BOOLEAN_METADATA) {
    if (typeof source[field] === "boolean") projected[field] = source[field];
  }
  if (source.usageIncompleteReason === "oversized_rows") projected.usageIncompleteReason = source.usageIncompleteReason;
  for (const field of USAGE_COUNT_METADATA) {
    if (typeof source[field] === "number" && Number.isSafeInteger(source[field]) && source[field] >= 0) projected[field] = source[field];
  }
  for (const field of USAGE_WINDOW_METADATA) {
    if (source[field] === null || (typeof source[field] === "number" && Number.isFinite(source[field]))) projected[field] = source[field];
  }
  return projected;
}

const LOG_FIELDS = ["timestamp", "requestId", "provider", "model", "status", "durationMs", "usageStatus"] as const;

function projectNativeLog(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!LOG_FIELDS.every(field => Object.prototype.hasOwnProperty.call(source, field))) return null;
  if (typeof source.timestamp !== "number" || !Number.isFinite(source.timestamp)
    || typeof source.requestId !== "string" || typeof source.provider !== "string"
    || typeof source.model !== "string" || typeof source.status !== "number" || !Number.isFinite(source.status)
    || typeof source.durationMs !== "number" || !Number.isFinite(source.durationMs)
    || typeof source.usageStatus !== "string") return null;
  const projected = Object.fromEntries(LOG_FIELDS.map(field => [field, source[field]]));
  const usage = source.usage && typeof source.usage === "object" && !Array.isArray(source.usage)
    ? source.usage as Record<string, unknown> : undefined;
  const totalTokens = typeof source.totalTokens === "number" ? source.totalTokens : usage?.totalTokens;
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens >= 0) projected.totalTokens = totalTokens;
  return projected;
}

export function projectNativeLogsPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.timeZone !== "string" || typeof source.generatedAt !== "number" || !Number.isFinite(source.generatedAt)
    || typeof source.total !== "number" || !Number.isSafeInteger(source.total) || source.total < 0
    || !Array.isArray(source.logs)) return null;
  const logs = source.logs.map(projectNativeLog);
  if (logs.some(log => log === null)) return null;
  return { timeZone: source.timeZone, generatedAt: source.generatedAt, total: source.total, logs };
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
