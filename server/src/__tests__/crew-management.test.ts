import { describe, expect, it, vi } from "vitest";
import { assertOwnResource, managementRequest, managementToolDefinitions, summarizeConnection, summarizeAgentConfiguration, summarizeRevisions } from "../services/crew-management.js";

const companyId = "22222222-2222-4222-8222-222222222222";
const agentId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  return { companyId, request: vi.fn().mockResolvedValue({ saved: true }),
    assertAgent: vi.fn().mockResolvedValue(undefined), assertConnection: vi.fn().mockResolvedValue(undefined) };
}
describe("conversational management contract", () => {
  it("publishes every management schema as an MCP input schema", () => {
    const tools = managementToolDefinitions();
    expect(tools).toHaveLength(13);
    expect(tools.every(tool => tool.inputSchema.type === "object")).toBe(true);
  });
  it("does not echo adapter secrets or configuration histories into the model context", () => {
    const summary = summarizeAgentConfiguration({ id: agentId, adapterConfig: { model: "model", env: { TOKEN: "secret" }, promptTemplate: "private" } });
    expect(JSON.stringify(summary)).not.toMatch(/secret|private/);
    const revisions = summarizeRevisions(Array.from({ length: 25 }, (_, n) => ({ id: String(n), beforeConfig: { password: "secret" }, afterConfig: { prompt: "private" } })));
    expect(revisions.total).toBe(25); expect(revisions.revisions).toHaveLength(20);
    expect(JSON.stringify(revisions)).not.toMatch(/secret|private/);
  });
  it("does not expose mutation tools in Ask/Plan", () => {
    expect(managementToolDefinitions(true).map(tool => tool.name)).toEqual([
      "crew_management_overview", "crew_agent_inspect", "crew_agent_revisions",
    ]);
  });
  it("denies cross-company and nonexistent resources identically", () => {
    expect(() => assertOwnResource(null, companyId)).toThrow("Resource not found");
    expect(() => assertOwnResource({ companyId: agentId }, companyId)).toThrow("Resource not found");
  });
  it("checks target ownership before making an API request", async () => {
    const f = fixture(); f.assertAgent.mockRejectedValue(new Error("Resource not found"));
    await expect(managementRequest({ ...f, name: "crew_agent_configure", args: { agentId, changes: { title: "Editor" } } })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("retains native configuration API and refuses host-command or permission changes", async () => {
    const f = fixture();
    await managementRequest({ ...f, name: "crew_agent_configure", args: { agentId, changes: { model: "gpt-6.1-sol", title: "Editor" } } });
    expect(f.request).toHaveBeenCalledWith(`/agents/${agentId}`, "PATCH", { title: "Editor", adapterConfig: { model: "gpt-6.1-sol" } });
    for (const changes of [{ command: "/bin/sh" }, { permissions: { admin: true } }, { adapterConfig: { env: {} } }]) {
      await expect(managementRequest({ ...f, name: "crew_agent_configure", args: { agentId, changes } })).rejects.toThrow();
    }
  });
  it("uses skill add mode without replacing unrelated selections", async () => {
    const f = fixture();
    await managementRequest({ ...f, name: "crew_agent_skills", args: { agentId, mode: "add", desiredSkills: ["media"] } });
    expect(f.request).toHaveBeenCalledWith(`/agents/${agentId}/skills/sync`, "POST", { mode: "add", desiredSkills: ["media"] });
  });
  it("uses saved adapter settings for an environment test", async () => {
    const f = fixture(); f.request.mockResolvedValueOnce({ adapterType: "codex_local", adapterConfig: { model: "configured" } });
    await managementRequest({ ...f, name: "crew_agent_environment_test", args: { agentId } });
    expect(f.request).toHaveBeenLastCalledWith(`/companies/${companyId}/adapters/codex_local/test-environment`, "POST", { agentId, adapterConfig: { model: "configured" } });
  });
  it("derives OAuth's subject from the responsible user, never the arguments", async () => {
    const f = fixture();
    await expect(managementRequest({ ...f, name: "crew_connection_authorize", args: { connectionId: agentId } })).rejects.toThrow("實際使用者");
    await managementRequest({ ...f, userId: "owner", name: "crew_connection_authorize", args: { connectionId: agentId } });
    expect(f.request).toHaveBeenCalledWith(`/agents/me/connections/${agentId}/start-authorization`, "POST", { subjectUserId: "owner" });
  });
  it("retains source errors instead of claiming an operation was applied", async () => {
    const f = fixture(); f.request.mockRejectedValue(new Error("native policy denied"));
    await expect(managementRequest({ ...f, name: "crew_agent_resume", args: { agentId } })).rejects.toThrow("native policy denied");
  });
  it("exposes only safe authorization claims and distinguishes call success from tenant proof", () => {
    const connection = { id: "c1", config: { apiKey: "secret" }, name: "CRM", healthStatus: "ok" };
    const summary = summarizeConnection(connection, [{ id: "g1", connectionId: "c1", status: "active", kind: "user",
      providerTenant: { name: "Merchant", externalId: "tenant-1", oauth: { accessToken: "secret" } }, token: "secret" }], [],
      [{ id: "call", connectionId: "c1", toolName: "auth_status", createdAt: "today" }]);
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(summary.identities[0].tenantId).toBe("tenant-1");
    expect(summary.lastSuccessfulCall?.id).toBe("call");
    expect(summary.businessTenantVerified).toBe(false);
  });
});
