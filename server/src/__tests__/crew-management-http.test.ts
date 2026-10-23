import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), decide: vi.fn(), overview: vi.fn(), operation: vi.fn(), audit: vi.fn(), company: vi.fn(),
}));
vi.mock("../services/project-tool-context.js", () => ({ projectToolContext: mocks.context }));
vi.mock("../services/access.js", () => ({ accessService: () => ({ decide: mocks.decide }) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: mocks.audit }));
vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: mocks.company,
  getActorInfo: () => ({ actorType: "agent", actorId: "agent", agentId: "agent", runId: "run" }) }));
vi.mock("../services/crew-management.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/crew-management.js")>(),
  managementOverview: mocks.overview, managementRequest: mocks.operation,
}));
import { crewManagementRoutes } from "../routes/crew-management.js";

describe("company management HTTP boundary", () => {
  const companyId = "22222222-2222-4222-8222-222222222222";
  function app() {
    const server = express().use(express.json()).use((req, _res, next) => {
      req.actor = { type: "agent", source: "agent_jwt", agentId: "agent", companyId, runId: "run" } as never;
      next();
    }).use(crewManagementRoutes({} as never));
    server.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(403).json({ error: error.message }); });
    return server;
  }
  const rpc = (method: string, name?: string, args: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params: { name, arguments: args } });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ run: { companyId }, issue: { workMode: "standard" }, userId: "owner" });
    mocks.decide.mockResolvedValue({ allowed: true });
    mocks.overview.mockResolvedValue({ companyId, agents: [] });
    mocks.operation.mockResolvedValue({ applied: true });
  });
  it("uses the authenticated run company, ignoring a supplied company", async () => {
    const response = await request(app()).post("/mcp/crew-management").send(rpc("tools/call", "crew_management_overview", { companyId: "foreign" }));
    expect(response.body.result.isError).toBe(true);
    expect(mocks.overview).not.toHaveBeenCalled();
    await request(app()).post("/mcp/crew-management").send(rpc("tools/call", "crew_management_overview"));
    expect(mocks.overview).toHaveBeenCalledWith({}, companyId);
  });
  it("fails before dispatch when active run or policy is unavailable", async () => {
    mocks.context.mockRejectedValueOnce(new Error("Run is no longer active"));
    await request(app()).post("/mcp/crew-management").send(rpc("tools/list")).expect(403);
    mocks.decide.mockResolvedValueOnce({ allowed: false, explanation: "Policy denied" });
    await request(app()).post("/mcp/crew-management").send(rpc("tools/list")).expect(403);
    expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("checks write authority and records the actual operation", async () => {
    await request(app()).post("/mcp/crew-management").send(rpc("tools/call", "crew_agent_resume", { agentId: "11111111-1111-4111-8111-111111111111" }));
    expect(mocks.context).toHaveBeenCalledWith({}, expect.anything(), true, "Management");
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_config:update" }));
    expect(mocks.operation).toHaveBeenCalledWith(expect.objectContaining({ companyId, userId: "owner" }));
    expect(mocks.audit).toHaveBeenCalledWith({}, expect.objectContaining({ companyId, runId: "run", action: "crew_management.operation" }));
  });
  it("does not turn an ownerless background run into an administrator", async () => {
    mocks.context.mockResolvedValue({ run: { companyId }, issue: { workMode: "standard" }, userId: null });
    await request(app()).post("/mcp/crew-management").send(rpc("tools/call", "crew_agent_resume", { agentId: "11111111-1111-4111-8111-111111111111" })).expect(403);
    expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("offers only read tools in Ask and keeps the overview uncached", async () => {
    mocks.context.mockResolvedValue({ run: { companyId }, issue: { workMode: "ask" }, userId: "owner" });
    const result = await request(app()).post("/mcp/crew-management").send(rpc("tools/list"));
    expect(result.body.result.tools).toHaveLength(3);
    await request(app()).get(`/companies/${companyId}/management`).expect("Cache-Control", "private, no-store").expect(200);
  });
});
