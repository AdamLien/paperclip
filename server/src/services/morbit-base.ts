import { HttpError } from "../errors.js";
import type { ModelObservation } from "../routes/morbit-management.js";

/** OCX keeps provider authentication/refresh. Only an operator-owned UAT endpoint is accepted. */
export function createMorbitModelAdapter(options: {
  endpoint?: string;
  model?: string;
  readToken?: () => Promise<string>;
  readAdminToken?: () => Promise<string>;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let observation: ModelObservation = { state: "unverified" };
  let verifiedAt = 0;
  const configured = Boolean(options.endpoint && options.model && options.readToken && options.readAdminToken);
  return {
    async status(): Promise<ModelObservation> {
      if (!configured) return { state: "unconfigured" };
      if (observation.state === "ready" && now() - verifiedAt > 300_000) return { state: "unverified" };
      return { ...observation };
    },
    async test() {
      if (!configured) throw new HttpError(503, "UAT model connection is not configured");
      let token: string;
      let adminToken: string;
      try {
        token = (await options.readToken!()).trim();
        adminToken = (await options.readAdminToken!()).trim();
        if (!token || !adminToken || /[\r\n]/.test(token + adminToken)) throw new Error();
      } catch {
        observation = { state: "authorization_required" };
        throw new HttpError(503, "Model authorization required");
      }
      try {
        const endpoint = new URL(options.endpoint!);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
        // OCX management and model admission use independent credentials. A generic
        // OpenAI-compatible response is not evidence of a working OCX installation.
        const health = await (options.fetcher ?? fetch)(new URL("/api/system/health", endpoint).href, {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (health.status === 401 || health.status === 403) {
          observation = { state: "authorization_required" };
          throw new HttpError(503, "Model authorization required");
        }
        if (!health.ok) throw new Error();
        const identity = await health.json() as { status?: unknown; service?: unknown; version?: unknown };
        if (identity.status !== "ok" || identity.service !== "opencodex" || typeof identity.version !== "string"
          || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(identity.version)) throw new Error();
        const response = await (options.fetcher ?? fetch)(new URL("chat/completions", endpoint.href.endsWith("/") ? endpoint : `${endpoint.href}/`).href, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: options.model, messages: [{ role: "user", content: "Reply with only OK. This is a connection test." }], max_tokens: 32, stream: false }),
        });
        if (response.status === 401 || response.status === 403) {
          observation = { state: "authorization_required" };
          throw new HttpError(503, "Model authorization required");
        }
        if (!response.ok) throw new Error();
        const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
        const text = body.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new Error();
        verifiedAt = now();
        const checkedAt = new Date(verifiedAt).toISOString();
        observation = { state: "ready", model: options.model!, version: identity.version, checkedAt };
        // Return the fixed test outcome, never an upstream body that could echo configuration.
        return { model: options.model!, text: "Model returned a non-empty response", checkedAt };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        observation = { state: "degraded" };
        throw new HttpError(502, "Model test failed");
      }
    },
  };
}
