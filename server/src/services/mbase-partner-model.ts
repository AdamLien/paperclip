import { readFile } from "node:fs/promises";
import { HttpError } from "../errors.js";

/** Adapters that speak the Anthropic Messages API OCX exposes. */
export const MBASE_PARTNER_ADAPTERS = ["claude_local"] as const;

// Claude Code reaches for its default model names for side tasks; pin them all to
// the chosen mBase model so no request asks OCX for a name it does not route.
const MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
] as const;

// Blank values override inherited credentials and routing in the CLI child.
const BLANKED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export class MbaseModelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MbaseModelUnavailable";
  }
}

export function isMbasePartnerAdapter(adapterType: string | null | undefined) {
  return (MBASE_PARTNER_ADAPTERS as readonly string[]).includes(adapterType ?? "");
}

/**
 * Lets AI partners run on the instance's mBase (OCX) models. The OCX client
 * token stays in the server's token file: it is read when a run starts and
 * projected into that run only, never stored with the agent.
 */
export function createMbasePartnerModelService(options: {
  endpoint?: string;
  tokenFile?: string;
  fetcher?: typeof fetch;
  now?: () => number;
} = {}) {
  const endpoint = options.endpoint ?? process.env.MORBIT_UAT_OCX_URL;
  const tokenFile = options.tokenFile ?? process.env.MORBIT_UAT_OCX_TOKEN_FILE;
  const now = options.now ?? Date.now;
  let cached: { at: number; models: string[] } | null = null;

  async function readToken() {
    const token = (await readFile(tokenFile!, "utf8")).trim();
    if (!token || /[\r\n]/.test(token)) throw new MbaseModelUnavailable("mBase is not authorized on this instance");
    return token;
  }

  function apiBase() {
    const url = new URL(endpoint!);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new MbaseModelUnavailable("mBase is not configured on this instance");
    }
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  }

  const service = {
    configured: Boolean(endpoint && tokenFile),

    /** Anthropic models mBase currently routes; cached briefly to keep run starts cheap. */
    async listModels(): Promise<string[]> {
      if (!service.configured) throw new MbaseModelUnavailable("mBase is not configured on this instance");
      if (cached && now() - cached.at < 60_000) return cached.models;
      const response = await (options.fetcher ?? fetch)(new URL("models", apiBase()).href, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${await readToken()}` },
      }).catch(() => null);
      if (!response?.ok) throw new MbaseModelUnavailable("mBase did not return its model list");
      const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
      const models = (body?.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => typeof id === "string" && id.startsWith("anthropic/"))
        .sort();
      cached = { at: now(), models };
      return models;
    },

    /** Environment for one run. Throws MbaseModelUnavailable when the run must not start. */
    async runtimeProjection(input: { adapterType: string; model: string }) {
      if (!isMbasePartnerAdapter(input.adapterType)) {
        throw new MbaseModelUnavailable("This partner type cannot use mBase models yet");
      }
      const models = await service.listModels();
      if (!models.includes(input.model)) {
        throw new MbaseModelUnavailable(`mBase no longer offers ${input.model}`);
      }
      // Claude Code appends /v1/messages itself, so hand it the origin above /v1.
      const base = new URL(apiBase());
      base.pathname = base.pathname.replace(/\/v1\/?$/, "/");
      const env: Record<string, string> = {
        ANTHROPIC_BASE_URL: base.href.replace(/\/$/, ""),
        ANTHROPIC_AUTH_TOKEN: await readToken(),
      };
      for (const key of MODEL_ENV_KEYS) env[key] = input.model;
      for (const key of BLANKED_ENV_KEYS) env[key] = "";
      return { env, secretKeys: ["ANTHROPIC_AUTH_TOKEN"], model: input.model };
    },
  };
  return service;
}

export function mbaseUnavailableHttpError(error: unknown) {
  if (error instanceof MbaseModelUnavailable) return new HttpError(422, error.message, { code: "mbase_model_unavailable" });
  return error;
}
