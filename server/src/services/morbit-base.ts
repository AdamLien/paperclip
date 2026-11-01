import { HttpError } from "../errors.js";
import type { ModelObservation, ModelTestResult } from "../routes/morbit-management.js";

class AuthorizationRequired extends Error {}

/** OCX keeps provider authentication/refresh. Only an operator-owned UAT endpoint is accepted. */
export function createMorbitModelAdapter(options: {
  endpoint?: string;
  model?: string;
  /** Anthropic models OCX routes; one is tested through the Messages API AI partners use. */
  listAnthropicModels?: () => Promise<string[]>;
  readToken?: () => Promise<string>;
  readAdminToken?: () => Promise<string>;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  let observation: ModelObservation = { state: "unverified" };
  let verifiedAt = 0;
  const configured = Boolean(options.endpoint && (options.model || options.listAnthropicModels)
    && options.readToken && options.readAdminToken);

  async function ask(url: string, init: { headers: Record<string, string>; body: unknown }) {
    const response = await fetcher(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", ...init.headers }, body: JSON.stringify(init.body),
    });
    if (response.status === 401 || response.status === 403) throw new AuthorizationRequired();
    if (!response.ok) throw new Error();
    return response.json();
  }

  return {
    async status(): Promise<ModelObservation> {
      if (!configured) return { state: "unconfigured" };
      // Old evidence is no longer proof of readiness, but the last success stays visible.
      if (observation.state === "ready" && now() - verifiedAt > 300_000) return { ...observation, state: "unverified" };
      return { ...observation };
    },
    async test(): Promise<ModelTestResult> {
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
        const apiBase = endpoint.href.endsWith("/") ? endpoint : `${endpoint.href}/`;
        // OCX management and model admission use independent credentials. A generic
        // OpenAI-compatible response is not evidence of a working OCX installation.
        const health = await fetcher(new URL("/api/system/health", endpoint).href, {
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

        const prompt = [{ role: "user", content: "Reply with only OK. This is a connection test." }];
        // Every service OCX makes available is tested, so a selected Anthropic account is
        // proven by a Claude model rather than hidden behind the configured default model.
        const targets: Array<{ model: string; run: () => Promise<boolean> }> = [];
        if (options.model) {
          targets.push({ model: options.model, run: async () => {
            const body = await ask(new URL("chat/completions", apiBase).href, {
              headers: { Authorization: `Bearer ${token}` },
              body: { model: options.model, messages: prompt, max_tokens: 32, stream: false },
            }) as { choices?: Array<{ message?: { content?: unknown } }> };
            const text = body.choices?.[0]?.message?.content;
            return typeof text === "string" && Boolean(text.trim());
          } });
        }
        if (options.listAnthropicModels) {
          const claude = await options.listAnthropicModels().then(models => models[0] ?? null, () => undefined);
          // An unreadable model list is a failed Anthropic check; an empty one means no Anthropic service.
          if (claude === undefined) targets.push({ model: "anthropic", run: async () => false });
          else if (claude && claude !== options.model) {
            targets.push({ model: claude, run: async () => {
              const body = await ask(new URL("messages", apiBase).href, {
                headers: { Authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" },
                body: { model: claude, messages: prompt, max_tokens: 32 },
              }) as { content?: Array<{ type?: unknown; text?: unknown }> };
              return body.content?.some(part => part.type === "text" && typeof part.text === "string" && part.text.trim()) ?? false;
            } });
          }
        }
        const outcomes = await Promise.all(targets.map(target => target.run().catch((error: unknown) =>
          error instanceof AuthorizationRequired ? "authorization_required" as const : false)));
        const results = targets.map((target, index) => ({ model: target.model, ok: outcomes[index] === true }));
        const responding = results.filter(result => result.ok).map(result => result.model);
        if (responding.length === 0) {
          if (outcomes.includes("authorization_required")) {
            observation = { state: "authorization_required" };
            throw new HttpError(503, "Model authorization required");
          }
          throw new Error();
        }
        verifiedAt = now();
        const checkedAt = new Date(verifiedAt).toISOString();
        const model = responding.join(", ");
        const failed = results.filter(result => !result.ok).map(result => result.model);
        observation = { state: "ready", model, version: identity.version, checkedAt };
        // Return the fixed test outcome, never an upstream body that could echo configuration.
        return { model, results, checkedAt,
          text: failed.length ? `Model returned a non-empty response; no response from ${failed.join(", ")}` : "Model returned a non-empty response" };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        observation = { state: "degraded" };
        throw new HttpError(502, "Model test failed");
      }
    },
  };
}
