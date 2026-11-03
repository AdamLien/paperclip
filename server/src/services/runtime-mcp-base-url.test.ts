import { describe, expect, it } from "vitest";
import { resolveRuntimeMcpBaseUrl } from "./runtime-mcp-base-url.js";

const env = {
  PAPERCLIP_API_URL: "https://crew.example.test/api/",
  PAPERCLIP_REMOTE_EXECUTION_API_URL: "http://server:3100/",
};

describe("resolveRuntimeMcpBaseUrl", () => {
  it("uses the remote execution origin for remote targets", () => {
    expect(resolveRuntimeMcpBaseUrl({ kind: "remote" }, env)).toBe("http://server:3100");
  });

  it("keeps the public API origin for local runs", () => {
    expect(resolveRuntimeMcpBaseUrl({ kind: "local" }, env)).toBe("https://crew.example.test");
    expect(resolveRuntimeMcpBaseUrl(null, env)).toBe("https://crew.example.test");
  });

  it("falls back to the public API origin when no remote origin is configured", () => {
    expect(resolveRuntimeMcpBaseUrl({ kind: "remote" }, { PAPERCLIP_API_URL: env.PAPERCLIP_API_URL })).toBe(
      "https://crew.example.test",
    );
    expect(resolveRuntimeMcpBaseUrl({ kind: "remote" }, { ...env, PAPERCLIP_REMOTE_EXECUTION_API_URL: "  " })).toBe(
      "https://crew.example.test",
    );
  });

  it("returns null when no API origin is configured", () => {
    expect(resolveRuntimeMcpBaseUrl({ kind: "remote" }, {})).toBeNull();
  });
});
