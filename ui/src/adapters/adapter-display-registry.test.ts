import { describe, expect, it } from "vitest";

import { getAdapterDisplay, getAdapterLabel, getAdapterLabels, getAgentExecutionLabel } from "./adapter-display-registry";

describe("adapter display registry", () => {
  it("uses user-facing labels without the legacy local qualifier for built-in adapters", () => {
    expect(getAdapterLabel("codex_local")).toBe("Codex");
    expect(getAdapterLabel("claude_local")).toBe("Claude Code");
    expect(getAdapterLabel("acpx_local")).toBe("ACPX (retired)");
    expect(getAdapterLabel("cursor")).toBe("Cursor");
    expect(getAdapterLabel("gemini_local")).toBe("Gemini CLI");
    expect(getAdapterLabel("grok_local")).toBe("Grok Build");
    expect(getAdapterLabel("kimi_local")).toBe("Kimi Code");
    expect(getAdapterLabel("hermes_local")).toBe("Hermes");
    expect(getAdapterLabel("hermes_gateway")).toBe("Hermes Gateway");
    expect(getAdapterLabel("opencode_local")).toBe("OpenCode");
    expect(getAdapterLabel("pi_local")).toBe("Pi");

    expect(getAdapterLabels()).toMatchObject({
      codex_local: "Codex",
      claude_local: "Claude Code",
      acpx_local: "ACPX (retired)",
      cursor: "Cursor",
      gemini_local: "Gemini CLI",
      grok_local: "Grok Build",
      kimi_local: "Kimi Code",
      hermes_local: "Hermes",
      hermes_gateway: "Hermes Gateway",
      opencode_local: "OpenCode",
      pi_local: "Pi",
    });
  });

  it("drops local suffixes for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_local")).toBe("Droid");
    expect(getAdapterDisplay("droid_local")).toMatchObject({
      label: "Droid",
      description: "External adapter",
    });
  });

  it("keeps a gateway suffix for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_gateway")).toBe("Droid (gateway)");
    expect(getAdapterDisplay("droid_gateway")).toMatchObject({
      label: "Droid (gateway)",
      description: "External gateway adapter",
    });
  });
});


describe("configured API connection labels", () => {
  const agent = (env: Record<string, unknown> = {}, adapterType = "codex_local") => ({
    adapterType, adapterConfig: { model: "gpt-6.1-sol", env },
  });
  it.each([
    "never-display-this-key",
    { type: "plain", value: "never-display-this-key" },
    { type: "secret_ref", secretId: "private-secret-id" },
    { type: "user_secret_ref", key: "private-user-secret" },
  ])("identifies an OCX binding without exposing its contents", (binding) => {
    expect(getAgentExecutionLabel(agent({ OCX_API_KEY: binding }))).toBe("OCX API · Codex CLI");
  });
  it.each([undefined, null, "", "  ", [], {}, { type: "plain", value: "" }, { type: "secret_ref" }])(
    "does not infer an API connection from absent or invalid bindings", (binding) => {
      expect(getAgentExecutionLabel(agent({ OCX_API_KEY: binding }))).toBe("Codex CLI");
    },
  );
  it("keeps API authentication separate from the harness and model name", () => {
    expect(getAgentExecutionLabel(agent({ OPENAI_API_KEY: "private" }))).toBe("API key · Codex CLI");
    expect(getAgentExecutionLabel(agent())).toBe("Codex CLI");
    expect(getAgentExecutionLabel(agent({ OCX_API_KEY: "private" }, "claude_local"))).toBe("Claude Code");
  });
});
