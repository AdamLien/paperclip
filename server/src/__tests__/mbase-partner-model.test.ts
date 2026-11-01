import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMbasePartnerModelService, MbaseModelUnavailable } from "../services/mbase-partner-model.js";
import { resolveExecutionRunAdapterConfig } from "../services/heartbeat.ts";

const TOKEN = "ocx-client-token-test";

function fakeOcx(ids: string[]) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("http://ocx.internal:8080/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("mBase partner models", () => {
  let dir = "";
  let tokenFile = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "mbase-partner-model-"));
    tokenFile = path.join(dir, "ocx-token");
    await writeFile(tokenFile, `${TOKEN}\n`);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function service(ids = ["anthropic/claude-haiku-4-5", "gpt-6.1-sol", "anthropic/claude-sonnet-5-5"]) {
    return createMbasePartnerModelService({ endpoint: "http://ocx.internal:8080/v1", tokenFile, fetcher: fakeOcx(ids) });
  }

  it("offers only the Anthropic models mBase routes", async () => {
    expect(await service().listModels()).toEqual(["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-5-5"]);
  });

  it("projects mBase access for one Claude run and blanks other credentials", async () => {
    const projection = await service().runtimeProjection({ adapterType: "claude_local", model: "anthropic/claude-sonnet-5-5" });
    expect(projection.secretKeys).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(projection.model).toBe("anthropic/claude-sonnet-5-5");
    expect(projection.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://ocx.internal:8080",
      ANTHROPIC_AUTH_TOKEN: TOKEN,
      ANTHROPIC_MODEL: "anthropic/claude-sonnet-5-5",
      ANTHROPIC_SMALL_FAST_MODEL: "anthropic/claude-sonnet-5-5",
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      CLAUDE_CODE_USE_BEDROCK: "",
    });
  });

  it("refuses a model mBase no longer offers, an unsupported partner type, or a missing setup", async () => {
    await expect(service().runtimeProjection({ adapterType: "claude_local", model: "anthropic/claude-opus-1" }))
      .rejects.toBeInstanceOf(MbaseModelUnavailable);
    await expect(service().runtimeProjection({ adapterType: "codex_local", model: "anthropic/claude-haiku-4-5" }))
      .rejects.toBeInstanceOf(MbaseModelUnavailable);
    const unconfigured = createMbasePartnerModelService({ endpoint: "", tokenFile: "" });
    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.listModels()).rejects.toBeInstanceOf(MbaseModelUnavailable);
  });

  it("reports an unreachable mBase without leaking the token", async () => {
    const failing = createMbasePartnerModelService({
      endpoint: "http://ocx.internal:8080/v1", tokenFile,
      fetcher: vi.fn(async () => new Response("nope", { status: 502 })) as unknown as typeof fetch,
    });
    const error = await failing.listModels().catch((err: unknown) => err as Error);
    expect(error).toBeInstanceOf(MbaseModelUnavailable);
    expect(error.message).not.toContain(TOKEN);
  });

  it("lets the mBase projection win over a partner's own routing and marks the token secret", async () => {
    const projection = await service().runtimeProjection({ adapterType: "claude_local", model: "anthropic/claude-haiku-4-5" });
    const result = await resolveExecutionRunAdapterConfig({
      companyId: "company-1", agentId: "agent-1",
      executionRunConfig: { env: { ANTHROPIC_BASE_URL: "https://elsewhere.example", ANTHROPIC_API_KEY: "partner-key", KEEP: "yes" } },
      projectEnv: { ANTHROPIC_AUTH_TOKEN: "project-token" },
      trustedEnvProjection: projection.env,
      trustedEnvSecretKeys: projection.secretKeys,
      secretsSvc: {
        collectMissingRuntimeBindings: vi.fn(async () => []),
        resolveAdapterConfigForRuntime: vi.fn(async (_companyId, config) => ({ config, secretKeys: new Set(), manifest: [] })),
        resolveEnvBindings: vi.fn(async (_companyId, env) => ({ env, secretKeys: new Set(), manifest: [] })),
      } as any,
    });
    expect(result.resolvedConfig.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://ocx.internal:8080",
      ANTHROPIC_AUTH_TOKEN: TOKEN,
      ANTHROPIC_API_KEY: "",
      KEEP: "yes",
    });
    expect(result.secretKeys.has("ANTHROPIC_AUTH_TOKEN")).toBe(true);
  });
});
