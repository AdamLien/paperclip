import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ToolGatewayService } from "../services/tool-gateway.js";
import { mcpGatewayProtocolRoutes, mcpToolCallResult } from "../routes/tool-gateway.js";

function appReturning(result: unknown) {
  const gateway = { executeTool: async () => ({ result }) } as unknown as ToolGatewayService;
  return express().use(express.json()).use(mcpGatewayProtocolRoutes(gateway));
}

function callTool(app: express.Express) {
  return request(app).post("/mcp/gateways/gw_test")
    .set("Authorization", "Bearer run-token")
    .send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "paperclipai.plugin-llm-wiki:wiki_read_source", arguments: {} } });
}

describe("MCP tools/call results", () => {
  it("unwraps a plugin tool result and sends only its text, so clients do not swap it for side metadata", async () => {
    const response = await callTool(appReturning({
      pluginId: "paperclipai.plugin-llm-wiki",
      toolName: "wiki_read_source",
      result: {
        content: "Code word: blue whale 7341\n\n---\nCitation link for raw/a.md: /UAT/wiki/page/raw/a.md",
        data: { rawPath: "raw/a.md", href: "/UAT/wiki/page/raw/a.md" },
      },
    }));
    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      content: [{ type: "text", text: "Code word: blue whale 7341\n\n---\nCitation link for raw/a.md: /UAT/wiki/page/raw/a.md" }],
      isError: false,
    });
  });

  it("falls back to a plugin's data as both text and structuredContent when it returns no text", () => {
    expect(mcpToolCallResult({ pluginId: "p", toolName: "t", result: { data: { count: 2 } } })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ count: 2 }) }],
      structuredContent: { count: 2 },
      isError: false,
    });
  });

  it("never sends a null structuredContent, which MCP clients reject", async () => {
    const plugin = await callTool(appReturning({ pluginId: "p", toolName: "t", result: { content: "plain text only" } }));
    expect(plugin.body.result).toEqual({ content: [{ type: "text", text: "plain text only" }], isError: false });
    expect("structuredContent" in plugin.body.result).toBe(false);

    for (const result of [null, "just a string", ["a", "b"], { content: "x", data: ["not", "an", "object"] }]) {
      const shaped = mcpToolCallResult(result);
      expect("structuredContent" in shaped, JSON.stringify(result)).toBe(false);
    }
  });

  it("keeps connected MCP and built-in results as before", () => {
    expect(mcpToolCallResult({ content: "fixture result", data: { structuredContent: { ok: true } } })).toEqual({
      content: [{ type: "text", text: "fixture result" }],
      structuredContent: { structuredContent: { ok: true } },
      isError: false,
    });
    expect(mcpToolCallResult({ data: { issue: "UAT-9" } })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ issue: "UAT-9" }) }],
      structuredContent: { issue: "UAT-9" },
      isError: false,
    });
  });
});
